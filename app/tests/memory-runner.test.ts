import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { ColdMemoryRunner } from "../src/server/memory-runner.js";
import { ModelService } from "../src/server/model-service.js";
import type { Scope, Workspace, Session } from "../src/shared/protocol.js";

test("pooled direct memory requests isolate bindings, record usage and cancel bounded queues", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-runner-")), project = join(root, "project");
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  const requests: any[] = [];
  let mode: "normal" | "repeat" | "pages" | "output" | "length" = "normal";
  let hanging = false, entered!: () => void;
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const value = JSON.parse(raw); requests.push({ ...value, observedAuthorization: req.headers.authorization });
    if (hanging) { entered(); return; }
    const message = value.messages.find((m: any) => m.role === "user");
    const content = typeof message.content === "string" ? message.content : message.content.map((c: any) => c.text ?? "").join("");
    const scope = JSON.parse(content) as Scope;
    const delta = { role: "assistant", content: mode === "output" ? "x".repeat(32001) : mode === "length" ? "部分回答" : `来源 ${scope.sessionId} 已读取，仅当前查询事实。` };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ id: "memory", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: mode === "length" ? "length" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const provider = { api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`, models: [{ id: "fixture", cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }] };
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { fixture: provider, alternate: provider } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" }, alternate: { type: "api_key", key: "alternate-key" } }));
  const store = new Store(root), memories = new Memories(store, () => {}), runner = new ColdMemoryRunner(memories, new ModelService(root)); memories.runner = runner;
  const metrics: any[] = [];
  runner.pool.onMetric = event => metrics.push(event);
  const waitForQueued = async () => {
    const deadline = Date.now() + 5000;
    while (runner.pool.stats().queued !== 1) {
      assert.ok(Date.now() < deadline, "the intended request must enter the bounded queue");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const create = () => { const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session; return { workspaceId: workspace.id, sessionId: session.id }; };
    const a = create(), b = create();
    writeFileSync(join(root, "memory", "sessions", a.sessionId, "MEMORY.md"), "ONLY_ALPHA_PRIVATE");
    writeFileSync(join(root, "memory", "sessions", b.sessionId, "MEMORY.md"), "ONLY_BETA_PRIVATE");
    const execute = (scope: Scope, signal?: AbortSignal, kind: "query" | "organize" = "query", provider = "fixture") => runner.execute({ scope, signal, kind, selection: { provider, id: "fixture", thinking: "off" }, prompt: JSON.stringify(scope), read: (id, path, offset, limit) => { assert.equal(id, scope.sessionId); return memories.read(scope, path, offset, limit); } });
    const first = await execute(a); assert.match(first.answer, new RegExp(a.sessionId));
    assert.deepEqual(runner.pool.requests.snapshot().providers, [{ providerId: 'fixture', current: 0, peak: 1, rpm: 1, callLevel: false }], 'real pooled worker emits physical HTTP statistics without counting auth/catalog preparation');
    const split = requests.length;
    const second = await execute(b); assert.match(second.answer, new RegExp(b.sessionId));
    assert.ok(!JSON.stringify(requests.slice(split)).includes("ONLY_ALPHA_PRIVATE"), "new bindings must not retain old messages or read permissions");
    assert.ok((await execute(a, undefined, "organize")).answer.includes(a.sessionId));
    const leases = metrics.filter(event => event.phase === "acquired").slice(0, 3);
    assert.equal(leases.length, 3);
    assert.equal(new Set(leases.map(event => `${event.instanceId}/${event.generation}`)).size, 1, "three tasks actually reuse one process generation");
    assert.equal(new Set(leases.map(event => event.leaseId)).size, 3);
    assert.equal(new Set(leases.map(event => event.profileHash)).size, 1);
    for (const lease of leases) assert.ok(metrics.some(event => event.phase === "released" && event.leaseId === lease.leaseId));
    const alternateStart = requests.length;
    assert.ok((await execute(b, undefined, "query", "alternate")).answer.includes(b.sessionId));
    const alternateLease = metrics.filter(event => event.phase === "acquired").at(-1);
    assert.notEqual(alternateLease.instanceId, leases[0].instanceId, "different providers use isolated process networks");
    assert.notEqual(alternateLease.profileHash, leases[0].profileHash);
    assert.ok(requests.slice(alternateStart).every(r => r.observedAuthorization === "Bearer alternate-key"));
    assert.ok(Number(store.db.prepare("SELECT COUNT(*) AS n FROM memory_usage WHERE sessionId=? AND provider=? AND usage IS NOT NULL").get(b.sessionId, "alternate")?.n) > 0, "current provider runtime charges the correct provider and session");
    assert.ok(!JSON.stringify(requests.slice(alternateStart)).includes("ONLY_ALPHA_PRIVATE"));
    const originalStart = requests.length;
    await execute(a);
    assert.ok(requests.slice(originalStart).every(r => r.observedAuthorization === "Bearer fixture"));
    assert.ok(requests.every((r) => !r.tools?.length));
    assert.ok(requests.every((r) => r.messages.filter((message: any) => message.role === "user").length === 1 && !r.messages.some((message: any) => ["assistant", "tool"].includes(message.role))));
    assert.ok(Number(store.db.prepare("SELECT COUNT(*) AS n FROM memory_usage WHERE usage IS NOT NULL").get()?.n) >= 4);
    await memories.command({ requestId: randomUUID(), op: "memory.configure", workspaceId: workspace.id, params: { concurrency: 1, queue: 1 } });
    hanging = true;
    const started = new Promise<void>((r) => { entered = r; });
    const active = new AbortController(), waiting = new AbortController();
    const one = execute(a, active.signal); const oneDone = assert.rejects(one, /取消|中断|abort/i);
    await started;
    // The fixture observes the same actual HTTP dispatch as the worker statistics.
    for (let attempt = 0; attempt < 100 && runner.pool.requests.snapshot().providers.find(row => row.providerId === 'fixture')?.current !== 1; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(runner.pool.requests.snapshot().providers.find(row => row.providerId === 'fixture')?.current, 1);
    const two = execute(b, waiting.signal); const twoDone = assert.rejects(two, /取消|超时/);
    // Model preparation is asynchronous; wait for this request's actual admission
    // before submitting the overflow request so filesystem completion order is irrelevant.
    await waitForQueued();
    await assert.rejects(execute(b), { code: "MEMORY_BUSY" });
    waiting.abort(); active.abort(); await Promise.all([oneDone, twoDone]);
    assert.equal(runner.pool.requests.snapshot().providers.find(row => row.providerId === 'fixture')?.current, 0, 'cancellation or process close releases inference concurrency');
    hanging = false; assert.ok((await execute(b)).answer.includes(b.sessionId));
    const configure = (params: Record<string, unknown>) => memories.command({ requestId: randomUUID(), op: "memory.configure", workspaceId: workspace.id, params });
    const noTools = await runner.execute({ scope: a, kind: "query", selection: { provider: "fixture", id: "fixture", thinking: "off" }, prompt: JSON.stringify(a), read: () => { throw Error("独立API不能调用读取工具"); } });
    assert.equal(noTools.incomplete, false);
    await configure({ maxTurns: 1, readChars: 16000 });
    assert.equal((await execute(a)).incomplete, false);
    assert.equal((await execute(a, undefined, "organize")).incomplete, false, "one direct request does not inherit legacy agent turn budgets");
    mode = "output";
    assert.equal((await execute(a)).incompleteReason, "output_limit");
    mode = "length";
    assert.equal((await execute(a)).incompleteReason, "model_output_limit");
    mode = "normal";
    await configure({ timeoutMs: 1000, readChars: 240000, maxTurns: 32 });
    hanging = true;
    const timeoutStarted = new Promise<void>((resolve) => { entered = resolve; });
    const timed = assert.rejects(execute(a), /执行时限已到.*1 秒/);
    await timeoutStarted;
    await configure({ timeoutMs: 300000 });
    await timed;
    hanging = true;
    const providerStarted = new Promise<void>((r) => { entered = r; });
    const running = execute(a), runningDone = assert.rejects(running, /取消|超时/);
    await providerStarted;
    const queued = execute(b), queuedDone = assert.rejects(queued, /取消|超时/);
    await waitForQueued();
    await assert.rejects(runner.stopProviders(["fixture"], false), { code: "ACTIVE_RUNS_CONFIRMATION_REQUIRED" });
    const beforeLogout = requests.length;
    await runner.stopProviders(["fixture"], true);
    await Promise.all([runningDone, queuedDone]);
    assert.equal(requests.length, beforeLogout, "provider cancellation also removes queued work before it starts");
    hanging = false; assert.ok((await execute(b)).answer.includes(b.sessionId));
  } finally {
    await memories.close(); store.close(); fixture.closeAllConnections(); await new Promise<void>((r) => fixture.close(() => r()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
