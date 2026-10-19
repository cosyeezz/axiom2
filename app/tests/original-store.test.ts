import assert from "node:assert/strict";
import { test } from "node:test";
import { OriginalStore } from "../src/client/chat/original-store.js";
import { DerivedCache } from "../src/client/chat/derived-cache.js";
import type { ChatMessage } from "../src/shared/agent.js";
const message = (id: string, text = id): ChatMessage => ({ id, role: "user", text });
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("RAW coalesces reads, preserves successful data through errors/retry, and isolates disposed views", async () => {
  const reads: { resolve: (messages: ChatMessage[]) => void; reject: (error: Error) => void; signal: AbortSignal }[] = [];
  const store = new OriginalStore((signal) => new Promise((resolve, reject) => reads.push({ resolve, reject, signal })), (e) => e.message);
  store.request("one"); reads[0].resolve([message("archive"), message("tail")]); await turn();
  const archived = store.get("archive");
  let archiveChanges = 0; store.subscribeMessage("archive", () => archiveChanges++);
  store.request("two"); store.request("three"); store.request("four");
  assert.equal(reads.length, 2);
  reads[1].resolve([message("obsolete")]); await turn();
  assert.equal(reads.length, 3); assert.equal(store.get("archive"), archived); assert.equal(store.get("obsolete"), null);
  reads[2].reject(new Error("failed refresh")); await turn();
  assert.equal(store.state.hasData, true); assert.equal(store.state.error, "failed refresh");
  assert.equal(store.get("archive"), archived); assert.equal(reads.length, 3, "no automatic error retry loop");
  store.retry(); assert.equal(store.get("archive"), archived);
  reads[3].resolve([message("archive"), message("tail", "changed")]); await turn();
  assert.equal(store.state.revision, "four"); assert.equal(store.get("archive"), archived); assert.equal(archiveChanges, 0);
  store.request("five"); store.request("six"); store.dispose();
  assert.equal(reads[4].signal.aborted, true);
  reads[4].resolve([message("late")]); await turn();
  assert.equal(store.get("late"), null); assert.equal(reads.length, 5);
});
test("an empty successful RAW snapshot is distinct from first-load failure", async () => {
  const store = new OriginalStore(async () => [], (e) => e.message);
  store.request("empty"); await turn();
  assert.equal(store.state.hasData, true); assert.deepEqual(store.state.groups, []); store.dispose();
  const failed = new OriginalStore(async () => { throw Error("first"); }, (e) => e.message);
  failed.request("empty"); await turn(); assert.equal(failed.state.hasData, false); assert.equal(failed.state.error, "first"); failed.dispose();
});
test("pure parsing cache is bounded by both entries and estimated retained text bytes", () => {
  const cache = new DerivedCache(100, 2);
  let builds = 0;
  const parse = () => { builds++; return ["token"]; };
  cache.get("a", parse); cache.get("a", parse); assert.equal(builds, 1);
  cache.get("b", parse); cache.get("c", parse); cache.get("a", parse); assert.equal(builds, 4);
  cache.get("x".repeat(100), parse); assert.ok(cache.bytes <= 100);
  cache.clear(); assert.equal(cache.bytes, 0);
});
