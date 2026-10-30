// Real React/StrictMode + transport + pagination hook; all HTTP/WS evidence is
// synthetic. No Workbench, Store, transcript, model, or running backend is used.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page, type WebSocketRoute } from "playwright";
import { createServer } from "vite";
import type { Command } from "../src/shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListInitial, SessionListItem, SessionListPage } from "../src/shared/session-list.js";
import type { SessionListState } from "../src/client/workspaces/session-list-pages.js";

type Snapshot = { context: { workspaceId: string; query: string; generation: number }; state: SessionListState;
  epoch: number; acceptedEpoch: number; enabled: boolean; error: string | null; errors: { top: string | null; workspace: string | null } };
type Held = { c: Command; socket: WebSocketRoute; data: SessionListInitial | SessionListPage; answered: boolean };
const temporary = mkdtempSync(join(tmpdir(), "axiom-list-connection-vite-"));
const artifacts = process.env.AXIOM_LIST_CONNECTION_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-list-connection-evidence-"));
mkdirSync(artifacts, { recursive: true });
const vite = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "cache"),
  server: { host: "127.0.0.1", port: 0, hmr: false }, esbuild: { jsx: "automatic" } });
const reports: unknown[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function until(check: () => unknown | Promise<unknown>, description: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(description);
}
const state = async (page: Page): Promise<Snapshot> => JSON.parse((await page.locator("#snapshot").textContent())!);
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const waitState = (world: World, check: (snapshot: Snapshot) => unknown, description: string) => until(async () => check(await state(world.page)), description);
const rows = (snapshot: Snapshot, group: SessionListGroup) => snapshot.state[group].page?.items ?? [];
const button = (world: World, name: string) => world.page.getByRole("button", { name, exact: true });
const initialCount = (world: World) => world.commands.filter(c => c.op === "session-list.initial").length;

class World {
  readonly commands: Command[] = [];
  readonly unexpected: string[] = [];
  readonly sockets: WebSocketRoute[] = [];
  readonly held: Held[] = [];
  readonly holdPages = new Set<SessionListGroup>();
  holdInitial = false;
  muteGlobal = false;
  failNextPage = false;
  revision = 1;
  seq = 1;
  tag = "base";
  constructor(readonly page: Page) {}
  get socket() { return this.sockets.at(-1)!; }
  send(socket: WebSocketRoute, value: unknown) { try { socket.send(JSON.stringify(value)); } catch { /* a deliberately closed test socket */ } }
  receipt(socket: WebSocketRoute, c: Command, data: unknown) { this.send(socket, { type: "receipt", requestId: c.requestId, ok: true, data }); }
  fail(socket: WebSocketRoute, c: Command, code: string) { this.send(socket, { type: "receipt", requestId: c.requestId, ok: false, error: { code, message: code } }); }
  global() { this.send(this.socket, { type: "snapshot", scope: "session-list", streamId: "list-connection", seq: this.seq, data: { revision: this.revision } }); }
  invalidate() { ++this.seq; this.global(); }
  pending(op: string) { return this.held.filter(p => !p.answered && p.c.op === op); }
  answer(p: Held, error?: string) { p.answered = true; if (error) this.fail(p.socket, p.c, error); else this.receipt(p.socket, p.c, p.data); }
  pageData(c: Command, group: SessionListGroup, cursor: SessionListCursor | null): SessionListPage {
    const offset = cursor?.familyRank ?? 0;
    const items: SessionListItem[] = Array.from({ length: Math.min(30, 65 - offset) }, (_, index) => {
      const id = `${c.workspaceId}-${group}-${offset + index}`;
      return { id, workspaceId: c.workspaceId!, title: `${this.tag}:${id}:${String(c.params?.query ?? "")}`,
        pinned: group === "top", unread: false, updatedAt: 1000 - offset - index,
        familyId: `${c.workspaceId}-${group}-family`, familyTop: group === "top" };
    });
    return { revision: this.revision, items, next: offset + items.length < 65 ? {
      version: 1, streamId: "list-connection", workspaceId: c.workspaceId!, group, query: String(c.params?.query ?? ""),
      revision: this.revision, familyRank: offset + items.length, memberRank: 1,
    } : null };
  }
  async install() {
    this.page.setDefaultTimeout(5000);
    await this.page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
    await this.page.route("**/api/**", route => route.fulfill({ json: { ok: true } }));
    await this.page.route("**/__list_connection", route => route.fulfill({ contentType: "text/html",
      body: '<div id="root"></div><script type="module" src="/tests/fixtures/session-list-connection.tsx"></script>' }));
    await this.page.routeWebSocket("**/ws", socket => {
      this.sockets.push(socket);
      this.send(socket, { type: "hello", streamId: "list-connection" });
      socket.onMessage(raw => {
        const c = JSON.parse(String(raw)) as Command;
        this.commands.push(c);
        if (c.op === "subscribe") {
          if (c.params?.scope === "connection-diagnostic") { this.fail(socket, c, "DIAGNOSTIC_ONLY"); return; }
          if (c.params?.scope !== "session-list") { this.unexpected.push(`subscribe:${String(c.params?.scope)}`); this.fail(socket, c, "UNEXPECTED_SCOPE"); return; }
          if (!this.muteGlobal) this.send(socket, { type: "snapshot", scope: "session-list", streamId: "list-connection", seq: this.seq, data: { revision: this.revision } });
          this.receipt(socket, c, {}); return;
        }
        if (["unsubscribe", "read.cancel", "ping"].includes(c.op)) { this.receipt(socket, c, {}); return; }
        if (c.op === "session-list.initial") {
          const data: SessionListInitial = { revision: this.revision, top: this.pageData(c, "top", null), workspace: this.pageData(c, "workspace", null) };
          if (this.holdInitial) this.held.push({ c, socket, data, answered: false }); else this.receipt(socket, c, data);
          return;
        }
        if (c.op === "session-list.page") {
          const group = c.params?.group as SessionListGroup, cursor = c.params?.cursor as SessionListCursor | null;
          if (cursor && cursor.revision !== this.revision) { this.fail(socket, c, "CURSOR_STALE"); return; }
          if (this.failNextPage) { this.failNextPage = false; this.fail(socket, c, "PAGE_UNAVAILABLE"); return; }
          const data = this.pageData(c, group, cursor);
          if (this.holdPages.has(group)) this.held.push({ c, socket, data, answered: false }); else this.receipt(socket, c, data);
          return;
        }
        this.unexpected.push(c.op); this.fail(socket, c, "UNEXPECTED_OP");
      });
    });
  }
  async ready() {
    const port = (vite.httpServer!.address() as { port: number }).port;
    await this.page.goto(`http://127.0.0.1:${port}/__list_connection`);
    await this.page.locator("#snapshot").waitFor();
    await waitState(this, value => value.state.revision !== null && !value.state.loading, "initial pages settled");
  }
}

const cases: { name: string; run: (world: World) => Promise<void> }[] = [
  { name: "strict-lifetime", run: async world => {
    world.muteGlobal = true; // first RPC must not wait for a global snapshot
    await world.ready(); await world.page.waitForTimeout(80);
    assert.equal(initialCount(world), 1, "StrictMode's disposed setup never dispatches its deferred first RPC");
    assert.ok(world.commands.filter(c => c.op === "subscribe").length >= 2, "the connected child really exercised StrictMode's effect replay");
    assert.ok(world.commands.some(c => c.op === "unsubscribe"));
    const first = await state(world.page); assert.equal(first.acceptedEpoch, first.epoch);
    await button(world, "挂载切换").click(); await world.page.locator("#snapshot").waitFor({ state: "detached" });
    await world.page.waitForTimeout(80); assert.equal(initialCount(world), 1, "unmounted model cannot self-refresh");
    await button(world, "挂载切换").click();
    await waitState(world, value => value.state.revision !== null && !value.state.loading, "new mount gets a new live model");
    await world.page.waitForTimeout(80); assert.equal(initialCount(world), 2);
    assert.equal(await world.page.locator("li").count(), 60);
  } },
  { name: "context-race", run: async world => {
    await world.ready(); world.holdInitial = true;
    await world.page.getByLabel("原始搜索", { exact: true }).fill(" Alpha ");
    await until(() => world.pending("session-list.initial").some(p => p.c.params?.query === " Alpha "), "raw query request dispatched unchanged");
    const first = world.pending("session-list.initial").at(-1)!;
    await world.page.getByLabel("空间", { exact: true }).fill("foreign");
    await until(() => world.pending("session-list.initial").some(p => p.c.workspaceId === "foreign"), "new workspace read dispatched");
    const second = world.pending("session-list.initial").at(-1)!;
    world.tag = "final";
    await world.page.getByLabel("原始搜索", { exact: true }).fill("Beta");
    await until(() => world.pending("session-list.initial").some(p => p.c.workspaceId === "foreign" && p.c.params?.query === "Beta"), "final context read dispatched");
    await waitState(world, value => value.context.query === "Beta" && value.state.top.page === null && value.acceptedEpoch === 0, "old context is masked before the new response");
    const last = world.pending("session-list.initial").at(-1)!; world.answer(last);
    await waitState(world, value => rows(value, "top")[0]?.title.startsWith("final:"), "current context accepted");
    world.answer(second); world.answer(first); await settle(world.page);
    // Lease reactivation may deliver its initial global snapshot after the
    // first RPC began. Drain that legitimate dirty follow-up before declaring
    // this context settled; older canceled responses remain uncooperative.
    world.holdInitial = false;
    for (const p of world.pending("session-list.initial").filter(p => p.c.workspaceId === "foreign" && p.c.params?.query === "Beta")) world.answer(p);
    await waitState(world, value => !value.state.loading && rows(value, "top")[0]?.title.startsWith("final:"), "latest context and any dirty follow-up settle");
    const settledCount = initialCount(world); await world.page.waitForTimeout(80); assert.equal(initialCount(world), settledCount);
    const final = await state(world.page);
    assert.equal(final.context.workspaceId, "foreign"); assert.equal(final.context.query, "Beta");
    assert.ok(rows(final, "top").every(item => item.workspaceId === "foreign" && item.title.endsWith(":Beta")));
    for (const p of [first, second]) assert.ok(world.commands.some(c => c.op === "read.cancel" && c.params?.requestId === p.c.requestId));
  } },
  { name: "empty-workspace-return", run: async world => {
    await world.ready(); world.holdInitial = true;
    await world.page.getByLabel("空间", { exact: true }).fill("");
    await waitState(world, value => value.context.workspaceId === "" && value.state.top.page === null && !value.enabled, "empty workspace owns no title pages");
    world.tag = "returned";
    await world.page.getByLabel("空间", { exact: true }).fill("w");
    await until(() => world.pending("session-list.initial").length > 0, "return to w starts a new reader");
    const waiting = await state(world.page);
    assert.equal(waiting.state.top.page, null, "a disposed workspace lifetime must not resurrect its old page on reactivation");
    assert.equal(waiting.acceptedEpoch, 0);
    world.holdInitial = false;
    for (const p of world.pending("session-list.initial")) world.answer(p);
    await waitState(world, value => !value.state.loading && rows(value, "top")[0]?.title.startsWith("returned:"), "reactivated workspace accepts its own pages");
  } },
  { name: "shared-global-lease", run: async world => {
    await world.ready();
    await button(world, "挂载切换").click(); await world.page.locator("#snapshot").waitFor({ state: "detached" });
    const beforeOrder = await world.page.evaluate(() => (window as any).listConnection.scopeOrder("session-list"));
    await world.page.evaluate(() => { const api = (window as any).listConnection; api.releaseShared = api.subscribeScope("session-list", () => {}); });
    await world.page.waitForFunction(order => (window as any).listConnection.scopeOrder("session-list") > order, beforeOrder);
    const subscriptions = world.commands.filter(c => c.op === "subscribe" && c.params?.scope === "session-list").length, count = initialCount(world);
    await button(world, "挂载切换").click();
    await waitState(world, value => value.state.revision !== null && !value.state.loading, "a pre-existing authority lease does not starve bootstrap");
    assert.equal(initialCount(world), count + 1, "cached global authority is not mistaken for an extra invalidation");
    assert.equal(world.commands.filter(c => c.op === "subscribe" && c.params?.scope === "session-list").length, subscriptions, "hook shares the existing wire subscription");
    world.tag = "shared"; world.invalidate();
    await waitState(world, value => !value.state.loading && rows(value, "top")[0]?.title.startsWith("shared:"), "shared lease receives same-revision invalidation");
    await world.page.evaluate(() => { (window as any).listConnection.releaseShared(); });
    world.tag = "shared-left"; world.invalidate();
    await waitState(world, value => !value.state.loading && rows(value, "top")[0]?.title.startsWith("shared-left:"), "other observer leaving does not reset hook's active lease");
    assert.equal(initialCount(world), count + 3);
    assert.equal(world.commands.filter(c => c.op === "subscribe" && c.params?.scope === "session-list").length, subscriptions);
  } },
  { name: "same-revision-dirty", run: async world => {
    await world.ready(); const before = initialCount(world); world.holdInitial = true;
    world.invalidate(); await until(() => world.pending("session-list.initial").length === 1, "same revision delivery starts refresh");
    world.invalidate(); world.invalidate(); world.invalidate();
    await world.page.waitForFunction(order => (window as any).listConnection.scopeOrder("session-list") === order, world.seq);
    assert.equal(initialCount(world), before + 1, "in-flight initial coalesces the burst");
    world.tag = "after-dirty"; world.answer(world.pending("session-list.initial")[0]);
    await until(() => world.pending("session-list.initial").length === 1 && initialCount(world) === before + 2, "one dirty follow-up starts");
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => !value.state.loading && rows(value, "top")[0]?.title.startsWith("after-dirty:"), "coherent follow-up accepted");
    await world.page.waitForTimeout(80); assert.equal(initialCount(world), before + 2, "read completion does not self-invalidate");
    assert.equal((await state(world.page)).state.revision, world.revision);
  } },
  { name: "independent-pages", run: async world => {
    await world.ready(); world.holdPages.add("top");
    await button(world, "top 下一页").click(); await until(() => world.pending("session-list.page").length === 1, "top read held");
    assert.equal(await button(world, "top 下一页").isDisabled(), true);
    assert.equal(await button(world, "workspace 下一页").isEnabled(), true);
    await button(world, "workspace 下一页").click();
    await waitState(world, value => rows(value, "workspace")[0]?.id === "w-workspace-30", "other group can move independently");
    assert.equal(rows(await state(world.page), "top")[0].id, "w-top-0");
    world.holdPages.delete("top"); world.answer(world.pending("session-list.page")[0]);
    await waitState(world, value => rows(value, "top")[0]?.id === "w-top-30", "top move accepted");
    await button(world, "workspace 上一页").click();
    await waitState(world, value => rows(value, "workspace")[0]?.id === "w-workspace-0", "previous cursor returns first page");
    world.failNextPage = true; await button(world, "workspace 下一页").click();
    await waitState(world, value => value.errors.workspace === "PAGE_UNAVAILABLE", "page error retained");
    assert.equal(rows(await state(world.page), "workspace")[0].id, "w-workspace-0");
    await button(world, "workspace 下一页").click();
    await waitState(world, value => rows(value, "workspace")[0]?.id === "w-workspace-30" && !value.errors.workspace, "same page can retry");
    ++world.revision; await button(world, "top 下一页").click();
    await waitState(world, value => !value.state.loading && value.state.revision === 2 && rows(value, "top")[0]?.id === "w-top-0", "CURSOR_STALE atomically resets both groups");
    const final = await state(world.page);
    assert.equal(rows(final, "workspace")[0].id, "w-workspace-0");
    assert.equal(final.state.top.previous.length, 0); assert.equal(final.state.workspace.previous.length, 0);
    assert.equal(await world.page.locator("li").count(), 60, "page moves replace rows, never append");
  } },
  { name: "connection-generation", run: async world => {
    await world.ready(); const before = await state(world.page), count = initialCount(world);
    await button(world, "诊断提示").click(); await world.page.locator("#connection-status").filter({ hasText: "DIAGNOSTIC_ONLY" }).waitFor();
    await world.page.waitForTimeout(80); assert.equal(initialCount(world), count); assert.equal((await state(world.page)).epoch, before.epoch);
    world.holdPages.add("top"); await button(world, "top 下一页").click();
    await until(() => world.pending("session-list.page").length === 1, "old connection page read is outstanding");
    world.holdInitial = true; world.tag = "new-generation";
    world.socket.close({ code: 1012, reason: "synthetic reconnect" });
    await world.page.waitForFunction(() => JSON.parse(document.querySelector("#connection")!.textContent!).connected === false);
    const offline = await state(world.page);
    assert.equal(rows(offline, "top")[0].id, "w-top-0"); assert.equal(offline.enabled, false);
    assert.equal(offline.state.loading, false); assert.equal(offline.state.top.loading, false);
    assert.equal(await button(world, "top 下一页").isDisabled(), true);
    await world.page.evaluate(() => { void (window as any).listConnection.connect(); });
    await until(() => world.sockets.length === 2 && world.pending("session-list.initial").some(p => p.socket === world.socket), "new generation waits for its own initial");
    const pending = await state(world.page);
    assert.ok(pending.context.generation > before.context.generation); assert.equal(pending.state.top.page, null); assert.equal(pending.acceptedEpoch, 0);
    world.holdInitial = false;
    for (const p of world.pending("session-list.initial").filter(p => p.socket === world.socket)) world.answer(p);
    await waitState(world, value => !value.state.loading && rows(value, "top")[0]?.title.startsWith("new-generation:"), "new socket pages become visible");
  } },
  { name: "restart-error-reset", run: async world => {
    await world.ready(); const before = await state(world.page);
    world.failNextPage = true; await button(world, "top 下一页").click();
    await waitState(world, value => value.errors.top === "PAGE_UNAVAILABLE", "old page error is visible before restart");
    world.holdInitial = true; await button(world, "重新读取").click();
    await until(() => world.pending("session-list.initial").length > 0, "new initial is in flight");
    assert.equal((await state(world.page)).errors.top, null, "a fresh reader must not inherit an obsolete page error");
    world.answer(world.pending("session-list.initial")[0], "FRESH_READ_FAILED");
    await waitState(world, value => value.error === "FRESH_READ_FAILED", "current initial error is shown");
    const failed = await state(world.page);
    assert.equal(failed.errors.top, null); assert.equal(failed.acceptedEpoch, before.acceptedEpoch);
    assert.equal(rows(failed, "top")[0].id, "w-top-0");
    world.tag = "recovered"; world.holdInitial = false; await button(world, "刷新").click();
    await waitState(world, value => !value.state.loading && !value.error && rows(value, "top")[0]?.title.startsWith("recovered:"), "new reader can retry without stale errors");
  } },
  { name: "restart-fence", run: async world => {
    await world.ready(); const base = await state(world.page); world.holdInitial = true; world.tag = "pre-fence";
    await button(world, "刷新").click(); await until(() => world.pending("session-list.initial").length === 1, "old initial held");
    const old = world.pending("session-list.initial")[0]; world.tag = "post-fence";
    await button(world, "重新读取").click(); await until(() => world.pending("session-list.initial").length === 2, "forced initial dispatched without awaiting the old read");
    await waitState(world, value => value.epoch > base.epoch && value.acceptedEpoch === base.acceptedEpoch, "a new reader is not yet accepted evidence");
    const fresh = world.pending("session-list.initial").at(-1)!;
    world.answer(old); await settle(world.page);
    assert.ok(rows(await state(world.page), "top")[0].title.startsWith("base:"), "pre-fence result cannot replace the transition pages");
    world.answer(fresh, "INITIAL_UNAVAILABLE");
    await waitState(world, value => value.error === "INITIAL_UNAVAILABLE" && !value.state.loading, "failed new initial keeps explicit error");
    assert.equal((await state(world.page)).acceptedEpoch, base.acceptedEpoch);
    world.tag = "server-C"; await button(world, "刷新").click();
    await until(() => world.pending("session-list.initial").length === 1, "post-fence read retries");
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => value.acceptedEpoch === value.epoch && rows(value, "top")[0]?.title.startsWith("server-C:"), "only successful new initial advances accepted epoch");
    const second = await state(world.page);
    world.holdPages.add("top"); await button(world, "top 下一页").click();
    await until(() => world.pending("session-list.page").length === 1, "old page held");
    const oldPage = world.pending("session-list.page")[0]; world.tag = "epoch-three";
    await button(world, "重新读取").click(); await until(() => world.pending("session-list.initial").length === 1, "restart also fences an old page move");
    world.answer(oldPage); await settle(world.page);
    assert.equal(rows(await state(world.page), "top")[0].id, "w-top-0");
    assert.equal((await state(world.page)).acceptedEpoch, second.acceptedEpoch);
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => value.acceptedEpoch === value.epoch && value.epoch > second.epoch && rows(value, "top")[0]?.title.startsWith("epoch-three:"), "new pair wins over the late page");
    for (const p of [old, oldPage]) assert.ok(world.commands.some(c => c.op === "read.cancel" && c.params?.requestId === p.c.requestId));
  } },
];

