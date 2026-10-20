// Isolated task presentation regression: real subscriptions, no model requests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import type { ChatMessage } from "../src/shared/agent.js";
import { defaultBudgets, emptyTasks, tasksScope, type TaskList } from "../src/shared/tasks.js";

const root = mkdtempSync(join(tmpdir(), "axiom-task-cards-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/task-cards");
mkdirSync(artifacts, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
mkdirSync(join(root, "workspace"));
const app = await startServer({ root: join(root, "data"), port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const list: TaskList = { ...emptyTasks, tasks: [] };
  const originalList = app.tasks.list.bind(app.tasks);
  app.tasks.list = (target) => target.sessionId === session.id ? list : originalList(target);
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const call = (id: string, name: string, params: unknown) => ({ id, name, input: JSON.stringify(params) });
  const put = (...messages: ChatMessage[]) => { for (const message of messages) views.messageChanged(scope, message); views.flush(scope); };
  const output = (id: string, status: ChatMessage["status"], text = ""): ChatMessage => ({ id: `tool-${id}`, role: "toolResult", toolCallId: id, status, text });
  put({ id: "delegating", role: "assistant", text: "", calls: [call("delegation", "functions.delegate", { context: "测试", tasks: [{ task: "检查消息渲染" }] })] }, output("delegation", "running"));
  const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const cards = page.locator("#messages .subagents");
  const group = page.locator("#messages > .process-live");
  await cards.getByRole("img", { name: "正在创建", exact: true }).waitFor();
  assert.equal(await group.count(), 0, 'delegation is visible without opening a process');
  assert.equal(await cards.evaluate(node => !!node.closest('.tool-activity')), false);
  await cards.evaluate(node => { (window as any).originalCard = node; });
  await page.locator("#prompt").fill("保留输入与选择");
  put(output("delegation", "failed", "默认子模型不可用；请明确选择。"));
  await cards.getByRole("alert").waitFor();
  assert.ok((await cards.innerText()).includes("委派失败"));
  assert.ok((await cards.innerText()).includes("默认子模型不可用"));
  assert.equal(await cards.locator("button.subagent").count(), 0, "failed delegation needs no fake task ID");
  await cards.screenshot({ path: join(artifacts, "delegation-failed.png") });
  // Simulate eventual delivery of a corrected receipt; the call's card must stay mounted.
  list.tasks = ["running", "failed"].map((status, i) => ({
    id: `task-${i}`, workspaceId: workspace.id, parentSessionId: session.id, sessionId: `child-${i}`,
    anchor: "delegation", description: i ? "检查连接状态" : "检查消息渲染、流式输出、展开状态与全文读取，核对多个工具交错执行及子代理独立更新时的消息顺序，并验证手机和桌面布局没有溢出且阅读位置保持稳定", status: status as "running" | "failed",
    runId: `run-${i}`, createdAt: Date.now(), budgets: defaultBudgets, results: [], error: i ? "子任务执行失败：连接超时" : null,
  }));
  put(output("delegation", "completed", JSON.stringify({ taskIds: ["task-0", "task-1"], status: "queued" })));
  views.publish(tasksScope(scope), list);
  await cards.locator("button.subagent").nth(1).waitFor();
  assert.ok(await cards.evaluate(node => node === (window as any).originalCard));
  assert.equal(await page.locator("#prompt").inputValue(), "保留输入与选择");
  assert.ok((await cards.innerText()).includes("连接超时"));
  assert.equal(await cards.locator(".delegation-toggle, .task-call-detail").count(), 0);
  assert.ok(!(await cards.locator("header").innerText()).includes("独立 pi 会话"));
  assert.equal(await cards.locator('header > :first-child use').getAttribute('href'), '#i-subagent-identity', 'static bot identity precedes the collaboration title');
  assert.equal(await cards.locator('.task-batch-progress').count(), 0, 'no visible batch counter');
  assert.match((await cards.locator('.subagent-identity-icon').getAttribute('aria-label'))!, /0 \/ 2 已完成/);
  assert.equal(await cards.locator('.task-batch-progress svg, .agent-state-label').count(), 0, 'no duplicate progress glyph or state text');
  assert.equal(await cards.locator('header > :first-child').evaluate(node => node.getAnimations({ subtree: true }).length), 0, 'identity remains static');
  assert.equal(await cards.locator('.task-running-icon').evaluate(node => getComputedStyle(node).animationName), 'task-icon-spin', 'active member retains its own running feedback');

  const report = { id: "result-old", taskId: "task-0", runId: "old-run", status: "failed", report: "## 本次检查结果\n\n" + "旧交付内容。".repeat(2900) + "\n\nOLD_REPORT_END", reason: "本次检查未全部完成", unfinished: ["尚未核验重连"], sideEffects: "未修改文件", startedAt: 1, endedAt: 2 };
  put(
    { id: "notice", role: "notice", text: "子代理已完成", taskNotice: "completed" },
    { id: "reading", role: "assistant", text: "", calls: [call("read-result", "functions.read_result", { taskId: "task-0", resultId: "result-old" })] },
    output("read-result", "running"),
    { id: "appending", role: "assistant", text: "", calls: [call("append", "append", { taskId: "task-0", text: "补充检查断线后的消息顺序" })] },
    output("append", "completed", JSON.stringify({ taskId: "task-0", inputId: "input-0", status: "queued" })),
    { id: "follow-up", role: "assistant", text: "", calls: [call("follow", "functions.append", { taskId: "task-0", mode: "followUp", text: "完成后核对窄屏布局" })] },
    output("follow", "failed", "此子会话待处理输入达到 32 条"),
    { id: "stopping", role: "assistant", text: "", calls: [call("stop-task", "functions.cancel_task", { taskId: "task-0", reason: "已取得足够证据" })] },
    output("stop-task", "completed", JSON.stringify({ taskId: "task-0", status: "stopping" })),
  );
  const reading = page.locator('.task-operation[data-tool="read_result"]');
  await reading.getByText("读取中", { exact: true }).waitFor();
  assert.ok(await page.locator(".task-notice").isVisible());
  assert.equal(await group.count(), 0, 'a notice alone does not create an empty execution-completed entry');
  put(output("read-result", "completed", JSON.stringify(report)));
  await reading.getByText("已读取", { exact: true }).waitFor();
  assert.equal(await reading.locator("pre, .markdown").count(), 0);
  assert.ok(!(await reading.innerText()).includes("result-old"));
  await reading.locator("summary").first().focus();
  await page.keyboard.press("Enter");
  await reading.getByRole("heading", { name: "本次检查结果" }).waitFor();
  await reading.getByText("OLD_REPORT_END", { exact: true }).waitFor();
  assert.ok((await reading.innerText()).includes("本次交付 · 失败"), "task failure is distinct from successful read");
  assert.equal(await reading.locator("pre").count(), 0);
  list.tasks[0].results.push({ id: "result-new", runId: "new-run", status: "completed" });
  views.publish(tasksScope(scope), list);
  assert.ok(await reading.getByRole("heading", { name: "本次检查结果" }).isVisible());
  await reading.locator("summary").first().click();
  assert.equal(await reading.locator(".markdown, pre").count(), 0);
  const stop = page.locator('.task-operation[data-tool="cancel_task"]');
  assert.ok((await stop.innerText()).includes("停止已受理"));
  assert.ok((await page.locator('.task-operation[data-tool="append"]').first().innerText()).includes("已受理"));
  await page.locator('.task-operation[data-tool="append"]').nth(1).getByRole("alert").waitFor();
  await page.locator("#prompt").focus();
  await page.locator("#messages").screenshot({ path: join(artifacts, "task-cards-desktop.png") });
  assert.equal(await page.locator('.task-operation-action, .task-operation-chevron').count(), 0, 'operation cards have no right-side action text or arrow');
  for (const status of await page.locator('.task-operation-status').all()) {
    assert.equal(await status.evaluate(n => getComputedStyle(n).clipPath), 'inset(50%)', 'operation status is available to assistive technology without a visible badge');
  }
  for (const width of [360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${width}`);
    for (const node of await page.locator(".task-operation, .delegation-card").all()) assert.ok(await node.evaluate(n => n.scrollWidth <= n.clientWidth + 1), `card overflow ${width}`);
    for (const row of await cards.locator('.subagent').all()) {
      const box = await row.evaluate(n => ({ height: n.getBoundingClientRect().height, line: parseFloat(getComputedStyle(n.querySelector('.agent-identity strong')!).lineHeight), descriptionHeight: n.querySelector('.agent-identity strong')!.getBoundingClientRect().height }));
      assert.ok(Math.abs(box.height - (box.line * 2 + 12)) <= 1, `two-line child card at ${width}px: ${JSON.stringify(box)}`);
      assert.ok(box.descriptionHeight <= box.line * 2 + 1);
    }
    for (const operation of await page.locator('.task-operation').all()) {
      const box = await operation.evaluate(n => {
        const heading = n.querySelector('.task-operation-heading')!;
        const target = n.querySelector('.task-operation-target')!;
        return { height: n.getBoundingClientRect().height, heading: heading.getBoundingClientRect().height, target: target.getBoundingClientRect().height, line: parseFloat(getComputedStyle(target).lineHeight) };
      });
      assert.ok(Math.abs(box.height - (box.line * 2 + 14)) <= 1, `two-line operation at ${width}px: ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.heading - box.line * 2) <= 1);
      assert.ok(Math.abs(box.target - box.line) <= 1, 'preview/error occupies only the second line');
    }
    if (width === 390) await page.locator("#messages").screenshot({ path: join(artifacts, "task-cards-mobile.png") });
  }
  // A task card between ordinary calls closes one process and starts another.
  put({ id: "mixed", role: "assistant", text: "正文保持可见", calls: [call("file-a", "read", { path: "a.ts" }), call("mixed-append", "append", { taskId: "task-0", text: "检查 a.ts" }), call("file-b", "read", { path: "b.ts" })] });
  await page.waitForFunction(() => document.querySelectorAll('#messages > .process-live').length === 2);
  assert.equal(await group.count(), 2, "a subagent operation separates ordinary process segments");
  for (const segment of [group.nth(0), group.nth(1)]) {
    await segment.locator(':scope > summary').click();
    assert.equal(await segment.locator('.tool-call').count(), 1);
    assert.equal(await segment.getAttribute('data-call-count'), '1', 'facts exclude calls across the task boundary even within one message');
  }
  const mixed = page.locator('#messages > .task-operation[data-tool="append"]').last();
  assert.deepEqual(await page.locator('#messages > .process-live, #messages > .task-operation').evaluateAll(nodes => nodes.slice(-3).map(n => n.classList.contains('task-operation') ? 'task' : 'process')), ['process', 'task', 'process']);
  assert.equal(await group.first().getAttribute('data-status'), 'completed');
  assert.equal(await mixed.getAttribute("data-status"), "unknown");
  assert.ok(await mixed.isVisible());
  // Cancellation/error/unknown feedback all remain inside dedicated cards.
  put(output("mixed-append", "cancelled"), output("stop-task", "failed", "停止请求被拒绝"));
  await mixed.getByText("调用已停止", { exact: true }).waitFor();
  await stop.getByRole("alert").waitFor();
  assert.equal(await page.locator('.tool-heading[data-tool="delegate"], .tool-heading[data-tool="read_result"], .tool-heading[data-tool="append"], .tool-heading[data-tool="cancel_task"]').count(), 0);
  await page.reload();
  await reading.getByText("已读取", { exact: true }).waitFor();
  assert.equal(await reading.locator("pre, .markdown").count(), 0);
  await stop.getByRole("alert").waitFor();
  // Final folding preserves every task's chronological position, including task-only stretches.
  put({ id: 'final', role: 'assistant', text: '检查结束。', phase: 'final_answer', status: 'completed' });
  const aggregate = page.locator('#messages > .tool-activity:not(.process-live)');
  await aggregate.waitFor();
  assert.equal(await aggregate.getAttribute('open'), null);
  assert.equal(await page.locator('#messages > .task-operation, #messages > .subagents').count(), 0);
  await aggregate.locator(':scope > summary').click();
  const timeline = async () => aggregate.locator(':scope > .activity-content > *').evaluateAll(nodes => nodes.map(n =>
    n.matches('.subagents') ? 'delegate' : n.matches('.task-operation') ? n.getAttribute('data-tool') :
      n.matches('.process-live') ? 'process' : n.matches('.task-notice') ? 'notice' : 'body'));
  const expectedOrder = ['delegate', 'notice', 'read_result', 'append', 'append', 'cancel_task', 'body', 'process', 'append', 'process'];
  assert.deepEqual(await timeline(), expectedOrder);
  assert.equal(await aggregate.locator('.process-live').count(), 2, 'only segments with actual thinking or ordinary calls have completed headers');
  await reading.locator('summary').first().click();
  await reading.getByText('OLD_REPORT_END', { exact: true }).waitFor();
  put({ id: 'final', role: 'assistant', text: '检查结束。结果已核对。', phase: 'final_answer', status: 'completed' });
  assert.notEqual(await aggregate.getAttribute('open'), null, 'final text updates preserve manual expansion');
  await reading.locator('summary').first().click();
  await aggregate.locator(':scope > summary').scrollIntoViewIfNeeded();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `final-order-${width}.png`) });
  }
  await page.reload(); await aggregate.waitFor();
  assert.equal(await aggregate.getAttribute('open'), null);
  await aggregate.locator(':scope > summary').click();
  assert.deepEqual(await timeline(), expectedOrder);
  assert.equal(await reading.locator('.markdown').count(), 0, 'reload keeps task details lazy');
  // Past process headers finish at the next boundary; child cards retain actual state.
  put(output('file-a', 'completed'), output('file-b', 'completed'),
    { id: 'next-user', role: 'user', text: '开始下一段' },
    { id: 'next-process', role: 'assistant', text: '', calls: [call('next-read', 'read', { path: 'next.ts' })] },
    output('next-read', 'running'));
  await page.waitForFunction(() => document.querySelectorAll('#messages > .process-live').length === 1);
  assert.ok(await cards.locator('button.subagent').first().isVisible(), 'actual child details remain available in the completed process');
  list.tasks[0].status = 'completed';
  views.publish(tasksScope(scope), list);
  await page.waitForFunction(() => document.querySelector('.process-live')?.getAttribute('data-status') === 'completed');
  await page.waitForFunction(() => document.querySelector('.subagent-identity-icon')?.getAttribute('aria-label')?.includes('1 / 2 已完成'));
  assert.equal(await group.last().getAttribute('data-status'), 'running', 'only the new process shows an intermediate state');
  assert.deepEqual(errors, []);
  console.log(`PASS: independent process and child statuses; task cards, delegation before task IDs, inline failures, all four tools, exact long delivery, lazy details, keyboard, mixed order, responsive layout and reload. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
