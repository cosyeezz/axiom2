import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { WindowMemberPage, WindowSourcePage } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";
import type { Reply } from "../src/shared/protocol.js";

const capture = (messages: ChatMessage[], groups = [{ id: "raw-group", ids: messages.map(m => m.id), activity: true }]) =>
  captureCanonicalSources({ archive: { index: { revision: "archive", segments: [] }, messages: new Map() }, currentGroups: groups,
    currentMessages: new Map(messages.map(m => [m.id, m])), transientMessages: new Map() });
function data<T>(reply: Reply, budget = 128 * 1024): T {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= budget);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
const error = (reply: Reply, code: string) => {
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, code);
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 2048);
};
function open(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("request", { op: "open" }));
  const members = data<WindowMemberPage>(window.read("request", { op: "members", revision: sources.revision, sourceRef: sources.items[0].ref }));
  return { sources, members };
}

test("source pages cap descriptors without leaking raw IDs or slicing before grouping", () => {
  const messages = Array.from({ length: 150 }, (_, i): ChatMessage => ({ id: "private\0" + "汉".repeat(2000) + i,
    role: "assistant", text: "body", runId: "private-run" + "x".repeat(5000) }));
  const groups = messages.map(m => ({ id: "private-group" + m.id, ids: [m.id], activity: true, folded: true }));
  const window = new CanonicalWindow(() => capture(messages, groups));
  const tail = data<WindowSourcePage>(window.read("r", { op: "open" }));
  assert.equal(tail.total, 150); assert.equal(tail.items.length, 64); assert.equal(tail.previous, 86); assert.equal(tail.next, null);
  assert.equal(tail.items[0].folded, true);
  const previous = data<WindowSourcePage>(window.read("r", { op: "sources", revision: tail.revision, before: tail.previous }));
  assert.deepEqual(previous.items.map(item => item.order), Array.from({ length: 64 }, (_, i) => i + 22));
  const first = data<WindowSourcePage>(window.read("r", { op: "sources", revision: tail.revision, before: previous.previous }));
  assert.equal(first.items.length, 22); assert.equal(first.previous, null);
  assert.equal(JSON.stringify([tail, previous, first]).includes("private"), false);
});

test("huge source members are paged and last/shape/owner facts remain capture-global", () => {
  const messages = Array.from({ length: 145 }, (_, i): ChatMessage => ({ id: `raw-${i}`, role: "assistant", text: "body", runId: "same-run" }));
  const groups = [{ id: "one", ids: messages.map(m => m.id), activity: true }, { id: "two", ids: [messages[144].id], activity: true }];
  const window = new CanonicalWindow(() => capture(messages, groups)), { sources, members } = open(window);
  assert.equal(members.items.length, 64); assert.equal(members.previous, 81); assert.equal(members.total, 145);
  assert.equal(members.items.at(-1)?.last, false);
  const second = data<WindowMemberPage>(window.read("r", { op: "members", revision: sources.revision, sourceRef: sources.items[1].ref }));
  assert.equal(second.items[0].last, true);
  assert.equal(second.items[0].ownerRunRef, members.items[0].ownerRunRef);
  assert.ok(members.items.every(item => item.body === "body"));
  assert.equal(JSON.stringify(members).includes("same-run"), false);
});

test("field chunks use actual bounded receipts and reconstruct escaped Unicode losslessly", () => {
  const text = '😀\0\\\n"'.repeat(30000), message: ChatMessage = { id: "raw", role: "assistant", text,
    calls: [{ id: "raw-call", name: "fixture", input: text }] };
  const window = new CanonicalWindow(() => capture([message])), { sources, members } = open(window);
  for (const field of ["text", "input"] as const) {
    let entityRef = members.items[0].ref, offsetCU = 0, result = "", first = true;
    do {
      const part: WindowFieldData = data<WindowFieldData>(window.read("r", { op: "field", revision: sources.revision, entityRef, field, offsetCU,
        ...(field === "input" && first ? { call: 0 } : {}) }), 64 * 1024);
      assert.equal(part.chunk.offsetCU, offsetCU);
      assert.equal(part.chunk.totalLengthCU, text.length);
      result += part.chunk.text; entityRef = part.entityRef; first = false;
      if (part.chunk.nextOffsetCU === null) break;
      assert.ok(part.chunk.nextOffsetCU > offsetCU); offsetCU = part.chunk.nextOffsetCU;
    } while (true);
    assert.equal(result, text);
  }
});

test("immutable revisions, owner revocation and two-generation retirement reject stale reads", () => {
  let current = true;
  const native = capture([{ id: "m", role: "assistant", text: "saved" }]);
  const window = new CanonicalWindow(() => native, () => current), first = open(window);
  const second = open(window);
  const third = open(window);
  error(window.read("r", { op: "sources", revision: first.sources.revision }), "STALE");
  data(window.read("r", { op: "sources", revision: second.sources.revision }));
  current = false;
  error(window.read("r", { op: "field", revision: third.sources.revision, entityRef: third.members.items[0].ref, field: "text" }), "STALE");
  current = true;
  error(window.read("r", { op: "open" }), "STALE");
});

test("malformed requests and cross-window refs have fixed bounded failures", () => {
  const native = capture([{ id: "m", role: "assistant", text: "saved" }]);
  const one = new CanonicalWindow(() => native), two = new CanonicalWindow(() => native), first = open(one), second = open(two);
  error(one.read("\0".repeat(100000), { op: "open" }), "INVALID_REQUEST_ID");
  error(one.read("r", { op: "sources", revision: first.sources.revision, before: 1.5 }), "INVALID_OFFSET");
  error(one.read("r", { op: "open", extra: "x".repeat(100000) }), "INVALID_REFERENCE");
  error(one.read("r", { op: "field", revision: first.sources.revision, entityRef: second.members.items[0].ref, field: "text" }), "INVALID_REFERENCE");
  error(two.read("r", { op: "sources", revision: first.sources.revision }), "STALE");
  error(new CanonicalWindow(() => undefined).read("r", { op: "open" }), "UNAVAILABLE");
});
