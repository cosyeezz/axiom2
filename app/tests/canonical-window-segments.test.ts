import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { HistoryIndex } from "../src/shared/history.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowSegmentPage, WindowSourcePage } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const title = '中😀\u0000\\"'.repeat(10000), summary = '摘要😀\u0000\\"'.repeat(18000);
function fixture(count: number, allEmpty = false, summaryText = summary) {
  const index: HistoryIndex = { revision: "same-archive-revision", segments: [] }, messages = new Map<string, ChatMessage>();
  const expected: { start: number; end: number; messages: number }[] = [];
  let source = 0;
  for (let i = 0; i < count; i++) {
    const id = `private-checkpoint-${i}`, mid = `private-original-${i}`, empty = allEmpty || i % 3 === 1;
    const compression = { number: i + 1, title, before: 1000 + i, after: i === 0 ? 0 : null };
    messages.set(id, { id, role: "notice", text: summaryText, compression });
    if (!empty) messages.set(mid, { id: mid, role: "assistant", text: `original-${i}`, thinking: `thought-${i}` });
    index.segments.push({ id, compression, messageIds: empty ? [] : [mid], groups: empty ? [] : [
      { id: `thinking-${i}`, ids: [mid], activity: true, thinkingOnlyIds: [mid], estimatedHeight: 84 },
      { id: `body-${i}`, ids: [mid], activity: false, hideThinking: true, estimatedHeight: 180 },
    ] });
    expected.push({ start: source, end: source + (empty ? 0 : 2), messages: empty ? 0 : 1 }); source += empty ? 0 : 2;
  }
  const live: ChatMessage = { id: "private-live", role: "assistant", text: "live body" };
  return { capture: captureCanonicalSources({ archive: { index, messages },
    currentGroups: [{ id: live.id, ids: [live.id], activity: false }], currentMessages: new Map([[live.id, live]]), transientMessages: new Map() }), expected, archiveSources: source };
}
function data<T>(reply: Reply, budget = 128 * 1024): T {
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(bytes(reply) <= budget);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function failure(reply: Reply, code = "INVALID_REFERENCE") {
  assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code); assert.ok(bytes(reply) <= 2048);
}
function open(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("r", { op: "open" }));
  const segments = data<WindowSegmentPage>(window.read("r", { op: "segments", revision: sources.revision }));
  return { revision: sources.revision, sources, segments };
}
function full(window: CanonicalWindow, revision: string, entityRef: string, field: "text" | "metadata") {
  let offsetCU = 0, result = "";
  for (let page = 0; page < 100; page++) {
    const part = data<WindowFieldData>(window.read("r", { op: "field", revision, entityRef, field, offsetCU }), 64 * 1024);
    assert.equal(part.chunk.offsetCU, offsetCU); assert.equal(part.entityRef, entityRef); assert.equal(part.field, field);
    assert.ok(bytes(part.chunk.text) <= 48 * 1024); result += part.chunk.text;
    if (part.chunk.nextOffsetCU === null) { assert.equal(result.length, part.chunk.totalLengthCU); return result; }
    assert.ok(part.chunk.nextOffsetCU > offsetCU); offsetCU = part.chunk.nextOffsetCU;
  }
  assert.fail("summary field did not reach EOF");
}

test("segment directories budget huge catalogues and preserve original source ranges including empty segments", () => {
  const fixtureData = fixture(145), window = new CanonicalWindow(() => fixtureData.capture), opened = open(window);
  const { revision, sources } = opened; let page = opened.segments;
  assert.equal(page.total, 145); assert.equal(page.items.length, 64); assert.equal(page.previous, 81); assert.equal(page.next, null);
  assert.equal(sources.total, fixtureData.archiveSources + 1);
  assert.equal(sources.items.at(-1)?.storage, "live");
  const seen: number[] = [];
  do {
    assert.ok(page.items.length <= 64); assert.ok(page.items.reduce((sum, item) => sum + bytes(item.title), 0) <= 8192);
    assert.equal(JSON.stringify(page).includes("private-"), false);
    for (const item of page.items) {
      const expected = fixtureData.expected[item.order]; seen.push(item.order);
      assert.ok(bytes(item) <= 4096); assert.equal(item.number, item.order + 1);
      assert.equal(item.messageCount, expected.messages); assert.equal(item.sourceStart, expected.start); assert.equal(item.sourceEnd, expected.end);
      assert.equal(item.summaryLengthCU, summary.length); assert.equal(item.title.totalLengthCU, title.length); assert.equal(item.title.complete, false);
      assert.equal(item.title.text, title.slice(0, item.title.text.length));
    }
    if (page.previous === null) break;
    page = data<WindowSegmentPage>(window.read("\u0001".repeat(200), { op: "segments", revision, before: page.previous }));
  } while (true);
  assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: 145 }, (_, i) => i));
  assert.equal(page.items[0].after, 0); assert.equal(page.items[1].after, null);
  assert.equal(page.items[0].messageCount, 1); assert.equal(page.items[0].sourceEnd - page.items[0].sourceStart, 2, "T/B occurrences do not inflate raw message count");
});

