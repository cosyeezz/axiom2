import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { target } from "../src/server/tasks/records.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import { until } from "./rewrite-fixture.js";

test("one child retains permissions and bound context across reuse, eviction, hard exit and native resume", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-child-boundaries-")), pi = join(root, "pi"), project = join(root, "project");
  mkdirSync(pi); mkdirSync(project); writeFileSync(join(project, "evidence.txt"), "fixture evidence");
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  const requests: any[] = [], armed = new Set(["model-a", "model-b"]);
  let killing = false, killStep = 0, held: ServerResponse | undefined;
  const provider = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part;
    const body = JSON.parse(raw); requests.push(body);
    response.writeHead(200, { "Content-Type": "text/event-stream" }); response.flushHeaders();
    const chunk = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (killing) {
      if (killStep++ === 0) {
        chunk({ role: "assistant", content: "DURABLE_PARTIAL_EVIDENCE", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "read", arguments: JSON.stringify({ path: join(project, "evidence.txt") }) } }] });
        chunk({}, "tool_calls"); response.end("data: [DONE]\n\n");
      } else {
        held = response; chunk({ role: "assistant", content: "UNPERSISTED_TAIL" });
        for (let i = 0; i < 100; i++) chunk({ content: ` ${i}` });
      }
    } else if (armed.delete(body.model)) {
      chunk({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "write", arguments: JSON.stringify({ path: join(project, "forbidden.txt"), content: "must not write" }) } }] });
      chunk({}, "tool_calls"); response.end("data: [DONE]\n\n");
    } else { chunk({ role: "assistant", content: `ANSWER_${body.model}` }); chunk({}, "stop"); response.end("data: [DONE]\n\n"); }
  });
  await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: ["model-a", "model-b"].map(id => ({ id, contextWindow: 64000, maxTokens: 1000 })) } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
    const parent = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: parent.id }, records = (app.tasks as any).records, scheduler = (app.tasks as any).scheduler;
    const runtime = (app.agents as any).runs, views = (app.agents as any).views;
    const manager = SessionManager.create(project, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "PARENT_PRIVATE_CONTEXT", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "private answer" }], timestamp: 2, stopReason: "stop" } as any);
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(parent.id, manager.getSessionFile()!);
    records.freeze(scope);
    const events: any[] = [], settlements: any[] = [], queues: any[] = [];
    const externalEvent = (app.agents as any).externalEvent, externalSettled = (app.agents as any).externalSettled;
    app.agents.onEvent = (owner, run, event) => { events.push({ owner, runId: run.id, event }); externalEvent?.(owner, run, event); };
    app.agents.onSettled = (owner, run) => { settlements.push({ owner, run }); externalSettled?.(owner, run); };
    const launch = runtime.launchWorker.bind(runtime), watched = new Set<number>();
    runtime.launchWorker = async (...args: any[]) => {
      await launch(...args);
      const child = runtime.live.get(args[0].sessionId)?.child;
      if (child && !watched.has(child.pid)) { watched.add(child.pid); child.on("message", (event: any) => { if (event.type === "queue") queues.push(event); }); }
    };
    const ids = ["a", "b"].map(letter => records.create(scope, randomUUID(), `SHARED_${letter}`, [{ task: `CHILD_${letter}_ONLY` }], { provider: "fixture", id: `model-${letter}`, thinking: "off" }).taskIds[0]);
    const row = (id = ids[0]) => records.rows("WHERE id=?", id)[0], child = target(row());
    const idle = (id = ids[0]) => until(() => ["completed", "interrupted", "failed"].includes(row(id).status) && !app!.agents.active(target(row(id))), "child did not settle", 60000);
    const file = () => String(app!.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(child.sessionId)!.file);
    const check = (runId: string, from: number) => {
      const bodies = requests.slice(from).filter(body => body.model === "model-a"); assert.ok(bodies.length);
      for (const body of bodies) {
        assert.deepEqual(body.tools.map((tool: any) => tool.function.name).sort(), ["find", "grep", "ls", "read", process.platform === "win32" ? "powershell" : "bash"].sort());
        assert.match(JSON.stringify(body.messages), /CHILD_a_ONLY/); assert.doesNotMatch(JSON.stringify(body.messages), /PARENT_PRIVATE_CONTEXT|CHILD_b_ONLY/);
      }
      assert.ok(events.some(e => e.runId === runId && e.event.type === "tool" && e.event.name === "write" && e.event.status === "failed"));
      const systemPrompt = app!.agents.info(child).environment!.systemPrompt;
      assert.ok(typeof systemPrompt === "string");
      assert.match(systemPrompt, /调研与测试子代理/);
      assert.equal(existsSync(join(project, "forbidden.txt")), false);
    };
    scheduler.kick(); await Promise.all(ids.map(id => idle(id)));
    check(row().runId, 0);
    const retainedPid = () => [...(app!.agents.pool as any).instances.values()].find((instance: any) => instance.binding?.sessionId === child.sessionId)?.child?.pid;
    const boundFile = file(), initialPid = retainedPid();
    assert.ok(initialPid);
    const append = async (text: string) => { armed.add("model-a"); const from = requests.length; await app!.tasks.command({ op: "prompt", requestId: randomUUID(), ...child, params: { text } }); await idle(); check(row().runId, from); assert.equal(file(), boundFile); };
    await append("HOT_APPEND"); assert.equal(retainedPid(), initialPid, "same child genuinely reuses its process");
    await app.agents.releaseIdle(child); await append("AFTER_EVICTION");
    assert.notEqual(retainedPid(), initialPid);
    killing = true;
    await app.tasks.command({ op: "prompt", requestId: randomUUID(), ...child, params: { text: "FORCED_EXIT_BOUNDARY" } });
    await until(() => !!held && events.some(e => e.event.type === "message" && e.event.message.text?.includes("UNPERSISTED_TAIL")), "streaming tail did not arrive");
    const runId = row().runId;
    assert.doesNotMatch(readFileSync(boundFile, "utf8"), /UNPERSISTED_TAIL/);
    runtime.live.get(child.sessionId).child.kill("SIGKILL"); await idle();
    assert.equal(row().status, "interrupted"); assert.equal(settlements.filter(e => e.run.id === runId).length, 1);
    const savedRows = app.store.db.prepare("SELECT body FROM task_results WHERE runId=?").all(runId);
    assert.equal(savedRows.length, 1);
    const saved = JSON.parse(String(savedRows[0].body));
    assert.equal(saved.status, "interrupted"); assert.equal(saved.reportKind, "partial"); assert.match(saved.report, /DURABLE_PARTIAL_EVIDENCE/); assert.doesNotMatch(saved.report, /UNPERSISTED_TAIL/);
    assert.notEqual(saved.budgetSummary, true);
    await new Promise(r => setTimeout(r, 65));
    assert.equal(views.changedMessages.has(child.sessionId), false); assert.equal(views.timers.has(child.sessionId), false);
    assert.ok(![...views.transcript(child).values()].some((message: any) => message.text?.includes("UNPERSISTED_TAIL")), "unpersisted old-run tail cannot revive after reset");
    killing = false; armed.add("model-a"); const from = requests.length;
    await app.tasks.command({ op: "agent.resume", requestId: randomUUID(), ...child, params: { expectedRunId: runId } }); await idle();
    assert.notEqual(row().runId, runId); check(row().runId, from); assert.equal(file(), boundFile);
    assert.equal(app.store.db.prepare("SELECT body FROM task_results WHERE runId=?").get(runId)!.body, savedRows[0].body);
    const previousQueue = new Map<string, string>();
    assert.ok(queues.length > 0);
    for (const queue of queues) {
      const identity = JSON.stringify([queue.queue, queue.native]);
      assert.notEqual(identity, previousQueue.get(queue.runId), "real worker suppresses consecutive unchanged projections in each run");
      previousQueue.set(queue.runId, identity);
    }
    assert.equal(readFileSync(join(project, "evidence.txt"), "utf8"), "fixture evidence");
  } finally {
    await app?.close(); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
