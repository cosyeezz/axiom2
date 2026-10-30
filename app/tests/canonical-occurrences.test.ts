import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage, SelectionChange } from "../src/shared/agent.js";
import type { HistorySegment, ThreadGroup } from "../src/shared/history.js";
import { unarchivedGroups } from "../src/shared/history.js";
import { historyFlow, type HistorySource } from "../src/shared/history-layout.js";
import { processSlices } from "../src/shared/process-layout.js";
import { mergeProcessGroups, threadGroups } from "../src/shared/thread-layout.js";
import { buildCanonicalOccurrences, type CanonicalOccurrenceFact, type CanonicalOccurrenceIndex,
  type CanonicalOccurrenceShape, type CanonicalSourceInput } from "../src/shared/canonical-occurrences.js";

const change = (): SelectionChange => ({ from: { provider: "old-provider", id: "old-model", thinking: "off" },
  to: { provider: "new-provider", id: "new-model", thinking: "high" } });
const call = (id: string, name = "read") => ({ id, name, input: "{}" });
const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", text: "", ...extra });
const lookup = (messages: ChatMessage[]) => new Map(messages.map(message => [message.id, message]));
const liveSource = (sourceKey: string, group: ThreadGroup): CanonicalSourceInput => ({ sourceKey, storage: { kind: "live" }, group });
function fact(index: CanonicalOccurrenceIndex, key: string, memberOrder = 0) {
  const value = index.get(key, memberOrder);
  assert.ok(value, `fixture query ${key}/${memberOrder} must exist`);
  return value;
}

type MutableShape = { -readonly [K in keyof CanonicalOccurrenceShape]: CanonicalOccurrenceShape[K] };
/** External activity oracle: count actual existing primitive slices/entries, not mask guesses. */
function activityShapes(group: CanonicalSourceInput["group"], byId: Map<string, ChatMessage>) {
  const result = new Map<string, MutableShape>(group.ids.map(id => [id,
    { thinking: false, body: "none", outcome: false, callsCount: 0 }]));
  const slices = processSlices(group.ids.map(id => byId.get(id)!), group.thinkingOnlyIds?.slice(), group.callsOnlyIds?.slice(), group.bodyHiddenIds?.slice());
  for (const slice of slices) {
    if (slice.kind === "body" || slice.kind === "notice") result.get(slice.id)!.body = slice.kind;
    else if (slice.kind === "task") result.get(slice.call.messageId)!.callsCount++;
    else if (slice.kind === "process") for (const entry of slice.entries) {
      if (entry.kind === "tool") result.get(entry.call.messageId)!.callsCount++;
      else if (entry.kind === "thinking") result.get(entry.id)!.thinking = true;
      else result.get(entry.id)!.outcome = true;
    }
  }
  return result;
}

/** Current-producer-compatible: every message belongs to one physical storage bucket.
 * m's T/B/C occupy several sources in A; the global calls group spans A/B/live. */
function croppedFixture() {
  const messages = [assistant("m", { text: "narration", thinking: "thought", runId: "r-m", calls: [call("cm")] }),
    assistant("k", { runId: "r-k", calls: [call("ck")] }),
    assistant("q", { runId: "r-q", calls: [call("cq")] }),
    assistant("n", { runId: "r-n", calls: [call("cn")] })];
  const byId = lookup(messages), global = threadGroups(messages);
  const buckets = [["m"], ["k", "q"]];
  const segments: HistorySegment[] = buckets.map((ids, segmentOrder) => ({ id: ["A", "B"][segmentOrder],
    compression: { number: segmentOrder + 1, title: "checkpoint", before: 10, after: 2 }, messageIds: ids,
    groups: unarchivedGroups(global, new Set(messages.flatMap(message => ids.includes(message.id) ? [] : [message.id])))
      .map(group => ({ ...group, estimatedHeight: 60,
        messageRunIds: Object.fromEntries(group.ids.map(id => [id, byId.get(id)!.runId!])) })) }));
  const live = unarchivedGroups(global, new Set(buckets.flat()));
  const sources: CanonicalSourceInput[] = [...segments.flatMap((segment, segmentOrder) => segment.groups.map(group => ({
    sourceKey: `archive:${segment.id}:${group.id}`, storage: { kind: "archive" as const, segmentId: segment.id, segmentOrder }, group }))),
    ...live.map((group, position) => liveSource(`live:${position}`, group))];
  return { messages, byId, global, segments, live, sources };
}
function originalSourceKey(source: HistorySource) {
  return source.kind === "archive" ? `archive:${source.segment.id}:${source.readGroupId ?? source.group.id}` : `live:${source.position}`;
}

