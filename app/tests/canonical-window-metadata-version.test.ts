import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { HistoryIndex, ThreadGroup } from "../src/shared/history.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowCallPage, WindowCollectionPage, WindowFieldInfo, WindowMessageDescriptor, WindowMemberPage, WindowSegmentPage, WindowSourcePage } from "../src/shared/thread-window.js";

const seed = "ab".repeat(32), base: ChatMessage = { id: "m", role: "assistant", text: "x".repeat(1000) };
function data<T>(reply: Reply): T { assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 128 * 1024); return (reply as Extract<Reply, { ok: true }>).data as T; }
function failure(reply: Reply, code: string) { assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code); }
function inspect(message: ChatMessage, extra: ChatMessage[] = [], groups: ThreadGroup[] = [{ id: "g", ids: ["m"], activity: true }], segments: HistoryIndex["segments"] = []) {
  const full = new Map([message, ...extra].map(item => [item.id, item]));
  const capture = captureCanonicalSources({ archive: { index: { revision: "fixture", segments }, messages: full }, currentGroups: groups, currentMessages: full, transientMessages: new Map() });
  const window = new CanonicalWindow(() => capture, undefined, seed), sources = data<WindowSourcePage>(window.read("r", { op: "open" })), revision = sources.revision;
  const members = data<WindowMemberPage>(window.read("r", { op: "members", revision, sourceRef: sources.items[0].ref })), entityRef = members.items[0].ref;
  const reply = window.read("\u0001".repeat(200), { op: "describe", revision, entityRef }); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 4096);
  return { window, sources, revision, entityRef, description: data<WindowMessageDescriptor>(reply) };
}
type Opened = ReturnType<typeof inspect>;
const calls = (opened: Opened) => data<WindowCallPage>(opened.window.read("r", { op: "calls", revision: opened.revision, entityRef: opened.entityRef }));
const collection = (opened: Opened, kind: "attachments" | "inputs" | "images", extra: Record<string, unknown> = {}) =>
  data<WindowCollectionPage>(opened.window.read("r", { op: "collection", revision: opened.revision, entityRef: opened.entityRef, collection: kind, ...extra }));
const textVersion = (opened: Opened, entityRef = opened.entityRef) => data<WindowFieldInfo>(opened.window.read("r", { op: "fieldInfo", revision: opened.revision, entityRef, field: "text" })).version;

test("message descriptor versions track visible scalars independently of refs, structure and unpreviewed field bytes", () => {
  const first = inspect(base), same = inspect(base);
  assert.equal(first.description.descriptorVersion, same.description.descriptorVersion); assert.notEqual(first.entityRef, same.entityRef);
  const variants: Partial<ChatMessage>[] = [{ status: "running" }, { streaming: true }, { phase: "commentary" }, { runOrigin: "manual_resume" },
    { inputContinuation: true }, { error: "failure" }, { attachments: [{ name: "file" }] }];
  for (const variant of variants) {
    const next = inspect({ ...base, ...variant }); assert.equal(next.sources.structureVersion, first.sources.structureVersion);
    assert.notEqual(next.description.descriptorVersion, first.description.descriptorVersion, JSON.stringify(variant));
  }
  const tail = inspect({ ...base, text: base.text.slice(0, -1) + "z" });
  assert.equal(tail.description.descriptorVersion, first.description.descriptorVersion, "descriptor equality is NOT a full-body witness");
  assert.notEqual(textVersion(tail), textVersion(first));
  assert.notEqual(inspect({ ...base, text: "z" + base.text.slice(1) }).description.descriptorVersion, first.description.descriptorVersion);
});

test("call descriptor versions cover result presence and status but not same-length unpreviewed arguments or output", () => {
  const message: ChatMessage = { ...base, calls: [{ id: "call", name: "bash", input: "args" }] };
  const result: ChatMessage = { id: "tool-call", role: "toolResult", text: "output", status: "running", streaming: true, toolStartedAt: 0, durationMs: 0 };
  const first = inspect(message, [result]), initial = calls(first).items[0];
  assert.equal(calls(inspect(message, [result])).items[0].descriptorVersion, initial.descriptorVersion, "cut-local result refs do not affect equality");
  for (const variant of [{ status: "completed" as const }, { streaming: false }, { durationMs: 1 }, { toolStartedAt: 1 }]) {
    const next = inspect(message, [{ ...result, ...variant }]); assert.equal(next.sources.structureVersion, first.sources.structureVersion);
    assert.notEqual(calls(next).items[0].descriptorVersion, initial.descriptorVersion);
  }
  const missing = inspect(message); assert.equal(missing.sources.structureVersion, first.sources.structureVersion);
  assert.notEqual(calls(missing).items[0].descriptorVersion, initial.descriptorVersion);
  const changed = inspect({ ...message, calls: [{ ...message.calls![0], input: "diff" }] }, [{ ...result, text: "change" }]);
  assert.equal(calls(changed).items[0].descriptorVersion, initial.descriptorVersion);
  assert.notEqual(textVersion(changed, calls(changed).items[0].result!.ref), textVersion(first, initial.result!.ref));
});

