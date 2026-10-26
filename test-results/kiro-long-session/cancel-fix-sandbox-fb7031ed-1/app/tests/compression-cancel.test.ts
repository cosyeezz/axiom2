import assert from "node:assert/strict";
import { test } from "node:test";
import { Compressions } from "../src/server/compressions.js";

test("cancellation confirmation belongs to the worker run, not the whole compression job", async () => {
  const scope = { workspaceId: "workspace", sessionId: "session" };
  const signals: { runId: string; value: any }[] = [];
  let finished: string | undefined;
  // Exercise the real coordinator stop/event methods with controlled IPC. A has
  // settled while summarization continued; B now owns the queued apply.
  const coordinator: any = Object.create(Compressions.prototype);
  const live: any = {
    scope, job: { id: "job", state: "running", phase: "applying", error: null },
    cancel: false, cancelConfirmedRun: "run-A", applyRun: "run-B",
    controller: new AbortController(), exit: Promise.resolve(),
  };
  coordinator.live = new Map([[scope.sessionId, live]]);
  coordinator.epochs = new Map();
  coordinator.automatic = new Map();
  coordinator.records = { cancelling: () => {} };
  coordinator.store = { session: () => ({}) };
  coordinator.agents = {
    info: () => ({ run: { id: "run-B" } }),
    active: () => true,
    signal: (_scope: unknown, runId: string, value: any) => {
      signals.push({ runId, value });
      return true;
    },
  };
  // This fixture isolates run ownership from persistence, like applied/finish
  // below. stage() still executes, but its save() needs no database here.
  const savedStages: string[] = [];
  coordinator.save = (value: any) => { savedStages.push(value.job.stage); };
  coordinator.applied = () => false;
  coordinator.finish = (_live: unknown, state: string) => {
    finished = state;
    coordinator.live.delete(scope.sessionId);
  };
  const stopping = coordinator.stop(scope);
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    assert.deepEqual(savedStages, ["正在取消，等待安全点确认"]);
    assert.deepEqual(signals, [{ runId: "run-B", value: { type: "compression-cancel", id: "job" } }]);
    assert.equal(finished, undefined, "A's exit must not acknowledge cancellation of B's queued apply");
    coordinator.event(scope, "run-B", { type: "compression-cancelled", id: "job", applied: false });
    await stopping;
    assert.equal(finished, "cancelled");
    assert.equal(live.cancelConfirmedRun, "run-B");
  } finally {
    live.cancelAck?.();
    await stopping;
  }
});
