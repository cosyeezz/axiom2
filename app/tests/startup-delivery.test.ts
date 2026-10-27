import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuns } from "../src/server/agents/runs.js";
import type { Run } from "../src/shared/agent.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-start-delivery-"));
  mkdirSync(join(root, "pi")); mkdirSync(join(root, "execution-models"));
  const scope = { workspaceId: "workspace", sessionId: "session" };
  const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
  const cached = { root, cwd: root, file: join(root, "session.jsonl"), modelsFile: join(root, "cached.json"), selection };
  const input = { ...cached, modelsFile: join(root, "new.json"), runId: "new", prompt: "send once" };
  writeFileSync(cached.file, "session");
  writeFileSync(cached.modelsFile, "{}"); writeFileSync(input.modelsFile, "{}");
  const saved: unknown[][] = [], settlements: Run[] = [], sent: string[] = [], receipts: unknown[][] = [];
  let killed = 0;
  const runs = new AgentRuns({ root, session() {}, bindingRejection() { return undefined; }, finishRun: (...args: unknown[]) => saved.push(args), db: { prepare: (sql: string) => ({ run(...args: unknown[]) { if (sql.startsWith("UPDATE external_requests")) receipts.push([sql, ...args]); } }) } } as any,
    { changed() {}, refresh() {}, flush() {}, settled() {}, recoverRequestUsage() {}, thread() { return {}; }, publishMessages() {}, info() { return {}; }, messages: new Map(), queues: new Map() } as any, () => {}) as any;
  const child = Object.assign(new EventEmitter(), {
    connected: true, exitCode: null as number | null, signalCode: null,
    send(value: any, callback: (error?: Error | null) => void): boolean { sent.push(value.type); queueMicrotask(() => callback()); return true; },
  });
  const close = () => { child.exitCode = 1; child.emit("close"); };
  runs.kill = () => { killed++; queueMicrotask(close); };
  runs.onSettled = (_scope: unknown, run: Run) => settlements.push(run);
  const lease = { ref: { instanceId: "fixture", generation: 1, leaseId: "lease" },
    environment: { modelsFile: cached.modelsFile, current: () => true, snapshotValid: () => true },
    ensureReady: async () => child };
  const emit = child.emit.bind(child);
  child.emit = ((name: string, ...args: any[]) => emit(name, ...(name === "message" ? [{ ...args[0], lease: lease.ref }] : args))) as typeof child.emit;
  runs.pool = { limits: { prepareTimeoutMs: 30000 }, isActive: () => child.exitCode === null, hasAffinity: () => false,
    releaseAffinity: async () => {}, trim: async () => {}, invalidate: async () => {},
    retire: async () => { if (child.exitCode === null) { const closed = new Promise<void>(resolve => child.once("close", resolve)); runs.kill(); await closed; } },
    release: async () => {} };
  const launch = runs.launch.bind(runs);
  runs.launch = (scope: any, run: any, input: any) => launch(scope, run, input, lease);
  const run = { id: "new", sessionId: scope.sessionId, status: "starting", selection } as Run;
  t.after(async () => {
    // Never start a real process when cleaning up these simulated owners.
    child.send = (_value, callback) => { queueMicrotask(() => { callback(); close(); }); return true; };
    await runs.close(); rmSync(root, { recursive: true, force: true });
  });
  return { runs, child, scope, run, input, cached, saved, settlements, sent, receipts, close, killed: () => killed };
}

for (const mode of ["sync-throw", "callback-error", "backpressure"] as const) {
  test(`runtime IPC ${mode} preserves uncertainty and reports every notification once`, async (t) => {
    const f = fixture(t);
    await f.runs.launch(f.scope, f.run, f.input);
    f.run.status = "running";
    const events: any[] = [];
    f.runs.onEvent = (_scope: unknown, _run: unknown, event: any) => events.push(event);
    f.child.send = (value, callback) => {
      f.sent.push(value.type);
      if (mode === "sync-throw") throw Error("IPC failed api_key=sk-fixture-secret");
      queueMicrotask(() => callback(mode === "callback-error" ? Error("IPC failed api_key=sk-fixture-secret") : undefined));
      return false;
    };
    assert.equal(f.runs.signal(f.scope, f.run.id, { type: "input", id: "one", notification: true,
      notifications: [{ id: "one", content: "first" }, { id: "two", content: "second" }], mode: "steer" }), true);
    await new Promise(resolve => setImmediate(resolve));
    const failures = events.filter(event => event.type === "input-error");
    assert.equal(failures.length, mode === "backpressure" ? 0 : 2);
    assert.ok(failures.every(event => event.uncertain === true && event.runId === f.run.id));
    assert.doesNotMatch(JSON.stringify(events), /sk-fixture-secret/);
    assert.deepEqual(f.sent, ["start", "input"], "transport failure never replays the input");
    assert.equal(f.runs.active(f.scope), true, "an input transport failure cannot settle its owning run");
  });
}

