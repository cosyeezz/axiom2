import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PersistedInputCursor } from "../src/server/agents/persisted-inputs.js";

test("failed message acknowledgement leaves both message and input confirmations retryable", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-persisted-ack-"));
  try {
    const file = join(root, "session.jsonl"), cursor = new PersistedInputCursor();
    writeFileSync(file, notice("result-input"));
    assert.throws(() => cursor.read(file, () => { throw Error("IPC failed"); }), /IPC failed/);
    let messages: string[] = [];
    assert.deepEqual(cursor.read(file, (ids) => { messages = ids; }), { ids: ["result-input"], notifications: ["result-input"] });
    assert.deepEqual(messages, ["input-result-input"]);
    assert.deepEqual(cursor.read(file).ids, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const notice = (id: string, content = "notice") => JSON.stringify({ type: "custom_message", customType: "axiom-result", details: { axiomInput: id }, content }) + "\n";

test("SDK write failure leaves a memory entry but cannot produce a persisted input acknowledgement", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-persisted-input-"));
  try {
    const manager = SessionManager.create(root, root), cursor = new PersistedInputCursor();
    manager.appendMessage({ role: "user", content: "initial", timestamp: Date.now() });
    const file = manager.getSessionFile()!;
    cursor.read(file);
    const persist = (manager as any)._persist;
    (manager as any)._persist = () => { throw Object.assign(Error("disk full"), { code: "ENOSPC" }); };
    assert.throws(() => manager.appendCustomMessageEntry("axiom-result", "not saved", true, { axiomInput: "lost" }), /disk full/);
    const entry = manager.getEntries().at(-1)!;
    assert.equal(entry.type, "custom_message", "the actual SDK mutates its index before persistence fails");
    assert.deepEqual(cursor.read(file), { ids: [], notifications: [] });
    (manager as any)._persist = persist;
    persist.call(manager, entry);
    assert.deepEqual(cursor.read(file), { ids: ["lost"], notifications: ["lost"] });
    assert.deepEqual(cursor.read(file), { ids: [], notifications: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("disk cursor waits for complete UTF-8 JSONL records and rolls back on malformed input", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-persisted-tail-"));
  try {
    const file = join(root, "session.jsonl"), cursor = new PersistedInputCursor();
    assert.deepEqual(cursor.read(file).ids, []);
    const encoded = Buffer.from(notice("中文输入", "证据".repeat(30000)));
    const split = encoded.indexOf(Buffer.from("中文")) + 1;
    writeFileSync(file, encoded.subarray(0, split));
    assert.deepEqual(cursor.read(file).ids, []);
    appendFileSync(file, encoded.subarray(split, encoded.length - 1));
    assert.deepEqual(cursor.read(file).ids, [], "even valid JSON awaits the durable line terminator");
    appendFileSync(file, "\n");
    assert.deepEqual(cursor.read(file).ids, ["中文输入"]);
    appendFileSync(file, notice("valid-before-error") + "{broken}\n");
    assert.throws(() => cursor.read(file));
    writeFileSync(file, Buffer.concat([encoded, Buffer.from(notice("valid-before-error") + notice("repaired"))]));
    assert.deepEqual(cursor.read(file).ids, ["valid-before-error", "repaired"], "a failed read must not consume confirmations from the valid prefix");
    assert.deepEqual(cursor.read(file).ids, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("disk cursor detects history rewrites and reads initial user input identities", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-persisted-rewrite-"));
  try {
    const file = join(root, "session.jsonl"), cursor = new PersistedInputCursor();
    writeFileSync(file, notice("old"));
    assert.deepEqual(cursor.read(file).ids, ["old"]);
    writeFileSync(file, notice("replacement", "a".repeat(200)));
    assert.deepEqual(cursor.read(file).ids, ["replacement"], "same-inode rewrites must invalidate the byte checkpoint");
    writeFileSync(file, JSON.stringify({ type: "message", message: { role: "user", axiomInputIds: ["initial", 42] } }) + "\n");
    assert.deepEqual(cursor.read(file), { ids: ["initial"], notifications: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