test("complete T/B/C occurrences keep last stable under partial and reordered queries", () => {
  const { byId, sources } = croppedFixture();
  const expected = sources.map(source => source.group.activity ? activityShapes(source.group, byId) : undefined);
  const index = buildCanonicalOccurrences(sources, byId);
  const mFacts = sources.flatMap(source => source.group.ids.flatMap((id, member) =>
    id === "m" ? [fact(index, source.sourceKey, member)] : []));
  assert.equal(mFacts.length, 3);
  assert.deepEqual(mFacts.map(value => value.isLastForMessage), [false, false, true]);
  assert.deepEqual(mFacts.map(value => value.source.storage.kind), ["archive", "archive", "archive"]);
  for (const position of [2, 0, 1, 0, 2])
    assert.strictEqual(index.get(mFacts[position].source.sourceKey, mFacts[position].memberOrder), mFacts[position]);
  sources.forEach((source, sourceOrder) => source.group.ids.forEach((id, memberOrder) => {
    const value = fact(index, source.sourceKey, memberOrder);
    assert.equal(value.source.sourceOrder, sourceOrder);
    assert.equal(value.memberOrder, memberOrder);
    assert.equal(value.messageId, id);
    assert.equal(value.ownerRunId, byId.get(id)!.runId);
    if (source.group.activity) assert.deepEqual(value.shape, expected[sourceOrder]!.get(id));
    else assert.deepEqual(value.shape, { thinking: false, body: "body", outcome: false, callsCount: 0 });
  }));
});

test("captured last plus activity gate equals real historyFlow cuts for every normalized suffix", () => {
  const { sources, segments, live, byId } = croppedFixture();
  const index = buildCanonicalOccurrences(sources, byId);
  const breakSets = [[], ["m"], ["k"], ["q"], ["n"], ["m", "k", "q", "n"]];
  let checks = 0;
  for (let firstOpen = 0; firstOpen <= segments.length; firstOpen++) {
    const open = new Map(segments.map((segment, order) => [segment.id, order >= firstOpen]));
    for (const ids of breakSets) {
      const breaks = new Set(ids);
      const flow = historyFlow(segments, open, live, breaks, id => byId.get(id)?.runId);
      const actual = flow.flatMap(entry => entry.kind === "messages" && entry.boundary ? [{
        sourceKey: originalSourceKey(entry.sources.at(-1)!), messageId: entry.sources.at(-1)!.group.ids.at(-1),
      }] : []);
      const expected = sources.flatMap(source => source.storage.kind === "archive" && source.storage.segmentOrder < firstOpen ? []
        : source.group.ids.flatMap((id, memberOrder) => {
          const value = fact(index, source.sourceKey, memberOrder);
          return value.source.activity && breaks.has(id) && value.isLastForMessage
            ? [{ sourceKey: source.sourceKey, messageId: id }] : [];
        }));
      assert.deepEqual(expected, actual, `suffix ${firstOpen}; breaks ${ids}`);
      assert.deepEqual(flow.flatMap(entry => entry.kind === "card" ? [entry.segment.id] : []),
        segments.slice(0, firstOpen).map(segment => segment.id));
      checks++;
    }
  }
  assert.equal(checks, 18);
  // A final non-activity body is globally last but cannot create boundary:true.
  const m = assistant("final", { text: "delivered", thinking: "thought", phase: "final_answer", status: "completed" });
  const groups = threadGroups([m]), body = groups.find(group => !group.activity)!;
  const bodyIndex = buildCanonicalOccurrences(groups.map((group, i) => liveSource(`final:${i}`, group)), lookup([m]));
  const terminalBody = fact(bodyIndex, `final:${groups.indexOf(body)}`);
  assert.equal(terminalBody.isLastForMessage, true);
  assert.equal(terminalBody.source.activity && new Set([m.id]).has(terminalBody.messageId) && terminalBody.isLastForMessage, false);
  assert.equal(historyFlow([], new Map(), groups, new Set([m.id])).some(entry => entry.kind === "messages" && entry.boundary), false);
});

