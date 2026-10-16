// Run from app/: npx tsx tests/persistent-drafts.check.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
import type { Command, Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-draft-browser-")), previous = process.env.AXIOM_PI_DIR;
const pi = join(root, "pi"), project = join(root, "project");
mkdirSync(pi); mkdirSync(project);
process.env.AXIOM_PI_DIR = pi;
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: {
  api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture", input: ["text"] }],
} } }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "test-only" } }));
let app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [];
function gate() { let release!: () => void; const wait = new Promise<void>(done => { release = done; }); return { wait, release }; }
async function until(check: () => Promise<boolean> | boolean, message: string) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(done => setTimeout(done, 25)); }
  assert.fail(message);
}
async function open(expected = "") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(app.accessUrl);
  await until(async () => await page.locator("#prompt").inputValue().catch(() => null) === expected, "saved draft restored in background");
  return page;
}
let promptGate = gate(), seen: Command | undefined;
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  app.store.execute({ requestId: randomUUID(), op: "workspace.select", workspaceId: workspace.id, params: { view: scope } });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET selection=excluded.selection")
    .run(session.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
  let drafts = new SessionDrafts(app.store);
  const saved = (text: string) => until(() => drafts.read(scope).draft.text === text, "SQLite saved exact text");
  let page = await open();
  const text = "  重启后恢复中文\n\n保留空行与末尾空格  ";
  await page.locator("#prompt").fill(text);
  await page.locator("#prompt").evaluate(node => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII="), c => c.charCodeAt(0))], "persist.png", { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
  });
  await page.getByRole("button", { name: "移除附件：persist.png", exact: true }).waitFor();
  const withImage = await page.locator("#prompt").inputValue();
  await saved(withImage);
  await until(() => drafts.read(scope).draft.attachments?.length === 1, "attachment persisted");
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM agent_sessions WHERE file IS NOT NULL").get()!.n, 0);
  await page.context().close(); await app.close();
  app = await startServer({ root: join(root, "data"), port: 0, dev: true }); drafts = new SessionDrafts(app.store);
  page = await open(withImage);
  assert.equal(await page.locator("#prompt").inputValue(), withImage);
  assert.equal(await page.getByRole("button", { name: "移除附件：persist.png", exact: true }).count(), 1);
  console.log("PASS full service restart + fresh browser context restore last session, exact text and image attachment without pi");

  const other = await open(withImage);
  await page.locator("#prompt").fill("first window"); await saved("first window");
  await other.locator("#prompt").fill("second window local");
  await other.getByRole("button", { name: "载入已保存草稿", exact: true }).waitFor();
  assert.equal(await other.locator("#prompt").inputValue(), "second window local");
  assert.equal(drafts.read(scope).draft.text, "first window");
  await other.getByRole("button", { name: "载入已保存草稿", exact: true }).click();
  await until(async () => await other.locator("#prompt").inputValue() === "first window", "load conflict winner");
  await other.locator("#prompt").fill("second window saved"); await saved("second window saved");
  await page.locator("#prompt").fill("keep local explicitly");
  await page.getByRole("button", { name: "保存当前输入", exact: true }).click();
  await saved("keep local explicitly");
  await other.context().close();
  console.log("PASS competing windows preserve both inputs; explicit load and keep choices");

  // Input remains editable while its initial draft read is held.
  const context = await browser.newContext(), loading = await context.newPage(), readGate = gate();
  await loading.route("**/api/draft?*", async route => { if (route.request().method() === "GET") await readGate.wait; await route.continue(); });
  await loading.goto(app.accessUrl);
  await loading.locator("#prompt").waitFor();
  await loading.locator("#prompt").fill("typing while loading");
  readGate.release();
  await loading.getByRole("button", { name: "载入已保存草稿", exact: true }).waitFor();
  assert.equal(drafts.read(scope).draft.text, "keep local explicitly");
  assert.equal(await loading.locator("#prompt").inputValue(), "typing while loading");
  await context.close();
  console.log("PASS hydration race retains saved draft and typing during background loading");

  await page.context().close();
  // Only the provider boundary is mocked: production client preparation and SQLite
  // receipt/conditional consume run, while no external request or pi worker is started.
  const submitContext = await browser.newContext(); page = await submitContext.newPage();
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(async raw => {
      const c = JSON.parse(raw.toString()) as Command;
      if (c.op !== "prompt") { server.send(raw); return; }
      seen = c; await promptGate.wait;
      const data = await app.store.external(c, async () => ({ inputId: c.requestId }));
      drafts.consume(scope, c.params!.draftStamp as any, c.requestId);
      route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
    });
    server.onMessage(raw => route.send(raw));
  });
  await page.goto(app.accessUrl);
  await until(async () => await page.locator("#prompt").inputValue().catch(() => null) === "keep local explicitly", "submit draft restored");
  await page.locator("#prompt").fill("submitted");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await until(() => !!seen, "prompt reached fixture");
  assert.ok(seen!.params!.draftStamp);
  await page.locator("#prompt").fill("typed during submission"); await saved("typed during submission");
  promptGate.release();
  await until(() => app.store.receipt(seen!.requestId, scope).status === "committed", "admission committed");
  assert.equal(await page.locator("#prompt").inputValue(), "typed during submission");
  assert.equal(drafts.read(scope).draft.text, "typed during submission");
  await page.reload();
  await until(async () => await page.locator("#prompt").inputValue().catch(() => null) === "typed during submission", "reload draft");
  assert.equal(await page.locator("#prompt").inputValue(), "typed during submission");
  await submitContext.close();
  console.log("PASS acknowledged send never clears subsequent typing; reload retains newer input");

  const pendingId = randomUUID(), stamp = drafts.read(scope);
  drafts.save(scope, { revision: stamp.revision, writer: "pending-fixture", sequence: 1, submissionId: pendingId,
    draft: { text: "unconfirmed original request", attachment: null, attachments: [], images: [] } });
  const admission = gate();
  const pending = app.store.external({ requestId: pendingId, op: "prompt", ...scope }, async () => { await admission.wait; return { inputId: pendingId }; });
  page = await open();
  assert.equal(await page.locator("#prompt").inputValue(), "", "pending submission is not an ordinary resendable draft");
  await page.getByText("unconfirmed original request", { exact: true }).waitFor();
  admission.release(); await pending;
  await page.context().close();
  assert.equal(drafts.read(scope).draft.text, "");
  console.log("PASS refresh restores uncertain input identity without replay or duplicate editable draft");
  assert.deepEqual(errors, []);
} finally {
  promptGate.release();
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
