import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import type { Scope, Workspace, Session } from "../src/shared/protocol.js";
import { defaultBudgets, taskActive } from "../src/shared/tasks.js";
import { running } from "../src/shared/agent.js";
const wait = async (check: () => boolean, label: string, ms = 25000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error(label);
    await new Promise((r) => setTimeout(r, 25));
  }
};
test(
  "Task lifecycle: append/cancel tools, queue cancellation, live handoff, work deadline without summary, restart uncertainty",
  { timeout: 120000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-lifecycle-")),
      project = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
    mkdirSync(project);
    mkdirSync(join(root, "pi"));
    let app: Awaited<ReturnType<typeof startServer>>;
    const bodies: any[] = [],
      observed = new Set<string>();
    let liveTurn: () => void = () => {};
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw);
      bodies.push(body);
      const names = (body.tools ?? []).map((t: any) => t.function.name),
        main = names.includes("delegate"),
        all = JSON.stringify(body.messages),
        last = JSON.stringify(body.messages.at(-1));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      const answer = (content: string) => {
        chunk({ role: "assistant", content });
        chunk({}, "stop");
        res.end("data: [DONE]\n\n");
      };
      const tool = (name: string, args: unknown) => {
        observed.add(name);
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: randomUUID(),
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        chunk({}, "tool_calls");
        res.end("data: [DONE]\n\n");
      };
      if (main) {
        const prior = (name: string) =>
          body.messages.some((m: any) =>
            m.tool_calls?.some((c: any) => c.function.name === name),
          );
        const data = body.messages.find(
          (m: any) =>
            m.role === "tool" && JSON.stringify(m.content).includes("taskIds"),
        );
        const ids = data
          ? JSON.parse(
              typeof data.content === "string"
                ? data.content
                : data.content.map((x: any) => x.text ?? "").join(""),
            ).taskIds
          : [];
        if (!prior("delegate"))
          tool("delegate", {
            context: "Only explicit child context",
            tasks: [
              { task: "LIVE: wait for instructions" },
              { task: "QUEUE: never launch this" },
            ],
          });
        else if (!prior("append"))
          tool("append", {
            taskId: ids[0],
            text: "MODEL-APPEND",
            mode: "steer",
          });
        else if (!prior("cancel_task"))
          tool("cancel_task", {
            taskId: ids[1],
            reason: "Cancel queued child",
          });
        else answer("Parent done; notices are not polled.");
      } else if (last.includes("工作已停止：")) {
        observed.add("summary");
        answer("Unexpected stop-summary request");
      } else if (all.includes("SECOND-BUDGET")) {
        return;
      } else if (all.includes("LIVE-STEER")) answer("Live steer processed.");
      else if (last.includes("MODEL-APPEND")) answer("Model Steering processed; next safe boundary.");
      else liveTurn = () => answer("Safe turn boundary.");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    writeFileSync(
      join(root, "pi", "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [{ id: "fixture" }],
          },
        },
      }),
    );
    writeFileSync(
      join(root, "pi", "auth.json"),
      JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }),
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
    app = await start({ root, port: 0 });
    const acceptedInputs = new Set<string>();
    const taskEvent = app.tasks["event"].bind(app.tasks);
    app.tasks["event"] = (scope, run, event) => {
      taskEvent(scope, run, event);
      if (event.type === "input-accepted") acceptedInputs.add(event.id);
    };
    try {
      const w = app.store.execute({
        requestId: randomUUID(),
        op: "workspace.open",
        params: { path: project, authorized: true },
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
        id = randomUUID(),
      ) => app.tasks.command({ op, params, ...to, requestId: id });
      await call("agent.model", {
        selection: { provider: "fixture", id: "fixture", thinking: "off" },
      });
      await call("task.preferences.save", {
        budgets: {
          ...defaultBudgets,
          concurrency: 1,
          // Live handoff must not race the separate deadline scenario below.
          workMs: 60000,
        },
      });
      await call("prompt", { text: "Delegate lifecycle tests" });
      await wait(() => app.tasks.list(scope).tasks.length === 2, "no tasks");
      const [live, queued] = app.tasks.list(scope).tasks;
      await wait(
        () => app.tasks.list(scope).tasks[1].status === "cancelled",
        "queued cancel tool failed",
      );
      assert.ok(observed.has("append") && observed.has("cancel_task"));
      assert.equal(app.tasks.list(scope).tasks[1].results.length, 1);
      assert.ok(
        !bodies.some(
          (b) =>
            !(b.tools ?? []).some((x: any) => x.function.name === "delegate") &&
            JSON.stringify(b.messages).includes("QUEUE:"),
        ),
      );
      await wait(
        () =>
          bodies.some(
            (b) =>
              !(b.tools ?? []).some(
                (x: any) => x.function.name === "delegate",
              ) && JSON.stringify(b.messages).includes("LIVE:"),
          ),
        "child did not start",
      );
      const runId = app.tasks.list(scope).tasks[0].runId;
      const steering = await call("task.append", {
        taskId: live.id,
        text: "LIVE-STEER",
        mode: "steer",
      }) as { inputId: string };
      await wait(
        () => acceptedInputs.has(steering.inputId),
        "live steer did not reach pi",
      );
      liveTurn();
      await wait(
        () => app.tasks.list(scope).tasks[0].results.length === 1,
        "live handoff did not finish",
      );
      assert.ok(
        bodies.some((b) => JSON.stringify(b.messages).includes("LIVE-STEER")),
      );
      assert.equal(
        app.tasks.list(scope).tasks[0].runId,
        runId,
        "live append must not replace run budget",
      );
      await wait(() => !running(app.agents.info(scope).run), "parent idle");
      await call("agent.stop", { runId: app.agents.info(scope).run!.id });
      await call("task.preferences.save", {
        budgets: { ...defaultBudgets, concurrency: 1, workMs: 20000 },
      });
      await call("task.append", { taskId: live.id, text: "SECOND-BUDGET" });
      await wait(
        () => app.tasks.list(scope).tasks[0].results.length === 2,
        "hard deadline did not stop",
      );
      assert.ok(!observed.has("summary"), "work deadline must not request a summary");
      assert.equal(app.tasks.list(scope).tasks[0].status, "cancelled");
      const result = app.tasks.result(
        scope,
        live.id,
        app.tasks.list(scope).tasks[0].results[1].id,
      );
      assert.match(result.reason ?? "", /预算|时限|截止/);
      assert.ok(!("cleanup" in result));
      // Retrying cancellation does not produce another result; stale input is discarded on restart.
      await call("task.cancel", { taskId: live.id });
      assert.equal(app.tasks.list(scope).tasks[0].results.length, 2);
      app.store.db
        .prepare("INSERT INTO task_inputs VALUES(?,?,?,'steer','inflight',?,?)")
        .run(
          randomUUID(),
          live.id,
          "UNCERTAIN-INPUT",
          result.runId,
          Date.now(),
        );
      const before = bodies.length;
      await app.close();
      app = await start({ root, port: 0 });
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(bodies.length, before);
      assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM task_inputs WHERE taskId=?").get(live.id)!.n, 0, "restart discards undelivered input, never creates a recovery queue");
      await assert.rejects(call("task.pending", { taskId: live.id }), { code: "UNKNOWN_OPERATION" });
      assert.ok(app.tasks.list(scope).frozen);
      assert.ok(!app.tasks.list(scope).tasks.some((t) => taskActive(t.status)));
      // Explicit fresh work remains possible after freeze without a recovery gate.
      await call("task.append", {
        taskId: live.id,
        text: "SECOND-BUDGET timeout",
      });
      await wait(
        () => app.tasks.list(scope).tasks[0].results.length === 3,
        "fresh work budget did not settle",
        25000,
      );
      assert.equal(app.tasks.list(scope).tasks[0].status, "cancelled");
      assert.deepEqual(app.tasks.result(scope, live.id, result.id), result);
      assert.ok(!observed.has("summary"), "neither deadline may start summary work");
      assert.equal(app.tasks.list(scope).tasks[1].id, queued.id);
      // Stop wins over a prompt waiting for the config writer; a late acknowledgement must not unfreeze it.
      let release!: () => void;
      const lock = app.agents.models.serial(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      );
      await wait(() => !!release, "configuration lock unavailable");
      const raced = call("prompt", { text: "must not start after Stop" });
      const rejected = assert.rejects(raced, { code: "AGENT_STOPPED" });
      await app.tasks.stopParent(scope);
      release();
      await lock;
      await rejected;
      assert.ok(app.tasks.list(scope).frozen);
    } catch (e) {
      mkdirSync("test-results", { recursive: true });
      writeFileSync(
        "test-results/lifecycle-debug.json",
        JSON.stringify(
          {
            bodies,
            tasks: app.store.db.prepare("SELECT * FROM tasks").all(),
            inputs: app.store.db.prepare("SELECT * FROM task_inputs").all(),
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
