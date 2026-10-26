import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import { tasksScope } from "../src/shared/tasks.js";
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
    // Delegation cards can be archived or outside the virtual window. Viewing
    // the synchronized session tail must not require their DOM to be mounted.
    app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,'fixture','completed','{}',1)")
      .run(`task-${id}`, workspace.id, target.id, child.id, `archived-anchor-${id}`);
    app.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,'{}')")
      .run(id, `task-${id}`, `run-${id}`);
    app.store.recordResult(target.id, id, "task");
  };
  const notice = (id: string): ChatMessage => ({ id: `notice-${id}`, role: "notice", text: "子代理已完成", taskNotice: "completed", resultId: id });
  result("first");
  publish({ id: "thinking", role: "assistant", text: "", thinking: "Checking the result.", status: "completed" }, notice("first"));

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
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
  const process = page.locator(".timeline-row > .tool-activity").first();
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
  assert.equal(current().unread, true, "hidden pages cannot acknowledge the session");
  // Focus and overlay checks remain independent of the removed notice DOM.
  await page.evaluate("Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false})");
  await visibility("visible");
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true, 'unfocused pages cannot acknowledge');
  await page.evaluate(`Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
    const overlay = document.createElement('div'); overlay.id = 'read-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white'; document.body.append(overlay);`);
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true, 'covered conversations cannot acknowledge');
  await page.locator('#read-overlay').evaluate(node => node.remove());
  await until(() => !current().unread, "closed process blocked session read without notification DOM");
  assert.equal(await page.locator('[data-result-id], .task-notices').count(), 0);
  publish({ id: "continued", role: "assistant", text: "", thinking: "Continue working.", status: "completed" });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.timeline-row > .tool-activity').count(), 1, 'legacy notice does not split execution');
  await process.locator(':scope > summary').click();
  assert.equal(await page.locator('[data-result-id], .task-notices').count(), 0);
  await process.locator(':scope > summary').click();
  assert.equal(await page.locator(".thinking-block, .tool-call").count(), 0, "read does not eagerly mount process details");
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
  await until(() => !current().unread, "final-answer folding blocked session read without notification DOM");
  assert.equal(await page.locator('[data-result-id], .task-notices').count(), 0);
  assert.equal(await page.locator(".thinking-block, .tool-call").count(), 0);
  // Expanding only the outer process must not reintroduce legacy notifications.
  await process.locator(":scope > summary").click();
  assert.equal(await page.locator('[data-result-id], .task-notices').count(), 0);
  assert.equal(await process.locator(".tool-activity[open]").count(), 0);
  await process.locator(":scope > summary").click();
  await switchAway();
  await page.reload();
  await otherRow.locator('[aria-current="true"]').waitFor();
  assert.equal(await targetRow.locator(".session-state.unread").count(), 0, "read state survives reload");

  // Delay the immutable task snapshot, while the thread already references the result.
  const list = app.tasks.list.bind(app.tasks);
  let delayResults = true;
  app.tasks.list = s => {
    const snapshot = list(s);
    return !delayResults || s.sessionId !== target.id ? snapshot : { ...snapshot,
      tasks: snapshot.tasks.map(task => ({ ...task, results: task.results.filter(r => r.id !== 'late' && r.id !== 'newer') })) };
  };
  result("late");
  views.changed(scope);
  await targetRow.locator(".session-state.unread").waitFor();
  await targetRow.locator("button.history-item").click();
  await page.getByText("The work is complete.", { exact: true }).waitFor();
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true, "unsynchronized immutable task results cannot be acknowledged");
  const priorVersion = current().resultVersion!;
  result('newer'); views.changed(scope);
  app.store.readSession(scope, priorVersion);
  assert.equal(current().unread, true, 'an old version receipt cannot acknowledge a new result');
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true);
  delayResults = false;
  app.agents.publish(tasksScope(scope));
  await until(() => !current().unread, "synchronized results without notification DOM must acknowledge the session");
  assert.equal(await page.locator('[data-result-id], .task-notices').count(), 0);
  assert.equal(app.store.db.prepare("SELECT delivery FROM task_results WHERE id='late'").get()!.delivery, 'pending', 'UI acknowledgement does not deliver or consume the internal result');
  publish(notice('late'));
  assert.equal(await page.locator('[data-result-id], .task-notices').count(), 0);
  // The tail must actually be viewed, even when old cards have been virtualized.
  publish(...Array.from({ length: 60 }, (_, i): ChatMessage => ({ id: `body-${i}`, role: 'assistant',
    text: `History ${i}: ${'A long reply for scrolling. '.repeat(50)}`, status: 'completed' })));
  await page.waitForFunction(() => { const view = document.querySelector('#thread'); return !!view && view.scrollHeight > view.clientHeight * 3; });
  await page.getByRole('button', { name: '回到最上', exact: true }).click();
  await page.waitForFunction(() => { const view = document.querySelector('#thread'); return !!view && view.scrollTop < 3 && view.scrollHeight - view.clientHeight > 100; });
  result('offscreen'); views.changed(scope); app.agents.publish(tasksScope(scope));
  await page.waitForTimeout(1100);
  assert.equal(current().unread, true, 'a view away from the tail must not acknowledge');
  await page.getByRole('button', { name: '回到最下', exact: true }).click();
  await until(() => !current().unread, 'viewing the tail with virtualized cards must acknowledge');
  await switchAway();
  assert.deepEqual(errors, []);
  console.log("PASS: no legacy task notifications or process splits; folded session tail acknowledges without notice DOM; hidden/unfocused/covered and unsynchronized views do not; version races, internal delivery separation, switching/reload verified");
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
