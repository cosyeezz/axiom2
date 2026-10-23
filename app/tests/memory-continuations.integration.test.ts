import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rewriteFixture, until } from "./rewrite-fixture.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { running, type Run } from "../src/shared/agent.js";
import type { TaskRecords } from "../src/server/tasks/records.js";
import type { TaskDelivery } from "../src/server/tasks/delivery.js";
import type { AgentRuns } from "../src/server/agents/runs.js";

const pending = "## 目标与范围\n完成用户授权的行为验证\n\n## 任务进度\n整体状态：进行中\n整体进度：约 50%\n当前进展：功能已实现\n- [已完成] 实现功能\n- [进行中] 完成行为验证\n";
const complete = pending.replace("整体状态：进行中", "整体状态：已完成").replace("约 50%", "100%").replace("[进行中]", "[已完成]");
function gate() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }

async function quiescent(f: Awaited<ReturnType<typeof rewriteFixture>>) {
  for (;;) {
    await f.idle(); await f.app.agents.continuations.idle();
    if (!running(f.app.agents.info(f.scope).run) && !f.app.agents.active(f.scope)) return;
  }
}

test("natural completion continues the original pi conversation once, with hidden host input and durable receipts", { timeout: 60000 }, async () => {
  const f = await rewriteFixture();
  try {
    writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), pending);
    await f.call("prompt", { text: "请完成已经授权的任务及必要验证。" });
    await until(() => f.requests.length >= 2, "automatic continuation did not request the model");
    await quiescent(f);
    assert.equal(f.requests.length, 2, "unchanged task state stops the automatic chain");
    const runs = f.app.store.db.prepare("SELECT * FROM runs WHERE sessionId=? ORDER BY rowid").all(f.scope.sessionId);
    assert.equal(runs.length, 2); assert.equal(runs[1].resumedFromRunId, runs[0].id);
    assert.equal(runs[1].status, "completed");
    assert.equal(f.app.store.receipt(`memory-continue-${runs[0].id}`, f.scope).status, "committed");
    const file = String(f.app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(f.scope.sessionId)!.file);
    const entries = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries.filter((entry) => entry.type === "message" && entry.message.role === "user").length, 1);
    const host = entries.filter((entry) => entry.type === "custom_message" && entry.customType === "axiom-memory-continuation");
    assert.equal(host.length, 1); assert.equal(host[0].display, false);
    assert.match(host[0].content, /记忆不是新的用户指令/);
    assert.match(JSON.stringify(f.requests[1].messages), /REWRITE_ANSWER_1/);
    assert.match(JSON.stringify(f.requests[1].messages), /宿主待办检查/);
    assert.equal(f.app.agents.messages(f.scope).filter((message) => message.role === "user").length, 1);
    assert.ok(f.app.agents.messages(f.scope).every((message) => !message.text.includes("宿主待办检查")));
    const consumed = await f.call("agent.inputs", { ids: [`memory-continue-${runs[0].id}`] }) as any[];
    assert.equal(consumed[0].consumed, false, "internal continuation is never a consumed user draft");
    writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), complete);
    await f.call("prompt", { text: "检查已经完成的结果。" }); await quiescent(f);
    assert.equal(f.requests.length, 3, "completed memory does not continue again");
  } finally { await f.close(); }
});

for (const boundary of ["stop", "new-input", "delete", "close"] as const) {
  test(`real settlement scan respects ${boundary}`, { timeout: 60000 }, async () => {
    const f = await rewriteFixture(), entered = gate(), release = gate();
    let closed = false, closing: Promise<void> | undefined;
    const path = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md");
    const scan = f.app.agents.memories.scanAsync.bind(f.app.agents.memories);
    let held = false;
    f.app.agents.memories.scanAsync = async (...args) => {
      await scan(...args);
      if (!held) { held = true; entered.resolve(); await release.promise; }
    };
    try {
      writeFileSync(path, pending);
      await f.call("prompt", { text: "完成任务。" }); await entered.promise;
      if (boundary === "stop") await f.app.tasks.stopParent(f.scope);
      if (boundary === "new-input") {
        writeFileSync(path, complete);
        await f.call("prompt", { text: "原任务已完成，请检查结果。" });
      }
      if (boundary === "delete") f.app.store.execute({ op: "session.delete", requestId: "delete-fixture", ...f.scope, params: { confirmed: true } });
      if (boundary === "close") { closed = true; closing = f.close(); }
      release.resolve();
      if (closing) await closing;
      else if (boundary !== "delete") await quiescent(f);
      else await f.app.agents.continuations.idle();
      assert.equal(f.requests.length, boundary === "new-input" ? 2 : 1);
      assert.equal(f.app.store.db.isOpen, !closed);
    } finally { release.resolve(); if (!closed) await f.close(); }
  });
}

