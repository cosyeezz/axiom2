import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { transcriptMessages } from "../src/server/transcript.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-compacted-unread-"));
const oldPi = process.env.AXIOM_PI_DIR;
mkdirSync(join(root, "pi"));
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const until = async (predicate: () => boolean, message: string) => {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
try {
  const run = (op: string, params = {}, workspaceId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId });
  const workspace = run("workspace.open", { path: root, authorized: true }) as Workspace;
  const target = run("session.create", {}, workspace.id) as Session;
  const other = run("session.create", {}, workspace.id) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: target.id };
  const manager = SessionManager.create(root, join(root, "transcripts"));
  manager.appendMessage({ role: "user", content: "private old input", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "old reply" }],
    api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(target.id, manager.getSessionFile()!);
  const result = (id: string, status = "completed") => {
    const child = run("session.create", {}, workspace.id) as Session;
    app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,?,'{}',1,2)")
      .run(`run-${id}`, child.id, status);
    app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,'fixture',?,'{}',1)")
      .run(`task-${id}`, workspace.id, target.id, child.id, `anchor-${id}`, status);
    app.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)")
      .run(id, `task-${id}`, `run-${id}`, JSON.stringify({ status }));
    app.store.recordResult(target.id, id, "task");
  };
  const notice = (id: string, status = "completed") => manager.appendCustomMessageEntry("axiom-result", JSON.stringify({ resultId: id, status }), true);
  // Read history must stay archived. Unread results cross multiple compactions.
  result("already-read"); notice("already-read");
  app.store.readSession(scope, 1);
  result("archived-one"); notice("archived-one");
  manager.appendCompaction("<axiom-summary>first summary</axiom-summary>", null, 1000);
  result("archived-two", "failed"); notice("archived-two", "failed");
  manager.appendCompaction("<axiom-summary>second summary</axiom-summary>", null, 1000);
  result("retained"); notice("retained");
  const raw = readFileSync(manager.getSessionFile()!, "utf8");
  assert.ok(!transcriptMessages(manager).some(m => m.taskNotice));
  assert.equal(manager.getBranch().filter(e => e.type === "custom_message" && e.customType === "axiom-result").length, 4);

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/@vite/client", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(view => {
    if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(view));
  }, { workspaceId: workspace.id, sessionId: other.id });
  await page.goto(app.origin);
  const targetRow = page.locator(`[data-session-id="${target.id}"]`);
  const otherRow = page.locator(`[data-session-id="${other.id}"]`);
  await targetRow.locator(".session-state.unread").waitFor();
  // A hidden page cannot acknowledge the session, even with all results synchronized.
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
  await targetRow.locator("button.history-item").click();
  await page.locator('.history-card').first().waitFor();
  const assertBatch = async () => {
    assert.equal(await page.locator('.task-notices, .task-notice[data-result-id], [data-result-id]').count(), 0);
    assert.ok(!app.agents.messages(scope).some(m => m?.taskNotice));
    const views = (app.agents as unknown as { views: AgentViews }).views;
    assert.ok(!views.historyIndex(scope).segments.some(s => s.groups.some(g => 'notices' in g)));
  };
  await assertBatch();
  assert.equal(await page.evaluate(() => document.visibilityState), 'hidden');
  assert.equal(app.store.session(workspace.id, target.id).readVersion, 1, 'hidden initial view must not acknowledge notices');
  // Rebuild the view before acknowledgement; the compact entry and order survive reload.
  await page.addInitScript("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });");
  await page.reload();
  await page.locator('.history-card').first().waitFor();
  await assertBatch();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await assertBatch();
    if (process.env.AXIOM_TEST_ARTIFACTS) {
      const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS);
      mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: join(artifacts, `task-notices-${width}.png`) });
    }
  }
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => document.visibilityState), 'hidden');
  assert.equal(app.store.session(workspace.id, target.id).readVersion, 1);
  // Acknowledgement does not depend on archived cards or notification DOM.
  const closeOriginals = page.getByRole('button', { name: '收起会话原文', exact: true });
  while (await closeOriginals.count()) await closeOriginals.first().dispatchEvent('click');
  await assertBatch();
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))");
  await until(() => !app.store.session(workspace.id, target.id).unread, "closed compacted task history permanently blocks the read receipt");
  await assertBatch();
  assert.equal(await page.getByRole('button', { name: '原始会话', exact: true }).count(), 0);
  assert.ok(!app.agents.messages(scope).some(m => m?.text === "private old input"));
  assert.equal(readFileSync(manager.getSessionFile()!, "utf8"), raw, "display filtering must not modify the native transcript");
  assert.ok(!transcriptMessages(manager).some(m => m.taskNotice));
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM task_results WHERE delivery='pending'").get()!.n, 4, "UI read does not deliver or consume internal notifications");

  await page.setViewportSize({ width: 1440, height: 900 });
  await otherRow.locator("button.history-item").click();
  // Pointer navigation waits for double-click rename arbitration.
  await otherRow.locator("button.history-item[aria-current=true]").waitFor();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "switching away cannot resurrect the dot");
  await page.reload();
  await otherRow.locator("button.history-item[aria-current=true]").waitFor();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "saved read state survives reload");

  // A new result still lights the dot. Viewing the synchronized tail clears it
  // independently of internal notification delivery or compaction.
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))");
  result("late");
  app.agents.refresh(scope);
  await targetRow.locator(".session-state.unread").waitFor();
  await targetRow.locator("button.history-item").click();
  await until(() => !app.store.session(workspace.id, target.id).unread, "viewing synchronized results without notice DOM must acknowledge the session");
  assert.equal(app.store.db.prepare("SELECT delivery FROM task_results WHERE id='late'").get()!.delivery, 'pending');
  notice("late");
  manager.appendCompaction("<axiom-summary>live compression</axiom-summary>", null, 1000);
  app.agents.refresh(scope);
  await page.waitForTimeout(1100);
  assert.equal(app.store.session(workspace.id, target.id).unread, false);
  await assertBatch();
  assert.equal(manager.getBranch().filter(e => e.type === 'custom_message' && e.customType === 'axiom-result').length, 5, 'native notifications remain stored');
  await otherRow.locator("button.history-item").click();
  await otherRow.locator("button.history-item[aria-current=true]").waitFor();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: no task notifications before/after multiple compactions, closed history, switching or reload; synchronized session tail acknowledges results without consuming internal delivery or changing native transcripts");
} finally {
  await browser.close();
  await app.close();
  if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi;
  rmSync(root, { recursive: true, force: true });
}