test("generalized cross-segment occurrences preserve suffix last without claiming producer reachability", () => {
  const m = assistant("generalized", { text: "body", thinking: "thought", calls: [call("c")] });
  const groups = threadGroups([m]);
  assert.equal(groups.length, 3);
  // Deliberately stronger abstract storage input: current producer keeps this message in one bucket.
  const segments: HistorySegment[] = [0, 1].map(i => ({ id: ["A", "B"][i], messageIds: [m.id],
    compression: { number: i + 1, title: "abstract", before: 10, after: 2 },
    groups: [{ ...groups[i], estimatedHeight: 60 }] }));
  const live = [groups[2]];
  const sources: CanonicalSourceInput[] = [...segments.map((segment, segmentOrder) => ({
    sourceKey: `archive:${segment.id}:${segment.groups[0].id}`,
    storage: { kind: "archive" as const, segmentId: segment.id, segmentOrder }, group: segment.groups[0] })),
    liveSource("live:0", live[0])];
  const index = buildCanonicalOccurrences(sources, lookup([m]));
  assert.deepEqual(sources.map(source => fact(index, source.sourceKey).isLastForMessage), [false, false, true]);
  for (let firstOpen = 0; firstOpen <= 2; firstOpen++) {
    const visible = sources.filter(source => source.storage.kind === "live" || source.storage.segmentOrder >= firstOpen);
    assert.ok(visible.some(source => fact(index, source.sourceKey).isLastForMessage));
    const flow = historyFlow(segments, new Map(segments.map((segment, i) => [segment.id, i >= firstOpen])), live, new Set([m.id]));
    assert.deepEqual(flow.flatMap(entry => entry.kind === "messages" && entry.boundary
      ? [originalSourceKey(entry.sources.at(-1)!)] : []), ["live:0"]);
  }
});

test("activity shapes match processSlices for masks 0/1/4/5/7 and overlapping lists", () => {
  const m = assistant("m", { text: "body", thinking: "thought", calls: [call("read"), call("task", "delegate")] });
  const masks: Partial<ThreadGroup>[] = [{}, { thinkingOnlyIds: [m.id] }, { callsOnlyIds: [m.id] },
    { bodyHiddenIds: [m.id] }, { thinkingOnlyIds: [m.id], callsOnlyIds: [m.id] },
    { thinkingOnlyIds: [m.id], bodyHiddenIds: [m.id] }, { callsOnlyIds: [m.id], bodyHiddenIds: [m.id] },
    { thinkingOnlyIds: [m.id, m.id, "unrelated"] }];
  const groups = masks.map((mask, i) => ({ id: `g${i}`, ids: [m.id], activity: true, ...mask }));
  const merged = mergeProcessGroups([groups[1], groups[2]]);
  assert.deepEqual(merged.bodyHiddenIds, [m.id]);
  groups.push(merged);
  const byId = lookup([m]), expected = groups.map(group => activityShapes(group, byId));
  const index = buildCanonicalOccurrences(groups.map((group, i) => liveSource(`mask:${i}`, group)), byId);
  groups.forEach((_, i) => assert.deepEqual(fact(index, `mask:${i}`).shape, expected[i].get(m.id)));
  assert.deepEqual(fact(index, "mask:4").shape, { thinking: false, body: "none", outcome: false, callsCount: 0 });
  assert.deepEqual(fact(index, "mask:8").shape, { thinking: true, body: "none", outcome: false, callsCount: 2 });
});

