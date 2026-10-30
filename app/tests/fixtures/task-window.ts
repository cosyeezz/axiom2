import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Store } from "../../src/server/storage.js";
import { TaskRecords, type TaskRow } from "../../src/server/tasks/records.js";
import type { Scope, Session, Workspace } from "../../src/shared/protocol.js";
import type { TaskInputState, TaskResult, TaskStatus } from "../../src/shared/tasks.js";

/** Private SQLite only. No Agents, worker, SessionManager or model initialization. */
export function taskWindowFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-task-window-")), cwd = join(root, "project");
  mkdirSync(cwd);
  const store = new Store(root), records = new TaskRecords(store);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
  const session = (): Scope => {
    const item = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    return { workspaceId: workspace.id, sessionId: item.id };
  };
  const scope = session();
  const task = (id: string, createdAt = 1, owner = scope): TaskRow => {
    const child = `child-${id}`;
    store.db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,'child',1)").run(child, owner.workspaceId);
    store.db.prepare(`INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,title,context,description,status,budgets,createdAt)
      VALUES(?,?,?,?,?,'title','context','instructions','completed','{}',?)`).run(id, owner.workspaceId, owner.sessionId, child, `anchor-${id}`, createdAt);
    return records.rows("WHERE id=?", id)[0];
  };
  const result = (row: TaskRow, id: string, status: TaskStatus = "completed", report = "PRIVATE_REPORT_PAYLOAD") => {
    const runId = `run-${id}`;
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,?,'{}',10,30)").run(runId, row.sessionId, status);
    const value: TaskResult = { id, taskId: row.id, runId, status, report, reason: null, startedAt: 10, endedAt: 30, unfinished: [], sideEffects: "" };
    store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(id, row.id, runId, JSON.stringify(value));
    return value;
  };
  const input = (row: TaskRow, id: string, at: number, state: TaskInputState = "queued") => {
    store.db.prepare("INSERT INTO task_input_receipts(inputId,taskId,runId,state,error,updatedAt) VALUES(?,?,NULL,?,NULL,?)").run(id, row.id, state, at);
  };
  return { root, store, records, scope, session, task, result, input };
}
