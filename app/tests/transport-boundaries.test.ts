import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptSnapshot, scopeSnapshot, subscribeScope } from "../src/client/transport.js";
import { optimisticStart, optimisticState, pendingMessages } from "../src/client/chat/optimistic.js";

test("session LRU preserves mounted scopes, ignores late snapshots, and reconciles before component mount", () => {
  let seq = 0;
  const event = (scope: string, data: unknown) => acceptSnapshot({ type: "snapshot", scope, streamId: "test", seq: ++seq, data });
  const a = { workspaceId: "w", sessionId: "a" };
  const unpin = subscribeScope("messages:w:a", () => {});
  event("messages:w:a", [{ id: "a1", role: "user", text: "retained" }]);
  for (let i = 0; i < 8; i++) {
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
