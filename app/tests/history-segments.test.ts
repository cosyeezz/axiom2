import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { historyProjection } from "../src/server/history-projection.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import { SegmentExpansion } from "../src/client/chat/history-expansion.js";
import { HistoryStore } from "../src/client/chat/history-store.js";
import type { HistoryIndex, HistoryRead } from "../src/shared/history.js";

const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 1 }) as any;
const tick = () => new Promise(resolve => setImmediate(resolve));
test("physical ranges are disjoint, preserve edits/retries, keep boundaries and current branch ownership", () => {
  const manager = SessionManager.inMemory();
  const user = (text: string) => manager.appendMessage({ role: "user", content: text, timestamp: 1 });
  const first = user("first");
  const edited = manager.appendMessage(assistant("before edit"));
  const omitted = manager.appendMessage(assistant("failed attempt"));
  const compaction1 = manager.appendCompaction("SUMMARY-ONE-SECRET", first, 5000);
  const retained = user("second");
  const compaction2 = manager.appendCompaction("SUMMARY-TWO-SECRET", retained, 5000);
  manager.appendContextEdit(edited, { content: "after edit" });
  manager.appendContextEdit(omitted, null);
  const latest = user("latest");
  const before = JSON.stringify(manager.getEntries());
  const result = historyProjection(manager, "fixture");
  assert.deepEqual(result.index.segments.map(segment => segment.id), [compaction1, compaction2]);
  assert.deepEqual(result.index.segments.map(segment => segment.messageIds), [[first, edited], [retained]]);
  assert.equal(result.messages.get(edited)?.text, "after edit");
  assert.equal(result.messages.has(omitted), false);
  assert.equal(result.index.segments.flatMap(segment => segment.messageIds).includes(latest), false);
  assert.equal(new Set(result.index.segments.flatMap(segment => segment.messageIds)).size, 3);
  assert.ok(!JSON.stringify(result.index).includes("SECRET"), "summaries must be lazy, not in the catalogue");
  assert.ok(!JSON.stringify(result.index).includes("after edit"), "bodies must be lazy");
  assert.equal(JSON.stringify(manager.getEntries()), before);
  manager.branch(first); user("different branch");
  assert.equal(historyProjection(manager, "other").index.segments.length, 0);
});

test("cross-boundary result retains its unique identity and is available to the call index", () => {
  const manager = SessionManager.inMemory();
  const call = manager.appendMessage({ ...assistant(""), content: [{ type: "toolCall", id: "across", name: "read", arguments: { path: "old.txt" } }] });
  manager.appendCompaction("summary", null, 2000);
  manager.appendMessage({ role: "toolResult", toolCallId: "across", toolName: "read", content: [{ type: "text", text: "full result" }], isError: false, timestamp: 1 });
  const result = historyProjection(manager, "fixture");
  assert.equal(result.index.segments[0].messageIds.includes(call), true);
  assert.equal(result.index.segments[0].messageIds.includes("tool-across"), false);
  assert.equal(result.messages.get("tool-across")?.text, "full result");
});

test("archive folds interrupted activities without a final answer, hides task notifications and keeps prose", () => {
  const cases = [
    { name: "tool-only", content: [{ type: "toolCall", id: "read", name: "read", arguments: { path: "history.ts" } }], stopReason: "toolUse" },
    { name: "thinking-only", content: [{ type: "thinking", thinking: "unfinished reasoning" }], stopReason: "toolUse" },
    { name: "error-only", content: [], stopReason: "error", errorMessage: "interrupted request" },
    { name: "cancelled", content: [], stopReason: "aborted" },
  ];
  for (const activity of cases) {
    const manager = SessionManager.inMemory();
    const id = manager.appendMessage({ role: "assistant", timestamp: 1, ...activity } as any);
    const notice = manager.appendCustomMessageEntry("axiom-result", JSON.stringify({ resultId: "delivered", status: "completed" }), true);
    manager.appendMessage({ role: "user", content: "ordinary boundary", timestamp: 1 });
    manager.appendCustomMessageEntry("axiom-result", JSON.stringify({ resultId: "notice-only", status: "completed" }), true);
    const plain = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "plain reply without stop reason" }], timestamp: 1 } as any);
    const commentary = manager.appendMessage({ ...assistant("commentary must remain readable"), content: [{ type: "text", text: "commentary must remain readable", textSignature: JSON.stringify({ v: 1, id: "commentary", phase: "commentary" }) }] });
    manager.appendCompaction("summary", null, 2000);
    manager.appendMessage({ role: "assistant", timestamp: 1, ...activity } as any);
    const result = historyProjection(manager, "fixture"), segment = result.index.segments[0];
    const group = segment.groups.find(g => g.ids.includes(id))!;
    assert.equal(group.folded, true, activity.name);
    assert.ok(group.process, activity.name);
    assert.equal(group.process.status, activity.name === "cancelled" ? "cancelled" : activity.name === "error-only" ? "failed" : "completed");
    assert.equal(group.process.calls, activity.name === "tool-only" ? 1 : 0);
    assert.equal(group.process.inline, false, "settled interrupted history has an outer status card; its original process stays inside");
    assert.equal(segment.messageIds.includes(notice), false);
    assert.equal(result.messages.has(notice), false);
    assert.equal(segment.groups.some(g => "notices" in g), false);
    assert.ok(![...result.messages.values()].some(m => m.taskNotice));
    assert.equal(segment.groups.find(g => g.ids.includes(plain))?.activity, false, "unmarked ordinary prose stays outside");
    const commentaryGroup = segment.groups.find(g => g.ids.includes(commentary))!;
    assert.equal(commentaryGroup.activity, true); assert.equal(commentaryGroup.folded, true);
    assert.equal(commentaryGroup.process?.inline, false, "explicit process narration has a lazy outer archive card");
    assert.ok(!commentaryGroup.ids.includes(plain));
    assert.ok(!threadGroups(segment.messageIds.map(mid => result.messages.get(mid)!)).find(g => g.ids.includes(id))?.folded, "shared live grouping must not prematurely fold");
  }
});

