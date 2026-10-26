import assert from "node:assert/strict";
import { test } from "node:test";
import { processSlices } from "../src/shared/process-layout.js";
import { historyFlow, historyProcessSummary } from "../src/shared/history-layout.js";
import { titleCardPosition } from "../src/shared/title-card.js";
import type { HistoryGroup, HistorySegment, ThreadGroup } from "../src/shared/history.js";

const activity = (id: string, extra: Partial<HistoryGroup> = {}): HistoryGroup => ({ id, ids: [id], activity: true, folded: true,
  estimatedHeight: 84, revision: `revision:${id}`, process: { calls: 1, succeeded: 1, failed: 0, status: "completed", inline: false, preview: id }, ...extra });
const body = (id: string, extra: Partial<HistoryGroup> = {}): HistoryGroup => ({ id, ids: [id], activity: false, estimatedHeight: 180, ...extra });
const segment = (id: string, groups: HistoryGroup[]): HistorySegment => ({ id, revision: `revision:${id}`,
  compression: { number: 1, title: "", before: 2000, after: 1000 }, messageIds: groups.flatMap(group => group.ids), groups });
const open = (...ids: string[]) => new Map(ids.map(id => [id, true]));

test("all adjacent activities coalesce across any number of expanded archives and a live tail", () => {
  const a = segment("a", [activity("first", { process: { calls: 2, succeeded: 1, failed: 1, status: "failed", preview: "old" } })]);
  const b = segment("b", [activity("second")]);
  const live: ThreadGroup = { id: "live", ids: ["live"], activity: true };
  const rows = historyFlow([a, b], open("a", "b"), [live]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "messages");
  if (rows[0].kind !== "messages") return;
  assert.equal(rows[0].key, "archive:a:first");
  assert.deepEqual(rows[0].group.ids, ["first", "second", "live"]);
  assert.equal(!!rows[0].group.folded, false, "a delivered prefix cannot fold an undelivered live tail");
  const delivered = historyFlow([a, b], open("a", "b"), [{ ...live, folded: true }]);
  assert.equal(delivered[0].kind === "messages" && delivered[0].group.folded, true, "all contributions must have delivery evidence");
  assert.deepEqual(rows[0].sources.map(source => [source.kind, source.kind === "archive" ? source.group.revision : undefined]), [["archive", "revision:first"], ["archive", "revision:second"], ["live", undefined]]);
  const summary = historyProcessSummary(rows[0].sources)!;
  assert.equal(summary.calls, 3); assert.equal(summary.failed, 1);
  assert.equal(summary.status, "completed", "a later continuation settles the older failure");
  assert.equal(JSON.stringify([a, b]).includes('"kind"'), false, "the physical archive catalogue is unchanged");
});

test("a closed checkpoint is a real boundary; filtering sources precedes coalescing", () => {
  const a = segment("a", [activity("first")]), b = segment("b", [activity("second")]);
  const live = activity("live");
  const rows = historyFlow([a, b], open("b"), [live]);
  assert.deepEqual(rows.map(row => row.kind), ["card", "messages"]);
  if (rows[1].kind !== "messages") return;
  assert.deepEqual(rows[1].group.ids, ["second", "live"]);
  assert.equal(rows[1].key, "archive:b:second");
  const closed = historyFlow([a, b], open(), [live]);
  assert.deepEqual(closed.map(row => row.kind), ["card", "card", "messages"]);
});

test("only real content/selection boundaries split a process, not folded/status/source metadata", () => {
  const change = { from: { provider: "old", id: "old", thinking: "low" as const }, to: { provider: "new", id: "new", thinking: "high" as const } };
  const groups = [activity("p1"), activity("p2", { folded: false }), body("user"), activity("p3"), body("final", { delivery: true }),
    activity("p4"), body("notice"), activity("p5"), activity("p6", { selectionChange: change }), activity("p7")];
  const rows = historyFlow([segment("s", groups)], open("s"), []);
  assert.deepEqual(rows.map(row => row.kind === "messages" ? row.group.ids : []), [["p1", "p2"], ["user"], ["p3"], ["final"], ["p4"], ["notice"], ["p5"], ["p6", "p7"]]);
  assert.equal(rows.some(row => row.kind === "messages" && row.group.delivery), true);
});

