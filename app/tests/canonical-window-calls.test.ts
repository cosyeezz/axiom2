import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { ThreadGroup } from "../src/shared/history.js";
import type { WindowCallPage, WindowMemberPage, WindowSourcePage } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";
import type { Reply } from "../src/shared/protocol.js";

function capture(messages: ChatMessage[], groups: ThreadGroup[] = [{ id: "source", ids: [messages[0].id], activity: true }]) {
  return captureCanonicalSources({ archive: { index: { revision: "archive", segments: [] }, messages: new Map() },
    currentGroups: groups, currentMessages: new Map(messages.map(message => [message.id, message])), transientMessages: new Map() });
}
function data<T>(reply: Reply, budget = 128 * 1024): T {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= budget);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function rejected(reply: Reply, code: string) {
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, code);
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 2048);
}
function open(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("r", { op: "open" }));
  const members = data<WindowMemberPage>(window.read("r", { op: "members", revision: sources.revision, sourceRef: sources.items[0].ref }));
  const target = { revision: sources.revision, entityRef: members.items[0].ref };
  return { sources, members, target, calls: data<WindowCallPage>(window.read("r", { op: "calls", ...target })) };
}
function full(window: CanonicalWindow, revision: string, entityRef: string, field: "text" | "input") {
  let offsetCU = 0, value = "";
  for (;;) {
    const part: WindowFieldData = data(window.read("r", { op: "field", revision, entityRef, field, offsetCU }), 64 * 1024);
    assert.equal(part.chunk.offsetCU, offsetCU); assert.equal(part.entityRef, entityRef);
    value += part.chunk.text;
    if (part.chunk.nextOffsetCU === null) { assert.equal(value.length, part.chunk.totalLengthCU); return value; }
    assert.ok(part.chunk.nextOffsetCU > offsetCU); offsetCU = part.chunk.nextOffsetCU;
  }
}

test("calls page within a huge member without leaking raw IDs, inputs or results", () => {
  const name = '巨大🙂\u0000\\"'.repeat(10_000), input = "secret-input".repeat(20_000);
  const message: ChatMessage = { id: "secret-message", role: "assistant", text: "", calls: Array.from({ length: 145 }, (_, i) => ({
    id: `secret-call\u0000${i}${"x".repeat(2000)}`, name, input })) };
  const result: ChatMessage = { id: `tool-${message.calls![144].id}`, role: "toolResult", text: "secret-output".repeat(20_000),
    streaming: true, status: "running", toolStartedAt: Infinity, durationMs: 0 };
  const window = new CanonicalWindow(() => capture([message, result])), opened = open(window);
  assert.equal(opened.members.items[0].calls, 145);
  assert.equal(opened.calls.total, 145); assert.equal(opened.calls.items.length, 64); assert.equal(opened.calls.previous, 81);
  assert.equal(opened.calls.next, null); assert.equal(opened.calls.items[0].order, 81);
  assert.equal(opened.calls.items.at(-1)!.result?.durationMs, 0);
  assert.equal(opened.calls.items.at(-1)!.result?.toolStartedAt, null);
  assert.equal(opened.calls.items.at(-1)!.result?.streaming, true);
  let previewBytes = 0;
  for (const item of opened.calls.items) {
    assert.equal(item.name.complete, false); assert.equal(item.name.totalLengthCU, name.length);
    assert.equal(item.inputLengthCU, input.length);
    const bytes = Buffer.byteLength(JSON.stringify(item.name)); assert.ok(bytes <= 128); previewBytes += bytes;
    assert.ok(Buffer.byteLength(JSON.stringify(item)) <= 4096);
  }
  assert.ok(previewBytes <= 8192);
  assert.equal(JSON.stringify(opened.calls).includes("secret-"), false);
  const middle = data<WindowCallPage>(window.read("r", { op: "calls", ...opened.target, before: 81 }));
  const head = data<WindowCallPage>(window.read("r", { op: "calls", ...opened.target, before: middle.previous }));
  assert.deepEqual([...head.items, ...middle.items, ...opened.calls.items].map(call => call.order), Array.from({ length: 145 }, (_, i) => i));
  assert.equal(head.previous, null); assert.equal(head.items[0].result, null, "unknown in this cut is not invented as completed");
  assert.equal(opened.members.items[0].last, true, "page boundaries never replace the occurrence fact");
});

test("call names, arguments and tool outputs continue losslessly in bounded actual frames", () => {
  const text = '🙂\u0000\n\\"'.repeat(30_000);
  const message: ChatMessage = { id: "a", role: "assistant", text: "assistant body", calls: [{ id: "call", name: text, input: text + "input" }] };
  const result: ChatMessage = { id: "tool-call", role: "toolResult", text: text + "result", status: "completed" };
  const window = new CanonicalWindow(() => capture([message, result])), opened = open(window), call = opened.calls.items[0];
  assert.equal(full(window, opened.target.revision, call.ref, "text"), text);
  assert.equal(full(window, opened.target.revision, call.ref, "input"), text + "input");
  assert.equal(full(window, opened.target.revision, call.result!.ref, "text"), text + "result");
  assert.equal(full(window, opened.target.revision, opened.target.entityRef, "text"), "assistant body");
  rejected(window.read("r", { op: "field", revision: opened.target.revision, entityRef: call.result!.ref, field: "input" }), "INVALID_REFERENCE");
  rejected(window.read("r", { op: "field", revision: opened.target.revision, entityRef: call.ref, field: "thinking" }), "INVALID_REFERENCE");
});