test("direct hideThinking suppresses both thinking and calls without applying activity masks", () => {
  const m = assistant("m", { text: "body", thinking: "thought", calls: [call("c")] });
  const generated = threadGroups([m]).find(group => !group.activity)!;
  assert.equal(generated.hideThinking, true);
  // Additional direct branch combination is a helper contract test, not producer reachability.
  const direct = { ...generated, hideThinking: false, thinkingOnlyIds: [m.id], callsOnlyIds: [m.id] };
  const index = buildCanonicalOccurrences([liveSource("generated", generated), liveSource("direct", direct)], lookup([m]));
  assert.deepEqual(fact(index, "generated").shape, { thinking: false, body: "body", outcome: false, callsCount: 0 });
  assert.deepEqual(fact(index, "direct").shape, { thinking: true, body: "body", outcome: false, callsCount: 1 });
});

test("whitespace and empty selection placeholders retain direct renderer semantics", () => {
  const white = assistant("white", { text: " \n\t", selectionChange: change() });
  const empty = assistant("empty", { selectionChange: change() });
  const invisible = assistant("invisible");
  const groups = threadGroups([white, empty, invisible]);
  assert.deepEqual(groups.map(group => group.ids), [[white.id], [empty.id]]);
  const processWhite: ThreadGroup = { id: "activity-white", ids: [white.id], activity: true };
  const byId = lookup([white, empty, invisible]);
  const expectedProcess = activityShapes(processWhite, byId);
  const index = buildCanonicalOccurrences([...groups.map(group => liveSource(group.id, group)), liveSource("process", processWhite)], byId);
  assert.deepEqual(fact(index, "white").shape, { thinking: false, body: "body", outcome: false, callsCount: 0 });
  assert.deepEqual(fact(index, "empty").shape, { thinking: false, body: "none", outcome: false, callsCount: 0 });
  assert.deepEqual(fact(index, "process").shape, expectedProcess.get(white.id));
  assert.equal(fact(index, "empty").source.selectionChange?.to.id, "new-model");
});

test("thinkingActive, images and terminal attempts follow real primitive entries", () => {
  const messages = [assistant("active", { thinkingActive: true, streaming: false }),
    assistant("failed", { status: "failed" }), assistant("cancelled", { status: "cancelled" }),
    assistant("error", { thinking: "thought", error: "failure" }), assistant("running", { status: "running" }),
    assistant("completed", { status: "completed" }),
    assistant("image", { status: "failed", images: [{ id: "i", name: "image", mimeType: "image/png" }] }),
    assistant("body-error", { text: "body", error: "failure" })];
  // Primitive process branch combinations, including ones grouping normally puts outside activity.
  const groups = messages.map(message => ({ id: message.id, ids: [message.id], activity: true }));
  const byId = lookup(messages), expected = groups.map(group => activityShapes(group, byId));
  const index = buildCanonicalOccurrences(groups.map(group => liveSource(group.id, group)), byId);
  groups.forEach((group, i) => assert.deepEqual(fact(index, group.id).shape, expected[i].get(group.id)));
  assert.equal(fact(index, "active").shape.thinking, true);
  assert.equal(fact(index, "failed").shape.outcome, true);
  assert.equal(fact(index, "image").shape.outcome, false);
  assert.equal(fact(index, "image").shape.body, "body");
  const imageFinal = { ...messages[6], status: "completed" as const, phase: "final_answer" as const };
  const imageGroup = threadGroups([imageFinal])[0];
  assert.equal(imageGroup.delivery, true);
  const imageIndex = buildCanonicalOccurrences([liveSource("image-final", imageGroup)], lookup([imageFinal]));
  assert.equal(fact(imageIndex, "image-final").source.delivery, true);
  assert.equal(fact(imageIndex, "image-final").shape.body, "body");
});

