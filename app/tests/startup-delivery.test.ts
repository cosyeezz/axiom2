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
  mkdirSync(join(root, "pi"));
  const scope = { workspaceId: "workspace", sessionId: "session" };
  const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
  const cached = { root, cwd: root, file: join(root, "session.jsonl"), modelsFile: join(root, "cached.json"), selection };
  const input = { ...cached, modelsFile: join(root, "new.json"), runId: "new", prompt: "send once" };
  writeFileSync(cached.file, "session");
  writeFileSync(cached.modelsFile, "{}"); writeFileSync(input.modelsFile, "{}");
  const saved: unknown[][] = [], settlements: Run[] = [], sent: string[] = [];
  let killed = 0;
  const runs = new AgentRuns({ session() {}, finishRun: (...args: unknown[]) => saved.push(args), db: { prepare: () => ({ run() {} }) } } as any,
    { changed() {}, flush() {}, settled() {}, thread() { return {}; }, publishMessages() {}, info() { return {}; }, messages: new Map(), queues: new Map() } as any, () => {}) as any;
  const child = Object.assign(new EventEmitter(), {
    connected: true, exitCode: null as number | null, signalCode: null,
    send(value: any, callback: (error?: Error | null) => void): boolean { sent.push(value.type); queueMicrotask(() => callback()); return true; },
  });
  const close = () => { child.exitCode = 1; child.emit("close"); };
  runs.kill = () => { killed++; queueMicrotask(close); };
  runs.onSettled = (_scope: unknown, run: Run) => settlements.push(run);
  runs.keep({ scope, child }, cached);
  const run = { id: "new", sessionId: scope.sessionId, status: "starting", selection } as Run;
  t.after(async () => {
    // Never start a real process when cleaning up these simulated owners.
    child.send = (_value, callback) => { queueMicrotask(() => { callback(); close(); }); return true; };
    await runs.close(); rmSync(root, { recursive: true, force: true });
  });
  return { runs, child, scope, run, input, cached, saved, settlements, sent, close, killed: () => killed };
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
  let reads = 0;
  Object.defineProperty(f.child, "connected", { configurable: true, get: () => ++reads === 1 });
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
  await Promise.resolve();
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
  const stopped = f.runs.stop(f.scope);
  assert.equal(f.killed(), 1, "stop does not wait for the 10-second acknowledgement timeout");
  await rejected; await stopped;
  assert.equal(f.runs.active(f.scope), false);
  assert.equal(f.settlements.length, 1);
  assert.equal(f.settlements[0].status, "cancelled");
  assert.equal(f.settlements[0].reasonCode, "USER_STOPPED");
});

test("reuse cleanup failure leaves cached process owned; a subsequent send can reuse it", async (t) => {
  const f = fixture(t);
  const original = fs.rmSync;
  const mock = t.mock.method(fs, "rmSync", ((path: fs.PathLike, options?: fs.RmOptions) => {
    if (String(path) === f.input.modelsFile) throw Error("EACCES: cannot remove fresh snapshot");
    return original(path, options);
  }) as typeof fs.rmSync);
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.runs.launch(f.scope, f.run, { ...f.input }), /EACCES/);
    assert.equal(f.runs.active(f.scope), false);
    assert.equal(f.runs.hasIdle(f.scope), true);
    assert.equal(f.child.listenerCount("close"), 1, "idle cleanup listener remains owned");
    assert.deepEqual(f.sent, []);
    assert.equal(f.killed(), 0);
    assert.equal(f.settlements.length, 1);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  await f.runs.launch(f.scope, { ...f.run, id: "next", status: "starting" }, { ...f.input, runId: "next" });
  assert.deepEqual(f.sent, ["start"]);
  await f.runs.stop(f.scope);
});

test("unreadable fresh snapshot fails before taking ownership of cached worker", async (t) => {
  const f = fixture(t);
  rmSync(f.input.modelsFile);
  await assert.rejects(f.runs.launch(f.scope, f.run, f.input), /ENOENT/);
  assert.equal(f.runs.active(f.scope), false);
  assert.equal(f.runs.hasIdle(f.scope), true);
  assert.deepEqual(f.sent, []);
  assert.equal(f.killed(), 0);
  assert.equal(f.settlements.length, 1);
});
