import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  observeCanonicalNativeManager,
  type CanonicalNativeObserver, type NativeMutationObservation, type NativeMutationMethod,
} from "../src/server/canonical-native-observer.js";

const user = (content = "U") => ({ role: "user" as const, content, timestamp: 1 });
const memory = () => SessionManager.inMemory("/axiom-native-observer-fixture");
const cut = (m: SessionManager) => ({
  sessionId: m.getSessionId(), sessionFile: m.getSessionFile(), leafId: m.getLeafId(),
});
const usage = {
  input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} satisfies Parameters<SessionManager["appendUsage"]>[3];
function observe(manager: SessionManager) {
  const records: NativeMutationObservation[] = [];
  const handle = observeCanonicalNativeManager({ manager, onMutation: record => { records.push(record); } });
  return { records, handle };
}

// Type contracts only: this function is never invoked at runtime.
function readonlyContracts(h: CanonicalNativeObserver, r: NativeMutationObservation) {
  // @ts-expect-error readonly function property
  h.active = () => true;
  // @ts-expect-error readonly function property
  h.last = () => undefined;
  // @ts-expect-error readonly function property
  h.owns = () => true;
  // @ts-expect-error readonly function property
  h.isCurrent = () => true;
  // @ts-expect-error readonly function property
  h.revoke = () => {};
  // @ts-expect-error readonly scalar
  r.method = "branch";
  // @ts-expect-error readonly scalar
  r.sequence = 0;
  // @ts-expect-error readonly scalar
  r.outcome = "returned";
  // @ts-expect-error readonly state property
  r.before = r.after;
  // @ts-expect-error readonly state property
  r.after = r.before;
  // @ts-expect-error readonly matcher property
  r.matchesArguments = () => false;
  // @ts-expect-error readonly nested state
  r.before.sessionId = "other";
  // @ts-expect-error readonly nested state
  r.before.sessionFile = "other";
  // @ts-expect-error readonly nested state
  r.before.leafId = null;
  // @ts-expect-error readonly nested state
  r.after.leafId = null;
  if (r.entry) {
    // @ts-expect-error readonly entry
    r.entry.id = "other";
    // @ts-expect-error readonly entry
    r.entry.parentId = null;
    // @ts-expect-error readonly entry
    r.entry.type = "message";
  }
  const args: readonly unknown[] = [undefined];
  r.matchesArguments(args);
  h.owns(undefined); h.isCurrent(null);
  // @ts-expect-error real SessionManager requires private native state
  observeCanonicalNativeManager({ manager: {}, onMutation: () => {} });
  // @ts-expect-error not a public observed method
  const invalid: NativeMutationMethod = "_persist";
  void invalid;
}
void readonlyContracts;

test("initial observer and once-ever attachment do not change native state", () => {
  const m = memory(), before = cut(m);
  const { handle: h, records } = observe(m);
  assert.deepEqual(cut(m), before);
  assert.equal(m.getEntryCount(), 0);
  assert.equal(h.active(), true); assert.equal(h.last(), undefined);
  assert.equal(h.owns(undefined), false); assert.equal(h.isCurrent(undefined), false);
  assert.equal(Object.isFrozen(h), true);
  const method = m.appendMessage;
  assert.throws(() => observe(m), /already observed/);
  assert.equal(m.appendMessage, method);
  h.revoke(); h.revoke();
  assert.throws(() => observe(m), /already observed/);
  assert.equal(m.appendMessage, method);
  m.appendMessage(user());
  assert.equal(records.length, 0); assert.equal(m.getEntryCount(), 1);
});