test("notice/compression priority and user structure are branch-specific, not text-presence proofs", () => {
  const messages: ChatMessage[] = [{ id: "u", role: "user", text: "" }, { id: "notice", role: "notice", text: "" },
    assistant("compression", { compression: { number: 1, title: "checkpoint", before: 10, after: 2 } })];
  const sources = messages.flatMap(message => [liveSource(`direct:${message.id}`, { id: message.id, ids: [message.id], activity: false }),
    liveSource(`process:${message.id}`, { id: message.id, ids: [message.id], activity: true,
      thinkingOnlyIds: [message.id], callsOnlyIds: [message.id] })]);
  const byId = lookup(messages);
  const expected = sources.filter(source => source.group.activity).map(source => activityShapes(source.group, byId));
  const index = buildCanonicalOccurrences(sources, byId);
  assert.equal(fact(index, "direct:u").shape.body, "body");
  assert.equal(fact(index, "direct:notice").shape.body, "notice");
  assert.equal(fact(index, "direct:compression").shape.body, "notice");
  messages.forEach((message, i) => assert.deepEqual(fact(index, `process:${message.id}`).shape, expected[i].get(message.id)));
});

test("ownership uses retained members, preserves order and leaves legacy ownership unknown", () => {
  const messages = [assistant("z", { thinking: "z", runId: "r-z" }), assistant("a", { thinking: "a", runId: "r-a" }),
    assistant("m", { thinking: "legacy" })];
  const groups = threadGroups(messages);
  assert.deepEqual(groups[0].ids, ["z", "a", "m"]);
  const retained = unarchivedGroups(groups, new Set(["z", "a"]))[0];
  assert.deepEqual(retained.runIds, ["r-z", "r-a"]); // helper retains stale group ownership metadata
  const index = buildCanonicalOccurrences([liveSource("full", groups[0]), liveSource("retained", retained)], lookup(messages));
  assert.deepEqual([0, 1, 2].map(member => fact(index, "full", member).messageId), ["z", "a", "m"]);
  assert.deepEqual([0, 1, 2].map(member => fact(index, "full", member).ownerRunId), ["r-z", "r-a", null]);
  assert.equal(fact(index, "retained").ownerRunId, null);
  assert.equal(fact(index, "full", 2).isLastForMessage, false);
  assert.equal(fact(index, "retained").isLastForMessage, true);
  const emptyRun = assistant("legacy-empty", { thinking: "legacy", runId: "" });
  assert.equal(fact(buildCanonicalOccurrences([liveSource("empty-run", threadGroups([emptyRun])[0])], lookup([emptyRun])), "empty-run").ownerRunId, null);
});

test("source identity is independent of group IDs and internal native strings are not clipped", () => {
  const id = "native:😀:".repeat(200), owner = "owner:中:".repeat(200);
  const m = assistant(id, { text: "body", runId: owner });
  const group: ThreadGroup = { id: "shared-group-id", ids: [id], activity: false,
    delivery: false, folded: false, hasTasks: false, hideThinking: false };
  // Generalized duplicate-source occurrences test identity, not current producer reachability.
  const first = liveSource("source:😀:".repeat(200), group), second = liveSource("distinct-key", group);
  const index = buildCanonicalOccurrences([first, second], lookup([m]));
  const a = fact(index, first.sourceKey), b = fact(index, second.sourceKey);
  assert.equal(a.source.groupId, b.source.groupId);
  assert.notEqual(a.source.sourceKey, b.source.sourceKey);
  assert.deepEqual([a.source.delivery, a.source.folded, a.source.hasTasks, a.source.hideThinking], [false, false, false, false]);
  assert.equal(a.messageId, id);
  assert.equal(a.ownerRunId, owner);
  assert.equal(a.isLastForMessage, false);
  assert.equal(b.isLastForMessage, true);
  for (const order of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1]) assert.equal(index.get(first.sourceKey, order), undefined);
  assert.equal(index.get("unknown-source", 0), undefined);
});

