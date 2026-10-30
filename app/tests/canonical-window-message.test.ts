import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage, SelectionChange } from "../src/shared/agent.js";
import type { ThreadGroup } from "../src/shared/history.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowMessageDescriptor, WindowMemberPage, WindowSourcePage } from "../src/shared/thread-window.js";
import type { WindowField, WindowFieldData } from "../src/shared/window-frame-budget.js";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const capture = (message: ChatMessage, groups: ThreadGroup[] = [{ id: "private-group", ids: [message.id], activity: true }]) =>
  captureCanonicalSources({ archive: { index: { revision: "fixture", segments: [] }, messages: new Map() },
    currentGroups: groups, currentMessages: new Map([[message.id, message]]), transientMessages: new Map() });
function data<T>(reply: Reply, budget = 128 * 1024): T {
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(bytes(reply) <= budget);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function failure(reply: Reply, code: string) {
  assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code);
  assert.ok(bytes(reply) <= 2048);
}
function open(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("r", { op: "open" }));
  const members = sources.items.map(source => data<WindowMemberPage>(window.read("r", { op: "members", revision: sources.revision, sourceRef: source.ref })));
  return { sources, revision: sources.revision, refs: members.map(page => page.items[0].ref) };
}
function full(window: CanonicalWindow, revision: string, entityRef: string, field: WindowField) {
  let offsetCU = 0, text = "";
  for (let page = 0; page < 100; page++) {
    const part = data<WindowFieldData>(window.read("r", { op: "field", revision, entityRef, field, offsetCU }), 64 * 1024);
    assert.equal(part.chunk.offsetCU, offsetCU); assert.equal(part.entityRef, entityRef);
    assert.equal(part.field, field); assert.ok(bytes(part.chunk.text) <= 48 * 1024);
    text += part.chunk.text;
    if (part.chunk.nextOffsetCU === null) { assert.equal(text.length, part.chunk.totalLengthCU); return text; }
    assert.ok(part.chunk.nextOffsetCU > offsetCU); offsetCU = part.chunk.nextOffsetCU;
  }
  assert.fail("field did not reach EOF");
}

test("message descriptors budget previews and metadata without serializing full collections", () => {
  const text = '中😀\u0000\\\n"\ud800'.repeat(10000);
  const message: ChatMessage = { id: "private-message", runId: "private-run", role: "assistant", text, thinking: text,
    error: text, phase: "final_answer", status: "completed", runOrigin: "manual_resume", streaming: true, thinkingActive: true, inputContinuation: true,
    images: Array.from({ length: 145 }, (_, i) => ({ id: `private-image-${i}`, name: text, mimeType: "image/png" })),
    attachments: Array.from({ length: 150 }, (_, i) => ({ id: `private-attachment-${i}`, kind: "file", name: text, path: text })),
    inputIds: Array.from({ length: 200 }, (_, i) => `private-input-${i}`),
    calls: [{ id: "private-call", name: "bash", input: text }] };
  const window = new CanonicalWindow(() => capture(message)), { revision, refs } = open(window);
  for (const requestId of ["r", "\u0001".repeat(200), "\ud800".repeat(200)]) {
    const reply = window.read(requestId, { op: "describe", revision, entityRef: refs[0] });
    const item = data<WindowMessageDescriptor>(reply, 4096);
    assert.equal(item.kind, "message"); assert.equal(item.role, "assistant");
    assert.equal(item.status, "completed"); assert.equal(item.phase, "final_answer");
    assert.equal(item.runOrigin, "manual_resume"); assert.equal(item.hasError, true);
    assert.equal(item.streaming, true); assert.equal(item.thinkingActive, true); assert.equal(item.inputContinuation, true);
    assert.deepEqual(item.collections, { calls: 1, images: 145, attachments: 150, skills: 0, inputs: 200 });
    for (const chunk of [item.text!, item.thinking!]) {
      assert.ok(bytes(chunk.text) <= 512); assert.equal(chunk.totalLengthCU, text.length); assert.equal(chunk.offsetCU, 0);
      assert.ok(chunk.nextOffsetCU !== null); assert.equal(chunk.text, text.slice(0, chunk.nextOffsetCU!));
    }
    assert.equal(JSON.stringify(reply).includes("private-"), false);
    assert.equal(JSON.stringify(reply).includes(text), false);
  }
  for (const field of ["text", "thinking", "error"] as const) assert.equal(full(window, revision, refs[0], field), text);
});