test("commentary-only native archive closes before a later cross-compaction delivery", () => {
  for (const runId of ["same-run", undefined]) {
    const manager = SessionManager.inMemory();
    const commentary = manager.appendMessage({ ...assistant("process only"), axiomRunId: runId, content: [{ type: "text", text: "PRIVATE-COMMENTARY", textSignature: JSON.stringify({ v: 1, id: "commentary", phase: "commentary" }) }] } as any);
    const first = manager.appendCompaction("first summary", null, 2000);
    const final = manager.appendMessage({ ...assistant("PRIVATE-DELIVERY"), axiomRunId: runId } as any);
    const second = manager.appendCompaction("second summary", null, 2000);
    const projection = historyProjection(manager, "fixture");
    const before = projection.index.segments.find(s => s.id === first)!, after = projection.index.segments.find(s => s.id === second)!;
    assert.equal(before.groups.length, 1); assert.deepEqual(before.groups[0].ids, [commentary]);
    assert.equal(before.groups[0].folded, true); assert.equal(before.groups[0].process?.inline, false);
    assert.equal(projection.messages.get(commentary)?.phase, "commentary");
    assert.deepEqual(after.groups.map(g => [g.ids, g.activity, g.delivery]), [[[final], false, true]]);
    assert.ok(!JSON.stringify(projection.index).includes("PRIVATE-"), "archive catalogue stays lightweight");
  }
});
test("archive wraps mixed narration and call fragments while preserving selection notices", () => {
  const manager = SessionManager.inMemory();
  const change = { previous: { provider: "old", modelId: "old", thinking: "low" }, current: { provider: "new", modelId: "new", thinking: "high" } };
  const id = manager.appendMessage({ ...assistant("visible narration"), axiomSelectionChange: change, content: [{ type: "text", text: "visible narration" }, { type: "toolCall", id: "read", name: "read", arguments: { path: "history.ts" } }], stopReason: "toolUse" });
  manager.appendCompaction("summary", null, 2000);
  const groups = historyProjection(manager, "fixture").index.segments[0].groups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, `final-process:${id}`); assert.equal(groups[0].activity, true); assert.deepEqual(groups[0].selectionChange, change);
  assert.equal(groups[0].folded, true); assert.deepEqual(groups[0].ids, [id]); assert.equal(groups[0].process?.calls, 1);
  assert.equal(groups[0].callsOnlyIds, undefined, "the inner process must retain the narration, not just calls");
});

