import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import type { Agents } from "../src/server/agents.js";
import type { Run } from "../src/shared/agent.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-notification-reads-")), store = new Store(root);
  const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const records = new TaskRecords(store), selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
  const [taskId] = records.create(scope, "anchor", "context", [{ task: "child" }], selection).taskIds;
  const child = records.rows("WHERE id=?", taskId)[0], runId = randomUUID(), resultId = randomUUID();
  store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed',?,1,2)").run(runId, child.sessionId, JSON.stringify(selection));
  store.db.prepare("INSERT INTO task_results(id,taskId,runId,body,delivery) VALUES(?,?,?,?,'delivered')")
    .run(resultId, taskId, runId, JSON.stringify({ id: resultId, taskId, runId, status: "completed" }));
  const manager = SessionManager.create(root, join(root, "history"));
  manager.appendMessage({ role: "user", content: "long history", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "history ".repeat(256_000) }], timestamp: 2, stopReason: "stop" } as any);
  store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  const parentRun = { id: randomUUID(), sessionId: session.id, status: "running", selection, startedAt: 1 } as Run;
  let signals = 0;
  const agents = { store, reloads: { active: () => false }, active: () => true, info: () => ({ run: parentRun }), signal: () => { signals++; return true; } } as unknown as Agents;
  const delivery = new TaskDelivery(agents, records);
  return { store, scope, manager, delivery, resultId, parentRun, signals: () => signals,
    state: (value: string) => store.db.prepare("UPDATE task_results SET delivery=? WHERE id=?").run(value, resultId),
    current: () => store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(resultId)!.delivery,
    close: async () => { await delivery.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("idle notification callbacks never reopen long history with only terminal results", async t => {
  const f = fixture();
  try {
    const open = t.mock.method(SessionManager, "open");
    for (const state of ["delivered", "failed", "discarded"]) {
      f.state(state);
      for (let i = 0; i < 20; i++) {
        f.delivery.notify(f.scope);
        f.delivery.parentSettled(f.scope, f.parentRun);
      }
    }
    assert.equal(open.mock.callCount(), 0, "no pending delivery must mean no full parent JSONL reads");
    assert.equal(f.signals(), 0);
  } finally { await f.close(); }
});

test("a pending notification still reconciles durable consumption before sending", async t => {
  const f = fixture();
  try {
    f.state("pending");
    f.manager.appendCustomMessageEntry("axiom-result", "already consumed", true, { axiomInput: f.resultId });
    const open = t.mock.method(SessionManager, "open");
    f.delivery.notify(f.scope);
    assert.equal(f.current(), "delivered");
    assert.equal(f.signals(), 0, "saved notification cannot be replayed");
    assert.equal(open.mock.callCount(), 1);
  } finally { await f.close(); }
});

test("new notifications send once and an inflight result still reconciles at settlement", async t => {
  const f = fixture();
  try {
    f.state("pending");
    const open = t.mock.method(SessionManager, "open");
    f.delivery.notify(f.scope);
    assert.equal(f.current(), "inflight");
    assert.equal(f.signals(), 1);
    f.delivery.notify(f.scope);
    assert.equal(open.mock.callCount(), 1, "inflight results are not pending sends");
    f.manager.appendCustomMessageEntry("axiom-result", "now consumed", true, { axiomInput: f.resultId });
    f.delivery.parentSettled(f.scope, f.parentRun);
    assert.equal(f.current(), "delivered");
    assert.equal(f.signals(), 1);
    assert.equal(open.mock.callCount(), 2, "unconfirmed consumption must still be read from disk");
  } finally { await f.close(); }
});

test("explicit recovery still applies rewrite markers to terminal results", async t => {
  const f = fixture();
  try {
    f.manager.appendCustomEntry("axiom-rewrite", { discardedResultIds: [f.resultId] });
    const open = t.mock.method(SessionManager, "open");
    f.delivery.reconcilePending(f.scope);
    assert.equal(open.mock.callCount(), 1);
    assert.equal(f.current(), "discarded");
    assert.equal(f.signals(), 0);
  } finally { await f.close(); }
});