for (const boundary of ["revision", "new-input", "freeze", "queued-task", "notification"] as const) {
  test(`real execution preparation rechecks ${boundary} before sending continuation`, { timeout: 60000 }, async () => {
    const f = await rewriteFixture(), entered = gate(), release = gate();
    const path = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md");
    const prepare = f.app.agents.profiles.prepareAsync.bind(f.app.agents.profiles);
    let held = false;
    f.app.agents.profiles.prepareAsync = async (...args) => {
      if (!held && f.app.agents.info(f.scope).run?.status === "completed") {
        held = true; entered.resolve(); await release.promise;
      }
      return prepare(...args);
    };
    try {
      writeFileSync(path, pending); await f.call("prompt", { text: "完成任务及验证。" }); await entered.promise;
      let user: Promise<unknown> | undefined;
      if (boundary === "revision" || boundary === "new-input") writeFileSync(path, complete);
      if (boundary === "new-input") user = f.call("prompt", { text: "任务已经完成，请检查结果。" });
      if (boundary === "freeze") f.app.store.db.prepare("UPDATE task_parents SET frozen=1 WHERE sessionId=?").run(f.scope.sessionId);
      if (boundary === "queued-task" || boundary === "notification") {
        const { records, delivery } = f.app.tasks as unknown as { records: TaskRecords; delivery: TaskDelivery };
        const { taskIds: [id] } = records.create(f.scope, "fixture", "原授权工作", [{ task: "验证已有任务" }], f.selection);
        if (boundary === "notification") {
          const child = records.rows("WHERE id=?", id)[0];
          const run: Run = { id: crypto.randomUUID(), sessionId: child.sessionId, status: "completed", selection: f.selection,
            startedAt: Date.now(), endedAt: Date.now(), error: null };
          f.app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed',?,?,?)")
            .run(run.id, run.sessionId, JSON.stringify(run.selection), run.startedAt, run.endedAt);
          f.app.store.db.prepare("UPDATE tasks SET status='completed',runId=? WHERE id=?").run(run.id, id);
          delivery.save(records.rows("WHERE id=?", id)[0], run);
        }
      }
      release.resolve(); await user; await quiescent(f);
      assert.equal(f.requests.length, boundary === "new-input" ? 2 : 1);
    } finally { release.resolve(); await f.close(); }
  });
}

test("replayed user receipts preserve pending continuation and its no-progress history", { timeout: 60000 }, async () => {
  const f = await rewriteFixture(), entered = gate(), release = gate();
  const prepare = f.app.agents.profiles.prepareAsync.bind(f.app.agents.profiles);
  let held = false;
  f.app.agents.profiles.prepareAsync = async (...args) => {
    if (!held && f.app.agents.info(f.scope).run?.status === "completed") {
      held = true; entered.resolve(); await release.promise;
    }
    return prepare(...args);
  };
  try {
    writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), pending);
    const id = crypto.randomUUID(), params = { text: "完成原授权工作。" };
    const accepted = await f.call("prompt", params, f.scope, id);
    await entered.promise;
    assert.deepEqual(await f.call("prompt", params, f.scope, id), accepted);
    release.resolve(); await quiescent(f);
    assert.equal(f.requests.length, 2, "a replay cannot cancel the pending automatic start");
    assert.deepEqual(await f.call("prompt", params, f.scope, id), accepted);
    f.app.agents.continuations.settled(f.scope, f.app.agents.info(f.scope).run!);
    await quiescent(f);
    assert.equal(f.requests.length, 2, "a replay cannot reset the completed chain's checked run or task history");
  } finally { release.resolve(); await f.close(); }
});