test("member and source selections continue from their own immutable capture without arbitrary extras", () => {
  const long = '😀\u0000\\"'.repeat(12000);
  const sourceSelection: SelectionChange = { from: { provider: long, id: "old", thinking: "off" }, to: { provider: "new", id: long, thinking: "high" } };
  const memberSelection: SelectionChange = { from: sourceSelection.to, to: sourceSelection.from };
  const message: ChatMessage = { id: "private", role: "assistant", text: "body", selectionChange: { ...memberSelection, secret: "never-on-wire" } as SelectionChange };
  let current = capture(message, [{ id: "group", ids: [message.id], activity: true, selectionChange: sourceSelection }]);
  const window = new CanonicalWindow(() => current), old = open(window);
  const item = data<WindowMessageDescriptor>(window.read("r", { op: "describe", revision: old.revision, entityRef: old.refs[0] }), 4096);
  assert.equal(item.hasSelection, true); assert.equal(old.sources.items[0].hasSelection, true);
  assert.deepEqual(JSON.parse(full(window, old.revision, old.refs[0], "selection")), memberSelection);
  assert.deepEqual(JSON.parse(full(window, old.revision, old.sources.items[0].ref, "selection")), sourceSelection);
  current = capture({ id: "private", role: "assistant", text: "next" });
  const next = open(window);
  assert.equal(full(window, next.revision, next.refs[0], "selection"), "null");
  assert.equal(full(window, next.revision, next.sources.items[0].ref, "selection"), "null");
  assert.deepEqual(JSON.parse(full(window, old.revision, old.refs[0], "selection")), memberSelection);
});

test("message previews and field continuations respect complete occurrence contribution masks", () => {
  const message: ChatMessage = { id: "private", role: "assistant", text: "body", thinking: "thought", thinkingActive: true,
    calls: [{ id: "call", name: "bash", input: "{}" }] };
  const groups: ThreadGroup[] = [
    { id: "thinking", ids: [message.id], activity: true, thinkingOnlyIds: [message.id] },
    { id: "calls", ids: [message.id], activity: true, callsOnlyIds: [message.id] },
    { id: "body", ids: [message.id], activity: false, hideThinking: true },
  ];
  const window = new CanonicalWindow(() => capture(message, groups)), { revision, refs } = open(window);
  const items = refs.map(entityRef => data<WindowMessageDescriptor>(window.read("r", { op: "describe", revision, entityRef }), 4096));
  assert.equal(items[0].text, null); assert.equal(items[0].thinking?.text, "thought"); assert.equal(items[0].collections.calls, 0);
  assert.equal(items[1].text, null); assert.equal(items[1].thinking, null); assert.equal(items[1].collections.calls, 1);
  assert.equal(items[2].text?.text, "body"); assert.equal(items[2].thinking, null); assert.equal(items[2].collections.calls, 0);
  for (const i of [0, 1]) failure(window.read("r", { op: "field", revision, entityRef: refs[i], field: "text" }), "INVALID_REFERENCE");
  for (const i of [1, 2]) failure(window.read("r", { op: "field", revision, entityRef: refs[i], field: "thinking" }), "INVALID_REFERENCE");
  assert.equal(full(window, revision, refs[0], "thinking"), "thought"); assert.equal(full(window, revision, refs[2], "text"), "body");
});

test("description unknowns are explicit and invalid targets, offsets and retired owners fail closed", () => {
  const captured = capture({ id: "private", role: "user", text: "", runOrigin: "invented" as never });
  let active = true;
  const window = new CanonicalWindow(() => captured, () => active), { revision, refs, sources } = open(window);
  const item = data<WindowMessageDescriptor>(window.read("r", { op: "describe", revision, entityRef: refs[0] }), 4096);
  assert.equal(item.status, null); assert.equal(item.phase, null); assert.equal(item.runOrigin, null);
  assert.equal(item.hasError, false); assert.equal(item.thinking, null); assert.equal(item.text?.text, "");
  assert.equal(full(window, revision, refs[0], "error"), "");
  for (const entityRef of [sources.items[0].ref, `${refs[0]}_c_0`, `${refs[0]}_c_0_r`, "other_m_0_0"])
    failure(window.read("r", { op: "describe", revision, entityRef }), "INVALID_REFERENCE");
  failure(window.read("r", { op: "describe", revision, entityRef: refs[0], offsetCU: 0 }), "INVALID_REFERENCE");
  failure(window.read("r", { op: "field", revision, entityRef: sources.items[0].ref, field: "error" }), "INVALID_REFERENCE");
  failure(window.read("r", { op: "field", revision, entityRef: refs[0], field: "selection", offsetCU: 5 }), "INVALID_OFFSET");
  failure(window.read("r", { op: "field", revision, entityRef: refs[0], field: "selection", call: 0 }), "INVALID_REFERENCE");
  for (const field of ["error", "selection"])
    failure(window.read("r", { op: "field", revision, entityRef: `${refs[0]}_c_0_r`, field }), "INVALID_REFERENCE");
  active = false;
  failure(window.read("r", { op: "describe", revision, entityRef: refs[0] }), "STALE");
});
