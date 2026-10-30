import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage, SelectionChange } from "../src/shared/agent.js";
import { captureCanonicalSources, type CanonicalCaptureInput, type CanonicalSourceCapture } from "../src/shared/canonical-source-capture.js";
import { unarchivedGroups, type HistoryIndex, type ThreadGroup } from "../src/shared/history.js";
import { threadGroups } from "../src/shared/thread-layout.js";

const change = (): SelectionChange => ({ from: { provider: "old", id: "one", thinking: "low" }, to: { provider: "new", id: "two", thinking: "high" } });
const assistant = (id: string, rest: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", text: "", ...rest });
const checkpoint = (id: string): ChatMessage => ({ id, role: "notice", text: `full summary ${id}`, compression: { number: 1, title: id, before: 100, after: null } });
const map = (...messages: ChatMessage[]) => new Map(messages.map(message => [message.id, message]));
const segment = (checkpoint: ChatMessage, ids: string[], groups: ThreadGroup[]) => ({ id: checkpoint.id,
  compression: { ...checkpoint.compression! }, messageIds: ids, groups: groups.map(group => ({ ...group, estimatedHeight: 84 })) });
const empty = () => ({ archive: { index: { revision: "empty", segments: [] } as HistoryIndex, messages: map() },
  currentGroups: [] as ThreadGroup[], currentMessages: map(), transientMessages: map() });

// Normalized synthetic inputs, not a native parser/projection or reachability test.
function fixture() {
  const m = assistant("m", { text: "narration", thinking: "reasoning", runId: "run-m",
    calls: [{ id: "call-m", name: "read", input: "full input" }] });
  const n = assistant("n", { calls: [{ id: "call-n", name: "read", input: "other input" }] });
  const p = assistant("p", { text: "live commentary", phase: "commentary", runId: "run-p" });
  const a = checkpoint("a"), b = checkpoint("b");
  const layout = threadGroups([m, n, p]);
  const aGroups = unarchivedGroups(layout, new Set([n.id, p.id]));
  const bGroups = unarchivedGroups(layout, new Set([m.id, p.id]));
  const index: HistoryIndex = { revision: "archive-only", segments: [segment(a, [m.id], aGroups), segment(b, [n.id], bGroups)] };
  return { m, n, p, a, b, input: { archive: { index, messages: map(m, n, p, a, b) },
    currentGroups: threadGroups([a, b, m, n, p]), currentMessages: map(m, n, p), transientMessages: map() } };
}
const fact = (capture: CanonicalSourceCapture, source: number, member = 0) => capture.occurrences.get(capture.sources[source].sourceKey, member)!;
function assertDeepFrozen(value: unknown) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

type Equal<L, R> = (<T>() => T extends L ? 1 : 2) extends (<T>() => T extends R ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type MessageReadonly = Expect<Equal<Pick<CanonicalSourceCapture, "message">, Readonly<Pick<CanonicalSourceCapture, "message">>>>;

// Consumed only by the real compiler; no mutation is executed by runtime tests.
function readonlyContract(input: CanonicalCaptureInput, capture: CanonicalSourceCapture) {
  // @ts-expect-error deep readonly input groups
  input.currentGroups[0].ids.push("x");
  // @ts-expect-error readonly map has no mutation API
  input.currentMessages.set("x", assistant("x"));
  // @ts-expect-error output catalogue is deeply readonly
  capture.archive.segments[0].compression.title = "x";
  // @ts-expect-error output source member lists are readonly
  capture.sources[0].group.ids.push("x");
  // @ts-expect-error complete output messages are deeply readonly
  capture.message("m")!.calls![0].input = "x";
  // @ts-expect-error capture API itself is readonly
  capture.occurrences = capture.occurrences;
}
void readonlyContract;

test("preserves separate original archive and current-context live grouping", () => {
  const u: ChatMessage = { id: "u", role: "user", text: "question", runId: "r" };
  const a = assistant("answer", { text: "answer", phase: "final_answer", status: "completed", runId: "r", selectionChange: change() });
  const c = checkpoint("checkpoint");
  const original = threadGroups([u, a]), current = threadGroups([c, a]);
  const input = empty();
  input.archive = { index: { revision: "one", segments: [segment(c, [u.id], unarchivedGroups(original, new Set([a.id])))] }, messages: map(u, a, c) };
  input.currentGroups = current; input.currentMessages = map(c, a);
  const capture = captureCanonicalSources(input);
  assert.deepEqual(capture.sources.map(source => [source.storage.kind, source.group.ids]), [["archive", ["u"]], ["live", ["answer"]]]);
  assert.deepEqual(capture.sources[0].group.selectionChange, change());
  assert.deepEqual(capture.sources[1].group.selectionChange, change(), "live must keep the current-context selection anchor");
  assert.equal(unarchivedGroups(original, new Set([u.id, c.id]))[0].selectionChange, undefined,
    "original-global suffix is demonstrably a different pure oracle");
});

test("captures full archive order and same-bucket T/B/C without groupId deduplication", () => {
  const { input, m } = fixture(), capture = captureCanonicalSources(input);
  assert.deepEqual(capture.sources.map(source => source.group.ids), [["m"], ["m"], ["m"], ["n"], ["p"]]);
  assert.deepEqual(capture.sources.map(source => source.sourceKey), ["source:0", "source:1", "source:2", "source:3", "source:4"]);
  assert.deepEqual(capture.sources.slice(0, 3).map(source => source.storage), Array(3).fill({ kind: "archive", segmentId: "a", segmentOrder: 0 }));
  assert.deepEqual(capture.sources[3].storage, { kind: "archive", segmentId: "b", segmentOrder: 1 });
  assert.deepEqual(capture.sources[4].storage, { kind: "live" });
  assert.deepEqual([0, 1, 2].map(i => fact(capture, i).isLastForMessage), [false, false, true]);
  assert.deepEqual([0, 1, 2].map(i => fact(capture, i).ownerRunId), [m.runId, m.runId, m.runId]);
  assert.equal(fact(capture, 3).ownerRunId, null);
  assert.deepEqual(capture.archive, input.archive.index);
  assert.equal(capture.message("a")?.text, "full summary a");
  assert.ok(capture.sources.every(source => !source.group.ids.some(id => id === "a" || id === "b")), "checkpoints are metadata, not occurrences");
});

test("live clipping uses real masks, suffix identity, selection clearing and actual member owner", () => {
  const { input, p } = fixture(); delete p.runId;
  const group: ThreadGroup = { id: "old-process", ids: ["m", "p"], activity: true, folded: true, hasTasks: false,
    runIds: ["stale-archived-owner"], thinkingOnlyIds: ["m", "p"], callsOnlyIds: ["m"], bodyHiddenIds: ["m", "p"], selectionChange: change() };
  input.currentGroups = [group];
  const expected = unarchivedGroups([group], new Set(["a", "b", "m", "n"]));
  const capture = captureCanonicalSources(input), live = capture.sources.at(-1)!;
  assert.deepEqual(live.group, expected[0]);
  assert.equal(live.group.id, "final-process:p"); assert.equal(live.group.selectionChange, undefined);
  assert.deepEqual(live.group.thinkingOnlyIds, ["p"]); assert.deepEqual(live.group.callsOnlyIds, []);
  assert.deepEqual(live.group.bodyHiddenIds, ["p"]); assert.equal(live.group.hasTasks, false);
  assert.equal(fact(capture, capture.sources.length - 1).ownerRunId, null, "stale runIds cannot supply legacy ownership");
});

test("complete lookup applies archive then current then terminal overlay without moving storage", () => {
  const { input } = fixture();
  const current = assistant("m", { text: "current", runId: "current-owner", calls: [{ id: "new", name: "read", input: "current input" }] });
  const terminal = assistant("m", { text: "terminal before disk", status: "completed", streaming: false, runId: "terminal-owner",
    calls: [{ id: "x", name: "read", input: "x full" }, { id: "y", name: "delegate", input: "y full" }] });
  const result: ChatMessage = { id: "tool-y", role: "toolResult", text: "full result before disk", toolCallId: "y" };
  input.currentMessages.set("m", current); input.transientMessages = map(terminal, result);
  const capture = captureCanonicalSources(input);
  assert.deepEqual(capture.message("m"), terminal); assert.deepEqual(capture.message(result.id), result);
  assert.equal(fact(capture, 2).ownerRunId, "terminal-owner"); assert.equal(fact(capture, 2).shape.callsCount, 2);
  assert.deepEqual(capture.sources[2].storage, { kind: "archive", segmentId: "a", segmentOrder: 0 });
  assert.deepEqual(capture.sources[2].group, input.archive.index.segments[0].groups[2], "existing catalogue masks are not recomputed from overlays");
  assert.equal(capture.archive.revision, "archive-only", "archive revision is not body authority");
  assert.ok(capture.sources.every(source => !source.group.ids.includes(result.id)));
});

test("no-file and zero-checkpoint captures retain overlay-only live terminal messages", () => {
  const input = empty(), terminal = assistant("terminal", { text: "not persisted", phase: "final_answer", status: "completed", streaming: false });
  input.transientMessages = map(terminal); input.currentGroups = threadGroups([terminal]);
  const capture = captureCanonicalSources(input);
  assert.deepEqual(capture.sources.map(source => [source.storage.kind, source.group.ids]), [["live", ["terminal"]]]);
  assert.deepEqual(capture.message("terminal"), terminal); assert.equal(fact(capture, 0).source.delivery, true);
  const knownEmpty = captureCanonicalSources(empty());
  assert.deepEqual(knownEmpty.sources, []); assert.equal(knownEmpty.message("missing"), undefined);
  assert.equal(knownEmpty.occurrences.get("source:0", 0), undefined);
});

test("snapshots nested full messages, catalogue and sources without freezing callers or rereading maps", () => {
  const { input, m } = fixture();
  m.selectionChange = change(); m.inputIds = ["input"];
  m.images = [{ id: "image", name: "original image", mimeType: "image/png", path: "/original.png" }];
  m.attachments = [{ id: "attachment", name: "original file", kind: "file", path: "/original.txt" }];
  m.skills = [{ id: "skill", name: "original skill", description: "description" }];
  m.calls![0].taskPreview = { titles: ["original task"] };
  input.archive.index.segments[0].groups[0].selectionChange = change();
  const expectedMessage = structuredClone(m), expectedArchive = structuredClone(input.archive.index);
  const capture = captureCanonicalSources(input), expectedSources = structuredClone(capture.sources);
  m.text = "mutated"; m.thinking = "mutated"; m.calls![0].input = "mutated";
  m.calls![0].taskPreview!.titles![0] = "mutated"; m.calls!.reverse();
  m.images[0].name = "mutated"; m.attachments[0].path = "/mutated"; m.skills[0].name = "mutated";
  m.inputIds[0] = "mutated"; m.selectionChange.from.provider = "mutated";
  input.archive.index.segments[0].groups[0].selectionChange!.to.id = "mutated";
  input.archive.index.segments[0].groups[0].ids.push("mutated");
  input.archive.index.segments[0].messageIds.push("mutated");
  input.archive.index.segments[0].compression.title = "mutated";
  input.currentGroups[0].ids.push("mutated");
  input.archive.messages.clear(); input.currentMessages.clear(); input.transientMessages.clear();
  assert.deepEqual(capture.message("m"), expectedMessage);
  assert.deepEqual(capture.archive, expectedArchive); assert.deepEqual(capture.sources, expectedSources);
  assert.equal(fact(capture, 0).ownerRunId, "run-m");
  assert.deepEqual(fact(capture, 0).source.selectionChange, change());
  assertDeepFrozen(capture); assertDeepFrozen(capture.message("m"));
  assert.equal(Reflect.set(capture.message("m")!, "text", "write"), false);
  assert.equal(Object.isFrozen(m), false); assert.equal(Object.isFrozen(m.images), false);
});

test("same-length post-preview edits produce independent complete captures despite unchanged archive revision", () => {
  const { input, m } = fixture();
  m.text = " ".repeat(16000) + "body-A";
  m.thinking = "t".repeat(1000) + "A"; m.calls![0].input = "i".repeat(20000) + "A";
  const expectedOld = structuredClone(m), before = captureCanonicalSources(input);
  m.text = m.text.slice(0, -1) + "B"; m.thinking = m.thinking.slice(0, -1) + "B";
  m.calls![0].input = m.calls![0].input.slice(0, -1) + "B";
  m.calls!.push({ id: "second", name: "delegate", input: "second full input" }); m.calls!.reverse();
  const after = captureCanonicalSources(input);
  assert.notStrictEqual(before, after); assert.equal(before.archive.revision, after.archive.revision);
  assert.deepEqual(before.message("m"), expectedOld); assert.deepEqual(after.message("m"), m);
  assert.equal(before.message("m")!.text.length, after.message("m")!.text.length);
  assert.equal(before.message("m")!.text.slice(0, 16000), after.message("m")!.text.slice(0, 16000));
  assert.equal(fact(before, 1).shape.body, "body"); assert.equal(fact(after, 2).shape.callsCount, 2);
  assert.equal(before.sources[0].sourceKey, after.sources[0].sourceKey, "local ordinals are intentionally not cross-capture identity");
});

test("full long Unicode identities are not truncated or used as capture-local source keys", () => {
  const id = "原始😀".repeat(1000), owner = "所有者🧪".repeat(1000), callId = "调用".repeat(1000), checkpointId = "归档".repeat(1000);
  const m = assistant(id, { runId: owner, calls: [{ id: callId, name: "read", input: "complete" }] });
  const c = checkpoint(checkpointId), input = empty();
  input.archive = { index: { revision: "long", segments: [segment(c, [id], threadGroups([m]))] }, messages: map(m, c) };
  const capture = captureCanonicalSources(input);
  assert.equal(capture.sources[0].sourceKey, "source:0");
  assert.deepEqual(capture.sources[0].storage, { kind: "archive", segmentId: checkpointId, segmentOrder: 0 });
  assert.equal(fact(capture, 0).messageId, id); assert.equal(fact(capture, 0).ownerRunId, owner);
  assert.equal(capture.message(id)!.calls![0].id, callId);
});

test("rejects inconsistent archive membership and checkpoint metadata rather than returning empty", () => {
  const cases: [string, (input: ReturnType<typeof fixture>["input"]) => void, string][] = [
    ["checkpoint duplicate", input => input.archive.index.segments.push(structuredClone(input.archive.index.segments[0])), "Canonical capture checkpoints must be unique"],
    ["membership duplicate", input => input.archive.index.segments[0].messageIds.push("m"), "Canonical capture archive membership must be disjoint"],
    ["cross bucket", input => input.archive.index.segments[1].messageIds.push("m"), "Canonical capture archive membership must be disjoint"],
    ["checkpoint membership", input => input.archive.index.segments[0].messageIds.push("b"), "Canonical capture archive membership must be disjoint"],
    ["outside group", input => input.archive.index.segments[0].groups[0].ids.push("p"), "Canonical capture group is outside its archive membership"],
    ["missing archive body", input => { input.archive.messages.delete("m"); input.currentMessages.delete("m"); }, "Canonical capture archive message is unavailable"],
    ["missing checkpoint", input => { input.archive.messages.delete("a"); }, "Canonical capture checkpoint metadata is unavailable or inconsistent"],
    ["checkpoint metadata", input => { input.archive.index.segments[0].compression.title = "changed"; }, "Canonical capture checkpoint metadata is unavailable or inconsistent"],
    ["map identity", input => { input.currentMessages.set("wrong-key", assistant("actual-id")); }, "Canonical capture message identity does not match"],
  ];
  for (const [name, mutate, message] of cases) {
    const { input } = fixture(); mutate(input);
    assert.throws(() => captureCanonicalSources(input), { name: "TypeError", message }, name);
  }
});

test("rejects explicit partial display bodies in every overlay layer", () => {
  for (const layer of ["archive", "current", "transient"] as const) for (const field of ["truncated", "text", "thinking", "input"] as const) {
    const { input } = fixture(), partial = assistant("partial", { text: "prefix", thinking: "prefix", calls: [{ id: "call", name: "read", input: "prefix" }] });
    if (field === "truncated") partial.truncated = true;
    if (field === "text") partial.textLength = 1000;
    if (field === "thinking") partial.thinkingLength = 1000;
    if (field === "input") partial.calls![0].inputLength = 1000;
    (layer === "archive" ? input.archive.messages : layer === "current" ? input.currentMessages : input.transientMessages).set(partial.id, partial);
    assert.throws(() => captureCanonicalSources(input), { name: "TypeError", message: "Canonical capture requires complete display messages" }, `${layer}/${field}`);
  }
});

test("does not swallow index-level missing, duplicate or hidden source members", () => {
  const cases: [ChatMessage | undefined, string[], string][] = [
    [undefined, ["missing"], "Canonical source message is unavailable"],
    [assistant("duplicate", { text: "body" }), ["duplicate", "duplicate"], "Canonical source members must be unique"],
    [{ id: "hidden", role: "toolResult", text: "result" }, ["hidden"], "Hidden result notifications are not canonical source members"],
    [{ id: "notice", role: "notice", text: "notice", taskNotice: "completed" }, ["notice"], "Hidden result notifications are not canonical source members"],
  ];
  for (const [message, ids, error] of cases) {
    const input = empty(); input.currentGroups = [{ id: "group", ids, activity: true }];
    if (message) input.currentMessages.set(message.id, message);
    assert.throws(() => captureCanonicalSources(input), { name: "TypeError", message: error });
  }
});

test("unreferenced full results and invisible placeholders remain in lookup without invented occurrences", () => {
  const input = empty(), c = checkpoint("c"), result: ChatMessage = { id: "result", role: "toolResult", text: "full result", toolCallId: "call" };
  const placeholder = assistant("placeholder"), notice: ChatMessage = { id: "notice", role: "notice", text: "legacy", taskNotice: "unknown" };
  input.archive = { index: { revision: "metadata", segments: [segment(c, [result.id, placeholder.id, notice.id], [])] }, messages: map(c, result, placeholder, notice) };
  Object.freeze(input.currentGroups);
  Object.freeze(input.archive.index.segments[0].messageIds);
  Object.freeze(input.archive.index.segments[0].groups);
  Object.freeze(input.archive.index.segments[0]);
  Object.freeze(input.archive.index.segments);
  Object.freeze(input.archive.index);
  const capture = captureCanonicalSources(input);
  assert.deepEqual(capture.sources, []);
  for (const message of [c, result, placeholder, notice]) assert.deepEqual(capture.message(message.id), message);
  assert.equal(capture.message("not-loaded"), undefined);
});
