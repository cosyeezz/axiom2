import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { createWindowIdentity } from "../src/server/canonical-window-identity.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { HistoryIndex, ThreadGroup } from "../src/shared/history.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";
import type { WindowLocationPage, WindowMemberPage, WindowSegmentPage, WindowSourcePage } from "../src/shared/thread-window.js";

const seed = "34".repeat(32), identity = createWindowIdentity(seed);
const assistant: ChatMessage = { id: "a", role: "assistant", text: "answer", thinking: "thought", calls: [{ id: "call", name: "bash", input: "{}" }] };
function capture(messages: ChatMessage[], groups: ThreadGroup[] = [{ id: "group", ids: ["a"], activity: true }], segments: HistoryIndex["segments"] = []) {
  const full = new Map(messages.map(message => [message.id, message]));
  return captureCanonicalSources({ archive: { index: { revision: "fixture", segments }, messages: full },
    currentGroups: groups, currentMessages: full, transientMessages: new Map() });
}
function data<T>(reply: Reply): T {
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 128 * 1024);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function failure(reply: Reply, code: string) { assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code); }
const open = (window: CanonicalWindow) => data<WindowSourcePage>(window.read("r", { op: "open" }));
const locate = (window: CanonicalWindow, revision: string, key: string, before?: number) =>
  data<WindowLocationPage>(window.read("\u0001".repeat(200), { op: "locate", revision, key, ...(before === undefined ? {} : { before }) }));
const members = (window: CanonicalWindow, revision: string, sourceRef: string) =>
  data<WindowMemberPage>(window.read("r", { op: "members", revision, sourceRef }));
const field = (window: CanonicalWindow, revision: string, entityRef: string, name = "text") =>
  data<WindowFieldData>(window.read("r", { op: "field", revision, entityRef, field: name })).chunk.text;

test("locators page every occurrence of one stable identity with bounded actual receipts", () => {
  const message = { ...assistant, id: `private-id-${"x".repeat(10000)}`, calls: undefined };
  const groups = Array.from({ length: 145 }, (_, i) => ({ id: `group-${i}`, ids: [message.id], activity: true }));
  const window = new CanonicalWindow(() => capture([message], groups), undefined, seed), sources = open(window);
  const member = members(window, sources.revision, sources.items.at(-1)!.ref).items[0];
  const found: WindowLocationPage["items"] = []; let before: number | undefined;
  do {
    const page: WindowLocationPage = locate(window, sources.revision, member.messageKey, before);
    assert.equal(page.total, 145); assert.ok(page.items.length <= 64); assert.ok(!JSON.stringify(page).includes("private-id"));
    found.unshift(...page.items); before = page.previous ?? undefined;
  } while (before !== undefined);
  assert.deepEqual(found.map(item => item.sourceOrder), Array.from({ length: 145 }, (_, i) => i));
  assert.equal(new Set(found.map(item => item.ref)).size, 145);
  assert.equal(field(window, sources.revision, found[0].ref), "answer");
  assert.equal(locate(window, sources.revision, member.occurrenceKey).total, 1);
  const source = locate(window, sources.revision, sources.items.at(-1)!.sourceKey).items[0];
  assert.equal(source.kind, "source"); assert.equal(source.ref, source.sourceRef);
  assert.equal(members(window, sources.revision, source.ref).items[0].messageKey, member.messageKey);
  assert.equal(locate(window, sources.revision, member.messageKey, 1).next, 65);
  failure(window.read("r", { op: "locate", revision: sources.revision, key: member.messageKey, before: 146 }), "INVALID_OFFSET");
});

