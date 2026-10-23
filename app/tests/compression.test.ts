import { compressionMemoryRead, afterCompressionMemoryRead } from "./compression-memory-fixture.js";
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
import { WebSocket } from "ws";
import { estimateTokens, SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { running } from "../src/shared/agent.js";
import { defaultAutoCompression } from "../src/shared/compression.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 20000;
  while (!check()) {
    if (Date.now() > end) throw Error(message);
    await new Promise((r) => setTimeout(r, 20));
  }
};

test(
  "pi snapshot compression: native append, preserved history/new context, cancellation, scope, revocation and durable no-replay",
  { timeout: 90000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-compression-")),
      project = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
    mkdirSync(project);
    mkdirSync(join(root, "pi"));
    const requests: any[] = [],
      summaries: ServerResponse[] = [];
    const reply = (res: ServerResponse, content: string | object) => {
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      chunk(typeof content === "string" ? { role: "assistant", content } : content);
      chunk({}, typeof content === "string" ? "stop" : "tool_calls");
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
      else reply(res, compressionMemoryRead(body) ?? "<title>压缩测试</title>\n真实会话回复");
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
              { id: "summarizer", reasoning: true, contextWindow: 64000, maxTokens: 1000,
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
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
      const settled = (onPoll = () => {}) =>
        wait(
          () => {
            onPoll();
            return app.agents.compressions.info(scope)?.state !== "running" &&
              !readdirSync(join(root, "compression-snapshots")).length;
          },
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
      // A failed historical stream may persist a partial tool call with no
      // result. Fresh idle compression must still use the current transcript.
      await app.agents.releaseIdle(scope);
      const history = SessionManager.open(file);
      const previous = history.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
      assert.ok(previous?.type === "message" && previous.message.role === "assistant");
      history.appendMessage({ ...previous.message, stopReason: "error",
        content: [{ type: "toolCall", id: "historical-failed-write", name: "write", arguments: {} }] });
      const original = readFileSync(file, "utf8"),
        requestId = randomUUID();
      const mainSelection = { provider: "fixture", id: "fixture", thinking: "off" };
      const summarySelection = { provider: "fixture", id: "summarizer", thinking: "low" };
      for (const selection of [
        { ...summarySelection, provider: "missing" },
        { ...summarySelection, id: "missing" },
        { ...mainSelection, thinking: "high" },
        { ...summarySelection, thinking: "invalid" },
        { provider: "fixture", id: "summarizer" },
      ]) await assert.rejects(call("compression.start", { selection }), { code: "MODEL_UNAVAILABLE" });
      for (const selection of [null, [], "fixture", { ...summarySelection, extra: true }, { ...summarySelection, provider: 1 }])
        await assert.rejects(call("compression.start", { selection }), { code: "INVALID_INPUT" });
      assert.equal(app.agents.compressions.info(scope), null, "invalid choices do not create jobs");
      assert.equal(readFileSync(file, "utf8"), original);
      const raw = app.agents.models.raw.bind(app.agents.models);
      const changedRevision = t.mock.method(app.agents.models, "raw", async () => (await raw()) + "\n");
      try {
        await assert.rejects(call("compression.start", { selection: summarySelection }), { code: "REVISION_CONFLICT" });
        assert.equal(app.agents.compressions.info(scope), null, "changed configuration cannot create a mismatched snapshot");
      } finally { changedRevision.mock.restore(); }
      const accepted = await call("compression.start", { selection: summarySelection }, scope, requestId);
      await wait(
        () => summaries.length === 1,
        "native compact did not request a summary",
      );
      // Advance the execution clock only after bounded worker preparation finished.
      t.mock.timers.enable({ apis: ["setTimeout"] });
      try {
        t.mock.timers.tick(120001);
        assert.equal(app.agents.compressions.info(scope)!.state, "running", "passing two minutes must not cancel compression");
      } finally { t.mock.timers.reset(); }
      assert.deepEqual(
        await call("compression.start", { selection: summarySelection }, scope, requestId),
        accepted,
      );
      assert.deepEqual(app.agents.compressions.info(scope)!.selection, summarySelection);
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
      assert.deepEqual(app.store.compressionPreferences(), { selection: null, auto: defaultAutoCompression }, "per-run override is not a saved preference");
      const frozenConfig = join(root, "compression-snapshots", `${app.agents.compressions.info(scope)!.id}.json`);
      assert.equal(readFileSync(frozenConfig, "utf8"), readFileSync(join(root, "pi/models.json"), "utf8"));
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
      assert.ok(readFileSync(file, "utf8").startsWith(original), "memory preparation appends without rewriting history");
      const preparedHistory = readFileSync(file, "utf8");
      assert.match(preparedHistory.slice(original.length), /axiom-compression-memory/);
      assert.match(preparedHistory.slice(original.length), /check-compression-memory/);
      await agent("prompt", { text: "快照之后的新消息" });
      await idle();
      const afterNewPrompt = readFileSync(file, "utf8"),
        ids = app.agents.thread(scope).ids;
      const summaryRequest = requests.find((r) => !r.tools?.length);
      assert.equal(summaryRequest.model, "summarizer", "independent model reaches the actual pi adapter");
      assert.ok(requests.filter((r) => r.tools?.length).every((r) => r.model === "fixture"));
      assert.match(JSON.stringify(summaryRequest), /第一条已保存请求/);
      assert.doesNotMatch(JSON.stringify(summaryRequest), /快照之后的新消息/);
      // Native compaction can summarize history and a split turn separately.
      // Release every request from this frozen snapshot before checking completion.
      await settled(() => {
        for (const response of summaries) {
          if (!response.writableEnded) reply(response, "## Goal\n真实 pi 快照摘要 <script>不可执行</script>");
        }
      });
      const initialSummaryCount = summaries.length;
      for (const request of requests.filter((r) => !r.tools?.length)) {
        assert.equal(request.model, "summarizer");
        assert.doesNotMatch(JSON.stringify(request), /快照之后的新消息/);
      }
      assert.equal(app.agents.compressions.info(scope)!.state, "completed");
      assert.match(
        app.agents.compressions.info(scope)!.summary,
        /真实 pi 快照摘要/,
      );
      assert.ok(app.agents.compressions.info(scope)!.after! > 0);
      assert.ok(app.agents.compressions.info(scope)!.usage!.total > 0);
      const billing = app.agents.compressions.info(scope)!.billing!;
      assert.ok(billing.records >= 1, "native summary requests persist separate accounting");
      assert.equal(billing.unknownCost, 0);
      assert.equal(billing.knownCost, app.agents.compressions.info(scope)!.usage!.cost);
      assert.ok(billing.tokens.input > 0);
      const afterCompression = readFileSync(file, "utf8");
      assert.ok(afterCompression.startsWith(afterNewPrompt), "compression appends without rewriting history");
      const appended = afterCompression.slice(afterNewPrompt.length).trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(appended.filter((entry) => entry.type === "compaction").length, 1);
      assert.match(appended.find((entry) => entry.type === "compaction").summary, /真实 pi 快照摘要/);
      assert.match(JSON.stringify(SessionManager.open(file).buildSessionContext().messages), /快照之后的新消息/);
      const compactedIds = app.agents.thread(scope).ids;
      assert.notDeepEqual(compactedIds, ids, "visible transcript follows the native compaction boundary");
      const card = app.agents.message(scope, compactedIds[0]);
      assert.ok(card?.compression, "native summary is rendered as a compaction card");
      assert.equal(card.compression.number, 1);
      assert.ok(Array.from(card.compression.title).length <= 20);
      const compactedUsage = app.agents.info(scope).usage!;
      const expectedTokens = SessionManager.open(file).buildSessionProjection().messages.reduce((n, m) => n + estimateTokens(m), 0);
      assert.equal(compactedUsage.context!.tokens, expectedTokens);
      assert.equal(compactedUsage.context!.estimated, true);
      assert.equal(compactedUsage.context!.percent, expectedTokens / 32000 * 100);
      assert.ok(expectedTokens > 0);
      // Existing saved null readings must recover on read without a model call.
      app.store.db.prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?").run(JSON.stringify({
        ...compactedUsage, context: { tokens: null, window: 32000, percent: null },
      }), scope.sessionId);
      assert.deepEqual(app.agents.info(scope).usage, compactedUsage);
      const completed = app.agents.compressions.info(scope);
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
      await app.agents.compressions.command({ op: "compression.preferences.save", requestId: randomUUID(), params: { selection: summarySelection } });
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
      await app.close();
      app = await start({ root, port: 0 });
      assert.deepEqual(app.agents.compressions.info(scope), completed);
      assert.deepEqual(app.store.compressionPreferences(), { selection: summarySelection, auto: defaultAutoCompression });
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
      assert.deepEqual(app.agents.info(scope).usage, compactedUsage);
      assert.deepEqual(
        await call("compression.start", { selection: summarySelection }, scope, requestId),
        accepted,
      );
      assert.equal(
        summaries.length,
        initialSummaryCount,
        "restore and duplicate requests do not call model again",
      );

      assert.equal(readFileSync(file, "utf8"), afterCompression, "restart must not append the same compaction again");
      const beforeNextRequest = requests.length;
      await assert.rejects(call("compression.start"), {
        code: "COMPRESSION_EMPTY", message: "当前上下文已压缩，尚无新增消息可再次压缩。",
      });
      assert.equal(requests.length, beforeNextRequest, "no new messages must not trigger another summary request");
      await agent("prompt", { text: "压缩之后的后续请求" });
      await idle();
      const nextRequest = requests.slice(beforeNextRequest).find((request) => request.tools?.length);
      assert.ok(nextRequest, "next prompt reached the real pi model adapter");
      assert.equal(nextRequest.model, "fixture", "compression must not change the next chat request model");
      assert.match(JSON.stringify(nextRequest.messages), /真实 pi 快照摘要/);
      assert.match(JSON.stringify(nextRequest.messages), /快照之后的新消息/);
      assert.equal(app.agents.info(scope).usage!.context!.tokens, 120, "next provider response restores native usage");
      assert.notEqual(app.agents.info(scope).usage!.context!.estimated, true);
      let beforeCancelled = readFileSync(file, "utf8");

      // No project-local resources or tools run during summarization, even beside an authorized project.
      mkdirSync(join(project, ".pi/extensions"), { recursive: true });
      writeFileSync(
        join(project, ".pi/extensions/unwanted.ts"),
        'import { writeFileSync } from "node:fs"; export default (pi) => { pi.on("session_before_compact", () => { writeFileSync("unwanted.txt", "ran"); }); };',
      );
      await call("compression.start");
      await wait(() => summaries.length === initialSummaryCount + 1, "cancel target did not start");
      await idle();
      beforeCancelled = readFileSync(file, "utf8");
      assert.notEqual(app.agents.compressions.info(scope)!.id, completed!.id, "completed job can be started again");
      assert.deepEqual(app.agents.compressions.info(scope)!.selection, summarySelection, "start uses saved global selection");
      assert.equal(requests.filter((r) => !r.tools?.length).at(-1).model, "summarizer");
      const cancelId = app.agents.compressions.info(scope)!.id;
      await call("compression.cancel", { id: cancelId });
      await settled();
      assert.equal(app.agents.compressions.info(scope)!.state, "cancelled");
      assert.ok(app.agents.compressions.info(scope)!.billing!.records >= 1, "cancel retains the initiated model request");
      assert.ok(app.agents.compressions.info(scope)!.billing!.unknownCost >= 1, "an aborted request without pricing is unknown, not free");
      assert.equal(existsSync(join(project, "unwanted.txt")), false);
      assert.equal(readFileSync(file, "utf8"), beforeCancelled, "cancel cannot apply a compaction");
      await app.agents.compressions.command({ op: "compression.preferences.save", requestId: randomUUID(), params: { selection: null } });
      await call("compression.start");
      await wait(() => summaries.length === initialSummaryCount + 2, "stop target did not start");
      await idle();
      beforeCancelled = readFileSync(file, "utf8");
      assert.notEqual(app.agents.compressions.info(scope)!.id, cancelId, "cancelled job can be started again");
      assert.deepEqual(app.agents.compressions.info(scope)!.selection, mainSelection, "cleared preference falls back to the chat model");
      assert.equal(requests.filter((r) => !r.tools?.length).at(-1).model, "fixture");
      await app.tasks.stopParent(scope);
      await settled();
      assert.equal(app.agents.compressions.info(scope)!.state, "cancelled");
      assert.ok(!running(app.agents.info(scope).run));
      assert.equal(readFileSync(file, "utf8"), beforeCancelled, "parent stop cannot apply a compaction");

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
      assert.equal(summaries.length, initialSummaryCount + 2);

      await call("compression.start");
      await wait(
        () => summaries.length === initialSummaryCount + 3,
        "revocation target did not start",
      );
      await idle();
      beforeCancelled = readFileSync(file, "utf8");
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
      assert.equal(readFileSync(file, "utf8"), beforeCancelled, "provider revocation cannot apply a compaction");
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
      assert.equal(summaries.length, initialSummaryCount + 3);
      const compressionHistory = app.store.db.prepare("SELECT id,body FROM compressions WHERE sessionId=? ORDER BY id").all(scope.sessionId);
      await app.tasks.remove({
        op: "session.delete",
        requestId: randomUUID(),
        ...scope,
        params: { confirmed: true },
      });
      assert.deepEqual(app.store.db.prepare("SELECT id,body FROM compressions WHERE sessionId=? ORDER BY id").all(scope.sessionId), compressionHistory,
        "logical deletion preserves compression history");
      assert.throws(() => app.store.session(scope.workspaceId, scope.sessionId), { code: "SCOPE_MISMATCH" });
      await assert.rejects(app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope,
        params: { text: "must not start a deleted session" } }), { code: "SCOPE_MISMATCH" });
      assert.equal(summaries.length, initialSummaryCount + 3, "deleted sessions cannot restart model work");
    } finally {
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((r) => fixture.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("global compression preferences: websocket subscription, reconnect/restart persistence, validation and no chat model changes",
  { timeout: 60000 }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-compression-preferences-")), project = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => {
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
    });
    mkdirSync(project);
    mkdirSync(join(root, "pi"));
    const modelsFile = join(root, "pi/models.json");
    const definition = { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
      models: [{ id: "chat", contextWindow: 32000, maxTokens: 1000 }, { id: "summary", contextWindow: 32000, maxTokens: 1000 }] };
    writeFileSync(modelsFile, JSON.stringify({ providers: { fixture: definition, unauthenticated: definition } }));
    writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
    const start = process.env.AXIOM_TEST_COMPILED
      ? (await import(new URL("../dist/server/index.js", import.meta.url).href)).startServer as typeof startServer
      : startServer;
    let app = await start({ root, port: 0 });
    const sockets: WebSocket[] = [];
    const connect = async () => {
      const ws = new WebSocket(app.origin.replace("http:", "ws:") + "/ws", { origin: app.origin });
      sockets.push(ws);
      const events: any[] = [];
      ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      const call = async (op: string, params = {}) => {
        const requestId = randomUUID();
        ws.send(JSON.stringify({ op, params, requestId }));
        await wait(() => events.some((event) => event.type === "receipt" && event.requestId === requestId), "missing preference receipt");
        return events.find((event) => event.type === "receipt" && event.requestId === requestId);
      };
      return { ws, events, call };
    };
    try {
      const a = await connect(), b = await connect();
      for (const client of [a, b]) {
        assert.equal((await client.call("subscribe", { scope: "compression-preferences" })).ok, true);
        assert.deepEqual(client.events.find((event) => event.scope === "compression-preferences").data, { selection: null, auto: defaultAutoCompression });
      }
      const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
      const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
      const scope = { workspaceId: workspace.id, sessionId: session.id };
      const mainSelection = { provider: "fixture", id: "chat", thinking: "off" };
      const selection = { provider: "fixture", id: "summary", thinking: "off" };
      await app.agents.command({ op: "agent.model", requestId: randomUUID(), ...scope, params: { selection: mainSelection } });
      for (const invalid of [
        { ...selection, provider: "missing" }, { ...selection, provider: "unauthenticated" },
        { ...selection, id: "missing" }, { ...selection, thinking: "high" },
      ]) {
        const reply = await a.call("compression.preferences.save", { selection: invalid });
        assert.equal(reply.error.code, "MODEL_UNAVAILABLE");
      }
      for (const params of [{}, { selection: [] }, { selection: { ...selection, extra: true } }, { selection, extra: true }]) {
        const reply = await a.call("compression.preferences.save", params);
        assert.equal(reply.error.code, "INVALID_INPUT");
      }
      assert.deepEqual(app.store.compressionPreferences(), { selection: null, auto: defaultAutoCompression });
      assert.deepEqual((await a.call("compression.preferences.save", { selection })).data, { selection, auto: defaultAutoCompression });
      await wait(() => b.events.some((event) => event.scope === "compression-preferences" && event.data.selection?.id === "summary"), "other viewer did not receive preference update");
      assert.deepEqual((await b.call("compression.preferences.get")).data, { selection, auto: defaultAutoCompression });
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
      const freshSession = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
      assert.deepEqual(app.agents.info({ workspaceId: workspace.id, sessionId: freshSession.id }).selection, mainSelection,
        "compression preference must not change the new-chat default");
      a.ws.close();
      const refreshed = await connect();
      await refreshed.call("subscribe", { scope: "compression-preferences" });
      assert.deepEqual(refreshed.events.find((event) => event.scope === "compression-preferences").data, { selection, auto: defaultAutoCompression });
      await app.close();
      app = await start({ root, port: 0 });
      const restarted = await connect();
      await restarted.call("subscribe", { scope: "compression-preferences" });
      assert.deepEqual(restarted.events.find((event) => event.scope === "compression-preferences").data, { selection, auto: defaultAutoCompression });
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
      // Configuration removal preserves the explicit preference and refuses fallback to a valid chat model.
      writeFileSync(modelsFile, JSON.stringify({ providers: { fixture: { ...definition, models: definition.models.slice(0, 1) } } }));
      await app.refreshConfiguration();
      assert.deepEqual((await restarted.call("compression.preferences.get")).data, { selection, auto: defaultAutoCompression });
      await assert.rejects(app.agents.compressions.command({ op: "compression.start", requestId: randomUUID(), ...scope }), { code: "MODEL_UNAVAILABLE" });
      assert.equal(app.agents.compressions.info(scope), null);
      // An explicit valid override bypasses the stale preference, then reaches the empty-history check.
      await assert.rejects(app.agents.compressions.command({ op: "compression.start", requestId: randomUUID(), ...scope,
        params: { selection: mainSelection } }), { code: "COMPRESSION_EMPTY" });
      assert.deepEqual(app.store.compressionPreferences(), { selection, auto: defaultAutoCompression });
      assert.deepEqual((await restarted.call("compression.preferences.save", { selection: null })).data, { selection: null, auto: defaultAutoCompression });
      await app.close();
      app = await start({ root, port: 0 });
      assert.deepEqual(app.store.compressionPreferences(), { selection: null, auto: defaultAutoCompression }, "clearing is also persistent");
      assert.deepEqual(app.agents.info(scope).selection, mainSelection);
    } finally {
      for (const ws of sockets) ws.terminate();
      await app.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    }
  });

