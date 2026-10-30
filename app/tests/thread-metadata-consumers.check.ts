// Real narrow consumers + transport, isolated Vite/mock WS. No backend or model.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type WebSocketRoute } from "playwright";
import { createServer } from "vite";
import { emptyAgent, emptyThread, type Selection, type ThreadMetadata } from "../src/shared/agent.js";
import { emptyCompressionPreferences } from "../src/shared/compression.js";
import type { Command } from "../src/shared/protocol.js";

type Mode = "compression" | "full" | "automatic" | "thinking" | "input";
type Held = { c: Command; socket: WebSocketRoute; data: unknown; error: boolean; answered: boolean; canceled: boolean };
const temporary = mkdtempSync(join(tmpdir(), "axiom-thread-metadata-consumers-vite-"));
const artifacts = process.env.AXIOM_METADATA_CONSUMERS_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-thread-metadata-consumers-evidence-"));
mkdirSync(artifacts, { recursive: true });
const reports: unknown[] = [];
let vite: Awaited<ReturnType<typeof createServer>> | undefined, browser: Browser | undefined, origin = "";
const until = async (predicate: () => unknown | Promise<unknown>, description: string) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail(description);
};
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const fullText = (marker: string) => `stable-preview ${marker.padEnd(200 - "stable-preview ".length, "x")}`;
const partText = (mode: Mode, marker: string) => mode === "input"
  ? JSON.stringify({ message: marker.padEnd(200 - JSON.stringify({ message: "" }).length, "x") })
  : `thinking-prefix ${marker.padEnd(200 - "thinking-prefix ".length, "x")}`;
