// Cross-run delivery must enclose task slices, not just ordinary tool segments.
// Isolated server/temporary data/port 0; no model or production operations.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import { defaultBudgets, emptyTasks, tasksScope, type TaskList } from "../src/shared/tasks.js";

const root = mkdtempSync(join(tmpdir(), "axiom-resumed-task-fold-"));
const artifacts = process.env.AXIOM_RESUMED_ARTIFACTS ?? join(root, "artifacts");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const put = (...messages: ChatMessage[]) => { for (const message of messages) views.messageChanged(scope, message); views.flush(scope); };
  const m = (id: string, more: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", runId: "before-restart", status: "completed", text: "", ...more });
  const call = (id: string, name: string, params: unknown) => ({ id, name, input: JSON.stringify(params) });
  const output = (id: string, text = "{}"): ChatMessage => ({ id: `tool-${id}`, role: "toolResult", toolCallId: id, status: "completed", text });
  const list: TaskList = { ...emptyTasks, tasks: [{ id: "child-fixture", workspaceId: workspace.id, parentSessionId: session.id, sessionId: "child-session", anchor: "delegate-call", title: "保留真实子任务状态", description: "只读模拟子任务", status: "running", runId: "child-run", createdAt: 1, error: null, budgets: defaultBudgets, results: [] }] };
  const originalList = app.tasks.list.bind(app.tasks);
  app.tasks.list = target => target.sessionId === session.id ? list : originalList(target);
  const prior = [m("user", { role: "user", text: "跨运行交付检查" }),
    m("delegate", { calls: [call("delegate-call", "functions.delegate", { tasks: [{ title: "保留真实子任务状态", task: "只读检查" }] })] }), output("delegate-call", JSON.stringify({ taskIds: ["child-fixture"], status: "queued" })),
    m("narration", { text: "交付前过程说明", calls: [call("ordinary-read", "read", { path: "fixture.ts" })] }), output("ordinary-read", "文件内容"),
    m("operations", { calls: [call("result-call", "functions.read_result", { taskId: "child-fixture", resultId: "fixture-result" }), call("append-call", "functions.append", { taskId: "child-fixture", summary: "补充核查", text: "核对边界" })] }),
    output("result-call"), output("append-call", JSON.stringify({ taskId: "child-fixture", status: "queued" }))];
  put(...prior);
  // Physical archives split the same undelivered user turn, including tasks.
  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  for (const message of prior) {
    const content = [
      ...(message.text ? [{ type: "text", text: message.text, textSignature: JSON.stringify({ v: 1, id: message.id, phase: "commentary" }) }] : []),
      ...(message.calls ?? []).map(call => ({ type: "toolCall", id: call.id, name: call.name, arguments: JSON.parse(call.input) })),
    ];
    manager.appendMessage({ role: message.role, axiomId: message.id, content, timestamp: 1,
      ...(message.role === "assistant" ? { stopReason: message.calls?.length ? "toolUse" : "stop" } : {}),
      ...(message.role === "toolResult" ? { toolCallId: message.toolCallId, toolName: "fixture", isError: false } : {}),
    } as any);
    if (["user", "tool-delegate-call", "tool-ordinary-read", "tool-append-call"].includes(message.id)) manager.appendCompaction("完整交接摘要", null, 20000);
  }
  const file = manager.getSessionFile()!, originalFile = readFileSync(file, "utf8");
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, file);
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed','{}',1)").run("before-restart", session.id);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: "no-preference" }); page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  await page.locator(".subagents").waitFor();
  const outer = page.locator('.timeline-row > .tool-activity:not(.process-live)');
  const visibleProcess = async () => {
    assert.equal(await outer.count(), 0, "no delivery outer card before a completed final");
    const completed = page.locator('.tool-activity.process-live[data-status="completed"]');
    assert.ok(await completed.count() > 0, "archived local tools retain completed status before final delivery");
    assert.ok((await completed.locator(':scope > summary .activity-title').allTextContents()).every(title => title === "执行完成"), "completed local tools have a completed label, not an active tool/thinking label");
    assert.equal(await completed.locator(':scope > summary .activity-status-completed').count(), 0, "local completion does not grant final-delivery checkmarks");
    assert.equal(await page.getByText("交付前过程说明", { exact: true }).isVisible(), true);
    assert.equal(await page.locator(".subagent[data-status=running]").isVisible(), true);
    assert.equal(await page.locator(".subagents").evaluate(node => !!node.closest("details:not([open])")), false, "running child card has no closed disclosure ancestor");
  };
  await page.getByText("交付前过程说明", { exact: true }).waitFor();
  await visibleProcess();
  // Completed run, compactions, empty/error/cancelled answers are not delivery.
  for (const extra of [{ text: "" }, { status: "failed" as const, error: "length limit" }, { status: "cancelled" as const }, { streaming: true, status: "running" as const }]) {
    put(m("final", { runId: "after-restart", text: "跨运行最终交付在卡外", phase: "final_answer", ...extra }));
    await page.waitForTimeout(150); await visibleProcess();
  }
  put(m("final", { runId: "after-restart", text: "跨运行最终交付在卡外，仍在追加", phase: "final_answer", streaming: true, status: "running" }));
  await page.getByText("跨运行最终交付在卡外，仍在追加", { exact: true }).waitFor(); await visibleProcess();
  await page.reload(); await page.locator(".subagent[data-status=running]").waitFor(); await visibleProcess();
  await page.evaluate(() => {
    (window as any).deliveryFoldFrames = [];
    const observer = new MutationObserver(() => {
      const card = document.querySelector('.joined-process[data-folding="true"]');
      if (!card) return;
      (window as any).deliveryFoldFrames = card.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.height));
      observer.disconnect();
    });
    observer.observe(document.querySelector('#messages')!, { subtree: true, childList: true, attributes: true });
  });
  put(m("final", { runId: "after-restart", text: "跨运行最终交付在卡外", phase: "final_answer", streaming: false }));
  await outer.waitFor(); assert.equal(await outer.count(), 1);
  await page.waitForFunction(() => !document.querySelector('.joined-process[data-folding="true"]') && !!document.querySelector('.joined-process:not([open])'));
  assert.ok(await page.evaluate(() => { const heights = (window as any).deliveryFoldFrames.map(parseFloat); return heights.length === 2 && heights[0] > heights[1]; }), "cross-archive final retains the height collapse animation");
  const check = outer.locator('.activity-completed-check');
  assert.equal(await check.locator('animate').getAttribute('begin'), '1.2s');
  assert.equal(await check.locator('animate').getAttribute('dur'), '0.8s');
  await page.waitForFunction(() => { const path = document.querySelector('.joined-process .activity-completed-check'); const offset = path && parseFloat(getComputedStyle(path).strokeDashoffset); return typeof offset === 'number' && offset > 1 && offset < 99; });
  await page.screenshot({ path: join(artifacts, '390-final-check-drawing.png') });
  await page.waitForFunction(() => { const path = document.querySelector('.joined-process .activity-completed-check'); return path && parseFloat(getComputedStyle(path).strokeDashoffset) < 0.1; });
  assert.equal(await outer.getAttribute("open"), null);
  assert.equal(await page.locator(".subagents, .task-operation").count(), 0, "delivery hides all task cards inside the closed aggregate");
  await page.getByText("跨运行最终交付在卡外", { exact: true }).waitFor();
  const order = () => outer.locator(":scope > .activity-content > *").evaluateAll(nodes => nodes.map(node => node.matches(".subagents") ? "delegate" : node.matches(".task-operation") ? node.getAttribute("data-tool") : node.matches(".tool-activity") ? "process" : "body"));
  const expected = ["delegate", "body", "process", "read_result", "append"];
  await outer.locator(":scope > summary").click();
  await outer.locator(".subagent[data-status=running]").waitFor();
  await outer.locator(".history-loading").waitFor({ state: "detached" });
  assert.deepEqual(await order(), expected);
  assert.equal(await outer.getByText("跨运行最终交付在卡外", { exact: true }).count(), 0);
  list.tasks[0].status = "completed"; views.publish(tasksScope(scope), list);
  await outer.locator(".subagent[data-status=completed]").waitFor();
  assert.equal(await outer.getAttribute("data-status"), "completed");
  assert.equal(await outer.locator(".task-operation details[open]").count(), 0, "task reports remain lazy");
  await outer.locator(":scope > summary").click();
  await page.reload(); await outer.waitFor();
  assert.equal(await outer.getAttribute("open"), null);
  assert.equal(await outer.locator('animate').count(), 0, "restored history does not replay the completion drawing");
  assert.equal(await page.locator(".subagents, .task-operation").count(), 0);
  for (let i = 0; i < 50; i++) put(m(`filler-user-${i}`, { role: "user", runId: `filler-${i}`, text: `后续问题 ${i}` }), m(`filler-final-${i}`, { runId: `filler-${i}`, text: `后续交付 ${i}。${"长历史虚拟化验证。".repeat(14)}`, phase: "final_answer" }));
  const scroll = async (bottom: boolean) => page.locator("#thread").evaluate((node, bottom) => {
    (document.activeElement as HTMLElement | null)?.blur(); getSelection()?.removeAllRanges();
    node.dispatchEvent(new WheelEvent("wheel", { deltaY: bottom ? 100000 : -100000, bubbles: true }));
    node.scrollTop = bottom ? node.scrollHeight : 0;
  }, bottom);
  await scroll(true); await outer.waitFor({ state: "detached" });
  await scroll(false); await outer.waitFor();
  assert.equal(await outer.getAttribute("open"), null, "closed state survives virtual recycling");
  assert.equal(await outer.locator('animate').count(), 0, "virtual recycling does not replay the completion drawing");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await scroll(false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `${width}-resumed-tasks-closed.png`) });
  }
  await outer.locator(":scope > summary").click(); await outer.locator(".subagents").waitFor();
  await scroll(true); await outer.waitFor({ state: "detached" });
  await scroll(false); await outer.waitFor();
  assert.notEqual(await outer.getAttribute("open"), null, "manual expansion survives virtual recycling");
  assert.equal(await outer.locator('animate').count(), 0, "manual expansion and recycling do not replay the completion drawing");
  await outer.locator(".history-loading").waitFor({ state: "detached" });
  assert.deepEqual(await order(), expected);
  await page.screenshot({ path: join(artifacts, "1440-resumed-tasks-manual-open.png") });
  assert.equal(readFileSync(file, "utf8"), originalFile, "archive reading and delivery projection do not rewrite native storage");
  assert.deepEqual(errors, []);
  console.log(`PASS resumed direct final, delegate/read_result/append inside, chronological slices, child status updates, final outside, reload, virtual closed/manual-open memory, 390/1440; artifacts ${artifacts}`);
} finally {
  if (browser) for (const page of browser.contexts().flatMap(context => context.pages())) {
    await page.screenshot({ path: join(artifacts, 'last-state.png') }).catch(() => {});
    writeFileSync(join(artifacts, 'last-state.json'), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, html: document.querySelector('#messages')?.innerHTML })).catch(() => null), null, 2));
  }
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
