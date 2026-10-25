import assert from "node:assert/strict";
import { test } from "node:test";
import { processSlices } from "../src/shared/process-layout.js";
import { historyFlow, historyProcessSummary } from "../src/shared/history-layout.js";
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
