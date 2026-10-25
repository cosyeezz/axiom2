// Isolated browser regression for model/UI dual-channel task references; no model requests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Locator } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { taskTools } from "../src/server/task-tools.js";
import { chatMessage } from "../src/server/transcript.js";
import { tasksScope, type TaskResult, type TaskTool } from "../src/shared/tasks.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-task-model-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "/tmp/axiom-task-model-ui");
mkdirSync(artifacts, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const put = (...messages: ChatMessage[]) => { for (const message of messages) views.messageChanged(scope, message); views.flush(scope); };
  const records = new TaskRecords(app.store);
  const created = records.create(scope, "delegate", "共享背景", [{ title: "短引用界面检查", task: "核对指定交付全文及子窗口" }], { provider: "fixture", id: "fixture", thinking: "off" });
  const taskId = created.taskIds[0], taskRef = records.modelRef("task", taskId);
  app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(taskId);
  const result: TaskResult = { id: crypto.randomUUID(), taskId, runId: crypto.randomUUID(), status: "failed", reportKind: "partial",
    report: "## 指定版本报告\n\n" + "旧版本证据。".repeat(3000) + "\n\nEXACT_REPORT_END", reason: "部分检查未完成", unfinished: ["待核验项"], sideEffects: "没有修改文件", startedAt: 1, endedAt: 2 };
  const row = records.own(scope, taskId);
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'failed',?,1)").run(result.runId, row.sessionId, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
  app.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(result.id, taskId, result.runId, JSON.stringify(result));
  const resultRef = records.modelRef("result", result.id);
  const call = (id: string, name: TaskTool, params: unknown): ChatMessage => ({ id: `call-${id}`, role: "assistant", text: "", calls: [{ id, name, input: JSON.stringify(params) }] });
  const reply = async (id: string, name: TaskTool, details: unknown) => {
    const tool = taskTools(async () => details).find(tool => tool.name === name)!;
    const native = await tool.execute(id, {}, undefined, undefined, {} as never);
    const model = JSON.parse((native.content[0] as { text: string }).text);
    assert.ok(!("runId" in model) && !("taskRef" in model) && !("resultRef" in model));
    const message = chatMessage({ role: "toolResult", toolCallId: id, toolName: name, ...native, timestamp: Date.now() }, `tool-${id}`)!;
    put(message);
    return model;
  };
  put(call("delegate", "delegate", { context: "共享背景", tasks: [{ title: "短引用界面检查", task: "检查交付" }] }));
  assert.deepEqual(await reply("delegate", "delegate", { ...created, taskRefs: [taskRef], status: "queued" }), { taskIds: [taskRef], status: "queued" });
  app.agents.publish(tasksScope(scope), records.list(scope));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const cards = page.locator("#messages .subagents");
  await cards.getByRole("button", { name: "打开子会话：短引用界面检查", exact: true }).waitFor();
  put(call("read", "read_result", { taskId: taskRef, resultId: resultRef }),
    call("append", "append", { taskId: taskRef, summary: "补查指定交付", text: "继续核验" }),
    call("stop", "cancel_task", { taskId: taskRef }));
  const full = { ...result, taskRef, resultRef };
  assert.equal((await reply("read", "read_result", full)).report, result.report);
  assert.deepEqual(await reply("append", "append", { taskId, inputId: "input-uuid", runId: null, status: "queued" }), { status: "queued" });
  assert.deepEqual(await reply("stop", "cancel_task", { taskId, status: "completed" }), { status: "completed" });
  const reading = page.locator('.task-operation[data-tool="read_result"]');
  await reading.getByText("已读取", { exact: true }).waitFor();
  assert.equal(await reading.locator(".task-operation-heading").innerText(), "短引用界面检查");
  for (const name of ["append", "cancel_task"]) assert.ok((await page.locator(`.task-operation[data-tool="${name}"] .task-operation-heading`).innerText()).includes("短引用界面检查"));
  assert.equal(await reading.locator(".markdown").count(), 0, "report remains lazy");
  await reading.locator("summary").first().focus();
  await page.keyboard.press("Enter");
  await reading.getByRole("heading", { name: "指定版本报告" }).waitFor();
  await reading.getByText("EXACT_REPORT_END", { exact: true }).waitFor();
  // Inspect the actual disclosed execution output, not just native content or card labels.
  const executionOutput = async (operation: Locator) => {
    const details = operation.locator(":scope > details");
    if (await details.getAttribute("open") === null) await details.locator("summary").first().click();
    const raw = operation.locator(".task-call-raw");
    await raw.locator("summary").click();
    const text = await raw.locator("pre").nth(1).innerText();
    await raw.locator("summary").click();
    return text;
  };
  const readOutput = JSON.parse(await executionOutput(reading));
  assert.deepEqual(readOutput, { status: result.status, report: result.report, reportKind: result.reportKind, reason: result.reason, unfinished: result.unfinished, sideEffects: result.sideEffects });
  const append = page.locator('.task-operation[data-tool="append"]');
  const stop = page.locator('.task-operation[data-tool="cancel_task"]');
  assert.equal(await executionOutput(append), '{"status":"queued"}');
  assert.equal(await executionOutput(stop), '{"status":"completed"}');
  // Presentation must not destroy the complete stored identity/receipt data.
  assert.equal(JSON.parse(views.message(scope, "tool-append", true)!.text).inputId, "input-uuid");
  assert.ok((await reading.innerText()).includes("本次交付 · 失败"));
  assert.ok((await reading.innerText()).includes("待核验项"));
  await reading.getByRole("button", { name: "打开子会话" }).click();
  const child = page.getByRole("dialog", { name: "子代理会话", exact: true });
  await child.waitFor();
  assert.equal(await child.locator(".subagent-dialog-heading strong").innerText(), "短引用界面检查");
  assert.equal(await child.locator(".task-brief").count(), 1);
  await child.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
  // A newer delivery changes task state, never the already-read immutable report.
  const newer = { ...result, id: crypto.randomUUID(), runId: crypto.randomUUID(), status: "completed", report: "NEWER_REPORT" };
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed',?,3)").run(newer.runId, row.sessionId, "{}");
  app.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(newer.id, taskId, newer.runId, JSON.stringify(newer));
  app.agents.publish(tasksScope(scope), records.list(scope));
  await reading.getByText("EXACT_REPORT_END", { exact: true }).waitFor();
  assert.equal(await reading.getByText("NEWER_REPORT", { exact: true }).count(), 0);
  await reading.locator("summary").first().click();
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}`);
    for (const card of await page.locator(".task-operation, .delegation-card").all()) assert.ok(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `card overflow at ${width}`);
    await page.screenshot({ path: join(artifacts, `refs-${width}.png`) });
  }
  await page.reload();
  await reading.getByText("已读取", { exact: true }).waitFor();
  assert.equal(await reading.locator(".markdown").count(), 0);
  await reading.locator("summary").first().click();
  await reading.getByText("EXACT_REPORT_END", { exact: true }).waitFor();
  assert.equal(await reading.getByText("NEWER_REPORT", { exact: true }).count(), 0);
  assert.deepEqual(JSON.parse(await executionOutput(reading)), readOutput);
  assert.equal(await executionOutput(append), '{"status":"queued"}');
  assert.equal(await executionOutput(stop), '{"status":"completed"}');
  assert.deepEqual(errors, []);
  console.log(`PASS: short-reference delegate/read/append/cancel, metadata-free disclosed execution outputs before/after reload, intact stored receipts, UUID child window, lazy full exact report, newer-result isolation, keyboard and responsive cards. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
