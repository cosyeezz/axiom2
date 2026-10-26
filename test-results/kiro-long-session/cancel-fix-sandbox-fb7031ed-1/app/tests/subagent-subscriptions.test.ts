import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { until } from "./rewrite-fixture.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("six real background children preserve lazy histories, summaries, reconnect snapshots and deletion cleanup", { timeout: 120000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-live-subscriptions-")), project = join(root, "project"), pi = join(root, "pi");
  mkdirSync(project); mkdirSync(pi);
  // SDK settings reads create this parent. Initialize it before concurrent workers
  // so a missing-to-directory transition cannot invalidate another worker's scan.
  mkdirSync(join(project, ".pi"));
  writeFileSync(join(project, "sentinel.txt"), "unchanged");
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  const responses: ServerResponse[] = [], sockets: WebSocket[] = [];
  const chunk = (response: ServerResponse, delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  let finishing = false;
  const finish = (response: ServerResponse) => {
    chunk(response, {}, "stop");
    response.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  };
  const provider = createServer(async (request, response) => {
    for await (const _ of request) { /* Synthetic loopback requests only. */ }
    response.writeHead(200, { "Content-Type": "text/event-stream" }); response.flushHeaders();
    responses.push(response); chunk(response, { role: "assistant", content: "live evidence " });
    if (finishing) finish(response);
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 64000, maxTokens: 1000, cost: { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 } }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false }, steeringMode: "one-at-a-time" }));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
    const parent = app.store.execute({ op: "session.create", workspaceId: w.id, requestId: randomUUID() }) as Session;
    const scope = { workspaceId: w.id, sessionId: parent.id };
    const connect = async () => {
      const ws = new WebSocket(app!.origin.replace("http", "ws") + "/ws", { origin: app!.origin }); sockets.push(ws);
      const events: any[] = [], pending = new Map<string, (event: any) => void>();
      ws.on("message", raw => { const event = JSON.parse(raw.toString()); events.push(event); if (event.type === "receipt") { pending.get(event.requestId)?.(event); pending.delete(event.requestId); } });
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      const request = (op: string, params: object = {}, owner: Scope = scope) => new Promise<any>(resolve => {
        const requestId = randomUUID(); pending.set(requestId, resolve); ws.send(JSON.stringify({ op, params, requestId, ...owner }));
      });
      const close = () => new Promise<void>(resolve => { ws.once("close", resolve); ws.close(); });
      return { ws, events, request, close };
    };
    const client = await connect(), records = new TaskRecords(app.store), views = (app.agents as any).views, scheduler = (app.tasks as any).scheduler;
    records.freeze(scope);
    app.store.db.prepare("INSERT OR REPLACE INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency: 6, workMs: 600000 }));
    const manager = SessionManager.create(project, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "foreground", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "foreground answer" }], timestamp: 2, stopReason: "stop" } as any);
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(parent.id, manager.getSessionFile()!);
    for (const key of [`messages:${w.id}:${parent.id}`, `thread:${w.id}:${parent.id}`, "pinned-sessions", `costs:${w.id}:${parent.id}`])
      assert.equal((await client.request("subscribe", { scope: key })).ok, true);
    const { taskIds } = records.create(scope, "real-backgrounds", "local evidence only", Array.from({ length: 6 }, (_, i) => ({ task: `child-${i}` })), { provider: "fixture", id: "fixture", thinking: "off" });
    scheduler.preferencesChanged();
    await until(() => responses.length === 6 && records.rows("WHERE status='running'").length === 6, "six real workers did not stream", 60000).catch(error => {
      throw new Error(`${error.message}; responses=${responses.length}; tasks=${JSON.stringify(records.rows().map(({ status, error }) => ({ status, error })))}`);
    });
    const children = taskIds.map(id => target(records.rows("WHERE id=?", id)[0]));
    await new Promise(resolve => setTimeout(resolve, 80));
    const backgroundCaches = children.map(child => views.messages.peek(child.sessionId));
    const open = t.mock.method(SessionManager, "open");
    for (let round = 0; round < 5; round++) {
      responses.forEach(response => chunk(response, { content: `round-${round} ` }));
      await new Promise(resolve => setTimeout(resolve, 45));
    }
    await client.request("ping");
    assert.equal(open.mock.callCount(), 0, "stable unobserved worker output never rereads background histories");
    assert.ok(views.messages.has(parent.id), "foreground history remains cached");
    children.forEach((child, i) => assert.equal(views.messages.peek(child.sessionId), backgroundCaches[i], "streaming does not rebuild startup caches"));
    const summary = client.events.filter(e => e.scope === "pinned-sessions").at(-1).data.find((s: any) => s.id === parent.id);
    assert.equal(summary.activeTaskCount, 6); assert.equal(summary.activeTasks, true);
    const readVersion = app.store.session(w.id, parent.id).readVersion;
    // Real IPC succeeds while reporting backpressure. Request identity, not text, controls deduplication.
    const worker = (app.agents as any).runs.live.get(children[0].sessionId).child;
    const send = worker.send.bind(worker);
    worker.send = (...args: any[]) => { send(...args); return false; };
    const inputIds = [randomUUID(), randomUUID()];
    const command = (id: string) => app!.tasks.command({ op: "prompt", requestId: id, ...children[0], params: { text: "same text, distinct input" } });
    try {
      const first = await command(inputIds[0]);
      assert.deepEqual(await command(inputIds[0]), first);
      await command(inputIds[1]);
    } finally { worker.send = send; }
    finishing = true; responses.forEach(finish);
    await until(() => records.rows("WHERE status='completed'").length === 6, "children did not finish");
    await until(() => children.every(child => !app!.agents.active(child)), "children did not retire to idle");
    await client.request("ping");
    assert.equal(responses.length, 8, "six initial requests and one round per steering input; no duplicate or parent wake");
    for (const id of inputIds) assert.equal(app.store.db.prepare("SELECT state FROM task_input_receipts WHERE inputId=?").get(id)!.state, "delivered");
    const finished = client.events.filter(e => e.scope === "pinned-sessions").at(-1).data.find((s: any) => s.id === parent.id);
    assert.equal(finished.activeTaskCount, 0); assert.equal(finished.unread, true);
    assert.equal(finished.resultVersion, 6); assert.equal(app.store.session(w.id, parent.id).readVersion, readVersion);
    assert.equal((await client.request("session.view", { active: true })).ok, true);
    assert.equal(app.store.session(w.id, parent.id).readVersion, readVersion, "viewing is not acknowledgement");
    const costs = await client.request("costs.get"); assert.equal(costs.ok, true);
    assert.equal(costs.data.total.knownCost, 1);
    app.agents.publish(`sessions:${w.id}`); app.agents.publish(`agent:${w.id}:${parent.id}`);
    const refreshedCosts = (await client.request("costs.get")).data;
    const { updatedAt: beforeRefresh, ...beforeCosts } = costs.data;
    const { updatedAt: afterRefresh, ...afterCosts } = refreshedCosts;
    assert.ok(afterRefresh >= beforeRefresh);
    assert.deepEqual(afterCosts, beforeCosts, "repeated invalidation does not duplicate cost");
    const child = children[0], collection = `messages:${w.id}:${child.sessionId}`;
    assert.equal((await client.request("subscribe", { scope: collection })).ok, true);
    const initial = client.events.filter(e => e.scope === collection).at(-1).data;
    assert.ok(initial.length >= 2);
    const file = String(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(child.sessionId)!.file);
    await client.close();
    const childManager = SessionManager.open(file);
    for (const id of inputIds) assert.equal(childManager.getEntries().filter(entry => entry.type === "custom_message" && (entry.details as any)?.axiomInput === id).length, 1, "each distinct same-text input is consumed exactly once");
    childManager.appendMessage({ role: "assistant", axiomId: "offline-added", content: [{ type: "text", text: "persisted while disconnected" }], timestamp: 3, stopReason: "stop" } as any);
    views.refresh(child);
    const reconnected = await connect();
    assert.equal((await reconnected.request("subscribe", { scope: collection })).ok, true);
    const snapshot = reconnected.events.filter(e => e.scope === collection).at(-1);
    assert.deepEqual(snapshot.data.map((m: any) => m.id), [...initial.map((m: any) => m.id), "offline-added"]);
    assert.equal(snapshot.data.at(-1).text, "persisted while disconnected");
    assert.equal(app.store.session(w.id, parent.id).readVersion, readVersion, "reconnect cannot mark results read");
    views.messageChanged(child, { id: "after-reconnect", role: "assistant", text: "fresh delta", streaming: true }); views.flush(child);
    await reconnected.request("ping");
    assert.ok(reconnected.events.some(e => e.scope === `message:${w.id}:${child.sessionId}:after-reconnect` && e.data.text === "fresh delta"));
    const direct = await connect(), single = `message:${w.id}:${child.sessionId}:after-reconnect`;
    assert.equal((await direct.request("subscribe", { scope: single })).ok, true);
    assert.equal(direct.events.filter(e => e.scope === single).at(-1).data.text, "fresh delta");
    views.messageChanged(child, { id: "after-reconnect", role: "assistant", text: "updated delta", streaming: true }); views.flush(child);
    await direct.request("ping"); assert.equal(direct.events.filter(e => e.scope === single).at(-1).data.text, "updated delta");
    const resultIds = app.store.db.prepare("SELECT id FROM task_results ORDER BY rowid").all().map(row => row.id);
    assert.equal((await reconnected.request("session.read", { throughVersion: 6 })).ok, true);
    assert.equal(app.store.session(w.id, parent.id).readVersion, 6);
    // Leave a real publication timer pending, then delete through the production command route.
    views.messageChanged(child, { id: "delete-pending", role: "assistant", text: "must not reappear", streaming: true });
    assert.equal((await reconnected.request("session.delete", { confirmed: true })).ok, true);
    await tick(); await tick();
    for (const owner of [scope, ...children]) for (const key of ["transient", "changedMessages", "timers", "originals", "contextRevision", "messages", "queues"])
      assert.equal(views[key].has(owner.sessionId), false, `${key} retained a deleted session`);
    for (const key of ["handed", "failedInputs", "nativePending", "nativeQueues", "launching", "cancelling", "recalling", "pendingViews"])
      assert.equal(scheduler[key].size, 0, `${key} did not return to baseline`);
    assert.equal((app.tasks as any).records.drafts.size, 0);
    const runs = (app.agents as any).runs;
    for (const key of ["live", "pending"]) assert.equal(runs[key].size, 0, `${key} retained deleted ownership`);
    for (const owner of [scope, ...children]) assert.equal(app.agents.pool.hasAffinity(owner.sessionId), false, "pool retained a deleted session writer");
    assert.deepEqual(app.store.db.prepare("SELECT id FROM task_results ORDER BY rowid").all().map(row => row.id), resultIds);
    assert.ok(existsSync(file)); assert.ok(existsSync(join(project, "sentinel.txt")));
    assert.equal((await reconnected.request("subscribe", { scope: collection })).ok, false, "deleted ownership cannot expose cached history");
  } finally {
    sockets.forEach(ws => ws.terminate()); await app?.close();
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
