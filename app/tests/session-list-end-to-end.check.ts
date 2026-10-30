// Real SQLite -> backend WS -> production transport/main.tsx -> Workbench.
// Synthetic data only; no World, business-frame interception, models or user backend.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mock } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import WebSocket from "ws";
import { displayTypography } from "../scripts/display-typography.js";
import { startServer } from "../src/server/index.js";
import { RemoteAccess } from "../src/server/remote-access.js";
import type { Command, Scope, Workspace } from "../src/shared/protocol.js";
import type { SessionListInitial, SessionListPage } from "../src/shared/session-list.js";

type Frame = { type: string; requestId?: string; ok?: boolean; data?: any; scope?: string; seq?: number; error?: unknown };
type Event = { index: number; at: number; direction: "sent" | "received"; frame: Frame & Partial<Command> };
type NativeIO = { readFileSync: number; openSync: number };
const appRoot = resolve(".");
assert.ok(existsSync(join(appRoot, "src/client/main.tsx")), "run this check from app/");
const artifacts = process.env.AXIOM_LIST_E2E_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-list-e2e-evidence-"));
mkdirSync(artifacts, { recursive: true });
const previousEnvironment = { pi: process.env.AXIOM_PI_DIR, node: process.env.NODE_ENV,
  vite: Object.entries(process.env).filter(([key]) => key.startsWith("VITE_")) };
process.env.NODE_ENV = "development";
for (const [key] of previousEnvironment.vite) delete process.env[key];
// Peripheral isolation only: initialize otherwise listens on real Tailscale IPs.
// The constructor has no listener; real close() safely handles this empty state.
const remote = mock.method(RemoteAccess.prototype, "initialize", async () => {});
const group = (page: Page, top = false) => page.getByRole("region", { name: top ? "置顶会话" : "当前空间对话", exact: true });
const rows = (page: Page, top = false) => group(page, top).locator(".history-row[data-session-id]:not([hidden])");
const row = (page: Page, id: string) => page.locator(`#history .history-row[data-session-id="${id}"]`);
const paging = (page: Page, top: boolean, direction: "下一页" | "上一页") => page.getByRole("button", {
  name: `${top ? "置顶会话" : "当前空间对话"}：${direction}`, exact: true,
});
const selected = (page: Page): Promise<Scope> => page.evaluate(() => JSON.parse(sessionStorage.getItem("view") ?? "null"));
const ids = (page: Page, top = false) => rows(page, top).evaluateAll(elements => elements.map(el => el.getAttribute("data-session-id")));
async function until(check: () => unknown | Promise<unknown>, message: string, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
  assert.fail(message);
}
const waitIds = (page: Page, expected: string[], top = false) => page.waitForFunction(({ expected, top }) => {
  const actual = [...document.querySelectorAll<HTMLElement>(`#history section[aria-label="${top ? "置顶会话" : "当前空间对话"}"] .history-row[data-session-id]`)]
    .filter(el => !el.hidden).map(el => el.dataset.sessionId);
  return JSON.stringify(actual) === JSON.stringify(expected);
}, { expected, top }, { timeout: 12000 });