const raw = user("full body"), data = { fixture: true }, replacement = { content: "replacement" };
const appendCases: Array<{ method: NativeMutationMethod; type: string;
  args: (u: string) => readonly unknown[]; run: (m: SessionManager, u: string) => unknown }> = [
  { method: "appendMessage", type: "message", args: () => [raw], run: m => m.appendMessage(raw) },
  { method: "appendThinkingLevelChange", type: "thinking_level_change", args: () => ["low"], run: m => m.appendThinkingLevelChange("low") },
  { method: "appendModelChange", type: "model_change", args: () => ["fixture", "model"], run: m => m.appendModelChange("fixture", "model") },
  { method: "appendUsage", type: "usage", args: () => ["fixture", "fixture", "model", usage], run: m => m.appendUsage("fixture", "fixture", "model", usage) },
  { method: "appendCompaction", type: "compaction", args: u => ["S", u, 100], run: (m, u) => m.appendCompaction("S", u, 100) },
  { method: "appendCustomEntry", type: "custom", args: () => ["fixture", data], run: m => m.appendCustomEntry("fixture", data) },
  { method: "appendSessionInfo", type: "session_info", args: () => ["  a\nb  "], run: m => m.appendSessionInfo("  a\nb  ") },
  { method: "appendCustomMessageEntry", type: "custom_message", args: () => ["fixture", "body", false, data], run: m => m.appendCustomMessageEntry("fixture", "body", false, data) },
  { method: "appendContextEdit", type: "context_edit", args: u => [u, replacement], run: (m, u) => m.appendContextEdit(u, replacement) },
  { method: "appendLabelChange", type: "label", args: u => [u, "L"], run: (m, u) => m.appendLabelChange(u, "L") },
];
for (const c of appendCases) test(`real public ${c.method} preserves result and owns metadata`, () => {
  const m = memory(), u = m.appendMessage(user()), before = cut(m);
  const { records, handle: h } = observe(m);
  const result = c.run(m, u), entry = m.getLeafEntry()!;
  assert.equal(result, c.method === "appendUsage" ? entry : entry.id);
  assert.equal(m.getEntryCount(), 2); assert.equal(entry.type, c.type);
  assert.equal(entry.parentId, u);
  assert.equal(records.length, 1);
  const r = records[0]!;
  assert.equal(r.method, c.method); assert.equal(r.sequence, 1); assert.equal(r.outcome, "returned");
  assert.deepEqual(r.before, before); assert.deepEqual(r.after, cut(m));
  assert.deepEqual(r.entry, { id: entry.id, parentId: u, type: c.type });
  assert.notEqual(r.entry, entry); assert.equal(Object.isFrozen(entry), false);
  for (const owned of [r, r.before, r.after, r.entry]) assert.equal(Object.isFrozen(owned), true);
  assert.equal(r.matchesArguments(c.args(u)), true);
  assert.equal(h.last(), r); assert.equal(h.owns(r), true); assert.equal(h.isCurrent(r), true);
  if (c.method === "appendSessionInfo") assert.equal(m.getSessionName(), "a b");
});

test("parameter matcher uses every Object.is slot, not body equality or argument presence", () => {
  const m = memory(), { handle: h } = observe(m), body = user("before");
  m.appendMessage(body);
  const r = h.last()!;
  assert.equal(r.matchesArguments([{ ...body }]), false);
  assert.equal(r.matchesArguments(Array(1)), false);
  body.content = "after";
  assert.equal(r.matchesArguments([body]), true); assert.equal(Object.isFrozen(body), false);
  assert.equal(m.getLeafEntry()?.type, "message");
  m.appendCustomEntry("number", NaN);
  assert.equal(h.last()!.matchesArguments(["number", NaN]), true);
  m.appendCustomEntry("number", -0);
  assert.equal(h.last()!.matchesArguments(["number", +0]), false);
  assert.equal(h.last()!.matchesArguments(["number", -0]), true);
  m.appendUsage("fixture", "p", "m", usage);
  assert.equal(h.last()!.matchesArguments(["fixture", "p", "m", usage, undefined]), false);
  m.appendUsage("fixture", "p", "m", usage, undefined);
  assert.equal(h.last()!.matchesArguments(["fixture", "p", "m", usage]), false);
});