try {
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const requested = process.env.AXIOM_LIST_CONNECTION_CASES?.split(",").filter(Boolean);
  const enabled = requested ? cases.filter(item => requested.includes(item.name)) : cases;
  assert.ok(enabled.length && (!requested || requested.length === enabled.length), "requested cases must exist");
  for (const scenario of enabled) {
    const page: Page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const world: World = new World(page); await world.install();
    try {
      await scenario.run(world); assert.deepEqual(errors, []); assert.deepEqual(world.unexpected, []);
      const snapshot = await state(page);
      for (const group of ["top", "workspace"] as const) {
        assert.ok(rows(snapshot, group).length <= 30);
        assert.ok(snapshot.state[group].previous.every(cursor => !cursor || !Object.hasOwn(cursor, "items")), "trail contains cursors, not old pages");
      }
      reports.push({ name: scenario.name, passed: true, snapshot, commands: world.commands, errors, unexpected: world.unexpected });
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      reports.push({ name: scenario.name, passed: false, error: String(error), snapshot: await state(page).catch(() => null), commands: world.commands, errors, unexpected: world.unexpected });
      await page.screenshot({ path: join(artifacts, `${scenario.name}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(artifacts, `${scenario.name}.html`), await page.content().catch(() => "")); throw error;
    } finally { await page.close(); }
  }
  console.log(`PASS session-list-connection ${enabled.length} cases; artifacts ${artifacts}`);
} finally {
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
  await browser?.close(); await vite.close(); rmSync(temporary, { recursive: true, force: true });
}
