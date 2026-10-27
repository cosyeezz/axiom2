import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { compressionRequestMarker } from "../src/server/compression-request.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 30000;
  while (!check()) {
    assert.ok(Date.now() < end, message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const isSummary = (body: any) => {
  const last = body.input?.at(-1);
  const text = typeof last?.content === "string" ? last.content : last?.content?.map((part: any) => part.text ?? "").join("\n");
  return text?.startsWith(compressionRequestMarker) ?? false;
};
const reply = (res: ServerResponse, text: string, cached: boolean) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const id = `resp_${randomUUID()}`, itemId = `msg_${randomUUID()}`;
  const item = { id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  const event = (value: { type: string; [key: string]: unknown }) => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
  event({ type: "response.created", response: { id, status: "in_progress" } });
  event({ type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } });
  event({ type: "response.output_text.delta", item_id: itemId, output_index: 0, content_index: 0, delta: text });
  event({ type: "response.output_item.done", output_index: 0, item });
  event({ type: "response.completed", response: { id, status: "completed", model: "gpt-5.2", service_tier: "priority", output: [item],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: cached ? 80 : 0 } } } });
  res.end();
};

test("Responses priority+xhigh native compression preserves the real provider prefix instead of rejecting the service tier", { timeout: 90000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-compression-service-tier-")), project = join(root, "project");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  const requests: any[] = [];
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    reply(res, isSummary(body) ? "## Goal\nPriority native handoff\n## Progress\nRetain the complete task state." : "Priority chat completed.", isSummary(body));
  });
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { fixture: {
      api: "openai-responses", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
      models: [{ id: "gpt-5.2", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" }, contextWindow: 64000, maxTokens: 1000,
        samplingParams: { service_tier: "priority" } }],
    } } }));
    const modelsFile = join(root, "pi/models.json"), originalModels = readFileSync(modelsFile, "utf8");
    writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
    writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    app = await startServer({ root, port: 0 });
    const server = app;
    await server.agents.compressions.command({ requestId: randomUUID(), op: "compression.preferences.save", params: { auto: { enabled: false } } });
    const workspace = server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const session = server.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const selection = { provider: "fixture", id: "gpt-5.2", thinking: "xhigh" as const };
    await server.agents.command({ ...scope, requestId: randomUUID(), op: "agent.model", params: { selection } });
    await server.agents.command({ ...scope, requestId: randomUUID(), op: "prompt", params: { text: "Keep this real priority request in the complete handoff." } });
    await wait(() => !server.agents.active(scope), "real Responses chat did not settle");
    await server.agents.releaseIdle(scope);
    const file = String(server.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file);
    await server.agents.compressions.command({ ...scope, requestId: randomUUID(), op: "compression.start", params: {} });
    await wait(() => !!server.agents.compressions.info(scope) && server.agents.compressions.info(scope)!.state !== "running", "priority compaction did not settle");
    const job = server.agents.compressions.info(scope)!;
    assert.equal(job.state, "completed", JSON.stringify(job));
    assert.deepEqual(job.selection, selection);
    const summaries = requests.filter(isSummary);
    assert.ok(summaries.length > 0, "priority must reach native HTTP compaction instead of failing at snapshot");
    for (const summary of summaries) {
      const prefix = requests.slice(0, requests.indexOf(summary)).findLast(body => !isSummary(body) && body.tools?.length);
      assert.ok(prefix, "a real tool-bearing chat request preceded compaction");
      assert.equal(prefix.service_tier, "priority");
      assert.equal(summary.service_tier, prefix.service_tier, "never delete or downgrade the user's tier to make compression pass");
      assert.equal(summary.reasoning.effort, "xhigh");
      assert.deepEqual(summary.reasoning, prefix.reasoning);
      assert.equal(summary.model, prefix.model);
      assert.equal(summary.instructions, prefix.instructions);
      assert.deepEqual(summary.input.slice(0, prefix.input.length), prefix.input);
      assert.deepEqual(summary.tools, prefix.tools);
      assert.ok(prefix.prompt_cache_key);
      assert.equal(summary.prompt_cache_key, prefix.prompt_cache_key);
    }
    assert.ok(job.usage!.cacheRead! >= 80, "simulated provider cache reads survive native aggregation");
    const branch = SessionManager.open(file).getBranch();
    assert.equal(branch.filter(entry => entry.type === "compaction").length, 1);
    assert.ok(!branch.some(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some(part => part.type === "toolCall")));
    assert.equal(readFileSync(modelsFile, "utf8"), originalModels, "the fix does not rewrite model configuration");
  } finally {
    await app?.close();
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
