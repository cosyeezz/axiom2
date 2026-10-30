// Real StrictMode/transport/page owner/projection adapter with synthetic HTTP/WS.
// Layout records describe React commits, not browser paint or production latency.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page, type WebSocketRoute } from "playwright";
import { createServer } from "vite";
import type { Command } from "../src/shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListInitial, SessionListItem, SessionListPage } from "../src/shared/session-list.js";
import type { SessionListState } from "../src/client/workspaces/session-list-pages.js";

type Snapshot = { context: { workspaceId: string; query: string; generation: number }; epoch: number; acceptedEpoch: number; enabled: boolean;
  state: SessionListState; top: SessionListItem[]; workspace: SessionListItem[]; held: SessionListItem[]; heldBase: SessionListItem[];
  pending: { id: string; op: string; state: string; params: Record<string, unknown> }[]; error: string | null; failure: string | null };
type Held = { c: Command; socket: WebSocketRoute; data: unknown; answered: boolean };
const temporary = mkdtempSync(join(tmpdir(), "axiom-list-projection-vite-"));
const artifacts = process.env.AXIOM_LIST_PROJECTION_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-list-projection-evidence-"));
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
const waitState = (world: World, check: (value: Snapshot) => unknown, description: string) => until(async () => check(await state(world.page)), description);
const button = (world: World, name: string) => world.page.getByRole("button", { name, exact: true });
const target = (snapshot: Snapshot) => snapshot.top.find(row => row.id === "w-top-0");
const count = (world: World, op: string) => world.commands.filter(c => c.op === op).length;
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

class World {
  readonly commands: Command[] = [];
  readonly unexpected: string[] = [];
  readonly held: Held[] = [];
  readonly sockets: WebSocketRoute[] = [];
  readonly holdPages = new Set<SessionListGroup>();
  readonly omitted = new Set<string>();
  holdInitial = false;
  revision = 1;
  seq = 1;
  targetTitle: string | null = null;
  targetPinned = true;
  verificationStatus = "not_found";
  constructor(readonly page: Page) {}
  get socket() { return this.sockets.at(-1)!; }
  send(socket: WebSocketRoute, data: unknown) { try { socket.send(JSON.stringify(data)); } catch { /* deliberately closed socket */ } }
  receipt(socket: WebSocketRoute, c: Command, data: unknown) { this.send(socket, { type: "receipt", requestId: c.requestId, ok: true, data }); }
  fail(socket: WebSocketRoute, c: Command, code: string) { this.send(socket, { type: "receipt", requestId: c.requestId, ok: false, error: { code, message: code } }); }
  invalidate() { this.send(this.socket, { type: "snapshot", scope: "session-list", streamId: "list-projection", seq: ++this.seq, data: { revision: this.revision } }); }
  pending(op: string) { return this.held.filter(entry => !entry.answered && entry.c.op === op); }
  answer(entry: Held, error?: string) { entry.answered = true; if (error) this.fail(entry.socket, entry.c, error); else this.receipt(entry.socket, entry.c, entry.data); }
  setTitle(title: string) { this.targetTitle = title; ++this.revision; }
  pageData(c: Command, group: SessionListGroup, cursor: SessionListCursor | null): SessionListPage {
    const offset = cursor?.familyRank ?? 0;
    const eligible = Array.from({ length: 65 }, (_, index) => `${c.workspaceId}-${group}-${index}`).filter(id => !this.omitted.has(id));
    const ids = eligible.slice(offset, offset + 30);
    return { revision: this.revision, items: ids.map((id, index) => ({ id, workspaceId: c.workspaceId!,
      title: id === "w-top-0" && this.targetTitle !== null ? this.targetTitle : `A:${id}:${String(c.params?.query ?? "")}`,
      pinned: id === "w-top-0" ? this.targetPinned : group === "top", unread: false, updatedAt: 1000 - offset - index,
      familyId: `${c.workspaceId}-${group}-family`, familyTop: group === "top" })),
      next: offset + ids.length < eligible.length ? { version: 1, streamId: "list-projection", revision: this.revision,
        workspaceId: c.workspaceId!, group, query: String(c.params?.query ?? ""), familyRank: offset + ids.length, memberRank: 1 } : null };
  }
  async install() {
    this.page.setDefaultTimeout(5000);
    await this.page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
    await this.page.route("**/api/**", route => route.fulfill({ json: { ok: true } }));
    await this.page.route("**/__list_projection", route => route.fulfill({ contentType: "text/html",
      body: '<div id="root"></div><script type="module" src="/tests/fixtures/session-list-projection.tsx"></script>' }));
    await this.page.routeWebSocket("**/ws", socket => {
      this.sockets.push(socket); this.send(socket, { type: "hello", streamId: "list-projection" });
      socket.onMessage(raw => {
        const c = JSON.parse(String(raw)) as Command; this.commands.push(c);
        if (c.op === "subscribe") {
          if (c.params?.scope !== "session-list") { this.unexpected.push(`scope:${String(c.params?.scope)}`); this.fail(socket, c, "UNEXPECTED_SCOPE"); return; }
          // Intentionally no global bootstrap snapshot: the page owner must read.
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
          const data = this.pageData(c, group, cursor);
          if (this.holdPages.has(group)) this.held.push({ c, socket, data, answered: false }); else this.receipt(socket, c, data);
          return;
        }
        if (["session.rename", "session.pin", "session.delete"].includes(c.op)) { this.held.push({ c, socket, data: {}, answered: false }); return; }
        if (c.op === "request.get") { this.receipt(socket, c, { status: this.verificationStatus }); return; }
        this.unexpected.push(c.op); this.fail(socket, c, "UNEXPECTED_OP");
      });
    });
  }
  async open() {
    const port = (vite.httpServer!.address() as { port: number }).port;
    await this.page.goto(`http://127.0.0.1:${port}/__list_projection`); await this.page.locator("#snapshot").waitFor();
  }
  async ready() { await this.open(); await waitState(this, value => value.state.revision !== null && !value.state.loading, "initial accepted"); }
  async rename(title: string) { await this.page.getByLabel("标题值", { exact: true }).fill(title); await button(this, "改名").click(); await until(() => this.pending("session.rename").some(entry => entry.c.params?.title === title), `rename ${title} dispatched`); }
  canceled(entry: Held) { return this.commands.some(c => c.op === "read.cancel" && c.params?.requestId === entry.c.requestId); }
}

