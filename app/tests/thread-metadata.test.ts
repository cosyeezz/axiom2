import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentViews } from "../src/server/agents/views.js";
import { Store } from "../src/server/storage.js";
import type { ChatMessage, ThreadMetadata } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

function fixture(t: TestContext, messages?: ChatMessage[]) {
  const root = mkdtempSync(join(tmpdir(), "axiom-thread-metadata-")), cwd = join(root, "project");
  mkdirSync(cwd);
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  const events: string[] = [];
  const views = new AgentViews(store, scope => events.push(scope), () => false);
  if (messages) views.messages.set(scope.sessionId, new Map(messages.map(message => [message.id, message])));
  t.after(() => { views.flush(scope); store.close(); rmSync(root, { recursive: true, force: true }); });
  const bind = (file: string) => store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, file);
  return { root, cwd, store, scope, views, events, bind };
}
const assistant = (text: string, timestamp = 2) => ({
  role: "assistant" as const, content: [{ type: "text" as const, text }],
  api: "openai-completions" as const, provider: "synthetic", model: "synthetic-model", stopReason: "stop" as const, timestamp,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
function native(f: ReturnType<typeof fixture>) {
  const manager = SessionManager.create(f.cwd, join(f.root, "native"));
  const userId = manager.appendMessage({ role: "user", content: "saved user", timestamp: 1 });
  const assistantId = manager.appendMessage(assistant("saved answer"));
  const file = manager.getSessionFile(); assert.ok(file && existsSync(file));
  f.bind(file);
  return { manager, file, userId, assistantId };
}
function source(file: string) {
  const { dev, ino, size, mtimeNs, ctimeNs } = statSync(file, { bigint: true });
  return { bytes: readFileSync(file), stat: { dev, ino, size, mtimeNs, ctimeNs } };
}
const changes = (store: Store) => Number(store.db.prepare("SELECT total_changes() AS n").get()!.n);
const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
function narrow(metadata: ThreadMetadata) {
  assert.deepEqual(Object.keys(metadata).sort(), ["contextRevision", "hasMessages"], "no IDs, groups, bodies or result-task lists");
  assert.ok(encodedBytes(metadata) < 100);
}

test("thread metadata has constant size and never builds or enumerates a cached layout", t => {
  const sizes: number[] = [];
  for (const count of [0, 20, 2000]) {
    const messages: ChatMessage[] = Array.from({ length: count }, (_, i) => Object.freeze<ChatMessage>({
      id: `message-${i}`, role: "user", text: `body-${i}:` + "x".repeat(1024),
    }));
    const f = fixture(t, messages), projection = f.views.messages.peek(f.scope.sessionId)!;
    const legacy = f.views.thread(f.scope);
    assert.equal(legacy.ids.length, count);
    if (count === 2000) assert.ok(encodedBytes(legacy) > 100_000, "positive control: the original thread really contains its complete catalogue");
    const thread = t.mock.method(f.views, "thread", () => { throw Error("metadata must not request the full thread"); });
    const iterations = ["values", "keys", "entries", "forEach", Symbol.iterator] as const;
    const guards = iterations.map(method => t.mock.method(projection, method, () => { throw Error("metadata must not enumerate message bodies or IDs"); }));
    const prepare = f.store.db.prepare;
    const sql: string[] = [];
    const queries = t.mock.method(f.store.db, "prepare", (statement: string) => {
      sql.push(statement); return prepare.call(f.store.db, statement);
    });
    const before = changes(f.store);
    const metadata = f.views.threadMetadata(f.scope);
    assert.deepEqual(metadata, { contextRevision: 0, hasMessages: count > 0 });
    narrow(metadata); sizes.push(encodedBytes(metadata));
    assert.equal(changes(f.store), before, "metadata must not mutate the database");
    assert.ok(sql.every(statement => !/\b(runs|session_results|task_results)\b/i.test(statement)), "cached metadata does not load execution or result catalogues");
    assert.equal(thread.mock.callCount(), 0);
    assert.ok(guards.every(guard => guard.mock.callCount() === 0));
    queries.mock.restore(); guards.forEach(guard => guard.mock.restore()); thread.mock.restore();
    assert.strictEqual(f.views.messages.peek(f.scope.sessionId), projection);
    messages.forEach(message => assert.strictEqual(projection.get(message.id), message));
    assert.deepEqual(f.views.thread(f.scope), legacy, "legacy callers still receive the complete unchanged context");
  }
  assert.equal(sizes[1], sizes[2], "metadata does not scale with the message catalogue");
});

test("thread metadata distinguishes an empty fileless context from a tool-only context", t => {
  const f = fixture(t), before = changes(f.store);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: false });
  const tool: ChatMessage = { id: "tool-only", role: "toolResult", text: "tool output" };
  f.views.messages.set(f.scope.sessionId, new Map([[tool.id, tool]]));
  const legacy = f.views.thread(f.scope);
  assert.equal(legacy.ids.length, 1); assert.deepEqual(legacy.groups, []);
  assert.equal(f.views.messageCount(f.scope, { cachedOnly: true }), 0, "title message counts are not the current-context presence predicate");
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: true });
  assert.equal(changes(f.store), before);
});

