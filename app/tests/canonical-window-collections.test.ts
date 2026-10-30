import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { ThreadGroup } from "../src/shared/history.js";
import type { Reply } from "../src/shared/protocol.js";
import { windowCollections, type WindowCollectionPage, type WindowMessageDescriptor, type WindowMemberPage, type WindowSourcePage } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const capture = (message: ChatMessage, groups: ThreadGroup[] = [{ id: "private-group", ids: [message.id], activity: false }]) =>
  captureCanonicalSources({ archive: { index: { revision: "fixture", segments: [] }, messages: new Map() },
    currentGroups: groups, currentMessages: new Map([[message.id, message]]), transientMessages: new Map() });
function data<T>(reply: Reply, budget = 128 * 1024): T {
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(bytes(reply) <= budget);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function failure(reply: Reply, code = "INVALID_REFERENCE") {
  assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code); assert.ok(bytes(reply) <= 2048);
}
function open(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("r", { op: "open" }));
  const refs = sources.items.map(source => data<WindowMemberPage>(window.read("r", { op: "members", revision: sources.revision, sourceRef: source.ref })).items[0].ref);
  return { revision: sources.revision, refs, sourceRef: sources.items[0].ref };
}
function metadata(window: CanonicalWindow, revision: string, entityRef: string) {
  let offsetCU = 0, text = "";
  for (let page = 0; page < 100; page++) {
    const part = data<WindowFieldData>(window.read("r", { op: "field", revision, entityRef, field: "metadata", offsetCU }), 64 * 1024);
    assert.equal(part.chunk.offsetCU, offsetCU); assert.equal(part.entityRef, entityRef); assert.equal(part.field, "metadata");
    assert.ok(bytes(part.chunk.text) <= 48 * 1024); text += part.chunk.text;
    if (part.chunk.nextOffsetCU === null) { assert.equal(text.length, part.chunk.totalLengthCU); return JSON.parse(text); }
    assert.ok(part.chunk.nextOffsetCU > offsetCU); offsetCU = part.chunk.nextOffsetCU;
  }
  assert.fail("metadata did not reach EOF");
}
function message(count = 145): ChatMessage {
  const long = '中😀\u0000\\"'.repeat(12000);
  return { id: "private-message", role: "assistant", text: "body", thinking: "thought",
    images: Array.from({ length: count }, (_, i) => ({ id: `private-image-${i}`, name: long, mimeType: "image/png", path: long })),
    attachments: Array.from({ length: count }, (_, i) => ({ id: `private-attachment-${i}`, name: long, kind: "file", path: long })),
    skills: Array.from({ length: count }, (_, i) => ({ id: `private-skill-${i}`, name: long, description: long })),
    inputIds: Array.from({ length: count }, (_, i) => `private-input-${i}`) };
}

test("large message collections page independently with bounded labels and private receipt identity refs", () => {
  const m = message(), window = new CanonicalWindow(() => capture(m, [
    { id: "a", ids: [m.id], activity: false }, { id: "b", ids: [m.id], activity: false },
  ])), { revision, refs } = open(window);
  for (const collection of windowCollections) {
    const orders: number[] = [];
    let before: number | undefined;
    do {
      const page = data<WindowCollectionPage>(window.read("\u0001".repeat(200), { op: "collection", revision, entityRef: refs[0], collection, ...(before === undefined ? {} : { before }) }));
      assert.equal(page.collection, collection); assert.equal(page.total, 145); assert.ok(page.items.length <= 64);
      assert.ok(page.items.reduce((sum, item) => sum + (item.label ? bytes(item.label) : 0), 0) <= 8192);
      assert.equal(JSON.stringify(page).includes("private-"), false);
      for (const item of page.items) {
        assert.ok(bytes(item) <= 4096); orders.push(item.order);
        assert.equal(item.label === null, collection === "inputs"); assert.equal(item.identityRef === null, collection !== "inputs");
        if (item.label) { assert.equal(item.label.complete, false); assert.equal(item.label.totalLengthCU, m.images![0].name.length); }
      }
      if (page.previous === null) break; before = page.previous;
    } while (true);
    assert.deepEqual(orders.sort((a, b) => a - b), Array.from({ length: 145 }, (_, i) => i));
  }
  const pages = refs.map(entityRef => data<WindowCollectionPage>(window.read("r", { op: "collection", revision, entityRef, collection: "inputs" })));
  assert.deepEqual(pages[0].items.map(item => item.identityRef), pages[1].items.map(item => item.identityRef));
  assert.notEqual(pages[0].items[0].ref, pages[1].items[0].ref);
  assert.equal(new Set(pages[0].items.map(item => item.identityRef)).size, 64);
  failure(window.read("r", { op: "field", revision, entityRef: pages[0].items[0].ref, field: "metadata" }));
});