test("checkpoint summary and full compression title continue independently from original member bodies", () => {
  const f = fixture(3), window = new CanonicalWindow(() => f.capture), { revision, segments } = open(window);
  for (const item of segments.items) {
    assert.equal(full(window, revision, item.ref, "text"), summary);
    assert.deepEqual(JSON.parse(full(window, revision, item.ref, "metadata")), {
      compression: { number: item.number, title, before: item.before, after: item.after }, kiroFailure: null,
    });
  }
  assert.equal(segments.items[1].sourceStart, segments.items[1].sourceEnd, "an empty original range still owns a readable summary");
  const original = data<WindowSourcePage>(window.read("r", { op: "sources", revision, before: segments.items[0].sourceEnd }));
  assert.deepEqual(original.items.map(item => item.segment), [0, 0]);
  for (const item of original.items) assert.equal(item.members, 1);
});

test("zero-checkpoint and all-empty-original histories have explicit directory and range bounds", () => {
  const none = fixture(0), empty = new CanonicalWindow(() => none.capture), opened = open(empty);
  assert.equal(opened.segments.total, 0); assert.deepEqual(opened.segments.items, []);
  assert.equal(opened.segments.previous, null); assert.equal(opened.segments.next, null);
  const f = fixture(70, true), window = new CanonicalWindow(() => f.capture), { segments, sources } = open(window);
  assert.equal(sources.total, 1); assert.ok(segments.items.every(item => item.messageCount === 0 && item.sourceStart === 0 && item.sourceEnd === 0));
  assert.equal(segments.total, 70); assert.equal(segments.previous, 6);
});

test("checkpoint refs remain immutable and reject foreign cuts, wrong operations, malformed ordinals and revoked owners", () => {
  let current = fixture(1).capture, active = true;
  const window = new CanonicalWindow(() => current, () => active), old = open(window), { revision } = old;
  const ref = old.segments.items[0].ref;
  for (const op of ["describe", "calls", "collection"])
    failure(window.read("r", { op, revision, entityRef: ref, ...(op === "collection" ? { collection: "images" } : {}) }));
  failure(window.read("r", { op: "members", revision, sourceRef: ref }));
  for (const field of ["thinking", "input", "error", "selection"])
    failure(window.read("r", { op: "field", revision, entityRef: ref, field }));
  for (const suffix of ["h_1", "h_00", "h_-1", "h_0_c_0", "h_0_a_images_0", "h_0_r", "h_1.5"])
    failure(window.read("r", { op: "field", revision, entityRef: `${revision}_${suffix}`, field: "text" }));
  failure(window.read("r", { op: "segments", revision, before: 2 }), "INVALID_OFFSET");
  failure(window.read("r", { op: "segments", revision, entityRef: ref }));
  failure(window.read("r", { op: "field", revision, entityRef: ref, field: "text", offsetCU: summary.length + 1 }), "INVALID_OFFSET");
  current = fixture(2, false, "new summary").capture; const next = open(window);
  assert.equal(full(window, next.revision, next.segments.items[0].ref, "text"), "new summary");
  assert.equal(full(window, revision, ref, "text"), summary);
  failure(window.read("r", { op: "field", revision: next.revision, entityRef: ref, field: "text" }));
  active = false; failure(window.read("r", { op: "segments", revision: next.revision }), "STALE");
});
