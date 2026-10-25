// Offline admission/projection regression: real Store/Agents, no worker or model requests.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { Agents } from "../src/server/agents.js";
import { AgentViews } from "../src/server/agents/views.js";
import { ModelService } from "../src/server/model-service.js";
import type { ExecutionLease } from "../src/server/execution-pool.js";
import type { WorkerInput } from "../src/server/agent-worker.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import { toolKey } from "../src/server/transcript.js";
import { readRunOrigin, runOriginLabels, messageScope, type ChatMessage, type Run, type Selection } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import type { ProcessingList } from "../src/shared/processing.js";
import { purposeFixture, navigation, selection as memorySelection } from "./memory-purpose-fixture.js";
import { tmpdir } from "./temporary.js";

const selection: Selection = { provider: "origin-fixture", id: "fixture", thinking: "off" };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-run-origin-")), project = join(root, "project"), pi = join(root, "pi");
  mkdirSync(project); mkdirSync(pi);
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { [selection.provider]: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: selection.id, contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ [selection.provider]: { type: "api_key", key: "fixture-only" } }));
  let store = new Store(root), agents: Agents;
  const launches: { scope: Scope; run: Run; input: WorkerInput }[] = [];
  const startAgents = () => {
    agents = new Agents(store, new ModelService(root), () => {});
    // Acquisition reserves a lease, but only ensureReady starts a process. Neither
    // the launch substitute nor maintenance may start one in these offline tests.
    agents.pool.limits.targetReadyTotal = 0; agents.pool.limits.maxPrewarming = 0;
    (agents as any).runs.launch = async (scope: Scope, run: Run, input: WorkerInput, lease: ExecutionLease, onStart?: (run: Run) => void) => {
      launches.push({ scope, run, input }); onStart?.(run);
      assert.equal(agents.pool.stats().live, 0);
      await agents.pool.retire(lease.ref, "offline_origin_fixture");
    };
  };
  startAgents();
  t.after(async () => {
    try { assert.equal(agents.pool.stats().live, 0); await agents.close(); }
    finally { store.close(); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); }
  });
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = async () => {
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    await agents.command({ requestId: randomUUID(), op: "agent.model", ...scope, params: { selection } }); return scope;
  };
  const finish = (scope: Scope, status: Run["status"] = "completed") => { const run = agents.info(scope).run!; store.finishRun(run.id, status, null); agents.refresh(scope); return run.id; };
  const seed = async (scope: Scope, status: Run["status"] = "completed") => { await agents.command({ requestId: randomUUID(), op: "prompt", ...scope, params: { text: "offline seed" } }); return finish(scope, status); };
  return { root, project, launches, create, finish, seed, get store() { return store; }, get agents() { return agents; }, async restart() { await agents.close(); store.close(); store = new Store(root); startAgents(); } };
}

test("only explicit host admissions write the four origins; replay and stale resume preserve existing boundaries", async t => {
  const f = fixture(t);
  for (const origin of [undefined, ...Object.keys(runOriginLabels)] as (Run["origin"] | undefined)[]) {
    const scope = await f.create();
    const previous = origin === "manual_resume" ? await f.seed(scope, "interrupted") : origin === "memory_continuation" || origin === "compression_preparation" ? await f.seed(scope) : undefined;
    const command = { requestId: randomUUID(), op: origin === "manual_resume" ? "agent.resume" : "prompt", ...scope,
      params: origin === "manual_resume" ? { expectedRunId: previous } : { text: "task_notification memory_continuation compression_preparation manual_resume", origin: "manual_resume" } };
    const internal = origin === "task_notification" ? { notification: { id: "notice", content: "internal result" } }
      : origin === "memory_continuation" ? { prompt: "continue from memory", memoryContinuation: { expectedRunId: previous!, validate() {} } }
      : origin === "compression_preparation" ? { prompt: "maintain before compression", compressionPreparation: { id: "compression-fixture", validate() {}, signal: new AbortController().signal } } : {};
    const receipt = await f.agents.command(command, internal);
    const run = f.agents.info(scope).run!, launch = f.launches.at(-1)!;
    assert.equal(run.origin, origin); assert.equal(launch.run.origin, origin);
    assert.equal(f.store.db.prepare("SELECT origin FROM runs WHERE id=?").get(run.id)!.origin, origin ?? null);
    assert.equal(launch.input.resume, origin === "manual_resume"); assert.equal(launch.input.memoryContinuation, origin === "memory_continuation");
    assert.equal(launch.input.compressionPreparation, origin === "compression_preparation" ? "compression-fixture" : undefined);
    assert.equal(!!launch.input.notification, origin === "task_notification");
    assert.equal(run.resumedFromRunId, origin === "memory_continuation" || origin === "manual_resume" ? previous : null);
    const launched = f.launches.length;
    assert.deepEqual(await f.agents.command(command, internal), receipt); assert.equal(f.launches.length, launched, "receipt replay never launches or reclassifies");
    if (origin === "manual_resume") {
      const count = f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n;
      await assert.rejects(f.agents.command({ ...command, requestId: randomUUID() }), { code: "RUN_MISMATCH" });
      assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, count);
    }
    f.finish(scope);
  }
});

