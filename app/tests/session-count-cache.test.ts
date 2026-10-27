import assert from "node:assert/strict";
import { test } from "node:test";
import fs, { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentViews } from "../src/server/agents/views.js";
import { Store } from "../src/server/storage.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const reply = (text: string, axiomId?: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 2, axiomId }) as any;
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "axiom-count-cache-")), cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const session = store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const publications: string[] = [];
  const views = new AgentViews(store, name => publications.push(name), () => false);
  const manager = SessionManager.create(cwd, join(root, "native"));
  manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
  manager.appendMessage(reply("answer"));
  const bind = () => store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(session.id, manager.getSessionFile()!);
  t.after(() => { views.forget(scope); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, cwd, store, workspace, session, scope, views, manager, publications, bind };
}
const hot = { cachedOnly: true };

test("cold title counts remain unknown without parsing or hydrating, including LRU misses", t => {
  const f = fixture(t); f.bind();
  const readFileSync = fs.readFileSync;
  let fullReads = 0;
  const fileReads = t.mock.method(fs, "readFileSync", (...args: Parameters<typeof readFileSync>) => {
    if (String(args[0]) === f.manager.getSessionFile()) fullReads++;
    return Reflect.apply(readFileSync, fs, args);
  });
  syncBuiltinESMExports();
  t.after(() => { fileReads.mock.restore(); syncBuiltinESMExports(); });
  const reads = t.mock.method(SessionManager, "inMemory");
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  assert.equal(reads.mock.callCount(), 0, "cold list reads must not parse native JSONL");
  assert.equal(fullReads, 0, "cold titles must not read the native body even without parsing it");
  assert.equal(f.views.messages.size, 0);
  const scopes = Array.from({ length: 260 }, (_, i) => ({ workspaceId: f.workspace.id, sessionId: `cold-${i}` }));
  for (const scope of scopes) {
    f.store.db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)").run(scope.sessionId, scope.workspaceId, "cold", 1);
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, f.manager.getSessionFile()!);
    assert.equal(f.views.messageCount(scope, hot), undefined);
  }
  assert.equal(reads.mock.callCount(), 0);
  assert.equal(fullReads, 0);
  for (const scope of scopes) assert.equal(f.views.messageCount(scope), 2, "explicit exact reads remain available");
  const before = reads.mock.callCount();
  assert.equal(before, scopes.length);
  assert.equal(fullReads, scopes.length, "positive control: the probe observes actual full JSONL reads");
  assert.equal(f.views.messageCount(scopes[0], hot), undefined, "evicted counts must not trigger a new cold scan");
  assert.equal(f.views.messageCount(scopes.at(-1)!, hot), 2);
  assert.equal(reads.mock.callCount(), before);
  assert.equal(fullReads, scopes.length);
  assert.equal(f.views.messages.size, 0);
});

test("a real body open seeds complete branch counts from the same manager and notifies once", t => {
  const f = fixture(t);
  f.manager.appendMessage({ role: "toolResult", toolCallId: "tool", toolName: "read", content: [{ type: "text", text: "output" }], isError: false, timestamp: 1 });
  f.manager.appendCustomMessageEntry("axiom-append", "follow up", true, { axiomInput: "follow-up" });
  f.manager.appendCustomMessageEntry("axiom-result", "internal", true);
  const removed = f.manager.appendMessage(reply("discarded retry"));
  f.manager.appendContextEdit(removed, null);
  f.manager.appendCompaction("summary", null, 1000);
  f.manager.appendMessage(reply("latest"));
  f.bind();
  const reads = t.mock.method(SessionManager, "inMemory");
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  const messages = f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 4, "include pre-compaction history and append, exclude tools/result/deleted retry");
  assert.ok(messages.size < 4, "current display is not the historical counting source");
  assert.equal(reads.mock.callCount(), 1, "seeding must reuse the body manager, not reopen the file");
  assert.deepEqual(f.publications, [`sessions:${f.workspace.id}`], "unknown to known must refresh title counts");
  f.views.transcript(f.scope); f.views.messageCount(f.scope, hot);
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(f.publications.length, 1);
});

