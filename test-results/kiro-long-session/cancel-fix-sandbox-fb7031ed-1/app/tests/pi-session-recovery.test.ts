import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { openTranscript, transcriptMessages } from "../src/server/transcript.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

test("pi owns transcript recovery, including a partial tail; acceptance sidecars are not messages", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-pi-recovery-"));
  try {
    const manager = SessionManager.create(root, root);
    manager.appendMessage({ role: "user", content: "persisted by pi", timestamp: Date.now() });
    manager.appendCustomEntry("axiom-request", { runId: "legacy", text: "not submitted to pi" });
    const file = manager.getSessionFile()!;
    appendFileSync(file, '{"type":"message"');
    const restored = openTranscript(file, root);
    assert.equal(restored.getSessionFile(), file);
    assert.deepEqual(transcriptMessages(restored).map((message) => message.text), ["persisted by pi"]);
    const other = join(root, "other"); mkdirSync(other);
    assert.throws(() => openTranscript(file, other), { code: "SESSION_FILE_ERROR" });
    assert.throws(() => openTranscript(join(root, "missing.jsonl"), root), { code: "SESSION_FILE_ERROR" });
    writeFileSync(file, "broken header\n");
    assert.throws(() => openTranscript(file, root), { code: "SESSION_FILE_ERROR" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy cleanup columns do not survive upgrade or block interrupted sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-run-upgrade-"));
  let store = new Store(root);
  try {
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    store.db.exec("ALTER TABLE runs ADD COLUMN cleanup TEXT NOT NULL DEFAULT 'pending'");
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,cleanup) VALUES('legacy',?,'running','{}',1,'unconfirmed')").run(session.id);
    store.close();
    store = new Store(root);
    assert.equal(store.db.prepare("PRAGMA table_info(runs)").all().some((column) => column.name === "cleanup"), false);
    assert.equal(store.db.prepare("SELECT status FROM runs WHERE id='legacy'").get()!.status, "interrupted");
    assert.equal(store.session(workspace.id, session.id).id, session.id);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
