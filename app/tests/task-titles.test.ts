import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { TaskCommands } from "../src/server/tasks/commands.js";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { taskTools } from "../src/server/task-tools.js";
import { boundedMessage } from "../src/server/transcript.js";
import { taskCallPreview, toolSummary } from "../src/shared/tool-summary.js";
import type { Agents } from "../src/server/agents.js";
import type { TaskScheduler } from "../src/server/tasks/scheduler.js";
import type { TaskDelivery } from "../src/server/tasks/delivery.js";
import type { Run, Selection } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-task-titles-"));
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const selection: Selection = { provider: "fixture", id: "fixture", thinking: "off" };
  const run: Run = { id: randomUUID(), sessionId: session.id, status: "running", selection, startedAt: 1, endedAt: null, error: null };
  const records = new TaskRecords(store);
  const appended: unknown[] = [];
  const agents = { info: () => ({ run }), active: () => true } as unknown as Agents;
  const scheduler = { closing: false, append: (_row: unknown, p: unknown) => { appended.push(p); return { status: "queued" }; } } as unknown as TaskScheduler;
  const commands = new TaskCommands(agents, records, scheduler, {} as TaskDelivery, async () => {});
  let closed = false;
  const closeStore = () => { if (!closed) { store.close(); closed = true; } };
  return { root, store, scope, selection, run, records, appended, commands, closeStore,
    close: () => { closeStore(); rmSync(root, { recursive: true, force: true }); } };
}

test("task titles migrate, persist separately and preserve complete child instructions", () => {
  const f = fixture();
  try {
    const title = "核对取消后的进程清理", task = "完整任务\n" + "保留工作目录、命令及交付要求。".repeat(100);
    const ids = f.records.create(f.scope, "anchor", "背景\n第二行", [{ title, task }, { task: "历史无标题任务" }], f.selection).taskIds;
    f.store.db.exec("ALTER TABLE tasks ADD COLUMN role TEXT NOT NULL DEFAULT ''");
    f.store.db.prepare("UPDATE tasks SET role=?").run("旧职责补充");
    const beforeMigration = f.records.rows().map(({ role: _role, ...row }: any) => row);
    const migrated = new TaskRecords(f.store);
    assert.ok(!f.store.db.prepare("PRAGMA table_info(tasks)").all().some(column => column.name === "role"));
    assert.deepEqual(migrated.rows().map(row => ({ ...row })), beforeMigration, "removing legacy roles preserves all other task data");
    assert.doesNotThrow(() => new TaskRecords(f.store), "migration is safe to repeat");
    const [current, legacy] = migrated.list(f.scope).tasks;
    assert.equal(current.title, title);
    assert.equal(current.description, task);
    assert.equal(current.context, "背景\n第二行");
    assert.equal(current.initialInputId, migrated.inputs(migrated.rows("WHERE id=?", ids[0])[0], "queued")[0].id);
    assert.equal(legacy.title, null);
    assert.equal(legacy.description, "历史无标题任务");
    assert.equal(f.store.session(f.scope.workspaceId, legacy.sessionId).title, "子任务");
    assert.equal(f.store.session(f.scope.workspaceId, current.sessionId).title, title);
    assert.equal(migrated.inputs(migrated.rows("WHERE id=?", ids[0])[0], "queued")[0].body, `任务背景:\n背景\n第二行\n\n当前任务:\n${task}`);
    // Release the service lease before simulating a restart on the same data directory.
    f.closeStore();
    const reopened = new Store(f.root);
    try {
      const restored = new TaskRecords(reopened).list(f.scope).tasks[0];
      assert.equal(restored.title, title);
      assert.equal(restored.context, current.context);
      assert.equal(restored.initialInputId, current.initialInputId);
      assert.equal(restored.description, task);
    }
    finally { reopened.close(); }
  } finally { f.close(); }
});

