import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { createWindowIdentity } from "../src/server/canonical-window-identity.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Reply } from "../src/shared/protocol.js";
import type { WindowCallPage, WindowMemberPage, WindowSegmentPage, WindowSourcePage } from "../src/shared/thread-window.js";

const seed = "12".repeat(32);
function fixture(options: { text?: string; input?: string; thinking?: string; calls?: [string, string][]; ids?: string[];
  role?: "assistant" | "user"; owner?: string; folded?: boolean; selection?: boolean; duplicate?: boolean; segment?: boolean; hidden?: boolean } = {}) {
  const messages = new Map<string, ChatMessage>();
  for (const id of ["a", "b", "c"]) messages.set(id, { id, role: options.role ?? "assistant", text: options.text ?? "body",
    runId: options.owner ?? "run", thinking: options.thinking ?? "thought", calls: (options.calls ?? [["first", "bash"], ["second", "read"]])
      .map(([id, name]) => ({ id, name, input: options.input ?? "args" })) });
  const checkpoint: ChatMessage = { id: "checkpoint", role: "notice", text: options.text ?? "summary",
    compression: { number: 1, title: options.text ?? "title", before: 10, after: 0 } };
  messages.set(checkpoint.id, checkpoint);
  const group = { id: "same-raw-group", ids: options.ids ?? ["a", "b"], activity: true,
    ...(options.folded ? { folded: true } : {}), ...(options.hidden ? { thinkingOnlyIds: options.ids ?? ["a", "b"] } : {}),
    ...(options.selection ? { selectionChange: { from: { provider: "p", id: "a", thinking: "off" as const }, to: { provider: "p", id: "b", thinking: "off" as const } } } : {}) };
  return captureCanonicalSources({ archive: { index: { revision: "same", segments: options.segment ? [{ id: checkpoint.id,
    compression: checkpoint.compression!, messageIds: [], groups: [] }] : [] }, messages }, currentGroups: options.duplicate ? [group, group] : [group],
    currentMessages: messages, transientMessages: new Map() });
}
function data<T>(reply: Reply): T {
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 128 * 1024);
  return (reply as Extract<Reply, { ok: true }>).data as T;
}
function inspect(window: CanonicalWindow) {
  const sources = data<WindowSourcePage>(window.read("r", { op: "open" }));
  const members = data<WindowMemberPage>(window.read("r", { op: "members", revision: sources.revision, sourceRef: sources.items[0].ref }));
  return { sources, members };
}
function snapshot(options: Parameters<typeof fixture>[0] = {}) { return inspect(new CanonicalWindow(() => fixture(options), undefined, seed)); }

test("structure ignores body and argument tokens but preserves source and occurrence display identity", () => {
  const first = snapshot(), second = snapshot({ text: "changed body", input: "new args", thinking: "new thought", calls: [["first", "write"], ["second", "grep"]] });
  assert.equal(first.sources.structureVersion, second.sources.structureVersion);
  assert.equal(first.sources.items[0].sourceKey, second.sources.items[0].sourceKey);
  assert.deepEqual(first.members.items.map(item => item.occurrenceKey), second.members.items.map(item => item.occurrenceKey));
  const duplicate = snapshot({ duplicate: true });
  assert.equal(new Set(duplicate.sources.items.map(source => source.sourceKey)).size, 2, "duplicate raw group IDs do not collide");
  const again = snapshot({ duplicate: true, text: "more" });
  assert.deepEqual(duplicate.sources.items.map(source => source.sourceKey), again.sources.items.map(source => source.sourceKey));
});

test("whole-cut structure detects same-count replacement, reordering, slot masks, ownership and task classification", () => {
  const base = snapshot().sources.structureVersion;
  const variants: Parameters<typeof fixture>[0][] = [
    { ids: ["b", "a"] }, { ids: ["a", "c"] }, { calls: [["second", "read"], ["first", "bash"]] },
    { calls: [["different", "bash"], ["second", "read"]] }, { calls: [["first", "delegate"], ["second", "read"]] },
    { text: "", thinking: "thought" }, { thinking: "" }, { folded: true }, { selection: true }, { owner: "different" },
    { hidden: true }, { role: "user" }, { segment: true },
  ];
  for (const variant of variants) assert.notEqual(snapshot(variant).sources.structureVersion, base, JSON.stringify(variant));
  const task = snapshot({ calls: [["first", "delegate"]] });
  assert.equal(task.sources.structureVersion, snapshot({ calls: [["first", "functions.delegate"]] }).sources.structureVersion);
  assert.notEqual(task.sources.structureVersion, snapshot({ calls: [["first", "append"]] }).sources.structureVersion);
});

test("structure guards transfer pagination positions only across equivalent cuts without granting old refs", () => {
  let current = fixture(); const window = new CanonicalWindow(() => current, undefined, seed), first = inspect(window);
  current = fixture({ text: "new body", input: "new args" }); const second = inspect(window);
  const expectedStructure = first.sources.structureVersion, revision = second.sources.revision;
  const source = data<WindowSourcePage>(window.read("r", { op: "sources", revision, before: 1, expectedStructure }));
  assert.equal(source.structureVersion, expectedStructure);
  const members = data<WindowMemberPage>(window.read("r", { op: "members", revision, sourceRef: source.items[0].ref, before: 1, expectedStructure }));
  const calls = data<WindowCallPage>(window.read("r", { op: "calls", revision, entityRef: members.items[0].ref, before: 1, expectedStructure }));
  assert.equal(calls.total, 2); assert.equal(calls.items.length, 1);
  assert.equal(data<WindowSegmentPage>(window.read("r", { op: "segments", revision, expectedStructure })).total, 0);
  const oldRef = window.read("r", { op: "members", revision, sourceRef: first.sources.items[0].ref, expectedStructure });
  assert.equal(oldRef.ok, false); if (!oldRef.ok) assert.equal(oldRef.error.code, "INVALID_REFERENCE");
  current = fixture({ calls: [["first", "delegate"], ["second", "read"]] }); const third = inspect(window), fresh = third.sources.revision;
  for (const query of [
    { op: "sources" }, { op: "segments" }, { op: "members", sourceRef: third.sources.items[0].ref }, { op: "calls", entityRef: third.members.items[0].ref },
  ]) {
    const reply = window.read("r", { ...query, revision: fresh, expectedStructure });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, "STALE");
  }
  const invalid = window.read("r", { op: "sources", revision: fresh, expectedStructure: {} });
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, "INVALID_REFERENCE");
  assert.equal(data<WindowSourcePage>(window.read("r", { op: "sources", revision: fresh })).total, 1, "a guard mismatch does not revoke the reader");
});

test("version framing preserves UTF-16 and distinguishes domains and concatenation boundaries", () => {
  const identity = createWindowIdentity(seed), version = (parts: string[]) => identity.version("body", parts);
  assert.notEqual(version(["ab", "c"]), version(["a", "bc"]));
  assert.notEqual(version(["\ud800"]), version(["\ud801"]));
  assert.notEqual(version(["\ud800"]), version(["\ufffd"]));
  assert.notEqual(version([""]), version([]));
  assert.notEqual(version(["body"]), identity.version("metadata", ["body"]));
  assert.equal(version(["😀\u0000"]), version(["😀\u0000"]));
});
