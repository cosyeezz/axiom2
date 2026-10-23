// Run in isolation with AXIOM_PERF_SOURCE pointing at app/src (candidate or a
// frozen baseline copy). All models are loopback, all storage is temporary.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
const source = resolve(process.env.AXIOM_PERF_SOURCE || "src");
const smoke = process.env.AXIOM_PERF_SMOKE === "1";
const samplesCount = smoke ? 1 : 20;
const output = resolve(process.env.AXIOM_PERF_OUTPUT || "test-results/subagent-performance.json");
const load = (path: string) => import(pathToFileURL(join(source, path)).href);
const [{ Store }, { Agents }, { ModelService }, { TaskRecords }, { TaskDelivery }, { TaskScheduler }, { Tasks }] = await Promise.all([
  load("server/storage.ts"), load("server/agents.ts"), load("server/model-service.ts"), load("server/tasks/records.ts"),
  load("server/tasks/delivery.ts"), load("server/tasks/scheduler.ts"), load("server/tasks.ts"),
]);
const result: any = { source, node: process.version, platform: process.platform, mode: smoke ? "smoke" : "full", generatedAt: new Date().toISOString(),
  sdk: JSON.parse(readFileSync(resolve("node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version,
  sourceHashes: Object.fromEntries(["server/agents.ts", "server/agent-worker.ts", "server/tasks/scheduler.ts", "server/tasks/records.ts"].map(file => [file, createHash("sha256").update(readFileSync(join(source, file))).digest("hex")])), samples: {} };
const tick = () => new Promise<void>(r => setImmediate(r));
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 90000;
  while (!check()) { assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 5)); }
}
const root = mkdtempSync(join(tmpdir(), "axiom-subagent-perf-")), pi = join(root, "pi"), cwd = join(root, "project");
mkdirSync(pi); mkdirSync(cwd);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
let requests = 0;
const provider = createServer(async (request, response) => {
  for await (const _ of request) { /* Consume request without retaining private context. */ }
  requests++;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const chunk = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: "assistant", content: "Measured loopback evidence." }); chunk({}, "stop"); response.end("data: [DONE]\n\n");
});
await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 64000, maxTokens: 1000 }] } } }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
const store = new Store(root), models = new ModelService(root);
const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } });
const session = () => ({ workspaceId: w.id, sessionId: store.execute({ op: "session.create", workspaceId: w.id, requestId: randomUUID() }).id });
const scope = session(), selection = { provider: "fixture", id: "fixture", thinking: "off" };
let agents: any, tasks: any;
try {
  // B03: deterministic ACK barrier measures admission, not provider latency.
  const a = session(), b = session();
  const isolated = new Agents(store, models, () => {}, undefined, () => false), runtime = isolated.runs;
  isolated.info = () => ({ selection, run: null });
  runtime.active = (scope: any) => scope.sessionId === a.sessionId;
  runtime.launchWorker = async (_scope: unknown, _run: unknown, _input: unknown, lease?: { ref: unknown }) => {
    // This admission-only fixture never starts a Worker. Retire the unstarted
    // reservation before reusing b; a successful no-op does not return a lease.
    if (isolated.pool) {
      assert.ok(lease?.ref, "pooled admission must hand off a lease");
      await isolated.pool.retire(lease.ref, "benchmark_admission_only");
    }
  };
  const ack: any[] = [];
  const serial = models.serial.bind(models); let held: number[] = [];
  models.serial = (work: () => Promise<unknown>) => serial(async () => {
    const start = performance.now(); try { return await work(); } finally { held.push(performance.now() - start); }
  });
  try {
    for (let i = 0; i < samplesCount + 2; i++) {
      held = [];
      let entered = false, released = false;
      let release!: () => void;
      runtime.enqueue = async () => { entered = true; await new Promise<void>(r => { release = r; }); return { status: "queued" }; };
      const slow = isolated.command({ op: "prompt", requestId: randomUUID(), ...a, params: { text: "slow ack" } });
      await until(() => entered, "ack not entered");
      const started = performance.now(); let admittedAt = 0, admittedBeforeRelease = false;
      const timer = setTimeout(() => { released = true; release(); }, 150);
      try {
        await isolated.command({ op: "prompt", requestId: randomUUID(), ...b, params: { text: "independent" } },
          { task: { id: "benchmark", inputIds: [] }, onStart: () => { admittedAt = performance.now(); admittedBeforeRelease = !released; } });
        await slow;
      } finally { release(); clearTimeout(timer); await slow; }
      if (i >= 2) ack.push({ admissionMs: admittedAt - started, admittedBeforeRelease, configLockMs: held });
    }
  } finally { models.serial = serial; await isolated.close(); }
  result.samples.B03 = ack;

  agents = new Agents(store, models, () => {}, undefined, () => false); tasks = new Tasks(agents);
  const records = tasks.records, scheduler = tasks.scheduler; records.freeze(scope);
  const row = (id: string) => records.rows("WHERE id=?", id)[0];
  const create = (count: number) => records.create(scope, randomUUID(), "benchmark", Array.from({ length: count }, () => ({ task: "fixed loopback work" })), selection).taskIds as string[];
  const times = new Map<string, any>();
  const originalEvent = agents.externalEvent;
  agents.onEvent = (scope: any, run: any, event: any) => {
    originalEvent?.(scope, run, event);
    const sample = times.get(scope.sessionId);
    if (sample && ["ready", "running"].includes(event.type)) sample[event.type] ??= performance.now();
  };
  const resultRun = (id: string) => agents.info({ workspaceId: w.id, sessionId: row(id).sessionId }).run;
  const execute = async (id: string, append = false) => {
    const sample: any = { start: performance.now() }; times.set(row(id).sessionId, sample);
    if (append) await scheduler.append(row(id), { text: "next fixed requirement" }); else scheduler.kick();
    await until(() => row(id).status === "completed" && !agents.active({ workspaceId: w.id, sessionId: row(id).sessionId }), "task did not finish");
    sample.end = performance.now(); times.delete(row(id).sessionId);
    assert.ok(sample.ready && sample.running);
    const admissionMs = Math.max(0, resultRun(id).startedAt - performance.timeOrigin - sample.start);
    return { totalMs: sample.end - sample.start, admissionMs, readyMs: sample.ready - sample.start, runningMs: sample.running - sample.start,
      admissionToReadyMs: sample.ready - sample.start - admissionMs, readyToRunningMs: sample.running - sample.ready };
  };
  const cold: any[] = [];
  for (let i = 0; i < (smoke ? 1 : 10); i++) {
    const id = create(1)[0]; cold.push(await execute(id));
    await agents.releaseIdle({ workspaceId: w.id, sessionId: row(id).sessionId });
  }
  const hotId = create(1)[0]; await execute(hotId);
  const hot: any[] = []; for (let i = 0; i < samplesCount; i++) hot.push(await execute(hotId, true));
  result.samples.B01 = { cold, hot };

  const parallel: any = {};
  for (const concurrency of (smoke ? [1] : [1, 4, 8, 16])) {
    store.db.prepare("INSERT OR REPLACE INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency, workMs: 600000 }));
    scheduler.preferencesChanged();
    const ids = [...create(Math.min(8, concurrency)), ...(concurrency > 8 ? create(concurrency - 8) : [])];
    const samples: any[] = [];
    for (let i = 0; i < samplesCount + 1; i++) {
      const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
      const started = performance.now();
      for (const id of ids) times.set(row(id).sessionId, { start: started });
      if (i) for (const id of ids) await scheduler.append(row(id), { text: `fixed batch ${i}` });
      else scheduler.kick();
      await until(() => ids.every(id => row(id).status === "completed" && !agents.active({ workspaceId: w.id, sessionId: row(id).sessionId })), "parallel batch incomplete");
      delay.disable();
      const admission = ids.map(id => {
        const run = resultRun(id), events = times.get(row(id).sessionId);
        times.delete(row(id).sessionId);
        assert.ok(events.ready && events.running);
        return { admissionMs: Math.max(0, run.startedAt - performance.timeOrigin - started), readyMs: events.ready - started, runningMs: events.running - started };
      });
      if (i) samples.push({ totalMs: performance.now() - started, eventLoopP95Ms: delay.percentile(95) / 1e6, tasks: admission });
    }
    parallel[concurrency] = samples;
    for (const id of ids) await agents.releaseIdle({ workspaceId: w.id, sessionId: row(id).sessionId });
  }
  result.samples.B02 = parallel;

  // B04/B06: deterministic scheduler event load. Count work before transport;
  // UI/network claims are intentionally left to the production subscription test.
  const structural: any[] = [];
  for (const size of [6, 16]) {
    const eventScope = session(); records.freeze(eventScope);
    const createEvents = (count: number) => records.create(eventScope, randomUUID(), "queue benchmark", Array.from({ length: count }, () => ({ task: "fixed queue events" })), selection).taskIds as string[];
    const ids = [...createEvents(Math.min(8, size)), ...(size > 8 ? createEvents(size - 8) : [])];
    const parentTasks = records.rows("WHERE parentSessionId=?", eventScope.sessionId).length;
    assert.equal(parentTasks, size, "queue fixture must not inherit startup history");
    scheduler.closing = true;
    let lists = 0, threads = 0, publications = 0;
    const fake = { store, info: () => ({ run: null, selection }), thread: () => { threads++; return { ids: [] }; }, publish: () => { publications++; }, setQueue: () => {}, active: () => false };
    const delivery = new TaskDelivery(fake, records); delivery.pause();
    const measured = new TaskScheduler(fake, records, delivery);
    const list = records.list.bind(records); records.list = (...args: any[]) => { lists++; return list(...args); };
    const originalRows = ids.map(id => row(id));
    const runs = originalRows.map((r: any) => ({ id: randomUUID(), sessionId: r.sessionId, status: "running", selection, startedAt: Date.now() }));
    originalRows.forEach((r: any, i: number) => {
      store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running',?,?)").run(runs[i].id, r.sessionId, JSON.stringify(selection), runs[i].startedAt);
      store.db.prepare("UPDATE tasks SET status='running',runId=? WHERE id=?").run(runs[i].id, r.id);
    });
    for (let sample = 0; sample < samplesCount + 2; sample++) {
      lists = threads = publications = 0; const started = performance.now();
      for (let i = 0; i < 100; i++) for (const [index, r] of originalRows.entries())
        measured.event(r, runs[index], { type: "queue", queue: [{ id: `input-${sample}`, mode: "steer" }], native: [] });
      await tick();
      assert.ok(publications > 0, "event fixture must reach the publishing path");
      if (sample >= 2) structural.push({ size, parentTasks, totalMs: performance.now() - started, lists, threads, publications });
    }
    records.list = list;
    for (const id of ids) store.db.prepare("UPDATE tasks SET status='completed',runId=NULL WHERE id=?").run(id);
    for (const run of runs) store.db.prepare("UPDATE runs SET status='completed',endedAt=? WHERE id=?").run(Date.now(), run.id);
    await delivery.close(); scheduler.closing = false;
  }
  result.samples.B04_B06 = structural;

  // B05: the existing batched query is preserved. Keep raw samples and count
  // statement execution (including cached statements), not just preparation.
  const history = session(); records.freeze(history); const historyIds: string[] = [];
  let executions = 0;
  const wrap = (statement: any) => new Proxy(statement, { get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === "function" ? (...args: any[]) => { if (["all", "get", "run"].includes(String(key))) executions++; return value.apply(target, args); } : value;
  } });
  const prepare = store.db.prepare.bind(store.db), cached = store.prepare.bind(store);
  store.db.prepare = (sql: string) => wrap(prepare(sql));
  // Clear the read-statement cache so every retained statement gets instrumented.
  store.statements?.clear();
  const lists: any = {};
  for (const count of (smoke ? [0, 32] : [0, 32, 500, 2000])) {
    while (historyIds.length < count) {
      const ids = records.create(history, "history", "fixed", Array.from({ length: Math.min(8, count - historyIds.length) }, () => ({ task: "history" })), selection).taskIds;
      store.db.exec("BEGIN IMMEDIATE");
      try {
        for (const id of ids) {
          const task = row(id);
          store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(id);
          for (let index = 0; index < 2; index++) {
            const runId = randomUUID();
            store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed','{}',10,?)").run(runId, task.sessionId, index ? null : 30);
            store.db.prepare("INSERT INTO task_results(id,taskId,runId,body) VALUES(?,?,?,?)").run(`${id}-${index}`, id, runId, JSON.stringify({ status: "completed", report: "fixed report ".repeat(100) }));
            store.db.prepare("INSERT INTO task_input_receipts VALUES(?,?,?,?,NULL,?)").run(`${id}-receipt-${index}`, id, runId, index ? "unknown" : "delivered", index);
          }
        }
        store.db.exec("COMMIT");
      } catch (error) { store.db.exec("ROLLBACK"); throw error; }
      historyIds.push(...ids);
    }
    const samples: any[] = [];
    for (let i = 0; i < samplesCount + 2; i++) {
      executions = 0; const started = performance.now(), data = records.list(history);
      assert.deepEqual(data.tasks.map((task: any) => task.id), historyIds);
      const queryMs = performance.now() - started, bytes = Buffer.byteLength(JSON.stringify(data));
      for (const task of data.tasks) { assert.equal(task.results.length, 2); assert.equal(task.elapsedMs, 20); }
      assert.ok(executions <= 10, "list query count must remain bounded");
      if (i >= 2) samples.push({ queryMs, executions, bytes });
    }
    lists[count] = samples;
  }
  result.samples.B05 = lists; store.db.prepare = prepare; store.prepare = cached;
  const resources = () => process.getActiveResourcesInfo().reduce((counts: Record<string, number>, key) => { counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
  result.samples.B07 = { resourcesBefore: resources(), beforeClose: { heapUsed: process.memoryUsage().heapUsed, pending: agents.runs.pending.size, launching: scheduler.launching.size,
    jobs: scheduler.jobs.size, drafts: records.drafts.size, handed: scheduler.handed.size, failedInputs: scheduler.failedInputs.size,
    nativePending: scheduler.nativePending.size, pendingViews: scheduler.pendingViews?.size ?? null, live: agents.runs.live.size, idle: agents.pool?.stats().idle ?? agents.runs.idle?.size ?? null } };
  await tasks.close(); tasks = undefined;
  result.samples.B07.afterClose = { heapUsed: process.memoryUsage().heapUsed, pending: agents.runs.pending.size, live: agents.runs.live.size,
    idle: agents.pool?.stats().idle ?? agents.runs.idle?.size ?? null,
    retiring: agents.pool?.stats().retiring ?? agents.runs.retiring?.size ?? null, total: agents.pool?.stats().total ?? null };
  result.samples.B07.resourcesAfter = resources();
  result.samples.B07.auxiliaryAfter = { timers: scheduler.timers.size, jobs: scheduler.jobs.size, drafts: records.drafts.size, handed: scheduler.handed.size,
    failedInputs: scheduler.failedInputs.size, nativePending: scheduler.nativePending.size, nativeQueues: scheduler.nativeQueues?.size ?? null, pendingViews: scheduler.pendingViews?.size ?? null };
  for (const [key, value] of Object.entries(result.samples.B07.afterClose)) if (key !== "heapUsed" && value !== null) assert.equal(value, 0, `${key} not drained`);
  result.requests = requests;
  result.status = "completed";
} catch (error) {
  result.status = "failed"; result.error = String(error); throw error;
} finally {
  mkdirSync(resolve(output, ".."), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2));
  await tasks?.close(); await agents?.close(); store.close();
  provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, source, requests }));