class Fixture {
  readonly root = mkdtempSync(join(tmpdir(), "axiom-list-e2e-"));
  readonly events: Event[] = [];
  readonly auxiliary: unknown[] = [];
  readonly errors: string[] = [];
  readonly diagnostics: unknown[] = [];
  readonly failedRequests: unknown[] = [];
  readonly httpLifecycle: unknown[] = [];
  readonly externalRequests: string[] = [];
  readonly proxyHandshakes: unknown[] = [];
  readonly native = new Map<string, NativeIO>();
  readonly cleanupErrors: string[] = [];
  readonly sockets = new Set<WebSocket>();
  readonly restores: (() => void)[] = [];
  readonly facts: Record<string, unknown> = {};
  app?: Awaited<ReturnType<typeof startServer>>;
  vite?: ViteDevServer;
  context?: BrowserContext;
  page?: Page;
  main!: Workspace;
  foreign!: Workspace;
  updateFetches = 0;
  closing = false;
  parserCalls = () => 0;
  countCalls = () => [] as unknown[];
  constructor(readonly name: string) { mkdirSync(join(artifacts, name), { recursive: true }); }
  get commands() { return this.events.filter(event => event.direction === "sent" && event.frame.op); }
  response(requestId?: string) { return this.events.find(event => event.direction === "received" && event.frame.type === "receipt" && event.frame.requestId === requestId); }
  snapshot(scope: string) { return this.events.filter(event => event.direction === "received" && event.frame.type === "snapshot" && event.frame.scope === scope); }
  async start() {
    const pi = join(this.root, "pi"); mkdirSync(pi); mkdirSync(join(this.root, "empty-env"));
    writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {} })); writeFileSync(join(pi, "auth.json"), "{}");
    process.env.AXIOM_PI_DIR = pi;
    const remoteBefore = remote.mock.callCount();
    this.app = await startServer({ root: join(this.root, "data"), port: 0,
      backendUpdates: { initialDelayMs: 3_600_000, fetcher: async () => { this.updateFetches++; throw Error("external update fetching is disabled in this fixture"); } } });
    assert.equal(remote.mock.callCount() - remoteBefore, 1);
    for (const name of ["main", "foreign"] as const) {
      const path = join(this.root, name); mkdirSync(path);
      this[name] = this.app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
    }
  }
  add(title: string, options: { owner?: Workspace; updatedAt?: number; pinned?: boolean; parent?: string } = {}) {
    const id = randomUUID(), owner = options.owner ?? this.main;
    this.app!.store.db.prepare("INSERT INTO sessions(id,workspaceId,title,pinned,updatedAt,forkParentSessionId) VALUES(?,?,?,?,?,?)")
      .run(id, owner.id, title, Number(options.pinned ?? false), options.updatedAt ?? 1, options.parent ?? null);
    return id;
  }
  source(id: string, owner = this.main) {
    const manager = SessionManager.create(owner.path, join(this.root, `native-${owner.id}`));
    manager.appendMessage({ role: "user", content: `Synthetic cold question ${id}`, timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: `Synthetic cold answer ${id}` }],
      api: "openai-completions", provider: "synthetic", model: "synthetic-model", stopReason: "stop", timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const file = manager.getSessionFile(); assert.ok(file && existsSync(file));
    this.app!.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(id, file);
    this.native.set(file, { readFileSync: 0, openSync: 0 });
    const sources = (this.facts.nativeSources ??= []) as unknown[];
    sources.push({ sessionId: id, workspaceId: owner.id, cwd: owner.path, file });
    return file;
  }
  observeIO() {
    const originalRead = fs.readFileSync, originalOpen = fs.openSync;
    const reads = mock.method(fs, "readFileSync", (...args: Parameters<typeof originalRead>) => {
      const target = this.native.get(String(args[0])); if (target) target.readFileSync++;
      return Reflect.apply(originalRead, fs, args);
    });
    const opens = mock.method(fs, "openSync", (...args: Parameters<typeof originalOpen>) => {
      const target = this.native.get(String(args[0])); if (target) target.openSync++;
      return Reflect.apply(originalOpen, fs, args);
    });
    const parsers = mock.method(SessionManager, "inMemory"), counts = mock.method(this.app!.agents, "messageCount");
    this.parserCalls = () => parsers.mock.callCount();
    this.countCalls = () => counts.mock.calls.map(call => ({ scope: call.arguments[0], options: call.arguments[1] }));
    syncBuiltinESMExports();
    this.restores.push(() => { counts.mock.restore(); parsers.mock.restore(); opens.mock.restore(); reads.mock.restore(); syncBuiltinESMExports(); });
  }
  assertCold() {
    assert.ok(this.native.size > 0, "cold IO assertion has real fixture files");
    for (const [file, io] of this.native) assert.deepEqual(io, { readFileSync: 0, openSync: 0 }, `unopened title source must stay cold: ${file}`);
    this.facts.cold = { io: structuredClone(Object.fromEntries(this.native)), parserCalls: this.parserCalls(), countCalls: this.countCalls() };
  }
  async open(browser: Browser, viewer: string) {
    const view = { workspaceId: this.main.id, sessionId: viewer };
    this.app!.store.execute({ requestId: randomUUID(), op: "workspace.select", workspaceId: this.main.id, params: { view } });
    const target = this.app!.origin;
    this.vite = await createServer({ configFile: false, root: join(appRoot, "src/client"), cacheDir: join(this.root, "vite-cache"),
      envDir: join(this.root, "empty-env"), css: { postcss: { plugins: [displayTypography()] } }, esbuild: { jsx: "automatic" },
      server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [appRoot] }, proxy: {
        "^/ws$": { target, ws: true, changeOrigin: true, rewriteWsOrigin: true, configure: proxy => {
          proxy.on("proxyReqWs", request => request.once("finish", () => this.proxyHandshakes.push({ host: request.getHeader("host"), origin: request.getHeader("origin") })));
        } },
        "/api": { target, changeOrigin: true, configure: proxy => { proxy.on("proxyReq", request => { if (request.hasHeader("origin")) request.setHeader("origin", target); }); } },
      } } });
    await this.vite.listen();
    assert.equal(this.vite.config.cacheDir, join(this.root, "vite-cache"));
    const address = this.vite.httpServer!.address(); assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    this.facts.environment = { backend: target, frontend: origin, cacheDir: this.vite.config.cacheDir, root: this.vite.config.root,
      pi: process.env.AXIOM_PI_DIR, remoteAccessInitialize: "peripheral no-op", updateNetwork: "injected local fetcher and long delay" };
    this.context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    // Abort, never fulfill, an unexpected non-loopback browser HTTP request.
    await this.context.route("**/*", route => {
      if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
      this.externalRequests.push(route.request().url()); return route.abort("blockedbyclient");
    });
    await this.context.addInitScript(view => {
      sessionStorage.setItem("view", JSON.stringify(view)); sessionStorage.setItem("sidebarWorkspaceId", view.workspaceId);
    }, view);
    this.page = await this.context.newPage();
    this.page.on("pageerror", error => this.errors.push(error.message));
    this.page.on("console", message => { if (["error", "warning"].includes(message.type())) this.diagnostics.push({ type: message.type(), text: message.text() }); });
    const probeIds = new WeakMap<object, number>(); let nextProbeId = 0;
    const probe = (event: string, request: { url(): string }, extra: Record<string, unknown> = {}) => {
      if (new URL(request.url()).pathname !== "/api/status") return;
      if (!probeIds.has(request)) probeIds.set(request, nextProbeId++);
      this.httpLifecycle.push({ event, id: probeIds.get(request), at: Date.now(), url: request.url(), ...extra });
    };
    this.page.on("framenavigated", frame => { if (frame === this.page!.mainFrame()) this.httpLifecycle.push({ event: "navigation", at: Date.now(), url: frame.url() }); });
    this.page.on("request", request => probe("request", request));
    this.page.on("response", response => probe("response", response.request(), { status: response.status() }));
    this.page.on("requestfinished", request => probe("finished", request));
    this.page.on("requestfailed", request => {
      probe("failed", request, { failure: request.failure(), closing: this.closing });
      if (!this.closing) this.failedRequests.push({ url: request.url(), failure: request.failure() });
    });
    this.page.on("websocket", socket => {
      if (new URL(socket.url()).pathname !== "/ws") return;
      const record = (direction: "sent" | "received", data: { payload: string | Buffer }) => {
        try { this.events.push({ index: this.events.length, at: Date.now(), direction, frame: JSON.parse(String(data.payload)) }); }
        catch (error) { this.errors.push(`invalid WS JSON: ${String(error)}`); }
      };
      socket.on("framesent", data => record("sent", data)); socket.on("framereceived", data => record("received", data));
      socket.on("socketerror", error => this.errors.push(`WS: ${error}`));
    });
    await this.page.goto(origin);
    await this.page.locator("#new-chat").waitFor(); await group(this.page, true).waitFor();
    await this.initial("");
    await until(() => this.snapshot(`session:${view.workspaceId}:${view.sessionId}`).some(event => event.frame.data?.id === viewer), "server delivers selected summary");
  }
  async initial(query: string, after = -1) {
    await until(() => this.commands.some(event => event.index > after && event.frame.op === "session-list.initial" && event.frame.params?.query === query && this.response(event.frame.requestId)?.frame.ok), `successful real initial for raw query ${JSON.stringify(query)}`);
    const request = this.commands.filter(event => event.index > after && event.frame.op === "session-list.initial" && event.frame.params?.query === query && this.response(event.frame.requestId)?.frame.ok).at(-1)!;
    return { request, response: this.response(request.frame.requestId)!, data: this.response(request.frame.requestId)!.frame.data as SessionListInitial };
  }
  async search(query: string) { const after = this.events.length - 1; await this.page!.getByRole("searchbox").fill(query); return this.initial(query, after); }
  async externalDelete(sessionId: string) {
    const ws = new WebSocket(`${this.app!.origin.replace("http:", "ws:")}/ws`, { origin: this.app!.origin }); this.sockets.add(ws);
    const command: Command = { requestId: randomUUID(), op: "session.delete", workspaceId: this.main.id, sessionId, params: { confirmed: true } };
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("external real WS open timed out")), 12000);
        ws.once("open", () => { clearTimeout(timer); resolve(); });
        ws.once("error", error => { clearTimeout(timer); reject(error); });
        ws.once("close", () => { clearTimeout(timer); reject(Error("external WS closed before open")); });
      });
      return await new Promise<Frame>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("external real delete receipt timed out")), 12000);
        ws.on("message", data => {
          const frame = JSON.parse(String(data)) as Frame; this.auxiliary.push({ direction: "received", frame });
          if (frame.type === "receipt" && frame.requestId === command.requestId) { clearTimeout(timer); resolve(frame); }
        });
        ws.once("error", error => { clearTimeout(timer); reject(error); });
        ws.once("close", () => { clearTimeout(timer); reject(Error("external WS closed before receipt")); });
        this.auxiliary.push({ direction: "sent", frame: command }); ws.send(JSON.stringify(command));
      });
    } finally { ws.terminate(); this.sockets.delete(ws); }
  }
  async verify() {
    assert.deepEqual(this.errors, []); assert.deepEqual(this.failedRequests, []); assert.deepEqual(this.externalRequests, []);
    assert.equal(this.updateFetches, 0);
    assert.deepEqual(this.commands.filter(event => event.frame.op === "subscribe" &&
      (event.frame.params?.scope === "pinned-sessions" || String(event.frame.params?.scope).startsWith("sessions:"))), [], "no legacy full-list browser subscription");
    assert.deepEqual(this.commands.filter(event => /^(prompt|agent\.(prompt|run|resume)|compression\.start|memory\.run|task\.append)$/.test(event.frame.op!)), []);
    assert.equal(this.app!.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
    assert.equal(this.app!.store.db.prepare("SELECT count(*) AS n FROM tasks").get()!.n, 0);
    assert.ok(this.proxyHandshakes.length > 0, "real browser WS handshake recorded");
    for (const handshake of this.proxyHandshakes as { host: string; origin: string }[]) assert.deepEqual(handshake, { host: new URL(this.app!.origin).host, origin: this.app!.origin });
  }
  async close() {
    this.closing = true;
    const clean = async (action: () => unknown) => { try { await action(); } catch (error) { this.cleanupErrors.push(String(error)); } };
    await clean(() => this.context?.close()); await clean(() => this.vite?.close());
    for (const ws of this.sockets) ws.terminate(); this.sockets.clear();
    await clean(() => this.app?.close());
    for (const restore of this.restores.reverse()) await clean(restore);
    if (!this.cleanupErrors.length) await clean(() => rmSync(this.root, { recursive: true, force: true }));
  }
  save(passed: boolean, failure?: unknown) {
    const directory = join(artifacts, this.name);
    writeFileSync(join(directory, "ws.json"), JSON.stringify({ browser: this.events, auxiliary: this.auxiliary }, null, 2));
    const report = { name: this.name, passed, failure: failure ? String(failure) : undefined, facts: this.facts,
      errors: this.errors, diagnostics: this.diagnostics, failedRequests: this.failedRequests, httpLifecycle: this.httpLifecycle, externalRequests: this.externalRequests,
      proxyHandshakes: this.proxyHandshakes, updateFetches: this.updateFetches, nativeIO: Object.fromEntries(this.native),
      parserCalls: this.parserCalls(), commandCount: this.commands.length, cleanupErrors: this.cleanupErrors };
    writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2));
    return report;
  }
}

