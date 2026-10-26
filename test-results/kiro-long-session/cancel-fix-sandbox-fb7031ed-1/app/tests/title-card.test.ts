import assert from "node:assert/strict";
import { test } from "node:test";
import { titleCardCandidate, titleCardResult } from "../src/shared/title-card.js";
import type { ProcessingRecord } from "../src/shared/processing.js";

function record(): ProcessingRecord {
  return { id: "title", workspaceId: "work", sessionId: "session", kind: "session.title", title: "根据记忆生成标题",
    state: "completed", outcome: "applied", stage: "标题已生效", startedAt: 1, endedAt: 1001, error: null, stages: [],
    result: { text: JSON.stringify({ title: "真实生成标题", applied: true }), truncated: false },
    calls: [{ id: "call", stage: "生成标题", state: "completed", startedAt: 1, sentAt: 2, endedAt: 1001 }] };
}

test("title card requires a real, successful model call and a validated terminal result", () => {
  const r = record();
  assert.equal(titleCardCandidate(r), true);
  assert.deepEqual(titleCardResult(r), { title: "真实生成标题", applied: true });
  const unapplied = record(); unapplied.outcome = "not_applied";
  unapplied.result!.text = JSON.stringify({ title: "手动命名优先", applied: false });
  assert.deepEqual(titleCardResult(unapplied), { title: "手动命名优先", applied: false });
  assert.equal(r.calls.length, 1, "projection never creates tasks or modifies original records");
});

test("checks, pending, failed, cancelled and invalidated outputs never create a result card", () => {
  for (const state of ["running", "cancelling", "failed", "cancelled", "interrupted", "invalidated"] as const) {
    assert.equal(titleCardResult({ ...record(), state }), undefined, state);
  }
  for (const outcome of [undefined, "no_evidence", "no_match", "incomplete"] as const) {
    assert.equal(titleCardResult({ ...record(), outcome }), undefined, String(outcome));
  }
  assert.equal(titleCardResult({ ...record(), kind: "memory.query" }), undefined);
  assert.equal(titleCardResult({ ...record(), calls: [] }), undefined);
  for (const call of [{ ...record().calls[0], sentAt: undefined }, { ...record().calls[0], state: "failed" as const },
    { ...record().calls[0], error: "model failed" }]) {
    assert.equal(titleCardResult({ ...record(), calls: [call] }), undefined);
  }
});

test("malformed, missing, inconsistent or truncated results do not borrow a title from elsewhere", () => {
  assert.equal(titleCardResult({ ...record(), result: undefined }), undefined);
  assert.equal(titleCardResult({ ...record(), result: { ...record().result!, truncated: true } }), undefined);
  for (const result of ["bad json", "null", "[]", "123", '"标题"', JSON.stringify({ title: "新标题" }),
    JSON.stringify({ title: "新标题", applied: false }), JSON.stringify({ title: "新标题", applied: "true" }),
    ...["", " ", " 标题", "标题 ", "12345678901234", "标题\n说明", "<标题>", "\ud800"].map(title => JSON.stringify({ title, applied: true }))]) {
    assert.equal(titleCardResult({ ...record(), result: { text: result, truncated: false } }), undefined, result);
  }
  assert.deepEqual(titleCardResult({ ...record(), result: { text: JSON.stringify({ title: "😀".repeat(13), applied: true }), truncated: false } }),
    { title: "😀".repeat(13), applied: true });
});