test("existing global selection and fold flags are copied, never reconstructed from local shape", () => {
  const u: ChatMessage = { id: "u", role: "user", text: "request", runId: "r" };
  const inputs: ChatMessage[] = Array.from({ length: 40 }, (_, i) => ({ id: `continued-${i}`, role: "user", text: "more", runId: "r", inputContinuation: true }));
  const reply = assistant("reply", { text: "answer", runId: "r", selectionChange: change() });
  const messages = [u, ...inputs, reply], groups = threadGroups(messages);
  assert.deepEqual(groups[0].selectionChange, reply.selectionChange);
  const index = buildCanonicalOccurrences(groups.map((group, i) => liveSource(`global:${i}`, group)), lookup(messages));
  assert.deepEqual(fact(index, "global:0").source.selectionChange, groups[0].selectionChange);
  const emptyFirst = assistant("first-empty", { runId: "r" });
  const lateGroups = threadGroups([u, emptyFirst, reply]);
  assert.equal(lateGroups[0].selectionChange, undefined);
  assert.deepEqual(lateGroups.find(group => group.ids.includes(reply.id))!.selectionChange, reply.selectionChange);
  const p = assistant("p", { thinking: "prior", runId: "old" });
  const continuation: ChatMessage = { id: "continuation", role: "user", text: "continue", inputContinuation: true, runId: "new" };
  const final = assistant("final", { text: "done", runId: "new", phase: "final_answer", status: "completed" });
  const delivered = threadGroups([p, continuation, final]);
  assert.equal(delivered.find(group => group.ids.includes(p.id))!.folded, true);
  const deliveredIndex = buildCanonicalOccurrences(delivered.map((group, i) => liveSource(`fold:${i}`, group)), lookup([p, continuation, final]));
  delivered.forEach((group, i) => {
    const header = fact(deliveredIndex, `fold:${i}`).source;
    assert.equal(header.folded, group.folded);
    assert.equal(header.delivery, group.delivery);
    assert.equal(header.hasTasks, group.hasTasks);
  });
  const task = assistant("delegation", { calls: [call("task-call", "delegate")] });
  const taskGroup = threadGroups([task])[0];
  assert.equal(taskGroup.hasTasks, true);
  const taskIndex = buildCanonicalOccurrences([liveSource("task-header", taskGroup)], lookup([task]));
  assert.equal(fact(taskIndex, "task-header").source.hasTasks, true);
});

test("capture snapshots scalars and nested headers without freezing caller-owned values", () => {
  const m = assistant("m", { text: "body", thinking: "thought", thinkingActive: true, status: "failed", runId: "run-before",
    calls: [call("c")], images: [{ id: "i", name: "image", mimeType: "image/png" }], selectionChange: change() });
  const group = threadGroups([m])[0];
  const storage = { kind: "archive" as const, segmentId: "A", segmentOrder: 0 };
  const source = { sourceKey: "before", storage, group }, byId = lookup([m]);
  const index = buildCanonicalOccurrences([source], byId), before = fact(index, "before"), snapshot = structuredClone(before);
  assert.ok(before.source.selectionChange);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(group), false);
  assert.equal(Object.isFrozen(m), false);
  source.sourceKey = "after"; storage.segmentId = "changed"; storage.segmentOrder = 99;
  group.id = "changed"; group.ids.splice(0, group.ids.length, "missing"); group.activity = false;
  group.thinkingOnlyIds?.splice(0); group.callsOnlyIds = [m.id]; group.hideThinking = true;
  group.selectionChange!.from.provider = "changed"; group.selectionChange!.to.thinking = "off";
  m.runId = "run-after"; m.text = ""; m.thinking = ""; m.thinkingActive = false; m.status = "completed";
  m.calls!.length = 0; m.images!.length = 0; byId.set(m.id, assistant(m.id));
  assert.deepEqual(before, snapshot);
  assert.strictEqual(index.get("before", 0), before);
  assert.equal(index.get("after", 0), undefined);
  for (const value of [index, before, before.shape, before.source, before.source.storage,
    before.source.selectionChange, before.source.selectionChange.from, before.source.selectionChange.to]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => Object.assign(before.shape, { thinking: false }), TypeError);
  assert.throws(() => Object.assign(before.source.storage, { segmentId: "corrupt" }), TypeError);
  assert.throws(() => Object.assign(before.source.selectionChange!.from, { provider: "corrupt" }), TypeError);
  assert.deepEqual(fact(index, "before"), snapshot);
  const frozenMessage = Object.freeze({ id: "frozen", role: "assistant" as const, text: "body", calls: Object.freeze([Object.freeze(call("f"))]) });
  const frozenSource = Object.freeze({ sourceKey: "frozen", storage: Object.freeze({ kind: "live" as const }),
    group: Object.freeze({ id: "frozen", ids: Object.freeze(["frozen"]), activity: true }) });
  assert.equal(fact(buildCanonicalOccurrences(Object.freeze([frozenSource]), new Map([["frozen", frozenMessage]])), "frozen").shape.callsCount, 1);
});