test("child prompt and resume keep task provenance without main-session source labels", async t => {
  const f = fixture(t), parent = await f.create(), records = new TaskRecords(f.store);
  const taskId = records.create(parent, "anchor", "background", [{ task: "offline task" }], selection).taskIds[0]!;
  const row = records.rows("WHERE id=?", taskId)[0]!, scope = target(row);
  assert.ok(row.initialInputId, "created tasks have a durable initial input ID");
  const task = { id: taskId, inputIds: [row.initialInputId] };
  await f.agents.command({ requestId: randomUUID(), op: "prompt", ...scope, params: { text: "child" } }, { task });
  assert.equal(f.agents.info(scope).run!.origin, undefined); const previous = f.finish(scope, "interrupted");
  await f.agents.command({ requestId: randomUUID(), op: "agent.resume", ...scope, params: { expectedRunId: previous } }, { task });
  assert.equal(f.agents.info(scope).run!.origin, undefined); assert.equal(f.launches.at(-1)!.input.task!.id, taskId);
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs WHERE sessionId=? AND origin IS NOT NULL").get(scope.sessionId)!.n, 0);
  f.finish(scope);
});

test("live, cold, original and archived views agree; legacy/unknown/cross-session sources stay unknown after restart", async t => {
  const f = fixture(t), scope = await f.create(), other = await f.create();
  const manager = SessionManager.create(f.project, join(f.root, "native"));
  const published = new Map<string, ChatMessage>(), views = new AgentViews(f.store, (key, value) => published.set(key, value as ChatMessage));
  const origins = [...Object.keys(runOriginLabels), null, "", "future-origin"];
  const expected: { id: string; runId: string; origin: Run["origin"] }[] = [];
  for (const [i, value] of origins.entries()) {
    const runId = i === 4 ? "notify-legacy-memory-resume" : randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,resumedFromRunId,origin) VALUES(?,?,'completed',?,?,?,?)")
      .run(runId, scope.sessionId, JSON.stringify(selection), i + 1, i ? expected[0]!.runId : null, value);
    manager.appendMessage({ role: "user", content: "boundary", timestamp: 1 });
    const id = manager.appendMessage({ role: "assistant", axiomRunId: runId, axiomRunOrigin: "manual_resume", content: [{ type: "toolCall", id: "raw" + i, name: "read", arguments: { path: "fixture" } }], stopReason: "toolUse", timestamp: 1 } as any);
    const origin = readRunOrigin(value); expected.push({ id, runId, origin });
    views.messageChanged(scope, { id, role: "assistant", text: "live", runId, runOrigin: "manual_resume", status: "running" }); views.flush(scope);
    assert.equal(published.get(messageScope(scope, id))!.runOrigin, origin, "DB fact replaces untrusted live source metadata");
    views.messageChanged(other, { id, role: "assistant", text: "wrong owner", runId, runOrigin: "manual_resume" }); views.flush(other);
    assert.equal(published.get(messageScope(other, id))!.runOrigin, undefined);
  }
  const taskRecords = new TaskRecords(f.store);
  const childTaskId = taskRecords.create(scope, "source-child", "offline source fixture", [{ task: "child provenance" }], selection).taskIds[0]!;
  const child = target(taskRecords.rows("WHERE id=?", childTaskId)[0]!);
  const foreignRun = randomUUID(), childRun = randomUUID();
  for (const [runId, owner, origin] of [[foreignRun, other.sessionId, "manual_resume"], [childRun, child.sessionId, null]] as const)
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,origin) VALUES(?,?,'completed',?,?,?)")
      .run(runId, owner, JSON.stringify(selection), Date.now(), origin);
  for (const [i, runId] of ["missing-run", foreignRun, childRun].entries()) {
    manager.appendMessage({ role: "user", content: "unknown source boundary", timestamp: 1 });
    const id = manager.appendMessage({ role: "assistant", axiomRunId: runId, axiomRunOrigin: "manual_resume", content: [{ type: "toolCall", id: "untrusted" + i, name: "read", arguments: {} }], stopReason: "toolUse", timestamp: 1 } as any);
    expected.push({ id, runId, origin: undefined });
  }
  const duplicate = manager.appendMessage({ role: "assistant", axiomRunId: expected[3]!.runId, content: [{ type: "toolCall", id: "duplicate", name: "read", arguments: {} }], stopReason: "toolUse", timestamp: 1 } as any);
  const repeated = manager.appendMessage({ role: "assistant", axiomRunId: expected[3]!.runId, content: [{ type: "toolCall", id: "duplicate-again", name: "read", arguments: {} }], stopReason: "toolUse", timestamp: 1 } as any);
  expected.push({ id: duplicate, runId: expected[3]!.runId, origin: "manual_resume" }, { id: repeated, runId: expected[3]!.runId, origin: "manual_resume" });
  manager.appendCustomMessageEntry("axiom-result", "internal notification", true);
  manager.appendCustomMessageEntry("axiom-memory-continuation", "internal continuation", false);
  const file = manager.getSessionFile()!;
  f.store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(file, scope.sessionId);
  views.refresh(scope); views.forget(other);
  const dbBefore = JSON.stringify(f.store.db.prepare("SELECT * FROM runs ORDER BY rowid").all()), fileBefore = readFileSync(file, "utf8");
  for (const item of expected) {
    assert.equal(views.transcript(scope).get(item.id)!.runOrigin, item.origin);
    assert.equal(views.message(scope, item.id, true)!.runOrigin, item.origin);
    assert.equal(views.message(scope, item.id)!.runOrigin, item.origin);
    assert.equal(views.original(scope).get(item.id)!.runOrigin, item.origin);
  }
  assert.equal(JSON.stringify(f.store.db.prepare("SELECT * FROM runs ORDER BY rowid").all()), dbBefore); assert.equal(readFileSync(file, "utf8"), fileBefore, "view reads do not migrate native files");
  const compaction = manager.appendCompaction("fixture summary", null, 2000); views.refresh(scope);
  const index = views.historyIndex(scope), segment = index.segments.find(s => s.id === compaction)!;
  // Adjacent runs may share one process. Group labels are the exact ordered
  // union of trusted fixture facts, never a source inferred for every message.
  const facts = new Map(expected.map(item => [item.id, item.origin]));
  for (const group of segment.groups) {
    const origins = [...new Set(group.ids.flatMap(id => { const origin = facts.get(id); return origin ? [origin] : []; }))];
    assert.deepEqual(group.process?.origins, origins.length ? origins : undefined);
  }
  for (const item of expected) {
    const group = segment.groups.find(g => g.ids.includes(item.id))!;
    assert.equal(views.historyRead(scope, segment.id, group.id).messages.find(m => m.id === item.id)!.runOrigin, item.origin);
    assert.equal(views.message(scope, item.id, true)!.runOrigin, item.origin);
  }
  const duplicateGroup = segment.groups.find(g => g.ids.includes(duplicate))!;
  assert.ok(duplicateGroup.ids.includes(repeated), "duplicate origins are exercised inside the same process");
  assert.deepEqual(duplicateGroup.process!.origins, ["manual_resume"], "duplicate origins within a folded process are unique");
  assert.equal([...views.original(scope).values()].some(m => /internal notification|internal continuation/.test(m.text)), false);
  const revision = index.revision; manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "current append" }], stopReason: "stop", timestamp: 1 } as any); views.refresh(scope);
  assert.equal(views.historyIndex(scope).revision, revision, "current stream does not invalidate archived source facts");
  views.forget(scope); await f.restart();
  assert.equal(f.agents.info(scope).run!.origin, undefined, "unknown future DB origin does not become resumable provenance on restart");
  const restarted = new AgentViews(f.store, () => {});
  assert.deepEqual(restarted.historyIndex(scope).segments[0]!.groups.map(g => g.process?.origins), segment.groups.map(g => g.process?.origins));
  for (const item of expected) assert.equal(restarted.original(scope).get(item.id)!.runOrigin, item.origin);
  restarted.forget(scope);
});

