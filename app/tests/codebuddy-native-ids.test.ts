import assert from "node:assert/strict";
import { test } from "node:test";
import { codeBuddyUuid7, codeBuddySessionId, createCodeBuddyIdentityScope } from "../src/native-providers/codebuddy/ids.js";
const runPattern = /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("UUIDv7 uses CLI timestamp counter layout and lower-case encodings", () => {
  const start = Date.now(), ids = Array.from({ length: 2000 }, codeBuddyUuid7);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ids);
  for (const id of ids) {
    assert.match(id, runPattern);
    const time = parseInt(id.slice(0, 12), 16);
    assert.ok(time >= start && time <= Date.now());
  }
  assert.match(codeBuddySessionId(), sessionPattern);
});

test("host aliases stay RAM-only with stable session and run association within runtime", () => {
  const scope = createCodeBuddyIdentityScope(), other = createCodeBuddyIdentityScope();
  const first = scope.resolve("host-session", "host-run");
  assert.match(first.sessionId, sessionPattern); assert.match(first.continuationId, runPattern);
  assert.deepEqual(scope.resolve("host-session", "host-run"), first);
  const next = scope.resolve("host-session", "host-next");
  assert.equal(next.sessionId, first.sessionId); assert.notEqual(next.continuationId, first.continuationId);
  assert.notEqual(scope.resolve("other-session", "host-run").continuationId, first.continuationId);
  assert.notEqual(other.resolve("host-session", "host-run").sessionId, first.sessionId);
  assert.notEqual(scope.resolve().sessionId, scope.resolve().sessionId);
  assert.notEqual(scope.resolve("host-session").continuationId, scope.resolve("host-session").continuationId);
  for (let i = 0; i < 300; i++) scope.resolve("host-session", `many-run-${i}`);
  assert.deepEqual(scope.resolve("host-session", "host-run"), first, "live run identities must not be capacity-evicted");
  for (let i = 0; i < 300; i++) scope.resolve(`many-session-${i}`, "host-run");
  assert.deepEqual(scope.resolve("host-session", "host-run"), first, "live session identities must not be capacity-evicted");
  scope.clear(); assert.notEqual(scope.resolve("host-session", "host-run").sessionId, first.sessionId);
});
