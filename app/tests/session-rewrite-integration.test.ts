import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { rewriteFixture, until } from "./rewrite-fixture.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { taskActive } from "../src/shared/tasks.js";
import type { EditableMessage } from "../src/shared/rewrite.js";

test("real worker rewrites context, rejects busy/stale edits, persists branch and deduplicates requests", { timeout: 90000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "KEEP_FIRST" }); await f.idle();
    await f.call("prompt", { text: "REPLACE_SECOND" }); await f.idle();
    const message = f.app.agents.messages(f.scope).filter((m) => m !== null).find((m) => m.text === "REPLACE_SECOND")!;
    const source = await f.call("agent.editable", { messageId: message.id }) as EditableMessage;
    await f.call("prompt", { text: "DISCARD_THIRD" }); await f.idle();
    const file = String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)!.file);
    const before = readFileSync(file, "utf8");
    await assert.rejects(f.call("prompt", { text: "stale", rewrite: { messageId: source.messageId, revision: source.revision } }), { code: "REWRITE_CONFLICT" });
    assert.equal(readFileSync(file, "utf8"), before);
    const fresh = await f.call("agent.editable", { messageId: message.id }) as EditableMessage;
    const requestId = randomUUID(), params = { text: "NEW_SECOND", rewrite: { messageId: fresh.messageId, revision: fresh.revision } };
    const first = await f.call("prompt", params, f.scope, requestId);
    await f.idle();
    const count = f.requests.length;
    assert.deepEqual(await f.call("prompt", params, f.scope, requestId), first);
    assert.equal(f.requests.length, count);
    const context = JSON.stringify(f.requests.at(-1).messages);
    assert.match(context, /KEEP_FIRST/); assert.match(context, /NEW_SECOND/); assert.match(context, /REWRITE_ANSWER_1/);
    assert.doesNotMatch(context, /REPLACE_SECOND|DISCARD_THIRD|REWRITE_ANSWER_2|REWRITE_ANSWER_3/);
    assert.deepEqual(f.app.agents.messages(f.scope).filter((m) => m !== null).filter((m) => m.role === "user").map((m) => m.text), ["KEEP_FIRST", "NEW_SECOND"]);
    assert.doesNotMatch(JSON.stringify(SessionManager.open(file).buildSessionContext().messages), /REPLACE_SECOND|DISCARD_THIRD/);
    assert.match(readFileSync(file, "utf8"), /DISCARD_THIRD/);
    f.stall(true);
    await f.call("prompt", { text: "busy" });
    await assert.rejects(f.call("agent.editable", { messageId: message.id }), { code: "REWRITE_BUSY" });
    await f.app.tasks.stopParent(f.scope); await f.idle();
  } finally { await f.close(); }
});

test("child rewrite uses scheduler and discarded parent results survive notification reconciliation", { timeout: 90000 }, async () => {
  const f = await rewriteFixture();
  try {
    await f.call("prompt", { text: "PARENT_OLD" }); await f.idle();
    const records = new TaskRecords(f.app.store);
    records.freeze(f.scope);
    const { taskIds: [id] } = records.create(f.scope, "fixture-delegate", "fixture context", [{ task: "CHILD_OLD", role: "" }], f.selection);
    // Seed a completed delegation, then exercise user input via the real scheduler.
    f.app.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(id);
    f.app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(id);
    const child = target(records.rows("WHERE id=?", id)[0]);
    await f.call("prompt", { text: "CHILD_FIRST" }, child);
    await until(() => !taskActive(records.rows("WHERE id=?", id)[0].status), "first child input did not finish");
    const m = f.app.agents.messages(child).filter((m) => m !== null).find((m) => m.role === "user" && m.text.endsWith("CHILD_FIRST"))!;
    assert.ok(m);
    const source = await f.call("agent.editable", { messageId: m.id }, child) as EditableMessage;
    assert.equal(source.draft.text, "CHILD_FIRST", "budget control never enters the editable draft");
    await f.call("prompt", { text: "CHILD_NEW", rewrite: { messageId: source.messageId, revision: source.revision } }, child);
    await until(() => !taskActive(records.rows("WHERE id=?", id)[0].status), "child rewrite did not finish");
    assert.equal(records.rows("WHERE id=?", id)[0].status, "completed");
    assert.deepEqual(f.app.agents.messages(child).filter((m) => m !== null).filter((m) => m.role === "user").map((m) => m.text), ["CHILD_NEW"]);
    assert.match(JSON.stringify(f.requests.at(-1).messages), /CHILD_NEW/);
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /CHILD_FIRST/);
    assert.equal((JSON.stringify(f.requests.at(-1).messages).match(/本次执行预算/g) ?? []).length, 1, "only the active budget reaches the provider");
    const results = f.app.store.db.prepare("SELECT id,body FROM task_results WHERE taskId=?").all(id);
    assert.equal(results.length, 2);
    const original = f.app.agents.messages(f.scope).filter((m) => m !== null).find((m) => m.text === "PARENT_OLD")!;
    const edit = await f.call("agent.editable", { messageId: original.id }) as EditableMessage;
    await f.call("prompt", { text: "PARENT_NEW", rewrite: { messageId: edit.messageId, revision: edit.revision } }); await f.idle();
    assert.deepEqual(f.app.store.db.prepare("SELECT delivery FROM task_results WHERE taskId=?").all(id).map((r) => r.delivery), ["discarded", "discarded"]);
    // Simulate SQLite not having received the JSONL suppression before a crash.
    f.app.store.db.prepare("UPDATE task_results SET delivery='pending' WHERE taskId=?").run(id);
    const recovered = new TaskDelivery(f.app.agents, records);
    recovered.reconcilePending(f.scope);
    recovered.acknowledge(f.scope, results.map((r) => String(r.id)));
    assert.deepEqual(f.app.store.db.prepare("SELECT delivery FROM task_results WHERE taskId=?").all(id).map((r) => r.delivery), ["discarded", "discarded"]);
    for (const result of results) assert.equal(f.app.store.db.prepare("SELECT body FROM task_results WHERE id=?").get(result.id)!.body, result.body);
    await recovered.close();
    const latest = f.app.agents.messages(f.scope).find((item) => item?.text === "PARENT_NEW")!;
    assert.ok(latest);
    const failedEdit = await f.call("agent.editable", { messageId: latest.id }) as EditableMessage;
    const requestId = randomUUID();
    await assert.rejects(f.app.agents.command({ requestId, op: "prompt", ...f.scope,
      params: { text: "NOT_DISPATCHED", rewrite: { messageId: failedEdit.messageId, revision: failedEdit.revision } } },
    { onStart: () => { throw new Error("fixture startup refusal"); } }),
    (error: any) => error.code === "REWRITE_APPLIED_NOT_SENT" && error.message.includes("对话已回滚"));
    assert.equal(f.app.store.receipt(requestId, f.scope).status, "failed");
    assert.equal(f.app.agents.messages(f.scope).filter((item) => item?.role === "user").length, 0);
    assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /NOT_DISPATCHED/);
  } finally { await f.close(); }
});
