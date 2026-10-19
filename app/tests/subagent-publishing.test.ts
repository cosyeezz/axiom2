import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import WebSocket from "ws";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { startServer } from "../src/server/index.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const tick = () => new Promise<void>(r => setImmediate(r));

test("0/32/500/2000 task lists use fixed SQL executions with ordered independent results and receipts", { timeout: 30000 }, t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-task-list-count-")), store = new Store(root);
  try {
    const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
    const s = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id }, records = new TaskRecords(store);
    let executions = 0;
    const prepare = store.db.prepare.bind(store.db);
    t.mock.method(store.db, "prepare", (sql: string) => {
      const statement = prepare(sql);
      return new Proxy(statement, { get(target, key) {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? (...args: unknown[]) => {
          if (["all", "get", "run"].includes(String(key))) executions++;
          return value.apply(target, args);
        } : value;
      } });
    });
    const ids: string[] = [], counts: number[] = [];
    for (const count of [0, 32, 500, 2000]) {
      while (ids.length < count) {
        const batch = records.create(scope, "anchor", "context", Array.from({ length: Math.min(8, count - ids.length) }, () => ({ task: "historical", role: "" })), { provider: "fixture", id: "fixture", thinking: "off" }).taskIds;
        for (const id of batch) {
          const row = records.rows("WHERE id=?", id)[0];
          store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(id);
          const runs = [randomUUID(), randomUUID()];
          for (const [index, run] of runs.entries()) {
            store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed','{}',?,?)").run(run, row.sessionId, 10, index ? null : 30);
            store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(`${id}-${index}`, id, run, JSON.stringify({ status: "completed" }));
            store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,?, ?,NULL,?)").run(`${id}-receipt-${index}`, id, run, index ? "unknown" : "delivered", index);
          }
        }
        ids.push(...batch);
      }
      executions = 0;
      const list = records.list(scope); counts.push(executions);
      assert.deepEqual(list.tasks.map(task => task.id), ids);
      for (const task of list.tasks) {
        assert.deepEqual(task.results.map(r => r.id), [`${task.id}-0`, `${task.id}-1`]);
        assert.deepEqual(task.inputs!.slice(0, 2).map(r => r.state), ["delivered", "unknown"]);
        assert.equal(task.elapsedMs, 20, "multiple receipts cannot multiply elapsed time; unfinished run adds no invented duration");
      }
      assert.ok(executions <= 10, `${count} tasks used ${executions} statements`);
    }
    assert.equal(new Set(counts).size, 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("production subscriptions keep sixteen background streams lazy while pins/costs and reconnect remain current", { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-publish-production-")), cwd = join(root, "project");
  mkdirSync(cwd); mkdirSync(join(root, "pi"));
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
  const app = await startServer({ root, port: 0 });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  const events: any[] = [], pending = new Map<string, (value: any) => void>();
  ws.on("message", raw => {
    const event = JSON.parse(raw.toString()); events.push(event);
    if (event.type === "receipt") { pending.get(event.requestId)?.(event); pending.delete(event.requestId); }
  });
  try {
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const sessions = Array.from({ length: 17 }, () => {
      const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
      const manager = SessionManager.create(cwd, join(root, "sessions"));
      manager.appendMessage({ role: "user", content: "saved", timestamp: 1 });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "saved answer" }], stopReason: "stop", timestamp: 2 } as any);
      app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(s.id, manager.getSessionFile()!);
      return { workspaceId: w.id, sessionId: s.id };
    });
    const request = (op: string, params: object = {}) => new Promise<any>(resolve => {
      const requestId = randomUUID(); pending.set(requestId, resolve); ws.send(JSON.stringify({ op, requestId, params, ...sessions[0] }));
    });
    for (const scope of [`thread:${w.id}:${sessions[0].sessionId}`, `messages:${w.id}:${sessions[0].sessionId}`, "pinned-sessions", `costs:${w.id}:${sessions[0].sessionId}`])
      assert.equal((await request("subscribe", { scope })).ok, true);
    // Establish the accounting source baseline before counting history reads.
    assert.equal((await request("costs.get")).ok, true);
    const costScope = `costs:${w.id}:${sessions[0].sessionId}`;
    const open = t.mock.method(SessionManager, "open");
    const views = (app.agents as any).views;
    for (let round = 0; round < 6; round++) for (const scope of sessions.slice(1)) {
      views.messageChanged(scope, { id: "pending", role: "assistant", text: `background ${round}`, streaming: true }); views.flush(scope);
      app.agents.publish(`agent:${w.id}:${scope.sessionId}`);
      app.agents.publish(`sessions:${w.id}`);
    }
    await request("ping");
    assert.equal(open.mock.callCount(), 0, "production observed wiring must suppress background history reads");
    assert.ok(events.some(e => e.scope === "pinned-sessions"));
    assert.equal(events.filter(e => e.scope === costScope).length, 1, "unrelated background streams do not invalidate current costs");
    // A title is part of the authoritative cost report. Wait for its actual
    // invalidation event; a ping receipt does not drain the 100ms batch timer.
    const costChanged = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { ws.off("message", received); reject(Error("cost invalidation did not arrive")); }, 5000);
      const received = (raw: WebSocket.RawData) => {
        const event = JSON.parse(raw.toString());
        if (event.scope !== costScope || !(event.data?.revision > 0)) return;
        clearTimeout(timer); ws.off("message", received); resolve();
      };
      ws.on("message", received);
    });
    app.store.db.prepare("UPDATE sessions SET title=? WHERE id=?").run("Renamed accounting source", sessions[0].sessionId);
    app.agents.publish(`sessions:${w.id}`);
    await costChanged;
    assert.equal(open.mock.callCount(), 0, "cost invalidation checks source identity without parsing history");
    assert.ok(views.messages.has(sessions[0].sessionId), "background output must not evict front history");
    const scope = sessions[1], collection = `messages:${w.id}:${scope.sessionId}`;
    assert.equal((await request("subscribe", { scope: collection })).ok, true);
    assert.ok(events.filter(e => e.scope === collection).at(-1).data.some((m: any) => m.id === "pending" && m.text === "background 5"));
    views.messageChanged(scope, { id: "pending", role: "assistant", text: "terminal before disk", streaming: false }); views.flush(scope);
    await request("ping");
    assert.ok(events.some(e => e.scope === `message:${w.id}:${scope.sessionId}:pending` && e.data.text === "terminal before disk"));
    await request("unsubscribe", { scope: collection });
    await request("subscribe", { scope: collection });
    assert.ok(events.filter(e => e.scope === collection).at(-1).data.some((m: any) => m.text === "terminal before disk"));
    await request("unsubscribe", { scope: collection });
    for (const item of sessions.slice(1)) { views.settled(item); views.forget(item); }
    await tick();
    assert.equal(views.messages.size, 1);
  } finally {
    ws.terminate(); await app.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