const cases: { name: string; run: (world: World) => Promise<void> }[] = [
  { name: "rename-initial-fence", run: async world => {
    await world.ready(); const before = await state(world.page);
    world.holdInitial = true; world.invalidate(); await until(() => world.pending("session-list.initial").length === 1, "pre-receipt initial held");
    const old = world.pending("session-list.initial")[0];
    await world.rename("B"); await waitState(world, value => target(value)?.title === "B" && value.pending.length === 1, "pending B visible");
    world.setTitle("C"); world.answer(world.pending("session.rename")[0]);
    await until(() => world.pending("session-list.initial").length === 2, "post-receipt initial started separately");
    await waitState(world, value => !value.pending.length && target(value)?.title === "B" && value.epoch > before.epoch, "completed B bridges removed intent");
    const fresh = world.pending("session-list.initial").at(-1)!; const fence = (await state(world.page)).epoch;
    assert.equal((await state(world.page)).acceptedEpoch, before.acceptedEpoch); assert.ok(world.canceled(old));
    world.answer(old); await settle(world.page); assert.equal(target(await state(world.page))?.title, "B");
    world.answer(fresh); await waitState(world, value => value.acceptedEpoch === fence && target(value)?.title === "C", "fresh C atomically wins B");
    const commits = await world.page.evaluate(() => (window as any).projectionFrames as { acceptedEpoch: number; top: { id: string; title: string }[] }[]);
    assert.ok(commits.filter(frame => frame.acceptedEpoch >= fence).every(frame => frame.top.find(row => row.id === "w-top-0")?.title === "C"), "no accepted React commit applies stale B over C");
  } },
  { name: "pin-page-fence", run: async world => {
    await world.ready(); world.holdPages.add("top"); await button(world, "top 下一页").click();
    await until(() => world.pending("session-list.page").length === 1, "pre-receipt page held"); const old = world.pending("session-list.page")[0];
    world.holdInitial = true; await button(world, "取消置顶").click(); await until(() => world.pending("session.pin").length === 1, "pin dispatched");
    await waitState(world, value => target(value)?.pinned === false, "pending pin field visible without moving family");
    world.targetPinned = false; world.setTitle("C-pin"); world.answer(world.pending("session.pin")[0]);
    await until(() => world.pending("session-list.initial").length === 1, "post-pin initial held");
    await waitState(world, value => !value.pending.length && target(value)?.pinned === false, "confirmed pin bridges pending removal");
    assert.ok(world.canceled(old)); world.answer(old); await settle(world.page);
    const waiting = await state(world.page); assert.equal(waiting.top[0].id, "w-top-0"); assert.equal(waiting.top[0].familyTop, true);
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => target(value)?.title === "C-pin" && value.epoch === value.acceptedEpoch, "fresh pin pair accepted");
  } },
  { name: "delete-failure-retry", run: async world => {
    await world.ready(); world.holdInitial = true; world.invalidate();
    await until(() => world.pending("session-list.initial").length === 1, "old initial held"); const old = world.pending("session-list.initial")[0];
    await button(world, "删除目标").click(); await until(() => world.pending("session.delete").length === 1, "delete dispatched");
    await waitState(world, value => !target(value) && value.pending.length === 1, "pending delete hides existing row");
    world.omitted.add("w-top-0"); ++world.revision; world.answer(world.pending("session.delete")[0]);
    await until(() => world.pending("session-list.initial").length === 2, "delete receipt fenced old initial");
    await waitState(world, value => !value.pending.length && !target(value), "deleted row does not resurrect after intent removal");
    const accepted = (await state(world.page)).acceptedEpoch; world.answer(old); world.answer(world.pending("session-list.initial")[0], "FRESH_READ_FAILED");
    await waitState(world, value => value.error === "FRESH_READ_FAILED", "fresh initial failure exposed");
    assert.equal(target(await state(world.page)), undefined); assert.equal((await state(world.page)).acceptedEpoch, accepted);
    await button(world, "刷新").click(); await until(() => world.pending("session-list.initial").length === 1, "fresh retry held");
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => !value.error && value.epoch === value.acceptedEpoch && !target(value), "retry accepts authoritative deletion");
    assert.ok(world.canceled(old)); assert.equal((await state(world.page)).top.length, 30);
  } },
  { name: "receipt-before-first-page", run: async world => {
    world.holdInitial = true; await world.open(); await until(() => world.pending("session-list.initial").length === 1, "first initial held");
    const old = world.pending("session-list.initial")[0]; await world.rename("B"); world.setTitle("C-first"); world.answer(world.pending("session.rename")[0]);
    await until(() => world.pending("session-list.initial").length === 2, "completion fences a read even without any visible target");
    const waiting = await state(world.page); assert.deepEqual(waiting.top, []); assert.equal(waiting.acceptedEpoch, 0);
    assert.ok(world.canceled(old)); world.answer(old); await settle(world.page); assert.deepEqual((await state(world.page)).top, []);
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => target(value)?.title === "C-first" && value.epoch === value.acceptedEpoch, "only post-receipt first pair can appear");
  } },
  { name: "held-completion-materialization", run: async world => {
    await world.ready(); await button(world, "持有目标").click(); await waitState(world, value => value.heldBase.length === 1, "raw held summary captured");
    await button(world, "top 下一页").click(); await waitState(world, value => value.top[0]?.id === "w-top-30", "held target leaves current page");
    world.holdInitial = true; await world.rename("B"); world.setTitle("B"); world.omitted.add("w-top-0"); ++world.revision;
    world.answer(world.pending("session.rename")[0]); await until(() => world.pending("session-list.initial").length === 1, "held completion fresh pair");
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => value.epoch === value.acceptedEpoch && value.held[0]?.title === "B", "accepted absence keeps materialized B, not A");
    assert.equal((await state(world.page)).heldBase[0].title, "B");
    world.omitted.delete("w-top-0"); world.setTitle("C-held"); world.invalidate();
    await until(() => world.pending("session-list.initial").length === 1, "later server C read"); world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => value.heldBase[0]?.title === "C-held", "raw C persisted into finite held baseline");
    await button(world, "top 下一页").click(); await waitState(world, value => value.top[0]?.id === "w-top-30", "C leaves page again");
    assert.equal((await state(world.page)).held[0].title, "C-held", "absence cannot resurrect B");
    await button(world, "删除目标").click(); await until(() => world.pending("session.delete").length === 1, "held delete dispatched");
    world.omitted.add("w-top-0"); ++world.revision; world.answer(world.pending("session.delete")[0]);
    await until(() => world.pending("session-list.initial").length === 1, "held delete fresh read");
    await waitState(world, value => !value.heldBase.length && !value.held.length, "delete materialization removes held fallback");
    world.answer(world.pending("session-list.initial")[0]); await waitState(world, value => value.epoch === value.acceptedEpoch && !value.held.length, "accepted delete never reinserts held");
  } },
  { name: "completion-order-and-uncertain", run: async world => {
    await world.ready(); world.holdInitial = true;
    await world.rename("A-pending"); await world.rename("B"); world.setTitle("C-order");
    world.answer(world.pending("session.rename").find(entry => entry.c.params?.title === "B")!);
    await until(() => world.pending("session-list.initial").length === 1, "B completion fenced");
    await waitState(world, value => value.pending.length === 1 && target(value)?.title === "A-pending", "existing pending reduce can overlay later completion");
    world.answer(world.pending("session.rename")[0], "DENIED"); await waitState(world, value => !value.pending.length && target(value)?.title === "B", "failure withdraws only old pending, exposing B");
    world.answer(world.pending("session-list.initial")[0]); await waitState(world, value => target(value)?.title === "C-order", "server wins completed B");
    const before = count(world, "session-list.initial"); await world.rename("U"); world.answer(world.pending("session.rename")[0], "UNCERTAIN");
    await waitState(world, value => value.pending[0]?.state === "uncertain" && target(value)?.title === "U", "uncertain intent retained without confirmation");
    assert.equal(count(world, "session-list.initial"), before);
    await button(world, "核实结果").click(); await until(() => count(world, "request.get") === 1, "not_found receipt verified"); await settle(world.page);
    assert.equal((await state(world.page)).pending[0].state, "uncertain"); assert.equal(count(world, "session-list.initial"), before);
    world.setTitle("C-verified"); world.verificationStatus = "committed"; await button(world, "核实结果").click();
    await until(() => world.pending("session-list.initial").length === 1, "verified committed receipt starts fence");
    await waitState(world, value => !value.pending.length && target(value)?.title === "U", "verified completion bridges until fresh acceptance");
    world.answer(world.pending("session-list.initial")[0]); await waitState(world, value => target(value)?.title === "C-verified", "fresh server wins verified bridge");
    assert.equal(count(world, "session.rename"), 3); assert.equal(count(world, "request.get"), 2);
  } },
  { name: "context-does-not-carry-bridge", run: async world => {
    await world.ready(); world.holdInitial = true; await world.rename("B"); world.setTitle("C-old"); world.answer(world.pending("session.rename")[0]);
    await until(() => world.pending("session-list.initial").length === 1, "old context postreceipt read held");
    const old = world.pending("session-list.initial")[0]; await waitState(world, value => !value.pending.length && target(value)?.title === "B", "old bridge visible");
    world.setTitle("Q-new"); await world.page.getByLabel("原始搜索", { exact: true }).fill(" Raw ");
    await until(() => world.pending("session-list.initial").length === 2, "new raw query read held");
    const waiting = await state(world.page); assert.equal(waiting.context.query, " Raw "); assert.deepEqual(waiting.top, []); assert.equal(waiting.acceptedEpoch, 0);
    assert.equal(world.pending("session-list.initial").at(-1)!.c.params?.query, " Raw ");
    world.answer(old); await settle(world.page); assert.deepEqual((await state(world.page)).top, []);
    world.answer(world.pending("session-list.initial")[0]);
    await waitState(world, value => target(value)?.title === "Q-new" && value.epoch === value.acceptedEpoch, "new query never inherits old B bridge");
    assert.ok(world.canceled(old));
  } },
];

