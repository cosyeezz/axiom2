import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "../src/shared/agent.js";
import { taskToolName } from "../src/shared/tasks.js";
import { callObject, readTaskReport, taskCallLabel, taskCallStatus } from "../src/client/tasks/task-call.js";

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
test("namespaced tools and malformed streaming parameters have safe presentation fallbacks", () => {
  assert.equal(taskToolName("functions.append"), "append");
  assert.equal(taskToolName("other.append"), null);
  assert.equal(callObject('{"tasks":['), null);
  assert.equal(callObject("[]"), null);
  assert.equal(callObject("null"), null);
});