test("thread metadata preserves existing delta, delivery, refresh and forget revision semantics", t => {
  const draft: ChatMessage = { id: "reply", role: "assistant", text: "draft", phase: "final_answer", status: "running", streaming: true };
  const f = fixture(t, [draft]);
  const initial = f.views.threadMetadata(f.scope);
  f.views.messageChanged(f.scope, { ...draft, text: "draft plus a delta" });
  assert.deepEqual(f.views.threadMetadata(f.scope), initial, "body tokens are not a new context revision");
  f.views.messageChanged(f.scope, { ...draft, text: "delivered", status: "completed", streaming: false });
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: initial.contextRevision + 1, hasMessages: true });
  assert.equal(f.views.threadMetadata(f.scope).contextRevision, f.views.thread(f.scope).contextRevision);
  f.views.refresh(f.scope);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: initial.contextRevision + 2, hasMessages: false });
  f.views.forget(f.scope);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: false });
});

test("thread metadata validates ownership before consulting a cached projection or swallowing errors", t => {
  const f = fixture(t, [{ id: "cached", role: "user", text: "private" }]);
  const other = join(f.root, "other"); mkdirSync(other);
  const workspace = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: other, authorized: true } }) as Workspace;
  const transcript = t.mock.method(f.views, "transcript", () => { throw Error("not an ownership error"); });
  assert.throws(() => f.views.threadMetadata({ ...f.scope, workspaceId: workspace.id }), { code: "SCOPE_MISMATCH" });
  assert.throws(() => f.views.threadMetadata({ ...f.scope, sessionId: randomUUID() }), { code: "SCOPE_MISMATCH" });
  f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(f.scope.sessionId);
  assert.throws(() => f.views.threadMetadata(f.scope), { code: "SCOPE_MISMATCH" });
  assert.equal(transcript.mock.callCount(), 0);
});

test("thread metadata treats an unreadable source as unknown and bounds diagnostic errors", t => {
  const f = fixture(t), missing = join(f.root, "missing.jsonl"); f.bind(missing);
  const before = changes(f.store), metadata = f.views.threadMetadata(f.scope);
  assert.equal(metadata.hasMessages, null); assert.equal(metadata.contextRevision, 0); assert.ok(metadata.error);
  assert.ok(!existsSync(missing)); assert.equal(f.views.messages.has(f.scope.sessionId), false);
  assert.equal(changes(f.store), before);
  t.mock.method(f.views, "transcript", () => { throw Error("\0".repeat(20_000)); });
  const long = f.views.threadMetadata(f.scope);
  assert.equal(long.hasMessages, null); assert.equal(long.error?.length, 512); assert.ok(long.error?.endsWith("..."));
  assert.ok(encodedBytes(long) < 4096, "JSON escaping must not turn an error into an unbounded metadata payload");
});

