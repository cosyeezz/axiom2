import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { waitForUpdateExit } from "./desktop-update-cleanup.js";
const { instrumentInstaller, installerRecordName } = await import(new URL("../../scripts/desktop-test-bridge.mjs", import.meta.url).href);
const terminal = { token: "b".repeat(64), pid: 12345, phase: "complete", running: false };
const previousToken = "a".repeat(64);

test("desktop cleanup retries unreadable status and waits for a terminal worker to exit", async () => {
  let reads = 0, clock = 0;
  const job = await waitForUpdateExit({ previousToken, timeoutMs: 10, pollMs: 1,
    now: () => clock, sleep: async (ms) => { clock += ms; },
    readJob: async () => {
      reads++;
      if (reads === 1) throw Error("temporary read failure");
      if (reads === 2) return { state: "error" };
      return terminal;
    }, isAlive: () => reads === 3 });
  assert.deepEqual(job, terminal);
  assert.equal(reads, 4);
});

test("desktop cleanup rejects missing, invalid, interrupted, running and stale job records", async () => {
  for (const job of [null, { state: "error" }, { ...terminal, pid: 0 }, { ...terminal, running: true },
    { ...terminal, phase: "interrupted" }, { ...terminal, phase: "installing" }, { ...terminal, token: previousToken }]) {
    await assert.rejects(waitForUpdateExit({ previousToken, timeoutMs: 0, readJob: async () => job, isAlive: () => false }), /retain the fixture/);
  }
});

test("desktop cleanup retains a terminal job while its owning process is still alive", async () => {
  await assert.rejects(waitForUpdateExit({ previousToken: null, timeoutMs: 0, readJob: async () => terminal, isAlive: () => true }), /retain the fixture/);
  for (const phase of ["complete", "error", "ready"]) {
    assert.equal((await waitForUpdateExit({ previousToken: null, timeoutMs: 0, readJob: async () => ({ ...terminal, phase }), isAlive: () => false })).phase, phase);
  }
});

const bridge = await readFile(new URL("../desktop/axiom_service.rs", import.meta.url), "utf8");
test("desktop test bridge records the production installer command without spawning it", () => {
  const result = instrumentInstaller(bridge);
  assert.match(result, /axiom_test_installer\(Command::new\(system\.join\("System32\/msiexec\.exe"\)\)\.arg\("\/i"\)\.arg\(installer\)\)\?;/);
  assert.ok(result.includes(installerRecordName));
  assert.ok(result.includes("command.get_program()"));
  assert.ok(result.includes("command.get_args()"));
  assert.equal(result.includes('format!("无法打开安装向导：{e}")'), false);
  assert.equal(bridge.includes(installerRecordName), false);
});

test("installer instrumentation preserves added production arguments so native assertions can catch them", () => {
  const changed = bridge.replace('.arg("/i").arg(installer)', '.arg("/i").arg("/quiet").arg(installer)');
  assert.ok(instrumentInstaller(changed).includes('.arg("/i").arg("/quiet").arg(installer)'));
});

test("installer instrumentation refuses missing or ambiguous launch sites", () => {
  assert.throws(() => instrumentInstaller(""), /exactly one/);
  assert.throws(() => instrumentInstaller(bridge + bridge), /exactly one/);
});
