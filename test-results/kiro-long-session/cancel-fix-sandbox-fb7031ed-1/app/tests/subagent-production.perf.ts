// Production subscription benchmark. Run alone; all data and model traffic are synthetic.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
const source = resolve(process.env.AXIOM_PERF_SOURCE || "src"), smoke = process.env.AXIOM_PERF_SMOKE === "1";
const output = resolve(process.env.AXIOM_PERF_OUTPUT || "test-results/subagent-production-performance.json");
const { startServer } = await import(pathToFileURL(join(source, "server/index.ts")).href);
const result: any = { source, node: process.version, mode: smoke ? "smoke" : "full", generatedAt: new Date().toISOString(),
  sourceHashes: Object.fromEntries(["server/index.ts", "server/agents.ts", "server/agents/views.ts", "server/agent-worker.ts", "server/tasks/scheduler.ts"].map(file => [file, createHash("sha256").update(readFileSync(join(source, file))).digest("hex")])), samples: [] };
const wait = async (check: () => boolean, label: string) => { const end = Date.now() + 90000; while (!check()) { assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 5)); } };
const settle = () => new Promise(r => setTimeout(r, 45));
try {
  for (const size of smoke ? [6] : [6, 16]) {
    const root = mkdtempSync(join(tmpdir(), "axiom-production-perf-")), pi = join(root, "pi"), project = join(root, "project");
    mkdirSync(pi); mkdirSync(project); writeFileSync(join(project, "fixture.txt"), "fixed tool evidence");
    const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
    const held = new Map<number, ServerResponse>(); let requests = 0, providerError: unknown;
    const chunk = (response: ServerResponse, delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const finish = (response: ServerResponse, reason = "stop") => { chunk(response, {}, reason); response.end("data: [DONE]\n\n"); };
    const provider = createServer(async (request, response) => {
      try {
        const body: Buffer[] = []; for await (const part of request) body.push(part);
        const data = JSON.parse(Buffer.concat(body).toString()), index = Number(JSON.stringify(data.messages).match(/perf-child-(\d+)/)?.[1]);
        assert.ok(Number.isInteger(index), "request must belong to a fixture child"); requests++;
        response.writeHead(200, { "Content-Type": "text/event-stream" }); response.flushHeaders();
        if (!data.messages.some((message: any) => message.role === "tool")) {
          chunk(response, { role: "assistant", tool_calls: [{ index: 0, id: `read-${index}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path: join(project, "fixture.txt") }) } }] });
          finish(response, "tool_calls");
        } else { held.set(index, response); chunk(response, { role: "assistant", content: "stream evidence " }); }
      } catch (error) { providerError = error; response.writeHead(500); response.end("fixture failed"); }
    });
    await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
    writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 128000, maxTokens: 1000 }] } } }));
    writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
    writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false }, steeringMode: "one-at-a-time" }));
    let app: any, ws: WebSocket | undefined;
    const originalOpen = SessionManager.open;
    try {
      app = await startServer({ root, port: 0 });
      const store = app.store, views = app.agents.views, scheduler = app.tasks.scheduler, records = app.tasks.records;
      const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } });
      const parent = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id });
      const scope = { workspaceId: workspace.id, sessionId: parent.id };
      records.freeze(scope);
      const foreground = SessionManager.create(project, join(root, "sessions"));
      foreground.appendMessage({ role: "user", content: "foreground", timestamp: 1 });
      foreground.appendMessage({ role: "assistant", content: [{ type: "text", text: "foreground evidence" }], timestamp: 2, stopReason: "stop" } as any);
      store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(parent.id, foreground.getSessionFile());
      store.db.prepare("INSERT OR REPLACE INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency: size, workMs: 600000 }));
      let counts = { bytes: 0, messages: 0, queues: 0, threads: 0, opens: 0, publications: 0 };
      const delta = (before: typeof counts) => Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value - before[key as keyof typeof counts]]));
      const latest = new Map<string, string>();
      const changed = views.messageChanged.bind(views); views.messageChanged = (owner: any, message: any) => { latest.set(owner.sessionId, message.text || ""); return changed(owner, message); };
      const thread = views.thread.bind(views); views.thread = (...args: any[]) => { counts.threads++; return thread(...args); };
      const publish = views.publish.bind(views); views.publish = (...args: any[]) => { counts.publications++; return publish(...args); };
      const event = app.agents.externalEvent; app.agents.onEvent = (owner: any, run: any, value: any) => { if (value.type === "queue") counts.queues++; event?.(owner, run, value); };
      SessionManager.open = (...args: Parameters<typeof originalOpen>) => { counts.opens++; return originalOpen(...args); };
      ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
      const pending = new Map<string, (value: any) => void>();
      ws.on("message", raw => { counts.bytes += Buffer.byteLength(raw.toString()); counts.messages++; const value = JSON.parse(raw.toString()); if (value.type === "receipt") { pending.get(value.requestId)?.(value); pending.delete(value.requestId); } });
      await new Promise<void>((r, reject) => { ws!.once("open", r); ws!.once("error", reject); });
      const request = (op: string, params: object = {}) => new Promise<any>(r => { const requestId = randomUUID(); pending.set(requestId, r); ws!.send(JSON.stringify({ op, params, requestId, ...scope })); });
      for (const key of [`messages:${workspace.id}:${parent.id}`, `thread:${workspace.id}:${parent.id}`, "pinned-sessions", `costs:${workspace.id}:${parent.id}`]) assert.equal((await request("subscribe", { scope: key })).ok, true);
      const ids: string[] = [];
      while (ids.length < size) ids.push(...records.create(scope, randomUUID(), "local benchmark", Array.from({ length: Math.min(8, size - ids.length) }, (_, i) => ({ task: `perf-child-${ids.length + i}` })), { provider: "fixture", id: "fixture", thinking: "off" }).taskIds);
      const rows = ids.map(id => records.rows("WHERE id=?", id)[0]);
      scheduler.preferencesChanged();
      await wait(() => !!providerError || held.size === size, "workers did not reach streaming after their read tool");
      assert.equal(providerError, undefined); await settle(); await request("ping");
      const stream: any[] = [], operations: any[] = [];
      for (let i = 0; i < (smoke ? 3 : 22); i++) {
        const before = { ...counts }, start = performance.now(), marker = `sample-${i}`;
        held.forEach(response => chunk(response, { content: ` ${marker} ` }));
        await wait(() => rows.every(row => latest.get(row.sessionId)?.includes(marker)), "all children must publish the stream marker");
        await settle(); await request("ping");
        if (i >= 2) stream.push({ ms: performance.now() - start, ...delta(before) });
      }
      const child = { workspaceId: workspace.id, sessionId: rows[0].sessionId };
      const command = (op: string, params: object, requestId = randomUUID()) => app.tasks.command({ op, params, requestId, ...child });
      const receipt = (id: string) => store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(id)?.state;
      for (let i = 0; i < (smoke ? 3 : 22); i++) {
        const before = { ...counts }, start = performance.now(), withdrawn = randomUUID(), consumed = randomUUID();
        await command("prompt", { text: `recall-${i}` }, withdrawn);
        await wait(() => receipt(withdrawn) === "accepted", "withdrawal input not accepted");
        const recalled = await command("agent.recall", {}); assert.deepEqual(recalled.ids, [withdrawn]); assert.equal(receipt(withdrawn), "cancelled");
        await command("prompt", { text: `consume-${i}` }, consumed);
        await wait(() => receipt(consumed) === "accepted", "consumption input not accepted");
        const old = held.get(0)!; finish(old);
        await wait(() => held.get(0) !== old && receipt(consumed) === "delivered", "accepted input must reach the next model round exactly once");
        await settle(); await request("ping");
        if (i >= 2) operations.push({ ms: performance.now() - start, ...delta(before), withdrawn: receipt(withdrawn), consumed: receipt(consumed) });
      }
      const beforeCancel = { ...counts }, cancelStart = performance.now();
      await command("agent.stop", { runId: records.rows("WHERE id=?", ids[0])[0].runId });
      await wait(() => records.rows("WHERE id=?", ids[0])[0].status === "cancelled" && !app.agents.active(child), "cancel did not settle");
      await settle(); await request("ping");
      const cancel = { ms: performance.now() - cancelStart, ...delta(beforeCancel) };
      for (let index = 1; index < size; index++) finish(held.get(index)!);
      await wait(() => rows.slice(1).every(row => records.rows("WHERE id=?", row.id)[0].status === "completed" && !app.agents.active({ ...scope, sessionId: row.sessionId })), "remaining tasks did not complete");
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM task_results").get().n, size);
      assert.equal(requests, size * 2 + (smoke ? 3 : 22));
      await new Promise<void>(r => { ws!.once("close", r); ws!.close(); });
      const heapBeforeClose = process.memoryUsage().heapUsed;
      await app.close(); app = undefined;
      const cleanup = Object.fromEntries(["jobs", "launching", "handed", "failedInputs", "nativePending", "nativeQueues", "pendingViews"].map(key => [key, scheduler[key]?.size ?? null]));
      for (const [key, count] of Object.entries(cleanup)) if (count !== null) assert.equal(count, 0, `cleanup ${key}`);
      result.samples.push({ size, stream, operations, cancel, requests, cleanup, heapBeforeClose, heapAfterClose: process.memoryUsage().heapUsed, resourcesAfterClose: process.getActiveResourcesInfo() });
    } finally {
      SessionManager.open = originalOpen; ws?.terminate(); await app?.close(); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  }
  result.status = "completed";
} catch (error) { result.status = "failed"; result.error = String(error); throw error; }
finally { mkdirSync(resolve(output, ".."), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2)); }
console.log(JSON.stringify({ output, status: result.status }));
