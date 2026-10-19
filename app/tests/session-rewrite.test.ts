import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { editableMessage, assertRewrite, rewriteBranch, discardedResults } from "../src/server/session-rewrite.js";
import { transcriptMessages } from "../src/server/transcript.js";
import { attachmentPrompt } from "../src/shared/protocol.js";
import { imageContent } from "../src/server/images.js";
import { taskBudgetIntro } from "../src/server/task-budget.js";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
const reply = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 1 }) as any;

test("rewrite crosses compaction, persists a new leaf, and retains raw history without abandoned context", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-rewrite-tree-"));
  try {
    const manager = SessionManager.create(root, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "keep first", timestamp: 1 });
    manager.appendMessage(reply("keep answer"));
    manager.appendMessage({ role: "user", content: "replace this", timestamp: 2, axiomId: "display-id" } as any);
    manager.appendMessage(reply("discard answer"));
    manager.appendCompaction("discard summary including old answer", null, 10000);
    manager.appendMessage({ role: "user", content: "discard later user", timestamp: 3 });
    manager.appendMessage(reply("discard later answer"));
    const file = manager.getSessionFile()!, before = readFileSync(file, "utf8");
    const source = editableMessage(manager, "display-id");
    assert.equal(source.draft.text, "replace this");
    assert.equal(readFileSync(file, "utf8"), before, "opening the editor never changes history");
    rewriteBranch(manager, source, "rewrite-request", ["old-result"]);
    const reopened = SessionManager.open(file);
    assert.deepEqual(transcriptMessages(reopened).map((m) => m.text), ["keep first", "keep answer"]);
    assert.doesNotMatch(JSON.stringify(reopened.buildSessionContext().messages), /discard|replace this|old-result/);
    assert.ok(readFileSync(file, "utf8").startsWith(before), "raw JSONL is append-only");
    assert.deepEqual([...discardedResults(reopened)], ["old-result"]);
    assert.throws(() => editableMessage(reopened, "display-id"), { code: "NOT_EDITABLE" });
    assert.throws(() => assertRewrite(reopened, source), { code: "REWRITE_CONFLICT" });
    reopened.appendMessage({ role: "user", content: "new version", timestamp: 4 });
    assert.deepEqual(transcriptMessages(SessionManager.open(file), true).map((m) => m.text), ["keep first", "keep answer", "new version"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rewriting the first/current user leaf persists empty context and supports a later root", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-rewrite-root-"));
  try {
    const manager = SessionManager.create(root, join(root, "sessions"));
    const id = manager.appendMessage({ role: "user", content: "only input", timestamp: 1 });
    rewriteBranch(manager, editableMessage(manager, id), "root-rewrite", []);
    const reopened = SessionManager.open(manager.getSessionFile()!);
    assert.deepEqual(reopened.buildSessionContext().messages, []);
    reopened.appendMessage({ role: "user", content: "replacement", timestamp: 2 });
    assert.deepEqual(transcriptMessages(SessionManager.open(manager.getSessionFile()!)).map((m) => m.text), ["replacement"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("editable inputs recover path references, inline images and steering identity, reject notices and stale revisions", () => {
  const manager = SessionManager.inMemory();
  const attachments = [{ id: "file4", name: "source.ts", kind: "file" as const, path: "/project/source.ts", text: "" },
    { id: "imag7", name: "diagram.png", kind: "image" as const, path: "/project/diagram.png", text: "" }];
  const images = [{ id: "imag2", name: "paste.png", mimeType: "image/png", data: png }];
  manager.appendMessage({ role: "user", content: imageContent(attachmentPrompt("check [file4] [imag7] [imag2]", attachments), images),
    axiomId: "image-user", axiomImages: images.map(({ data: _, ...image }) => image), timestamp: 1 } as any);
  const image = editableMessage(manager, "image-user");
  assert.deepEqual(image.draft, { text: "check [file4] [imag7] [imag2]", attachment: null, attachments, images });
  const native = manager.appendCustomMessageEntry("axiom-append", "steering", true, { axiomInput: "steer-id" });
  const source = editableMessage(manager, "input-steer-id");
  assert.equal(source.draft.text, "steering");
  assert.equal(assertRewrite(manager, source).entryId, native);
  const notice = manager.appendCustomMessageEntry("axiom-result", "{}", true, { axiomInput: "notice-id" });
  assert.throws(() => editableMessage(manager, "input-notice-id"), { code: "NOT_EDITABLE" });
  assert.throws(() => editableMessage(manager, notice), { code: "NOT_EDITABLE" });
  assert.throws(() => assertRewrite(manager, source), { code: "REWRITE_CONFLICT" });
  const updated = editableMessage(manager, "input-steer-id");
  rewriteBranch(manager, updated, "steer-rewrite", []);
  assert.deepEqual(transcriptMessages(manager).map((m) => m.id), ["image-user"]);
});

test("legacy inline attachments and host budgets recover without charging payloads to user text", () => {
  const manager = SessionManager.inMemory();
  const attachments = [{ name: "large.txt", text: "x".repeat(13000) }];
  const budget = { workMs: 600000, elapsedMs: 12, deadlineAt: 1800000000000 };
  const body = attachmentPrompt("original input", attachments);
  manager.appendMessage({ role: "user", content: taskBudgetIntro(budget) + "\n\n" + body,
    timestamp: 1, axiomId: "legacy", axiomRunId: "legacy-run", axiomInputIds: ["legacy-input"] } as any);
  const source = editableMessage(manager, "legacy");
  assert.equal(source.draft.text, "original input");
  assert.deepEqual(source.draft.attachments, attachments);
  assert.equal(attachmentPrompt(source.draft.text, source.draft.attachments!), body);
  // New task records carry an independent budget, so a literal prefix is user text.
  manager.appendCustomMessageEntry("axiom-budget", taskBudgetIntro(budget), false, { runId: "new-run" });
  manager.appendMessage({ role: "user", content: taskBudgetIntro(budget) + "\n\nuser quotation", timestamp: 2,
    axiomId: "literal", axiomRunId: "new-run", axiomInputIds: ["new-input"] } as any);
  assert.equal(editableMessage(manager, "literal").draft.text, taskBudgetIntro(budget) + "\n\nuser quotation");
});