test("model tool schemas keep required fields and prose limits; runtime validation prevents invalid side effects", async () => {
  const f = fixture();
  try {
    const tools = taskTools(async () => ({}));
    const delegateTool = tools.find(t => t.name === "delegate")!, appendTool = tools.find(t => t.name === "append")!;
    const delegate = delegateTool.parameters as any;
    const append = appendTool.parameters as any;
    assert.deepEqual(Object.keys(delegate.properties.tasks.items.properties), ["title", "task"]);
    assert.ok(delegate.properties.tasks.items.required.includes("title"));
    assert.equal(delegate.properties.tasks.items.properties.title.maxLength, undefined);
    assert.match(delegate.properties.tasks.items.properties.title.description, /30字/);
    assert.ok(append.required.includes("summary"));
    assert.equal(append.properties.summary.maxLength, undefined);
    for (const tool of tools) assert.doesNotMatch(JSON.stringify(tool.parameters), /"(?:minLength|maxLength|minItems|maxItems|pattern|minimum|maximum)"/);
    assert.deepEqual(Object.keys(append.properties), ["taskId", "summary", "text"]);
    const read = tools.find(t => t.name === "read_result")!.parameters as any;
    assert.deepEqual(Object.keys(read.properties), ["taskId", "resultId"]);
    const cancel = tools.find(t => t.name === "cancel_task")!;
    assert.deepEqual(validateToolArguments(cancel, { type: "toolCall", id: "stop", name: "cancel_task", arguments: { taskId: "fixture" } }), { taskId: "fixture" });
    const taskId = f.records.create(f.scope, "legacy", "background", [{ task: "original task" }], f.selection).taskIds[0];
    for (const systemPrompt of ["", "旧职责补充"]) {
      const params = { context: "background", tasks: [{ title: "核验任务", task: "full instructions", systemPrompt }] };
      await assert.rejects(f.commands.tool(f.scope, f.run, "delegate", randomUUID(), params), { code: "INVALID_INPUT", message: "子任务定义包含未支持的参数" });
    }
    for (const value of [undefined, "", "   ", "字".repeat(31), "a".repeat(31), "😀".repeat(31), "a\nb", "a\rb", "a\0b", "\0", "a\n", "a\r\n"]) {
      const taskArgs: Record<string, string> = { task: "full instructions" };
      const appendArgs: Record<string, string> = { taskId, text: "complete extra instructions" };
      if (value !== undefined) { taskArgs.title = value; appendArgs.summary = value; }
      if (value === undefined) {
        assert.throws(() => validateToolArguments(delegateTool, { type: "toolCall", id: "invalid", name: "delegate", arguments: { context: "background", tasks: [taskArgs] } }));
        assert.throws(() => validateToolArguments(appendTool, { type: "toolCall", id: "invalid", name: "append", arguments: appendArgs }));
      }
      await assert.rejects(f.commands.tool(f.scope, f.run, "delegate", randomUUID(), { context: "background", tasks: [{ title: value, task: "full instructions" }] }), { code: "INVALID_INPUT" });
      await assert.rejects(f.commands.tool(f.scope, f.run, "append", randomUUID(), { taskId, summary: value, text: "complete extra instructions" }), { code: "INVALID_INPUT" });
    }
    assert.equal(f.records.list(f.scope).tasks.length, 1);
    assert.equal(f.appended.length, 0, "invalid summaries never reach queue or budget mutation");
    await assert.rejects(f.commands.tool(f.scope, f.run, "append", randomUUID(), { taskId, summary: "追加", text: "instructions", mode: "steer" }), { code: "INVALID_INPUT" });
    for (const key of ["offset", "limit"]) await assert.rejects(f.commands.tool(f.scope, f.run, "read_result", randomUUID(), { taskId, resultId: "result", [key]: 0 }), { code: "INVALID_INPUT" });
    for (const summary of ["字".repeat(30), "a".repeat(30), "😀".repeat(30)]) {
      const params = { taskId, summary, text: "完整追加正文\n" + "验证细节。".repeat(100) };
      assert.deepEqual(validateToolArguments(appendTool, { type: "toolCall", id: "valid", name: "append", arguments: params }), params);
      assert.doesNotThrow(() => validateToolArguments(delegateTool, { type: "toolCall", id: "valid", name: "delegate", arguments: { context: "background", tasks: [{ title: summary, task: "full instructions" }] } }));
      await f.commands.tool(f.scope, f.run, "append", randomUUID(), params);
      assert.deepEqual(f.appended.at(-1), params);
    }
    assert.equal(f.records.list(f.scope).tasks[0].description, "original task");
  } finally { f.close(); }
});

test("bounded task snapshots retain all titles and append summary after long JSON input", () => {
  const long = "内容\n".repeat(12000);
  const message = boundedMessage({ id: "m", role: "assistant", text: "", calls: [
    { id: "d", name: "functions.delegate", input: JSON.stringify({ context: long, tasks: [{ title: "检查消息顺序", task: long }, { title: "核对连接恢复", task: long }] }) },
    { id: "a", name: "append", input: JSON.stringify({ text: long, taskId: "task-1", summary: "补查断线重连" }) },
    { id: "c", name: "cancel_task", input: JSON.stringify({ reason: long, taskId: "task-1" }) },
  ] });
  assert.equal(message.truncated, true);
  assert.throws(() => JSON.parse(message.calls![0].input));
  assert.deepEqual(taskCallPreview(message.calls![0])?.titles, ["检查消息顺序", "核对连接恢复"]);
  assert.deepEqual(taskCallPreview(message.calls![1]), { taskId: "task-1", summary: "补查断线重连" });
  assert.deepEqual(taskCallPreview(message.calls![2]), { taskId: "task-1", reason: long });
  assert.deepEqual(taskCallPreview({ id: "c", name: "cancel_task", input: JSON.stringify({ taskId: "task-1", reason: "  " }) }), { taskId: "task-1" });
  assert.deepEqual(taskCallPreview({ id: "old", name: "append", input: JSON.stringify({ taskId: "legacy", text: "旧追加正文" }) }), { taskId: "legacy", summary: "补充任务" });
  assert.deepEqual(taskCallPreview({ id: "old", name: "delegate", input: JSON.stringify({ tasks: [{ task: "旧任务正文" }] }) })?.titles, ["子任务"]);
});

test("task card copy comes verbatim from explicit fields, never from task bodies", () => {
  const title = "核查 API  参数", summary = "补查 API  边界";
  for (const prefix of ["", "functions."]) {
    const delegate = { id: "delegate", name: `${prefix}delegate`, input: JSON.stringify({ tasks: [{ title, task: "不要用这段正文做标题" }] }) };
    const append = { id: "append", name: `${prefix}append`, input: JSON.stringify({ taskId: "task-1", summary, text: "不要用这段正文做简述" }) };
    assert.deepEqual(taskCallPreview(delegate)?.titles, [title]);
    assert.equal(taskCallPreview(append)?.summary, summary);
    for (const missing of [undefined, "", "   ", 42]) {
      const oldDelegate = { ...delegate, input: JSON.stringify({ tasks: [{ title: missing, task: "旧任务正文" }] }) };
      const oldAppend = { ...append, input: JSON.stringify({ summary: missing, text: "旧追加正文" }) };
      assert.deepEqual(taskCallPreview(oldDelegate)?.titles, ["子任务"]);
      assert.equal(toolSummary(oldDelegate).target, "子任务");
      assert.equal(taskCallPreview(oldAppend)?.summary, "补充任务");
    }
  }
});