test("task result delivery steers an active run unchanged and labels only a new idle-parent run", async t => {
  const f = fixture(t), scope = await f.create(); await f.seed(scope);
  const records = new TaskRecords(f.store), delivery = new TaskDelivery(f.agents, records); t.after(() => delivery.close());
  const addResult = () => {
    const id = records.create(scope, randomUUID(), "fixture", [{ task: "result" }], selection).taskIds[0]!;
    const row = records.rows("WHERE id=?", id)[0]!, runId = randomUUID(), resultId = randomUUID();
    f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed',?,?)").run(runId, row.sessionId, JSON.stringify(selection), Date.now());
    f.store.db.prepare("UPDATE tasks SET status='completed',runId=? WHERE id=?").run(runId, id);
    f.store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(resultId, id, runId, JSON.stringify({ id: resultId, taskId: id, runId, status: "completed" }));
  };
  const parentRun = f.agents.info(scope).run!;
  f.store.db.prepare("UPDATE runs SET status='running' WHERE id=?").run(parentRun.id);
  const signals: Record<string, unknown>[] = []; f.agents.signal = (_scope, _id, value) => { signals.push(value); return true; };
  const before = f.launches.length; addResult(); delivery.notify(scope); await tick();
  assert.equal(signals.length, 1); assert.equal(signals[0]!.notification, true); assert.equal(signals[0]!.mode, "steer");
  assert.equal(f.launches.length, before); assert.equal(f.agents.info(scope).run!.id, parentRun.id); assert.equal(f.agents.info(scope).run!.origin, undefined);
  f.finish(scope); addResult(); delivery.notify(scope);
  // close() intentionally invalidates beforeStart; let the accepted notification
  // finish admission before testing shutdown, rather than cancelling our fixture.
  await Promise.all([...(delivery as any).jobs]); await delivery.close();
  assert.equal(f.launches.length, before + 1); assert.equal(f.agents.info(scope).run!.origin, "task_notification"); assert.ok(f.launches.at(-1)!.input.notification?.items?.length);
  f.finish(scope);
});

