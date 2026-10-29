import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type CompactionEntry } from "@earendil-works/pi-coding-agent";
import { applyCompression, captureCompression, compressionDraft, prepareFullCompression } from "../src/server/compression-context.js";

const user = (manager: SessionManager, content: string) =>
  manager.appendMessage({ role: "user", content, timestamp: Date.now() });
const assistant = (manager: SessionManager) => manager.appendMessage({
  role: "assistant", content: [{ type: "text", text: "saved reply" }],
  api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const native = (firstKeptEntryId = "native-compaction"): CompactionEntry => ({
  type: "compaction", id: "native-compaction", parentId: null, timestamp: new Date().toISOString(),
  summary: "native summary", firstKeptEntryId, tokensBefore: 200,
  details: { readFiles: ["saved.txt"], modifiedFiles: [] },
});
const seeded = () => {
  const manager = SessionManager.inMemory();
  user(manager, "old history");
  assistant(manager);
  return manager;
};

test("full preparation handles one message and preserves only effective context plus previous metadata", () => {
  const settings = { enabled: false, reserveTokens: 1024, keepRecentTokens: 0 };
  const manager = SessionManager.inMemory();
  user(manager, "SINGLE_INPUT");
  const single = prepareFullCompression(manager.getBranch(), settings);
  assert.equal(single.messagesToSummarize.length, 1);
  assert.equal(single.isSplitTurn, false);
  manager.appendCompaction("PREVIOUS_SUMMARY", null, 100, { readFiles: ["previous-read"], modifiedFiles: ["previous-write"] });
  const current = user(manager, "BEFORE_EDIT");
  manager.appendContextEdit(current, { content: "AFTER_EDIT" });
  const full = prepareFullCompression(manager.getBranch(), settings);
  assert.equal(full.previousSummary, "PREVIOUS_SUMMARY");
  assert.match(JSON.stringify(full.messagesToSummarize), /AFTER_EDIT/);
  assert.doesNotMatch(JSON.stringify(full.messagesToSummarize), /SINGLE_INPUT|BEFORE_EDIT/);
  assert.deepEqual([...full.fileOps.read], ["previous-read"]);
  assert.deepEqual([...full.fileOps.edited], ["previous-write"]);
  assert.deepEqual(full.turnPrefixMessages, []);
});

test("compression retain-none appends natively, preserves new context and is durable/idempotent", (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-compression-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, root);
  user(manager, "old history");
  assistant(manager); // Pi flushes persistent sessions after the first assistant message.
  const snapshot = captureCompression(manager);
  const next = user(manager, "new context after snapshot");
  assistant(manager);
  const file = manager.getSessionFile()!;
  const before = readFileSync(file, "utf8");
  assert.equal(compressionDraft(manager, snapshot, native(), "job").firstKeptEntryId, next);
  assert.equal(applyCompression(manager, snapshot, native(), "job"), true);
  const after = readFileSync(file, "utf8");
  assert.ok(after.startsWith(before), "old entries remain byte-for-byte intact");
  const appended = after.slice(before.length).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(appended.length, 1);
  assert.equal(appended[0].type, "compaction");
  assert.equal(appended[0].firstKeptEntryId, next);
  assert.deepEqual(appended[0].details.readFiles, ["saved.txt"]);
  const reopened = SessionManager.open(file);
  const context = JSON.stringify(reopened.buildSessionContext().messages);
  assert.match(context, /native summary/);
  assert.match(context, /new context after snapshot/);
  assert.doesNotMatch(context, /old history/);
  assert.equal(applyCompression(reopened, snapshot, native(), "job"), false);
  assert.equal(readFileSync(file, "utf8"), after);
});

test("compression retain-none without a tail uses pi's self-id boundary", () => {
  const manager = seeded(), snapshot = captureCompression(manager);
  assert.equal(compressionDraft(manager, snapshot, native(), "job").firstKeptEntryId, null);
  applyCompression(manager, snapshot, native(), "job");
  const entry = manager.getLeafEntry() as CompactionEntry;
  assert.equal(entry.firstKeptEntryId, entry.id);
  assert.doesNotMatch(JSON.stringify(manager.buildSessionContext().messages), /old history|saved reply/);
});

test("compression preserves a native retained range and later custom input", () => {
  const manager = seeded();
  const kept = user(manager, "retained user");
  assistant(manager);
  const snapshot = captureCompression(manager);
  manager.appendCustomMessageEntry("axiom-append", "new custom input", true);
  applyCompression(manager, snapshot, native(kept), "job");
  const context = JSON.stringify(manager.buildSessionContext().messages);
  assert.match(context, /native summary/);
  assert.match(context, /retained user/);
  assert.match(context, /new custom input/);
  assert.doesNotMatch(context, /old history/);
});

test("compression snapshots stay detached; changed bytes are accepted but different sessions are not", () => {
  const manager = seeded(), snapshot = captureCompression(manager);
  const original = JSON.stringify(manager.getBranch());
  snapshot.entries[0].timestamp = "changed";
  snapshot.header.timestamp = "changed header metadata";
  assert.equal(JSON.stringify(manager.getBranch()), original, "snapshot must not alias live entries");
  assert.doesNotThrow(() => compressionDraft(manager, snapshot, native(), "job"));
  assert.throws(() => applyCompression(seeded(), captureCompression(manager), native(), "job"));
  assert.equal(JSON.stringify(manager.getBranch()), original);
});

test("compression directly applies after branch changes, host compactions and context edits", () => {
  for (const change of ["branch", "compaction", "context_edit", "branch_summary"] as const) {
    const manager = seeded(), snapshot = captureCompression(manager);
    if (change === "branch") manager.branch(snapshot.entries[0].id);
    else if (change === "compaction") manager.appendCompaction("other summary", null, 10, { axiomCompressionId: "other-job" });
    else if (change === "context_edit") manager.appendContextEdit(snapshot.entries[0].id, { content: "edited context" });
    else manager.branchWithSummary(manager.getLeafId(), "branch summary");
    user(manager, `new input after ${change}`);
    const before = JSON.stringify(manager.getEntries());
    assert.equal(applyCompression(manager, snapshot, native(), "job"), true, change);
    assert.equal(JSON.stringify(manager.getEntries().slice(0, -1)), before, "only a native compaction is appended");
    const context = JSON.stringify(manager.buildSessionProjection().messages);
    assert.match(context, /native summary/);
    assert.ok(context.includes(`new input after ${change}`), change);
  }
});

test("a late host summary cannot replace a newer Pi native safety compaction", () => {
  const manager = seeded(), snapshot = captureCompression(manager);
  const kept = user(manager, "old retained input");
  manager.appendCompaction("PI_SAFETY_SUMMARY", null, 10);
  user(manager, "new input after native fallback");
  const before = JSON.stringify(manager.getEntries());
  assert.throws(() => applyCompression(manager, snapshot, native(), "late-job"), /Pi 原生压缩已更新上下文/);
  assert.equal(JSON.stringify(manager.getEntries()), before);
  assert.match(JSON.stringify(manager.buildSessionProjection().messages), /PI_SAFETY_SUMMARY/);
  assert.doesNotMatch(JSON.stringify(manager.buildSessionProjection().messages), /old retained input/);
  assert.ok(manager.getEntry(kept), "raw history is not deleted");
  // A fresh host snapshot taken after the safety compaction remains valid.
  applyCompression(manager, captureCompression(manager), native(), "fresh-job");
  assert.match(JSON.stringify(manager.buildSessionProjection().messages), /native summary/);
});

test("compression preserves recovery edits and does not revive a failed response in the new tail", () => {
  const manager = seeded(), snapshot = captureCompression(manager);
  assistant(manager);
  const failed = manager.getLeafEntry()!;
  if (failed.type !== "message" || failed.message.role !== "assistant") throw Error();
  const id = manager.appendMessage({ ...failed.message, stopReason: "error",
    content: [{ type: "text", text: "OMITTED_FAILED_RESPONSE" }] });
  manager.appendContextEdit(id, null);
  const retry = user(manager, "successful retry input");
  assistant(manager);
  applyCompression(manager, snapshot, native(), "job");
  const context = JSON.stringify(manager.buildSessionProjection().messages);
  assert.match(context, /successful retry input/);
  assert.doesNotMatch(context, /OMITTED_FAILED_RESPONSE/);
  assert.ok(manager.getEntry(retry), "original tail entry is retained without copying");
});

test("compression uses entry identities when a branch becomes shorter or loses the native retained start", () => {
  for (const retainNone of [true, false]) {
    const manager = seeded(), root = manager.getBranch()[0].id;
    const kept = user(manager, "no longer on current branch");
    assistant(manager); user(manager, "more old history"); assistant(manager);
    const snapshot = captureCompression(manager);
    manager.branch(root);
    const next = user(manager, "short branch new input");
    assert.ok(manager.getBranch().length < snapshot.entries.length);
    assert.equal(compressionDraft(manager, snapshot, native(retainNone ? undefined : kept), "job").firstKeptEntryId, next);
    applyCompression(manager, snapshot, native(retainNone ? undefined : kept), "job");
    const context = JSON.stringify(manager.buildSessionProjection().messages);
    assert.match(context, /short branch new input/);
    assert.doesNotMatch(context, /no longer on current branch|more old history|old history/);
  }
});

test("compression accepts a branch with no snapshot IDs and retains its entire new history", () => {
  const manager = seeded(), snapshot = captureCompression(manager);
  manager.resetLeaf();
  const next = user(manager, "unrelated new branch");
  assistant(manager);
  assert.equal(compressionDraft(manager, snapshot, native(), "job").firstKeptEntryId, next);
  applyCompression(manager, snapshot, native(), "job");
  assert.match(JSON.stringify(manager.buildSessionProjection().messages), /unrelated new branch/);
});

test("compression rejects unknown retained ids and tool-result cut points", () => {
  const manager = seeded(), snapshot = captureCompression(manager);
  assert.throws(() => applyCompression(manager, snapshot, native("missing"), "job"));
  const result = manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read",
    content: [{ type: "text", text: "result" }], isError: false, timestamp: Date.now() });
  const incomplete = captureCompression(manager);
  const before = JSON.stringify(manager.getEntries());
  assert.throws(() => applyCompression(manager, incomplete, native(result), "job"));
  assert.equal(JSON.stringify(manager.getEntries()), before);
  assert.doesNotThrow(() => applyCompression(manager, incomplete, native(), "job"),
    "an existing orphan result can be summarized; it is not an active tool");
});

