import assert from "node:assert/strict";
import { test } from "node:test";
import { titleCardPosition, titleProcessCandidate } from "../src/shared/title-card.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import type { ProcessingSummary } from "../src/shared/processing.js";
const item: ProcessingSummary = { id: "title", workspaceId: "work", sessionId: "session", kind: "session.title", title: "标题生成", state: "running", stage: "准备", runId: "first", startedAt: 1, endedAt: null, error: null };
test("real title attempts include running and error states, but not empty-memory checks", () => {
  for (const state of ["running", "cancelling", "failed", "cancelled", "interrupted", "invalidated"] as const) assert.equal(titleProcessCandidate({ ...item, state }), true);
  assert.equal(titleProcessCandidate({ ...item, state: "completed", outcome: "applied" }), true);
  assert.equal(titleProcessCandidate({ ...item, state: "completed", outcome: "not_applied" }), true);
  assert.equal(titleProcessCandidate({ ...item, outcome: "no_evidence" }), false);
  assert.equal(titleProcessCandidate({ ...item, state: "completed" }), false);
  assert.equal(titleProcessCandidate({ ...item, kind: "memory.query" }), false);
});
test("exact trigger is stable across later rounds and repeated message parts", () => {
  const positions = [{ ids: ["u1"], runIds: ["first"] }, { ids: ["a1"], runIds: ["first"] }, { ids: ["a1"], runIds: ["first"] }, { ids: ["u2"], runIds: ["later"] }];
  assert.equal(titleCardPosition({ ...item, anchorMessageId: "a1" }, positions), 2);
  assert.equal(titleCardPosition(item, positions), 0, "legacy belongs to first explicit row of its run");
  assert.equal(titleCardPosition({ ...item, anchorMessageId: "missing" }, positions), -1, "missing explicit anchor is not guessed from another message");
  assert.equal(titleCardPosition({ ...item, runId: "missing" }, positions), -1);
  assert.equal(titleCardPosition({ ...item, runId: undefined }, positions), -1);
});
test("collapsed history belongs to its catalogue range, expanded history to the trigger row", () => {
  const r = { ...item, anchorMessageId: "a1" };
  assert.equal(titleCardPosition(r, [{ ids: ["u1", "a1"], runIds: ["first"] }, { ids: ["u2"], runIds: ["later"] }]), 0);
  assert.equal(titleCardPosition(r, [{ ids: ["u1"], runIds: ["first"] }, { ids: ["a1"], runIds: ["first"] }, { ids: ["u2"], runIds: ["later"] }]), 1);
});
test("catalogue publishes only run identities alongside existing visible message IDs", () => {
  const groups = threadGroups([
    { id: "u", role: "user", text: "sensitive request", runId: "first" },
    { id: "a", role: "assistant", text: "sensitive response", runId: "first", phase: "final_answer", status: "completed" },
    { id: "u2", role: "user", text: "next", runId: "later" },
  ]);
  assert.deepEqual(groups.map(g => g.runIds), [["first"], ["first"], ["later"]]);
  assert.doesNotMatch(JSON.stringify(groups), /sensitive/);
});
