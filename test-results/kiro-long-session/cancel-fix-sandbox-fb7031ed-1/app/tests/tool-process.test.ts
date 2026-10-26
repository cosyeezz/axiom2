import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runRtk, assertToolProcessesStopped } from "../src/server/integrations/rtk-process.js";

for (const mode of ["orphan", "cancel", "crash"]) test(`command ${mode} confirms detached descendants stop before releasing files`, { skip: process.platform !== "win32", timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-command-tree-")), script = join(root, "command.cjs"), pids = join(root, "pids.json");
  const controller = new AbortController(); let pending: Promise<Buffer> | undefined;
  writeFileSync(script, `const {spawn}=require('node:child_process');const fs=require('node:fs');
const leaf=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});leaf.unref();
fs.writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,leaf.pid]));
${mode === "orphan" ? "process.stdout.write('done');" : mode === "crash" ? "process.kill(process.ppid,'SIGKILL');setInterval(()=>{},1000);" : "setInterval(()=>{},1000);"}`);
  try {
    pending = runRtk(process.execPath, [script], { root, signal: controller.signal, timeout: 10000 });
    void pending.catch(() => {});
    if (mode === "cancel") {
      const deadline = Date.now() + 8000;
      while (!existsSync(pids) && Date.now() < deadline) await delay(20);
      assert.ok(existsSync(pids)); controller.abort();
    }
    if (mode === "orphan") assert.equal((await pending).toString(), "done");
    else await assert.rejects(pending);
    for (const pid of JSON.parse(readFileSync(pids, "utf8"))) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assertToolProcessesStopped(root);
    assert.ok(!readdirSync(root).some(name => name.startsWith(".axiom-command-")));
  } finally {
    controller.abort(); await pending?.catch(() => {});
    if (existsSync(pids)) for (const pid of JSON.parse(readFileSync(pids, "utf8"))) { try { process.kill(pid, "SIGKILL"); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test("installation log tails remain bounded without terminating a verbose owned command", { skip: !["win32", "linux"].includes(process.platform), timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-command-logs-"));
  try {
    const output = await runRtk(process.execPath, ["-e", "process.stdout.write('o'.repeat(2*1024*1024)); process.stderr.write('e'.repeat(256*1024)); process.stdout.write(process.env.AXIOM_TEST_INSTALL_VALUE);"], {
      root, timeout: 10000, output: "tail", limit: 128, env: { AXIOM_TEST_INSTALL_VALUE: "private-cache-ok" },
    });
    assert.equal(output.length, 128); assert.ok(output.toString().endsWith("private-cache-ok"));
    assertToolProcessesStopped(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unconfirmed command ownership blocks execution and removal after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-command-owner-"));
  try {
    const marker = join(root, ".axiom-command-deadbeef.json"); writeFileSync(marker, "{}");
    await assert.rejects(runRtk(process.execPath, ["-e", "process.exit(0)"], { root }), { code: "stop-unconfirmed" });
    assert.throws(() => assertToolProcessesStopped(root), { code: "stop-unconfirmed" });
    assert.ok(existsSync(marker));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
