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
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { running } from "../src/shared/agent.js";
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
  async () => {
    const root = mkdtempSync(join(tmpdir(), "axiom-agent-")),
      project = join(root, "project");
    mkdirSync(project);
    mkdirSync(join(root, "pi"));
    let count = 0,
      stall = false;
    const requests: any[] = [];
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      count++;
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
      assert.ok(app.agents.info(scope).environment!.tools.includes("write"));
      stall = true;
      await call("prompt", { text: "stall" });
      await wait(() => count === 5, "stall did not start");
      const other = app.store.execute({
        requestId: randomUUID(),
        op: "session.create",
        workspaceId: w.id,
      }) as Session;
      const otherScope = { workspaceId: w.id, sessionId: other.id };
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
      assert.equal(app.agents.info(scope).run!.cleanup, "confirmed");
      assert.ok(running(app.agents.info(otherScope).run));
      await call(
        "agent.stop",
        { runId: app.agents.info(otherScope).run!.id },
        otherScope,
      );
      const before = app.agents.thread(scope).ids;
      await app.close();
      app = await startServer({ root, port: 0 });
      assert.deepEqual(app.agents.thread(scope).ids, before);
      assert.equal(count, 6, "restart must not replay");
      assert.deepEqual(
        await call("prompt", params, scope, requestId),
        accepted,
      );
      assert.equal(count, 6, "duplicate accepted request must not replay");
      stall = false;
      await call("agent.continue");
      await wait(
        () => !running(app.agents.info(scope).run),
        "continue did not finish",
      );
      assert.equal(count, 7);
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
      await app.close();
      writeFileSync(file, "damaged");
      app = await startServer({ root, port: 0 });
      assert.match(app.agents.thread(scope).error!, /损坏/);
      await assert.rejects(
        call("prompt", { text: "must not silently recover" }),
        { code: "SESSION_FILE_ERROR" },
      );
      assert.equal(readFileSync(file, "utf8"), "damaged");
      stall = true;
      await call("prompt", { text: "stop before provider logout" }, otherScope);
      await wait(() => count === 8, "revocation run did not start");
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
      assert.equal(app.agents.info(otherScope).run!.cleanup, "confirmed");
      await assert.rejects(
        call("prompt", { text: "deleted model cannot execute" }, otherScope),
        { code: "MODEL_UNAVAILABLE" },
      );
      assert.equal(count, 8);
      // A crash record is blocked until explicitly reconciled, even when no worker exists after restart.
      app.store.db
        .prepare(
          "UPDATE runs SET status='running',cleanup='pending' WHERE id=?",
        )
        .run(app.agents.info(otherScope).run!.id);
      await app.close();
      app = await startServer({ root, port: 0 });
      assert.equal(app.agents.info(otherScope).run!.status, "interrupted");
      assert.equal(app.agents.info(otherScope).run!.cleanup, "unconfirmed");
      assert.equal(count, 8, "crash recovery cannot resend");
    } finally {
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
