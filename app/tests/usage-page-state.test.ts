import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyUsageDraft, readUsagePageState, saveUsagePageState, usagePageStateKey, type UsagePageState } from "../src/client/usage-page-state.js";
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const state = (): UsagePageState => ({ draft: { ...emptyUsageDraft(), query: "draft" }, applied: emptyUsageDraft(), requested: true, page: 2, pageSize: 20, snapshot: { workspace: "", id: "snapshot" } });
test("warm navigation remembers only local query intent, not report or account data", () => {
  const local = storage(), input = { ...state(), report: { private: "NOT_SAVED" }, account: { token: "NOT_SAVED" } };
  saveUsagePageState(input, local, 1000);
  assert.deepEqual(readUsagePageState(local, 1001), state()); assert.ok(!local.getItem(usagePageStateKey)!.includes("NOT_SAVED"));
  assert.equal(readUsagePageState(local, 301000), undefined); assert.equal(local.getItem(usagePageStateKey), null);
});
test("malformed, oversized and invalid filters never become automatic local queries", () => {
  const local = storage();
  for (const raw of ["{", "x".repeat(8193), JSON.stringify({ ...state(), savedAt: 1000, page: -1 }), JSON.stringify({ ...state(), savedAt: 1000, applied: { ...emptyUsageDraft(), provider: "not-json" } })]) {
    local.setItem(usagePageStateKey, raw); assert.equal(readUsagePageState(local, 1001), undefined);
  }
  saveUsagePageState(state(), local, 1000); assert.equal(readUsagePageState(local, 999), undefined);
});
test("blocked storage never breaks page entry or query intent saves", () => {
  const local = { getItem() { throw Error("denied"); }, setItem() { throw Error("full"); }, removeItem() { throw Error("denied"); } };
  assert.equal(readUsagePageState(local), undefined); assert.doesNotThrow(() => saveUsagePageState(state(), local));
});
