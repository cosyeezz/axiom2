import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../src/shared/agent.js";
import { taskToolName } from "../src/shared/tasks.js";
import { callObject, readTaskReport, taskCallLabel, taskCallStatus, taskExecutionText } from "../src/client/tasks/task-call.js";

const parent: ChatMessage = { id: "parent", role: "assistant", text: "", status: "completed" };
const result: ChatMessage = { id: "tool-call", role: "toolResult", text: "", status: "completed" };
test("task calls distinguish completion of a tool-call message from receipt of the tool result", () => {
  assert.equal(taskCallStatus(null, parent), "unknown");
  assert.equal(taskCallStatus(null, { ...parent, streaming: true }), "running");
  assert.equal(taskCallStatus(null, { ...parent, status: "cancelled" }), "cancelled");
  assert.equal(taskCallStatus(result, { ...parent, status: "failed" }), "completed");
  assert.equal(taskCallStatus({ ...result, error: "Rejected" }, parent), "failed");
});
test("append and cancellation receipts never claim work has finished before confirmation", () => {
  assert.equal(taskCallLabel("append", "completed", { status: "queued" }), "已受理");
  assert.equal(taskCallLabel("cancel_task", "completed", { status: "stopping" }), "停止已受理");
  assert.equal(taskCallLabel("cancel_task", "completed", null), "停止已受理");
  assert.equal(taskCallLabel("cancel_task", "completed", { status: "cancelled" }), "已停止");
  assert.equal(taskCallLabel("cancel_task", "completed", { status: "completed" }), "任务已结束");
});
test("report parsing binds the immutable delivery to both requested IDs and preserves failed-task status", () => {
  const report = { id: "old-result", taskId: "task", runId: "old-run", status: "failed", report: "已有产出", reason: "超时", unfinished: ["未完成"], sideEffects: "未记录副作用" };
  const text = JSON.stringify(report);
  assert.deepEqual(readTaskReport(text, { taskId: "task", resultId: "old-result" }), report);
  assert.equal(readTaskReport(text, { taskId: "task", resultId: "new-result" }), null);
  assert.equal(readTaskReport(text, { taskId: "another-task", resultId: "old-result" }), null);
  assert.equal(readTaskReport(text.slice(0, -1), { taskId: "task", resultId: "old-result" }), null);
  assert.equal(readTaskReport(JSON.stringify({ ...report, unfinished: [12] }), { taskId: "task", resultId: "old-result" }), null);
  assert.equal(taskCallLabel("read_result", "completed", report), "已读取", "reading a failed delivery is still a successful read");
});
test("historical result cards omit generated tool logs and warnings while preserving actual findings", () => {
  const report = { id: "result", taskId: "task", runId: "run", status: "completed", report: "已定位并修复配置问题。", reason: null,
    unfinished: ["模型报告不等于全部验收通过；请核对交付中的未验证项。", "工作预算已到，集成验证尚未运行。"],
    sideEffects: "read：已记录返回；bash：失败。文件及外部副作用未回滚。" };
  const input = { taskId: report.taskId, resultId: report.id };
  for (const sideEffects of [report.sideEffects, "未记录工具返回。文件及外部副作用未回滚。", ""]) {
    const parsed = readTaskReport(JSON.stringify({ ...report, sideEffects }), input)!;
    assert.equal(parsed.report, report.report);
    assert.deepEqual(parsed.unfinished, [report.unfinished[1]]);
    assert.equal(parsed.sideEffects, "");
  }
  const actual = { ...report, status: "failed", reason: "集成环境不可用", unfinished: ["集成验证尚未运行"], sideEffects: "已修改 config.json；尚未发布。" };
  assert.deepEqual(readTaskReport(JSON.stringify(actual), input), actual);
});
test("execution output hides stored metadata while full records still support cards and exact report matching", () => {
  for (const name of ["append", "cancel_task"] as const) {
    const receipt = { taskId: "task-uuid", inputId: "input-uuid", runId: null, startedAt: 1, status: "queued" };
    const message = { ...result, text: JSON.stringify(receipt) }, before = structuredClone(message);
    assert.equal(taskExecutionText(name, message), '{"status":"queued"}');
    assert.deepEqual(message, before, "display projection must not mutate the stored receipt");
    assert.equal(callObject(message.text)!.inputId, "input-uuid");
  }
  const full = { id: "result-uuid", taskId: "task-uuid", runId: "run-uuid", taskRef: "t1", resultRef: "r2",
    status: "cancelled", report: "完整正文".repeat(5000), reportKind: "partial", reason: "预算耗尽", unfinished: ["未完成验证"],
    sideEffects: "已修改配置", budgetSummary: true, stop: { source: "budget", reason: "截止时间", requestedAt: 123 }, startedAt: 1, endedAt: 2, elapsedMs: 1 };
  const message = { ...result, text: JSON.stringify(full) };
  const visible = JSON.parse(taskExecutionText("read_result", message));
  assert.deepEqual(visible, { status: full.status, report: full.report, reportKind: full.reportKind, reason: full.reason,
    unfinished: full.unfinished, sideEffects: full.sideEffects, budgetSummary: true, stop: { source: "budget", reason: "截止时间" } });
  assert.equal(readTaskReport(message.text, { taskId: "t1", resultId: "r2" })!.id, "result-uuid");
  assert.equal(readTaskReport(message.text, { taskId: "t1", resultId: "r3" }), null);
  assert.doesNotMatch(taskExecutionText("read_result", message), /uuid|requestedAt|startedAt|endedAt|elapsedMs/);
});
test("execution output preserves errors and avoids exposing truncated JSON metadata", () => {
  const text = '{"taskId":"task-uuid","inputId":"input-uuid","status":"queued"}';
  assert.equal(taskExecutionText("append", { ...result, text, truncated: true }), "完整输出尚未加载");
  assert.equal(taskExecutionText("append", { ...result, text: "拒绝追加", status: "failed" }), "拒绝追加");
  assert.equal(taskExecutionText("read_result", { ...result, text: "", error: "读取失败" }), "读取失败");
  assert.equal(taskExecutionText("append", { ...result, text: "调用已停止", status: "cancelled" }), "调用已停止");
  assert.equal(taskExecutionText("append", { ...result, text: "legacy plain output" }), "legacy plain output");
  assert.equal(taskExecutionText(null, { ...result, text }), text);
  assert.equal(taskExecutionText("append", null), "尚未记录输出");
});
test("namespaced tools and malformed streaming parameters have safe presentation fallbacks", () => {
  assert.equal(taskToolName("functions.append"), "append");
  assert.equal(taskToolName("other.append"), null);
  assert.equal(callObject('{"tasks":['), null);
  assert.equal(callObject("[]"), null);
  assert.equal(callObject("null"), null);
});