test("individual collection metadata continues losslessly and never copies raw IDs or unknown extras", () => {
  const m = message(1);
  Object.assign(m.images![0], { data: "private-base64", extras: ["private-extra"] });
  const window = new CanonicalWindow(() => capture(m)), { revision, refs } = open(window);
  const expected = {
    images: { kind: "image", name: m.images![0].name, mimeType: "image/png", path: m.images![0].path },
    attachments: { kind: "attachment", name: m.attachments![0].name, attachmentKind: "file", path: m.attachments![0].path },
    skills: { kind: "skill", name: m.skills![0].name, description: m.skills![0].description },
  };
  for (const collection of ["images", "attachments", "skills"] as const) {
    const page = data<WindowCollectionPage>(window.read("r", { op: "collection", revision, entityRef: refs[0], collection }));
    const result = metadata(window, revision, page.items[0].ref);
    assert.deepEqual(result, expected[collection]); assert.equal(JSON.stringify(result).includes("private-"), false);
    for (const field of ["text", "thinking", "error", "selection", "input"])
      failure(window.read("r", { op: "field", revision, entityRef: page.items[0].ref, field }));
  }
});

test("fixed message metadata exposes compression and safe diagnostic projection but not bodies, arrays or delivery telemetry", () => {
  const m = message(1);
  m.compression = { number: 7, title: '😀\u0000\\"'.repeat(20000), before: 1000, after: 0 };
  m.kiroFailure = { stage: "http", category: "validation", partial: false, status: 400, code: "ValidationException",
    observedValidationReason: { token: "TOOL_SCHEMA_INVALID", contract: "unverified", source: "local-static-allowlist" } };
  Object.assign(m.compression, { hidden: "private-extra" }); Object.assign(m.kiroFailure, { headers: "private-header" });
  m.deliveryTiming = { runId: "private-run", requestId: "private-request", updateId: 1, workerAt: 10 };
  const window = new CanonicalWindow(() => capture(m)), { revision, refs } = open(window);
  const value = metadata(window, revision, refs[0]);
  assert.deepEqual(value, { compression: { number: 7, title: m.compression.title, before: 1000, after: 0 },
    kiroFailure: { stage: "http", category: "validation", partial: false, status: 400, code: "ValidationException",
      observedValidationReason: { token: "TOOL_SCHEMA_INVALID", contract: "unverified", source: "local-static-allowlist" } } });
  assert.equal(JSON.stringify(value).includes("private-"), false);
  const empty = new CanonicalWindow(() => capture({ id: "empty", role: "user", text: "" })), opened = open(empty);
  assert.deepEqual(metadata(empty, opened.revision, opened.refs[0]), { compression: null, kiroFailure: null });
});

test("collection refs obey occurrence masks, reject malformed targets and preserve snapshot isolation", () => {
  const m = message(1);
  let current = capture(m, [
    { id: "thinking", ids: [m.id], activity: true, thinkingOnlyIds: [m.id] },
    { id: "body", ids: [m.id], activity: false, hideThinking: true },
  ]);
  const window = new CanonicalWindow(() => current), old = open(window), { revision, refs, sourceRef } = old;
  for (const collection of windowCollections) {
    const hidden = data<WindowCollectionPage>(window.read("r", { op: "collection", revision, entityRef: refs[0], collection }));
    assert.equal(hidden.total, 0); assert.deepEqual(hidden.items, []);
    const descriptor = data<WindowMessageDescriptor>(window.read("r", { op: "describe", revision, entityRef: refs[0] }), 4096);
    assert.equal(descriptor.collections[collection], 0);
    failure(window.read("r", { op: "field", revision, entityRef: `${refs[0]}_a_${collection}_0`, field: "metadata" }));
  }
  const itemRef = `${refs[1]}_a_images_0`;
  for (const entityRef of [sourceRef, itemRef, `${refs[1]}_c_0`, "foreign_m_0_0"])
    failure(window.read("r", { op: "collection", revision, entityRef, collection: "images" }));
  for (const suffix of ["_a_images_1", "_a_images_00", "_a_images_-1", "_a_images_1.5", "_a_unknown_0", "_a_images_0_c_0", "_a_images_0_r"])
    failure(window.read("r", { op: "field", revision, entityRef: refs[1] + suffix, field: "metadata" }));
  failure(window.read("r", { op: "collection", revision, entityRef: refs[1], collection: "calls" }));
  failure(window.read("r", { op: "collection", revision, entityRef: refs[1], collection: "images", before: 2 }), "INVALID_OFFSET");
  current = capture({ id: m.id, role: "user", text: "new" }); const next = open(window);
  const empty = data<WindowCollectionPage>(window.read("r", { op: "collection", revision: next.revision, entityRef: next.refs[0], collection: "images" }));
  assert.equal(empty.total, 0); assert.equal(metadata(window, revision, itemRef).name, m.images![0].name);
  window.close(); failure(window.read("r", { op: "field", revision, entityRef: itemRef, field: "metadata" }), "STALE");
});
