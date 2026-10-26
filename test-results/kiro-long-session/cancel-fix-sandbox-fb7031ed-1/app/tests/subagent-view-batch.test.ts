import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import type { Agents } from "../src/server/agents.js";
import type { Run } from "../src/shared/agent.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import { tasksScope } from "../src/shared/tasks.js";

test("three children commit every receipt before one coalesced parent snapshot without rebuilding chat", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-view-batch-")), store = new Store(root);
  let delivery: TaskDelivery | undefined;
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id }, records = new TaskRecords(store), selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const ids = records.create(scope, "batch", "context", [0, 1, 2].map(i => ({ task: `child-${i}` })), selection).taskIds;
    const snapshots: ReturnType<TaskRecords["list"]>[] = [], published: string[] = [];
    const agents = { store, info: () => ({ selection, run: null }), setQueue: () => {},
      thread: () => { throw Error("input receipts must not rebuild parent chat"); },
      publish: (key: string) => { published.push(key); if (key === tasksScope(scope)) snapshots.push(records.list(scope)); },
    } as unknown as Agents;
    delivery = new TaskDelivery(agents, records); delivery.pause();
    const scheduler = new TaskScheduler(agents, records, delivery); scheduler.kick = () => {};
    const receipts: string[] = [];
    for (const id of ids) {
      const row = records.rows("WHERE id=?", id)[0];
      records.deliver(row, records.inputs(row, "queued").map(input => input.id));
      const run: Run = { id: randomUUID(), sessionId: row.sessionId, status: "running", selection, startedAt: Date.now(), endedAt: null, error: null };
      store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)").run(run.id, row.sessionId, JSON.stringify(selection), run.startedAt);
      store.db.prepare("UPDATE tasks SET runId=?,status='running' WHERE id=?").run(run.id, id);
      const input = records.queue(id, "actual input", "steer"); receipts.push(input);
      store.db.prepare("UPDATE task_inputs SET runId=?,state='inflight' WHERE id=?").run(run.id, input);
      records.receipt(input, "queued", null, run.id, id);
      scheduler.event(row, run, { type: "input-accepted", id: input });
      assert.equal(store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(input)!.state, "accepted");
      scheduler.event(row, run, { type: "delivered", ids: [input] });
      assert.equal(store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(input)!.state, "delivered");
      assert.equal(store.db.prepare("SELECT id FROM task_inputs WHERE id=?").get(input), undefined);
    }
    assert.equal(snapshots.length, 0, "business commits do not await display construction");
    await new Promise<void>(r => setImmediate(r));
    assert.equal(snapshots.length, 1); assert.equal(snapshots[0].tasks.length, 3);
    for (const id of receipts) assert.equal(store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(id)!.state, "delivered");
    assert.equal(published.filter(key => key.startsWith("thread:")).length, 0);
    assert.equal((scheduler as any).pendingViews.size, 0);
  } finally { await delivery?.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