test("locators preserve contribution masks and expose call and result locations only through visible calls", () => {
  const result: ChatMessage = { id: "tool-call", role: "toolResult", text: "saved output" };
  const groups: ThreadGroup[] = [
    { id: "thinking", ids: ["a"], activity: true, thinkingOnlyIds: ["a"] },
    { id: "delivery", ids: ["a"], activity: false, hideThinking: true },
    { id: "visible", ids: ["a"], activity: true },
  ];
  let current = capture([assistant, result], groups);
  const window = new CanonicalWindow(() => current, undefined, seed), first = open(window), revision = first.revision;
  const occurrences = locate(window, revision, identity.key("message", "a"));
  assert.equal(occurrences.total, 3);
  assert.equal(field(window, revision, occurrences.items[0].ref, "thinking"), "thought");
  failure(window.read("r", { op: "field", revision, entityRef: occurrences.items[0].ref, field: "text" }), "INVALID_REFERENCE");
  for (const [kind, key, text, name] of [
    ["call", identity.key("call", "call"), "{}", "input"], ["result", identity.key("message", "tool-call"), "saved output", "text"],
  ]) {
    const page = locate(window, revision, key); assert.equal(page.total, 1);
    assert.equal(page.items[0].kind, kind); assert.equal(page.items[0].sourceOrder, 2); assert.equal(page.items[0].callOrder, 0);
    assert.equal(field(window, revision, page.items[0].ref, name), text);
  }
  current = capture([assistant, result], groups.slice(0, 2)); const hidden = open(window);
  assert.equal(locate(window, hidden.revision, identity.key("call", "call")).total, 0);
  assert.equal(locate(window, hidden.revision, identity.key("message", "tool-call")).total, 0);
  assert.equal(locate(window, revision, identity.key("call", "call")).total, 1, "old cut and its index remain immutable");
});

test("current-cut rebind follows message identity through handoff and archival without reviving old refs", () => {
  const prefix: ChatMessage = { id: "prefix", role: "user", text: "earlier" };
  const old = new CanonicalWindow(() => capture([assistant, prefix], [{ id: "prefix", ids: [prefix.id], activity: false }, { id: "group", ids: ["a"], activity: false }]), undefined, seed);
  const initial = open(old), member = members(old, initial.revision, initial.items[1].ref).items[0]; old.close();
  const checkpoint: ChatMessage = { id: "checkpoint", role: "notice", text: "summary", compression: { number: 1, title: "title", before: 10, after: 2 } };
  const archived = capture([{ ...assistant, text: "new answer" }, checkpoint], [], [{ id: checkpoint.id, compression: checkpoint.compression!,
    messageIds: ["a"], groups: [{ id: "group", ids: ["a"], activity: false, estimatedHeight: 100 }] }]);
  const next = new CanonicalWindow(() => archived, undefined, seed), fresh = open(next), revision = fresh.revision;
  const rebound = locate(next, revision, member.messageKey).items[0];
  assert.equal(rebound.sourceOrder, 0); assert.equal(rebound.segmentOrder, 0); assert.equal(field(next, revision, rebound.ref), "new answer");
  assert.equal(locate(next, revision, initial.items[1].sourceKey).total, 0, "storage-bucket source identity is not a cross-bucket anchor");
  failure(next.read("r", { op: "field", revision, entityRef: member.ref, field: "text" }), "INVALID_REFERENCE");
  failure(old.read("r", { op: "locate", revision: initial.revision, key: member.messageKey }), "STALE");
  const segment = data<WindowSegmentPage>(next.read("r", { op: "segments", revision })).items[0];
  const summary = locate(next, revision, segment.messageKey).items[0];
  assert.equal(summary.kind, "segment"); assert.equal(summary.sourceRef, null); assert.equal(field(next, revision, summary.ref), "summary");
  failure(next.read("r", { op: "describe", revision, entityRef: summary.ref }), "INVALID_REFERENCE");
  const foreign = new CanonicalWindow(() => archived, undefined, "56".repeat(32)), foreignCut = open(foreign);
  assert.equal(locate(foreign, foreignCut.revision, member.messageKey).total, 0);
});

test("locator misses are cut-local and malformed requests, retired cuts and revoked owners fail closed", () => {
  let current = capture([assistant]), active = true;
  const window = new CanonicalWindow(() => current, () => active, seed), first = open(window), key = identity.key("message", "tool-call");
  assert.equal(locate(window, first.revision, key).total, 0);
  current = capture([assistant, { id: "tool-call", role: "toolResult", text: "arrived" }]); const second = open(window);
  assert.equal(locate(window, second.revision, key).total, 1); assert.equal(locate(window, first.revision, key).total, 0);
  for (const query of [{ key: "raw-id" }, { key: {} }, { key, extra: true }, { key, entityRef: first.items[0].ref }])
    failure(window.read("r", { op: "locate", revision: second.revision, ...query }), "INVALID_REFERENCE");
  failure(window.read("r", { op: "locate", revision: second.revision, key, before: -1 }), "INVALID_OFFSET");
  assert.equal(locate(window, second.revision, identity.key("run", "run")).total, 0);
  open(window); failure(window.read("r", { op: "locate", revision: first.revision, key }), "STALE");
  active = false; failure(window.read("r", { op: "locate", revision: second.revision, key }), "STALE");
});
