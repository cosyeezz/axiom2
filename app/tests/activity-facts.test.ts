import assert from "node:assert/strict";
import { test } from "node:test";
import { messageFacts } from "../src/client/chat/ActivityFacts.js";
import { emptyTasks, type TaskList } from "../src/shared/tasks.js";
import type { ChatMessage } from "../src/shared/agent.js";

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
test("100/1000/5000 hidden tool facts need one result lookup per call and preserve call order", () => {
  for (const count of [100, 1000, 5000]) {
    const message: ChatMessage = { id: "m", role: "assistant", text: "", status: "completed",
      calls: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, name: "read", input: '{}' })) };
    let reads = 0;
    const facts = messageFacts(message, 0, () => { reads++; return null; }, emptyTasks);
    assert.equal(reads, count); assert.equal(facts.length, count + 1); assert.equal(facts.at(-1)![0], `c${count - 1}`);
  }
});