test("collection versions cover full ordered membership beyond loaded pages and guard same-count replacement", () => {
  const attachments = Array.from({ length: 145 }, (_, i) => ({ id: `private-${i}`, name: "same", path: `/${i}` }));
  const first = inspect({ ...base, attachments }), page = collection(first, "attachments");
  assert.equal(page.items.length, 64); assert.equal(page.previous, 81); assert.ok(!JSON.stringify(page).includes("private-"));
  const same = inspect({ ...base, text: "different body", attachments });
  assert.equal(collection(same, "attachments", { before: 1, expectedVersion: page.version }).version, page.version);
  const variants = [
    attachments.map((item, i) => i ? item : { ...item, id: "replacement" }),
    attachments.map((item, i) => i ? item : { ...item, path: "/changed" }),
    [attachments[1], attachments[0], ...attachments.slice(2)],
  ];
  for (const items of variants) {
    const next = inspect({ ...base, attachments: items }); assert.equal(next.sources.structureVersion, first.sources.structureVersion);
    assert.notEqual(collection(next, "attachments").version, page.version);
    failure(next.window.read("r", { op: "collection", revision: next.revision, entityRef: next.entityRef, collection: "attachments", before: 1, expectedVersion: page.version }), "STALE");
    assert.equal(collection(next, "attachments").total, 145, "a mismatch does not revoke the reader");
  }
  assert.equal(collection(first, "attachments", { before: 1 }).version, page.version, "version is whole collection, not a page");
  const extras = attachments.map(item => ({ ...item, untrustedExtra: "ignored" }));
  assert.equal(collection(inspect({ ...base, attachments: extras }), "attachments").version, page.version);
  failure(first.window.read("r", { op: "collection", revision: first.revision, entityRef: first.entityRef, collection: "attachments", expectedVersion: {} }), "INVALID_REFERENCE");
});

test("collection versions respect body masks, private input identity and item-domain separation", () => {
  const hidden: ThreadGroup[] = [{ id: "g", ids: ["m"], activity: true, thinkingOnlyIds: ["m"] }];
  const first = inspect({ ...base, attachments: [{ id: "one", name: "file" }] }, [], hidden);
  const next = inspect({ ...base, attachments: [{ id: "two", name: "different" }] }, [], hidden);
  assert.equal(collection(first, "attachments").total, 0); assert.equal(collection(first, "attachments").version, collection(next, "attachments").version);
  assert.notEqual(collection(first, "attachments").version, collection(first, "images").version);
  const inputs = inspect({ ...base, inputIds: ["private-a", "private-b"] }), changed = inspect({ ...base, inputIds: ["private-b", "private-a"] });
  assert.notEqual(collection(inputs, "inputs").version, collection(changed, "inputs").version);
  const image = { id: "image", name: "picture", mimeType: "image/png" }, withBytes = { ...image, data: "not-metadata" };
  assert.equal(collection(inspect({ ...base, images: [image] }), "images").version,
    collection(inspect({ ...base, images: [withBytes] }), "images").version);
});

test("segment descriptors refresh visible title metadata without confusing summary content equality", () => {
  const summary: ChatMessage = { id: "checkpoint", role: "notice", text: "summary", compression: { number: 1, title: "title", before: 10, after: 2 } };
  function archived(checkpoint: ChatMessage) {
    const opened = inspect(base, [checkpoint], [], [{ id: checkpoint.id, compression: checkpoint.compression!, messageIds: ["m"], groups: [{ id: "g", ids: ["m"], activity: true, estimatedHeight: 100 }] }]);
    return { ...opened, segment: data<WindowSegmentPage>(opened.window.read("r", { op: "segments", revision: opened.revision })).items[0] };
  }
  const first = archived(summary), same = archived(summary); assert.equal(same.segment.descriptorVersion, first.segment.descriptorVersion);
  const title = archived({ ...summary, compression: { ...summary.compression!, title: "other" } });
  assert.equal(title.sources.structureVersion, first.sources.structureVersion); assert.notEqual(title.segment.descriptorVersion, first.segment.descriptorVersion);
  const text = archived({ ...summary, text: "changed" }); assert.equal(text.segment.descriptorVersion, first.segment.descriptorVersion);
  assert.notEqual(textVersion(text, text.segment.ref), textVersion(first, first.segment.ref));
});
