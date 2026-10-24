import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProxyGuardian } from "../src/server/integrations/model-proxy-guardian.js";
import { linuxProcessStart } from "../src/server/process-owner-linux-identity.js";
const supported = ["win32", "linux"].includes(process.platform);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(predicate: () => boolean) { const end = Date.now() + 8000; while (!predicate()) { assert.ok(Date.now() < end, "fixture did not settle"); await delay(10); } }
function descendants(pid: number, output: { pid: number; start?: string }[] = []) {
  if (process.platform !== "linux") return output;
  const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
  for (const child of children) {
    try { output.push({ pid: child, start: linuxProcessStart(child) }); descendants(child, output); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return output;
}
function gone(item: { pid: number; start?: string }) {
  if (process.platform === "win32") return !alive(item.pid);
  try { return linuxProcessStart(item.pid) !== item.start; } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-guardian-")), owner = join(root, "owner.json"), pidFile = join(root, "kernel.json");
  writeFileSync(owner, "{}");
  let deadline = Date.now() + 15000;
  const controller = new AbortController();
  const guardian = new ProxyGuardian(owner, () => ({ remainingMs: deadline - Date.now(), code: "total-timeout" }), controller.signal);
  const request = { executable: process.execPath, args: ["-e", `const fs=require('fs'),{spawn}=require('child_process');
const leaf=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); leaf.unref();
fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,leaf.pid])); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`, pidFile], cwd: root, env: process.env };
  const start = () => guardian.start(request);
  const owned = () => process.platform === "linux" ? descendants(guardian.child.pid!) : (JSON.parse(readFileSync(pidFile, "utf8")) as number[]).map(pid => ({ pid }));
  const cleanup = async () => {
    if (process.platform === "linux" && alive(guardian.child.pid!)) guardian.child.kill("SIGCONT");
    await guardian.stop().catch(() => {});
    if (alive(guardian.child.pid!)) guardian.child.kill("SIGKILL");
    await guardian.closed;
    rmSync(root, { recursive: true, force: true });
  };
  return { root, owner, pidFile, guardian, controller, request, start, owned, cleanup, deadline: (value: number) => { deadline = value; } };
}

test("guardian confirms detached descendants stopped before releasing either owner", { skip: !supported, timeout: 15000 }, async () => {
  const f = fixture();
  try {
    await f.start(); await until(() => existsSync(f.pidFile));
    const owned = f.owned(); assert.ok(owned.length >= 2);
    assert.equal(JSON.parse(readFileSync(join(f.root, "process-owner.json"), "utf8")).state, "armed");
    await f.guardian.stop(); await until(() => owned.every(gone));
    assert.equal(existsSync(f.owner), false); assert.equal(existsSync(join(f.root, "process-owner.json")), false);
  } finally { await f.cleanup(); }
});

test("guardian abrupt exit uses real Job proof on Windows and retains unknown without Linux receipt", { skip: !supported, timeout: 15000 }, async () => {
  const f = fixture();
  try {
    await f.start(); await until(() => existsSync(f.pidFile)); const owned = f.owned();
    f.guardian.child.kill("SIGKILL"); await f.guardian.closed;
    if (process.platform === "win32") { await f.guardian.stop(); assert.ok(!existsSync(f.owner)); }
    else { await assert.rejects(f.guardian.stop(), { code: "stop-unconfirmed" }); assert.ok(existsSync(f.owner)); }
    await until(() => owned.every(gone));
  } finally { await f.cleanup(); }
});

test("guardian spawn failure still confirms the empty tree", { skip: !supported, timeout: 15000 }, async () => {
  const f = fixture();
  try {
    await f.guardian.start({ ...f.request, executable: join(f.root, "missing-program") });
    await f.guardian.closed; await f.guardian.stop(); assert.ok(!existsSync(f.owner));
  } finally { await f.cleanup(); }
});

test("a frozen Linux supervisor retains ownership until native cleanup is acknowledged", { skip: process.platform !== "linux", timeout: 15000 }, async () => {
  const f = fixture();
  try {
    await f.start(); await until(() => existsSync(f.pidFile));
    f.guardian.child.kill("SIGSTOP");
    await assert.rejects(f.guardian.stop(80), { code: "stop-unconfirmed" }); assert.ok(existsSync(f.owner));
    f.guardian.child.kill("SIGCONT"); await f.guardian.stop(); assert.ok(!existsSync(f.owner));
  } finally { await f.cleanup(); }
});

test("cancellation before readiness never executes the kernel", { skip: !supported, timeout: 15000 }, async () => {
  const f = fixture();
  try {
    f.controller.abort(Error("cancel startup"));
    await assert.rejects(f.start()); await f.guardian.stop(); assert.ok(!existsSync(f.pidFile));
  } finally { await f.cleanup(); }
});

test("service promotion survives the finished startup budget and its cancellation", { skip: !supported, timeout: 15000 }, async () => {
  const f = fixture();
  try {
    await f.start(); await until(() => existsSync(f.pidFile)); const owned = f.owned();
    f.guardian.promoteToService(); f.deadline(Date.now() - 1); f.controller.abort();
    await delay(600); assert.ok(owned.every(item => !gone(item))); assert.ok(existsSync(f.owner));
    await f.guardian.stop(); await until(() => owned.every(gone));
  } finally { await f.cleanup(); }
});

test("short operation budget expiry confirms the whole kernel tree stopped", { skip: !supported, timeout: 15000 }, async () => {
  const f = fixture();
  try {
    await f.start(); await until(() => existsSync(f.pidFile)); const owned = f.owned(); f.deadline(Date.now() - 1);
    await f.guardian.closed; await f.guardian.stop(); await until(() => owned.every(gone)); assert.ok(!existsSync(f.owner));
  } finally { await f.cleanup(); }
});
