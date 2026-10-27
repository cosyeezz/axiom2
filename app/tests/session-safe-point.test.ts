import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSession, BoundaryState } from "@earendil-works/pi-coding-agent";
import { installSessionSafePointHooks, sessionSafePoint, type SafePointOperation, type SafePointSource, type SafePointState } from "../src/server/session-safe-point.js";

const idle = { isIdle: true, isCompacting: false, agent: { state: { isStreaming: false } } };
const busy = { ...idle, isIdle: false, agent: { state: { isStreaming: true } } };
const boundary = (outcome: BoundaryState["outcome"] = "completed", draft = false): SafePointSource => ({
  phase: "boundary", boundary: { outcome, entries: draft ? [{ type: "custom_message", customType: "fixture", content: "draft", display: false }] : [] },
});
const operations: SafePointOperation[] = ["snapshot", "compression-apply", "compression-memory", "model-switch", "reload-pause", "resource-reload", "network-rebind", "request-launch"];
const allowed = (source: SafePointSource, state: SafePointState = { session: busy }) => {
  const point = sessionSafePoint(source, state);
  return operations.filter(operation => point.allows(operation));
};

test("one admission matrix separates native drafts, committed turns, idle and writer release", () => {
  assert.deepEqual(allowed(boundary()), ["snapshot", "compression-apply", "compression-memory"]);
  assert.deepEqual(allowed(boundary("completed", true)), ["snapshot", "compression-memory"], "do not conflict with earlier boundary drafts");
  for (const outcome of ["error", "aborted"] as const) {
    assert.deepEqual(allowed(boundary(outcome)), ["snapshot"], "legacy child snapshots remain possible, but no failed draft application");
  }
  assert.deepEqual(allowed({ phase: "after-turn" }), ["model-switch", "reload-pause", "network-rebind"]);
  assert.deepEqual(allowed({ phase: "before-next-turn" }), ["model-switch", "network-rebind"]);
  assert.deepEqual(allowed({ phase: "before-request" }), [], "a live low-level request is not a safe point");
  assert.deepEqual(allowed({ phase: "idle" }), [], "an active Session is not idle");
  assert.deepEqual(allowed({ phase: "idle" }, { session: idle }), ["snapshot", "compression-apply", "model-switch", "resource-reload", "network-rebind"]);
  for (const active of [false, true]) for (const owned of [false, true]) {
    assert.deepEqual(allowed({ phase: "released", active, owned }), active || owned ? [] : ["snapshot", "compression-apply"]);
  }
  assert.deepEqual(allowed({ phase: "worker-idle", requestInFlight: false }), ["network-rebind"]);
  assert.deepEqual(allowed({ phase: "worker-idle", requestInFlight: true }), []);
  assert.deepEqual(allowed({ phase: "idle" }, {}), ["network-rebind"], "initial network binding does not grant Session mutation");
});

test("native request gaps include retries but exclude compaction, cancellation and lifecycle transitions", () => {
  const gap = { ...busy, agent: idle.agent };
  assert.deepEqual(allowed({ phase: "before-request" }, { session: gap }), ["model-switch", "network-rebind", "request-launch"], "Session may remain busy between native runs");
  assert.deepEqual(allowed({ phase: "before-request" }, { session: { ...gap, isCompacting: true } }), []);
  const abort = new AbortController(); abort.abort();
  assert.deepEqual(allowed({ phase: "after-turn", signal: abort.signal }), []);
  for (const source of [boundary(), { phase: "after-turn" }, { phase: "idle" }] as SafePointSource[]) {
    assert.deepEqual(allowed(source, { session: idle, cancelled: true }), []);
    assert.deepEqual(allowed(source, { session: idle, requestsBlocked: true }), []);
  }
  for (const flag of ["inputClosed", "transitioning"] as const) {
    assert.deepEqual(allowed({ phase: "after-turn" }, { session: busy, [flag]: true }), []);
    assert.deepEqual(allowed({ phase: "idle" }, { session: idle, [flag]: true }), ["snapshot", "compression-apply", "resource-reload"], "settling retains owned-idle context/resource work");
    assert.deepEqual(allowed({ phase: "before-request" }, { session: gap, [flag]: true }), ["request-launch"], "native abort/phase handoff must not become a new execution error");
  }
});

function fixture() {
  const events: string[] = [];
  const agent = {
    state: { isStreaming: false },
    prompt: async () => { events.push("request"); },
    continue: async () => { events.push("continue"); },
    finishTurn: async () => { events.push("all-tools-and-drafts-committed"); return { action: "continue" }; },
    prepareNextTurnWithContext: async () => { events.push("native-window-check-and-prepare"); },
  };
  const session = { agent, isIdle: false, isCompacting: false } as unknown as AgentSession;
  let transitioning = false, blocked = false, pause = false;
  installSessionSafePointHooks(session, {
    state: () => ({ session, transitioning, requestsBlocked: blocked }),
    applyModel: async source => {
      if (sessionSafePoint(source, { session, transitioning, requestsBlocked: blocked }).allows("model-switch")) events.push(`switch:${source.phase}`);
    },
    pauseReload: async (_turn, _signal, decision) => {
      assert.deepEqual(decision, { action: "continue" });
      if (pause) { events.push("reload-pause-without-awaiting-settlement"); return { action: "end" }; }
    },
  });
  return { session, events, transition: () => { transitioning = true; }, block: () => { blocked = true; }, pause: () => { pause = true; } };
}

test("shared Pi hooks keep draft commit before selection and selection before the next native window check", async () => {
  const f = fixture(), turn = {} as Parameters<NonNullable<AgentSession["agent"]["finishTurn"]>>[0];
  await f.session.agent.prompt([]);
  assert.deepEqual(await f.session.agent.finishTurn!(turn), { action: "continue" });
  await f.session.agent.prepareNextTurnWithContext!(turn);
  await f.session.agent.continue();
  assert.deepEqual(f.events, ["switch:before-request", "request", "all-tools-and-drafts-committed", "switch:after-turn", "switch:before-next-turn", "native-window-check-and-prepare", "switch:before-request", "continue"]);
});

test("reload pauses only after commit and does not await the lifecycle it is inside", async () => {
  const f = fixture(); f.pause();
  const turn = {} as Parameters<NonNullable<AgentSession["agent"]["finishTurn"]>>[0];
  assert.deepEqual(await f.session.agent.finishTurn!(turn), { action: "end" });
  assert.deepEqual(f.events, ["all-tools-and-drafts-committed", "switch:after-turn", "reload-pause-without-awaiting-settlement"]);
  const transitioning = fixture(); transitioning.transition();
  assert.deepEqual(await transitioning.session.agent.finishTurn!(turn), { action: "continue" });
  assert.deepEqual(transitioning.events, ["all-tools-and-drafts-committed"]);
  await transitioning.session.agent.prompt([]);
  await transitioning.session.agent.continue();
  assert.deepEqual(transitioning.events, ["all-tools-and-drafts-committed", "request", "continue"], "late phase transitions skip selection, not native handoff");
  const blocked = fixture(); blocked.block();
  await assert.rejects(blocked.session.agent.prompt([]), /安全点/);
  await assert.rejects(blocked.session.agent.continue(), /安全点/);
  assert.deepEqual(blocked.events, []);
});