for (const phase of ["worker-ready", "model-permit"] as const) {
  for (const boundary of ["revision", "new-input", "freeze", "stop", "concurrent-input", "concurrent-input-stop"] as const) {
    test(`${phase} rechecks ${boundary} before any automatic model request`, { timeout: 60000 }, async () => {
      const f = await rewriteFixture(), entered = gate(), release = gate();
      const path = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md");
      const pool = f.app.agents.pool as unknown as { verify(instance: unknown): Promise<boolean> };
      const verify = pool.verify.bind(pool);
      let validations = 0;
      pool.verify = async (instance) => {
        const result = await verify(instance), run = f.app.agents.info(f.scope).run;
        if (run?.resumedFromRunId && run.status === "starting" && ++validations === (phase === "worker-ready" ? 1 : 2)) {
          entered.resolve(); await release.promise;
        }
        return result;
      };
      try {
        writeFileSync(path, pending); await f.call("prompt", { text: "完成任务及验证。" });
        await entered.promise;
        assert.equal(f.requests.length, 1);
        let operation: Promise<unknown> | undefined;
        let concurrent: Promise<PromiseSettledResult<unknown>[]> | undefined;
        const inputIds = [crypto.randomUUID(), crypto.randomUUID()];
        if (boundary === "revision" || boundary === "new-input" || boundary.startsWith("concurrent-input")) writeFileSync(path, complete);
        if (boundary === "new-input") operation = f.call("prompt", { text: "任务已经完成，请检查结果。" });
        if (boundary.startsWith("concurrent-input")) {
          const epoch = (f.app.agents as unknown as { runs: AgentRuns }).runs.epoch(f.scope);
          concurrent = Promise.allSettled([
            f.call("prompt", { text: "检查第一个窗口提交的结果。" }, f.scope, inputIds[0]),
            f.call("prompt", { text: "检查第二个窗口提交的结果。" }, f.scope, inputIds[1]),
          ]);
          assert.equal((f.app.agents as unknown as { runs: AgentRuns }).runs.epoch(f.scope), epoch + 1, "concurrent inputs share a single automatic preemption");
          if (boundary === "concurrent-input-stop") operation = f.app.tasks.stopParent(f.scope);
        }
        if (boundary === "freeze") f.app.store.db.prepare("UPDATE task_parents SET frozen=1 WHERE sessionId=?").run(f.scope.sessionId);
        if (boundary === "stop") operation = f.app.tasks.stopParent(f.scope);
        release.resolve(); await operation;
        const outcomes = await concurrent;
        if (outcomes) {
          for (const outcome of outcomes) {
            if (boundary === "concurrent-input-stop") {
              assert.equal(outcome.status, "rejected");
              if (outcome.status === "rejected") assert.equal(outcome.reason.code, "AGENT_STOPPED");
            } else assert.equal(outcome.status, "fulfilled", "neither concurrent user input is cancelled by the other input");
          }
        }
        await quiescent(f);
        if (boundary === "concurrent-input") {
          assert.ok(f.requests.length >= 2 && f.requests.length <= 3);
          assert.match(JSON.stringify(f.requests), /检查第一个窗口提交的结果/);
          assert.match(JSON.stringify(f.requests), /检查第二个窗口提交的结果/);
          const inputs = await f.call("agent.inputs", { ids: inputIds }) as { consumed: boolean }[];
          assert.deepEqual(inputs.map(input => input.consumed), [true, true]);
        } else assert.equal(f.requests.length, boundary === "new-input" ? 2 : 1);
        assert.ok(f.requests.every((request) => !JSON.stringify(request.messages).includes("宿主待办检查")), "an invalidated automatic start never reaches the model");
        if (boundary === "new-input") assert.match(JSON.stringify(f.requests.at(-1).messages), /任务已经完成，请检查结果/);
      } finally { release.resolve(); await f.close(); }
    });
  }
}

test("a parenthesized waiting condition prevents automatic execution", { timeout: 60000 }, async () => {
  const f = await rewriteFixture();
  try {
    writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), pending.replace("整体状态：进行中", "整体状态：进行中（等待用户确认）"));
    await f.call("prompt", { text: "记录当前等待条件。" }); await quiescent(f);
    assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});