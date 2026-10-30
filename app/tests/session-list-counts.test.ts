import assert from "node:assert/strict";
import test from "node:test";
import type { SessionListCounts } from "../src/shared/session-list.js";
import { SessionListCountsModel, type SessionListCountsReader } from "../src/client/workspaces/session-list-counts.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const scope = (id: string, workspaceId = "a") => ({ workspaceId, sessionId: id });
const key = (id: string, workspaceId = "a") => JSON.stringify([workspaceId, id]);
type Call = { workspaceId: string; ids: string[]; signal: AbortSignal; resolve(value: SessionListCounts): void; reject(error: Error): void };
function harness() {
  const calls: Call[] = [];
  const reader: SessionListCountsReader = {
    counts: (workspaceId, ids, signal) => new Promise((resolve, reject) => calls.push({ workspaceId, ids, signal, resolve, reject })),
  };
  const model = new SessionListCountsModel(reader);
  const answer = (index: number, count: number | undefined = 7) => {
    const call = calls[index];
    call.resolve({ workspaceId: call.workspaceId, items: call.ids.map(sessionId => ({ sessionId, messageCount: count })) });
  };
  return { model, calls, answer };
}

test("visible counts are grouped by actual workspace, at most 30 per batch and two concurrent", async t => {
  const h = harness(); t.after(() => h.model.dispose());
  for (let i = 0; i < 65; ++i) h.model.enter(scope(`s${i}`));
  h.model.enter(scope("foreign", "b")); await tick();
  assert.deepEqual(h.calls.map(call => call.ids.length), [30, 30]);
  assert(h.calls.every(call => call.workspaceId === "a"));
  h.answer(0); await tick(); assert.equal(h.calls.length, 3); assert.equal(h.calls[2].ids.length, 5);
  h.answer(1); await tick(); assert.equal(h.calls.length, 4);
  assert.equal(h.calls[3].workspaceId, "b"); assert.deepEqual(h.calls[3].ids, ["foreign"]);
  h.answer(2, 0); h.answer(3, 123); await tick();
  assert.equal(h.model.getSnapshot().values.size, 66);
  assert.equal(h.model.getSnapshot().values.get(key("s60"))?.messageCount, 0);
  assert.equal(h.model.getSnapshot().values.get(key("foreign", "b"))?.messageCount, 123);
});

test("equal-revision invalidation generations coalesce and stale replies never publish", async t => {
  const h = harness(); t.after(() => h.model.dispose()); h.model.enter(scope("x")); await tick();
  for (let i = 0; i < 20; ++i) h.model.invalidate(); await tick();
  assert.equal(h.calls.length, 1); // busy keys cannot be read twice concurrently
  h.answer(0, 10); await tick(); assert.equal(h.calls.length, 2);
  assert.equal(h.model.getSnapshot().values.has(key("x")), false);
  h.answer(1, 11); await tick();
  assert.deepEqual(h.model.getSnapshot().values.get(key("x")), { messageCount: 11, stale: false });
  await tick(); assert.equal(h.calls.length, 2);
});

test("zero is exact and an unavailable reply replaces a previously known number", async t => {
  const h = harness(); t.after(() => h.model.dispose()); h.model.enter(scope("x")); await tick();
  h.answer(0, 0); await tick(); assert.equal(h.model.getSnapshot().values.get(key("x"))?.messageCount, 0);
  h.model.invalidate(); await tick();
  assert.deepEqual(h.model.getSnapshot().values.get(key("x")), { messageCount: 0, stale: true });
  h.calls[1].resolve({ workspaceId: "a", items: [{ sessionId: "x" }] }); await tick();
  assert.deepEqual(h.model.getSnapshot().values.get(key("x")), { messageCount: undefined, stale: false });
});

test("leaving and reentering the same ID cannot accept its old registration reply", async t => {
  const h = harness(); t.after(() => h.model.dispose()); const leave = h.model.enter(scope("x")); await tick();
  leave(); assert.equal(h.calls[0].signal.aborted, true); h.model.enter(scope("x"));
  h.answer(0, 90); await tick();
  assert.equal(h.model.getSnapshot().values.has(key("x")), false); assert.equal(h.calls.length, 2);
  h.answer(1, 91); await tick(); assert.equal(h.model.getSnapshot().values.get(key("x"))?.messageCount, 91);
});

test("a partially visible batch ignores exited rows without aborting the other visible row", async t => {
  const h = harness(); t.after(() => h.model.dispose()); const leave = h.model.enter(scope("x")); h.model.enter(scope("y")); await tick();
  leave(); assert.equal(h.calls[0].signal.aborted, false); h.answer(0); await tick();
  assert.equal(h.model.getSnapshot().values.has(key("x")), false);
  assert.equal(h.model.getSnapshot().values.get(key("y"))?.messageCount, 7);
});

test("malformed and failed batches remain unknown and do not spin until a new invalidation", async t => {
  const h = harness(); t.after(() => h.model.dispose()); h.model.enter(scope("x")); await tick();
  h.calls[0].resolve({ workspaceId: "foreign", items: [{ sessionId: "x", messageCount: 99 }] }); await tick();
  assert.equal(h.model.getSnapshot().values.get(key("x"))?.messageCount, undefined);
  await tick(); assert.equal(h.calls.length, 1);
  h.model.invalidate(); await tick(); h.calls[1].reject(new Error("offline")); await tick();
  assert.equal(h.calls.length, 2); assert.equal(h.model.getSnapshot().values.get(key("x"))?.stale, true);
  h.model.invalidate(); await tick(); h.answer(2, 4); await tick();
  assert.equal(h.model.getSnapshot().values.get(key("x"))?.messageCount, 4);
});

test("duplicate and negative counts invalidate the whole reply rather than partially applying", async t => {
  const h = harness(); t.after(() => h.model.dispose()); h.model.enter(scope("x")); h.model.enter(scope("y")); await tick();
  h.calls[0].resolve({ workspaceId: "a", items: [{ sessionId: "x", messageCount: 8 }, { sessionId: "x", messageCount: 9 }] }); await tick();
  assert.equal(h.model.getSnapshot().values.get(key("x"))?.messageCount, undefined);
  h.model.invalidate(); await tick();
  h.calls[1].resolve({ workspaceId: "a", items: [{ sessionId: "x", messageCount: 8 }, { sessionId: "y", messageCount: -1 }] }); await tick();
  assert.equal(h.model.getSnapshot().values.get(key("x"))?.messageCount, undefined);
  assert.equal(h.model.getSnapshot().values.get(key("y"))?.messageCount, undefined);
});

test("dispose synchronously aborts pending reads and late completion cannot publish", async () => {
  const h = harness(); h.model.enter(scope("x")); await tick(); h.model.dispose();
  const stable = h.model.getSnapshot(); assert.equal(h.calls[0].signal.aborted, true);
  h.answer(0); await tick(); assert.equal(h.model.getSnapshot(), stable);
  h.model.invalidate(); h.model.enter(scope("y")); await tick(); assert.equal(h.calls.length, 1);
});
