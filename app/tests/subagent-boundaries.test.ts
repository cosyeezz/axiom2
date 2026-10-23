import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { rewriteFixture, until } from "./rewrite-fixture.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { AgentViews } from "../src/server/agents/views.js";
import { editableMessage, rewriteBranch } from "../src/server/session-rewrite.js";
import type { EditableMessage } from "../src/shared/rewrite.js";
import type { Run } from "../src/shared/agent.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

test("same-session startup serializes append, model, stale resume and rewrite with one owner", { timeout: 60000 }, async () => {
  const f = await rewriteFixture(), barrier = gate();
  const raw = f.app.agents.models.raw.bind(f.app.agents.models);
  try {
    await f.call("prompt", { text: "EDITABLE_HISTORY" }); await f.idle();
    f.stall(true); await f.call("prompt", { text: "OLD_OWNER" });
    await f.app.tasks.stopParent(f.scope); await f.idle();
    const oldRunId = f.app.agents.info(f.scope).run!.id;
    const message = f.app.agents.messages(f.scope).find(m => m?.text === "EDITABLE_HISTORY")!;
    const edit = await f.call("agent.editable", { messageId: message.id }) as EditableMessage;
    const count = () => Number(f.app.store.db.prepare("SELECT count(*) AS n FROM runs WHERE sessionId=?").get(f.scope.sessionId)!.n);
    const before = count(); let entered = false;
    f.app.agents.models.raw = async () => { if (!entered) { entered = true; await barrier.promise; } return raw(); };
    const start = f.call("prompt", { text: "NEW_OWNER" });
    await until(() => entered, "preparation barrier not reached");
    const appendId = randomUUID(), params = { text: "APPEND_ONCE" };
    const append = f.call("prompt", params, f.scope, appendId);
    const model = f.call("agent.model", { selection: f.selection });
    const resume = assert.rejects(f.call("agent.resume", { expectedRunId: oldRunId }), { code: "RUN_MISMATCH" });
    const rewrite = assert.rejects(f.call("prompt", { text: "MUST_NOT_REWRITE", rewrite: { messageId: edit.messageId, revision: edit.revision } }), { code: "REWRITE_BUSY" });
    await tick();
    assert.equal(f.app.store.receipt(appendId).status, "pending");
    assert.equal(count(), before);
    barrier.release();
    const started = await start as { runId: string }, appended = await append as { runId: string };
    await Promise.all([model, resume, rewrite]);
    assert.equal(started.runId, appended.runId); assert.equal(count(), before + 1);
    assert.equal((f.app.agents as any).runs.live.get(f.scope.sessionId).run.id, started.runId);
    assert.deepEqual(await f.call("prompt", params, f.scope, appendId), appended);
    assert.equal(count(), before + 1);
    const queue = f.app.agents.info(f.scope).queue ?? [];
    assert.equal(queue.filter(item => item.id === appendId).length, 1);
    await f.app.tasks.stopParent(f.scope); await f.idle();
    await assert.rejects(f.call("prompt", { text: "OLD_REVISION", rewrite: { messageId: edit.messageId, revision: edit.revision } }), { code: "REWRITE_CONFLICT" });
  } finally { barrier.release(); f.app.agents.models.raw = raw; await f.close(); }
});

