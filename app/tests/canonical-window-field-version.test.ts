import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { HistoryIndex, ThreadGroup } from "../src/shared/history.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowField, WindowFieldData } from "../src/shared/window-frame-budget.js";
import type { WindowFieldInfo, WindowSourcePage, WindowMemberPage, WindowLocationPage, WindowSegmentPage } from "../src/shared/thread-window.js";

const seed = "78".repeat(32);
const base: ChatMessage = { id: "a", role: "assistant", text: "answer", thinking: "thought", error: "old error" };
function capture(messages: ChatMessage[], groups: ThreadGroup[] = [{ id: "group", ids: ["a"], activity: true }], segments: HistoryIndex["segments"] = []) {
  const full = new Map(messages.map(message => [message.id, message]));
  return captureCanonicalSources({ archive: { index: { revision: "fixture", segments }, messages: full }, currentGroups: groups,
    currentMessages: full, transientMessages: new Map() });
}
function data<T>(reply: Reply): T { assert.equal(reply.ok, true, JSON.stringify(reply)); return (reply as Extract<Reply, { ok: true }>).data as T; }
function failure(reply: Reply, code: string) { assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code); }
function open(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("r", { op: "open" })), revision = sources.revision;
  const members = data<WindowMemberPage>(window.read("r", { op: "members", revision, sourceRef: sources.items[0].ref }));
  return { sources, members, revision, entityRef: members.items[0].ref };
}
function info(window: CanonicalWindow, revision: string, entityRef: string, field: WindowField, call?: number) {
  const reply = window.read("\u0001".repeat(200), { op: "fieldInfo", revision, entityRef, field, ...(call === undefined ? {} : { call }) });
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 2048);
  const item = data<WindowFieldInfo>(reply); assert.match(item.version, /^v_[A-Za-z0-9_-]{43}$/); return item;
}
const read = (window: CanonicalWindow, revision: string, entityRef: string, field: WindowField, expectedVersion?: string, offsetCU?: number) =>
  window.read("r", { op: "field", revision, entityRef, field, ...(expectedVersion === undefined ? {} : { expectedVersion }), ...(offsetCU === undefined ? {} : { offsetCU }) });

test("exact field versions permit rebind continuation only for unchanged full content, not matching previews or structure", () => {
  const body = "x".repeat(120000) + "😀", message = { ...base, text: body };
  let current = capture([message]); const window = new CanonicalWindow(() => current, undefined, seed), first = open(window);
  const original = info(window, first.revision, first.entityRef, "text"), originalError = info(window, first.revision, first.entityRef, "error");
  assert.equal(original.lengthCU, body.length);
  const prefix = data<WindowFieldData>(read(window, first.revision, first.entityRef, "text", original.version));
  assert.ok(prefix.chunk.nextOffsetCU !== null);
  current = capture([{ ...message, text: body + "later" }]); const changed = open(window);
  assert.equal(changed.sources.structureVersion, first.sources.structureVersion);
  const updated = info(window, changed.revision, changed.entityRef, "text"); assert.notEqual(updated.version, original.version);
  failure(read(window, changed.revision, changed.entityRef, "text", original.version, prefix.chunk.nextOffsetCU!), "STALE");
  assert.equal(info(window, first.revision, first.entityRef, "text").version, original.version, "old cut version remains immutable");
  current = capture([{ ...message, error: "new error" }]); const equal = open(window);
  const located = data<WindowLocationPage>(window.read("r", { op: "locate", revision: equal.revision, key: first.members.items[0].messageKey }));
  const ref = located.items[0].ref;
  assert.equal(info(window, equal.revision, ref, "text").version, original.version);
  assert.notEqual(info(window, equal.revision, ref, "error").version, originalError.version);
  let text = prefix.chunk.text, offset: number | null = prefix.chunk.nextOffsetCU;
  while (offset !== null) { const part: WindowFieldData = data(read(window, equal.revision, ref, "text", original.version, offset)); text += part.chunk.text; offset = part.chunk.nextOffsetCU; }
  assert.equal(text, body);
  failure(read(window, equal.revision, first.entityRef, "text", original.version), "INVALID_REFERENCE");
  failure(read(window, first.revision, first.entityRef, "text", original.version), "STALE");
});

test("field versions preserve full UTF-16 and isolate field domains and scope namespaces", () => {
  function version(text: string, field: WindowField = "text", identitySeed = seed) {
    const window = new CanonicalWindow(() => capture([{ ...base, text, thinking: text }]), undefined, identitySeed), target = open(window);
    return info(window, target.revision, target.entityRef, field).version;
  }
  assert.notEqual(version("\ud800"), version("\ud801")); assert.notEqual(version("\ud800"), version("\ufffd"));
  assert.equal(version("😀\u0000"), version("😀\u0000")); assert.notEqual(version("same"), version("same", "thinking"));
  assert.notEqual(version("same"), version("same", "text", "90".repeat(32)));
});