test("thread metadata reads partial-tail native files through the readonly parser without repairing them", t => {
  const f = fixture(t), n = native(f);
  writeFileSync(n.file, readFileSync(n.file, "utf8").replace(/\n$/, "") + '\n{"type":"message","id":"unfinished"');
  const before = source(n.file), dbBefore = changes(f.store);
  const parser = t.mock.method(SessionManager, "inMemory"), writableOpen = t.mock.method(SessionManager, "open");
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: true });
  assert.deepEqual(f.views.thread(f.scope).ids, [n.userId, n.assistantId]);
  f.views.messages.delete(f.scope.sessionId);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: true });
  assert.equal(parser.mock.callCount(), 2); assert.equal(writableOpen.mock.callCount(), 0);
  assert.deepEqual(source(n.file), before, "bytes, inode, size, mtime and ctime remain unchanged (atime is not a write-repair check)");
  assert.equal(changes(f.store), dbBefore);
});

test("thread metadata follows same-length context edits and explicit removal without stale presence", t => {
  const f = fixture(t), n = native(f);
  const first = f.views.threadMetadata(f.scope), ids = f.views.thread(f.scope).ids;
  n.manager.appendContextEdit(n.userId, { content: "other user" });
  f.views.refresh(f.scope);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: first.contextRevision + 1, hasMessages: true });
  assert.deepEqual(f.views.thread(f.scope).ids, ids);
  assert.equal(f.views.message(f.scope, n.userId)?.text, "other user");
  n.manager.appendContextEdit(n.userId, null); n.manager.appendContextEdit(n.assistantId, null);
  f.views.refresh(f.scope);
  const before = source(n.file), dbBefore = changes(f.store);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: first.contextRevision + 2, hasMessages: false });
  assert.deepEqual(f.views.thread(f.scope).ids, []);
  assert.deepEqual(source(n.file), before); assert.equal(changes(f.store), dbBefore);
});

test("thread metadata ignores abandoned physical branches rather than counting every native record", t => {
  const f = fixture(t), n = native(f);
  n.manager.resetLeaf(); n.manager.appendCustomEntry("metadata-empty-branch", { note: "no conversation body" });
  assert.ok(readFileSync(n.file, "utf8").includes("saved answer"), "positive control: abandoned messages still exist on disk");
  assert.ok(n.manager.getBranch().every(entry => entry.type !== "message"));
  const before = source(n.file);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: false });
  assert.deepEqual(f.views.thread(f.scope).ids, []);
  assert.deepEqual(source(n.file), before);
});

test("thread metadata preserves the existing compaction-summary presence predicate", t => {
  const f = fixture(t), n = native(f);
  const compactionId = n.manager.appendCompaction("saved summary", null, 1000);
  const before = source(n.file);
  assert.deepEqual(f.views.threadMetadata(f.scope), { contextRevision: 0, hasMessages: true });
  assert.deepEqual(f.views.thread(f.scope).ids, [compactionId], "the metadata uses complete current-context IDs, not just live user/assistant rows");
  assert.deepEqual(source(n.file), before);
});

test("thread metadata does not discard terminal transient messages before durable persistence", t => {
  const f = fixture(t), n = native(f), before = source(n.file);
  const terminal: ChatMessage = { id: "pending", role: "assistant", text: "terminal before disk", phase: "final_answer", status: "completed", streaming: false };
  f.views.messageChanged(f.scope, terminal); f.views.flush(f.scope);
  const metadata = f.views.threadMetadata(f.scope);
  assert.equal(metadata.hasMessages, true);
  assert.equal(f.views.transcript(f.scope).get(terminal.id)?.text, terminal.text);
  f.views.messages.delete(f.scope.sessionId);
  assert.deepEqual(f.views.threadMetadata(f.scope), metadata);
  assert.ok(f.views.thread(f.scope).ids.includes(terminal.id));
  assert.deepEqual(source(n.file), before, "pre-persistence display reads do not write the terminal delta");
  const saved = { ...assistant(terminal.text, 3), axiomId: terminal.id };
  n.manager.appendMessage(saved);
  f.views.persisted(f.scope, [terminal.id]); f.views.messages.delete(f.scope.sessionId);
  const persisted = source(n.file);
  assert.deepEqual(f.views.threadMetadata(f.scope), metadata);
  assert.equal(f.views.thread(f.scope).ids.filter(id => id === terminal.id).length, 1);
  assert.deepEqual(source(n.file), persisted);
});