test("memory-call host context, native tool IDs and actual fake query records share one run-scoped key", async t => {
  const f = fixture(t), scope = await f.create(); await f.seed(scope); const run = f.agents.info(scope).run!;
  const raw = "provider-call-shared", key = toolKey(run.id, raw), ref = { instanceId: "fake-parent", generation: 1, leaseId: "fake-lease" };
  let context: { runId?: string; toolCallId?: string } | undefined, reply: Record<string, unknown> | undefined;
  (f.agents as any).runs.lease = () => ref;
  f.agents.memories.query = async (_scope, question, _signal, parentLease, value) => { assert.equal(question, "fixture question"); assert.equal(parentLease, ref); context = value; return { answer: "fake answer", scope, incomplete: false, sources: [] }; };
  f.agents.signal = (_scope, _id, value) => { reply = value; return true; };
  (f.agents as any).runs.onEvent(scope, run, { type: "memory-call", key: "ipc-fixture", callId: raw, params: { question: "fixture question" } }); await tick();
  assert.deepEqual(context, { runId: run.id, toolCallId: key }); assert.equal(reply?.type, "task-reply"); assert.equal(reply?.ok, true);
  const native = SessionManager.inMemory(f.project);
  const assistant = native.appendMessage({ role: "assistant", axiomRunId: run.id, content: [{ type: "toolCall", id: raw, name: "memory_query", arguments: { question: "fixture question" } }], stopReason: "toolUse", timestamp: 1 } as any);
  native.appendMessage({ role: "toolResult", axiomId: "tool-" + key, axiomRunId: run.id, toolCallId: raw, toolName: "memory_query", content: [{ type: "text", text: "fake answer" }], isError: false, timestamp: 1 } as any);
  const { transcriptMessages } = await import("../src/server/transcript.js"); const messages = transcriptMessages(native);
  assert.equal(messages.find(m => m.id === assistant)!.calls![0]!.id, key); assert.equal(messages.find(m => m.id === "tool-" + key)!.toolCallId, key);
  const p = purposeFixture();
  try {
    await p.configure({ queryModel: memorySelection }); const source = p.create(); p.detail(source, "public fixture evidence"); p.memories.scan(source); p.publish();
    p.memories.runner = { close: async () => {}, execute: async input => navigation(input, "public fixture evidence") };
    const result = await p.memories.query(source, "fixture question", undefined, undefined, context); assert.equal(result.incomplete, false);
    const list = (toolCallId: string) => p.memories.records.command({ requestId: randomUUID(), op: "processing.list", workspaceId: source.workspaceId, params: { kind: "memory.query", sessionId: source.sessionId, toolCallId } }) as ProcessingList;
    assert.equal(list(key).items[0]!.id, result.processingId); assert.equal(list(key).items[0]!.runId, run.id);
    for (const wrong of [raw, "tool-" + key, toolKey("another-run", raw)]) assert.equal(list(wrong).items.length, 0);
  } finally { await p.close(); }
});
