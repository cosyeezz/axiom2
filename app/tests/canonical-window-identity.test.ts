import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { createWindowIdentity, createWindowIdentityScopes } from "../src/server/canonical-window-identity.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowCallPage, WindowCollectionPage, WindowMemberPage, WindowMessageDescriptor, WindowSegmentPage, WindowSourcePage } from "../src/shared/thread-window.js";

const seed = "ab".repeat(32);
function capture(text = "before", archived = false, prefix = false, raw = "private") {
  const message: ChatMessage = { id: `${raw}-message`, role: "assistant", text, thinking: "thinking", runId: `${raw}-run`,
    calls: [{ id: `${raw}-call`, name: "read", input: text }], inputIds: [`${raw}-input`] };
  const result: ChatMessage = { id: `tool-${raw}-call`, role: "toolResult", text, status: "completed" };
  const checkpoint: ChatMessage = { id: `${raw}-checkpoint`, role: "notice", text,
    compression: { number: 1, title: text, before: 100, after: 0 } };
  const groups = [
    { id: "thinking", ids: [message.id], activity: true, thinkingOnlyIds: [message.id], estimatedHeight: 84 },
    { id: "body", ids: [message.id], activity: false, hideThinking: true, estimatedHeight: 180 },
    { id: "calls", ids: [message.id], activity: true, callsOnlyIds: [message.id], estimatedHeight: 84 },
  ];
  const current = new Map([message, result, checkpoint].map(item => [item.id, item]));
  if (prefix) current.set("prefix", { id: "prefix", role: "user", text: "new ordinal" });
  return captureCanonicalSources({ archive: { index: { revision: "archive", segments: [{ id: checkpoint.id,
    compression: checkpoint.compression!, messageIds: archived ? [message.id] : [], groups: archived ? groups : [] }] }, messages: current },
    currentGroups: [...(prefix ? [{ id: "prefix", ids: ["prefix"], activity: false }] : []), ...groups], currentMessages: current, transientMessages: new Map() });
}
function data<T>(reply: Reply, budget = 128 * 1024): T {
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= budget);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function scan(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("\u0001".repeat(200), { op: "open" })), revision = sources.revision;
  const members = sources.items.flatMap(source => data<WindowMemberPage>(window.read("r", { op: "members", revision, sourceRef: source.ref })).items)
    .filter(member => member.role === "assistant");
  const body = members.find(member => member.body !== "none")!, calls = members.find(member => member.calls > 0)!;
  return { sources, members, calls: data<WindowCallPage>(window.read("r", { op: "calls", revision, entityRef: calls.ref })),
    description: data<WindowMessageDescriptor>(window.read("\u0001".repeat(200), { op: "describe", revision, entityRef: body.ref }), 4096),
    inputs: data<WindowCollectionPage>(window.read("r", { op: "collection", revision, entityRef: body.ref, collection: "inputs" })),
    segments: data<WindowSegmentPage>(window.read("r", { op: "segments", revision })) };
}
function keys(value: ReturnType<typeof scan>) {
  return { namespace: value.sources.identityNamespace, message: value.members.map(member => member.messageKey),
    run: value.members.map(member => member.ownerRunKey), call: value.calls.items[0].callKey,
    result: value.calls.items[0].result!.messageKey, checkpoint: value.segments.items[0].messageKey, input: value.inputs.items[0].inputKey };
}

test("display keys survive body changes, ordinal movement and live-to-archive grouping without merging contribution masks", () => {
  let current = capture(); const window = new CanonicalWindow(() => current, undefined, seed), first = scan(window);
  current = capture("new text", false, true); const second = scan(window);
  assert.deepEqual(keys(second), keys(first)); assert.notEqual(second.members[0].ref, first.members[0].ref);
  assert.notEqual(second.inputs.items[0].identityRef, first.inputs.items[0].identityRef, "legacy equality refs remain cut-local");
  current = capture("archived text", true, true); const third = scan(window);
  assert.deepEqual(keys(third), keys(first)); assert.equal(third.sources.items[0].storage, "archive");
  assert.equal(new Set(third.members.map(member => member.messageKey)).size, 1);
  assert.equal(new Set(third.members.map(member => member.ownerRunKey)).size, 1);
  assert.deepEqual(third.members.map(member => [member.thinking, member.body, member.calls, member.last]),
    [[true, "none", 0, false], [false, "body", 0, false], [false, "none", 1, true]]);
  assert.equal(third.description.messageKey, third.members[1].messageKey);
  assert.equal(third.description.text?.text, "archived text");
});

test("same-scope owner handoffs preserve equality but keys never authorize reads or revive retired refs", () => {
  const firstOwner = new CanonicalWindow(() => capture(), undefined, seed), first = scan(firstOwner);
  firstOwner.close(); const secondOwner = new CanonicalWindow(() => capture("fresh"), undefined, seed), second = scan(secondOwner);
  assert.deepEqual(keys(second), keys(first));
  const old = firstOwner.read("r", { op: "sources", revision: first.sources.revision });
  assert.equal(old.ok, false); if (!old.ok) assert.equal(old.error.code, "STALE");
  for (const entityRef of [first.members[1].ref, second.members[1].messageKey, second.calls.items[0].callKey,
    second.segments.items[0].messageKey, second.inputs.items[0].inputKey]) {
    const reply = secondOwner.read("r", { op: "field", revision: second.sources.revision, entityRef, field: "text" });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, "INVALID_REFERENCE");
  }
});

test("scope tuples, host namespaces and key kinds are isolated with bounded opaque output even for huge IDs", () => {
  const scopes = createWindowIdentityScopes(seed), scope = { workspaceId: "a:b", sessionId: "c" };
  assert.equal(scopes(scope), scopes({ ...scope })); assert.notEqual(scopes(scope), scopes({ workspaceId: "a", sessionId: "b:c" }));
  assert.notEqual(scopes(scope), createWindowIdentityScopes("cd".repeat(32))(scope));
  const identity = createWindowIdentity(scopes(scope)), same = "private-".repeat(20000);
  const kindKeys = (["message", "call", "run", "input"] as const).map(kind => identity.key(kind, same));
  assert.equal(new Set(kindKeys).size, 4); assert.ok(kindKeys.every(key => /^[A-Za-z0-9_-]{45}$/.test(key)));
  const snapshot = scan(new CanonicalWindow(() => capture("body", false, false, same), undefined, scopes(scope)));
  assert.equal(JSON.stringify(snapshot).includes("private-"), false); assert.equal(JSON.stringify(snapshot).includes(scopes(scope)), false);
  const other = scan(new CanonicalWindow(() => capture(), undefined, scopes({ ...scope, sessionId: "different" })));
  assert.notEqual(other.sources.identityNamespace, snapshot.sources.identityNamespace);
  assert.throws(() => createWindowIdentity("invalid"), TypeError);
});