for (const stopReason of ["error", "aborted", "toolUse"] as const) {
  test(`fresh compression accepts historical ${stopReason} with a missing tool result`, () => {
    const manager = seeded();
    const message = manager.getLeafEntry()!;
    assert.equal(message.type, "message");
    if (message.type !== "message" || message.message.role !== "assistant") throw Error();
    manager.appendMessage({ ...message.message, stopReason,
      content: [{ type: "toolCall", id: "old-incomplete-call", name: "write", arguments: {} }] });
    manager.appendCustomMessageEntry("axiom-append", "new instruction after interruption", true);
    assistant(manager);
    const snapshot = captureCompression(manager);
    const retained = user(manager, "new input after snapshot");
    assistant(manager);
    const before = JSON.stringify(manager.getEntries());
    assert.equal(compressionDraft(manager, snapshot, native(), "fresh-job").firstKeptEntryId, retained);
    applyCompression(manager, snapshot, native(), "fresh-job");
    assert.equal(JSON.stringify(manager.getEntries().slice(0, -1)), before, "raw history is unchanged");
    assert.match(JSON.stringify(manager.buildSessionProjection().messages), /native summary|new input after snapshot/);
    assert.doesNotMatch(JSON.stringify(manager.buildSessionProjection().messages), /old-incomplete-call/);
  });
}

test("compression still refuses to split a known tool pair through intervening metadata", () => {
  const manager = seeded();
  const message = manager.getLeafEntry()!;
  if (message.type !== "message" || message.message.role !== "assistant") throw Error();
  manager.appendMessage({ ...message.message, stopReason: "toolUse",
    content: [{ type: "toolCall", id: "paired", name: "read", arguments: {} }] });
  const metadata = manager.appendCustomEntry("fixture", {});
  manager.appendMessage({ role: "toolResult", toolCallId: "paired", toolName: "read",
    content: [{ type: "text", text: "result" }], isError: false, timestamp: Date.now() });
  const snapshot = captureCompression(manager), before = JSON.stringify(manager.getEntries());
  assert.throws(() => applyCompression(manager, snapshot, native(metadata), "job"));
  assert.equal(JSON.stringify(manager.getEntries()), before);
});
