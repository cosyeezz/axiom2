import test from "node:test";
import assert from "node:assert/strict";
import cp from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { forkPidProcess, type PidProcessIdentity } from "../src/server/maintenance-process-pid.js";

// Mock every process operation: no signal is ever sent to a real PID.
test("reused worker PID/group is not adopted or signalled during capture and close", { timeout: 10000 }, async t => {
  const child = Object.assign(new EventEmitter(), { pid: 42424 });
  let reused = false, descendantGone = false;
  const saved: PidProcessIdentity[] = [], signals: { pid: number; name: string | number | undefined }[] = [];
  t.mock.method(cp, "fork", () => { queueMicrotask(() => child.emit("spawn")); return child; });
  t.mock.method(cp, "execFileSync", () => [
    `42424 1 42424 S ${reused ? "new-start" : "old-start"}`,
    ...(reused ? ["42425 42424 42424 S unrelated", "42426 42425 42426 S unrelated-detached"] : []),
    ...(!descendantGone ? [`42427 ${reused ? 1 : 42424} 42427 S owned-detached`] : []),
  ].join("\n"));
  t.mock.method(process, "kill", (pid: number, name: string | number | undefined) => {
    signals.push({ pid, name });
    if (pid === 42427) descendantGone = true;
    return true;
  });
  syncBuiltinESMExports();
  const handle = forkPidProcess("unused", {}, identity => saved.push(structuredClone(identity)));
  try {
    await handle.ready;
    await delay(250); // Capture the original detached descendant.
    assert.ok(saved.at(-1)!.members.some(member => member.pid === 42427));
    reused = true;
    child.emit("close", 0);
    await delay(250); // Also exercise periodic capture after PID reuse.
    // The unrelated live group keeps cleanup conservative, but must never be killed.
    await assert.rejects(handle.close(), { code: "stop-unconfirmed" });
    assert.deepEqual(signals, [{ pid: 42427, name: "SIGTERM" }]);
    for (const identity of saved) {
      assert.equal(identity.started, "old-start");
      assert.equal(identity.members.find(member => member.pid === 42424)?.started, "old-start");
      assert.ok(identity.members.every(member => member.pid === 42424 || member.pid === 42427));
    }
  } finally {
    await handle.close().catch(() => {});
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