const cases: { name: string; run(f: Fixture, browser: Browser): Promise<void> }[] = [
  { name: "family-pages-search-and-cold-body", run: async (f, browser) => {
    const viewer = f.add("Independent viewer"), root = f.add("Family root", { updatedAt: 100 });
    const children = Array.from({ length: 30 }, (_, i) => f.add(i === 0 ? "Family Alpha" : i === 1 ? "Family Alpha middle" : `Family child ${i}`,
      { updatedAt: 2000 - i, parent: root, pinned: i === 29 }));
    const ordinary = Array.from({ length: 31 }, (_, i) => f.add(`Ordinary ${i}`, { updatedAt: 500 - i }));
    const foreign = f.add("Foreign pinned parent", { owner: f.foreign, pinned: true, updatedAt: 50 });
    const excluded = f.add("Foreign ordinary child", { owner: f.foreign, parent: foreign, updatedAt: 4000 });
    // Root-first DFS; the entire top family's siblings use fixed ordering anchors.
    const family = [root, ...children], tail = children[29];
    const openedFile = f.source(children[0]); f.source(root); f.source(foreign, f.foreign); f.observeIO();
    f.facts.seed = { viewer, root, children, ordinary, foreign, excluded, main: f.main, foreignWorkspace: f.foreign };
    await f.open(browser, viewer); const page = f.page!;
    await waitIds(page, family.slice(0, 30), true); await waitIds(page, ordinary.slice(0, 30));
    assert.ok(!(await ids(page)).includes(viewer), "selected viewer really starts outside the first ordinary page");
    assert.equal(f.commands.filter(event => event.frame.op === "session-list.first").length, 0);
    await paging(page, true, "下一页").click(); await waitIds(page, [tail, foreign], true);
    assert.deepEqual(await ids(page), ordinary.slice(0, 30), "top paging does not change the ordinary page");
    await paging(page, false, "下一页").click(); await waitIds(page, [ordinary[30], viewer]);
    assert.deepEqual(await ids(page, true), [tail, foreign], "ordinary paging does not change the top page");
    await f.search("Family"); await waitIds(page, family.slice(0, 30), true); await waitIds(page, []);
    await paging(page, true, "下一页").click(); await waitIds(page, [tail], true);
    const lastPageRead = f.commands.filter(event => event.frame.op === "session-list.page" && event.frame.params?.query === "Family").at(-1)!;
    const lastPage = f.response(lastPageRead.frame.requestId)!.frame.data as SessionListPage;
    assert.equal(lastPage.items[0].familyId, root); assert.equal(lastPage.items[0].familyTop, true); assert.equal(lastPage.next, null);
    assert.equal(await row(page, tail).getAttribute("data-family-id"), root);
    assert.equal(await row(page, tail).getAttribute("data-family-top"), "true");
    assert.equal(await row(page, root).count(), 0, "page two does not need a locally mounted family root");
    assert.equal(await paging(page, true, "下一页").isDisabled(), true);
    const narrow = await f.search(" Alpha "); await waitIds(page, [], true); await waitIds(page, [children[1]]);
    assert.equal(narrow.request.frame.params?.query, " Alpha ");
    await f.search("Alpha"); await waitIds(page, [], true); await waitIds(page, [children[0], children[1]]);
    assert.deepEqual(await selected(page), { workspaceId: f.main.id, sessionId: viewer });
    assert.equal(f.commands.filter(event => event.frame.op === "session-list.first").length, 0);
    const allTitleItems = f.events.filter(event => event.direction === "received" && event.frame.type === "receipt" && event.frame.ok)
      .flatMap(event => event.frame.data?.items ?? [...(event.frame.data?.top?.items ?? []), ...(event.frame.data?.workspace?.items ?? [])]);
    assert.ok(!allTitleItems.some(item => item.id === excluded), "foreign ordinary child never enters the real SQL candidate pool");
    f.assertCold(); const coldParsers = f.parserCalls();
    await row(page, children[0]).locator("button.history-item").click();
    await page.getByText(`Synthetic cold answer ${children[0]}`, { exact: true }).waitFor();
    await until(() => (f.native.get(openedFile)?.readFileSync ?? 0) > 0, "positive control really reads the opened native body");
    assert.ok(f.native.get(openedFile)!.openSync > 0, "positive control also exercises the header-open observer");
    assert.ok(f.parserCalls() > coldParsers);
    for (const [file, io] of f.native) if (file !== openedFile) assert.deepEqual(io, { readFileSync: 0, openSync: 0 });
    await until(async () => (await row(page, children[0]).locator(".session-message-count").textContent())?.includes("2 条消息"), "body warming updates the real title count");
    f.facts.familyOrder = family; f.facts.lastPage = lastPage; f.facts.finalView = await selected(page);
  } },
  { name: "foreign-rename-publication-and-receipt", run: async (f, browser) => {
    const viewer = f.add("Independent main viewer");
    const top = Array.from({ length: 31 }, (_, i) => f.add(`Foreign title A ${i}`, { owner: f.foreign, pinned: true, updatedAt: 2000 - i }));
    const target = top[29], renamed = "Foreign renamed B"; f.source(target, f.foreign); f.observeIO();
    f.facts.seed = { viewer, top, target, renamed, owner: f.foreign.id, sidebar: f.main.id };
    await f.open(browser, viewer); const page = f.page!;
    await waitIds(page, top.slice(0, 30), true); await waitIds(page, [viewer]);
    const before = (await f.initial("")).data.revision, oldUpdatedAt = f.app!.store.session(f.foreign.id, target).updatedAt;
    await row(page, target).locator("button.history-item").focus(); await row(page, target).locator("button.history-item").press("F2");
    await row(page, target).getByRole("textbox").fill(renamed); await row(page, target).getByRole("textbox").press("Enter");
    await until(() => f.commands.some(event => event.frame.op === "session.rename" && f.response(event.frame.requestId)?.frame.ok), "real rename commits and returns its receipt");
    const write = f.commands.find(event => event.frame.op === "session.rename")!, receipt = f.response(write.frame.requestId)!;
    assert.equal(write.frame.workspaceId, f.foreign.id); assert.equal(write.frame.sessionId, target);
    const saved = f.app!.store.session(f.foreign.id, target); assert.equal(saved.title, renamed); assert.ok(saved.updatedAt > oldUpdatedAt);
    assert.ok(f.snapshot("session-list").some(event => event.index > write.index && event.index < receipt.index && event.frame.data.revision > before), "real metadata publication precedes the successful mutation receipt");
    const fresh = await f.initial("", receipt.index); assert.equal(fresh.data.top.items[0].id, target); assert.equal(fresh.data.top.items[0].title, renamed);
    await page.getByRole("searchbox").focus(); await page.mouse.move(1400, 900);
    const firstPage = [target, ...top.slice(0, 29)]; await waitIds(page, firstPage, true);
    assert.equal(await rows(page, true).locator("strong").filter({ hasText: renamed }).count(), 1);
    assert.equal(await row(page, target).locator("strong").textContent(), renamed);
    assert.equal(await paging(page, true, "下一页").isEnabled(), true, "post-receipt fresh page is accepted, not an indefinite bridge");
    await paging(page, true, "下一页").click(); await waitIds(page, [top[30]], true);
    await paging(page, true, "上一页").click(); await waitIds(page, firstPage, true);
    assert.equal(await row(page, target).locator("strong").textContent(), renamed);
    assert.deepEqual(await selected(page), { workspaceId: f.main.id, sessionId: viewer });
    assert.equal(await page.evaluate(() => sessionStorage.getItem("sidebarWorkspaceId")), f.main.id);
    assert.equal(f.commands.filter(event => event.frame.op === "session.rename").length, 1);
    assert.equal(f.commands.filter(event => event.frame.op === "session-list.first").length, 0);
    f.assertCold(); f.facts.saved = saved; f.facts.writeIndex = write.index; f.facts.receiptIndex = receipt.index;
    f.facts.freshInitial = { requestIndex: fresh.request.index, responseIndex: fresh.response.index, revision: fresh.data.revision }; f.facts.finalView = await selected(page);
  } },
  { name: "outside-selected-external-delete-recovers", run: async (f, browser) => {
    const viewer = f.add("Oldest selected viewer"), first = f.add("Pinned first authority", { pinned: true, updatedAt: 100 });
    const ordinary = Array.from({ length: 31 }, (_, i) => f.add(i === 0 ? "OnlyVisible query row" : `Ordinary ${i}`, { updatedAt: 2000 - i }));
    f.facts.seed = { viewer, first, queryRow: ordinary[0], ordinary };
    await f.open(browser, viewer); const page = f.page!;
    await waitIds(page, ordinary.slice(0, 30)); await waitIds(page, [first], true);
    assert.ok(!(await ids(page)).includes(viewer));
    await f.search("OnlyVisible"); await waitIds(page, [ordinary[0]]); await waitIds(page, [], true);
    assert.deepEqual(await selected(page), { workspaceId: f.main.id, sessionId: viewer });
    assert.equal(f.commands.filter(event => event.frame.op === "session-list.first").length, 0, "filtered or off-page does not mean absent");
    const deletionStart = f.events.length;
    const receipt = await f.externalDelete(viewer); assert.equal(receipt.ok, true);
    assert.ok(f.app!.store.db.prepare("SELECT deletedAt FROM sessions WHERE id=?").get(viewer)!.deletedAt);
    await until(() => f.snapshot(`session:${f.main.id}:${viewer}`).some(event => event.index >= deletionStart && event.frame.data === null), "actual external deletion publishes authoritative selected null");
    await until(async () => (await selected(page)).sessionId === first, "real first-session authority restores the pinned candidate, not the query row");
    const firstReads = () => f.commands.filter(event => event.index >= deletionStart && event.frame.op === "session-list.first");
    await until(() => firstReads().some(event => f.response(event.frame.requestId)?.frame.ok && f.response(event.frame.requestId)!.frame.data?.id === first), "real first SQL result is delivered through transport");
    await until(() => f.snapshot(`session:${f.main.id}:${first}`).some(event => event.frame.data?.id === first), "recovered selected summary is authoritative");
    await waitIds(page, [ordinary[0]]); await waitIds(page, [], true);
    assert.notEqual(first, ordinary[0]);
    // A bounded quiet-window observation, not a guarantee about all future events.
    const reads = firstReads().length; await page.waitForTimeout(300); assert.equal(firstReads().length, reads, "no self-triggered recovery loop in the stable window");
    assert.deepEqual(await selected(page), { workspaceId: f.main.id, sessionId: first });
    f.facts.firstReads = firstReads(); f.facts.deletionStart = deletionStart; f.facts.finalView = await selected(page);
  } },
];

