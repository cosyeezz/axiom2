import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import { setImmediate as turn, setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { MaintenanceError } from "../src/shared/maintenance.js";
import { monotonicMilliseconds, superviseLinuxOwnedChild } from "../src/server/owned-process-linux.js";

function fixture(t: TestContext, options: {
  deadline?: number;
  beforeStart?: () => Promise<void>;
  write?: (line: string, callback: (error?: Error | null) => void) => void;
} = {}) {
  const nonce = randomUUID(), sent: string[] = [];
  const control = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const line = String(chunk).trimEnd(); sent.push(line);
      if (options.write) options.write(line, callback); else callback();
    },
  });
  t.after(() => control.destroy());
  const child = Object.assign(new EventEmitter(), { stdio: [null, null, null, null, control] }) as unknown as ChildProcess;
  const timeout = new MaintenanceError("total-timeout", "fixture 超时");
  const owner = superviseLinuxOwnedChild(child, nonce, options.deadline ?? monotonicMilliseconds() + 10_000, () => timeout, options.beforeStart);
  const frame = (line: string) => control.push(line);
  const ready = async () => { frame(`READY ${nonce} 42 123\n`); await owner.ready; };
  return { child, control, nonce, sent, owner, timeout, frame, ready };
}

test("Linux protocol acknowledges verified cleanup and stops refreshing its deadline", async t => {
  const f = fixture(t); await f.ready();
  const closing = f.owner.close();
  f.owner.setDeadline(monotonicMilliseconds() + 20_000);
  assert.deepEqual(f.sent, ["GO", "STOP"]);
  f.frame(`CLEANED ${f.nonce} 1 9\n`); await closing;
  assert.equal(f.owner.failure(), undefined);
  assert.deepEqual(f.sent, ["GO", "STOP", `ACK ${f.nonce}`]);
  f.control.emit("error", Object.assign(Error("late EPIPE"), { code: "EPIPE" }));
  assert.equal(f.owner.failure(), undefined, "transport failure cannot revoke already verified cleanup");
});

test("Linux protocol keeps verified cleanup when an earlier STOP write callback fails late", async t => {
  let finishStop!: (error?: Error | null) => void;
  const f = fixture(t, { write(line, callback) { if (line === "STOP") finishStop = callback; else callback(); } });
  await f.ready();
  const closing = f.owner.close();
  f.frame(`CLEANED ${f.nonce} 1 9\n`); await turn();
  finishStop(Object.assign(Error("late write failure"), { code: "EPIPE" }));
  await turn(); await closing;
  assert.equal(f.owner.failure(), undefined);
});

for (const receipt of ["missing", "wrong-nonce", "truncated"]) {
  test(`Linux protocol refuses launcher-only exit with ${receipt} cleanup proof`, async t => {
    const f = fixture(t); await f.ready();
    const closing = f.owner.close();
    if (receipt === "wrong-nonce") f.frame(`CLEANED ${randomUUID()} 1 9\n`);
    if (receipt === "truncated") f.frame(`CLEANED ${f.nonce} 1`);
    await turn(); f.child.emit("close", 0, null);
    await assert.rejects(closing, (error: unknown) => error instanceof MaintenanceError && error.code === "stop-unconfirmed");
    assert.ok(!f.sent.some(line => line.startsWith("ACK ")));
  });
}

test("Linux protocol accepts queued valid proof after a transport callback failed", async t => {
  const f = fixture(t); await f.ready();
  const closing = f.owner.close();
  f.control.emit("error", Object.assign(Error("late STOP callback"), { code: "EPIPE" }));
  assert.equal((f.owner.failure() as MaintenanceError).code, "stop-unconfirmed");
  f.frame(`CLEANED ${f.nonce} 1 9\n`); await closing;
  assert.equal(f.owner.failure(), undefined);
});

test("Linux protocol tolerates an ACK write failure after verified proof", async t => {
  const f = fixture(t, { write(line, callback) {
    if (line.startsWith("ACK ")) callback(Object.assign(Error("late ACK"), { code: "EPIPE" }));
    else callback();
  } });
  await f.ready(); const closing = f.owner.close();
  f.frame(`CLEANED ${f.nonce} 1 9\n`); await closing; await turn();
  assert.equal(f.owner.failure(), undefined);
});

test("Linux protocol retains uncertainty when transport closes before cleanup proof", async t => {
  const f = fixture(t); await f.ready();
  const closing = f.owner.close();
  f.control.destroy(Object.assign(Error("receipt lost"), { code: "ECONNRESET" }));
  await turn(); f.child.emit("close", 0, null);
  await assert.rejects(closing, (error: unknown) => error instanceof MaintenanceError && error.code === "stop-unconfirmed");
});

test("Linux protocol reports a proved deadline before READY as timeout and ACKs after expiry", async t => {
  const f = fixture(t, { deadline: monotonicMilliseconds() - 1 });
  f.frame(`CLEANED ${f.nonce} 2 9\n`);
  await assert.rejects(f.owner.ready, error => error === f.timeout);
  await f.owner.close();
  assert.equal(f.owner.failure(), f.timeout);
  assert.deepEqual(f.sent, [`ACK ${f.nonce}`]);
});

test("Linux protocol does not publish GO when the deadline expires while arming", async t => {
  let entered!: () => void, release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const deadline = monotonicMilliseconds() + 30;
  const f = fixture(t, { deadline, beforeStart: async () => { entered(); await barrier; } });
  f.frame(`READY ${f.nonce} 42 123\n`); await entering;
  while (monotonicMilliseconds() < deadline) await delay(5);
  release(); await assert.rejects(f.owner.ready, error => error === f.timeout);
  assert.ok(!f.sent.includes("GO"));
  f.frame(`CLEANED ${f.nonce} 2 9\n`); await f.owner.close();
  assert.equal(f.owner.failure(), f.timeout);
});

for (const corruption of ["duplicate-ready", "native-error"]) {
  test(`Linux protocol preserves ${corruption} after transport error and valid cleanup`, async t => {
    const f = fixture(t); await f.ready();
    f.control.emit("error", Error("late transport callback"));
    f.frame(corruption === "duplicate-ready" ? `READY ${f.nonce} 42 123\n` : `ERROR ${f.nonce} 5 0\n`);
    f.frame(`CLEANED ${f.nonce} 1 9\n`); await turn(); await f.owner.close();
    assert.ok(f.owner.failure(), "cleanup proof must not clear a distinct protocol/domain failure");
  });
}

test("Linux protocol corruption remains uncertain even if a valid receipt follows", async t => {
  const f = fixture(t); await f.ready();
  f.frame(`CLEANED ${randomUUID()} 1 9\nCLEANED ${f.nonce} 1 9\n`); await turn();
  await f.owner.close();
  const failure = f.owner.failure();
  assert.ok(failure instanceof MaintenanceError && failure.code === "stop-unconfirmed");
});
