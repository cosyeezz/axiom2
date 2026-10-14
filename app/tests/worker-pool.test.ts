import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuns } from "../src/server/agents/runs.js";

test("worker idle LRU retains at most ten; eviction and 15-minute expiry close only idle owners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const root = mkdtempSync(join(tmpdir(), "axiom-pool-"));
  mkdirSync(join(root, "pi"));
  const runs = new AgentRuns({} as any, {} as any, () => {}) as any;
  const killed: string[] = [];
  runs.kill = (live: any) => { killed.push(live.scope.sessionId); live.child.emit("close"); };
  try {
    for (let i = 0; i < 11; i++) {
      const id = String(i), modelsFile = join(root, `${id}.json`), file = join(root, `${id}.jsonl`);
      writeFileSync(modelsFile, "{}"); writeFileSync(file, "session");
      const child = Object.assign(new EventEmitter(), { connected: false, exitCode: null, signalCode: null });
      const live = { scope: { workspaceId: "workspace", sessionId: id }, child };
      runs.keep(live, { root, cwd: root, modelsFile, file, selection: { provider: "fixture", id: "fixture", thinking: "off" } });
    }
    assert.equal(runs.idle.size, 10);
    assert.deepEqual(killed, ["0"]);
    assert.deepEqual([...runs.idle.keys()], ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    t.mock.timers.tick(15 * 60 * 1000 - 1);
    assert.equal(runs.idle.size, 10);
    t.mock.timers.tick(1);
    assert.equal(runs.idle.size, 0);
    assert.equal(killed.length, 11);
    await Promise.all(runs.retiring);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("idle retirement requests graceful shutdown, then forces a stalled owner after two seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const runs = new AgentRuns({} as any, {} as any, () => {}) as any;
  const signals: string[] = [];
  let killed = 0;
  runs.kill = (live: any) => { killed++; live.child.emit("close"); };
  const entry = (graceful: boolean) => {
    const child = Object.assign(new EventEmitter(), {
      connected: true, exitCode: null, signalCode: null,
      send(value: any) { signals.push(value.type); if (graceful) queueMicrotask(() => child.emit("close")); },
    });
    return { live: { scope: { sessionId: String(graceful) }, child }, timer: undefined };
  };
  await runs.retire(entry(true));
  assert.equal(killed, 0);
  const closing = runs.retire(entry(false));
  t.mock.timers.tick(1999); assert.equal(killed, 0);
  t.mock.timers.tick(1); await closing;
  assert.equal(killed, 1);
  assert.deepEqual(signals, ["shutdown", "shutdown"]);
});
