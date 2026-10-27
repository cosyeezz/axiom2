import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptSnapshot, scopeSnapshot, SESSION_CACHE_BYTES, SESSION_CACHE_ENTRIES, subscribeScope } from "../src/client/transport.js";
import { HistoryCache } from "../src/client/chat/history-cache.js";
import { optimisticStart, optimisticState, pendingMessages } from "../src/client/chat/optimistic.js";

test("collection observers see atomic replacement and duplicate consumers unsubscribe symmetrically", () => {
  const scope = "messages:atomic:s";
  const offCollection = subscribeScope(scope, () => {});
  acceptSnapshot({ type: "snapshot", scope, streamId: "atomic", seq: 1, data: [{ id: "old", role: "user", text: "old" }] });
  const observed: unknown[] = [];
  const listener = () => observed.push([scopeSnapshot("message:atomic:s:old"), scopeSnapshot("message:atomic:s:new")]);
  const a = subscribeScope("message:atomic:s:old", listener), b = subscribeScope("message:atomic:s:old", listener);
  a(); a();
  acceptSnapshot({ type: "snapshot", scope, streamId: "atomic", seq: 2, data: [{ id: "new", role: "user", text: "new" }] });
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], [undefined, { id: "new", role: "user", text: "new" }]);
  const offThread = subscribeScope("thread:atomic:s", () => {});
  acceptSnapshot({ type: "snapshot", scope, streamId: "atomic", seq: 10, data: [], thread: { ids: [], contextRevision: 2 } });
  acceptSnapshot({ type: "snapshot", scope: "message:atomic:s:new", streamId: "atomic", seq: 9, data: { id: "new", text: "must not resurrect" } });
  acceptSnapshot({ type: "snapshot", scope: "thread:atomic:s", streamId: "atomic", seq: 9, data: { ids: ["new"] } });
  assert.equal(scopeSnapshot("message:atomic:s:new"), undefined);
  assert.deepEqual(scopeSnapshot("thread:atomic:s"), { ids: [], contextRevision: 2 });
  offThread(); b(); offCollection();
});

test("session LRU preserves mounted scopes, ignores late snapshots, and reconciles before component mount", () => {
  let seq = 0;
  const event = (scope: string, data: unknown) => acceptSnapshot({ type: "snapshot", scope, streamId: "test", seq: ++seq, data });
  const a = { workspaceId: "w", sessionId: "a" };
  const unpin = subscribeScope("messages:w:a", () => {});
  event("messages:w:a", [{ id: "a1", role: "user", text: "retained" }]);
  for (let i = 0; i < SESSION_CACHE_ENTRIES + 3; i++) {
    const off = subscribeScope(`messages:w:s${i}`, () => {});
    event(`messages:w:s${i}`, [{ id: "m", role: "user", text: String(i) }]);
    off();
  }
  assert.equal((scopeSnapshot<any>("message:w:a:a1"))?.text, "retained");
  assert.equal(scopeSnapshot("message:w:s0:m"), undefined);
  event("messages:w:s0", [{ id: "m", role: "user", text: "late" }]);
  assert.equal(scopeSnapshot("message:w:s0:m"), undefined);
  optimisticStart(a, "request", { text: "same", attachment: null });
  event("message:w:a:real", { id: "real", role: "user", text: "same", inputIds: ["request"] });
  assert.equal(pendingMessages(a).length, 0, "no Message component required");
  optimisticState(a, "request", "accepted", "real");
  assert.equal(pendingMessages(a).length, 0, "late receipt cannot resurrect a bubble");
  event("messages:w:a", [{ id: "compaction", role: "notice", text: "summary" }]);
  assert.equal(scopeSnapshot("message:w:a:real"), undefined, "reset removes compacted messages");
  unpin();
});

test("switching back within twelve sessions reuses cached content until the size budget", () => {
  let seq = 0;
  const visit = (id: string, bytes = 0) => {
    const off = subscribeScope(`messages:r:${id}`, () => {});
    acceptSnapshot({ type: "snapshot", scope: `messages:r:${id}`, streamId: "rotate", seq: ++seq, data: [{ id: "m", role: "user", text: id }] }, 0, 0, bytes);
    off();
  };
  for (let i = 0; i < 12; i++) visit(`s${i}`);
  for (let i = 0; i < 12; i++) assert.equal(scopeSnapshot<any>(`message:r:s${i}:m`)?.text, `s${i}`, `s${i} still cached`);
  // Each parsed snapshot counts twice its wire length; four sessions exceed the budget.
  for (let i = 0; i < 4; i++) visit(`big${i}`, SESSION_CACHE_BYTES / 6);
  assert.equal(scopeSnapshot("message:r:big0:m"), undefined, "oldest large session evicted by size");
  assert.equal(scopeSnapshot<any>("message:r:big3:m")?.text, "big3");
  const history = new HistoryCache();
  for (let i = 0; i < 12; i++) history.set(`h${i}`, { index: { revision: "r", segments: [] }, ranges: [], bytes: 1000 } as any);
  for (let i = 0; i < 12; i++) assert.ok(history.get(`h${i}`), `history h${i} still cached`);
});
