import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, type AgentSession, type AgentSessionEvent, type AgentSessionEventListener } from "@earendil-works/pi-coding-agent";
import {
  prepareCanonicalPublisherBridge, type CanonicalPublisherBridge, type CanonicalPublisherNativeLink,
} from "../src/server/canonical-publisher-bridge.js";

type Options = Parameters<typeof prepareCanonicalPublisherBridge>[0];
type Message = Parameters<SessionManager["appendMessage"]>[0];
type End = Extract<AgentSessionEvent, { type: "message_end" }>;
const user = (content = "U") => ({ role: "user" as const, content, timestamp: 1 });
const end = (message: End["message"]): End => ({ type: "message_end", message });
const custom = () => ({ role: "custom" as const, customType: "fixture", content: "C", display: false, details: {}, timestamp: 1 });
function memory() {
  const cwd = process.env.TMPDIR;
  assert.ok(cwd, "the authorized harness must provide its private TMPDIR");
  return SessionManager.inMemory(cwd);
}
function capture(work: () => void) {
  let caught = false, value: unknown;
  try { work(); } catch (error) { caught = true; value = error; }
  return { caught, value };
}

// Test-owned live-array publisher + qualified synchronous continuation. NOT a real SDK publisher.
class FixturePublisher implements Pick<AgentSession, "sessionManager" | "subscribe" | "dispose"> {
  private listeners: AgentSessionEventListener[] = [];
  subscriptions = 0;
  removals = 0;
  failSubscribeAt = 0;
  failure: unknown = undefined;
  disposeCalls = 0;
  disposeThrows = false;
  constructor(public sessionManager: SessionManager) {}
  subscribe(listener: AgentSessionEventListener) {
    if (++this.subscriptions === this.failSubscribeAt) throw this.failure;
    this.listeners.push(listener);
    return () => {
      this.removals++;
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }
  emit(event: AgentSessionEvent) { for (const listener of this.listeners) listener(event); }
  produce(event: AgentSessionEvent) {
    this.emit(event);
    // Read fields AFTER Seal, just like the pinned ordinary continuation, with no arbitrary gap.
    if (event.type !== "message_end") return undefined;
    const raw = event.message;
    if (raw.role === "system" || raw.role === "user" || raw.role === "assistant" || raw.role === "toolResult") {
      return this.sessionManager.appendMessage(raw);
    }
    if (raw.role === "custom") {
      return this.sessionManager.appendCustomMessageEntry(raw.customType, raw.content, raw.display, raw.details);
    }
    return undefined;
  }
  customNativeFirst(raw = custom()) {
    this.sessionManager.appendCustomMessageEntry(raw.customType, raw.content, raw.display, raw.details);
    this.emit({ type: "message_start", message: raw });
    this.emit(end(raw)); // Native-first custom has NO post-end append, even if a user changed role.
    return raw;
  }
  dispose() {
    this.disposeCalls++;
    if (this.disposeThrows) throw this.failure;
    this.listeners = [];
  }
}
function setup(hooks: Partial<Pick<Options, "onLink" | "onRevoke">> = {}, manager = memory()) {
  const links: CanonicalPublisherNativeLink[] = [], revoked: boolean[] = [];
  const publisher = new FixturePublisher(manager);
  const handle = prepareCanonicalPublisherBridge({ manager,
    onLink: link => { links.push(link); return hooks.onLink?.(link); },
    onRevoke: () => { revoked.push(true); return hooks.onRevoke?.(); },
  });
  handle.attachPublisher(publisher);
  return { manager, publisher, handle, links, revoked };
}

// Type contracts only, never invoked; no runtime manual ingress or fake native record API.
function readonlyContracts(h: CanonicalPublisherBridge, l: CanonicalPublisherNativeLink, o: Options) {
  // @ts-expect-error readonly function
  h.attachPublisher = () => {};
  // @ts-expect-error readonly function
  h.active = () => true;
  // @ts-expect-error readonly function
  h.owns = () => true;
  // @ts-expect-error readonly function
  h.isCurrent = () => true;
  // @ts-expect-error readonly function
  h.revoke = () => {};
  // @ts-expect-error readonly option
  o.manager = memory();
  // @ts-expect-error readonly required strict-undefined hook
  o.onLink = () => undefined;
  // @ts-expect-error readonly required strict-undefined hook
  o.onRevoke = () => undefined;
  // @ts-expect-error readonly scalar
  l.sequence = 0;
  // @ts-expect-error readonly invocation
  l.invocation = l.invocation;
  // @ts-expect-error readonly metadata
  l.before = l.after;
  // @ts-expect-error readonly metadata
  l.after = l.before;
  // @ts-expect-error readonly mandatory entry
  l.entry = l.entry;
  // @ts-expect-error readonly nested state
  l.before.leafId = null;
  // @ts-expect-error readonly nested state
  l.after.sessionId = "foreign";
  // @ts-expect-error readonly nested entry
  l.entry.id = "foreign";
  // @ts-expect-error readonly nested entry
  l.entry.parentId = null;
  // @ts-expect-error opaque brand cannot be supplied from metadata
  const fake: CanonicalPublisherNativeLink = { invocation: l.invocation, sequence: l.sequence, before: l.before, after: l.after, entry: l.entry };
  // @ts-expect-error required cancel hook
  prepareCanonicalPublisherBridge({ manager: o.manager, onLink: () => undefined });
  // @ts-expect-error required link hook
  prepareCanonicalPublisherBridge({ manager: o.manager, onRevoke: () => undefined });
  // @ts-expect-error void is not strict undefined
  const badVoid: Options["onLink"] = (): void => {};
  // @ts-expect-error async hook is outside contract
  const badAsync: Options["onLink"] = async () => undefined;
  // @ts-expect-error no Promise-returning revoke hook
  const badPromise: Options["onRevoke"] = () => Promise.resolve(undefined);
  // @ts-expect-error no public observation ingestion
  h.ingest;
  // @ts-expect-error no external observer handle
  h.observer;
  // @ts-expect-error no public native record
  l.record;
  // @ts-expect-error no public native args/matcher
  l.matchesArguments;
  // @ts-expect-error no body authority
  l.raw;
  void [fake, badVoid, badAsync, badPromise];
}
void readonlyContracts;

test("prepare is inactive; prepared completions advance watermark without retrospective claim", () => {
  const manager = memory(), links: CanonicalPublisherNativeLink[] = [];
  const h = prepareCanonicalPublisherBridge({ manager, onLink: l => { links.push(l); return undefined; }, onRevoke: () => undefined });
  assert.equal(h.active(), false); assert.equal(manager.getEntryCount(), 0);
  const first = manager.appendMessage(user("prepared"));
  assert.equal(links.length, 0); assert.equal(h.isCurrent(undefined), false);
  const p = new FixturePublisher(manager); h.attachPublisher(p);
  const id = p.produce(end(user()));
  assert.equal(h.active(), true); assert.equal(links.length, 1);
  assert.equal(links[0]!.sequence, 2); assert.equal(links[0]!.before.leafId, first); assert.equal(links[0]!.entry.id, id);
});

test("wrong manager preflight is correctable and duplicate attach does not burn healthy owner", () => {
  const m = memory(), wrong = new FixturePublisher(memory()), p = new FixturePublisher(m);
  let revokes = 0;
  const h = prepareCanonicalPublisherBridge({ manager: m, onLink: () => undefined, onRevoke: () => { revokes++; return undefined; } });
  assert.throws(() => h.attachPublisher(wrong), /manager mismatch/);
  assert.equal(wrong.subscriptions, 0); assert.equal(revokes, 0);
  h.attachPublisher(p);
  const subscribe = p.subscribe;
  assert.throws(() => h.attachPublisher(p), /already attached/);
  assert.equal(p.subscribe, subscribe); assert.equal(h.active(), true); assert.equal(revokes, 0);
  assert.throws(() => prepareCanonicalPublisherBridge({ manager: m, onLink: () => undefined, onRevoke: () => undefined }), /already observed/);
});

test("pure observer preflight failure does not invent revoke or burn once-ever", () => {
  const m = memory(), original = m.appendMessage;
  let revokes = 0;
  const options: Options = { manager: m, onLink: () => undefined, onRevoke: () => { revokes++; return undefined; } };
  Object.defineProperty(m, "appendMessage", { value: original, writable: false, configurable: true });
  assert.throws(() => prepareCanonicalPublisherBridge(options), /method cannot be observed/);
  assert.equal(revokes, 0);
  Object.defineProperty(m, "appendMessage", { value: original, writable: true, configurable: true });
  const h = prepareCanonicalPublisherBridge(options); h.revoke(); h.revoke();
  assert.equal(revokes, 1);
});

test("untyped nonfunction hooks fail before observer installation and do not burn manager", () => {
  for (const key of ["onLink", "onRevoke"] as const) for (const invalid of [undefined, null, false]) {
    const m = memory(); let revokes = 0;
    const options: Options = { manager: m, onLink: () => undefined, onRevoke: () => { revokes++; return undefined; } };
    const untyped = { ...options, [key]: invalid } as unknown as Options;
    assert.throws(() => prepareCanonicalPublisherBridge(untyped), /requires callback functions/);
    assert.equal(revokes, 0);
    const h = prepareCanonicalPublisherBridge(options); h.revoke(); assert.equal(revokes, 1);
  }
});

test("owned observer installation fault signals once before handle assignment and preserves exception", () => {
  const m = memory(), marker = {}, define = Object.defineProperty;
  let revokes = 0;
  // Bounded fault injection ONLY at this owned instance's public wrapper installation; always restored.
  Object.defineProperty = function<T>(target: T, key: PropertyKey, descriptor: PropertyDescriptor): T {
    if (target === (m as unknown) && key === "appendUsage") throw marker;
    return define(target, key, descriptor);
  };
  let result: ReturnType<typeof capture>;
  try {
    result = capture(() => { prepareCanonicalPublisherBridge({ manager: m, onLink: () => undefined, onRevoke: () => { revokes++; return undefined; } }); });
  } finally { Object.defineProperty = define; }
  assert.equal(result.caught, true); assert.equal(result.value, marker); assert.equal(revokes, 1);
  assert.equal(m.appendMessage(user()).length > 0, true);
  assert.throws(() => prepareCanonicalPublisherBridge({ manager: m, onLink: () => undefined, onRevoke: () => undefined }), /already observed/);
});

test("partial mux installation revokes counterpart before mux handle assignment without SDK dispose", () => {
  const m = memory(), p = new FixturePublisher(m), marker = {};
  p.failSubscribeAt = 2; p.failure = marker;
  let revokes = 0;
  const h = prepareCanonicalPublisherBridge({ manager: m, onLink: () => undefined, onRevoke: () => { revokes++; return undefined; } });
  const result = capture(() => h.attachPublisher(p));
  assert.equal(result.caught, true); assert.equal(result.value, marker);
  assert.equal(p.removals, 1); assert.equal(p.disposeCalls, 0); assert.equal(revokes, 1); assert.equal(h.active(), false);
  assert.throws(() => h.attachPublisher(new FixturePublisher(m)), /inactive/);
  assert.equal(m.appendMessage(user()).length > 0, true);
});

test("mux own preflight failure counts as bridge install attempt and permanently revokes", () => {
  const m = memory(), p = new FixturePublisher(m);
  Object.preventExtensions(p);
  let revokes = 0;
  const h = prepareCanonicalPublisherBridge({ manager: m, onLink: () => undefined, onRevoke: () => { revokes++; return undefined; } });
  assert.throws(() => h.attachPublisher(p), /cannot be observed/);
  assert.equal(revokes, 1); assert.equal(h.active(), false);
  assert.throws(() => h.attachPublisher(new FixturePublisher(m)), /inactive/);
});

const messages: Message[] = [
  { role: "system", content: "S", timestamp: 1 }, user(),
  { role: "assistant", content: [{ type: "text", text: "A" }], api: "openai-completions", provider: "fixture", model: "fixture",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 1 },
  { role: "toolResult", toolCallId: "c", toolName: "fixture", content: [{ type: "text", text: "T" }], isError: false, timestamp: 1 },
];
for (const raw of messages) test(`ordinary ${raw.role} signs exactly one frozen real entry metadata link`, () => {
  const { manager: m, publisher: p, handle: h, links } = setup();
  const id = p.produce(end(raw)), l = links[0]!;
  assert.equal(links.length, 1); assert.equal(l.sequence, 1); assert.equal(l.entry.id, id);
  assert.deepEqual(l.before, { sessionId: m.getSessionId(), sessionFile: undefined, leafId: null });
  assert.deepEqual(l.after, { ...l.before, leafId: id });
  assert.deepEqual(l.entry, { id, parentId: null, type: "message" });
  for (const owned of [h, l, l.invocation, l.before, l.after, l.entry]) assert.equal(Object.isFrozen(owned), true);
  assert.deepEqual(Object.keys(l).sort(), ["after", "before", "entry", "invocation", "sequence"]);
  assert.equal(h.owns(l), true); assert.equal(h.isCurrent(l), true); assert.equal(Object.isFrozen(raw), false);
});

test("ownership is opaque identity, historical after revoke and never clone/cross-owner authority", () => {
  const a = setup(), b = setup(); a.publisher.produce(end(user()));
  const l = a.links[0]!;
  assert.equal(a.handle.owns({ ...l }), false); assert.equal(a.handle.isCurrent({ ...l }), false);
  for (const value of [null, undefined, {}, 1, l.invocation]) assert.equal(a.handle.owns(value), false);
  assert.equal(b.handle.owns(l), false); assert.equal(b.handle.isCurrent(l), false);
  a.handle.revoke(); a.handle.revoke();
  assert.equal(a.handle.owns(l), true); assert.equal(a.handle.isCurrent(l), false); assert.equal(a.revoked.length, 1);
});

test("later native attempt invalidates old current even without a new bridge link", () => {
  const { manager: m, publisher: p, handle: h, links } = setup(); p.produce(end(user()));
  const old = links[0]!; m.resetLeaf();
  assert.equal(links.length, 1); assert.equal(h.owns(old), true); assert.equal(h.isCurrent(old), false);
  p.produce(end(user("new")));
  assert.equal(links[1]!.sequence, 3); assert.equal(links[1]!.entry.parentId, null); assert.equal(h.isCurrent(links[1]), true);
});

test("first same-value different raw consumes expectation; later matching args cannot repair", () => {
  const { manager: m, publisher: p, links, handle: h } = setup(), raw = user();
  p.emit(end(raw)); m.appendMessage({ ...raw }); m.appendMessage(raw);
  assert.equal(links.length, 0); assert.equal(h.active(), true);
  p.produce(end(raw)); assert.equal(links.length, 1); assert.equal(links[0]!.sequence, 3);
});

for (const kind of ["thinking", "branch", "reset"] as const) test(`first ${kind} completion burns gap, no forward search`, () => {
  const { manager: m, publisher: p, links, handle: h } = setup(), seed = m.appendMessage(user("seed")), raw = user();
  p.emit(end(raw));
  if (kind === "thinking") m.appendThinkingLevelChange("low");
  else if (kind === "branch") m.branch(seed);
  else m.resetLeaf();
  m.appendMessage(raw);
  assert.equal(links.length, 0); assert.equal(h.active(), true);
  p.produce(end(user("qualified"))); assert.equal(links.length, 1); assert.equal(links[0]!.sequence, 4);
});

test("native append-first then throw undefined advances memory but cannot be signed or repaired", () => {
  const m = memory(), original = m.appendMessage;
  let fail = true;
  m.appendMessage = function(...args) {
    const id = Reflect.apply(original, this, args);
    if (fail) { fail = false; throw undefined; }
    return id;
  };
  const { publisher: p, links, handle: h } = setup({}, m), raw = user();
  const failure = capture(() => { p.produce(end(raw)); });
  assert.equal(failure.caught, true); assert.equal(failure.value, undefined);
  assert.equal(m.getEntryCount(), 1); assert.equal(links.length, 0);
  m.appendMessage(raw); assert.equal(links.length, 0);
  p.produce(end(user("after"))); assert.equal(links[0]!.sequence, 3); assert.equal(h.active(), true);
});

test("any new Begin burns an unconsumed gap before an unrelated publication", () => {
  const { manager: m, publisher: p, links } = setup(), raw = user();
  p.emit(end(raw)); p.emit({ type: "session_info_changed", name: "gap" }); m.appendMessage(raw);
  assert.equal(links.length, 0);
  p.produce(end(user("later"))); assert.equal(links[0]!.sequence, 2);
});

test("three nested same-event invocations sign distinct tokens and actual native parent chain", () => {
  const { publisher: p, links, handle: h } = setup(), event = end(user());
  let depth = 0;
  p.subscribe(() => { if (depth < 2) { depth++; try { p.produce(event); } finally { depth--; } } });
  p.produce(event);
  assert.deepEqual(links.map(l => l.sequence), [1, 2, 3]);
  assert.equal(new Set(links.map(l => l.invocation)).size, 3);
  assert.deepEqual(links.map(l => l.entry.parentId), [null, links[0]!.entry.id, links[1]!.entry.id]);
  assert.equal(h.isCurrent(links[0]), false); assert.equal(h.isCurrent(links[2]), true);
});

test("child throw undefined closes only child, parent continues and gets its own completion", () => {
  const { publisher: p, links, handle: h } = setup(), event = end(user());
  let depth = 0;
  p.subscribe(() => {
    if (depth) throw undefined;
    depth++;
    try { assert.deepEqual(capture(() => { p.produce(event); }), { caught: true, value: undefined }); }
    finally { depth--; }
  });
  p.produce(event);
  assert.equal(links.length, 1); assert.equal(links[0]!.sequence, 1); assert.equal(h.active(), true);
});

test("outer dispatch failure preserves successful child's historical invocation without outer append", () => {
  const { publisher: p, links, handle: h, manager: m } = setup(), event = end(user());
  let depth = 0;
  const remove = p.subscribe(() => {
    if (!depth) { depth++; try { p.produce(event); } finally { depth--; } throw undefined; }
  });
  assert.deepEqual(capture(() => { p.produce(event); }), { caught: true, value: undefined });
  assert.equal(m.getEntryCount(), 1); assert.equal(links.length, 1); assert.equal(h.isCurrent(links[0]), true);
  remove(); p.produce(end(user("later"))); assert.equal(links.length, 2); assert.equal(h.active(), true);
});

for (const change of ["type", "raw", "role"] as const) test(`Begin-to-Seal ${change} rewrite stays not-ready`, () => {
  const { publisher: p, links, handle: h } = setup(), raw = user(), event = end(raw);
  const remove = p.subscribe(() => {
    if (change === "type") Object.assign(event, { type: "message_start" });
    else if (change === "raw") event.message = { ...raw };
    else Object.assign(raw, { role: "system" });
  });
  p.produce(event); assert.equal(links.length, 0); assert.equal(h.active(), true);
  remove(); p.produce(end(user("next"))); assert.equal(links.length, 1);
});

test("content mutation uses actual same raw arguments but certifies no owned body version", () => {
  const { manager: m, publisher: p, links, handle: h } = setup(), raw = user("begin");
  const remove = p.subscribe(() => { raw.content = "seal"; }); p.produce(end(raw)); remove();
  assert.equal(links.length, 1);
  const entry = m.getLeafEntry(); assert.equal(entry?.type, "message");
  if (entry?.type === "message") assert.equal(entry.message, raw);
  raw.content = "later unobserved body";
  assert.equal(h.isCurrent(links[0]), true); assert.equal(Object.isFrozen(raw), false);
});

for (const path of ["native-first", "core-post", "delayed-flush"] as const) test(`custom ${path} simulation is always not-ready`, () => {
  const { publisher: p, links, manager: m, handle: h } = setup();
  if (path === "core-post") p.produce(end(custom()));
  else {
    if (path === "delayed-flush") p.emit({ type: "session_info_changed", name: "queued until later" });
    p.customNativeFirst();
  }
  assert.equal(m.getEntryCount(), 1); assert.equal(links.length, 0);
  p.produce(end(user())); assert.equal(links.length, 1); assert.equal(links[0]!.sequence, 2); assert.equal(h.active(), true);
});

test("custom native-first start role rewrite cannot upgrade end or later same raw into ordinary", () => {
  const { publisher: p, manager: m, links, handle: h } = setup(), raw = custom();
  p.subscribe(event => { if (event.type === "message_start") Object.assign(raw, { role: "user" }); });
  p.customNativeFirst(raw);
  // A later unrelated same-args append must not fulfill that non-appending native-first end.
  m.appendMessage(raw); assert.equal(links.length, 0);
  p.produce(end(raw)); assert.equal(links.length, 0); assert.equal(h.active(), true);
});

test("custom observed only at Seal still permanently taints that raw identity", () => {
  const { publisher: p, links } = setup(), raw = user();
  const remove = p.subscribe(() => { Object.assign(raw, { role: "custom" }); });
  p.emit({ type: "message_start", message: raw }); remove();
  Object.assign(raw, { role: "user" }); p.produce(end(raw)); assert.equal(links.length, 0);
});

test("unsupported event does not read message/body and tool events never read args or arm", () => {
  const { publisher: p, manager: m, links, handle: h } = setup();
  let reads = 0;
  const event = Object.defineProperty({ type: "session_info_changed" as const, name: "no body" }, "message", { get() { reads++; throw Error("body read"); } });
  p.emit(event);
  p.emit({ type: "tool_execution_start", toolCallId: "c", toolName: "fixture", get args() { reads++; throw Error("args read"); } });
  m.appendMessage(user()); assert.equal(reads, 0); assert.equal(links.length, 0); assert.equal(h.active(), true);
});

for (const cut of ["begin", "seal", "completion", "active", "current"] as const) test(`public manager replacement at ${cut} permanently revokes without losing historical owns`, () => {
  const { publisher: p, manager: m, links, handle: h, revoked } = setup(), other = memory();
  p.produce(end(user("prior"))); const old = links[0]!, raw = user("candidate");
  if (cut === "seal") {
    p.subscribe(() => { p.sessionManager = other; }); p.produce(end(raw));
  } else if (cut === "completion") {
    p.emit(end(raw)); p.sessionManager = other; m.appendMessage(raw);
  } else {
    p.sessionManager = other;
    if (cut === "begin") p.produce(end(raw));
    else if (cut === "active") assert.equal(h.active(), false);
    else assert.equal(h.isCurrent(old), false);
  }
  assert.equal(links.length, 1); assert.equal(h.active(), false); assert.equal(revoked.length, 1);
  assert.equal(h.owns(old), true); assert.equal(h.isCurrent(old), false); assert.equal(p.disposeCalls, 0);
});

test("unmatched completion checks changed manager before returning without a candidate", () => {
  const f = setup(); f.publisher.sessionManager = memory();
  f.manager.appendSessionInfo("unmatched");
  assert.equal(f.revoked.length, 1); // BEFORE active()/isCurrent(), which must not mask a missing callback guard.
  f.publisher.sessionManager = f.manager;
  assert.equal(f.handle.active(), false); assert.equal(f.links.length, 0);
});

test("isCurrent fake or foreign identity still checks fixed manager before owns short circuit", () => {
  const foreign = setup(); foreign.publisher.produce(end(user("foreign")));
  for (const value of [{}, foreign.links[0]]) {
    const f = setup(); f.publisher.sessionManager = memory();
    assert.equal(f.handle.isCurrent(value), false); assert.equal(f.revoked.length, 1);
  }
});

for (const fault of ["captured-to-before", "before-to-after"] as const) test(`VIOLATION DEFENSE public scope read fault ${fault} permanently revokes`, () => {
  const m = memory(), append = m.appendMessage;
  let reported = m.getSessionId();
  // Owned passive read fault, NOT a claim that these values are the SDK's real scope.
  m.getSessionId = () => reported;
  if (fault === "before-to-after") m.appendMessage = function(...args) {
    const id = Reflect.apply(append, this, args); reported = "fault-after"; return id;
  };
  const f = setup({}, m), raw = user(); f.publisher.emit(end(raw));
  if (fault === "captured-to-before") reported = "fault-before";
  m.appendMessage(raw);
  assert.equal(f.revoked.length, 1); assert.equal(f.links.length, 0); assert.equal(f.handle.active(), false);
});

test("public manager read exception is an observation fault, never an isCurrent throw", () => {
  const { publisher: p, links, handle: h, revoked } = setup(); p.produce(end(user()));
  Object.defineProperty(p, "sessionManager", { configurable: true, get() { throw undefined; } });
  assert.equal(h.isCurrent(links[0]), false); assert.equal(revoked.length, 1); assert.equal(h.owns(links[0]), true);
});

test("link is registered before notify; passive callback sees real current identity", () => {
  let h!: CanonicalPublisherBridge, notified = 0;
  const fixture = setup({ onLink: l => { assert.equal(h.owns(l), true); assert.equal(h.isCurrent(l), true); notified++; return undefined; } });
  h = fixture.handle; fixture.publisher.produce(end(user())); assert.equal(notified, 1);
});

test("direct consumer callbacks are ordinary calls with one link argument and zero revoke arguments", () => {
  const m = memory(), p = new FixturePublisher(m);
  let call: { receiver: unknown; argc: number; link: CanonicalPublisherNativeLink } | undefined;
  let cancellation: { receiver: unknown; argc: number } | undefined;
  const h = prepareCanonicalPublisherBridge({ manager: m,
    onLink: function(this: unknown, link) { call = { receiver: this, argc: arguments.length, link }; return undefined; },
    onRevoke: function(this: unknown) { cancellation = { receiver: this, argc: arguments.length }; return undefined; },
  });
  h.attachPublisher(p); p.produce(end(user()));
  assert.ok(call); assert.equal(call.receiver, undefined); assert.equal(call.argc, 1); assert.equal(h.owns(call.link), true);
  h.revoke(); assert.ok(cancellation); assert.equal(cancellation.receiver, undefined); assert.equal(cancellation.argc, 0);
});

test("VIOLATION DEFENSE callback native mutation advances watermark before notify and never rolls back", () => {
  let m!: SessionManager, once = true;
  const f = setup({ onLink: () => { if (once) { once = false; m.appendSessionInfo("nested callback"); } return undefined; } }); m = f.manager;
  f.publisher.produce(end(user("first")));
  assert.equal(f.links.length, 1); assert.equal(f.handle.isCurrent(f.links[0]), false);
  f.publisher.produce(end(user("legitimate next")));
  assert.deepEqual(f.links.map(l => l.sequence), [1, 3]); assert.equal(f.handle.isCurrent(f.links[1]), true); assert.equal(f.handle.active(), true);
});

test("VIOLATION DEFENSE callback publication consumes its own slot with no duplicate outer issuance", () => {
  let p!: FixturePublisher, once = true;
  const f = setup({ onLink: () => { if (once) { once = false; p.produce(end(user("nested callback"))); } return undefined; } }); p = f.publisher;
  p.produce(end(user("outer"))); p.produce(end(user("next")));
  assert.deepEqual(f.links.map(l => l.sequence), [1, 2, 3]);
  assert.equal(new Set(f.links.map(l => l.invocation)).size, 3); assert.equal(f.handle.isCurrent(f.links[2]), true);
});

test("consumer throw undefined revokes but never replaces native returned id", () => {
  const f = setup({ onLink: () => { throw undefined; } });
  const id = f.publisher.produce(end(user()));
  assert.equal(id, f.links[0]!.entry.id); assert.equal(f.manager.getEntryCount(), 1);
  assert.equal(f.handle.active(), false); assert.equal(f.handle.owns(f.links[0]), true); assert.equal(f.revoked.length, 1);
});

test("untyped nonundefined hook result revokes without reading explosive then or assimilating", () => {
  let reads = 0;
  const poison = { get then() { reads++; throw Error("must not read then"); } };
  const bad = (() => poison) as unknown as Options["onLink"];
  const f = setup({ onLink: bad });
  const id = f.publisher.produce(end(user()));
  assert.equal(id, f.links[0]!.entry.id); assert.equal(reads, 0); assert.equal(f.handle.active(), false); assert.equal(f.revoked.length, 1);
});

test("onRevoke errors or untyped thenables cannot change control flow or recurse", () => {
  let reads = 0;
  const poison = { get then() { reads++; throw Error("must not read then"); } };
  for (const hook of [() => { throw undefined; }, (() => poison) as unknown as Options["onRevoke"]]) {
    const f = setup({ onRevoke: hook }); f.handle.revoke(); f.handle.revoke();
    assert.equal(f.revoked.length, 1); assert.equal(f.publisher.disposeCalls, 0);
  }
  assert.equal(reads, 0);
});

test("scope newSession revokes before original safe memory reset and never restores", () => {
  let m!: SessionManager;
  const snapshots: string[] = [];
  const f = setup({ onRevoke: () => { snapshots.push(m.getSessionId()); return undefined; } }); m = f.manager;
  const before = m.getSessionId(), raw = user(); f.publisher.emit(end(raw)); m.newSession();
  assert.deepEqual(snapshots, [before]); assert.notEqual(m.getSessionId(), before);
  m.appendMessage(raw); assert.equal(f.links.length, 0); assert.equal(f.handle.active(), false);
});

test("scope original throw undefined still revokes before call and preserves exact exception", () => {
  const m = memory(); m.newSession = () => { throw undefined; };
  const f = setup({}, m);
  assert.deepEqual(capture(() => { m.newSession(); }), { caught: true, value: undefined });
  assert.equal(f.revoked.length, 1); assert.equal(f.handle.active(), false); assert.equal(f.publisher.disposeCalls, 0);
});

test("bridge revoke preserves legacy user routing, terminal dispose calls original only once per call", () => {
  const f = setup(); let users = 0; f.publisher.subscribe(() => { users++; });
  f.handle.revoke(); f.publisher.produce(end(user()));
  assert.equal(users, 1); assert.equal(f.links.length, 0); assert.equal(f.publisher.disposeCalls, 0);
  f.publisher.dispose(); assert.equal(f.publisher.disposeCalls, 1); assert.equal(f.revoked.length, 1);
});

test("original dispose throw undefined is preserved; no bridge-initiated dispose or restoration", () => {
  const f = setup(); f.publisher.disposeThrows = true;
  assert.deepEqual(capture(() => f.publisher.dispose()), { caught: true, value: undefined });
  assert.equal(f.publisher.disposeCalls, 1); assert.equal(f.revoked.length, 1); assert.equal(f.handle.active(), false);
});