for (const mode of ["sync-throw", "callback-error"] as const) {
  test(`runtime ${mode} rejects the input receipt as uncertain without waiting for timeout`, async (t) => {
    const f = fixture(t);
    await f.runs.launch(f.scope, f.run, f.input);
    f.run.status = "running";
    f.child.send = (_value, callback) => {
      if (mode === "sync-throw") throw Error("IPC failed");
      queueMicrotask(() => callback(Error("IPC failed")));
      return true;
    };
    await assert.rejects(f.runs.enqueue(f.scope, "request", { text: "original", attachment: null, attachments: [], images: [] }, "original", "steer"), { code: "UNCERTAIN" });
  });
}

for (const outcome of ["input-accepted", "input-error"] as const) {
  test(`late ${outcome} resolves the scoped uncertain input receipt after timeout`, async (t) => {
    const f = fixture(t);
    await f.runs.launch(f.scope, f.run, f.input);
    f.run.status = "running";
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const rejected = assert.rejects(f.runs.enqueue(f.scope, "late", { text: "original", attachment: null }, "original", "steer"), { code: "UNCERTAIN" });
    t.mock.timers.tick(30000);
    await rejected;
    f.child.emit("message", { type: outcome, id: "late", runId: "old", error: "wrong run" });
    assert.equal(f.receipts.length, 0);
    f.child.emit("message", { type: outcome, id: "late", runId: f.run.id, error: "rejected api_key=sk-secret" });
    assert.equal(f.receipts.length, 1);
    const [sql, status, response, id, scope] = f.receipts[0] as string[];
    assert.match(sql, /state='uncertain'/);
    assert.equal(status, outcome === "input-accepted" ? "committed" : "failed");
    assert.equal(id, "late");
    assert.equal(scope, JSON.stringify([f.scope.workspaceId, f.scope.sessionId]));
    assert.doesNotMatch(response, /sk-secret/);
    assert.deepEqual(f.sent, ["start", "input"], "never replay the user input");
    if (outcome === "input-error") assert.equal(f.runs.views.queues.get(f.scope.sessionId).length, 0);
    t.mock.timers.reset();
  });
}

for (const mode of ["sync-throw", "callback-error", "close-before-ack"] as const) {
  test(`startup ${mode} is uncertain, waits for exit, settles once, and never replays`, async (t) => {
    const f = fixture(t);
    f.child.send = (value, callback) => {
      f.sent.push(value.type);
      if (mode === "sync-throw") throw Error("IPC failed api_key=sk-fixture-secret");
      queueMicrotask(() => mode === "callback-error" ? callback(Error("IPC failed api_key=sk-fixture-secret")) : f.close());
      return false;
    };
    await assert.rejects(f.runs.launch(f.scope, f.run, f.input), (error: any) => {
      assert.equal(error.code, "UNCERTAIN");
      assert.doesNotMatch(error.message, /sk-fixture-secret/);
      return true;
    });
    assert.deepEqual(f.sent, ["start"]);
    assert.equal(f.child.exitCode, 1, "launch rejects only after owner exit");
    assert.equal(f.runs.active(f.scope), false);
    assert.equal(f.runs.hasIdle(f.scope), false);
    assert.equal(f.saved.length, 1);
    assert.equal(f.settlements.length, 1);
    assert.equal(f.settlements[0].status, "interrupted");
    assert.equal(f.settlements[0].reasonCode, "UNCERTAIN");
    assert.doesNotMatch(f.settlements[0].error!, /sk-fixture-secret/);
  });
}

test("connection already closed before send is a confirmed rejection", async (t) => {
  const f = fixture(t);
  Object.defineProperty(f.child, "connected", { configurable: true, get: () => false });
  await assert.rejects(f.runs.launch(f.scope, f.run, f.input), { code: "WORKER_START_FAILED" });
  assert.deepEqual(f.sent, []);
  assert.equal(f.child.exitCode, 1);
  assert.equal(f.killed(), 1);
  assert.equal(f.runs.active(f.scope), false);
  assert.equal(f.saved.length, 1);
  assert.equal(f.settlements.length, 1);
});

test("send returning false is backpressure; only its callback completes launch", async (t) => {
  const f = fixture(t);
  let acknowledge!: () => void;
  f.child.send = (value, callback) => { f.sent.push(value.type); acknowledge = () => callback(); return false; };
  let completed = false;
  const launched = f.runs.launch(f.scope, f.run, f.input).then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(f.runs.active(f.scope), true);
  acknowledge(); await launched;
  assert.equal(completed, true);
  assert.deepEqual(f.sent, ["start"]);
  assert.equal(f.killed(), 0);
  assert.equal(f.settlements.length, 0, "transport acknowledgement is not execution completion");
  await f.runs.stop(f.scope);
  assert.equal(f.settlements.length, 1);
});

test("unacknowledged startup has a bounded timeout without replay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.child.send = (value) => { f.sent.push(value.type); return true; };
  const rejected = assert.rejects(f.runs.launch(f.scope, f.run, f.input), { code: "UNCERTAIN" });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(10000);
  await rejected;
  assert.deepEqual(f.sent, ["start"]);
  assert.equal(f.killed(), 1);
  assert.equal(f.runs.active(f.scope), false);
  assert.equal(f.settlements.length, 1);
  assert.match(f.settlements[0].error!, /超时/);
});

