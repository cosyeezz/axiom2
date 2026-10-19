// Product worker/HTTP/WS integration with an isolated loopback model, not remote-provider acceptance.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TaskRecords } from "../src/server/tasks/records.js";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { running } from "../src/shared/agent.js";
import { parseMemory } from "../src/shared/memory.js";
const wait = async (check: () => boolean, message: string, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error(message);
    await new Promise((r) => setTimeout(r, 30));
  }
};
test(
  "Product main agent: isolated workers, real pi write/read tools, cancellation, selections, durable recovery and no replay (loopback)",
  { timeout: 90000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-agent-")),
      project = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
    mkdirSync(project);
    mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
    mkdirSync(join(project, ".pi", "skills", "fixture-skill"), { recursive: true });
    writeFileSync(join(project, ".pi", "APPEND_SYSTEM.md"), "PROJECT_PROMPT_DEFAULT_TRUST");
    writeFileSync(join(project, ".pi", "skills", "fixture-skill", "SKILL.md"),
      "---\nname: fixture-skill\ndescription: Default-trust test skill\n---\nFixture skill instructions.\n");
    writeFileSync(join(project, ".pi", "extensions", "fixture.ts"),
      `export default function (pi) {
        pi.on("before_agent_start", (event) => ({
          systemPrompt: event.systemPrompt + "\\nPROJECT_EXTENSION_EFFECTIVE_PROMPT"
        }));
      }`);
    mkdirSync(join(root, "pi"));
    let count = 0,
      stall = false,
      providerFailure = false;
    const requests: any[] = [];
    let memoryPath = "";
    const observedProgress: (number | null)[] = [];
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      count++;
      if (count === 3 || count === 4) observedProgress.push(parseMemory(readFileSync(memoryPath, "utf8")).percent);
      if (providerFailure) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unsupported parameter: temperature; api_key=sk-fixture-secret", type: "invalid_request_error", code: "unsupported_parameter" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      if (stall) return;
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (count === 1) {
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "write-fixture",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  path: "verified.txt",
                  content: "真实工具写入\n",
                }),
              },
            },
            { index: 1, id: "read-memory", type: "function", function: { name: "read", arguments: JSON.stringify({ path: memoryPath }) } },
          ],
        });
        chunk({}, "tool_calls");
      } else if (count === 2) {
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "read-fixture",
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({ path: "verified.txt" }),
              },
            },
            { index: 1, id: "start-memory", type: "function", function: { name: "edit", arguments: JSON.stringify({ path: memoryPath, edits: [
              { oldText: "## 目标与范围\n尚未记录", newText: "## 目标与范围\n验证真实文件工具与进度更新" },
              { oldText: "整体状态：尚未记录\n整体进度：待评估\n当前进展：尚未记录", newText: "整体状态：进行中\n整体进度：约 50%\n当前进展：验证文件编辑" },
            ] }) } },
          ],
        });
        chunk({}, "tool_calls");
      } else if (count === 3) {
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "edit:fixture",
              type: "function",
              function: {
                name: "edit",
                arguments: JSON.stringify({
                  path: "verified.txt",
                  oldText: "真实工具写入",
                  newText: "真实工具编辑",
                }),
              },
            },
            {
              index: 1,
              id: "shell:fixture",
              type: "function",
              function: {
                name: process.platform === "win32" ? "powershell" : "bash",
                arguments: JSON.stringify({
                  command: "echo axiom-command-verified",
                  timeout: 10,
                }),
              },
            },
            { index: 2, id: "complete-memory", type: "function", function: { name: "edit", arguments: JSON.stringify({ path: memoryPath, edits: [
              { oldText: "整体状态：进行中\n整体进度：约 50%\n当前进展：验证文件编辑", newText: "整体状态：已完成\n整体进度：100%\n当前进展：真实工具回环已完成" },
            ] }) } },
          ],
        });
        chunk({}, "tool_calls");
      } else {
        chunk({ role: "assistant", content: "**已完成**，工具结果已核对。" });
        chunk({}, "stop");
      }
      res.write(
        `data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    const config = {
      providers: {
        "axiom-product-fixture": {
          api: "openai-completions",
          baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
          models: [
            {
              id: "fixture",
              name: "Fixture",
              cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
              contextWindow: 32000,
              maxTokens: 1000,
            },
          ],
        },
      },
    };
    writeFileSync(join(root, "pi", "models.json"), JSON.stringify(config));
    writeFileSync(
      join(root, "pi", "auth.json"),
      JSON.stringify({
        "axiom-product-fixture": {
          type: "api_key",
          key: "product-fixture-not-a-secret",
        },
      }),
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
        params: { path: project, authorized: true },
      }) as Workspace;
      const s = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      const scope: Scope = { workspaceId: w.id, sessionId: s.id };
      memoryPath = join(root, "memory", "sessions", s.id, "MEMORY.md");
      // Legacy explicit denials no longer gate this product's default authorization.
      app.store.db.exec("CREATE TABLE IF NOT EXISTS project_trust(workspaceId TEXT PRIMARY KEY, trusted INTEGER NOT NULL)");
      app.store.db.prepare("INSERT INTO project_trust VALUES(?,0)").run(w.id);
      const call = (
        op: string,
        params = {},
        target = scope,
        requestId = randomUUID(),
      ) => app.agents.command({ op, params, ...target, requestId });
      await assert.rejects(call("prompt", { text: "no model" }), {
        code: "MODEL_UNAVAILABLE",
      });
      await assert.rejects(
        call("agent.model", {
          selection: {
            provider: "unconfigured",
            id: "fixture",
            thinking: "off",
          },
        }),
        { code: "MODEL_UNAVAILABLE" },
      );
      await call("agent.model", {
        selection: {
          provider: "axiom-product-fixture",
          id: "fixture",
          thinking: "off",
        },
      });
      const requestId = randomUUID(),
        params = {
          text: "Create and read verified.txt",
          attachment: { name: "context.ts", text: "// captured attachment" },
        };
      // Reproduce a just-settled child's refresh before a cold main prompt.
      // It must not reject this request or cause the model to receive it twice.
      const records = new TaskRecords(app.store);
      const child = records.create(scope, "settled-child", "context", [{ task: "finished child", role: "" }],
        { provider: "axiom-product-fixture", id: "fixture", thinking: "off" });
      app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(child.taskIds[0]);
      const childSessionId = String(app.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(child.taskIds[0])!.sessionId);
      await app.agents.memories.scanAsync(scope);
      app.agents.memories.refresh({ ...scope, sessionId: childSessionId });
      const accepted = await call("prompt", params, scope, requestId);
      assert.deepEqual(
        await call("prompt", params, scope, requestId),
        accepted,
      );
      await assert.rejects(
        call("prompt", { text: "conflict" }, scope, requestId),
        { code: "REQUEST_CONFLICT" },
      );
      await wait(
        () => !running(app.agents.info(scope).run),
        "worker did not finish",
      );
      assert.equal(
        app.agents.info(scope).run!.status,
        "completed",
        JSON.stringify(app.agents.info(scope)),
      );
      assert.equal(
        readFileSync(join(project, "verified.txt"), "utf8"),
        "真实工具编辑\n",
      );
      assert.equal(count, 4);
      assert.deepEqual(observedProgress, [50, 100], "real pi file edits update progress during work and at completion");
      app.agents.memories.scan();
      assert.equal(app.agents.memories.view(scope).progress.percent, 100);
      const assertMemoryPrompt = (request: any, path: string) => {
        const system = request.messages.filter((message: any) => message.role === "system").map((message: any) => JSON.stringify(message.content)).join("\n");
        assert.ok(system.includes(JSON.stringify(path).slice(1, -1)), "actual provider payload includes the bound memory path");
        assert.match(system, /首次接到明确任务时/);
        assert.match(system, /最终回复前同步/);
        assert.match(system, /不要仅因等待用户查看而保留90%/);
      };
      assertMemoryPrompt(requests[0], memoryPath);
      assert.ok(
        app.agents
          .thread(scope)
          .ids.some((id) =>
            app.agents
              .message(scope, id)
              ?.text.includes("axiom-command-verified"),
          ),
      );
      const ids = app.agents.thread(scope).ids;
      assert.ok(
        ids.some((id) => app.agents.message(scope, id)?.toolName === "write"),
      );
      assert.ok(
        ids.some((id) => app.agents.message(scope, id)?.toolName === "read"),
      );
      assert.ok(
        ids.some((id) =>
          app.agents.message(scope, id)!.text.includes("已完成"),
        ),
      );
      assert.ok(
        requests[0].messages.some((m: any) =>
          JSON.stringify(m).includes("captured attachment"),
        ),
      );
      assert.ok(app.agents.info(scope).usage!.total > 0);
      const environment = app.agents.info(scope).environment!;
      assert.ok(environment.tools.includes("write"));
      assert.ok(environment.skills.includes("fixture-skill"));
      assert.match(environment.systemPrompt!, /PROJECT_PROMPT_DEFAULT_TRUST/);
      assert.match(environment.systemPrompt!, /PROJECT_EXTENSION_EFFECTIVE_PROMPT/);
      assert.ok(!environment.warnings.some((warning) => warning.includes("尚未授权")));
      assert.ok(requests[0].messages.some((message: any) =>
        message.role === "system" && JSON.stringify(message.content).includes("PROJECT_EXTENSION_EFFECTIVE_PROMPT")));
      await assert.rejects(call("agent.trust", { trusted: false, confirmed: true }), { code: "UNKNOWN_OPERATION" });
      const runs = (app.agents as any).runs;
      await wait(() => app.agents.pool.hasAffinity(scope.sessionId), "completed session was not retained warm");
      const warmInstance = [...(app.agents.pool as any).instances.values()]
        .find((instance: any) => instance.binding?.sessionId === scope.sessionId) as any;
      const warmPid = warmInstance.child.pid;
      stall = true;
      await call("prompt", { text: "stall" });
      await wait(() => count === 5, "stall did not start");
      assertMemoryPrompt(requests[4], memoryPath);
      assert.equal(runs.live.get(scope.sessionId).child.pid, warmPid, "next prompt reuses the live pi worker");
      assert.equal(warmInstance.state, "leased", "busy worker holds an execution lease");
      const other = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      const otherScope = { workspaceId: w.id, sessionId: other.id };
      assert.equal(app.store.receipt(requestId, scope).status, "committed");
      assert.throws(() => app.store.receipt(requestId, otherScope), {
        code: "REQUEST_SCOPE_MISMATCH",
      });
      for (const op of ["agent.receipt", "agent.continue", "agent.confirm-cleanup"])
        await assert.rejects(call(op, { requestId }, scope), { code: "UNKNOWN_OPERATION" });
      await call(
        "agent.model",
        {
          selection: {
            provider: "axiom-product-fixture",
            id: "fixture",
            thinking: "off",
          },
        },
        otherScope,
      );
      await call("prompt", { text: "independent session" }, otherScope);
      await wait(() => count === 6, "second worker did not start");
      assertMemoryPrompt(requests[5], join(root, "memory", "sessions", other.id, "MEMORY.md"));
      await assert.rejects(call("agent.stop", { runId: randomUUID() }), {
        code: "RUN_MISMATCH",
      });
      assert.throws(() =>
        app.agents.thread({
          workspaceId: "foreign",
          sessionId: scope.sessionId,
        }),
      );
      await call("agent.stop", { runId: app.agents.info(scope).run!.id });
      assert.equal(app.agents.info(scope).run!.status, "cancelled");
      assert.ok(!("cleanup" in app.agents.info(scope).run!));
      assert.equal(count, 6, "stop must not ask the model for a summary");
      const boundFile = app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file;
      assert.ok(running(app.agents.info(otherScope).run));
      await call(
        "agent.stop",
        { runId: app.agents.info(otherScope).run!.id },
        otherScope,
      );
      const before = app.agents.thread(scope).ids;
      const savedPrompt = app.agents.info(scope).environment!.systemPrompt;
      await app.close();
      app = await start({ root, port: 0 });
      assert.deepEqual(app.agents.thread(scope).ids, before);
      assert.equal(app.agents.info(scope).environment!.systemPrompt, savedPrompt);
      assert.equal(count, 6, "restart must not replay");
      assert.deepEqual(
        await call("prompt", params, scope, requestId),
        accepted,
      );
      assert.equal(count, 6, "duplicate accepted request must not replay");
      stall = false;
      rmSync(memoryPath);
      await call("prompt", { text: "Fresh message after stop and restart without optional memory" });
      await wait(
        () => !running(app.agents.info(scope).run),
        "fresh prompt after stop did not finish",
      );
      assert.equal(count, 7);
      assertMemoryPrompt(requests[6], memoryPath);
      assert.equal(app.agents.info(scope).run!.status, "completed");
      assert.ok(
        !requests[6].messages.some(
          (m: any) =>
            typeof m.content === "string" &&
            m.content.includes("independent session"),
        ),
      );
      const file = app.store.db
        .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
        .get(scope.sessionId)!.file as string;
      assert.equal(file, boundFile, "fresh prompt reopens the same pi JSONL");
      const entries = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.ok(!entries.some((entry) => entry.customType === "axiom-request"), "no duplicate request transcript");
      assert.ok(requests[6].messages.some((message: any) => JSON.stringify(message).includes("captured attachment")), "context comes from the bound pi history");
      providerFailure = true;
      await call("prompt", { text: "Show the provider rejection" });
      await wait(() => !running(app.agents.info(scope).run), "provider failure did not settle");
      assert.equal(count, 8);
      const failedRun = app.agents.info(scope).run!;
      assert.equal(failedRun.status, "failed");
      assert.match(failedRun.error!, /400.*Unsupported parameter: temperature/s);
      assert.doesNotMatch(failedRun.error!, /sk-fixture-secret/);
      const failedMessage = app.agents.thread(scope).ids.map((id) => app.agents.message(scope, id))
        .find((message) => message?.status === "failed" && message.error?.includes("Unsupported parameter"));
      assert.ok(failedMessage, "failed assistant message preserves provider cause");
      assert.equal(failedMessage.error, failedRun.error);
      await app.close();
      app = await start({ root, port: 0 });
      assert.equal(app.agents.info(scope).run!.error, failedRun.error, "run cause survives restart");
      assert.equal(app.agents.message(scope, failedMessage.id)?.error, failedMessage.error, "history retains the same redacted cause");
      assert.equal(count, 8, "reading failure history must not retry");
      providerFailure = false;
      await app.close();
      writeFileSync(file, "damaged");
      app = await start({ root, port: 0 });
      assert.match(app.agents.thread(scope).error!, /损坏/);
      await assert.rejects(
        call("prompt", { text: "must not silently recover" }),
        { code: "SESSION_FILE_ERROR" },
      );
      assert.equal(readFileSync(file, "utf8"), "damaged");
      stall = true;
      await call("prompt", { text: "stop before provider logout" }, otherScope);
      await wait(() => count === 9, "revocation run did not start");
      const models = app.agents.models,
        draft = await models.read();
      await assert.rejects(
        models.save({ ...draft, providers: [], confirmLogout: true }),
        { code: "ACTIVE_RUNS_CONFIRMATION_REQUIRED" },
      );
      assert.ok(running(app.agents.info(otherScope).run));
      await models.save({
        ...draft,
        providers: [],
        confirmLogout: true,
        confirmStop: true,
      });
      assert.equal(app.agents.info(otherScope).run!.status, "cancelled");
      assert.ok(!("cleanup" in app.agents.info(otherScope).run!));
      await assert.rejects(
        call("prompt", { text: "deleted model cannot execute" }, otherScope),
        { code: "MODEL_UNAVAILABLE" },
      );
      assert.equal(count, 9);
      // Crash recovery marks the record interrupted, without a cleanup confirmation gate.
      app.store.db
        .prepare(
          "UPDATE runs SET status='running' WHERE id=?",
        )
        .run(app.agents.info(otherScope).run!.id);
      await app.close();
      app = await start({ root, port: 0 });
      assert.equal(app.agents.info(otherScope).run!.status, "interrupted");
      assert.ok(!("cleanup" in app.agents.info(otherScope).run!));
      assert.equal(count, 9, "crash recovery cannot resend");
    } finally {
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
