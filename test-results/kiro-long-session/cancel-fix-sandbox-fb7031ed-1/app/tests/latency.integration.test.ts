// Real worker, loopback model and WebSocket; no personal configuration or network services.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { LatencyRecord } from "../src/shared/latency.js";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 25000;
  while (!check()) { if (Date.now() > end) throw Error("fixture timed out"); await pause(20); }
}

test("loopback retries correlate headers, first output, IPC, batching and socket delivery across worker reuse", { timeout: 90000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-latency-integration-")), pi = join(root, "pi"), project = join(root, "project");
  mkdirSync(pi); mkdirSync(project);
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  let attempts = 0;
  const provider = createServer(async (req, res) => {
    for await (const _chunk of req) { /* Drain synthetic input. */ }
    const attempt = ++attempts;
    await pause(35);
    if (attempt <= 2) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "server_error", message: "overloaded SECRET_SENTINEL" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
    const chunk = (delta: object, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    await pause(45); chunk({ role: "assistant" });
    await pause(45); chunk({ content: "BODY_SENTINEL" });
    await pause(80); chunk({}, "stop"); res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "KEY_SENTINEL" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 50, provider: { maxRetries: 1 } }, compaction: { enabled: false }, cacheWarming: "off" }));
  let app: Awaited<ReturnType<typeof startServer>> | undefined, ws: WebSocket | undefined, secondSocket: WebSocket | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const service = app;
    const workspace = service.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
    const session = service.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    // Keep the fixture focused on model delivery, without title continuation turns.
    service.store.db.prepare("UPDATE sessions SET title=? WHERE id=?").run("Latency fixture", session.id);
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const events: any[] = [], pending = new Map<string, (event: any) => void>();
    ws = new WebSocket(service.origin.replace("http", "ws") + "/ws", { origin: service.origin });
    ws.on("message", raw => { const event = JSON.parse(raw.toString()); events.push(event); if (event.type === "receipt") { pending.get(event.requestId)?.(event); pending.delete(event.requestId); } });
    await new Promise<void>((resolve, reject) => { ws!.once("open", resolve); ws!.once("error", reject); });
    const command = (op: string, params: object = {}) => new Promise<any>((resolve, reject) => {
      const requestId = randomUUID(), timer = setTimeout(() => { pending.delete(requestId); reject(Error(`timeout: ${op}`)); }, 20000);
      pending.set(requestId, event => { clearTimeout(timer); event.ok ? resolve(event.data) : reject(Error(event.error.message)); });
      ws!.send(JSON.stringify({ op, params, requestId, ...scope }));
    });
    await command("agent.model", { selection: { provider: "fixture", id: "fixture", thinking: "off" } });
    await command("subscribe", { scope: `messages:${workspace.id}:${session.id}` });
    await command("subscribe", { scope: `thread:${workspace.id}:${session.id}` });
    const secondEvents: any[] = [];
    secondSocket = new WebSocket(service.origin.replace("http", "ws") + "/ws", { origin: service.origin });
    secondSocket.on("message", raw => secondEvents.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { secondSocket!.once("open", resolve); secondSocket!.once("error", reject); });
    secondSocket.send(JSON.stringify({ op: "subscribe", requestId: "second-subscription", params: { scope: `messages:${workspace.id}:${session.id}` } }));
    await until(() => secondEvents.some(e => e.requestId === "second-subscription" && e.ok));
    const run = await command("prompt", { text: "PROMPT_SENTINEL" });
    await until(() => !service.agents.active(scope));
    await until(() => events.some(e => e.latency?.runId === run.runId && !e.data.streaming));
    const { records } = await command("diagnostics.latency", { runId: run.runId }) as { records: LatencyRecord[] };
    assert.deepEqual(records.filter(r => r.stage === "http.headers").map(r => r.status), [503, 503, 200]);
    assert.equal(records.filter(r => r.stage === "model.request").length, 2, "one SDK retry and one session retry");
    assert.ok(records.some(r => r.stage === "retry.start" && r.code === "overloaded"));
    for (const stage of ["model.payload", "model.response", "model.first_event", "model.first_text", "model.end", "ipc.receive", "view.publish", "ws.enqueue", "ws.start", "ws.sent"])
      assert.ok(records.some(r => r.stage === stage), `missing ${stage}`);
    const headers = records.findLast(r => r.stage === "http.headers")!;
    const firstEvent = records.findLast(r => r.stage === "model.first_event")!;
    const firstText = records.findLast(r => r.stage === "model.first_text")!;
    assert.ok(headers.durationMs! >= 25); assert.ok(firstEvent.at - headers.at >= 30);
    assert.ok(firstText.at - firstEvent.at >= 30);
    const snapshot = events.findLast(e => e.latency?.runId === run.runId);
    assert.ok(records.some(r => r.stage === "ws.sent" && r.updateId === snapshot.latency.updateId && r.seq === snapshot.seq));
    assert.equal(snapshot.data.deliveryTiming, undefined, "timing uses the envelope, not chat text data");
    await until(() => secondEvents.some(e => e.seq === snapshot.seq));
    const secondSnapshot = secondEvents.find(e => e.seq === snapshot.seq);
    assert.ok(snapshot.latency.connectionId);
    assert.notEqual(snapshot.latency.connectionId, secondSnapshot.latency.connectionId);
    const sent = records.filter(r => r.stage === "ws.sent" && r.seq === snapshot.seq);
    assert.deepEqual(new Set(sent.map(r => r.connectionId)), new Set([snapshot.latency.connectionId, secondSnapshot.latency.connectionId]));
    assert.doesNotMatch(JSON.stringify(records), /SENTINEL|127\.0\.0\.1|authorization/i);
    const nextRun = await command("prompt", { text: "SECOND_PROMPT_SENTINEL" });
    await until(() => !service.agents.active(scope));
    const second = await command("diagnostics.latency", { runId: nextRun.runId }) as { records: LatencyRecord[] };
    assert.equal(second.records.filter(r => r.stage === "model.request").length, 1, "reused worker must not accumulate wrappers");
    assert.ok(second.records.every(r => r.runId === nextRun.runId));
  } finally {
    ws?.terminate(); secondSocket?.terminate(); await app?.close();
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