test("file changes invalidate hot counts; persisted IDs never certify an old baseline", t => {
  const f = fixture(t); f.bind();
  f.views.transcript(f.scope); f.publications.length = 0;
  const reads = t.mock.method(SessionManager, "inMemory");
  f.views.messageChanged(f.scope, { id: "live", role: "assistant", text: "a", streaming: true }); f.views.flush(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 3);
  f.views.messageChanged(f.scope, { id: "live", role: "assistant", text: "abc", streaming: false }); f.views.flush(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 3);
  assert.deepEqual(f.publications, [`sessions:${f.workspace.id}`], "token and terminal text updates do not duplicate counts");
  f.manager.appendMessage(reply("abc", "live"));
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  f.views.persisted(f.scope, ["live"]);
  assert.equal(f.views.messageCount(f.scope, hot), undefined, "persistence alone cannot bless a stale complete-branch baseline");
  assert.equal(reads.mock.callCount(), 0);
  f.views.refresh(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 3);
  assert.equal(reads.mock.callCount(), 1);
  const point = f.manager.getLeafId()!;
  f.manager.appendMessage(reply("abandoned"));
  f.manager.branch(point);
  f.manager.appendMessage({ role: "user", content: "new branch", timestamp: 3 });
  f.views.refresh(f.scope); f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 4);
});

test("confirmed no-file sessions retain real zero and transient dedup; missing bound files stay unknown", t => {
  const f = fixture(t);
  const reads = t.mock.method(SessionManager, "inMemory");
  assert.equal(f.views.messageCount(f.scope, hot), 0);
  f.views.messageChanged(f.scope, { id: "input", role: "user", text: "draft committed" }); f.views.flush(f.scope);
  f.views.messageChanged(f.scope, { id: "input", role: "user", text: "draft committed" }); f.views.flush(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 1);
  f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(f.session.id, join(f.root, "missing.jsonl"));
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  assert.equal(reads.mock.callCount(), 0);
});

test("a file modified during an actual body open cannot seed old entries with a new fingerprint", t => {
  const f = fixture(t); f.bind();
  const inMemory = SessionManager.inMemory;
  let changed = false;
  const reads = t.mock.method(SessionManager, "inMemory", (...args: Parameters<typeof inMemory>) => {
    const manager = Reflect.apply(inMemory, SessionManager, args);
    if (!changed) { changed = true; f.manager.appendMessage(reply("raced append")); }
    return manager;
  });
  f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), undefined, "old parsed entries do not describe the newer source");
  assert.deepEqual(f.publications, []);
  f.views.refresh(f.scope); f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 3);
  assert.equal(reads.mock.callCount(), 2);
});

test("a binding changed during body open cannot assign an old manager to a different native file", t => {
  const f = fixture(t); f.bind();
  const other = SessionManager.create(f.cwd, join(f.root, "other-native"));
  other.appendMessage({ role: "user", content: "another file", timestamp: 3 });
  const inMemory = SessionManager.inMemory;
  let changed = false;
  const reads = t.mock.method(SessionManager, "inMemory", (...args: Parameters<typeof inMemory>) => {
    const manager = Reflect.apply(inMemory, SessionManager, args);
    if (!changed) {
      changed = true;
      f.store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(other.getSessionFile()!, f.session.id);
    }
    return manager;
  });
  f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  assert.deepEqual(f.publications, []);
  f.views.refresh(f.scope); f.views.transcript(f.scope);
  assert.equal(f.views.messageCount(f.scope, hot), 1, "only a manager of the new binding may seed its count");
  assert.equal(reads.mock.callCount(), 2);
});

test("count-only revalidation failure does not fail an already readable body or publish a fake count", t => {
  const f = fixture(t); f.bind();
  const source = (f.views as any).countSource.bind(f.views);
  let calls = 0;
  t.mock.method(f.views as any, "countSource", (...args: unknown[]) => {
    if (++calls === 2) throw Error("optional count revalidation unavailable");
    return source(...args);
  });
  const messages = f.views.transcript(f.scope);
  assert.deepEqual([...messages.values()].map(message => message.text), ["question", "answer"]);
  assert.equal(f.views.messageCount(f.scope, hot), undefined);
  assert.deepEqual(f.publications, []);
});