test("branch ABA, no-op and reset attempts are not coalesced", () => {
  const m = memory(), u = m.appendMessage(user()), c = m.appendCustomEntry("c");
  const { records, handle: h } = observe(m);
  m.branch(u); m.branch(c); m.branch(c); m.resetLeaf(); m.resetLeaf();
  assert.deepEqual(records.map(r => r.method), ["branch", "branch", "branch", "resetLeaf", "resetLeaf"]);
  assert.deepEqual(records.map(r => r.sequence), [1, 2, 3, 4, 5]);
  assert.deepEqual(records.map(r => r.after.leafId), [u, c, c, null, null]);
  for (const r of records) assert.equal(r.entry, undefined);
  assert.equal(h.owns(records[0]), true); assert.equal(h.isCurrent(records[0]), false);
  const id = m.appendMessage(user("root")); assert.equal(m.getEntry(id)!.parentId, null);
});

test("real native business errors are observed and preserve the identical thrown object", () => {
  const m = memory(), u = m.appendMessage(user()), off = m.appendMessage(user("off"));
  m.branch(u); const metadata = m.appendCustomEntry("metadata");
  let caught: unknown;
  const branch = m.branch;
  m.branch = function (id) { try { return branch.call(this, id); } catch (error) { caught = error; throw error; } };
  const { records, handle: h } = observe(m);
  const failures = [() => m.branch("absent"), () => m.appendContextEdit("absent", null),
    () => m.appendContextEdit(off, null), () => m.appendContextEdit(metadata, null)];
  for (const run of failures) {
    const before = cut(m), count = m.getEntryCount();
    let error: unknown;
    try { run(); assert.fail("native failure expected"); } catch (value) { error = value; }
    assert.ok(error instanceof Error);
    if (records.length === 1) assert.equal(error, caught);
    assert.deepEqual(cut(m), before); assert.equal(m.getEntryCount(), count);
    assert.equal(h.last()!.outcome, "threw"); assert.equal(h.last()!.entry, undefined);
    assert.deepEqual(h.last()!.after, before); assert.equal(h.active(), true);
  }
  assert.equal(records.length, 4);
  m.appendContextEdit(u, null);
  assert.equal(h.last()!.outcome, "returned");
});

test("branchWithSummary is one real operation with its actual parent and fromId", () => {
  const m = memory(), u = m.appendMessage(user()), c = m.appendCustomEntry("c");
  const { records, handle: h } = observe(m);
  const id = m.branchWithSummary(u, "S"), entry = m.getEntry(id)!;
  assert.equal(entry.type, "branch_summary");
  if (entry.type !== "branch_summary") assert.fail("summary entry expected");
  assert.equal(entry.fromId, c); assert.equal(entry.parentId, u);
  assert.equal(h.last()!.before.leafId, c); assert.equal(h.last()!.after.leafId, id);
  assert.deepEqual(h.last()!.entry, { id, parentId: u, type: "branch_summary" });
  assert.equal(records.length, 1);
  const root = m.branchWithSummary(null, "root"); assert.equal(m.getEntry(root)!.parentId, null);
  assert.equal(records.length, 2);
});

test("old owned records stay frozen, forged identities do not read getters", () => {
  const m = memory(), { handle: a } = observe(m), { handle: b } = observe(memory());
  m.appendMessage(user()); const old = a.last()!, saved = JSON.stringify(old);
  let reads = 0;
  const forged = Object.defineProperty({}, "sequence", { get() { reads++; throw Error("forged"); } });
  for (const value of [undefined, null, forged, { ...old }, new Proxy(old, {}), m.getLeafEntry()]) {
    assert.equal(a.owns(value), false); assert.equal(a.isCurrent(value), false);
  }
  assert.equal(reads, 0); assert.equal(b.owns(old), false);
  m.appendCustomEntry("next");
  assert.equal(a.owns(old), true); assert.equal(a.isCurrent(old), false);
  assert.equal(JSON.stringify(old), saved);
  a.revoke(); assert.equal(a.owns(old), true); assert.equal(a.isCurrent(a.last()), false);
});

