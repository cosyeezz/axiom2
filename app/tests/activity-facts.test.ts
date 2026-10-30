import assert from "node:assert/strict";
import { test } from "node:test";
import { messageFacts } from "../src/client/chat/ActivityFacts.js";
import { emptyTasks, type TaskList } from "../src/shared/tasks.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { TaskWindowCounts } from "../src/shared/task-window.js";

test("bulk facts keep assistant outcome, local failures, task activity and actual notice evidence distinct", () => {
  const message: ChatMessage = { id: "m", role: "assistant", text: "", status: "completed", calls: [
    { id: "tool", name: "read", input: '{"path":"file"}' }, { id: "task", name: "delegate", input: '{}' },
  ] };
  const results = new Map<string, ChatMessage>([
    ["tool-tool", { id: "tool-tool", role: "toolResult", text: "failure", status: "failed" }],
    ["tool-task", { id: "tool-task", role: "toolResult", text: "{}", status: "completed" }],
  ]);
  const list = { ...emptyTasks, tasks: [{ id: "task1", anchor: "task", status: "running" }] } as TaskList;
  const facts = messageFacts(message, 4, (id) => results.get(id) ?? null, list);
  assert.deepEqual(facts.map(([id, fact]) => [id, fact.status, fact.order]), [
    ["message:m", "completed", [4, -1]], ["tool", "failed", [4, 0]], ["task", "running", [4, 1]],
  ]);
  assert.equal(facts[0][1].evidence, true);
  const notice = messageFacts({ id: "notice", role: "notice", text: "子代理执行失败", taskNotice: "failed" }, 5, () => null, emptyTasks);
  assert.equal(notice[0][1].kind, "notice"); assert.equal(notice[0][1].evidence, true);
});
test("window facts use whole-anchor counts, retain unknown and never override the tool's own outcome", () => {
  const message: ChatMessage = { id: "m", role: "assistant", text: "", status: "completed", calls: [
    { id: "ordinary", name: "read", input: '{}' }, { id: "batch", name: "delegate", input: '{}' },
  ] };
  const counts = (patch: Partial<Omit<TaskWindowCounts, "total">> = {}): TaskWindowCounts => {
    const value = { queued: 0, starting: 0, running: 0, stopping: 0, completed: 144, failed: 0, cancelled: 0, interrupted: 0, unknown: 0, ...patch };
    return { ...value, total: Object.values(value).reduce((a, b) => a + b, 0) };
  };
  const status = (value: TaskWindowCounts | null, resultStatus: ChatMessage["status"] = "completed") => {
    const anchors: string[] = [];
    const facts = messageFacts(message, 2, id => ({ id, role: "toolResult", text: "", status: resultStatus }), anchor => { anchors.push(anchor); return value; });
    assert.deepEqual(anchors, resultStatus === "completed" ? ["batch"] : []);
    assert.equal(facts[0][1].status, "completed", "task aggregation must not rewrite the assistant outcome");
    assert.equal(facts[1][1].status, resultStatus ?? "unknown", "ordinary tool is independent of tasks");
    return facts[2][1].status;
  };
  assert.equal(status(null), "unknown");
  assert.equal(status(counts({ unknown: 1, failed: 1 })), "unknown");
  for (const state of ["queued", "starting", "running", "stopping"] as const)
    assert.equal(status(counts({ [state]: 1, unknown: 1 })), "running");
  assert.equal(status(counts({ failed: 1 })), "failed");
  assert.equal(status(counts({ interrupted: 1 })), "failed");
  assert.equal(status(counts({ cancelled: 1 })), "cancelled");
  assert.equal(status(counts()), "completed");
  assert.equal(status(counts({ completed: 0 })), "completed", "empty current anchor preserves the tool receipt outcome, not a read witness");
  assert.equal(status(counts({ running: 1 }), "failed"), "failed");
  assert.equal(status(counts({ running: 1 }), "cancelled"), "cancelled");
  const missing = messageFacts(message, 2, () => null, () => { throw new Error("missing receipt must not consult task status"); });
  assert.equal(missing[2][1].status, "unknown");
});

test("empty streaming thinking is not content, while text, hidden thinking and outcomes are", () => {
  const base: ChatMessage = { id: "m", role: "assistant", text: "", thinkingActive: true, streaming: true };
  const content = (change: Partial<ChatMessage>) => messageFacts({ ...base, ...change }, 0, () => null, emptyTasks)[0][1].hasContent;
  assert.equal(content({}), false);
  assert.equal(content({ thinking: " \n\t", text: "  " }), false);
  assert.equal(content({ thinking: "实际思考" }), true);
  assert.equal(content({ thinking: "", thinkingLength: 100 }), true, "omitted thinking remains lazily accessible");
  assert.equal(content({ thinking: "", thinkingLength: 0 }), false);
  assert.equal(content({ text: "过程正文" }), true);
  assert.equal(content({ error: "请求失败" }), true);
  assert.equal(content({ status: "cancelled" }), true);
});
test("100/1000/5000 hidden tool facts need one result lookup per call and preserve call order", () => {
  for (const count of [100, 1000, 5000]) {
    const message: ChatMessage = { id: "m", role: "assistant", text: "", status: "completed",
      calls: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, name: "read", input: '{}' })) };
    let reads = 0;
    const facts = messageFacts(message, 0, () => { reads++; return null; }, emptyTasks);
    assert.equal(reads, count); assert.equal(facts.length, count + 1); assert.equal(facts.at(-1)![0], `c${count - 1}`);
  }
});
