// Exercise the product's four tools and real pi child sessions against a loopback model only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { running } from "../src/shared/agent.js";
import {
  defaultBudgets,
  taskActive,
  taskToolNames,
} from "../src/shared/tasks.js";
const wait = async (check: () => boolean, description: string, ms = 35000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error(description);
    await new Promise((r) => setTimeout(r, 30));
  }
};

test(
  "Product subagents: four tools, durable queue, isolation, notifications, cancellation, follow-up, budgets and frozen restart (loopback)",
  { timeout: 120000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-tasks-")),
      cwd = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
    mkdirSync(cwd);
    writeFileSync(join(cwd, "evidence.txt"), "read-only research evidence");
    mkdirSync(join(root, "pi"));
    const requests: any[] = [];
    let holdAll = false;
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      const names = body.tools?.map((t: any) => t.function.name) ?? [],
        all = JSON.stringify(body.messages),
        main = names.includes("delegate"),
        summary = JSON.stringify(body.messages.at(-1)).includes("工作已停止：");
      if (
        (holdAll ||
          (!main &&
            all.includes("child-B") &&
            !all.includes("explicit-followup"))) &&
        !summary
      )
        return;
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      const tool = (name: string, args: unknown, id = name + randomUUID()) => {
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        chunk({}, "tool_calls");
      };
      if (
        main &&
        !all.includes('"name":"delegate"') &&
        all.includes("delegate-fixture")
      )
        tool(
          "delegate",
          {
            context: "ONLY-SHARED-CONTEXT",
            tasks: [
              { task: "child-A: inspect evidence.txt and report suggested changes" },
              { task: "child-B: inspect only and report" },
              { task: "child-C: inspect only and report" },
            ],
          },
          "delegate-fixed",
        );
      else if (main) {
        const notice = body.messages
          .flatMap((m: any) => {
            const s =
              typeof m.content === "string"
                ? m.content
                : (m.content ?? []).map((c: any) => c.text ?? "").join("\n");
            const match = s?.match(
              /\{"taskId":"[^"]+","runId":"[^"]+","resultId":"[^"]+","status":"[^"]+"\}/,
            );
            return match ? [JSON.parse(match[0])] : [];
          })
          .at(-1);
        const called = body.messages.some((m: any) =>
          m.tool_calls?.some(
            (t: any) =>
              t.function.name === "read_result" &&
              t.function.arguments.includes(notice?.resultId),
          ),
        );
        if (notice && !called)
          tool("read_result", {
            taskId: notice.taskId,
            resultId: notice.resultId,
          });
        else {
          chunk({
            role: "assistant",
            content: "Parent response; waiting for completion notices.",
          });
          chunk({}, "stop");
        }
      } else if (summary) {
        assert.equal(names.length, 0, "summary must have no tools");
        chunk({
          role: "assistant",
          content:
            "Stopped summary. Existing output only; not verified, no rollback.",
        });
        chunk({}, "stop");
      } else if (all.includes("child-A") && !all.includes('"name":"read"'))
        tool("read", { path: "evidence.txt" });
      else {
        chunk({
          role: "assistant",
          content: all.includes("explicit-followup")
            ? "Follow-up completed independently."
            : "Child complete; outputs reported, no other changes verified.",
        });
        chunk({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    writeFileSync(
      join(root, "pi", "models.json"),
      JSON.stringify({
        providers: {
          "task-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }],
          },
        },
      }),
    );
    writeFileSync(
      join(root, "pi", "auth.json"),
      JSON.stringify({ "task-fixture": { type: "api_key", key: "fixture" } }),
    );
    writeFileSync(
      join(root, "pi", "settings.json"),
      JSON.stringify({
        retry: { enabled: false },
        compaction: { enabled: false },
      }),
    );
    const start = process.env.AXIOM_TEST_COMPILED
      ? ((
          await import(new URL("../dist/server/index.js", import.meta.url).href)
        ).startServer as typeof startServer)
      : startServer;
    let app = await start({ root, port: 0 });
    try {
      const w = app.store.execute({
        requestId: randomUUID(),
        op: "workspace.open",
        params: { path: cwd, authorized: true },
      }) as Workspace;
      const s = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      const scope: Scope = { workspaceId: w.id, sessionId: s.id };
      const call = (
        op: string,
        params: Record<string, unknown> = {},
        to = scope,
        requestId = randomUUID(),
      ) => app.tasks.command({ op, params, ...to, requestId });
      await call("task.preferences.save", {
        budgets: { ...defaultBudgets, concurrency: 2 },
      });
      await call("agent.model", {
        selection: { provider: "task-fixture", id: "fixture", thinking: "off" },
      });
      await call("prompt", {
        text: "delegate-fixture. PARENT-PRIVATE must not leak into children.",
      });
      await wait(
        () => app.tasks.list(scope).tasks.length === 3,
        "delegation did not persist",
      );
      const initial = app.tasks.list(scope).tasks;
      assert.equal(
        app.store.sessions(w.id).length,
        1,
        "child sessions are not main navigation items",
      );
      assert.equal(
        initial.filter((t) => t.status === "queued").length >= 1,
        true,
      );
      const [a, b, c] = initial;
      await wait(
        () =>
          app.tasks.list(scope).tasks.find((t) => t.id === a.id)!.results
            .length === 1,
        "child A did not finish",
      );
      assert.equal(readFileSync(join(cwd, "evidence.txt"), "utf8"), "read-only research evidence");
      assert.equal(existsSync(join(cwd, "child-A.txt")), false);
      assert.ok(requests.some((body) => body.messages.some((m: any) =>
        m.role === "tool" && JSON.stringify(m.content).includes("read-only research evidence"))), "child actually read project evidence");
      await wait(
        () =>
          app.tasks.list(scope).tasks.find((t) => t.id === c.id)!.results
            .length === 1,
        "queued child C did not start",
      );
      const childRequests = requests.filter(
        (body) =>
          !(body.tools ?? []).some((t: any) => t.function.name === "delegate"),
      );
      assert.ok(childRequests.length >= 3);
      for (const body of childRequests) {
        assert.ok(!JSON.stringify(body.messages).includes("PARENT-PRIVATE"));
        assert.deepEqual(body.tools.map((t: any) => t.function.name).sort(), ["find", "grep", "ls", "read", process.platform === "win32" ? "powershell" : "bash"].sort());
        assert.ok(
          taskToolNames.every(
            (n) => !(body.tools ?? []).some((t: any) => t.function.name === n),
          ),
          "no recursive tools",
        );
      }
      const other = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      await assert.rejects(
        call(
          "task.cancel",
          { taskId: b.id },
          { workspaceId: w.id, sessionId: other.id },
        ),
        { code: "TASK_SCOPE_MISMATCH" },
      );
      const aResult = app.tasks.list(scope).tasks.find((t) => t.id === a.id)!
        .results[0];
      await assert.rejects(
        call("task.result", { taskId: b.id, resultId: aResult.id }),
        { code: "RESULT_SCOPE_MISMATCH" },
      );
      await wait(
        () =>
          requests.some((body) =>
            body.messages.some((m: any) =>
              m.tool_calls?.some((t: any) => t.function.name === "read_result"),
            ),
          ),
        "parent did not read completed result",
      );
      const cancelId = randomUUID();
      await call(
        "task.cancel",
        { taskId: b.id, reason: "Explicit test cancellation" },
        scope,
        cancelId,
      );
      await call(
        "task.cancel",
        { taskId: b.id, reason: "Explicit test cancellation" },
        scope,
        cancelId,
      );
      await wait(
        () =>
          app.tasks.list(scope).tasks.find((t) => t.id === b.id)!.results
            .length === 1,
        "forced cancellation did not finish",
      );
      const stopped = app.tasks.list(scope).tasks.find((t) => t.id === b.id)!;
      assert.equal(stopped.status, "cancelled");
      const result = app.tasks.result(scope, b.id, stopped.results[0].id);
      assert.ok(!("cleanup" in result));
      assert.equal(result.reason, "Explicit test cancellation");
      assert.ok(!requests.some((body) => JSON.stringify(body.messages.at(-1)).includes("工作已停止：")), "cancellation never asks the model for a summary");
      const boundChildFile = app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(b.sessionId)!.file;
      await call("task.append", { taskId: b.id, text: "explicit-followup" });
      await wait(
        () =>
          app.tasks.list(scope).tasks.find((t) => t.id === b.id)!.results
            .length === 2,
        "follow-up did not create new result",
      );
      assert.deepEqual(
        app.tasks.result(scope, b.id, stopped.results[0].id),
        result,
        "old result is immutable",
      );
      assert.equal(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(b.sessionId)!.file, boundChildFile, "follow-up retains the bound pi JSONL");
      const childScope = { workspaceId: w.id, sessionId: b.sessionId };
      assert.equal(app.tasks.child(childScope)!.id, b.id);
      const pool = (app.agents as any).runs;
      const cachedWorker = () => [...(app.agents.pool as any).instances.values()].find((instance: any) => instance.binding?.sessionId === b.sessionId) as any;
      const cached = cachedWorker();
      assert.ok(cached, "completed child has a reusable worker");
      assert.equal(dirname(cached.environment.modelsFile), join(root, "execution-models"));
      const previousPid = cached.child.pid;
      rmSync(cached.environment.modelsFile);
      await call("task.append", { taskId: b.id, text: "explicit-followup after missing snapshot" });
      await wait(() => app.tasks.list(scope).tasks.find((t) => t.id === b.id)!.results.length === 3,
        "follow-up after missing snapshot did not settle");
      const recovered = app.tasks.list(scope).tasks.find((t) => t.id === b.id)!;
      assert.equal(recovered.status, "completed", recovered.error ?? "follow-up failed");
      assert.notEqual(cachedWorker()?.child.pid, previousPid, "missing snapshot retires the old owner before cold start");
      assert.equal(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(b.sessionId)!.file, boundChildFile);
      assert.deepEqual(app.tasks.result(scope, b.id, stopped.results[0].id), result);
      const launchWorker = pool.launchWorker;
      pool.launchWorker = async function (target: Scope, ...args: unknown[]) {
        if (target.sessionId === b.sessionId) throw new Error("EACCES: fixture snapshot denied; api_key=sk-startup-secret");
        return launchWorker.call(this, target, ...args);
      };
      try {
        await call("task.append", { taskId: b.id, text: "explicit-followup with startup failure" });
        await wait(() => app.tasks.list(scope).tasks.find((t) => t.id === b.id)!.results.length === 4,
          "startup failure did not produce a result");
        const failed = app.tasks.list(scope).tasks.find((t) => t.id === b.id)!;
        assert.equal(failed.status, "failed");
        assert.match(failed.error!, /EACCES: fixture snapshot denied/);
        assert.doesNotMatch(failed.error!, /sk-startup-secret/);
        assert.equal(app.agents.info(childScope).run!.error, failed.error);
        assert.equal(app.tasks.result(scope, b.id, failed.results.at(-1)!.id).reason, failed.error);
        assert.ok(!requests.some((body) => JSON.stringify(body.messages).includes("explicit-followup with startup failure")),
          "failed startup never sends the input to the model");
      } finally { pool.launchWorker = launchWorker; }
      await wait(
        () => !running(app.agents.info(scope).run),
        "parent still running",
      );
      holdAll = true;
      await call("task.append", {
        taskId: b.id,
        text: "stall for parent stop",
      });
      await wait(
        () =>
          app.tasks.list(scope).tasks.find((t) => t.id === b.id)!.status ===
          "running",
        "child did not restart",
      );
      // Worker running precedes HTTP arrival. Observe the actual child request before stopping.
      const isParentRequest = (body: any) => (body.tools ?? []).some((tool: any) => tool.function.name === "delegate");
      await wait(() => requests.some((body) => !isParentRequest(body) && JSON.stringify(body.messages).includes("stall for parent stop")), "child stop fixture request did not arrive");
      const parentRunBeforeStop = app.agents.info(scope).run!.id;
      await call("agent.stop", { runId: parentRunBeforeStop });
      const parentRequestsAfterStop = requests.filter(isParentRequest).length;
      assert.ok(app.tasks.list(scope).frozen);
      await wait(
        () =>
          !taskActive(
            app.tasks.list(scope).tasks.find((t) => t.id === b.id)!.status,
          ),
        "parent stop did not stop child",
      );
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(requests.filter(isParentRequest).length, parentRequestsAfterStop, "frozen parent must not issue another model request");
      assert.equal(app.agents.info(scope).run!.id, parentRunBeforeStop, "stop cannot create a new parent notification run");
      assert.ok(!running(app.agents.info(scope).run), "frozen parent has no active execution");
      const beforeRestart = requests.length;
      await app.close();
      app = await start({ root, port: 0 });
      assert.equal(app.tasks.list(scope).tasks.length, 3);
      assert.ok(app.tasks.list(scope).frozen);
      assert.deepEqual(
        app.tasks.result(scope, b.id, stopped.results[0].id),
        result,
      );
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(
        requests.length,
        beforeRestart,
        "restart cannot replay tasks or notices",
      );
      await app.agents.models.serial(() => app.tasks.remove({
        requestId: randomUUID(),
        op: "session.delete",
        ...scope,
        params: { confirmed: true },
      }));
      assert.throws(() => app.store.session(w.id, b.sessionId), {
        code: "SCOPE_MISMATCH",
      });
      assert.equal(readFileSync(join(cwd, "evidence.txt"), "utf8"), "read-only research evidence");
      for (const body of requests.filter((body) => !isParentRequest(body))) {
        assert.deepEqual(body.tools.map((t: any) => t.function.name).sort(), ["find", "grep", "ls", "read", process.platform === "win32" ? "powershell" : "bash"].sort(), "follow-ups retain research and test tools");
        assert.match(JSON.stringify(body.messages), /本次执行预算：\d+ms；截止时间：/, "the actual pi request contains the execution budget and deadline");
        assert.match(JSON.stringify(body.messages), /此前任务链累计执行：\d+ms/, "continuations receive the task chain's prior elapsed time");
      }
    } catch (e) {
      const artifacts = process.env.AXIOM_TEST_ARTIFACTS || "test-results";
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(
        join(artifacts, "tasks-debug.json"),
        JSON.stringify(
          {
            requests,
            tasks: app.store.db.prepare("SELECT * FROM tasks").all(),
            results: app.store.db.prepare("SELECT * FROM task_results").all(),
            runs: app.store.db.prepare("SELECT * FROM runs").all(),
          },
          null,
          2,
        ),
      );
      throw e;
    } finally {
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