test("final archives retain the full status card and lightweight original tool summary", () => {
  const manager = SessionManager.inMemory();
  const process = manager.appendMessage({ ...assistant(""), content: [
    { type: "thinking", thinking: "PRIVATE-THINKING" },
    { type: "toolCall", id: "final-read", name: "read", arguments: { path: "history.ts", input: "PRIVATE-INPUT" } },
  ], stopReason: "toolUse" });
  manager.appendMessage({ role: "toolResult", toolCallId: "final-read", toolName: "read", content: [{ type: "text", text: "PRIVATE-OUTPUT" }], isError: false, timestamp: 1 });
  const narration = manager.appendMessage({ ...assistant("PRIVATE-NARRATION"), content: [{ type: "text", text: "PRIVATE-NARRATION", textSignature: JSON.stringify({ v: 1, id: "narration", phase: "commentary" }) }] });
  const final = manager.appendMessage(assistant("PRIVATE-DELIVERY"));
  manager.appendCompaction("summary", null, 2000);
  const groups = historyProjection(manager, "fixture").index.segments[0].groups;
  const group = groups.find(g => g.ids.includes(process))!;
  assert.equal(group.process?.inline, false);
  assert.equal(group.folded, true);
  assert.ok(group.ids.includes(narration));
  assert.ok(!group.ids.includes(final));
  assert.equal(group.process?.calls, 1);
  assert.equal(group.process?.succeeded, 1);
  assert.deepEqual(group.process?.latest, { name: "读取文件", icon: "read", target: "history.ts", status: "completed" });
  assert.ok(!JSON.stringify(groups).includes("PRIVATE-"));
});

test("continuous folding follows confirmed A/B/C/D rules and survives new compactions/reload", () => {
  const state = new SegmentExpansion();
  state.reconcile(["a", "b", "c", "d"]);
  assert.deepEqual([...state.open.values()], [false, true, true, true]);
  state.set("c", false);
  assert.deepEqual([...state.open.values()], [false, false, false, true], "closing C closes A/B/C only");
  state.set("b", true);
  assert.deepEqual([...state.open.values()], [false, true, true, true], "opening B opens B/C/D");
  state.reconcile(["a", "b", "c", "d", "e"]);
  assert.deepEqual([...state.open.values()], [false, true, true, true, true], "a new compaction does not close reading");
  const restored = new SegmentExpansion(state.manual); restored.reconcile(["a", "b", "c", "d", "e"]);
  assert.deepEqual([...restored.open.values()], [...state.open.values()]);
  restored.set("e", false); assert.ok([...restored.open.values()].every(value => !value));
  restored.set("a", true); assert.ok([...restored.open.values()].every(Boolean));
  restored.reconcile(["c", "d"]); assert.deepEqual([...restored.open.keys()], ["c", "d"]);
  const legacy = new SegmentExpansion({ a: true, c: false }); legacy.reconcile(["a", "b", "c", "d"]);
  assert.deepEqual([...legacy.open.values()], [false, false, false, true], "legacy open islands migrate to a closed prefix");
});

test("default reading boundary survives new compactions and reload without a manual click", () => {
  const state = new SegmentExpansion();
  state.reconcile(["a", "b", "c", "d"]);
  state.reconcile(["a", "b", "c", "d", "e"]);
  assert.deepEqual([...state.open.values()], [false, true, true, true, true]);
  const restored = new SegmentExpansion(JSON.parse(JSON.stringify(state.manual)));
  restored.reconcile(["a", "b", "c", "d", "e"]);
  assert.deepEqual([...restored.open.values()], [...state.open.values()]);
});

test("batched appended compactions preserve reading in memory and after reconnect/reload", () => {
  const ids = ["a", "b", "c", "d"], batch = [...ids, "e", "f", "g", "h"];
  const state = new SegmentExpansion(); state.reconcile(ids);
  const restored = new SegmentExpansion(JSON.parse(JSON.stringify(state.manual)));
  for (const current of [state, restored]) {
    current.reconcile(batch);
    assert.deepEqual([...current.open.values()], [false, true, true, true, true, true, true, true]);
  }
  state.set("h", false); state.reconcile([...batch, "i", "j", "k", "l"]);
  assert.deepEqual([...state.open.values()], [...batch.map(() => false), true, true, true, true], "explicitly closed ranges stay closed");
});

test("store deduplicates range reads, ignores stale responses and preserves a successful index on failure", async () => {
  let index: HistoryIndex = { revision: "one", segments: [] }, fail = false, reads = 0;
  let resolve!: (read: HistoryRead) => void;
  const store = new HistoryStore(async () => { if (fail) throw Error("index failure"); return index; }, async () => {
    reads++; return new Promise<HistoryRead>(done => { resolve = done; });
  });
  await store.refresh();
  const off1 = store.acquire("s", "g"), off2 = store.acquire("s", "g");
  assert.equal(reads, 1);
  resolve({ revision: "one", messages: [{ id: "old", role: "user", text: "first" }] }); await tick();
  assert.equal(store.get("old")?.text, "first"); off1(); off2();
  store.acquire("s", "g")(); assert.equal(reads, 1);
  fail = true; await store.refresh(); assert.equal(store.snapshot().index?.revision, "one"); assert.equal(store.get("old")?.text, "first");
  fail = false;
  const release = store.acquire("s", "pending");
  index = { revision: "two", segments: [] }; await store.refresh();
  resolve({ revision: "one", messages: [{ id: "late", role: "user", text: "wrong generation" }] }); await tick();
  assert.equal(store.get("late"), null); assert.equal(store.get("old"), null);
  release(); store.dispose();
});