test("competing rewrites commit one branch and replay preserves its run and marker", { timeout: 60000 }, async () => {
  const f = await rewriteFixture(), barrier = gate();
  const raw = f.app.agents.models.raw.bind(f.app.agents.models);
  try {
    await f.call("prompt", { text: "REWRITE_TARGET" }); await f.idle();
    const message = f.app.agents.messages(f.scope).find(m => m?.text === "REWRITE_TARGET")!;
    const edit = await f.call("agent.editable", { messageId: message.id }) as EditableMessage;
    const file = String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)!.file);
    const markers = () => SessionManager.open(file).getEntries().filter(e => e.type === "custom" && e.customType === "axiom-rewrite");
    const before = markers().length, requestId = randomUUID(); let entered = false;
    f.app.agents.models.raw = async () => { if (!entered) { entered = true; await barrier.promise; } return raw(); };
    f.stall(true);
    const params = { text: "WINNER", rewrite: { messageId: edit.messageId, revision: edit.revision } };
    const winner = f.call("prompt", params, f.scope, requestId);
    await until(() => entered, "rewrite preparation not reached");
    const loser = assert.rejects(f.call("prompt", { ...params, text: "LOSER" }), { code: "REWRITE_BUSY" });
    barrier.release(); const accepted = await winner; await loser;
    assert.equal(markers().length, before + 1);
    assert.equal((markers().at(-1) as any).data.requestId, requestId);
    assert.deepEqual(await f.call("prompt", params, f.scope, requestId), accepted);
    assert.equal(markers().length, before + 1);
    await f.app.tasks.stopParent(f.scope); await f.idle();
    await assert.rejects(f.call("prompt", { ...params, text: "STALE" }), { code: "REWRITE_CONFLICT" });
    assert.equal(markers().length, before + 1);
  } finally { barrier.release(); f.app.agents.models.raw = raw; await f.close(); }
});

for (const boundary of ["frozen", "discarded", "persisted"] as const)
  test(`notification waiting for config cannot cross ${boundary} boundary`, { timeout: 30000 }, async () => {
    const f = await rewriteFixture(), barrier = gate();
    const records = new TaskRecords(f.app.store), delivery = new TaskDelivery(f.app.agents, records);
    try {
      const [id] = records.create(f.scope, "notification-boundary", "context", [{ task: "completed child" }], f.selection).taskIds;
      let row = records.rows("WHERE id=?", id)[0];
      const run: Run = { id: randomUUID(), sessionId: row.sessionId, selection: f.selection, status: "completed", startedAt: 10, endedAt: 20, error: null };
      f.app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed',?,10,20)").run(run.id, run.sessionId, JSON.stringify(f.selection));
      f.app.store.db.prepare("UPDATE tasks SET status='completed',runId=? WHERE id=?").run(run.id, id);
      f.app.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(id);
      row = records.rows("WHERE id=?", id)[0]; delivery.save(row, run);
      const saved = f.app.store.db.prepare("SELECT id,body FROM task_results WHERE taskId=?").get(id)!;
      let entered = false;
      const lock = f.app.agents.models.serial(async () => { entered = true; await barrier.promise; });
      await until(() => entered, "config lock not held");
      delivery.notify(f.scope);
      await until(() => Number(f.app.store.db.prepare("SELECT count(*) AS n FROM task_notification_attempts").get()!.n) === 1, "notification not waiting");
      assert.equal(f.app.store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(saved.id)!.delivery, "inflight");
      if (boundary === "frozen") records.freeze(f.scope);
      if (boundary === "discarded") {
        f.app.store.db.prepare("UPDATE task_results SET delivery='discarded' WHERE id=?").run(saved.id);
        f.app.store.db.prepare("UPDATE task_notification_attempts SET state='discarded'").run();
      }
      if (boundary === "persisted") {
        const manager = SessionManager.create(f.project, join(f.root, "sessions"));
        manager.appendCustomMessageEntry("axiom-result", "durable result", true, { axiomInput: saved.id });
        manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "durable acknowledgement" }], timestamp: 1, stopReason: "stop" } as any);
        f.app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(f.scope.sessionId, manager.getSessionFile()!);
        delivery.reconcileNotifications(f.scope);
      }
      barrier.release(); await lock;
      await until(() => (delivery as any).jobs.size === 0, "notification did not settle");
      const expected = boundary === "frozen" ? "failed" : boundary === "persisted" ? "delivered" : "discarded";
      assert.equal(f.app.store.db.prepare("SELECT delivery FROM task_results WHERE id=?").get(saved.id)!.delivery, expected);
      assert.equal(f.app.store.db.prepare("SELECT state FROM task_notification_attempts").get()!.state, expected);
      if (boundary !== "frozen") { delivery.acknowledge(f.scope, [String(saved.id)]); delivery.reconcilePending(f.scope); }
      delivery.notify(f.scope); await tick();
      assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM task_notification_attempts").get()!.n, 1);
      assert.equal(f.app.store.db.prepare("SELECT body FROM task_results WHERE id=?").get(saved.id)!.body, saved.body);
      assert.equal(f.app.store.db.prepare("SELECT count(*) AS n FROM runs WHERE sessionId=?").get(f.scope.sessionId)!.n, 0);
      assert.equal((f.app.agents as any).runs.pending.has(f.scope.sessionId), false);
      assert.equal((f.app.agents as any).runs.live.has(f.scope.sessionId), false);
      assert.equal(f.requests.length, 0);
    } finally { barrier.release(); await delivery.close(); await f.close(); }
  });