test("inconsistent members fail closed while unreferenced hidden records and empty sources remain legal", () => {
  const m = assistant("m", { text: "body" }), group: ThreadGroup = { id: "g", ids: [m.id], activity: false };
  const source = liveSource("s", group), byId = lookup([m]);
  assert.throws(() => buildCanonicalOccurrences([source, source], byId), { name: "TypeError", message: "Canonical source keys must be unique" });
  assert.throws(() => buildCanonicalOccurrences([liveSource("d", { ...group, ids: [m.id, m.id] })], byId), { name: "TypeError", message: "Canonical source members must be unique" });
  assert.throws(() => buildCanonicalOccurrences([source], new Map()), { name: "TypeError", message: "Canonical source message is unavailable" });
  assert.throws(() => buildCanonicalOccurrences([source], new Map([[m.id, assistant("other")]])), { name: "TypeError", message: "Canonical source message identity does not match" });
  const hidden: ChatMessage[] = [{ id: "result", role: "toolResult", text: "result" }, assistant("notice", { taskNotice: "completed" })];
  for (const message of hidden) assert.throws(() => buildCanonicalOccurrences([liveSource("hidden", { id: message.id, ids: [message.id], activity: false })], lookup([message])),
    { name: "TypeError", message: "Hidden result notifications are not canonical source members" });
  assert.equal(fact(buildCanonicalOccurrences([source], lookup([m, ...hidden])), "s").messageId, m.id);
  assert.equal(buildCanonicalOccurrences([], byId).get("none", 0), undefined);
  assert.equal(buildCanonicalOccurrences([liveSource("empty", { id: "empty", ids: [], activity: true })], byId).get("empty", 0), undefined);
});

test("one occurrence may contain 1000 calls without proving any collection-page coverage", () => {
  const m = assistant("giant", { calls: Array.from({ length: 1000 }, (_, i) => call(`c${i}`)) });
  const group = threadGroups([m])[0], expected = activityShapes(group, lookup([m])).get(m.id)!;
  assert.equal(expected.callsCount, 1000);
  const index = buildCanonicalOccurrences([liveSource("giant", group)], lookup([m]));
  const value = fact(index, "giant");
  assert.deepEqual(value.shape, expected);
  assert.equal(value.isLastForMessage, true);
  assert.equal("coverage" in value, false);
  assert.equal("calls" in value, false);
  assert.strictEqual(index.get("giant", 0), value);
});

// Compile-only negative assertions: never execute writes to frozen results.
function readonlyContract(value: CanonicalOccurrenceFact, index: CanonicalOccurrenceIndex) {
  // @ts-expect-error captured fact is readonly
  value.isLastForMessage = false;
  // @ts-expect-error nested shape is readonly
  value.shape.callsCount = 0;
  // @ts-expect-error source header is readonly
  value.source.sourceKey = "mutated";
  if (value.source.storage.kind === "archive") {
    // @ts-expect-error nested archive storage is readonly
    value.source.storage.segmentOrder = 0;
  }
  if (value.source.selectionChange) {
    // @ts-expect-error deeply nested selection is readonly
    value.source.selectionChange.to.provider = "mutated";
  }
  // @ts-expect-error query API itself is readonly
  index.get = () => undefined;
  const owner: string | null = value.ownerRunId;
  // @ts-expect-error legacy unknown is not a guaranteed owner string
  const knownOwner: string = value.ownerRunId;
  void owner; void knownOwner;
}
void readonlyContract;