const styles = `const s=new Map();export function updateStyle(id,text){let n=s.get(id);if(!n){n=document.createElement('style');document.head.append(n);s.set(id,n)}n.textContent=text}export function removeStyle(id){s.get(id)?.remove();s.delete(id)}export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}export const injectQuery=u=>u;`;
class World {
  readonly commands: Command[] = [];
  readonly errors: string[] = [];
  readonly unexpected: string[] = [];
  readonly frames: { scope: string; socket: number; data: unknown }[] = [];
  readonly sockets: WebSocketRoute[] = [];
  readonly active = new Map<WebSocketRoute, Set<string>>();
  readonly held: Held[] = [];
  readonly facts = new Map<string, ThreadMetadata>([["a", { contextRevision: 0, hasMessages: true }], ["b", { contextRevision: 0, hasMessages: true }]]);
  readonly markers = new Map([["a", "FIRST-AAAA"], ["b", "FIRST-BBBB"]]);
  selection: Selection | null = { provider: "fixture", id: "fixture", thinking: "off" };
  holdMeta = false;
  failMeta = false;
  holdReads = false;
  failReads = false;
  readyReached = false;
  closing = false;
  seq = 0;
  constructor(readonly page: Page, readonly mode: Mode) {}
  get socket() { return this.sockets.at(-1)!; }
  count(op: string) { return this.commands.filter(c => c.op === op).length; }
  send(socket: WebSocketRoute, value: unknown) {
    try { socket.send(JSON.stringify(value)); return true; }
    catch (error) { if (!this.closing) this.unexpected.push(`send:${String(error)}`); return false; }
  }
  receipt(socket: WebSocketRoute, c: Command, data: unknown, error = false) {
    this.send(socket, error ? { type: "receipt", requestId: c.requestId, ok: false, error: { code: "FIXTURE_READ_ERROR", message: "定向详情读取失败" } }
      : { type: "receipt", requestId: c.requestId, ok: true, data });
  }
  data(scope: string): unknown {
    const [kind, , sessionId] = scope.split(":");
    if (kind === "thread-meta") return this.facts.get(sessionId);
    // Deliberately acknowledge legacy subscriptions for an initialized business red,
    // but never derive metadata from them or furnish transcript bodies.
    if (kind === "thread") return emptyThread;
    if (kind === "messages") return [];
    if (kind === "agent") return { ...emptyAgent, selection: this.selection };
    if (kind === "session") return { id: sessionId, workspaceId: "w", title: `Fixture ${sessionId}`, pinned: false, unread: false, updatedAt: 1, messageCount: 0 };
    if (kind === "compression") return null;
    if (scope === "configuration") return { revision: "fixture", providerCount: 1, modelCount: 1, dataRoot: "/synthetic",
      available: [{ provider: "fixture", id: "fixture", name: "Fixture", levels: ["off"] }] };
    if (scope === "compression-preferences") return emptyCompressionPreferences;
    this.unexpected.push(`scope:${scope}`); return null;
  }
  snapshot(scope: string, data = this.data(scope), socket = this.socket) {
    this.frames.push({ scope, data, socket: this.sockets.indexOf(socket) });
    this.send(socket, { type: "snapshot", streamId: "metadata-consumers", scope, seq: ++this.seq, data });
  }
  meta(revision: number, hasMessages: boolean | null = true, error?: string, sessionId = "a") {
    const data: ThreadMetadata = { contextRevision: revision, hasMessages, ...(error ? { error } : {}) };
    this.facts.set(sessionId, data); this.snapshot(`thread-meta:w:${sessionId}`, data);
  }
  answer(held: Held) { held.answered = true; this.receipt(held.socket, held.c, held.data, held.error); }
  async install() {
    this.page.setDefaultTimeout(10000);
    this.page.on("pageerror", error => this.errors.push(error.stack ?? error.message));
    await this.page.addInitScript("globalThis.__name = value => value;");
    await this.page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { this.unexpected.push(`external:${url.href}`); return route.abort(); }
      if (url.pathname === "/__thread_metadata_consumers") return route.fulfill({ contentType: "text/html", body:
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/thread-metadata-consumers.tsx"></script></body></html>' });
      if (url.pathname === "/@vite/client") return route.fulfill({ contentType: "application/javascript", body: styles });
      if (url.pathname === "/api/status") return route.fulfill({ json: { ok: true } });
      if (url.pathname.startsWith("/api/")) { this.unexpected.push(`api:${url.pathname}`); return route.abort(); }
      return route.continue();
    });
    await this.page.routeWebSocket("**/*", socket => {
      const url = new URL(socket.url());
      if (url.pathname !== "/ws" || url.host !== new URL(origin).host) { this.unexpected.push(`socket:${url.href}`); socket.close(); return; }
      this.sockets.push(socket); const subscriptions = new Set<string>(); this.active.set(socket, subscriptions);
      this.send(socket, { type: "hello", streamId: "metadata-consumers" });
      socket.onMessage(raw => {
        const c = JSON.parse(String(raw)) as Command; this.commands.push(c);
        const scope = String(c.params?.scope ?? "");
        if (c.op === "subscribe") {
          subscriptions.add(scope);
          if (scope.startsWith("thread-meta:") && this.failMeta) { this.receipt(socket, c, null, true); return; }
          if (!scope.startsWith("thread-meta:") || !this.holdMeta) this.snapshot(scope, this.data(scope), socket);
          this.receipt(socket, c, {}); return;
        }
        if (c.op === "unsubscribe") { subscriptions.delete(scope); this.receipt(socket, c, {}); return; }
        if (c.op === "read.cancel") { const held = this.held.find(h => h.c.requestId === c.params?.requestId); if (held) held.canceled = true; this.receipt(socket, c, {}); return; }
        if (c.op === "ping") { this.receipt(socket, c, {}); return; }
        if (c.op === "compression.start" || c.op === "compression.cancel") { this.receipt(socket, c, { accepted: true }); return; }
        if (c.op === "message.get" || c.op === "message.part") {
          const marker = this.markers.get(c.sessionId!)!, text = c.op === "message.get" ? fullText(marker) : partText(this.mode, marker);
          const data = c.op === "message.get" ? { id: "same-id", role: "assistant", text, textLength: text.length }
            : { text, totalLength: text.length, revision: marker };
          if (this.holdReads) this.held.push({ c, socket, data, error: this.failReads, answered: false, canceled: false });
          else this.receipt(socket, c, data, this.failReads);
          return;
        }
        this.unexpected.push(`op:${c.op}`); this.receipt(socket, c, null, true);
      });
    });
  }
  async ready() {
    await this.page.goto(`${origin}/__thread_metadata_consumers?mode=${this.mode}`);
    await this.page.locator("#consumer-mounted").waitFor();
    await until(() => this.commands.some(c => c.op === "subscribe" && /^(thread|thread-meta):/.test(String(c.params?.scope))), "consumer subscription was initialized");
    await settle(this.page); this.readyReached = true;
    assert.deepEqual(this.errors, [], "entry initialization"); assert.deepEqual(this.unexpected, [], "fixture prerequisites");
  }
  noFullBody() {
    const scopes = this.commands.filter(c => c.op === "subscribe").map(c => String(c.params?.scope));
    assert.deepEqual(scopes.filter(scope => /^(thread|messages):/.test(scope)), [], "independent consumers must not subscribe full context");
    assert.ok(scopes.some(scope => scope.startsWith("thread-meta:")), "the real consumer must subscribe metadata");
  }
  async openCompression() { await this.page.getByRole("button", { name: "打开后台压缩", exact: true }).click(); await this.page.getByRole("dialog", { name: "后台压缩", exact: true }).waitFor(); }
  start() { return this.page.getByRole("button", { name: "开始压缩", exact: true }); }
  async enabled(value: boolean) { await until(async () => (await this.start().isEnabled()) === value, `compression start enabled=${value}`); }
  load() { return this.page.getByRole("button", { name: "读取全文", exact: true }).click(); }
  async text(marker: string) { await until(async () => (await this.page.locator("#full-text").textContent())?.includes(marker), `full text ${marker}`); }
  async blank() { await until(async () => await this.page.locator("#full-text").textContent() === "", "obsolete full text hidden"); }
  async generation() { return JSON.parse((await this.page.locator("#connection").textContent())!).generation as number; }
  async reconnect() { const before = await this.generation(), previous = this.sockets.length; this.socket.close(); await until(async () => this.sockets.length > previous && await this.generation() > before, "actual replacement socket/generation"); await settle(this.page); }
}
const cases: { name: string; mode: Mode; setup?: (world: World) => void; run(world: World): Promise<void> }[] = [
  { name: "compression-states", mode: "compression", setup: f => { f.holdMeta = true; }, run: async f => {
    await f.ready(); f.noFullBody(); await f.openCompression(); await f.enabled(false);
    assert.equal(await f.page.getByText("此会话尚无消息可压缩。", { exact: true }).count(), 0, "missing fact is not confirmed empty");
    for (const error of [undefined, "source unavailable"]) { f.meta(0, null, error); await settle(f.page); await f.enabled(false); assert.equal(await f.page.getByText("此会话尚无消息可压缩。", { exact: true }).count(), 0); }
    f.meta(0, false); await f.page.getByText("此会话尚无消息可压缩。", { exact: true }).waitFor(); await f.enabled(false);
    assert.equal(f.count("compression.start"), 0, "opening and unavailable metadata never start");
    f.meta(0, true); await f.enabled(true); await f.start().click(); await until(() => f.count("compression.start") === 1, "one inert intercepted start");
    const sent = f.commands.find(c => c.op === "compression.start")!; assert.equal(sent.workspaceId, "w"); assert.equal(sent.sessionId, "a"); assert.match(sent.requestId, /^[0-9a-f-]{36}$/i);
    f.meta(0, true, "defensive source error"); await f.enabled(false); f.meta(0, true); await f.enabled(true);
    await f.page.getByRole("button", { name: "关闭压缩详情，返回会话" }).click();
    await f.page.getByRole("button", { name: "挂载切换", exact: true }).click(); await f.page.locator("#consumer-mounted").waitFor({ state: "detached" });
    f.failMeta = true; await f.page.getByRole("button", { name: "挂载切换", exact: true }).click(); await f.page.locator("#consumer-mounted").waitFor();
    await f.openCompression(); await f.enabled(false);
    f.failMeta = false; f.holdMeta = false; await f.reconnect(); await f.enabled(true); assert.equal(f.count("compression.start"), 1);
  } },
  { name: "compression-cache-and-guards", mode: "compression", run: async f => {
    await f.ready(); f.noFullBody(); await f.openCompression(); await f.enabled(true);
    f.selection = null; f.snapshot("agent:w:a"); await f.enabled(false); await f.page.getByText("请先为当前会话选择模型。", { exact: true }).waitFor();
    f.selection = { provider: "fixture", id: "fixture", thinking: "off" }; f.snapshot("agent:w:a"); await f.enabled(true);
    f.holdMeta = true; const old = await f.generation(); f.socket.close();
    await f.page.getByText("尚未连接本地服务，请连接后操作。", { exact: true }).waitFor(); await f.enabled(false);
    await until(async () => await f.generation() > old, "reconnected generation"); await settle(f.page); await f.enabled(true);
    assert.equal(f.frames.filter(frame => frame.socket === f.sockets.length - 1 && frame.scope === "thread-meta:w:a").length, 0, "warm behavior is preserved, not claimed fresh authority");
    f.meta(0, null, "unavailable"); await f.enabled(false); f.meta(0, true); await f.enabled(true);
    assert.equal(f.count("compression.start"), 0);
  } },
  { name: "full-revision-and-retry", mode: "full", run: async f => {
    await f.ready(); f.noFullBody(); assert.equal(f.count("message.get"), 0, "manual is lazy");
    await f.load(); await f.text("FIRST-AAAA"); const count = f.count("message.get");
    f.meta(0, null, "presence unavailable"); await settle(f.page); await f.text("FIRST-AAAA"); assert.equal(f.count("message.get"), count);
    f.markers.set("a", "EDIT--AAAA"); assert.equal(fullText("FIRST-AAAA").length, fullText("EDIT--AAAA").length);
    f.meta(1); await f.blank(); assert.equal(f.count("message.get"), count, "revision invalidation remains manual");
    await f.load(); await f.text("EDIT--AAAA"); f.meta(1); await settle(f.page); assert.equal(f.count("message.get"), count + 1);
    f.meta(2); await f.blank(); f.failReads = true; await f.load(); await f.page.getByRole("alert").filter({ hasText: "定向详情读取失败" }).waitFor();
    f.failReads = false; f.markers.set("a", "RETRY-AAAA"); await f.load(); await f.text("RETRY-AAAA"); assert.equal(await f.page.getByRole("alert").count(), 0);
  } },
  { name: "full-late-revision", mode: "full", run: async f => {
    await f.ready(); f.noFullBody();
    for (const [revision, error] of [[1, false], [3, true]] as const) {
      f.meta(revision); await settle(f.page); f.holdReads = true; f.failReads = error;
      await f.load(); await until(() => f.held.some(h => !h.answered && h.error === error), "held old revision request"); const held = f.held.at(-1)!;
      f.meta(revision + 1); await f.blank(); await until(() => held.canceled, "old read.cancel reached mock origin");
      f.holdReads = false; f.failReads = false; f.markers.set("a", `FRESH-${revision}AAA`); await f.load(); await f.text(`FRESH-${revision}AAA`);
      f.answer(held); await settle(f.page); await f.text(`FRESH-${revision}AAA`); assert.equal(await f.page.getByRole("alert").count(), 0);
    }
  } },
  { name: "full-session-and-generation", mode: "full", run: async f => {
    await f.ready(); f.noFullBody(); f.holdReads = true; await f.load(); await until(() => f.held.length === 1, "held session A"); const old = f.held[0];
    await f.page.getByRole("button", { name: "切换会话", exact: true }).click(); await until(async () => await f.page.locator("#scope").textContent() === "b", "same-ID session B");
    await until(() => old.canceled, "A read canceled"); f.holdReads = false; await f.load(); await f.text("FIRST-BBBB"); f.answer(old); await settle(f.page); await f.text("FIRST-BBBB");
    await f.page.getByRole("button", { name: "切换会话", exact: true }).click(); await f.blank(); await f.load(); await f.text("FIRST-AAAA"); const count = f.count("message.get");
    f.holdMeta = true; await f.reconnect(); await f.blank(); assert.equal(f.count("message.get"), count, "generation invalidation remains manual");
    f.markers.set("a", "NEWGENAAAA"); await f.load(); await f.text("NEWGENAAAA"); assert.equal(f.count("message.get"), count + 1, "new generation cannot reuse ready detail cache");
  } },
  { name: "full-automatic", mode: "automatic", run: async f => {
    await f.ready(); f.noFullBody(); await f.text("FIRST-AAAA"); const count = f.count("message.get");
    f.markers.set("a", "AUTO--AAAA"); f.meta(1); await f.text("AUTO--AAAA"); assert.equal(f.count("message.get"), count + 1);
    f.meta(1, null, "unavailable"); await settle(f.page); assert.equal(f.count("message.get"), count + 1);
  } },
  ...(["thinking", "input"] as const).map(mode => ({ name: `part-${mode}-revision`, mode, run: async (f: World) => {
    await f.ready(); f.noFullBody(); const body = f.page.locator("#part-text");
    await until(async () => (await body.textContent())?.includes("FIRST-AAAA"), "initial automatic hidden field"); const count = f.count("message.part");
    f.markers.set("a", "PART--AAAA"); f.meta(1); await until(async () => (await body.textContent())?.includes("PART--AAAA"), "same-length hidden field refresh");
    assert.equal(f.count("message.part"), count + 1); f.meta(1); await settle(f.page); assert.equal(f.count("message.part"), count + 1);
    f.holdReads = true; f.meta(2); await until(() => f.held.length > 0, "held hidden field"); const held = f.held.at(-1)!;
    f.holdReads = false; f.markers.set("a", "LATESTAAAA"); f.meta(3); await until(async () => (await body.textContent())?.includes("LATESTAAAA"), "new field identity wins");
    await until(() => held.canceled, "obsolete field read canceled"); f.answer(held); await settle(f.page);
    assert.ok((await body.textContent())?.includes("LATESTAAAA")); assert.equal(f.count("message.get"), 0, "field reader stays narrow");
  } })),
];
try {
  const selected = process.env.AXIOM_METADATA_CONSUMERS_CASES?.split(",");
  if (selected) for (const name of selected) assert.ok(cases.some(value => value.name === name), `unknown case ${name}`);
  vite = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "cache"),
    server: { host: "127.0.0.1", port: 0, hmr: false, ws: false }, esbuild: { jsx: "automatic" } });
  await vite.listen(); origin = new URL(vite.resolvedUrls!.local[0]).origin;
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  for (const test of cases.filter(value => !selected || selected.includes(value.name))) {
    const directory = join(artifacts, test.name); mkdirSync(directory, { recursive: true });
    const context: BrowserContext = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page: Page = await context.newPage(), world: World = new World(page, test.mode); test.setup?.(world);
    let failure: string | undefined;
    try { await world.install(); await test.run(world); world.noFullBody(); assert.deepEqual(world.errors, []); assert.deepEqual(world.unexpected, []); console.log(`PASS ${test.name}`); }
    catch (cause) { failure = (cause as Error).stack ?? String(cause); await page.screenshot({ path: join(directory, "failure.png") }).catch(() => {}); writeFileSync(join(directory, "failure.html"), await page.content().catch(() => "")); throw cause; }
    finally {
      const report = { name: test.name, mode: test.mode, readyReached: world.readyReached, failure, errors: world.errors, unexpected: world.unexpected,
        commands: world.commands, frames: world.frames, held: world.held.map(({ c, error, answered, canceled }) => ({ c, error, answered, canceled })) };
      reports.push(report); writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2)); world.closing = true; await context.close();
    }
  }
} finally {
  try { await browser?.close(); }
  finally { try { await vite?.close(); } finally { rmSync(temporary, { recursive: true, force: true }); writeFileSync(join(artifacts, "report.json"), JSON.stringify({ temporary, reports }, null, 2)); } }
}
