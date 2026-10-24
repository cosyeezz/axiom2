import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { runRtk, assertToolProcessesStopped } from "../src/server/integrations/rtk-process.js";
import { processOwnerIsLive } from "../src/server/process-owner-record.js";
import { windowsCommandLeaseLive } from "../src/server/pi-package-windows.js";

test("a second real host admits a command without treating the first live tree as cleaned", { timeout: 60000, skip: !["win32", "linux"].includes(process.platform) }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-command-live-"));
  const release = join(root, "release"), ready = join(root, "ready"), proof = join(root, "proof");
  const program = `import { existsSync, writeFileSync } from 'node:fs'; import { setTimeout as delay } from 'node:timers/promises'; writeFileSync(${JSON.stringify(ready)}, 'ready'); while (!existsSync(${JSON.stringify(release)})) await delay(20);`;
  const host = `import { writeFileSync } from 'node:fs'; import { runRtk } from ${JSON.stringify(new URL("../src/server/integrations/rtk-process.ts", import.meta.url).href)}; await runRtk(process.execPath, ['--input-type=module','-e',${JSON.stringify(program)}], { root: ${JSON.stringify(root)}, timeout: 40000, onStopped: value => writeFileSync(${JSON.stringify(proof)}, value) });`;
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", host], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let diagnostics = "";
  child.stderr.on("data", bytes => { diagnostics = (diagnostics + bytes).slice(-8192); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  let finished = false;
  t.after(async () => {
    writeFileSync(release, "release");
    if (!finished) {
      const code = await Promise.race([exited, delay(10000).then(() => "timeout" as const)]);
      if (code === "timeout") { child.kill(); await exited; t.diagnostic(`Uncertain fixture retained: ${root}`); return; }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 30000;
  while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline) await delay(25);
  assert.ok(existsSync(ready), diagnostics);
  const owner = readdirSync(root).find(name => /^\.axiom-command-[a-f0-9-]+\.json$/.test(name));
  assert.ok(owner);
  assert.equal(processOwnerIsLive(join(root, owner), windowsCommandLeaseLive), true);
  assert.throws(() => assertToolProcessesStopped(root), /退出尚未确认/);
  assert.equal(existsSync(proof), false, "admission liveness is not a cleanup proof");
  const proofs: string[] = [];
  const output = await runRtk(process.execPath, ["-e", "process.stdout.write('second-host')"], { root, timeout: 10000, onStopped: value => proofs.push(value) });
  assert.equal(output.toString(), "second-host");
  assert.deepEqual(proofs, ["tree-cleaned"]);
  assert.ok(existsSync(join(root, owner)), "the other host still owns its command journal");
  assert.throws(() => assertToolProcessesStopped(root), /退出尚未确认/);
  writeFileSync(release, "release");
  assert.equal(await exited, 0, diagnostics); finished = true;
  assert.equal(readFileSync(proof, "utf8"), "tree-cleaned");
  assertToolProcessesStopped(root);
});

test("a pre-aborted command reports not-started without launching a worker", async () => {
  const controller = new AbortController(); controller.abort(Error("cancel before fork"));
  const proofs: string[] = [];
  await assert.rejects(runRtk(process.execPath, [], { root: "not-created", signal: controller.signal, onStopped: value => proofs.push(value) }), /cancel before fork/);
  assert.deepEqual(proofs, ["not-started"]);
});
