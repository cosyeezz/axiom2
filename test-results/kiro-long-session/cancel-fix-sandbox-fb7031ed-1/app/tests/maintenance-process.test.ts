import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runTool, toolProcessSupported, assertToolProcessesStopped } from "../src/server/integrations/tool-process.js";
import { maintenanceProcessPids, stopMaintenanceProcesses } from "../src/server/maintenance-process.js";
import { canRecoverProcessOwner, createProcessOwner, processOwnerIsLive, recoverProcessOwner } from "../src/server/process-owner-record.js";
import { pidIdentityGone, pidSnapshot } from "../src/server/maintenance-process-pid.js";
import { MaintenanceError } from "../src/shared/maintenance.js";

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), "axiom-maintenance-pid-")));
const supported = toolProcessSupported();
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) { assert.ok(Date.now() < deadline, "temporary process did not become ready"); await delay(25); }
}
const owners = (root: string) => readdirSync(root).filter(name => /^\.axiom-command-.*\.json$/.test(name));

test("maintenance platform support includes macOS without changing other supported platforms", () => {
  for (const platform of ["darwin", "linux", "win32"]) assert.equal(toolProcessSupported(platform), true);
  assert.equal(toolProcessSupported("unknown"), false);
});

test("maintenance output, environment, nonzero exit and owner callback ordering", { skip: !supported }, async () => {
  const root = temporary(), callbacks: string[] = []; let owner = "";
  try {
    const result = await runTool(process.execPath, ["-e", "process.stdin.on('data', x => {process.stdout.write(x);process.stderr.write(process.env.AXIOM_PID_TEST);});process.stdin.on('end',()=>process.exitCode=7)"], {
      root, input: "input", timeout: 10000, env: { ...process.env, AXIOM_PID_TEST: "diagnostic" },
      beforeStart(path) { owner = path; assert.ok(existsSync(owner)); callbacks.push("registered"); },
      onStopped(proof) { assert.ok(existsSync(owner)); callbacks.push(proof); },
    });
    assert.equal(result.code, 7); assert.equal(result.stdout.toString(), "input"); assert.equal(result.stderr.toString(), "diagnostic");
    assert.deepEqual(callbacks, ["registered", "tree-cleaned"]);
    assert.deepEqual(owners(root), []); assert.deepEqual(maintenanceProcessPids(root), []); assertToolProcessesStopped(root);
  } finally { await stopMaintenanceProcesses(root); rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ["cancel", "timeout", "shutdown", "orphan"] as const) test(`maintenance ${mode} cleans a TERM-resistant child group`, { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const root = temporary(), marker = join(root, "ready.json"), controller = new AbortController();
  let identities: ReturnType<typeof pidSnapshot> = [];
  const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');
const leaf=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});leaf.unref();
fs.writeFileSync(${JSON.stringify(marker + ".tmp")},JSON.stringify([process.pid,leaf.pid]));
fs.renameSync(${JSON.stringify(marker + ".tmp")},${JSON.stringify(marker)});
${mode === "orphan" ? "setTimeout(()=>process.exit(0),500);" : "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"}`;
  const pending = runTool(process.execPath, ["-e", script], { root, signal: controller.signal, timeout: mode === "timeout" ? 1500 : 15000 });
  void pending.catch(() => {});
  try {
    await until(() => existsSync(marker));
    const pids: number[] = JSON.parse(readFileSync(marker, "utf8")); identities = pidSnapshot().filter(row => pids.includes(row.pid));
    assert.equal(identities.length, 2); assert.equal(maintenanceProcessPids(root).length, 1);
    if (mode === "cancel") controller.abort(new MaintenanceError("cancelled", "fixture cancelled"));
    if (mode === "shutdown") await stopMaintenanceProcesses(root);
    if (mode === "orphan") assert.equal((await pending).code, 0);
    else if (mode === "timeout") await assert.rejects(pending, { code: "total-timeout" });
    else if (mode === "cancel") await assert.rejects(pending, { code: "cancelled" });
    else await assert.rejects(pending);
    for (const identity of identities) assert.ok(pidIdentityGone(identity), `owned PID ${identity.pid} is still alive`);
    assert.deepEqual(owners(root), []); assert.deepEqual(maintenanceProcessPids(root), []);
  } finally {
    controller.abort(); await pending.catch(() => {}); await stopMaintenanceProcesses(root);
    for (const identity of identities) if (!pidIdentityGone(identity)) { try { process.kill(identity.pid, "SIGKILL"); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test("observed detached descendants are tracked and killed, unrelated maintenance scope survives", { skip: process.platform !== "darwin", timeout: 20000 }, async () => {
  const root = temporary(), other = temporary(), marker = join(root, "leaf.json"), controller = new AbortController(), unrelated = new AbortController();
  const outside = runTool(process.execPath, ["-e", "setInterval(()=>{},1000)"], { root: other, signal: unrelated.signal, timeout: 15000 }); void outside.catch(() => {});
  const pending = runTool(process.execPath, ["-e", `const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});p.unref();require('node:fs').writeFileSync(${JSON.stringify(marker)},String(p.pid));setInterval(()=>{},1000);`], { root, signal: controller.signal, timeout: 15000 }); void pending.catch(() => {});
  let leaf: ReturnType<typeof pidSnapshot>[number] | undefined;
  try {
    await until(() => existsSync(marker)); const pid = Number(readFileSync(marker, "utf8")); leaf = pidSnapshot().find(row => row.pid === pid); assert.ok(leaf);
    await until(() => owners(root).some(name => JSON.parse(readFileSync(join(root, name), "utf8")).identity?.members.some((member: { pid: number }) => member.pid === pid)));
    await stopMaintenanceProcesses(root); await assert.rejects(pending);
    assert.ok(pidIdentityGone(leaf)); assert.equal(maintenanceProcessPids(other).length, 1);
    unrelated.abort(); await assert.rejects(outside); assert.deepEqual(maintenanceProcessPids(other), []);
  } finally {
    controller.abort(); unrelated.abort(); await Promise.allSettled([pending, outside]);
    await Promise.all([stopMaintenanceProcesses(root), stopMaintenanceProcesses(other)]);
    if (leaf && !pidIdentityGone(leaf)) { try { process.kill(leaf.pid, "SIGKILL"); } catch {} }
    rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true });
  }
});

test("pre-cancelled, registration failure and missing executable leave no owner or active process", { skip: !supported }, async () => {
  const root = temporary(), controller = new AbortController(); controller.abort(new MaintenanceError("cancelled", "fixture"));
  try {
    let stopped = 0;
    await assert.rejects(runTool(process.execPath, [], { root, signal: controller.signal, onStopped(proof) { assert.equal(proof, "not-started"); stopped++; } }), { code: "cancelled" });
    await assert.rejects(runTool(process.execPath, [], { root, beforeStart() { throw Error("registration failed"); }, onStopped(proof) { assert.equal(proof, "not-started"); stopped++; } }), /registration failed/);
    assert.equal(stopped, 2);
    await assert.rejects(runTool(join(root, "nonexistent-command"), [], { root, timeout: 10000 }));
    assert.deepEqual(owners(root), []); assert.deepEqual(maintenanceProcessPids(root), []);
  } finally { await stopMaintenanceProcesses(root); rmSync(root, { recursive: true, force: true }); }
});

test("bounded output modes and structured output overflow", { skip: !supported }, async () => {
  const root = temporary();
  try {
    const output = await runTool(process.execPath, ["-e", "process.stdout.write('x'.repeat(2*1024*1024)+'end');process.stderr.write('e'.repeat(10000))"], { root, timeout: 10000, output: "tail", limit: 128, errorLimit: 128 });
    assert.equal(output.stdout.length, 128); assert.ok(output.stdout.toString().endsWith("end")); assert.equal(output.stdoutTruncated, true); assert.equal(output.stderr.length, 128); assert.equal(output.stderrTruncated, true);
    await assert.rejects(runTool(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], { root, timeout: 10000, limit: 128 }), { code: "output-limit" });
    await assert.rejects(runTool(process.execPath, ["-e", "process.stderr.write('x'.repeat(10000))"], { root, timeout: 10000, errorOutput: "structured", errorLimit: 128 }), { code: "output-limit" });
    assert.deepEqual(owners(root), []);
  } finally { await stopMaintenanceProcesses(root); rmSync(root, { recursive: true, force: true }); }
});

test("failed cleanup callback preserves durable owner without a live admission", { skip: !supported }, async () => {
  const root = temporary(); let owner = "";
  try {
    await assert.rejects(runTool(process.execPath, ["-e", "process.exit(0)"], { root, timeout: 10000, beforeStart(path) { owner = path; }, onStopped() { throw Error("persist failed"); } }), { code: "stop-unconfirmed" });
    assert.ok(existsSync(owner)); assert.equal(processOwnerIsLive(owner), false);
    assert.throws(() => assertToolProcessesStopped(root), { code: "stop-unconfirmed" });
  } finally { await stopMaintenanceProcesses(root); rmSync(root, { recursive: true, force: true }); }
});

test("macOS owner recovery checks host identity, group and tracked descendants without signalling PIDs", { skip: process.platform !== "darwin" }, () => {
  const root = temporary(), path = join(root, ".axiom-command-deadbeef.json");
  try {
    const owner = createProcessOwner(path), current = pidSnapshot().find(row => row.pid === process.pid)!;
    owner.arm({ platform: "darwin", workerPid: process.pid, started: current.started, members: [{ pid: process.pid, started: current.started }] });
    assert.equal(processOwnerIsLive(path), true); owner.revoke(); assert.equal(processOwnerIsLive(path), false);
    assert.equal(canRecoverProcessOwner(path), false);
    const record = JSON.parse(readFileSync(path, "utf8"));
    record.hostPid = 2147483647; record.identity.workerPid = 2147483647; record.identity.started = "gone";
    writeFileSync(path, JSON.stringify(record));
    assert.equal(canRecoverProcessOwner(path), false, "live recorded descendant blocks recovery");
    record.identity.members = [{ pid: 2147483647, started: "gone" }]; writeFileSync(path, JSON.stringify(record));
    assert.equal(canRecoverProcessOwner(path), true); assert.equal(recoverProcessOwner(path), true); assert.equal(existsSync(path), false);
    writeFileSync(path, "{}"); assert.equal(recoverProcessOwner(path), false); assert.equal(existsSync(path), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
