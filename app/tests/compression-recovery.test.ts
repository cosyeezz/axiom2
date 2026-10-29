import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import { startServer } from "../src/server/index.js";
import { captureCompressionPrefix, saveCompressionPrefix } from "../src/server/compression-request.js";
import { isCompressionRequest } from "./compression-memory-fixture.js";
import { replyToFixtureTitle } from "./model-request-fixture.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 25000;
  while (!check()) {
    assert.ok(Date.now() < end, message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

test("stopped/full sessions recover without a cache sidecar, never restart the main run, and commit full summaries atomically", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-compression-recovery-")), project = join(root, "project");
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  const requests: any[] = [];
  let mode = "", physical = 0, held: ServerResponse | undefined;
  const reply = (res: ServerResponse, text: string) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [[{ role: "assistant", content: text }, null], [{}, "stop"]])
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", model: "chat", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if ((body.messages ?? []).some((m: any) => ["system", "developer"].includes(m.role) && typeof m.content === "string" && m.content.includes("为会话生成简明标题"))) {
      replyToFixtureTitle(body, res); return;
    }
    requests.push(body);
    if (!isCompressionRequest(body)) { held = res; return; }
    physical++;
    if (mode === "batch-retry" && physical === 2) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "temporarily unavailable", type: "server_error" } })); return;
    }
    if (mode === "batch-failure" && physical === 2) { res.writeHead(400); res.end("fixture summary rejected"); return; }
    if (mode === "empty" || mode === "empty-cached") { reply(res, "   "); return; }
    if (mode === "tail" || mode === "batch-cancel" && physical === 2) { held = res; return; }
    const markers = [...new Set(JSON.stringify(body.messages).match(/ITEM_\d+|USER_FIRST|FINAL_CURRENT|PREVIOUS_SUMMARY/g) ?? [])];
    reply(res, "## Goal\nRECOVERED " + markers.join(" "));
  });
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { fixture: {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
      models: [{ id: "chat", contextWindow: 8192, maxTokens: 512, samplingParams: { top_p: 0.5 },
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
        { id: "unsafe-input", contextWindow: 8192, maxTokens: 512, samplingParams: { messages: [{ role: "user", content: "UNSAFE_OVERRIDE" }] } },
        { id: "unsafe-truncation", contextWindow: 8192, maxTokens: 512, samplingParams: { truncation: "auto" } }],
    } } }));
    writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
    writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    const startServerForTest = process.env.AXIOM_TEST_COMPILED
      ? (await import(new URL("../dist/server/index.js", import.meta.url).href)).startServer as typeof startServer : startServer;
    app = await startServerForTest({ root, port: 0 });
    const server = app;
    await server.agents.compressions.command({ requestId: randomUUID(), op: "compression.preferences.save", params: { auto: { enabled: false } } });
    const workspace = server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const selection = { provider: "fixture", id: "chat", thinking: "off" as const };
    const runtime = await server.agents.models.runtime();
    const model = runtime.getModel(selection.provider, selection.id)!;
    const assistant = (text: string): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
      stopReason: "stop", timestamp: Date.now(), content: [{ type: "text", text }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const call = (scope: Scope, op = "compression.start", params = {}) => server.agents.compressions.command({ ...scope, requestId: randomUUID(), op, params });
    for (mode of ["missing", "corrupt", "selection", "model-config", "prefix-overflow", "native-overflow", "tail", "batch-failure", "batch-cancel", "batch-retry", "stop-immediate", "single", "single-overflow", "empty", "empty-cached", "unsafe-input", "unsafe-truncation"]) {
      physical = 0; held = undefined;
      const scope = { workspaceId: workspace.id, sessionId: (server.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session).id };
      const chosen = mode.startsWith("unsafe-") ? { ...selection, id: mode } : selection;
      await server.agents.command({ ...scope, requestId: randomUUID(), op: "agent.model", params: { selection: chosen } });
      // Imported/legacy native history: no real main request has ever created a sidecar.
      const manager = SessionManager.create(project, join(root, "sessions", scope.sessionId));
      if (mode === "native-overflow") manager.appendCompaction("PREVIOUS_SUMMARY", null, 1000);
      const large = ["native-overflow", "single-overflow", "batch-failure", "batch-cancel", "batch-retry"].includes(mode);
      manager.appendMessage({ role: "user", content: "USER_FIRST " + (large
        ? Array.from({ length: 6 }, (_, i) => `ITEM_${i} ${"x".repeat(12000)}\n`).join("") : "recover stopped session"), timestamp: Date.now() });
      if (!mode.startsWith("single")) manager.appendMessage(assistant("FINAL_CURRENT"));
      if (mode === "empty" || mode === "empty-cached") manager.appendMessage({ ...assistant(""),
        content: [{ type: "toolCall", id: "read-file", name: "read", arguments: { path: "kept.txt" } }] });
      const file = manager.getSessionFile()!;
      // Pi intentionally delays first disk flush until an assistant exists;
      // imported one-message transcripts are nevertheless valid persisted input.
      if (mode.startsWith("single")) writeFileSync(file, [manager.getHeader(), ...manager.getBranch()].map(entry => JSON.stringify(entry)).join("\n") + "\n");
      server.store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(file, scope.sessionId);
      server.agents.refresh(scope);
      if (mode === "corrupt") writeFileSync(`${file}.request-prefix.json`, "{broken");
      if (["selection", "model-config", "prefix-overflow", "empty-cached"].includes(mode)) {
        const context = normalizeContext({ systemPrompt: mode === "prefix-overflow" ? "x".repeat(90000) : "OLD_SYSTEM",
          messages: convertToLlm(manager.buildSessionProjection().messages) });
        const recorded = mode === "model-config" ? { ...model, samplingParams: { top_p: 0.9 } } : model;
        const prefix = captureCompressionPrefix(manager, mode === "selection" ? { ...selection, thinking: "low" } : selection,
          recorded, context, { sessionId: manager.getSessionId(), cacheRetention: "long" });
        saveCompressionPrefix(file, prefix);
      }
      if (mode === "stop-immediate") {
        await server.agents.command({ ...scope, requestId: randomUUID(), op: "prompt", params: { text: "BLOCKED_MAIN_REQUEST" } });
        await wait(() => !!held, "main request did not start");
        await server.agents.stop(scope);
        rmSync(`${file}.request-prefix.json`, { force: true });
        held = undefined;
      }
      const before = readFileSync(file, "utf8"), run = server.agents.info(scope).run;
      const start = requests.length;
      await call(scope);
      if (mode === "tail" || mode === "batch-cancel") {
        await wait(() => !!held, `${mode} request did not pause`);
        if (mode === "batch-cancel") await call(scope, "compression.cancel", { id: server.agents.compressions.info(scope)!.id });
        else {
          const current = SessionManager.open(file);
          current.appendMessage({ role: "user", content: "TAIL_AFTER_SNAPSHOT", timestamp: Date.now() });
          reply(held!, "## Goal\nRECOVERED USER_FIRST FINAL_CURRENT");
        }
      }
      await wait(() => server.agents.compressions.info(scope)?.state !== "running", `${mode} compression did not finish`);
      const job = server.agents.compressions.info(scope)!;
      assert.deepEqual(server.agents.info(scope).run, run, `${mode}: compression never starts/resumes a main run`);
      assert.ok(requests.slice(start).every(isCompressionRequest), `${mode}: only summary requests are sent`);
      if (!mode.startsWith("unsafe-")) assert.ok(requests.slice(start).every(body => !body.tools?.length && body.top_p === 0.5), `${mode}: native request uses current model without chat tools`);
      if (mode.startsWith("unsafe-") || mode === "empty" || mode === "empty-cached") {
        assert.equal(job.state, "failed", JSON.stringify(job));
        assert.equal(readFileSync(file, "utf8"), before, `${mode}: unsafe/empty summary cannot replace history, even with file metadata`);
        assert.match(job.error!, mode.startsWith("unsafe-") ? /配置不安全/ : /空内容/);
        assert.equal(physical, mode.startsWith("unsafe-") ? 0 : 1);
        assert.equal(job.billing?.records ?? 0, physical);
        continue;
      }
      if (mode === "batch-failure" || mode === "batch-cancel") {
        assert.equal(job.state, mode === "batch-failure" ? "failed" : "cancelled", JSON.stringify(job));
        assert.equal(readFileSync(file, "utf8"), before, `${mode}: no partial batch checkpoint is applied`);
        assert.equal(physical, 2);
        assert.equal(job.billing!.records, 2, "all physical attempts remain billable even if no checkpoint is committed");
        continue;
      }
      assert.equal(job.state, "completed", JSON.stringify(job));
      assert.ok(job.appliedAt);
      const committed = SessionManager.open(file), branch = committed.getBranch();
      const entry = branch.findLast(e => e.type === "compaction");
      assert.ok(entry?.type === "compaction");
      assert.match(entry.summary, /USER_FIRST/);
      if (!mode.startsWith("single")) assert.match(entry.summary, /FINAL_CURRENT/);
      assert.ok(readFileSync(file, "utf8").startsWith(before), "raw history is archived, never deleted or rewritten");
      if (mode === "native-overflow" || mode === "single-overflow" || mode === "batch-retry") {
        assert.ok(physical > 1, "over-window native history is summarized in bounded batches");
        if (mode === "native-overflow") assert.match(entry.summary, /PREVIOUS_SUMMARY/);
        for (let i = 0; i < 6; i++) assert.match(entry.summary, new RegExp(`ITEM_${i}`));
      }
      const projection = committed.buildSessionProjection().messages.filter(message => message.role !== "system");
      assert.equal(projection.length, mode === "tail" ? 2 : 1, `${mode}: every captured conversation message is replaced by the summary: ${JSON.stringify(projection)}`);
      if (mode === "tail") assert.match(JSON.stringify(projection.at(-1)), /TAIL_AFTER_SNAPSHOT/);
      assert.equal(job.billing!.records, physical);
      assert.equal(job.usage!.total, (physical - (mode === "batch-retry" ? 1 : 0)) * 120);
      if (mode === "batch-retry") assert.equal(job.billing!.unknownCost, 1, "the failed retry attempt is still a separate physical billing record");
      assert.ok(job.before! > job.after! || !large);
      if (mode !== "tail") await assert.rejects(call(scope), { code: "COMPRESSION_EMPTY" });
    }
  } finally {
    await app?.close();
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
    rmSync(root, { recursive: true, force: true });
  }
});
