import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import { running } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 20000;
  while (!check()) {
    if (Date.now() > end) throw Error(message);
    await new Promise((r) => setTimeout(r, 20));
  }
};

test(
  "pi snapshot compression: real summary, live-context isolation, cancellation, scope, revocation and durable no-replay",
  { timeout: 90000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "axiom-compression-")),
      project = join(root, "project");
    mkdirSync(project);
    mkdirSync(join(root, "pi"));
    const requests: any[] = [],
      summaries: ServerResponse[] = [];
    const reply = (res: ServerResponse, content: string) => {
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      chunk({ role: "assistant", content });
      chunk({}, "stop");
      res.write(
        `data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    };
    const fixture = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      if (!body.tools?.length) summaries.push(res);
      else reply(res, "真实会话回复");
    });
    await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
    writeFileSync(
      join(root, "pi/models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [
              {
                id: "fixture",
                contextWindow: 32000,
                maxTokens: 1000,
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
    );
    writeFileSync(
      join(root, "pi/auth.json"),
      JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }),
    );
    writeFileSync(
      join(root, "pi/settings.json"),
      JSON.stringify({
        compaction: { enabled: false },
        retry: { enabled: false },
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
      const create = () => ({
        workspaceId: w.id,
        sessionId: (
          app.store.execute({
            requestId: randomUUID(),
            op: "session.create",
            workspaceId: w.id,
          }) as Session
        ).id,
      });
      const scope = create(),
        other = create();
      const call = (
        op: string,
        params = {},
        target = scope,
        requestId = randomUUID(),
      ) =>
        app.agents.compressions.command({ op, params, ...target, requestId });
      const agent = (op: string, params = {}, target = scope) =>
        app.agents.command({ op, params, ...target, requestId: randomUUID() });
      const idle = (target = scope) =>
        wait(() => !app.agents.active(target), "agent did not settle");
      const settled = () =>
        wait(
          () =>
            app.agents.compressions.info(scope)?.state !== "running" &&
            !readdirSync(join(root, "compression-snapshots")).length,
          "compression did not settle",
        );
      await assert.rejects(call("compression.start"), {
        code: "MODEL_UNAVAILABLE",
      });
      for (const target of [scope, other])
        await agent(
          "agent.model",
          {
            selection: { provider: "fixture", id: "fixture", thinking: "off" },
          },
          target,
        );
      await assert.rejects(call("compression.start"), {
        code: "COMPRESSION_EMPTY",
      });
      await agent("prompt", { text: "第一条已保存请求" });
      await idle();
      const file = String(
        app.store.db
          .prepare("SELECT file FROM agent_sessions WHERE sessionId=?")
          .get(scope.sessionId)!.file,
      );
      const original = readFileSync(file, "utf8"),
        requestId = randomUUID();
      const accepted = await call("compression.start", {}, scope, requestId);
      await wait(
        () => summaries.length === 1,
        "native compact did not request a summary",
      );
      assert.deepEqual(
        await call("compression.start", {}, scope, requestId),
        accepted,
      );
      await assert.rejects(call("compression.start"), {
        code: "COMPRESSION_BUSY",
      });
      await assert.rejects(
        call(
          "compression.cancel",
          { id: app.agents.compressions.info(scope)!.id },
          other,
        ),
        { code: "COMPRESSION_SCOPE" },
      );
      assert.throws(() =>
        app.agents.compressions.info({ ...scope, workspaceId: "foreign" }),
      );
      assert.equal(app.agents.compressions.info(other), null);
      assert.equal(
        readFileSync(file, "utf8"),
        original,
        "snapshot worker cannot modify original JSONL",
      );
      await agent("prompt", { text: "快照之后的新消息" });
      await idle();
      const afterNewPrompt = readFileSync(file, "utf8"),
        ids = app.agents.thread(scope).ids;
      const summaryRequest = requests.find((r) => !r.tools?.length);
      assert.match(JSON.stringify(summaryRequest), /第一条已保存请求/);
      assert.doesNotMatch(JSON.stringify(summaryRequest), /快照之后的新消息/);
      reply(
        summaries[0],
        "## Goal\n真实 pi 快照摘要 <script>不可执行</script>",
      );
      await settled();
      assert.equal(app.agents.compressions.info(scope)!.state, "completed");
      assert.match(
        app.agents.compressions.info(scope)!.summary,
        /真实 pi 快照摘要/,
      );
      assert.ok(app.agents.compressions.info(scope)!.after! > 0);
      assert.ok(app.agents.compressions.info(scope)!.usage!.total > 0);
      assert.equal(readFileSync(file, "utf8"), afterNewPrompt);
      assert.deepEqual(app.agents.thread(scope).ids, ids);
      const completed = app.agents.compressions.info(scope);
      await app.close();
      app = await start({ root, port: 0 });
      assert.deepEqual(app.agents.compressions.info(scope), completed);
      assert.deepEqual(
        await call("compression.start", {}, scope, requestId),
        accepted,
      );
      assert.equal(
        summaries.length,
        1,
        "restore and duplicate requests do not call model again",
      );

      // No project-local resources or tools run during summarization, even beside an authorized project.
      mkdirSync(join(project, ".pi/extensions"), { recursive: true });
      writeFileSync(
        join(project, ".pi/extensions/unwanted.ts"),
        'import { writeFileSync } from "node:fs"; export default () => writeFileSync("unwanted.txt", "ran");',
      );
      await call("compression.start");
      await wait(() => summaries.length === 2, "cancel target did not start");
      const cancelId = app.agents.compressions.info(scope)!.id;
      await call("compression.cancel", { id: cancelId });
      await settled();
      assert.equal(app.agents.compressions.info(scope)!.state, "cancelled");
      assert.equal(existsSync(join(project, "unwanted.txt")), false);
      assert.equal(readFileSync(file, "utf8"), afterNewPrompt);
      await call("compression.start");
      await wait(() => summaries.length === 3, "stop target did not start");
      await app.tasks.stopParent(scope);
      await settled();
      assert.equal(app.agents.compressions.info(scope)!.state, "cancelled");
      assert.ok(!running(app.agents.info(scope).run));

      // Stop must beat a start waiting on the model writer.
      let release!: () => void;
      const lock = app.agents.models.serial(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      );
      await new Promise((r) => setImmediate(r));
      const waiting = call("compression.start");
      const rejected = assert.rejects(waiting, { code: "COMPRESSION_STOPPED" });
      await app.agents.stop(scope);
      release();
      await lock;
      await rejected;
      assert.equal(summaries.length, 3);

      await call("compression.start");
      await wait(
        () => summaries.length === 4,
        "revocation target did not start",
      );
      const draft = await app.agents.models.read();
      await assert.rejects(
        app.agents.models.save({
          ...draft,
          providers: [],
          confirmLogout: true,
        }),
        { code: "ACTIVE_RUNS_CONFIRMATION_REQUIRED" },
      );
      assert.equal(app.agents.compressions.info(scope)!.state, "running");
      await app.agents.models.save({
        ...draft,
        providers: [],
        confirmLogout: true,
        confirmStop: true,
      });
      await settled();
      assert.equal(app.agents.compressions.info(scope)!.state, "cancelled");
      // Crash recovery restores an interrupted record, never a scheduled model call.
      const interrupted = {
        ...app.agents.compressions.info(scope)!,
        state: "running",
        endedAt: null,
      };
      await app.close();
      app = await start({ root, port: 0 });
      app.store.db
        .prepare("UPDATE compressions SET body=? WHERE id=?")
        .run(JSON.stringify(interrupted), interrupted.id);
      await app.close();
      app = await start({ root, port: 0 });
      assert.equal(app.agents.compressions.info(scope)!.state, "interrupted");
      assert.equal(summaries.length, 4);
      await app.tasks.remove({
        op: "session.delete",
        requestId: randomUUID(),
        ...scope,
        params: { confirmed: true },
      });
      assert.equal(
        app.store.db
          .prepare("SELECT COUNT(*) AS n FROM compressions WHERE sessionId=?")
          .get(scope.sessionId)!.n,
        0,
      );
    } finally {
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