test("running compression snapshots and applies only at paired-tool safe points (real pi loopback)",
  { timeout: 90000 }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "axiom-compression-boundary-")), project = join(root, "project");
    const previousPi = process.env.AXIOM_PI_DIR;
    process.env.AXIOM_PI_DIR = join(root, "pi");
    t.after(() => {
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
    });
    mkdirSync(project);
    mkdirSync(join(root, "pi"));
    writeFileSync(join(project, "gate.cjs"), "fetch(process.argv[2]).then(r=>r.text()).then(t=>process.stdout.write(t));");
    let mainCount = 0, baseUrl = "", releaseSummaries = false;
    let continuationResponse: ServerResponse | undefined;
    const requests: any[] = [], summaries: ServerResponse[] = [], gates: ServerResponse[] = [];
    const stream = (res: ServerResponse, delta: unknown, reason = "stop") => {
      for (const [value, finish_reason] of [[delta, null], [{}, reason]])
        res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1,
          model: "fixture", choices: [{ index: 0, delta: value, finish_reason }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1,
        model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    };
    const fixture = createServer(async (req, res) => {
      if (req.url?.startsWith("/gate/")) { gates.push(res); return; }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      if (!body.tools?.length) {
        summaries.push(res);
        if (releaseSummaries) stream(res, { role: "assistant", content: "## Goal\nSAFE_BOUNDARY_SUMMARY" });
        return;
      }
      const memoryRead = compressionMemoryRead(body);
      if (memoryRead) { stream(res, memoryRead, "tool_calls"); return; }
      if (afterCompressionMemoryRead(body)) { stream(res, { role: "assistant", content: "memory checked" }); return; }
      mainCount++;
      if (mainCount === 2 || mainCount === 3) {
        const gate = mainCount - 1;
        const executable = process.execPath.replaceAll("'", "''");
        stream(res, { role: "assistant", tool_calls: [{ index: 0, id: `gate-${gate}`, type: "function",
          function: { name: process.platform === "win32" ? "powershell" : "bash",
            arguments: JSON.stringify({ command: `${process.platform === "win32" ? "& " : ""}'${executable}' gate.cjs '${baseUrl}/gate/${gate}'`, timeout: 60 }) } }] }, "tool_calls");
      } else if (mainCount === 4) continuationResponse = res;
      else stream(res, { role: "assistant", content: "safe point reply" });
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(fixture.address() as any).port}`;
    writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { fixture: {
      api: "openai-completions", baseUrl: `${baseUrl}/v1`,
      models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }],
    } } }));
    writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
    writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    const start = process.env.AXIOM_TEST_COMPILED
      ? (await import(new URL("../dist/server/index.js", import.meta.url).href)).startServer as typeof startServer
      : startServer;
    const app = await start({ root, port: 0 });
    try {
      const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open",
        params: { path: project, authorized: true } }) as Workspace;
      for (const mode of ["apply", "cancel"] as const) {
        mainCount = 0;
        continuationResponse = undefined;
        releaseSummaries = false;
        requests.length = 0;
        summaries.length = 0;
        gates.length = 0;
        const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
        const scope = { workspaceId: workspace.id, sessionId: session.id };
        const agent = (op: string, params = {}) => app.agents.command({ op, params, ...scope, requestId: randomUUID() });
        const compress = (op: string, params = {}) => app.agents.compressions.command({ op, params, ...scope, requestId: randomUUID() });
        await agent("agent.model", { selection: { provider: "fixture", id: "fixture", thinking: "off" } });
        await agent("prompt", { text: "seed history before active tools" });
        await wait(() => !app.agents.active(scope), "seed did not settle");
        const file = String(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file);
        const entries = () => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        await app.agents.releaseIdle(scope);
        const history = SessionManager.open(file);
        const previous = history.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
        assert.ok(previous?.type === "message" && previous.message.role === "assistant");
        history.appendMessage({ ...previous.message, stopReason: "error",
          content: [{ type: "toolCall", id: "historical-failed-write", name: "write", arguments: {} }] });
        await agent("prompt", { text: "active request with controlled tool gates" });
        await wait(() => gates.length === 1, "first real tool did not reach its gate");
        const starting = compress("compression.start");
        // Attach a rejection handler immediately while the snapshot waits for the running tool.
        void starting.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 250));
        assert.equal(summaries.length, 0, "snapshot must not include an unfinished tool call");
        assert.equal(entries().filter((entry) => entry.type === "compaction").length, 0);
        gates[0].end("first paired tool result");
        await starting;
        await wait(() => summaries.length >= 1, "summary did not start after memory preparation");
        await wait(() => !app.agents.active(scope), "memory preparation did not settle");
        await agent("prompt", { text: "tail after the prepared snapshot" });
        await wait(() => gates.length === 2, "post-snapshot tool gate did not start");
        const summaryRequest = requests.find((request) => !request.tools?.length);
        assert.match(JSON.stringify(summaryRequest.messages), /seed history before active tools/);
        const snapshotFile = join(root, "compression-snapshots", `${app.agents.compressions.info(scope)!.id}.jsonl`);
        const snapshotEntries = readFileSync(snapshotFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        assert.ok(snapshotEntries.some((entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === "gate-1"),
          "snapshot includes the paired tool and subsequent completed memory preparation");
        assert.ok(snapshotEntries.some((entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === "check-compression-memory"));
        assert.ok(!snapshotEntries.some((entry) => entry.message?.content?.some?.((part: any) => part.type === "toolCall" && part.id === "gate-2")),
          "snapshot must not include the next unfinished turn");
        assert.doesNotMatch(JSON.stringify(summaryRequest.messages), /second paired tool result/);
        // Pi may summarize an older history and a split-turn prefix with separate native requests.
        releaseSummaries = true;
        for (const summary of summaries) stream(summary, { role: "assistant", content: "## Goal\nSAFE_BOUNDARY_SUMMARY" });
        await wait(() => app.agents.compressions.info(scope)?.phase === "applying" ||
          app.agents.compressions.info(scope)?.state !== "running", "summary did not enter pending apply");
        assert.equal(app.agents.compressions.info(scope)?.phase, "applying", JSON.stringify(app.agents.compressions.info(scope)));
        await wait(() => readdirSync(join(root, "compression-snapshots")).length === 0,
          "summary worker must close and hand off apply before releasing the tool boundary");
        const beforeBoundary = readFileSync(file, "utf8");
        assert.equal(entries().filter((entry) => entry.type === "compaction").length, 0,
          "apply must wait while the second real tool is blocked");
        assert.ok(app.agents.active(scope), "compression does not stop the current run");
        if (mode === "cancel") {
          await compress("compression.cancel", { id: app.agents.compressions.info(scope)!.id });
          assert.equal(app.agents.compressions.info(scope)!.state, "cancelled");
        }
        gates[1].end("second paired tool result");
        await wait(() => !!continuationResponse, "post-boundary request did not start");
        if (mode === "apply") {
          await wait(() => app.agents.info(scope).usage?.context?.estimated === true,
            "live compression did not publish an estimated context reading");
          const context = app.agents.info(scope).usage!.context!;
          assert.equal(context.tokens, SessionManager.open(file).buildSessionProjection().messages.reduce((n, m) => n + estimateTokens(m), 0));
          assert.ok(context.tokens! > 0);
        }
        stream(continuationResponse!, { role: "assistant", content: "safe point reply" });
        await wait(() => !app.agents.active(scope), "active tool run did not settle");
        assert.notEqual(app.agents.info(scope).usage?.context?.estimated, true);
        await wait(() => app.agents.compressions.info(scope)?.state !== "running", "compression did not settle");
        assert.ok(readFileSync(file, "utf8").startsWith(beforeBoundary), "safe-point application is append-only");
        const compacted = entries().filter((entry) => entry.type === "compaction");
        assert.equal(compacted.length, mode === "apply" ? 1 : 0);
        const continuation = requests.filter((request) => request.tools?.length).at(-1);
        assert.ok(continuation);
        if (mode === "apply") {
          assert.equal(app.agents.compressions.info(scope)!.state, "completed");
          assert.match(JSON.stringify(continuation.messages), /SAFE_BOUNDARY_SUMMARY/);
          assert.match(JSON.stringify(continuation.messages), /second paired tool result/);
          const history = entries(), position = history.findIndex((entry) => entry.type === "compaction");
          assert.ok(history.slice(0, position).some((entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === "gate-2"));
        } else assert.doesNotMatch(JSON.stringify(continuation.messages), /SAFE_BOUNDARY_SUMMARY/);
        // Every model-visible call must have its result, and no result may be orphaned.
        for (const request of requests.filter((request) => request.tools?.length)) {
          const calls = request.messages.flatMap((message: any) => (message.tool_calls ?? []).map((call: any) => call.id)).sort();
          const results = request.messages.filter((message: any) => message.role === "tool").map((message: any) => message.tool_call_id).sort();
          assert.deepEqual(results, calls, "safe-point context must keep tool calls/results paired");
        }
      }
    } finally {
      for (const gate of gates) if (!gate.writableEnded) gate.end("cleanup");
      await app.close();
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    }
  });