for (const valid of [true, false]) test(`newSession revokes before native ${valid ? "success" : "failure"}`, () => {
  const m = memory(), oldId = m.appendMessage(user()), before = cut(m);
  let h!: CanonicalNativeObserver, revoked = 0, changes = 0;
  let revokedAt: { active: boolean; state: ReturnType<typeof cut> } | undefined;
  h = observeCanonicalNativeManager({ manager: m, onMutation: () => { changes++; }, onRevoke: () => {
    revoked++; revokedAt = { active: h.active(), state: cut(m) };
  } });
  if (valid) assert.equal(m.newSession({ id: "observer-scope-new" }), undefined);
  else assert.throws(() => m.newSession({ id: "../invalid" }));
  assert.equal(revoked, 1); assert.equal(h.active(), false); assert.equal(changes, 0);
  assert.deepEqual(revokedAt, { active: false, state: before });
  if (valid) { assert.equal(m.getSessionId(), "observer-scope-new"); assert.equal(m.getEntryCount(), 0); }
  else { assert.deepEqual(cut(m), before); assert.ok(m.getEntry(oldId)); }
  m.appendMessage(user("unobserved")); h.revoke(); assert.equal(changes, 0); assert.equal(revoked, 1);
});

test("memory createBranchedSession revokes before replacing real scope and re-chaining labels", () => {
  const m = memory(), u = m.appendMessage(user()); m.appendLabelChange(u, "L");
  const c = m.appendCustomEntry("kept"); m.branch(u); const off = m.appendCustomEntry("off");
  const before = cut(m); let revoked = 0, changes = 0;
  let revokedAt: ReturnType<typeof cut> | undefined;
  const h = observeCanonicalNativeManager({ manager: m, onMutation: () => { changes++; },
    onRevoke: () => { revoked++; revokedAt = cut(m); } });
  assert.equal(m.createBranchedSession(c), undefined);
  assert.equal(revoked, 1); assert.equal(h.active(), false);
  assert.deepEqual(revokedAt, before); assert.equal(changes, 0); assert.equal(h.last(), undefined);
  assert.notEqual(m.getSessionId(), before.sessionId);
  assert.equal(m.getEntry(off), undefined); assert.equal(m.getEntry(c)!.parentId, u);
  assert.equal(m.getLabel(u), "L"); assert.equal(m.getEntryCount(), 3);
});

test("invalid memory branch extraction revokes even when native state is unchanged", () => {
  const m = memory(), before = cut(m); let revokedAt: ReturnType<typeof cut> | undefined;
  const h = observeCanonicalNativeManager({ manager: m, onMutation: () => {},
    onRevoke: () => { revokedAt = cut(m); } });
  assert.throws(() => m.createBranchedSession("absent"));
  assert.deepEqual(revokedAt, before); assert.deepEqual(cut(m), before);
  assert.equal(h.active(), false); assert.equal(h.last(), undefined);
});

test("scope revocation keeps historical records and leaves later decorators installed", () => {
  const m = memory(), { handle: h, records } = observe(m);
  m.appendMessage(user()); const old = h.last()!, saved = JSON.stringify(old);
  const tap = m.appendCustomEntry;
  const decorator = function (this: SessionManager, kind: string, value?: unknown) {
    return tap.call(this, kind, value);
  };
  m.appendCustomEntry = decorator;
  m.newSession({ id: "history-scope" });
  assert.equal(h.last(), old); assert.equal(h.owns(old), true); assert.equal(h.isCurrent(old), false);
  assert.equal(JSON.stringify(old), saved); assert.equal(m.appendCustomEntry, decorator);
  m.appendCustomEntry("transparent");
  assert.equal(records.length, 1); assert.equal(m.getEntryCount(), 1);
});

test("borrowed wrappers preserve actual this without observing the other manager", () => {
  const a = memory(), b = memory(), { handle: h, records } = observe(a);
  const id = Reflect.apply(a.appendMessage, b, [user("B")]);
  assert.equal(b.getLeafId(), id); assert.equal(a.getEntryCount(), 0); assert.equal(records.length, 0);
  Reflect.apply(a.newSession, b, [{ id: "borrowed-scope" }]);
  assert.equal(b.getSessionId(), "borrowed-scope"); assert.equal(h.active(), true);
});