for (const boundary of ["rewrite", "compression", "stop", "run-switch"] as const)
  test(`pending message delta precedes ${boundary} reset and cannot revive an old branch`, async () => {
    const f = await rewriteFixture(); let views: AgentViews | undefined;
    try {
      const manager = SessionManager.create(f.project, join(f.root, "sessions"));
      const input = manager.appendMessage({ role: "user", content: "REMOVE_INPUT", timestamp: 1 });
      const old = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "REMOVE_REPLY" }], timestamp: 2, stopReason: "stop" } as any);
      f.app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(f.scope.sessionId, manager.getSessionFile()!);
      const collection = `messages:${f.scope.workspaceId}:${f.scope.sessionId}`, delta = `message:${f.scope.workspaceId}:${f.scope.sessionId}:${old}`;
      const events: { scope: string; data: any }[] = [];
      views = new AgentViews(f.app.store, (scope, data) => events.push({ scope, data: scope === collection ? [...views!.transcript(f.scope).values()] : data }));
      views.messageChanged(f.scope, { id: old, role: "assistant", text: "OLD_PENDING_DELTA", streaming: true });
      events.length = 0;
      if (boundary === "rewrite") {
        const edit = editableMessage(manager, input);
        rewriteBranch(manager, { messageId: edit.messageId, revision: edit.revision }, randomUUID(), []);
      } else if (boundary === "compression") manager.appendCompaction("NEW_SUMMARY", null, 1000);
      else { views.flush(f.scope); views.settled(f.scope); }
      views.refresh(f.scope);
      const resetAt = events.findIndex(e => e.scope === collection), deltaAt = events.findIndex(e => e.scope === delta);
      assert.ok(deltaAt >= 0 && deltaAt < resetAt);
      const branchChanged = boundary === "rewrite" || boundary === "compression";
      if (branchChanged) assert.ok(!events[resetAt].data.some((m: any) => m.id === old));
      else assert.equal(events[resetAt].data.find((m: any) => m.id === old)?.text, "REMOVE_REPLY", "termination keeps durable text, not pending old-run content");
      if (boundary === "run-switch") {
        views.messageChanged(f.scope, { id: "new-run-message", role: "assistant", text: "NEW_RUN_OUTPUT", streaming: true });
        views.flush(f.scope);
      }
      const count = events.length;
      await new Promise(resolve => setTimeout(resolve, 65));
      assert.equal(events.length, count);
      assert.equal(views.transcript(f.scope).has(old), !branchChanged);
      assert.equal(views.thread(f.scope).ids.includes(old), !branchChanged);
      if (!branchChanged) assert.equal(views.transcript(f.scope).get(old)?.text, "REMOVE_REPLY");
      if (boundary === "run-switch") assert.equal(views.transcript(f.scope).get("new-run-message")?.text, "NEW_RUN_OUTPUT");
      assert.equal((views as any).changedMessages.size, 0); assert.equal((views as any).timers.size, 0);
    } finally { views?.forget(f.scope); await f.close(); }
  });