const requested = process.env.AXIOM_LIST_E2E_CASES?.split(",").filter(Boolean);
const chosen = cases.filter(test => !requested || requested.includes(test.name));
assert.ok(chosen.length && (!requested || chosen.length === new Set(requested).size), "requested cases must be known and nonempty");
const reports: unknown[] = [];
let browser: Browser | undefined;
try {
  const executablePath = process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  assert.ok(existsSync(executablePath), "requires an already installed browser; do not download one");
  browser = await chromium.launch({ executablePath, headless: true });
  for (const test of chosen) {
    const f = new Fixture(test.name); let failure: unknown;
    try { await f.start(); await test.run(f, browser); await f.verify(); }
    catch (error) {
      failure = error;
      if (f.page) {
        try { await f.page.screenshot({ path: join(artifacts, test.name, "failure.png"), fullPage: true }); } catch { /* Preserve original failure. */ }
        try { writeFileSync(join(artifacts, test.name, "failure.html"), await f.page.content()); } catch { /* Preserve original failure. */ }
      }
    } finally {
      await f.close(); if (!failure && f.cleanupErrors.length) failure = Error(f.cleanupErrors.join("\n"));
      const report = f.save(!failure, failure); reports.push(report);
      console.log(JSON.stringify({ name: test.name, passed: !failure, commandCount: f.commands.length, errors: f.errors, cleanupErrors: f.cleanupErrors }));
    }
    if (failure) throw failure;
  }
} finally {
  try { await browser?.close(); }
  finally {
    remote.mock.restore();
    if (previousEnvironment.pi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousEnvironment.pi;
    if (previousEnvironment.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment.node;
    for (const [key, value] of previousEnvironment.vite) process.env[key] = value;
    writeFileSync(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
    console.log(`List end-to-end evidence: ${artifacts}`);
  }
}
