import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { AgentViews } from "../src/server/agents/views.js";
import type { Scope, Session, Workspace, Reply } from "../src/shared/protocol.js";
import type { WindowSourcePage, WindowMemberPage } from "../src/shared/thread-window.js";
import { CanonicalWindow } from "../src/server/canonical-window.js";

function fixture(t: TestContext, withFile = true) {
  const root = mkdtempSync(join(tmpdir(), "axiom-file-capture-")), cwd = join(root, "project");
  mkdirSync(cwd);
  const store = new Store(root), views = new AgentViews(store, () => {}, () => false);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  t.after(() => { views.flush(scope); store.close(); rmSync(root, { recursive: true, force: true }); });
  const manager = SessionManager.create(cwd, join(root, "native"));
  const user = manager.appendMessage({ role: "user", content: "native user", timestamp: 1 });
  const assistant = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "native answer" }],
    api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 2, stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const file = manager.getSessionFile()!;
  if (withFile) store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, file);
  return { store, views, scope, manager, file, user, assistant };
}

test("cold window capture binds current and archive to one byte digest, not a cached display map", t => {
  const f = fixture(t), checkpoint = f.manager.appendCompaction("summary", f.assistant, 200);
  const tail = f.manager.appendMessage({ role: "user", content: "current tail", timestamp: 3 });
  f.views.messages.set(f.scope.sessionId, new Map([[f.user, { id: f.user, role: "user", text: "stale cached display" }]]));
  const before = readFileSync(f.file), result = f.views.canonical(f.scope);
  assert.equal(result.source?.digest, createHash("sha256").update(before).digest("hex"));
  assert.equal(result.capture.message(f.user)?.text, "native user");
  assert.equal(result.capture.message(tail)?.text, "current tail");
  assert.equal(result.capture.archive.segments[0].id, checkpoint);
  assert.ok(result.capture.sources.some(source => source.storage.kind === "archive"));
  assert.ok(result.capture.sources.some(source => source.storage.kind === "live" && source.group.ids.includes(tail)));
  assert.deepEqual(readFileSync(f.file), before);
  f.manager.appendContextEdit(tail, { content: "revised tail" });
  const changed = f.views.canonical(f.scope);
  assert.notEqual(changed.source?.digest, result.source?.digest);
  assert.equal(changed.capture.message(tail)?.text, "revised tail");
  assert.equal(result.capture.message(tail)?.text, "current tail", "prior capture remains a fixed cut");
});

test("unpersisted terminal display cannot masquerade as an idle native source", t => {
  const f = fixture(t);
  f.views.messageChanged(f.scope, { id: "pending", role: "assistant", text: "not saved", streaming: false, status: "completed" });
  assert.throws(() => f.views.canonical(f.scope), { code: "SOURCE_PENDING" });
  f.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "actually saved" }],
    axiomId: "pending", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 4,
    stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as Parameters<SessionManager["appendMessage"]>[0]);
  assert.equal(f.views.canonical(f.scope).capture.message("pending")?.text, "actually saved");
});

function page(reply: Reply) {
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return (reply as Extract<Reply, { ok: true }>).data as WindowSourcePage;
}
test("cold query snapshots are retired on refresh, change and forget without legacy cache authority", t => {
  const f = fixture(t);
  for (const invalidate of [() => f.views.refresh(f.scope), () => f.views.changed(f.scope), () => f.views.forget(f.scope)]) {
    const opened = page(f.views.window(f.scope, "r", { op: "open" }, () => true));
    assert.ok(opened.items.length);
    invalidate();
    const stale = f.views.window(f.scope, "r", { op: "sources", revision: opened.revision }, () => true);
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, "STALE");
  }
  f.views.closeWindows();
});
test("cold query owner LRU and shutdown revoke old references; fileless reads remain explicit", t => {
  const f = fixture(t, false), opened = page(f.views.window(f.scope, "r", { op: "open" }, () => true));
  assert.equal(opened.total, 0);
  for (let i = 0; i < 4; i++) {
    const session = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: f.scope.workspaceId }) as Session;
    page(f.views.window({ ...f.scope, sessionId: session.id }, "r", { op: "open" }, () => true));
  }
  const evicted = f.views.window(f.scope, "r", { op: "sources", revision: opened.revision }, () => true);
  assert.equal(evicted.ok, false); if (!evicted.ok) assert.equal(evicted.error.code, "STALE");
  const fresh = page(f.views.window(f.scope, "r", { op: "open" }, () => true));
  f.views.closeWindows();
  const closed = f.views.window(f.scope, "r", { op: "sources", revision: fresh.revision }, () => true);
  assert.equal(closed.ok, false); if (!closed.ok) assert.equal(closed.error.code, "STALE");
  f.views.closeWindows();
});

