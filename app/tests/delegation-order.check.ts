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
const artifacts = resolve("test-results/task-cards");
mkdirSync(artifacts, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
mkdirSync(join(root, "workspace"));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
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
  const group = page.locator("#messages > .tool-activity");
  await group.locator(":scope > summary").click();
  await cards.getByText("正在创建", { exact: true }).waitFor();
  assert.equal(await group.count(), 1);
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
    anchor: "delegation", description: i ? "检查连接状态" : "检查消息渲染", status: status as "running" | "failed",
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
  assert.equal(await group.count(), 1);
  assert.equal(await group.getAttribute("data-status"), "running", "running child keeps the process active after delegation receipt");
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
  for (const width of [360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${width}`);
    for (const node of await page.locator(".task-operation, .delegation-card").all()) assert.ok(await node.evaluate(n => n.scrollWidth <= n.clientWidth + 1), `card overflow ${width}`);
    if (width === 390) await page.locator("#messages").screenshot({ path: join(artifacts, "task-cards-mobile.png") });
  }
  // Mixed calls preserve order inside the shared process and count all tools.
  put({ id: "mixed", role: "assistant", text: "正文保持可见", calls: [call("file-a", "read", { path: "a.ts" }), call("mixed-append", "append", { taskId: "task-0", text: "检查 a.ts" }), call("file-b", "read", { path: "b.ts" })] });
  await page.locator(".activity-title").filter({ hasText: "8 项" }).waitFor();
  const mixed = page.locator(".log-row").filter({ hasText: "正文保持可见" });
  assert.deepEqual(await mixed.locator(".tool-call, .task-operation").evaluateAll(nodes => nodes.map(n => n.classList.contains("task-operation") ? "task" : "tool")), ["tool", "task", "tool"]);
  assert.equal(await mixed.locator(".task-operation").getAttribute("data-status"), "unknown");
  assert.ok(await mixed.locator(".task-operation").isVisible());
  // Cancellation/error/unknown feedback all remain inside dedicated cards.
  put(output("mixed-append", "cancelled"), output("stop-task", "failed", "停止请求被拒绝"));
  await mixed.getByText("调用已停止", { exact: true }).waitFor();
  await stop.getByRole("alert").waitFor();
  assert.equal(await page.locator('.tool-heading[data-tool="delegate"], .tool-heading[data-tool="read_result"], .tool-heading[data-tool="append"], .tool-heading[data-tool="cancel_task"]').count(), 0);
  await page.reload();
  await group.locator(":scope > summary").click();
  await reading.getByText("已读取", { exact: true }).waitFor();
  assert.equal(await reading.locator("pre, .markdown").count(), 0);
  await stop.getByRole("alert").waitFor();
  // Advancing to a new process must not hide a genuinely running child in the old one.
  put(output('file-a', 'completed'), output('file-b', 'completed'),
    { id: 'next-user', role: 'user', text: '开始下一段' },
    { id: 'next-process', role: 'assistant', text: '', calls: [call('next-read', 'read', { path: 'next.ts' })] },
    output('next-read', 'running'));
  await group.last().locator('.activity-current').filter({ hasText: 'next.ts' }).waitFor();
  assert.equal(await group.first().getAttribute('data-status'), 'running', 'the old process retains an actual running child');
  list.tasks[0].status = 'completed';
  views.publish(tasksScope(scope), list);
  await group.first().locator('.activity-status-completed').waitFor();
  assert.equal(await group.last().getAttribute('data-status'), 'running', 'only the new process is running after the child finishes');
  assert.deepEqual(errors, []);
  console.log(`PASS: independent process and child statuses; task cards, delegation before task IDs, inline failures, all four tools, exact long delivery, lazy details, keyboard, mixed order, responsive layout and reload. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
