import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { compressionMemoryPrompt } from "../src/server/compression-memory.js";
import { compressionMemoryRead, isCompressionRequest } from "./compression-memory-fixture.js";
import { until } from "./rewrite-fixture.js";
import type { Session, Workspace, Scope } from "../src/shared/protocol.js";

// No remote model calls. Every file, port and worker belongs to this fixture.
test("precompression reminder: optional memory work, safe points and cancellation", { timeout: 120000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-precompact-loopback-"))), project = join(root, "project");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
  let mode: "write" | "edit" | "handoff" | "ignore" | "failedWrite" | "cancel" | "cancelRejected" | "overflow" = "write", memoryPath = "", held: ServerResponse | undefined;
  let settled: ServerResponse | undefined, releaseSettled = false, seedHeld: ServerResponse | undefined;
  const requests: any[] = [];
  let summaries = 0;
  const stream = (response: ServerResponse, delta: unknown, finish = "stop") => {
    for (const [value, finish_reason] of [[delta, null], [{}, finish]]) response.write(`data: ${JSON.stringify({
      id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", model: "fixture", choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  };
  const provider = createServer(async (request, response) => {
    if (request.url === "/settled") {
      if (mode === "handoff" && !releaseSettled) settled = response;
      else response.end("ok");
      return;
    }
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const reminder = compressionMemoryRead(body);
    if (reminder && mode === "overflow") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "request exceeds the context window", code: "context_length_exceeded" } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" }); response.flushHeaders();
    if (isCompressionRequest(body)) {
      summaries++;
      stream(response, { role: "assistant", content: "## Goal\nPREPARED_MEMORY_SUMMARY" });
      return;
    }
    if (reminder && (mode === "cancel" || mode === "cancelRejected")) { held = response; return; }
    if (reminder && mode === "edit") {
      stream(response, { role: "assistant", tool_calls: [{ index: 0, id: "save-compression-memory", type: "function",
        function: { name: "edit", arguments: JSON.stringify({ path: memoryPath, oldText: "# [已完成] 压缩前保存的关键决定", newText: "# [已完成] 压缩前保存的关键决定\n## [已完成] 核对关键决定" }) } }] }, "tool_calls");
      return;
    }
    if (!reminder && mode === "edit" && body.messages.at(-1)?.role === "user") {
      stream(response, { role: "assistant", tool_calls: [{ index: 0, id: "seed-read", type: "function",
        function: { name: "read", arguments: JSON.stringify({ path: memoryPath }) } }] }, "tool_calls");
      return;
    }
    if (reminder && mode !== "ignore") {
      stream(response, { role: "assistant", tool_calls: [{ index: 0, id: "save-compression-memory", type: "function",
        function: { name: "write", arguments: JSON.stringify({ path: mode === "failedWrite" ? join(memoryPath, "invalid") : memoryPath,
          content: "# [已完成] 压缩前保存的关键决定\n" }) } }] }, "tool_calls");
      return;
    }
    if (mode !== "handoff" && !seedHeld && !body.messages.some((message: any) => JSON.stringify(message).includes(compressionMemoryPrompt))) {
      seedHeld = response;
      return;
    }
    stream(response, { role: "assistant", content: "done" });
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions",
    baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: true, keepRecentTokens: 1 } }));
  mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(project, ".pi", "extensions", "settle.ts"),
    `export default function(pi) { pi.on("agent_settled", async () => { await fetch("http://127.0.0.1:${(provider.address() as any).port}/settled"); }); }`);
  const app = await startServer({ root, port: 0 });
  // Background title/organization requests are independent of this conversation
  // and must not race its request ordering or compression-summary counter.
  // Real reminder delivery, memory tools, Pi compression and cancellation remain unmocked.
  app.agents.memories.runner!.execute = async input => {
    assert.ok(input.kind === "organize" || input.kind === "title");
    return { answer: input.kind === "organize" ? "[]" : "压缩前记忆验证", incomplete: false };
  };
  const compressionEvents: string[] = [];
  const warnings: string[] = [], compressionEvent = app.agents.compressions.event.bind(app.agents.compressions);
  t.mock.method(app.agents.compressions, "event", (scope: Scope, runId: string, event: any) => {
    if (event.type.startsWith("compression-")) compressionEvents.push(event.type);
    if (event.type === "warning") warnings.push(event.text);
    compressionEvent(scope, runId, event);
  });
  t.after(async () => {
    provider.closeAllConnections();
    await app.close(); await new Promise<void>(resolve => provider.close(() => resolve()));
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  for (const scenario of ["write", "edit", "handoff", "ignore", "failedWrite", "cancel", "cancelRejected", "overflow"] as const) {
    mode = scenario; held = undefined; seedHeld = undefined; requests.length = 0; compressionEvents.length = 0; warnings.length = 0;
    const previousSummaries = summaries;
    const session = app.store.execute({ op: "session.create", workspaceId: workspace.id, requestId: randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    memoryPath = join(memoryDirectory(root, session.id), "MEMORY.md");
    const agent = (op: string, params = {}) => app.agents.command({ op, params, ...scope, requestId: randomUUID() });
    const compress = (op: string, params = {}) => app.agents.compressions.command({ op, params, ...scope, requestId: randomUUID() });
    await agent("agent.model", { selection: { provider: "fixture", id: "fixture", thinking: "off" } });
    if (scenario === "edit") {
      mkdirSync(memoryDirectory(root, session.id), { recursive: true });
      writeFileSync(memoryPath, "# [已完成] 压缩前保存的关键决定\n");
    }
    await agent("prompt", { text: "保留这个关键决定" });
    if (scenario === "handoff") await until(() => !!settled, "seed did not enter its settlement window");
    else await until(() => !!seedHeld, "seed run did not enter the held active request");
    const seedRequest = requests[0], before = readFileSync(memoryPath, "utf8");
    await compress("compression.start");
    if (scenario === "handoff") {
      // The asynchronous extension gives IPC time to arrive after actionable boundaries.
      await new Promise(resolve => setTimeout(resolve, 100));
      releaseSettled = true; settled!.end("ok");
    } else {
      // Request compression while the main session is active; only active runs
      // must receive the reminder before their next completed boundary.
      await new Promise(resolve => setTimeout(resolve, 100)); // let queued snapshot IPC reach the active worker
      stream(seedHeld!, { role: "assistant", content: "done" });
    }
    if (scenario === "cancel" || scenario === "cancelRejected") {
      await until(() => !!held, "maintenance did not reach held request");
      await until(() => app.agents.info(scope).run?.status === "running", "maintenance running state did not reach the parent");
      if (scenario === "cancelRejected") await assert.rejects(agent("prompt", { text: "追加要求",
        skills: [{ id: "0".repeat(64), name: "removed-skill", description: "" }] }), { code: "INPUT_REJECTED" });
      await compress("compression.cancel", { id: app.agents.compressions.info(scope)!.id });
      // Job cancellation must not abort this user-started main run. Let its
      // held provider request settle independently before waiting for idle.
      stream(held!, { role: "assistant", content: "memory request finished after compression cancellation" });
    }
    await until(() => app.agents.compressions.info(scope)?.state !== "running", `compression did not settle: ${scenario}`);
    await until(() => !app.agents.active(scope), "maintenance run did not settle");
    const job = app.agents.compressions.info(scope)!;
    if (scenario !== "cancel" && scenario !== "cancelRejected" && scenario !== "overflow") {
      if (scenario === "handoff") {
        assert.ok(compressionEvents.includes("compression-deferred"), "unsent reminder is handed off after settlement");
        assert.equal(job.state, "completed", job.error ?? "");
        assert.equal(readFileSync(memoryPath, "utf8"), before, "settlement handoff does not restart the session for memory work");
        assert.ok(summaries > previousSummaries);
        assert.ok(!requests.some(request => JSON.stringify(request.messages.at(-1)).includes(compressionMemoryPrompt)), "released transcript is compressed directly");
        continue;
      }
      assert.equal(job.state, "completed", job.error ?? "");
      if (scenario === "ignore" || scenario === "failedWrite") assert.equal(readFileSync(memoryPath, "utf8"), before);
      else assert.match(readFileSync(memoryPath, "utf8"), scenario === "edit" ? /核对关键决定/ : /压缩前保存的关键决定/);
      assert.ok(summaries > previousSummaries);
      const firstMaintenance = requests.find(request => JSON.stringify(request.messages.at(-1)).includes(compressionMemoryPrompt));
      assert.ok(firstMaintenance);
      assert.deepEqual(firstMaintenance.messages.slice(0, seedRequest.messages.length), seedRequest.messages, "the prior provider prefix is unchanged");
      const file = String(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(session.id)!.file);
      const entries = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.equal(entries.filter(entry => entry.type === "custom_message" && entry.customType === "axiom-compression-memory").length, 1);
      assert.equal(entries.filter(entry => entry.type === "message" && entry.message.role === "user").length, 1, "active maintenance creates no user turn");
      const writeIndex = entries.findIndex(entry => entry.message?.role === "toolResult" && entry.message.toolCallId === "save-compression-memory");
      const compactIndex = entries.findIndex(entry => entry.type === "compaction");
      if (scenario === "ignore") {
        assert.equal(writeIndex, -1, "no memory tool call is required to compress");
        assert.equal(entries.filter(entry => entry.message?.role === "toolResult").length, 0);
        assert.ok(compactIndex >= 0);
      } else {
        assert.ok(writeIndex >= 0 && compactIndex > writeIndex);
        assert.equal(entries[writeIndex].message.isError, scenario === "failedWrite", "valid tree mutations succeed; tool errors do not gate compression");
      }
    } else {
      assert.equal(job.state, scenario === "cancel" || scenario === "cancelRejected" ? "cancelled" : "failed", job.error ?? "");
      assert.equal(summaries, previousSummaries, "cancelled or interrupted preparation never starts the Axiom background summary");
      assert.equal(readFileSync(memoryPath, "utf8"), before);
      if (scenario === "overflow") {
        // Pi's independent overflow safety net is allowed to compact and retry.
        // This fixture rejects that retry too; it must not revive the failed
        // Axiom preparation or report that native compression was suppressed.
        const file = String(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(session.id)!.file);
        const compactions = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line)).filter(entry => entry.type === "compaction");
        assert.equal(compactions.length, 1, "native overflow compacted once before its retry failed");
        assert.ok(compactions.every(entry => !entry.details?.axiomCompressionId), "failed preparation never publishes an Axiom summary");
        assert.ok(warnings.some(warning => warning.includes("Context overflow recovery failed")), warnings.join("\n"));
        assert.ok(!warnings.some(warning => warning.includes("原生压缩未执行")), "the native safety net is not disabled by preparation");
      }
    }
  }
});
