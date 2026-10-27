// Product worker/HTTP/WS integration with an isolated loopback model, not remote-provider acceptance.
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TaskRecords } from "../src/server/tasks/records.js";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { running } from "../src/shared/agent.js";
import { parseMemory, memoryComplete, memoryInstruction } from "../src/shared/memory.js";
const waitFor = async (check: () => boolean, message: string, timeout = 20000, signal?: AbortSignal) => {
  const end = Date.now() + timeout;
  while (!check()) {
    signal?.throwIfAborted();
    if (Date.now() > end) throw Error(message);
    await new Promise((r) => setTimeout(r, 30));
  }
};
test(
  "Product main agent: isolated workers, real pi write/read tools, cancellation, selections, durable recovery and no replay (loopback)",
  { timeout: 90000 },
  async (t) => {
    const wait = (check: () => boolean, message: string, timeout?: number) => waitFor(check, message, timeout, t.signal);
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
    const observedProgress: { state: string; complete: boolean; percent: number | null }[] = [];
    const cacheReads = [0, 80, 20, 90];
    let responseReady = 0, releaseResponse: (() => void) | undefined;
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const system = (body.messages ?? []).filter((message: any) => ["system", "developer"].includes(message.role))
        .map((message: any) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
      if (system.includes("为会话生成简明标题")) {
        // Optional title generation shares this endpoint but is not a main
        // execution request. Never let its timing shift tool/cancel barriers.
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`data: ${JSON.stringify({ id: "title", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "工具验证" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      requests.push(body);
      count++;
      if (count === 3 || count === 4) {
        const progress = parseMemory(readFileSync(memoryPath, "utf8"));
        observedProgress.push({ state: progress.state, complete: memoryComplete(progress), percent: progress.percent });
      }
      if (providerFailure) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unsupported parameter: temperature; api_key=sk-fixture-secret", type: "invalid_request_error", code: "unsupported_parameter" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      if (stall) return;
      if (count >= 2 && count <= 4) await new Promise<void>(resolve => { responseReady = count; releaseResponse = resolve; });
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
            { index: 2, id: "cache-tool-barrier", type: "function", function: {
              name: process.platform === "win32" ? "powershell" : "bash",
              arguments: JSON.stringify({ command: `node -e "const fs = require('fs'); fs.writeFileSync('cache-tool-started', ''); const timer = setInterval(() => { if (fs.existsSync('cache-tool-release')) clearInterval(timer); }, 25);"`, timeout: 20 }),
            } },
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
            { index: 1, id: "start-memory", type: "function", function: { name: "write", arguments: JSON.stringify({ path: memoryPath,
              content: "# [进行中] 文件工具验证\n## [进行中] 验证真实文件工具与进度更新\n",
            }) } },
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
            { index: 2, id: "complete-memory", type: "function", function: { name: "edit", arguments: JSON.stringify({ path: memoryPath,
              oldText: "# [进行中] 文件工具验证\n## [进行中] 验证真实文件工具与进度更新", newText: "# [已完成] 文件工具验证\n## [已完成] 验证真实文件工具与进度更新",
            }) } },
          ],
        });
        chunk({}, "tool_calls");
      } else {
        chunk({ role: "assistant", content: "**已完成**，工具结果已核对。" });
        chunk({}, "stop");
      }
      res.write(
        `data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: cacheReads[count - 1] ?? 30 } } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    type Application = Awaited<ReturnType<typeof startServer>>;
    const applications = new Set<Application>(), starting = new Set<Promise<Application>>();
    let cleanupTask: Promise<void> | undefined;
    const cleanup = () => cleanupTask ??= (async () => {
      // After-hooks run on timeout even if the test's await never settles.
      // Close the stalled provider independently of application shutdown.
      releaseResponse?.();
      fixture.closeAllConnections();
      const fixtureClosed = new Promise<void>(resolve => fixture.close(() => resolve()));
      const closing = Promise.allSettled([...applications].map(app => app.close()));
      await Promise.allSettled(starting);
      const results = [...await closing, ...await Promise.allSettled([fixtureClosed, ...[...applications].map(app => app.close())])];
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      rmSync(root, { recursive: true, force: true });
    })();
    t.after(cleanup);
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
    const loadServer = process.env.AXIOM_TEST_COMPILED
      ? ((
          await import(new URL("../dist/server/index.js", import.meta.url).href)
        ).startServer as typeof startServer)
      : startServer;
    const start = async (options: Parameters<typeof startServer>[0]) => {
      t.signal.throwIfAborted();
      const pending = loadServer(options); starting.add(pending);
      try {
        const application = await pending, close = application.close;
        let closing: Promise<void> | undefined;
        application.close = () => closing ??= close();
        applications.add(application);
        if (t.signal.aborted) { await application.close(); t.signal.throwIfAborted(); }
        return application;
      } finally { starting.delete(pending); }
    };
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
      memoryPath = join(app.store.root, "memory", "sessions", s.id, "MEMORY.md");
      // Legacy explicit denials no longer gate this product's default authorization.
      app.store.db.exec("CREATE TABLE IF NOT EXISTS project_trust(workspaceId TEXT PRIMARY KEY, trusted INTEGER NOT NULL)");
      app.store.db.prepare("INSERT INTO project_trust VALUES(?,0)").run(w.id);
      const call = (
        op: string,
        params = {},
        target = scope,
        requestId = randomUUID(),
      ) => {
        t.signal.throwIfAborted();
        return app.agents.command({ op, params, ...target, requestId });
      };
      await assert.rejects(call("prompt", { text: "no model" }), {
        code: "MODEL_UNAVAILABLE",
      });
      // Selection is intent, and prompt acceptance is not model success. Check the
      // failed run on a separate new fixture session, without polluting main history.
      const unavailableSelection = { provider: "unconfigured", id: "fixture", thinking: "off" };
      const unavailableSession = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
      const unavailableScope: Scope = { workspaceId: w.id, sessionId: unavailableSession.id };
      await call("agent.model", { selection: unavailableSelection }, unavailableScope);
      assert.deepEqual(app.agents.info(unavailableScope).selection, unavailableSelection);
      await call("prompt", { text: "unavailable model must not execute" }, unavailableScope);
      await wait(() => app.agents.info(unavailableScope).run?.status === "failed", "unavailable intent must settle as a failed run");
      const unavailableRun = app.agents.info(unavailableScope).run!;
      // A local initialization/stream throw is EXECUTION_ERROR, not a native
      // assistant error event. Either way it must preserve intent and make no HTTP request.
      assert.equal(unavailableRun.reasonCode, "EXECUTION_ERROR");
      assert.deepEqual(unavailableRun.selection, unavailableSelection);
      assert.ok(unavailableRun.error, "failed unavailable intent must report a reason");
      assert.equal(requests.length, 0, "unavailable intent must not send a request to another model");
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
      const child = records.create(scope, "settled-child", "context", [{ task: "finished child" }],
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
      await wait(() => existsSync(join(project, "cache-tool-started")), "tool barrier did not start");
      await wait(() => app.agents.info(scope).usage?.lastRequest?.input === 100, "native request usage was not published while the tool was running");
      assert.deepEqual(app.agents.info(scope).usage?.lastRequest, { input: 100, cacheRead: 0, cacheWrite: 0 });
      assert.ok(running(app.agents.info(scope).run));
      writeFileSync(join(project, "cache-tool-release"), "");
      for (const next of [2, 3, 4]) {
        await wait(() => responseReady === next, `request ${next} did not reach response barrier`);
        const cached = cacheReads[next - 2];
        await wait(() => app.agents.info(scope).usage?.lastRequest?.cacheRead === cached, `request ${next - 1} usage did not update`);
        assert.deepEqual(app.agents.info(scope).usage?.lastRequest, { input: 100 - cached, cacheRead: cached, cacheWrite: 0 });
        releaseResponse!();
      }
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
      assert.deepEqual(observedProgress, [{ state: "进行中", complete: false, percent: null }, { state: "已完成", complete: true, percent: null }], "real file tools update chapter state without invented percentages");
      app.agents.memories.scan();
      assert.equal(memoryComplete(app.agents.memories.view(scope).progress), true);
      const assertMemoryPrompt = (request: any, path: string) => {
        const system = request.messages.filter((message: any) => message.role === "system").map((message: any) => JSON.stringify(message.content)).join("\n");
        assert.ok(system.includes(JSON.stringify(path).slice(1, -1)), `actual provider payload includes the bound memory path: expected ${path}; observed ${system.match(/Session memory file:[^\\n]+/)?.[0] ?? system.slice(0, 180)}`);
        assert.ok(system.includes(JSON.stringify(memoryInstruction(path)).slice(1, -1)),
          "actual provider payload includes the complete current memory instruction");
        assert.doesNotMatch(system, /memory_detail/);
        assert.doesNotMatch(system, /RULES\.md/);
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
      assert.equal(app.agents.info(scope).usage!.total, 480);
      assert.equal(app.agents.info(scope).usage!.cacheRead, 190);
      assert.deepEqual(app.agents.info(scope).usage!.lastRequest, { input: 10, cacheRead: 90, cacheWrite: 0 });
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
      assert.deepEqual(app.agents.info(scope).usage?.lastRequest, { input: 10, cacheRead: 90, cacheWrite: 0 }, "a request awaiting its native response keeps the last returned usage");
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
      assertMemoryPrompt(requests[5], join(app.store.root, "memory", "sessions", other.id, "MEMORY.md"));
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
      const boundFile = app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file as string;
      const latestStoppedReply = readFileSync(boundFile, "utf8").trim().split("\n").map(line => JSON.parse(line))
        .filter(entry => entry.type === "message" && entry.message.role === "assistant").at(-1)!.message;
      // Forced shutdown can win before abort is recorded, or after a zero-usage
      // aborted response is persisted. The snapshot must match the native record.
      const stoppedUsage = latestStoppedReply.stopReason === "aborted" ? null : { input: 10, cacheRead: 90, cacheWrite: 0 };
      assert.equal(latestStoppedReply.usage.input + latestStoppedReply.usage.cacheRead + latestStoppedReply.usage.cacheWrite, stoppedUsage ? 100 : 0);
      assert.deepEqual(app.agents.info(scope).usage?.lastRequest, stoppedUsage, "stop settles against the latest persisted native response");
      assert.ok(!("cleanup" in app.agents.info(scope).run!));
      assert.equal(count, 6, "stop must not ask the model for a summary");
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
      assert.deepEqual(app.agents.info(scope).usage?.lastRequest, stoppedUsage, "restart retains the settled native reading");
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
      const lastRequest = { input: 70, cacheRead: 30, cacheWrite: 0 };
      assert.deepEqual(app.agents.info(scope).usage?.lastRequest, lastRequest);
      await app.close();
      app = await start({ root, port: 0 });
      assert.deepEqual(app.agents.info(scope).usage?.lastRequest, lastRequest, "latest native request survives restart");
      assert.equal(count, 7, "restoring usage must not request the model");
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
      assert.equal(app.agents.info(scope).usage?.lastRequest, null, "rejected request cannot display an older cache rate");
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
      await call("prompt", { text: "deleted model cannot execute" }, otherScope);
      await wait(() => !app.agents.active(otherScope), "deleted model request did not settle");
      assert.equal(app.agents.info(otherScope).run?.status, "failed");
      assert.equal(count, 9, "a deleted model cannot silently use another endpoint");
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
      await cleanup();
    }
  },
);