test("deduplicated contributions preserve thinking and calls without inventing body", () => {
  const rows = historyFlow([segment("a", [activity("thinking", { ids: ["shared", "thinking-only"], thinkingOnlyIds: ["shared", "thinking-only"] })]),
    segment("b", [activity("calls", { ids: ["shared", "calls-only"], callsOnlyIds: ["shared", "calls-only"] })])], open("a", "b"), []);
  assert.equal(rows.length, 1);
  if (rows[0].kind !== "messages") return;
  assert.deepEqual(rows[0].group.ids, ["shared", "thinking-only", "calls-only"]);
  assert.deepEqual(rows[0].group.thinkingOnlyIds, ["thinking-only"]);
  assert.deepEqual(rows[0].group.callsOnlyIds, ["calls-only"]);
  assert.deepEqual(rows[0].group.bodyHiddenIds, ["shared"]);
  const slices = processSlices([{ id: "shared", role: "assistant", text: "DO-NOT-INVENT-BODY", thinking: "reasoning", calls: [{ id: "read", name: "read", input: "{}" }] }],
    rows[0].group.thinkingOnlyIds, rows[0].group.callsOnlyIds, rows[0].group.bodyHiddenIds);
  assert.deepEqual(slices.map(slice => slice.kind), ["process"]);
  assert.equal(slices[0].kind === "process" && slices[0].entries.length, 2);
  assert.equal(rows[0].sources.length, 2, "keep both original lazy range references");
});

test("stable first-source identity survives streaming additions and changing source revisions", () => {
  const a = segment("a", [activity("first")]);
  const before = historyFlow([a], open("a"), [activity("tail")]);
  const after = historyFlow([{ ...a, revision: "new" }], open("a"), [activity("tail", { ids: ["tail", "delta"] })]);
  assert.equal(before[0].key, after[0].key);
  assert.deepEqual(after[0].kind === "messages" && after[0].group.ids, ["first", "tail", "delta"]);
});

test("title anchors split a growing live process without waiting for prose", () => {
  const breaks = new Set(["trigger"]);
  const live = (ids: string[]): ThreadGroup[] => [{ id: "process:old", ids, activity: true, runIds: ["run"] }];
  const before = historyFlow([], open(), live(["old", "trigger"]), breaks);
  assert.equal(before[0].kind === "messages" && before[0].boundary, true, "settle the prefix even before the next message");
  const after = historyFlow([], open(), live(["old", "trigger", "thinking", "tool"]), breaks);
  assert.deepEqual(after.map(row => row.kind === "messages" && row.group.ids), [["old", "trigger"], ["thinking", "tool"]]);
  assert.equal(before[0].key, after[0].key);
  assert.equal(after[1].kind === "messages" && after[1].boundary, undefined);
  const more = historyFlow([], open(), live(["old", "trigger", "thinking", "tool", "more"]), breaks);
  assert.equal(after[1].key, more[1].key, "streaming tail retains its own identity");
  assert.equal(historyFlow([], open(), live(["old", "trigger", "thinking", "tool"])).length, 1, "no metadata boundary leaves normal continuity unchanged");
});

test("title splits retain contribution masks, notices, task visibility and delivery evidence", () => {
  const change = { from: { provider: "p", id: "a", thinking: "off" as const }, to: { provider: "p", id: "b", thinking: "off" as const } };
  const group: ThreadGroup = { id: "final-process:thought", ids: ["thought", "trigger", "calls", "mixed"], activity: true, folded: true,
    thinkingOnlyIds: ["thought"], callsOnlyIds: ["calls"], bodyHiddenIds: ["mixed"], hasTasks: true, selectionChange: change };
  const rows = historyFlow([], open(), [group], new Set(["trigger", "calls"]));
  const parts = rows.flatMap(row => row.kind === "messages" ? [row.group] : []);
  assert.deepEqual(parts.map(part => part.ids), [["thought", "trigger"], ["calls"], ["mixed"]]);
  assert.deepEqual(parts.map(part => part.thinkingOnlyIds), [["thought"], [], []]);
  assert.deepEqual(parts.map(part => part.callsOnlyIds), [[], ["calls"], []]);
  assert.deepEqual(parts.map(part => part.bodyHiddenIds), [[], [], ["mixed"]]);
  assert.deepEqual(parts.map(part => part.selectionChange), [change, undefined, undefined]);
  assert.ok(parts.every(part => part.folded && part.hasTasks));
  assert.equal(group.ids.length, 4, "never mutate the source catalogue");
});