try {
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const requested = process.env.AXIOM_LIST_PROJECTION_CASES?.split(",").filter(Boolean);
  const enabled = requested ? cases.filter(scenario => requested.includes(scenario.name)) : cases;
  assert.ok(enabled.length && (!requested || requested.length === enabled.length), "requested cases must exist");
  for (const scenario of enabled) {
    const page: Page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const world: World = new World(page); await world.install();
    try {
      await scenario.run(world); assert.deepEqual(errors, []); assert.deepEqual(world.unexpected, []);
      const snapshot = await state(page);
      assert.ok(snapshot.top.length <= 30 && snapshot.workspace.length <= 30 && snapshot.held.length <= 1);
      assert.equal(snapshot.state.loading, false); assert.equal(snapshot.epoch, snapshot.acceptedEpoch); assert.equal(snapshot.pending.length, 0);
      reports.push({ name: scenario.name, passed: true, snapshot, commands: world.commands, errors, unexpected: world.unexpected,
        commits: await page.evaluate(() => (window as any).projectionFrames) });
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      reports.push({ name: scenario.name, passed: false, error: String(error), snapshot: await state(page).catch(() => null),
        commands: world.commands, errors, unexpected: world.unexpected, commits: await page.evaluate(() => (window as any).projectionFrames).catch(() => null) });
      await page.screenshot({ path: join(artifacts, `${scenario.name}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(artifacts, `${scenario.name}.html`), await page.content().catch(() => "")); throw error;
    } finally { await page.close(); }
  }
  console.log(`PASS session-list-projection ${enabled.length} cases; artifacts ${artifacts}`);
} finally {
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
  await browser?.close(); await vite.close(); rmSync(temporary, { recursive: true, force: true });
}