test("calls honor complete occurrence masks rather than exposing hidden duplicate contributions", () => {
  const message: ChatMessage = { id: "a", role: "assistant", text: "answer", thinking: "thought", calls: [{ id: "call", name: "bash", input: "{}" }] };
  const groups: ThreadGroup[] = [
    { id: "thinking", ids: [message.id], activity: true, thinkingOnlyIds: [message.id] },
    { id: "delivery", ids: [message.id], activity: false, hideThinking: true },
    { id: "visible", ids: [message.id], activity: true },
  ];
  const result: ChatMessage = { id: "tool-call", role: "toolResult", text: "saved output", status: "completed" };
  const window = new CanonicalWindow(() => capture([message, result], groups)), opened = open(window);
  assert.equal(opened.calls.total, 0); assert.deepEqual(opened.calls.items, []); assert.equal(opened.members.items[0].last, false);
  const members = data<WindowMemberPage>(window.read("r", { op: "members", revision: opened.target.revision, sourceRef: opened.sources.items[1].ref }));
  const calls = data<WindowCallPage>(window.read("r", { op: "calls", revision: opened.target.revision, entityRef: members.items[0].ref }));
  assert.equal(calls.total, 0); assert.equal(calls.previous, null); assert.equal(calls.next, null); assert.equal(members.items[0].last, false);
  for (const member of [opened.members.items[0], members.items[0]]) {
    for (const field of ["text", "input"] as const)
      rejected(window.read("r", { op: "field", revision: opened.target.revision, entityRef: `${member.ref}_c_0`, field }), "INVALID_REFERENCE");
    rejected(window.read("r", { op: "field", revision: opened.target.revision, entityRef: `${member.ref}_c_0_r`, field: "text" }), "INVALID_REFERENCE");
    rejected(window.read("r", { op: "field", revision: opened.target.revision, entityRef: member.ref, field: "input", call: 0 }), "INVALID_REFERENCE");
  }
  const visible = data<WindowMemberPage>(window.read("r", { op: "members", revision: opened.target.revision, sourceRef: opened.sources.items[2].ref }));
  const visibleCalls = data<WindowCallPage>(window.read("r", { op: "calls", revision: opened.target.revision, entityRef: visible.items[0].ref }));
  assert.equal(visible.items[0].last, true); assert.equal(visibleCalls.total, 1);
  assert.equal(full(window, opened.target.revision, visibleCalls.items[0].ref, "input"), "{}");
  assert.equal(full(window, opened.target.revision, visibleCalls.items[0].result!.ref, "text"), "saved output");
});

test("result presence is snapshot-local and invalid or foreign call references fail closed", () => {
  const message: ChatMessage = { id: "a", role: "assistant", text: "", calls: [{ id: "call", name: "bash", input: "{}" }] };
  const messages = [message], window = new CanonicalWindow(() => capture(messages)), old = open(window);
  assert.equal(old.calls.items[0].result, null);
  rejected(window.read("r", { op: "field", revision: old.target.revision, entityRef: `${old.calls.items[0].ref}_r`, field: "text" }), "UNAVAILABLE");
  messages.push({ id: "tool-call", role: "toolResult", text: "new result", status: "completed" });
  const next = open(window);
  assert.equal(full(window, next.target.revision, next.calls.items[0].result!.ref, "text"), "new result");
  const oldAgain = data<WindowCallPage>(window.read("r", { op: "calls", ...old.target }));
  assert.equal(oldAgain.items[0].result, null, "old cut is not relabeled by a newly arrived result");
  rejected(window.read("r", { op: "calls", ...next.target, entityRef: old.target.entityRef }), "INVALID_REFERENCE");
  rejected(window.read("r", { op: "calls", ...next.target, before: 2 }), "INVALID_OFFSET");
  rejected(window.read("r", { op: "calls", ...next.target, before: -1 }), "INVALID_OFFSET");
  rejected(window.read("r", { op: "calls", ...next.target, entityRef: next.calls.items[0].ref }), "INVALID_REFERENCE");
  rejected(window.read("r", { op: "field", ...next.target, entityRef: `${next.target.entityRef}_r`, field: "text" }), "INVALID_REFERENCE");
  rejected(window.read("r", { op: "field", ...next.target, entityRef: next.calls.items[0].ref, field: "input", call: 0 }), "INVALID_REFERENCE");
  window.close(); rejected(window.read("r", { op: "calls", ...next.target }), "STALE");
});
