import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, openSync, ftruncateSync, closeSync, symlinkSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentViews } from "../src/server/agents/views.js";
import { Store } from "../src/server/storage.js";
import { transcriptHeader, openTranscript } from "../src/server/transcript.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { TaskRecords } from "../src/server/tasks/records.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-loading-")), cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const create = () => {
    const session = store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const manager = SessionManager.create(cwd, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "saved", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "saved response" }], timestamp: 2, stopReason: "stop" } as any);
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
    return { scope: { workspaceId: workspace.id, sessionId: session.id }, manager };
  };
  return { root, cwd, store, create, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("header reads stay bounded for 10/50/200 MiB bodies and reject malformed ownership", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-header-")), file = join(root, "session.jsonl");
  try {
    for (const size of [10, 50, 200]) {
      writeFileSync(file, JSON.stringify({ type: "session", cwd: root }) + "\n");
      const fd = openSync(file, "r+"); ftruncateSync(fd, size * 1024 * 1024); closeSync(fd);
      assert.equal(transcriptHeader(file).bytesRead, 1024);
    }
    writeFileSync(file, JSON.stringify({ type: "session", cwd: root })); assert.throws(() => transcriptHeader(file), /newline/);
    writeFileSync(file, "x".repeat(65536)); assert.throws(() => transcriptHeader(file), /64 KiB/);
    writeFileSync(file, JSON.stringify({ type: "session", cwd: join(root, "other") }) + "\n");
    assert.throws(() => openTranscript(file, root), { code: "SESSION_FILE_ERROR" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("transcript ownership accepts a workspace alias but rejects a different directory", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-transcript-alias-"));
  const cwd = join(root, "project"), alias = join(root, "alias"), other = join(root, "other");
  mkdirSync(cwd); mkdirSync(other);
  symlinkSync(cwd, alias, process.platform === "win32" ? "junction" : "dir");
  try {
    const manager = SessionManager.create(alias, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "saved through alias", timestamp: 1 });
    const file = manager.getSessionFile()!;
    assert.equal(openTranscript(file, cwd).getSessionId(), manager.getSessionId());
    assert.throws(() => openTranscript(file, other), { code: "SESSION_FILE_ERROR" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("transcript ownership accepts Windows short names in either cwd position without rewriting history", { skip: process.platform !== "win32" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-transcript-short-"));
  try {
    const native = realpathSync.native(root);
    if (realpathSync(root) === native) {
      t.skip("TEMP has no Windows short-name alias; this case requires an 8.3 TEMP directory");
      return;
    }
    const other = join(native, "other"); mkdirSync(other);
    for (const [saved, requested] of [[root, native], [native, root]]) {
      const manager = SessionManager.create(saved, join(root, "sessions"));
      manager.appendMessage({ role: "user", content: "saved through a Windows alias", timestamp: 1 });
      const file = manager.getSessionFile()!, before = readFileSync(file);
      assert.equal(openTranscript(file, requested).getSessionId(), manager.getSessionId());
      assert.deepEqual(readFileSync(file), before, "opening an alias must not rewrite the saved JSONL");
      assert.throws(() => openTranscript(file, other), { code: "SESSION_FILE_ERROR" });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("six background sessions never cold-read display history and retain terminal deltas until persistence", (t) => {
  const f = fixture(); t.after(f.close);
  const sessions = Array.from({ length: 6 }, f.create);
  const spy = t.mock.method(SessionManager, "open");
  const views = new AgentViews(f.store, () => assert.fail("unobserved display should not publish"), () => false);
  for (let i = 0; i < 60; i++) {
    const { scope } = sessions[i % 6];
    views.messageChanged(scope, { id: "pending", role: "assistant", text: `delta ${i}`, streaming: true }); views.flush(scope);
  }
  assert.equal(spy.mock.callCount(), 0); assert.equal(views.messages.size, 0);
  const { scope, manager } = sessions[0];
  views.messageChanged(scope, { id: "pending", role: "assistant", text: "terminal before disk", streaming: false, status: "completed" }); views.flush(scope);
  assert.equal(views.transcript(scope).get("pending")?.text, "terminal before disk");
  views.messages.delete(scope.sessionId);
  assert.equal(views.transcript(scope).get("pending")?.text, "terminal before disk", "eviction cannot discard pre-persistence terminal data");
  manager.appendMessage({ role: "assistant", axiomId: "pending", content: [{ type: "text", text: "terminal before disk" }], stopReason: "stop", timestamp: 3 } as any);
  views.persisted(scope, ["pending"]); views.messages.delete(scope.sessionId);
  assert.equal(views.transcript(scope).get("pending")?.text, "terminal before disk");
});
test("archive-only edits advance context revision, full reads share a same-source projection, rebuilds cannot resurrect excluded messages", (t) => {
  const f = fixture(); t.after(f.close); const { scope, manager } = f.create();
  const archive = manager.appendMessage({ role: "user", content: "archive", timestamp: 3 });
  manager.appendCompaction("summary", null, 1000);
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "current" }], stopReason: "stop", timestamp: 4 } as any);
  const views = new AgentViews(f.store, () => {}, () => false);
  const first = views.thread(scope);
  const spy = t.mock.method(SessionManager, "open");
  assert.equal(views.message(scope, archive, true)?.text, "archive");
  assert.equal(views.message(scope, archive, true)?.text, "archive"); assert.equal(spy.mock.callCount(), 1);
  manager.appendContextEdit(archive, { content: "replacement" }); views.refresh(scope);
  const second = views.thread(scope);
  assert.deepEqual(first.ids, second.ids); assert.deepEqual(first.groups, second.groups);
  assert.ok(second.contextRevision! > first.contextRevision!);
  assert.equal(views.message(scope, archive, true)?.text, "replacement");
  manager.appendContextEdit(archive, null); views.refresh(scope);
  assert.equal(views.original(scope).has(archive), false);
});
test("target presence uses indexed queries and batched task lists preserve receipt/result order", (t) => {
  const f = fixture(); t.after(f.close); const { scope } = f.create();
  const records = new TaskRecords(f.store);
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(...records.create(scope, `anchor${i}`, "context", [{ task: `task${i}`, role: "" }], { provider: "fixture", id: "fixture", thinking: "off" }).taskIds);
  for (const [i, id] of ids.entries()) {
    f.store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,NULL,'delivered',NULL,?)").run(`a${i}`, id, 1);
    f.store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,NULL,'failed','failure',?)").run(`b${i}`, id, 1);
  }
  const list = records.list(scope);
  assert.equal(list.tasks.length, 10);
  list.tasks.forEach((task, i) => {
    assert.deepEqual(task.inputs?.slice(0, 2).map((input) => input.inputId), [`a${i}`, `b${i}`]);
    assert.equal(task.inputs?.length, 3, "initial queued input remains alongside delivered receipts");
    assert.equal(task.inputs?.[2].state, "queued");
  });
  const plan = f.store.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM runs WHERE sessionId=? ORDER BY startedAt DESC,rowid DESC LIMIT 1").all(scope.sessionId);
  assert.ok(plan.some((row) => String(row.detail).includes("runs_session_started")));
  assert.ok(!plan.some((row) => String(row.detail).includes("TEMP B-TREE")));
  const summaries = t.mock.method(f.store, "sessions", () => { throw Error("must not query a whole workspace"); });
  f.store.viewSession(scope); f.store.leaveSession(scope); assert.equal(summaries.mock.callCount(), 0);
});