test("callback failures cannot replace successful native return or native errors", () => {
  const m = memory(), original = m.branch; let nativeError: unknown, revoked = 0;
  m.branch = function (id) { try { return original.call(this, id); } catch (e) { nativeError = e; throw e; } };
  const h = observeCanonicalNativeManager({ manager: m, onMutation: () => { throw Error("observer"); },
    onRevoke: () => { revoked++; throw Error("revoke callback"); } });
  const id = m.appendMessage(user());
  assert.equal(m.getLeafId(), id); assert.equal(h.active(), false); assert.equal(h.owns(h.last()), true);
  assert.equal(h.isCurrent(h.last()), false); h.revoke(); assert.equal(revoked, 1);
  const n = memory(), branch = n.branch; let caught: unknown;
  n.branch = function (key) { try { return branch.call(this, key); } catch (e) { caught = e; throw e; } };
  observeCanonicalNativeManager({ manager: n, onMutation: () => { throw Error("observer"); } });
  let outer: unknown; try { n.branch("absent"); } catch (e) { outer = e; }
  assert.ok(caught instanceof Error); assert.equal(outer, caught); assert.equal(nativeError, undefined);
});

test("composition fixture: nested real public writes coalesce and old current is suspended", () => {
  const m = memory(), append = m.appendCustomEntry;
  let h!: CanonicalNativeObserver, old: NativeMutationObservation | undefined;
  m.appendCustomEntry = function (kind, value) {
    assert.equal(h.isCurrent(old), false);
    this.appendThinkingLevelChange("low");
    return append.call(this, kind, value);
  };
  const observed = observe(m); h = observed.handle;
  m.appendMessage(user()); old = h.last();
  const before = cut(m), id = m.appendCustomEntry("composite");
  assert.equal(m.getEntryCount(), 3); assert.equal(observed.records.length, 2);
  assert.equal(h.last()!.method, "appendCustomEntry"); assert.deepEqual(h.last()!.before, before);
  assert.equal(h.last()!.after.leafId, id); assert.equal(h.isCurrent(h.last()), true);
});

test("composition fixture: nested real scope cancels the outer observation", () => {
  const m = memory(), append = m.appendCustomEntry;
  m.appendCustomEntry = function (kind, value) {
    this.newSession({ id: "nested-scope" }); return append.call(this, kind, value);
  };
  const { records, handle: h } = observe(m);
  const id = m.appendCustomEntry("after-scope");
  assert.equal(m.getSessionId(), "nested-scope"); assert.equal(m.getLeafId(), id);
  assert.equal(records.length, 0); assert.equal(h.active(), false);
});

test("simulation: real append followed by same thrown value retains memory-ahead after state", () => {
  for (const sentinel of [Error("after-real-append"), undefined]) {
    const m = memory(), append = m.appendMessage; let realId: string | undefined;
    m.appendMessage = function (message) { realId = append.call(this, message); throw sentinel; };
    const { handle: h } = observe(m); let threw = false, caught: unknown;
    try { m.appendMessage(user()); } catch (e) { threw = true; caught = e; }
    assert.equal(threw, true); assert.equal(caught, sentinel); assert.equal(m.getEntryCount(), 1);
    assert.equal(h.last()!.outcome, "threw"); assert.equal(h.last()!.after.leafId, realId);
    assert.equal(h.last()!.entry, undefined); assert.equal(h.active(), true);
  }
});

for (const failureAt of [1, 2]) test(`observer-read simulation ${failureAt} cannot block native append`, () => {
  const m = memory(), getLeaf = m.getLeafId; let reads = 0;
  m.getLeafId = function () { if (++reads === failureAt) throw Error("observer read"); return getLeaf.call(this); };
  const { handle: h, records } = observe(m);
  const id = m.appendMessage(user());
  assert.equal(m.getEntry(id)!.type, "message"); assert.equal(m.getEntryCount(), 1);
  assert.equal(h.active(), false); assert.equal(records.length, 0);
});