test("new compactions preserve unchanged mounted group bodies", async () => {
  let revision = "one", reads = 0;
  const store = new HistoryStore(async () => ({ revision, segments: [{ id: "s", compression: {} as any, messageIds: ["body"], groups: [{ id: "body", ids: ["body"], activity: false, estimatedHeight: 100, revision: "unchanged" }] }] }), async () => {
    reads++; return { revision, messages: [{ id: "body", role: "user", text: "stay visible" }] };
  });
  await store.refresh(); const release = store.acquire("s", "body"); await tick();
  revision = "two"; await store.refresh();
  assert.equal(store.range(store.key("s", "body")).ready, true);
  assert.equal(store.get("body")?.text, "stay visible"); assert.equal(reads, 1);
  release(); store.dispose();
});

test("store rejects a response from a newer archive revision and refreshes the catalogue", async () => {
  let revision = "one", resolve!: (read: HistoryRead) => void;
  const store = new HistoryStore(async () => ({ revision, segments: [] }), async () => new Promise<HistoryRead>(done => { resolve = done; }));
  await store.refresh();
  const release = store.acquire("s", "g");
  revision = "two";
  resolve({ revision, messages: [{ id: "wrong-snapshot", role: "user", text: "must not commit" }] });
  await tick();
  assert.equal(store.get("wrong-snapshot"), null);
  assert.equal(store.snapshot().index?.revision, "two");
  release(); store.dispose();
});

test("store retries mounted failures and paused reads on same-revision reconnect", async () => {
  let fail = true, reads = 0;
  const store = new HistoryStore(async () => ({ revision: "one", segments: [] }), async () => {
    reads++; if (fail) throw Error("DISCONNECTED");
    return { revision: "one", messages: [{ id: "reconnected", role: "user", text: "recovered" }] };
  });
  await store.refresh(); const release = store.acquire("s", "g"); await tick();
  assert.equal(store.range(store.key("s", "g")).error, "DISCONNECTED");
  store.pause(); fail = false; await store.refresh(); await tick();
  assert.equal(reads, 2); assert.equal(store.get("reconnected")?.text, "recovered");
  release(); store.dispose();
});

test("streaming current messages do not change the archived revision", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage(assistant("archive")); manager.appendCompaction("summary", null, 2000);
  const before = historyProjection(manager, "disk-version-one").index.revision;
  manager.appendMessage(assistant("current append"));
  assert.equal(historyProjection(manager, "disk-version-two").index.revision, before);
});

test("store evicts inactive reads under a byte budget but pins mounted ranges", async () => {
  const store = new HistoryStore(async () => ({ revision: "one", segments: [] }), async (_segment, group) => ({ revision: "one", messages: [{ id: group!, role: "user", text: "x".repeat(100) }] }), 400);
  await store.refresh();
  const keep = store.acquire("s", "pinned"); await tick();
  const release = store.acquire("s", "evict"); await tick(); release();
  assert.ok(store.get("pinned")); assert.equal(store.get("evict"), null);
  keep(); store.dispose();
});

test("long catalogue contains no full bodies or tool inputs", () => {
  const manager = SessionManager.inMemory();
  for (let segment = 0; segment < 6; segment++) {
    for (let i = 0; i < 80; i++) {
      manager.appendMessage({ role: "user", content: `question ${segment}/${i}`, timestamp: 1 });
      manager.appendMessage(assistant("BODY-SECRET" + "x".repeat(5000)));
    }
    manager.appendCompaction("SUMMARY-SECRET" + "s".repeat(5000), null, 20000);
  }
  const start = performance.now(), result = historyProjection(manager, "long-fixture");
  const catalogue = JSON.stringify(result.index);
  assert.equal(result.index.segments.length, 6);
  assert.equal(result.index.segments.flatMap(segment => segment.groups).length, 960);
  assert.ok(!catalogue.includes("BODY-SECRET") && !catalogue.includes("SUMMARY-SECRET"));
  console.log(`history fixture: 960 messages, catalogue=${catalogue.length} bytes, projection=${(performance.now() - start).toFixed(1)}ms`);
});