test("host origins are authorized scope-local facts, copied without inventing legacy provenance", t => {
  const f = fixture(t, false);
  const other = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: f.scope.workspaceId }) as Session;
  const insert = f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,origin) VALUES(?,?,'starting','{}',1,?)");
  insert.run("known", f.scope.sessionId, "memory_continuation");
  insert.run("legacy", f.scope.sessionId, null);
  insert.run("invalid", f.scope.sessionId, "not-a-host-origin");
  insert.run("foreign", other.id, "manual_resume");
  const origins = f.views.windowOrigins(f.scope);
  assert.deepEqual(origins, [["known", "memory_continuation"]]);
  origins[0][1] = "manual_resume";
  assert.deepEqual(f.views.windowOrigins(f.scope), [["known", "memory_continuation"]]);
  assert.throws(() => f.views.windowOrigins({ ...f.scope, workspaceId: randomUUID() }), { code: "NOT_FOUND" });
});

test("host identity seeds stay scope-local across cold retirement and agree with a newly owned reader", t => {
  const f = fixture(t), seed = f.views.windowIdentity(f.scope);
  const first = page(f.views.window(f.scope, "r", { op: "open" }, () => true));
  const members = f.views.window(f.scope, "r", { op: "members", revision: first.revision, sourceRef: first.items[0].ref }, () => true);
  assert.equal(members.ok, true); if (!members.ok) return;
  const member = (members.data as WindowMemberPage).items[0];
  for (const retire of [() => f.views.changed(f.scope), () => f.views.refresh(f.scope), () => f.views.forget(f.scope), () => f.views.closeWindows()]) {
    retire(); assert.equal(f.views.windowIdentity(f.scope), seed);
    const next = page(f.views.window(f.scope, "r", { op: "open" }, () => true));
    assert.equal(next.identityNamespace, first.identityNamespace); assert.notEqual(next.revision, first.revision);
  }
  const reader = new CanonicalWindow(() => f.views.canonical(f.scope).capture, undefined, seed), opened = page(reader.read("r", { op: "open" }));
  assert.equal(opened.identityNamespace, first.identityNamespace);
  const copied = reader.read("r", { op: "members", revision: opened.revision, sourceRef: opened.items[0].ref });
  assert.equal(copied.ok, true); if (copied.ok) assert.equal((copied.data as WindowMemberPage).items[0].messageKey, member.messageKey);
  assert.equal(JSON.stringify([first, members, opened, copied]).includes(seed), false);
  const other = f.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: f.scope.workspaceId }) as Session;
  assert.notEqual(f.views.windowIdentity({ ...f.scope, sessionId: other.id }), seed);
  assert.throws(() => f.views.windowIdentity({ ...f.scope, workspaceId: randomUUID() }), { code: "NOT_FOUND" });
  reader.close(); f.views.closeWindows();
});

test("empty fileless source is explicit and scope ownership is checked first", t => {
  const f = fixture(t, false), result = f.views.canonical(f.scope);
  assert.equal(result.source, null);
  assert.deepEqual(result.capture.sources, []);
  assert.throws(() => f.views.canonical({ ...f.scope, workspaceId: randomUUID() }), { code: "NOT_FOUND" });
  f.views.messageChanged(f.scope, { id: "stream", role: "assistant", text: "live", streaming: true });
  assert.throws(() => f.views.canonical(f.scope), { code: "SOURCE_PENDING" });
});
