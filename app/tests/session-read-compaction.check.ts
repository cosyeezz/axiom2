import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { transcriptMessages } from "../src/server/transcript.js";
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
    app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,role,status,budgets,createdAt) VALUES(?,?,?,?,?,'fixture','',?,'{}',1)")
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
  assert.deepEqual(transcriptMessages(manager).filter(m => m.taskNotice).map(m => m.resultId), ["retained"]);

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(view => {
    if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(view));
  }, { workspaceId: workspace.id, sessionId: other.id });
  await page.goto(app.origin);
  const targetRow = page.locator(`[data-session-id="${target.id}"]`);
  const otherRow = page.locator(`[data-session-id="${other.id}"]`);
  await targetRow.locator(".session-state.unread").waitFor();
  // A hidden page still cannot acknowledge the recovered notifications.
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
  await targetRow.locator("button.history-item").click();
  await page.locator('[data-result-id="retained"]').waitFor({ state: "attached" });
  await page.waitForTimeout(1100);
  assert.equal(app.store.session(workspace.id, target.id).readVersion, 1);
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))");
  await until(() => !app.store.session(workspace.id, target.id).unread, "compacted task results permanently block the read receipt");
  assert.equal(await page.locator('[data-result-id="archived-one"]').count(), 1);
  assert.equal(await page.locator('[data-result-id="archived-two"]').count(), 1);
  assert.equal(await page.locator('[data-result-id="already-read"]').count(), 0);
  assert.equal(await page.locator('[data-result-id="retained"]').count(), 1);
  assert.ok(!app.agents.messages(scope).some(m => m?.text === "private old input"));
  assert.equal(readFileSync(manager.getSessionFile()!, "utf8"), raw, "display recovery must not modify the native transcript");
  assert.deepEqual(transcriptMessages(manager).filter(m => m.taskNotice).map(m => m.resultId), ["retained"], "agent context stays compacted");

  await otherRow.locator("button.history-item").click();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "switching away cannot resurrect the dot");
  await page.reload();
  await otherRow.locator("button.history-item[aria-current=true]").waitFor();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "saved read state survives reload");

  // A new immutable result must still light the dot. Until its real notice arrives,
  // the mere existence of a compression card or task metadata cannot mark it read.
  result("late");
  app.agents.refresh(scope);
  await targetRow.locator(".session-state.unread").waitFor();
  await targetRow.locator("button.history-item").click();
  await page.waitForTimeout(1100);
  assert.equal(app.store.session(workspace.id, target.id).unread, true, "missing notification is not inferred from a compression summary");
  notice("late");
  manager.appendCompaction("<axiom-summary>live compression</axiom-summary>", null, 1000);
  app.agents.refresh(scope);
  await until(() => !app.store.session(workspace.id, target.id).unread, "live compaction did not recover the unread notification");
  assert.equal(await page.locator('[data-result-id="late"]').count(), 1);
  assert.equal(await page.locator('[data-result-id="archived-one"]').count(), 0, "cache rebuild does not restore acknowledged history");
  await otherRow.locator("button.history-item").click();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: compacted unread task notices are rendered and acknowledged; switching/reload stay read; new and undelivered results stay unread; live compaction recovers notices without changing agent context");
} finally {
  await browser.close();
  await app.close();
  if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi;
  rmSync(root, { recursive: true, force: true });
}
