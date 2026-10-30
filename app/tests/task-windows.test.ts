import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AgentViews } from "../src/server/agents/views.js";
import { createWindowIdentity } from "../src/server/canonical-window-identity.js";
import { TaskWindows, taskWindowInvalidations } from "../src/server/task-windows.js";
import type { Scope } from "../src/shared/protocol.js";
import { taskWindowScope, type TaskWindowQuery, type WindowTaskPage } from "../src/shared/task-window.js";
import { taskWindowFixture } from "./fixtures/task-window.js";

function read(windows: TaskWindows, scope: Scope, query: TaskWindowQuery): WindowTaskPage {
  const reply = windows.read(scope, "request", query);
  assert.equal(reply.ok, true, JSON.stringify(reply));
  if (!reply.ok) throw new Error("Expected task window");
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 128 * 1024);
  return reply.data as WindowTaskPage;
}
function failure(windows: TaskWindows, scope: Scope, query: TaskWindowQuery, code: string, signal?: AbortSignal) {
  const reply = windows.read(scope, "request", query, signal);
  assert.equal(reply.ok, false);
  if (reply.ok) throw new Error("Expected failure");
  assert.equal(reply.error.code, code);
}

test("host task readers use the actual view scope seed and evict four-scope LRU without changing stable keys", t => {
  const f = taskWindowFixture(t), views = new AgentViews(f.store, () => {}), scopes = [f.scope, f.session(), f.session(), f.session(), f.session()];
  let seeds = 0;
  const windows = new TaskWindows(f.store, scope => { seeds++; return views.windowIdentity(scope); });
  const own = f.task("a");
  const first = read(windows, scopes[0], { op: "open" });
  assert.equal(first.identityNamespace, createWindowIdentity(views.windowIdentity(scopes[0])).namespace);
  assert.equal(first.items[0].anchorKey, createWindowIdentity(views.windowIdentity(scopes[0])).key("call", own.anchor));
  const second = read(windows, scopes[1], { op: "open" });
  read(windows, scopes[2], { op: "open" }); read(windows, scopes[3], { op: "open" });
  read(windows, scopes[0], { op: "tasks", revision: first.revision }); // Promote A: B is now oldest.
  read(windows, scopes[4], { op: "open" }); assert.equal(seeds, 5);
  failure(windows, scopes[1], { op: "tasks", revision: second.revision }, "STALE");
  const reopened = read(windows, scopes[1], { op: "open" });
  assert.equal(reopened.identityNamespace, second.identityNamespace); assert.notEqual(reopened.revision, second.revision);
  assert.equal(read(windows, scopes[0], { op: "tasks", revision: first.revision }).items[0].taskKey, first.items[0].taskKey);
  windows.close(); failure(windows, scopes[0], { op: "open" }, "STALE");
});

test("owner loss and explicit invalidation retire cuts; cancellation and ordinary task changes do not", t => {
  const f = taskWindowFixture(t), views = new AgentViews(f.store, () => {});
  const windows = new TaskWindows(f.store, scope => views.windowIdentity(scope)); f.task("a");
  const a = read(windows, f.scope, { op: "open" }), controller = new AbortController(); controller.abort();
  failure(windows, f.scope, { op: "open" }, "STALE", controller.signal);
  windows.changed(`tasks:${f.scope.workspaceId}:${f.scope.sessionId}`);
  assert.equal(read(windows, f.scope, { op: "tasks", revision: a.revision }).total, 1);
  f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(f.scope.sessionId);
  windows.changed(`sessions:${f.scope.workspaceId}`);
  f.store.db.prepare("UPDATE sessions SET deletedAt=NULL WHERE id=?").run(f.scope.sessionId);
  failure(windows, f.scope, { op: "tasks", revision: a.revision }, "STALE");
  const b = read(windows, f.scope, { op: "open" }); assert.equal(b.items[0].taskKey, a.items[0].taskKey);
  f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.scope.workspaceId);
  windows.changed("workspaces");
  failure(windows, f.scope, { op: "open" }, "UNAVAILABLE");
  f.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(f.scope.workspaceId);
  failure(windows, f.scope, { op: "tasks", revision: b.revision }, "STALE");
  assert.equal(read(windows, f.scope, { op: "open" }).items[0].taskKey, a.items[0].taskKey);
  failure(windows, { ...f.scope, workspaceId: "foreign" }, { op: "open" }, "UNAVAILABLE");
  windows.close();
});

test("invalidation subscriptions do not capture tasks or repair aliases and direct events do not scan subscriptions", t => {
  const f = taskWindowFixture(t); f.task("a");
  let seeds = 0;
  const windows = new TaskWindows(f.store, () => { seeds++; throw new Error("Must not create reader during subscription"); });
  const before = f.store.db.prepare("SELECT total_changes() AS n").get()!.n;
  windows.check(f.scope); assert.equal(seeds, 0); assert.equal(f.store.db.prepare("SELECT total_changes() AS n").get()!.n, before);
  const own = taskWindowScope(f.scope), other = taskWindowScope({ workspaceId: "other", sessionId: "session" });
  for (const kind of ["tasks", "agent", "thread", "session"]) assert.deepEqual(taskWindowInvalidations(`${kind}:${f.scope.workspaceId}:${f.scope.sessionId}`, () => { throw new Error("Unexpected scan"); }), [own]);
  const observed = () => [own, own, other, `tasks:${f.scope.workspaceId}:${f.scope.sessionId}`, "task-window:bad:extra:part"];
  assert.deepEqual(taskWindowInvalidations(`sessions:${f.scope.workspaceId}`, observed), [own]);
  assert.deepEqual(taskWindowInvalidations("workspaces", observed), [own, other]);
  for (const scope of [own, "messages:w:s", "message:w:s:m", "costs:w:s", "configuration"])
    assert.deepEqual(taskWindowInvalidations(scope, () => { throw new Error("Unexpected scan"); }), []);
  windows.close();
});

test("production task RPC shares strict IDs, read admission, actual receipts and invalidation-only subscription routing", () => {
  // Static wiring evidence only; do not start index, Agents, ModelRuntime or a live server.
  const index = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  const tasks = readFileSync(new URL("../src/server/tasks.ts", import.meta.url), "utf8");
  const agents = readFileSync(new URL("../src/server/agents.ts", import.meta.url), "utf8");
  assert.match(index, /windowRead = typeof value\.op === "string" && \["agent\.window", "task\.window"\]\.includes\(value\.op\.trim\(\)\)/);
  assert.match(index, /const historyRead = \["agent\.window", "task\.window"/);
  assert.match(index, /c\.op === "agent\.window" \|\| c\.op === "task\.window"[\s\S]*?tasks\.window\(c, signal\)[\s\S]*?send\(ws, frame, true, releaseRead\);\s*releaseRead = undefined; return;/);
  assert.match(index, /parts\[0\] === "task-window"\) return tasks\.windowInvalidation\(target, seq\)/);
  assert.match(index, /if \(scope\.startsWith\("task-window:"\)\) \{ publish\(scope, \{ revision: seq \+ 1 \}\); continue; \}/);
  assert.match(tasks, /new TaskWindows\(this\.store, scope => agents\.windowIdentity\(scope\)\)/);
  assert.match(tasks, /windowInvalidation\(scope: Scope, revision: number\) \{\s*this\.windows\.check\(scope\);\s*return \{ revision \};/);
  assert.match(agents, /windowIdentity\(scope: Scope\): string \{\s*this\.owner\(scope\);[\s\S]*?authorized[\s\S]*?return this\.views\.windowIdentity\(scope\)/);
});
