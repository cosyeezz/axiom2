import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-process-unread-"));
const previousPi = process.env.AXIOM_PI_DIR;
mkdirSync(join(root, "pi"));
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const until = async (predicate: () => boolean, message: string) => {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
try {
  const run = (op: string, params = {}, workspaceId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId });
  const workspace = run("workspace.open", { path: root, authorized: true }) as Workspace;
  const target = run("session.create", {}, workspace.id) as Session;
  const other = run("session.create", {}, workspace.id) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: target.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const publish = (...messages: ChatMessage[]) => {
    for (const message of messages) views.messageChanged(scope, message);
    views.flush(scope);
    views.changed(scope);
  };
  const result = (id: string) => {
    const child = run("session.create", {}, workspace.id) as Session;
    app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed','{}',1,2)")
      .run(`run-${id}`, child.id);
    // The original delegation can be outside the displayed context. Its actual
    // delivered notice must still acknowledge the result without opening details.
    app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,'fixture','completed','{}',1)")
      .run(`task-${id}`, workspace.id, target.id, child.id, `archived-anchor-${id}`);
    app.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,'{}')")
      .run(id, `task-${id}`, `run-${id}`);
    app.store.recordResult(target.id, id, "task");
  };
  const notice = (id: string): ChatMessage => ({ id: `notice-${id}`, role: "notice", text: "子代理已完成", taskNotice: "completed", resultId: id });
  result("first");
  publish({ id: "thinking", role: "assistant", text: "", thinking: "Checking the result.", status: "completed" }, notice("first"));

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(view => {
    if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(view));
  }, { workspaceId: workspace.id, sessionId: other.id });
  await page.goto(app.origin);
  const targetRow = page.locator(`[data-session-id="${target.id}"]`);
  const otherRow = page.locator(`[data-session-id="${other.id}"]`);
  const process = page.locator("#messages > .tool-activity").first();
  const current = () => app.store.session(workspace.id, target.id);
  const switchAway = async () => {
    await otherRow.locator("button.history-item").click();
    await otherRow.locator('[aria-current="true"]').waitFor();
    assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "switching away must not resurrect an acknowledged dot");
  };
  const visibility = async (value: "hidden" | "visible") => page.evaluate(
    `Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=>${JSON.stringify(value)}});document.dispatchEvent(new Event('visibilitychange'))`,
  );

  await targetRow.locator(".session-state.unread").waitFor();
  await visibility("hidden");
  await targetRow.locator("button.history-item").click();
  await process.waitFor();
  assert.equal(await process.getAttribute("open"), null);
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true, "hidden pages cannot acknowledge collapsed notifications");
  await visibility("visible");
  await until(() => !current().unread, "closed process dropped the delivered result notification and blocked reading");
  assert.equal(await page.locator('[data-result-id="first"]').count(), 1);
  const liveNotice = page.locator('#messages > .task-notices [data-result-id="first"]');
  assert.equal(await liveNotice.isVisible(), true, "a result following thinking stays visible outside the closed execution");
  publish({ id: "continued", role: "assistant", text: "", thinking: "Continue working.", thinkingActive: true, streaming: true, status: "running" });
  await page.locator('#messages > .tool-activity').nth(1).waitFor();
  assert.equal(await liveNotice.isVisible(), true, "continued execution must not absorb an earlier notification");
  assert.deepEqual(await page.locator('#messages > .tool-activity, #messages > .task-notices').evaluateAll(nodes =>
    nodes.map(node => node.matches('.task-notices') ? 'notice' : 'process')), ['process', 'notice', 'process']);
  await process.locator(':scope > summary').click();
  assert.equal(await liveNotice.isVisible(), true, "expanding execution leaves the notification in its own row");
  await process.locator(':scope > summary').click();
  assert.equal(await page.locator(".thinking-block, .tool-call").count(), 0, "read evidence must not eagerly mount process details");
  await switchAway();

  // A final answer adds an outer collapsed process around the existing segments.
  result("second");
  publish({ id: "continued", role: "assistant", text: "", thinking: "Continue working.", status: "completed" },
    notice("second"), { id: "final", role: "assistant", text: "The work is complete.", phase: "final_answer", status: "completed" });
  await targetRow.locator(".session-state.unread").waitFor();
  await visibility("hidden");
  await targetRow.locator("button.history-item").click();
  await page.getByText("The work is complete.", { exact: true }).waitFor();
  assert.equal(await process.getAttribute("open"), null);
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true);
  await visibility("visible");
  await until(() => !current().unread, "final-answer folding dropped the delivered result notification and blocked reading");
  assert.equal(await page.locator('[data-result-id="second"]').count(), 1);
  assert.equal(await page.locator(".thinking-block, .tool-call").count(), 0);
  // Expanding only the outer process keeps the same actual notice exactly once.
  await process.locator(":scope > summary").click();
  assert.equal(await page.locator('[data-result-id="second"]').count(), 1);
  assert.equal(await process.locator(".tool-activity[open]").count(), 0);
  await process.locator(":scope > summary").click();
  await switchAway();
  await page.reload();
  await otherRow.locator('[aria-current="true"]').waitFor();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "read state survives reload");

  // Metadata alone is not proof of delivery, even with a final answer on screen.
  result("late");
  views.changed(scope);
  await targetRow.locator(".session-state.unread").waitFor();
  await targetRow.locator("button.history-item").click();
  await page.getByText("The work is complete.", { exact: true }).waitFor();
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true, "an undelivered task result stays unread");
  publish(notice("late"));
  await until(() => !current().unread, "live notice in a closed process was not acknowledged");
  const standalone = page.locator('#messages > .task-notices');
  assert.equal(await standalone.locator('summary').count(), 0);
  assert.equal(await standalone.locator('[data-result-id="late"]').count(), 1);
  assert.equal(await standalone.locator('.task-notice').isVisible(), true, 'late standalone notices are immediately visible without expanding');
  assert.equal(await page.locator('#messages > .task-notice').count(), 0, 'task notices never become loose top-level rows');
  await switchAway();
  assert.deepEqual(errors, []);
  console.log("PASS: live task notices remain visible between closed execution segments; final-answer folding retains real result notices; hidden and undelivered results stay unread; switching and reload preserve read state");
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