test("title boundary follows the last contribution of a shared assistant message", () => {
  const rows = historyFlow([], open(), [
    { id: "thinking:shared", ids: ["shared"], activity: true, thinkingOnlyIds: ["shared"] },
    { id: "shared", ids: ["shared"], activity: false },
    { id: "calls:shared", ids: ["shared", "next"], activity: true, callsOnlyIds: ["shared"] },
  ], new Set(["shared"]));
  assert.deepEqual(rows.map(row => row.kind === "messages" && row.group.ids), [["shared"], ["shared"], ["shared"], ["next"]]);
  assert.deepEqual(rows.map(row => row.kind === "messages" && !!row.boundary), [false, false, true, false]);
  const position = titleCardPosition({ id: "title", kind: "session.title", anchorMessageId: "shared" } as any,
    rows.map(row => ({ ids: row.kind === "messages" ? row.group.ids : [] })));
  assert.equal(position, 2);
});

test("expanded archive title boundaries keep original lazy read ranges and block live remerging", () => {
  const archive = segment("s", [activity("original", { ids: ["a", "trigger", "b"] })]);
  const rows = historyFlow([archive], open("s"), [{ id: "live", ids: ["c"], activity: true }], new Set(["trigger"]));
  assert.deepEqual(rows.map(row => row.kind === "messages" && row.group.ids), [["a", "trigger"], ["b", "c"]]);
  for (const row of rows) if (row.kind === "messages") {
    const source = row.sources[0];
    assert.equal(source.kind, "archive");
    if (source.kind === "archive") {
      assert.equal(source.readGroupId, "original");
      assert.equal(source.group.process, undefined, "do not double-count an unsplit archive summary");
    }
  }
  const closed = historyFlow([archive], open(), [{ id: "live", ids: ["c"], activity: true }], new Set(["trigger"]));
  assert.deepEqual(closed.map(row => row.kind), ["card", "messages"], "closed history remains catalogue-only");
  assert.equal(rows[0].kind === "messages" && rows[0].boundary, true);
});

test("split mixed-run ownership keeps legacy titles with their own run", () => {
  const group: ThreadGroup = { id: "process:a", ids: ["a", "b", "c"], activity: true, runIds: ["A", "B"] };
  const owners: Record<string, string> = { a: "A", b: "B", c: "B" };
  const live = historyFlow([], open(), [group], new Set(["a"]), id => owners[id]);
  const archive = historyFlow([segment("s", [activity("process:a", { ...group, messageRunIds: owners })])], open("s"), [], new Set(["a"]));
  for (const rows of [live, archive]) {
    const positions = rows.flatMap(row => row.kind === "messages" ? [{ ids: row.group.ids, runIds: row.sources.flatMap(source => source.group.runIds ?? []) }] : []);
    assert.deepEqual(positions.map(position => position.runIds), [["A"], ["B"]]);
    assert.equal(titleCardPosition({ runId: "B" } as any, positions), 1, "run B legacy title must not attach to run A prefix");
    assert.equal(titleCardPosition({ anchorMessageId: "a" } as any, positions), 0);
  }
  const oldCatalogue = historyFlow([segment("s", [activity("process:a", group)])], open("s"), [], new Set(["a"]));
  assert.ok(oldCatalogue.every(row => row.kind === "messages" && row.group.runIds?.length === 0), "old mixed-run catalogues cannot invent partial ownership");
});