test("call, result and collection field info share exact read masks and normalize legacy input refs", () => {
  const message: ChatMessage = { ...base, calls: [{ id: "call", name: "bash", input: "args" }], attachments: [{ name: "file", path: "/file" }] };
  const groups: ThreadGroup[] = [{ id: "hidden", ids: ["a"], activity: true, thinkingOnlyIds: ["a"] }, { id: "visible", ids: ["a"], activity: true }];
  let current = capture([message], groups); const window = new CanonicalWindow(() => current, undefined, seed), first = open(window);
  const visible = data<WindowMemberPage>(window.read("r", { op: "members", revision: first.revision, sourceRef: first.sources.items[1].ref })).items[0].ref;
  const call = `${visible}_c_0`, result = `${call}_r`, attachment = `${visible}_a_attachments_0`;
  const input = info(window, first.revision, call, "input"), legacy = info(window, first.revision, visible, "input", 0);
  assert.equal(input.version, legacy.version); assert.equal(legacy.entityRef, call); assert.equal(input.lengthCU, 4);
  assert.equal(info(window, first.revision, call, "text").lengthCU, 4);
  const metadata = info(window, first.revision, attachment, "metadata");
  const value = data<WindowFieldData>(read(window, first.revision, attachment, "metadata", metadata.version)).chunk.text;
  assert.deepEqual(JSON.parse(value), { kind: "attachment", name: "file", attachmentKind: null, path: "/file" });
  for (const [ref, field] of [[first.entityRef, "text"], [`${first.entityRef}_c_0`, "input"], [`${first.entityRef}_c_0_r`, "text"], [`${first.entityRef}_a_attachments_0`, "metadata"]] as const)
    failure(window.read("r", { op: "fieldInfo", revision: first.revision, entityRef: ref, field }), "INVALID_REFERENCE");
  failure(window.read("r", { op: "fieldInfo", revision: first.revision, entityRef: result, field: "text" }), "UNAVAILABLE");
  current = capture([message, { id: "tool-call", role: "toolResult", text: "output" }], groups); const next = open(window);
  const member = data<WindowMemberPage>(window.read("r", { op: "members", revision: next.revision, sourceRef: next.sources.items[1].ref })).items[0].ref;
  assert.equal(info(window, next.revision, `${member}_c_0_r`, "text").lengthCU, 6);
  assert.equal(info(window, next.revision, `${member}_a_attachments_0`, "metadata").version, metadata.version);
});

test("checkpoint and source fields retain independent summary, selection and safe metadata versions", () => {
  const checkpoint: ChatMessage = { id: "checkpoint", role: "notice", text: "summary", compression: { number: 1, title: "old title", before: 10, after: 2 } };
  function archived(summary: ChatMessage) { return capture([base, summary], [], [{ id: summary.id, compression: summary.compression!, messageIds: ["a"],
    groups: [{ id: "group", ids: ["a"], activity: true, estimatedHeight: 100 }] }]); }
  let current = archived(checkpoint); const window = new CanonicalWindow(() => current, undefined, seed), first = open(window);
  const segment = data<WindowSegmentPage>(window.read("r", { op: "segments", revision: first.revision })).items[0];
  const summary = info(window, first.revision, segment.ref, "text"), metadata = info(window, first.revision, segment.ref, "metadata");
  const source = info(window, first.revision, first.sources.items[0].ref, "selection");
  assert.equal(source.lengthCU, 4); assert.equal(summary.lengthCU, 7);
  current = archived({ ...checkpoint, compression: { ...checkpoint.compression!, title: "new title" } }); const next = open(window);
  const second = data<WindowSegmentPage>(window.read("r", { op: "segments", revision: next.revision })).items[0];
  assert.equal(next.sources.structureVersion, first.sources.structureVersion);
  assert.equal(info(window, next.revision, second.ref, "text").version, summary.version);
  assert.notEqual(info(window, next.revision, second.ref, "metadata").version, metadata.version);
  failure(read(window, next.revision, second.ref, "metadata", metadata.version), "STALE");
  for (const field of ["thinking", "input", "selection", "error"])
    failure(window.read("r", { op: "fieldInfo", revision: next.revision, entityRef: second.ref, field }), "INVALID_REFERENCE");
});

test("field info and guards reject malformed targets and retired owners without revoking on a mismatch", () => {
  let active = true; const window = new CanonicalWindow(() => capture([base]), () => active, seed), target = open(window);
  const { revision, entityRef } = target, original = info(window, revision, entityRef, "text");
  failure(read(window, revision, entityRef, "text", "different"), "STALE");
  assert.equal(data<WindowFieldData>(read(window, revision, entityRef, "text", original.version)).chunk.text, base.text);
  for (const extra of [{ offsetCU: 0 }, { expectedVersion: original.version }, { field: "other" }, { call: 0 }]) {
    const reply = window.read("r", { op: "fieldInfo", revision, entityRef, field: "text", ...extra });
    failure(reply, "field" in extra ? "INVALID_FIELD" : "INVALID_REFERENCE");
  }
  failure(window.read("r", { op: "field", revision, entityRef, field: "text", expectedVersion: {} }), "INVALID_REFERENCE");
  failure(window.read(" bad ", { op: "fieldInfo", revision, entityRef, field: "text" }), "INVALID_REQUEST_ID");
  active = false; failure(window.read("r", { op: "fieldInfo", revision, entityRef, field: "text" }), "STALE");
});