test("stop during send acknowledgement kills the owner immediately and preserves cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t);
  f.child.send = (value) => { f.sent.push(value.type); return true; };
  const rejected = assert.rejects(f.runs.launch(f.scope, f.run, f.input), { code: "UNCERTAIN" });
  await new Promise(resolve => setImmediate(resolve));
  const stopped = f.runs.stop(f.scope);
  assert.equal(f.killed(), 1, "stop does not wait for the 10-second acknowledgement timeout");
  await rejected; await stopped;
  assert.equal(f.runs.active(f.scope), false);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].status, "cancelled");
  assert.equal(f.settlements[0].reasonCode, "USER_STOPPED");
});

for (const outcome of ["verified", "expired", "closed"] as const) {
  test(`idle resource validation has its own deadline and ownership: ${outcome}`, async t => {
    const f = fixture(t);
    await f.runs.launch(f.scope, f.run, f.input);
    const live = f.runs.live.get(f.scope.sessionId);
    let resolve!: (valid: boolean) => void, releases = 0, validations = 0;
    const checking = new Promise<boolean>(r => { resolve = r; });
    live.lease.validateEnvironment = () => { validations++; return checking; };
    f.runs.pool.release = async () => { releases++; };
    t.mock.timers.enable({ apis: ["setTimeout"] });
    f.child.emit("message", { type: "done", runId: f.run.id, status: "completed" });
    f.child.emit("message", { type: "idle", runId: f.run.id });
    t.mock.timers.tick(2100);
    assert.equal(f.killed(), 0, "timely idle retires the worker-cleanup deadline");
    f.child.emit("message", { type: "idle", runId: f.run.id });
    assert.equal(validations, 1, "duplicate idle cannot renew the verification deadline");
    if (outcome === "expired") { t.mock.timers.tick(27900); await live.exit; }
    if (outcome === "closed") await f.runs.close();
    resolve(true); await new Promise(r => setImmediate(r));
    await live.exit;
    assert.equal(releases, outcome === "verified" ? 1 : 0);
    assert.equal(f.settlements.length, 1);
    t.mock.timers.reset();
  });
}

test("done timeout revokes reuse before a late idle and waits for physical close", async t => {
  const f = fixture(t);
  await f.runs.launch(f.scope, f.run, f.input);
  const live = f.runs.live.get(f.scope.sessionId);
  delete f.runs.kill; // Exercise AgentRuns' actual pool termination path.
  let retired = 0, released = 0;
  f.runs.pool.retire = (_ref: unknown, reason: string, force: boolean) => {
    assert.equal(reason, "forced_stop"); assert.equal(force, true); retired++;
    return new Promise<void>(resolve => f.child.once("close", resolve));
  };
  f.runs.pool.release = async () => { released++; };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.child.emit("message", { type: "done", runId: f.run.id, status: "completed" });
  t.mock.timers.tick(2000);
  assert.equal(retired, 1);
  f.child.emit("message", { type: "idle", runId: f.run.id });
  assert.equal(released, 0);
  assert.equal(f.runs.active(f.scope), true);
  assert.equal(f.settlements.length, 0);
  f.close(); await live.exit;
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].status, "completed");
  t.mock.timers.reset();
});

test("asynchronous pool release failure preserves the terminal result and closes the owner", async t => {
  const f = fixture(t);
  await f.runs.launch(f.scope, f.run, f.input);
  const live = f.runs.live.get(f.scope.sessionId);
  f.runs.pool.release = async () => { throw Error("fixture release rejection"); };
  f.child.emit("message", { type: "done", runId: f.run.id, status: "completed" });
  f.child.emit("message", { type: "idle", runId: f.run.id });
  await live.exit;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.killed(), 1);
  assert.equal(f.child.exitCode, 1);
  assert.equal(f.saved.length, 1);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].status, "completed");
});

test("a synchronous affinity stat failure still settles once and resolves run exit", async t => {
  const f = fixture(t);
  await f.runs.launch(f.scope, f.run, f.input);
  const live = f.runs.live.get(f.scope.sessionId), stat = fs.statSync;
  const mock = t.mock.method(fs, "statSync", ((path: unknown, ...args: unknown[]) => {
    if (path === f.input.file) throw Object.assign(Error("fixture permission failure"), { code: "EACCES" });
    return (stat as any)(path, ...args);
  }) as typeof fs.statSync);
  syncBuiltinESMExports();
  try {
    f.child.emit("message", { type: "done", runId: f.run.id, status: "completed" });
    f.child.emit("message", { type: "idle", runId: f.run.id });
    await live.exit;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.killed(), 1);
    assert.equal(f.saved.length, 1);
    assert.equal(f.settlements.length, 1);
    assert.equal(f.settlements[0].status, "completed");
    assert.equal(f.runs.active(f.scope), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});