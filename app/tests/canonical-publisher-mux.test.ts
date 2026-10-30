import test from "node:test";
import assert from "node:assert/strict";
import type { AgentSession, AgentSessionEvent, AgentSessionEventListener } from "@earendil-works/pi-coding-agent";
import { installCanonicalPublisherMux, type CanonicalPublisherInvocation, type CanonicalPublisherMux } from "../src/server/canonical-publisher-mux.js";

type Options = Parameters<typeof installCanonicalPublisherMux>[0];
type Event = Extract<AgentSessionEvent, { type: "session_info_changed" }>;
const event = (name = "E"): Event => ({ type: "session_info_changed", name });

// Test-owned simulation of the pinned SDK array algorithm, NOT an SDK publisher.
class FixturePublisher implements Pick<AgentSession, "subscribe" | "dispose"> {
  private listeners: AgentSessionEventListener[] = [];
  readonly rawSubscribed: AgentSessionEventListener[] = [];
  readonly delivered: AgentSessionEventListener[] = [];
  readonly removed: AgentSessionEventListener[] = [];
  readonly refuseRemoval = new Set<AgentSessionEventListener>();
  disposeCalls = 0;
  subscribe(listener: AgentSessionEventListener) {
    this.rawSubscribed.push(listener);
    this.listeners.push(listener);
    return () => {
      this.removed.push(listener);
      if (this.refuseRemoval.has(listener)) throw Error("test-owned unsubscribe failure");
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }
  emit(value: AgentSessionEvent) {
    for (const listener of this.listeners) { this.delivered.push(listener); listener(value); }
  }
  dispose() { this.disposeCalls++; this.listeners = []; }
}
type Observation = { kind: "begin" | "end" | "seal"; invocation: CanonicalPublisherInvocation; event?: AgentSessionEvent; outcome?: "returned" | "threw" };
function setup(overrides: Partial<Omit<Options, "publisher">> = {}, publisher = new FixturePublisher()) {
  const records: Observation[] = [], revoked: boolean[] = [];
  let handle!: CanonicalPublisherMux;
  handle = installCanonicalPublisherMux({ publisher,
    onBegin: (invocation, event) => { records.push({ kind: "begin", invocation, event }); return undefined; },
    onDispatchEnd: (invocation, outcome) => { records.push({ kind: "end", invocation, outcome }); return undefined; },
    onSeal: (invocation, event) => { records.push({ kind: "seal", invocation, event }); return undefined; },
    onRevoke: () => { revoked.push(handle.active()); return undefined; },
    ...overrides,
  });
  return { publisher, handle, records, revoked };
}
function capture(work: () => void) {
  let caught = false, value: unknown;
  try { work(); } catch (error) { caught = true; value = error; }
  return { caught, value };
}
function normal(records: Observation[]) {
  assert.deepEqual(records.map(r => r.kind), ["begin", "end", "seal"]);
  assert.strictEqual(records[0]!.invocation, records[1]!.invocation);
  assert.strictEqual(records[0]!.invocation, records[2]!.invocation);
  assert.equal(records[1]!.outcome, "returned");
}

// Type contracts only. This function is never invoked; a structural fixture is intentionally accepted.
function readonlyContracts(h: CanonicalPublisherMux, o: Options, i: CanonicalPublisherInvocation) {
  // @ts-expect-error readonly function property
  h.active = () => true;
  // @ts-expect-error readonly function property
  h.revoke = () => {};
  // @ts-expect-error readonly option property
  o.publisher = new FixturePublisher();
  // @ts-expect-error readonly hook property
  o.onBegin = () => undefined;
  // @ts-expect-error readonly hook property
  o.onDispatchEnd = () => undefined;
  // @ts-expect-error readonly hook property
  o.onSeal = () => undefined;
  // @ts-expect-error required readonly cancel hook
  o.onRevoke = () => undefined;
  // @ts-expect-error no public phase ingress
  h.dispatch;
  // @ts-expect-error no public phase ingress
  h.ingest;
  // @ts-expect-error no native manager authority
  h.manager;
  // @ts-expect-error no source witness authority
  h.witness;
  // @ts-expect-error invocation has no native entry payload
  i.nativeId;
  // @ts-expect-error invocation is not a caller phase tuple
  i.phase;
  // @ts-expect-error asynchronous internal hooks are not accepted
  const asyncHook: Options["onBegin"] = async () => {};
  // @ts-expect-error invalid end discriminant
  const wrongEnd: Options["onDispatchEnd"] = (_i, _end: "maybe") => undefined;
  // @ts-expect-error invalid SDK listener input
  o.publisher.subscribe((_event: number) => {});
  // @ts-expect-error cancellation hook is required for all consumers
  const missingCancel: Options = { publisher: o.publisher, onBegin: o.onBegin, onDispatchEnd: o.onDispatchEnd, onSeal: o.onSeal };
  void asyncHook; void wrongEnd; void missingCancel;
}
void readonlyContracts;

test("installation is passive and normal invocation identities are distinct and frozen", () => {
  const { publisher, handle, records } = setup();
  assert.equal(publisher.rawSubscribed.length, 3);
  assert.equal(new Set(publisher.rawSubscribed).size, 3);
  assert.equal(records.length, 0);
  assert.equal(Object.isFrozen(handle), true);
  assert.deepEqual(Object.keys(handle).sort(), ["active", "revoke"]);
  const value = event(); publisher.emit(value); normal(records);
  assert.strictEqual(records[0]!.event, value); assert.strictEqual(records[2]!.event, value);
  assert.equal(Object.isFrozen(records[0]!.invocation), true);
  assert.equal(Object.isFrozen(value), false);
  const first = records[0]!.invocation; records.length = 0;
  publisher.emit(value); normal(records); assert.notStrictEqual(records[0]!.invocation, first);
});

test("ordinary callback order is bracketed by Begin End Seal", () => {
  const trace: string[] = [];
  const { publisher } = setup({ onBegin: () => { trace.push("begin"); return undefined; }, onDispatchEnd: () => { trace.push("end"); return undefined; }, onSeal: () => { trace.push("seal"); return undefined; } });
  publisher.subscribe(() => { trace.push("A"); }); publisher.subscribe(() => { trace.push("B"); });
  assert.deepEqual(trace, []); assert.equal(publisher.rawSubscribed.length, 3);
  publisher.emit(event()); assert.deepEqual(trace, ["begin", "A", "B", "end", "seal"]);
});

for (const kind of ["self", "previous", "future"] as const) test(`live deletion preserves ${kind} index movement`, () => {
  const { publisher, records } = setup(); const trace: string[] = [];
  let ua = () => {}, ub = () => {};
  ua = publisher.subscribe(() => { trace.push("A"); if (kind === "self") ua(); if (kind === "future") ub(); });
  ub = publisher.subscribe(() => { trace.push("B"); if (kind === "previous") ua(); });
  if (kind !== "self") publisher.subscribe(() => { trace.push("C"); });
  publisher.emit(event());
  assert.deepEqual(trace, kind === "self" ? ["A"] : kind === "previous" ? ["A", "B"] : ["A", "C"]);
  normal(records);
});

test("duplicate callbacks use indexOf and a reused unsubscribe can remove later registration", () => {
  const { publisher } = setup(); const trace: string[] = [];
  const f = () => { trace.push("f"); }, g = () => { trace.push("g"); };
  const old = publisher.subscribe(f), second = publisher.subscribe(f); publisher.subscribe(g);
  second(); publisher.emit(event()); assert.deepEqual(trace, ["f", "g"]);
  trace.length = 0; second(); second(); publisher.emit(event()); assert.deepEqual(trace, ["g"]);
  trace.length = 0; publisher.subscribe(f); old(); publisher.emit(event()); assert.deepEqual(trace, ["g"]);
});

test("duplicate self-unsubscribe skips the second duplicate but not the next distinct callback", () => {
  const { publisher, records } = setup(); const trace: string[] = []; let stop = () => {};
  const f = () => { trace.push("f"); stop(); };
  publisher.subscribe(f); stop = publisher.subscribe(f); publisher.subscribe(() => { trace.push("g"); });
  publisher.emit(event()); assert.deepEqual(trace, ["f", "g"]); normal(records);
});

for (const cancel of [false, true]) test(`same-dispatch append is live, cancel=${cancel}`, () => {
  const { publisher, records } = setup(); const trace: string[] = [];
  publisher.subscribe(() => { trace.push("A"); const remove = publisher.subscribe(() => { trace.push("C"); }); if (cancel) remove(); });
  publisher.subscribe(() => { trace.push("B"); }); publisher.emit(event());
  assert.deepEqual(trace, cancel ? ["A", "B"] : ["A", "B", "C"]); normal(records);
});

test("listeners are plain calls with a shared unfrozen event", () => {
  const { publisher } = setup(); const value = event("before"); let receiver: unknown = 1, original: unknown, seen: string | undefined, argumentCount = 0;
  publisher.subscribe(function (this: unknown, e) { argumentCount = arguments.length; receiver = this; original = e; if (e.type === "session_info_changed") e.name = "after"; });
  publisher.subscribe(e => { if (e.type === "session_info_changed") seen = e.name; });
  publisher.emit(value); assert.equal(argumentCount, 1); assert.strictEqual(receiver, undefined); assert.strictEqual(original, value); assert.equal(seen, "after");
  assert.equal(value.name, "after"); value.name = "later"; assert.equal(value.name, "later");
});

for (const sentinel of [{ reason: "user" }, undefined]) test(`user throw ${sentinel === undefined ? "undefined" : "object"} closes only its frame`, () => {
  const { publisher, records } = setup(); let fail = true, later = 0;
  publisher.subscribe(() => { if (fail) throw sentinel; }); publisher.subscribe(() => { later++; });
  const result = capture(() => publisher.emit(event())); assert.equal(result.caught, true); assert.strictEqual(result.value, sentinel);
  assert.equal(later, 0); assert.deepEqual(records.map(r => [r.kind, r.outcome]), [["begin", undefined], ["end", "threw"]]);
  assert.strictEqual(records[0]!.invocation, records[1]!.invocation); const failed = records[0]!.invocation;
  fail = false; records.length = 0; publisher.emit(event()); normal(records); assert.equal(later, 1); assert.notStrictEqual(records[0]!.invocation, failed);
});

test("Promise and safe thenable returns are neither awaited nor inspected", async () => {
  const { publisher, records } = setup(); const trace: string[] = []; let reads = 0;
  const pending = new Promise<void>(() => {});
  const rejected = Promise.reject(new Error("test-owned rejection")); const handled = rejected.catch(() => undefined);
  publisher.subscribe(() => pending); publisher.subscribe(() => rejected);
  publisher.subscribe(() => ({ get then() { reads++; return undefined; } })); publisher.subscribe(() => { trace.push("last"); });
  publisher.emit(event()); assert.deepEqual(trace, ["last"]); assert.equal(reads, 0); normal(records); await handled;
});

for (const same of [false, true]) test(`nested invocations are distinct even with shared event=${same}`, () => {
  const { publisher, records } = setup(); const trace: string[] = []; const outer = event("outer"), inner = same ? outer : event("inner"); let depth = 0;
  publisher.subscribe(() => { trace.push(`A${depth}`); if (depth === 0) { depth++; publisher.emit(inner); depth--; } });
  publisher.subscribe(() => { trace.push(`B${depth}`); }); publisher.emit(outer);
  assert.deepEqual(trace, ["A0", "A1", "B1", "B0"]);
  assert.deepEqual(records.map(r => r.kind), ["begin", "begin", "end", "seal", "end", "seal"]);
  const o = records[0]!.invocation, i = records[1]!.invocation; assert.notStrictEqual(o, i);
  assert.deepEqual(records.slice(2).map(r => [o, i].indexOf(r.invocation)), [1, 1, 0, 0]);
});

test("three levels of the same event have independent LIFO invocations", () => {
  const { publisher, records } = setup(); const value = event(), trace: string[] = []; let depth = 0;
  publisher.subscribe(() => { trace.push(`A${depth}`); if (depth < 2) { depth++; publisher.emit(value); depth--; } });
  publisher.subscribe(() => { trace.push(`B${depth}`); }); publisher.emit(value);
  assert.deepEqual(trace, ["A0", "A1", "A2", "B2", "B1", "B0"]);
  assert.deepEqual(records.map(r => r.kind), ["begin", "begin", "begin", "end", "seal", "end", "seal", "end", "seal"]);
  const identities = records.slice(0, 3).map(r => r.invocation); assert.equal(new Set(identities).size, 3);
  assert.deepEqual(records.slice(3).map(r => identities.indexOf(r.invocation)), [2, 2, 1, 1, 0, 0]);
});

test("inner live deletion affects both captured iterators", () => {
  const { publisher, records } = setup(); const trace: string[] = []; let depth = 0, remove = () => {};
  remove = publisher.subscribe(() => { trace.push(`A${depth}`); if (!depth) { depth++; publisher.emit(event()); depth--; } else remove(); });
  publisher.subscribe(() => { trace.push(`B${depth}`); }); publisher.emit(event());
  assert.deepEqual(trace, ["A0", "A1"]); assert.deepEqual(records.map(r => r.kind), ["begin", "begin", "end", "seal", "end", "seal"]);
});

for (const asyncFacade of [false, true]) test(`failed nested frame cannot steal outer Seal, async simulation=${asyncFacade}`, async () => {
  const { publisher, records } = setup(); const trace: string[] = []; const value = event(); const sentinel = { inner: true }; let depth = 0, exercise = true;
  let handled: Promise<unknown> | undefined;
  // This async facade is test-owned simulation, not SDK sendCustomMessage.
  const simulatedAsync = async () => { publisher.emit(value); };
  publisher.subscribe(() => {
    trace.push(`A${depth}`); if (!exercise) return; if (depth) throw sentinel;
    depth++;
    if (asyncFacade) handled = simulatedAsync().catch(error => error);
    else { const result = capture(() => publisher.emit(value)); assert.equal(result.caught, true); assert.strictEqual(result.value, sentinel); }
    depth--;
  });
  publisher.subscribe(() => { trace.push(`B${depth}`); }); publisher.emit(value);
  assert.deepEqual(trace, ["A0", "A1", "B0"]); assert.deepEqual(records.map(r => [r.kind, r.outcome]), [["begin", undefined], ["begin", undefined], ["end", "threw"], ["end", "returned"], ["seal", undefined]]);
  const o = records[0]!.invocation, i = records[1]!.invocation; assert.notStrictEqual(o, i);
  assert.strictEqual(records[2]!.invocation, i); assert.strictEqual(records[3]!.invocation, o); assert.strictEqual(records[4]!.invocation, o);
  if (handled) assert.strictEqual(await handled, sentinel);
  exercise = false; records.length = 0; publisher.emit(event("next")); normal(records);
  assert.notStrictEqual(records[0]!.invocation, o); assert.notStrictEqual(records[0]!.invocation, i);
});

for (const kind of ["onBegin", "onDispatchEnd", "onSeal"] as const) test(`${kind} sync failure revokes observation without stopping users`, () => {
  const { publisher, handle, revoked } = setup({ [kind]: () => { throw new Error("passive hook failure"); } }); const trace: string[] = [];
  publisher.subscribe(() => { trace.push("A"); }); publisher.subscribe(() => { trace.push("B"); });
  const result = capture(() => publisher.emit(event())); assert.equal(result.caught, false); assert.deepEqual(trace, ["A", "B"]);
  assert.equal(handle.active(), false); assert.deepEqual(revoked, [false]); trace.length = 0;
  publisher.subscribe(() => { trace.push("C"); }); publisher.emit(event()); assert.deepEqual(trace, ["A", "B", "C"]);
});

for (const sentinel of [{ user: true }, undefined]) test(`end/revoke failures preserve user throw ${sentinel === undefined ? "undefined" : "object"}`, () => {
  let revocations = 0;
  const { publisher, handle } = setup({ onDispatchEnd: () => { throw Error("end"); }, onRevoke: () => { revocations++; throw Error("cancel"); } });
  publisher.subscribe(() => { throw sentinel; }); const result = capture(() => publisher.emit(event()));
  assert.equal(result.caught, true); assert.strictEqual(result.value, sentinel); assert.equal(handle.active(), false); assert.equal(revocations, 1);
  handle.revoke(); assert.equal(revocations, 1);
});

test("manual revoke never clears users and supports subsequent ordinary registration", () => {
  const { publisher, handle, records, revoked } = setup(); const trace: string[] = [];
  publisher.subscribe(() => { trace.push("A"); handle.revoke(); }); publisher.subscribe(() => { trace.push("B"); });
  publisher.emit(event()); assert.deepEqual(trace, ["A", "B"]); assert.deepEqual(records.map(r => r.kind), ["begin"]); assert.deepEqual(revoked, [false]);
  trace.length = 0; publisher.subscribe(() => { trace.push("C"); }); publisher.emit(event()); assert.deepEqual(trace, ["A", "B", "C"]);
  assert.equal(records.length, 1); assert.equal(publisher.disposeCalls, 0); assert.equal(publisher.rawSubscribed.length, 3);
});

test("revoked routing still closes same-event reentry without observing it", () => {
  const { publisher, handle, records, revoked } = setup(); const value = event(), trace: string[] = []; let depth = 0;
  publisher.subscribe(() => { trace.push(`A${depth}`); if (!depth) { handle.revoke(); depth++; publisher.emit(value); depth--; } });
  publisher.subscribe(() => { trace.push(`B${depth}`); }); publisher.emit(value);
  assert.deepEqual(trace, ["A0", "A1", "B1", "B0"]); assert.deepEqual(records.map(r => r.kind), ["begin"]); assert.deepEqual(revoked, [false]);
  trace.length = 0; publisher.emit(value); assert.deepEqual(trace, ["A0", "A1", "B1", "B0"]); assert.equal(records.length, 1);
});

for (const kind of ["onBegin", "onDispatchEnd"] as const) test(`${kind} may cancel its own observation without interrupting users`, () => {
  let handle!: CanonicalPublisherMux;
  const state = setup({ [kind]: () => { handle.revoke(); return undefined; } }); handle = state.handle;
  let calls = 0; state.publisher.subscribe(() => { calls++; }); state.publisher.subscribe(() => { calls++; }); state.publisher.emit(event());
  assert.equal(calls, 2); assert.equal(handle.active(), false); assert.deepEqual(state.revoked, [false]);
  assert.deepEqual(state.records.map(r => r.kind), kind === "onBegin" ? [] : ["begin"]);
});

test("terminal dispose preserves the old iterator and old unsubscribe checks the new empty table", () => {
  const { publisher, handle, records, revoked } = setup(); const trace: string[] = []; let removeB = () => {};
  publisher.subscribe(() => { trace.push("A"); publisher.dispose(); removeB(); });
  removeB = publisher.subscribe(() => { trace.push("B"); }); publisher.subscribe(() => { trace.push("C"); });
  const physicalSeal = publisher.rawSubscribed[2]!; publisher.emit(event());
  assert.deepEqual(trace, ["A", "B", "C"]); assert.equal(publisher.delivered.filter(l => l === physicalSeal).length, 1);
  assert.equal(handle.active(), false); assert.deepEqual(revoked, [false]); assert.deepEqual(records.map(r => r.kind), ["begin"]); removeB();
});

test("post-terminal subscribe fallback delegates only, without claiming lifecycle reuse", () => {
  const { publisher, handle, records } = setup(); publisher.dispose();
  const listener = () => {}; const remove = publisher.subscribe(listener);
  assert.equal(publisher.rawSubscribed.length, 4); assert.strictEqual(publisher.rawSubscribed[3], listener);
  remove(); assert.strictEqual(publisher.removed.at(-1), listener); assert.equal(handle.active(), false); assert.deepEqual(records, []);
  // Deliberately no post-dispose emission or old/new unsubscribe equivalence claim.
});

test("throwing original dispose preserves its error and permanently revokes, without claiming reset state", () => {
  const publisher = new FixturePublisher(), sentinel = { dispose: true }; let activeDuring: boolean | undefined;
  publisher.dispose = () => { activeDuring = handle.active(); throw sentinel; };
  const { handle, revoked } = setup({}, publisher); const result = capture(() => publisher.dispose());
  assert.equal(result.caught, true); assert.strictEqual(result.value, sentinel); assert.equal(activeDuring, false); assert.equal(handle.active(), false); assert.deepEqual(revoked, [false]);
});

test("borrowed methods delegate to the non-owner publisher without observing or revoking the owner", () => {
  const { publisher, handle, records } = setup(); const other = new FixturePublisher(); let calls = 0;
  const stop = publisher.subscribe.call(other, () => { calls++; }); other.emit(event()); assert.equal(calls, 1); stop(); other.emit(event()); assert.equal(calls, 1);
  publisher.dispose.call(other); assert.equal(other.disposeCalls, 1); assert.equal(publisher.disposeCalls, 0); assert.equal(handle.active(), true); assert.deepEqual(records, []);
});

test("once-ever refuses active and revoked reinstall without replacing later wrappers", () => {
  const s = setup(), subscribe = s.publisher.subscribe, dispose = s.publisher.dispose;
  const again = () => setup({}, s.publisher);
  assert.equal(capture(again).caught, true); assert.strictEqual(s.publisher.subscribe, subscribe); assert.strictEqual(s.publisher.dispose, dispose);
  s.handle.revoke(); const later = s.publisher.subscribe.bind(s.publisher); s.publisher.subscribe = later;
  assert.equal(capture(again).caught, true); assert.strictEqual(s.publisher.subscribe, later); assert.strictEqual(s.publisher.dispose, dispose);
});

test("preflight rejection does not install callbacks", () => {
  for (const mode of ["sealed", "descriptor", "not-function"] as const) {
    const publisher = new FixturePublisher();
    if (mode === "sealed") Object.preventExtensions(publisher);
    if (mode === "descriptor") Object.defineProperty(publisher, "subscribe", { value: publisher.subscribe, configurable: false });
    if (mode === "not-function") Object.defineProperty(publisher, "subscribe", { value: undefined, configurable: true });
    assert.equal(capture(() => setup({}, publisher)).caught, true); assert.equal(publisher.rawSubscribed.length, 0); assert.equal(publisher.disposeCalls, 0);
  }
});

test("a repaired preflight rejection can make its first installation", () => {
  const publisher = new FixturePublisher(), original = publisher.subscribe;
  Object.defineProperty(publisher, "subscribe", { value: undefined, configurable: true, writable: true });
  assert.equal(capture(() => setup({}, publisher)).caught, true); assert.equal(publisher.rawSubscribed.length, 0);
  publisher.subscribe = original; const state = setup({}, publisher); publisher.emit(event()); normal(state.records);
});

test("partial install failure burns once-ever and best-effort removes only its own callbacks", () => {
  const publisher = new FixturePublisher(), original = publisher.subscribe, sentinel = { install: true }; let calls = 0, cancellations = 0;
  publisher.subscribe = function (listener) { const remove = original.call(this, listener); if (++calls === 2) throw sentinel; return remove; };
  const options: Options = { publisher, onBegin: () => undefined, onDispatchEnd: () => undefined, onSeal: () => undefined, onRevoke: () => { cancellations++; return undefined; } };
  const result = capture(() => { installCanonicalPublisherMux(options); }); assert.equal(result.caught, true); assert.strictEqual(result.value, sentinel); assert.equal(cancellations, 1);
  assert.deepEqual(publisher.removed, [publisher.rawSubscribed[0]]);
  publisher.subscribe = original; let legacy = 0; const listener = () => { legacy++; }; publisher.subscribe(listener); publisher.emit(event()); assert.equal(legacy, 1);
  assert.deepEqual(publisher.delivered, [publisher.rawSubscribed[1], listener]);
  assert.equal(capture(() => { installCanonicalPublisherMux(options); }).caught, true); assert.equal(publisher.disposeCalls, 0);
});

test("failed rollback can leave First and Dispatch but no observing authority", () => {
  const publisher = new FixturePublisher(), original = publisher.subscribe, sentinel = { install: true }; let calls = 0, hooks = 0, cancellations = 0;
  publisher.subscribe = function (listener) {
    const remove = original.call(this, listener);
    if (++calls === 1) publisher.refuseRemoval.add(listener);
    if (calls === 2) throw sentinel;
    return remove;
  };
  const options: Options = { publisher, onBegin: () => { hooks++; return undefined; }, onDispatchEnd: () => { hooks++; return undefined; }, onSeal: () => { hooks++; return undefined; }, onRevoke: () => { cancellations++; return undefined; } };
  const result = capture(() => { installCanonicalPublisherMux(options); }); assert.equal(result.caught, true); assert.strictEqual(result.value, sentinel);
  assert.deepEqual(publisher.removed, [publisher.rawSubscribed[0]]);
  publisher.subscribe = original; let legacy = 0; const listener = () => { legacy++; }; publisher.subscribe(listener);
  const value = event(); publisher.emit(value); publisher.emit(value); publisher.emit(value);
  assert.equal(legacy, 3); assert.equal(hooks, 0); assert.equal(cancellations, 1);
  assert.deepEqual(publisher.delivered, Array.from({ length: 3 }, () => [publisher.rawSubscribed[0], publisher.rawSubscribed[1], listener]).flat());
  // No public stack inspection: the !routing First guard is static evidence, not a runtime memory/leak proof.
});
