import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-new-session-"));
  const store = new Store(root);
  const open = (name: string) => {
    const path = join(root, name); mkdirSync(path);
    return store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  };
  const workspace = open("project");
  const create = (workspaceId = workspace.id, reuseEmpty = true) => store.execute({
    requestId: crypto.randomUUID(), op: "session.create", workspaceId, params: { reuseEmpty },
  }) as Session;
  return { root, store, workspace, open, create, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("repeated new-session requests reuse one durable session and retain draft and model", async () => {
  const f = fixture();
  try {
    const session = f.create(), scope = { workspaceId: f.workspace.id, sessionId: session.id };
    const drafts = new SessionDrafts(f.store);
    const draft = { text: "未发送的内容", attachment: null, attachments: [], images: [] };
    drafts.save(scope, { writer: "viewer", sequence: 1, revision: 0, draft });
    const selection = JSON.stringify({ provider: "fixture", id: "chosen", thinking: "off" });
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, selection);
    const sessions = await Promise.all(Array.from({ length: 30 }, async () => f.create()));
    assert.deepEqual(new Set(sessions.map(s => s.id)), new Set([session.id]));
    assert.equal(f.store.sessions(f.workspace.id).length, 1);
    assert.deepEqual(drafts.read(scope).draft, draft);
    assert.equal(f.store.db.prepare("SELECT selection FROM agent_sessions WHERE sessionId=?").get(session.id)?.selection, selection);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS count FROM runs").get()?.count, 0);
  } finally { f.close(); }
});

test("new-session reuse is workspace-bound and excludes deleted or manually named sessions", () => {
  const f = fixture();
  try {
    const first = f.create(), otherWorkspace = f.open("other"), other = f.create(otherWorkspace.id);
    assert.notEqual(first.id, other.id);
    assert.equal(f.create().id, first.id);
    f.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", workspaceId: f.workspace.id, sessionId: first.id, params: { title: "新对话" } });
    const second = f.create(); assert.notEqual(second.id, first.id);
    f.store.execute({ requestId: crypto.randomUUID(), op: "session.delete", workspaceId: f.workspace.id, sessionId: second.id, params: { confirmed: true } });
    const third = f.create(); assert.notEqual(third.id, second.id);
    assert.equal(f.create().id, third.id);
    assert.equal(f.create(otherWorkspace.id).id, other.id);
  } finally { f.close(); }
});

test("execution and transcript ownership prevent reusing a started conversation", () => {
  const f = fixture();
  try {
    const started = f.create();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'failed','{}',?)").run(crypto.randomUUID(), started.id, Date.now());
    const bound = f.create(); assert.notEqual(bound.id, started.id);
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(bound.id, "saved-transcript.jsonl");
    const fresh = f.create(); assert.notEqual(fresh.id, bound.id);
    assert.equal(f.create().id, fresh.id);
    assert.equal(f.store.sessions(f.workspace.id).length, 3);
  } finally { f.close(); }
});

test("legacy duplicate blanks are retained and the most recent is reused", () => {
  const f = fixture();
  try {
    const older = f.create(f.workspace.id, false), newer = f.create(f.workspace.id, false);
    assert.notEqual(older.id, newer.id);
    assert.equal(f.create().id, newer.id);
    assert.equal(f.store.sessions(f.workspace.id).length, 2);
  } finally { f.close(); }
});
