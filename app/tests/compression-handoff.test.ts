import assert from "node:assert/strict";
import { test } from "node:test";
import { Compressions } from "../src/server/compressions.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function fixture() {
  const scope = { workspaceId: "workspace", sessionId: "session" };
  const coordinator: any = Object.create(Compressions.prototype);
  const live: any = { scope, job: { id: "new-job", state: "running", phase: "snapshot" }, cancel: false, controller: new AbortController() };
  coordinator.live = new Map([[scope.sessionId, live]]);
  coordinator.automatic = new Map();
  coordinator.applied = () => false;
  coordinator.save = () => {};
  coordinator.finish = (_live: unknown, state: string, error?: string) => {
    live.job.state = state;
    live.job.error = error;
    coordinator.live.delete(scope.sessionId);
  };
  return { scope, coordinator, live };
}

test("settling worker hands off snapshot/apply without failing or regenerating the job", () => {
  for (const phase of ["snapshot", "applying"]) {
    const { scope, coordinator, live } = fixture();
    live.job.phase = phase;
    const entry = phase === "applying" ? { summary: "already generated" } : undefined;
    live.entry = entry;
    const advanced: unknown[] = [];
    coordinator.advance = (value: unknown) => advanced.push(value);
    coordinator.event(scope, "old-run", { type: "compression-deferred", id: live.job.id });
    assert.equal(live.job.state, "running");
    assert.equal(advanced.length, 0, "wait for ownership release, not an IPC retry loop");
    coordinator.settled(scope, "old-run");
    assert.deepEqual(advanced, [live]);
    assert.equal(live.entry, entry, "handoff keeps the existing summary");
  }
});

test("worker ready delivers compression requested while startup had no IPC owner", () => {
  const { scope, coordinator, live } = fixture();
  const signals: unknown[] = [];
  coordinator.agents = {
    active: () => true,
    info: () => ({ run: { id: "new-run" } }),
    signal: (...args: unknown[]) => { signals.push(args); return true; },
  };
  coordinator.event(scope, "new-run", { type: "ready" });
  assert.deepEqual(signals, [[scope, "new-run", { type: "compression-snapshot", id: live.job.id }]]);
});

test("fresh compression ignores receipts from previous failed/cancelled jobs and reports actual errors", () => {
  const { scope, coordinator, live } = fixture();
  for (const type of ["compression-snapshot", "compression-applied", "compression-cancelled", "compression-deferred"])
    coordinator.event(scope, "old-run", { type, id: "old-job", ok: false });
  assert.equal(live.job.state, "running");
  assert.equal(live.cancelConfirmedRun, undefined);
  coordinator.event(scope, "new-run", { type: "compression-snapshot", id: live.job.id, ok: false, error: "snapshot disk unavailable" });
  assert.equal(live.job.state, "failed");
  assert.match(live.job.error, /snapshot disk unavailable/);
  assert.doesNotMatch(live.job.error, /可能已停止|正在退出/);
});

test("idle child snapshot waits for shutdown hooks and rechecks ownership after release", async () => {
  const { scope, coordinator, live } = fixture();
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "original", timestamp: Date.now() });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let idle = true, active = false, captured: any;
  const signals: unknown[] = [];
  coordinator.manager = () => manager;
  coordinator.snapshot = (_live: unknown, snapshot: unknown) => { captured = snapshot; };
  coordinator.agents = {
    active: () => active,
    hasIdle: () => idle,
    releaseIdle: () => released,
    info: () => ({ run: { id: "successor" }, task: { id: "child-without-memory" } }),
    signal: (...args: unknown[]) => { signals.push(args); return true; },
  };
  coordinator.advance(live);
  assert.equal(captured, undefined);
  manager.appendCustomMessageEntry("shutdown", "shutdown hook tail", true);
  idle = false;
  active = true;
  release();
  await released;
  assert.equal(captured, undefined, "a successor owns the session now");
  assert.deepEqual(signals, [[scope, "successor", { type: "compression-snapshot", id: live.job.id }]]);
  active = false;
  coordinator.settled(scope, "successor");
  assert.match(JSON.stringify(captured), /shutdown hook tail/);
});

test("cancelling during idle release cannot revive snapshot work", async () => {
  const { coordinator, live } = fixture();
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  coordinator.agents = { active: () => false, info: () => ({ task: { id: "child" } }), hasIdle: () => true, releaseIdle: () => released };
  coordinator.snapshot = () => assert.fail("cancelled job must not capture or launch");
  coordinator.advance(live);
  live.cancel = true;
  release();
  await released;
  assert.equal(live.entry, undefined);
});

test("idle main preparation launches once through normal admission and hands off to its worker", async () => {
  const { coordinator, live } = fixture();
  let launches = 0, active = false;
  const signals: unknown[] = [];
  coordinator.agents = {
    active: () => active, info: () => ({ run: { id: "maintenance" } }),
    command: async (_command: unknown, internal: any) => {
      launches++;
      assert.equal(internal.compressionPreparation.signal, live.controller.signal);
      internal.compressionPreparation.validate();
      active = true;
      internal.onStart({ id: "maintenance" });
    },
    signal: (...args: unknown[]) => { signals.push(args); return true; },
  };
  coordinator.snapshot = () => assert.fail("idle main must not capture before maintenance");
  coordinator.advance(live); coordinator.advance(live);
  await live.preparing;
  assert.equal(launches, 1);
  assert.equal(signals.length, 1);
  active = false;
  coordinator.settled(live.scope, "maintenance");
  assert.equal(live.job.state, "failed", "missing maintenance snapshot is not retried");
  assert.equal(launches, 1);
});

test("cancel before idle preparation dispatch cannot start a model run", async () => {
  const { coordinator, live } = fixture();
  coordinator.agents = { active: () => false, info: () => ({}), command: () => assert.fail("cancelled preparation must not launch") };
  coordinator.advance(live);
  live.cancel = true; live.controller.abort();
  await live.preparing;
  assert.equal(live.preparationRun, undefined);
});
