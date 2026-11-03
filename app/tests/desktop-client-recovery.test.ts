// Isolated Darwin crash recovery: local fixture process only, never a live backend.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
const moduleUrl = new URL("../desktop/updater.mjs", import.meta.url).href;
const { createUpdater } = await import(moduleUrl);
const { createUpdaterReconciler } = await import(new URL("../desktop/updater-reconciliation.mjs", import.meta.url).href);
async function interrupted(t: TestContext, stop = true) {
  const root = await mkdtemp(join(tmpdir(), "axiom-client-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await writeFile(join(root, "installation.json"), JSON.stringify({ node: "/missing-node", cli: "/missing-cli" }));
  const script = `
    import { createUpdater } from ${JSON.stringify(moduleUrl)};
    import { createHash } from 'node:crypto';
    const bytes = Buffer.from('isolated fake DMG');
    const asset = {name:'Axiom2.dmg', size:bytes.length, digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'), browser_download_url:'https://github.com/cosyeezz/axiom2/releases/download/v0.4.2/Axiom2.dmg'};
    const updater = createUpdater({root:${JSON.stringify(root)}, fetcher: async url => {
      if (url.endsWith('/latest')) return new Response(JSON.stringify({tag_name:'v0.4.2', assets:[asset,{...asset,name:'axiom2.tgz',browser_download_url:'https://github.com/cosyeezz/axiom2/releases/download/v0.4.2/axiom2.tgz'}]}));
      if (url !== asset.browser_download_url) throw Error('unexpected fixture URL');
      process.stdout.write('fixture-ready\\n');
      return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(bytes.subarray(0,2)));}}));
    }});
    await updater.check(); await updater.runJob('client','0.4.2');
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let diagnostics = "";
  child.stderr.on("data", bytes => diagnostics += String(bytes));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`fixture did not start: ${diagnostics}`)), 15000);
    child.stdout.on("data", bytes => { if (String(bytes).includes("fixture-ready")) { clearTimeout(timer); resolve(); } });
    child.once("exit", () => { clearTimeout(timer); reject(Error(`fixture exited early: ${diagnostics}`)); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
  if (stop) { child.kill("SIGKILL"); await exited; }
  const updater = createUpdater({ root });
  const current = await updater.status();
  return { root, updater, id: current.job.task.id, pid: child.pid!, gate: join(root, "updates/process-owner.json"), manifest: join(root, "updates/tasks", current.job.task.id, "supervision.json") };
}
const options = { skip: process.platform !== "darwin", timeout: 30000 };
test("Darwin pure download recovery proves parent exit without claiming installation success", options, async t => {
  const f = await interrupted(t);
  const result = await f.updater.reconcile({ id: f.id });
  assert.equal(result.job.task.status, "interrupted"); assert.equal(result.job.reconciled, true);
  assert.equal(result.clientDownload, null); assert.equal(result.clientInstaller, null);
  await assert.rejects(access(f.gate));
  // Idempotent reconciliation neither replays the download nor creates a new task.
  assert.equal((await f.updater.reconcile({ id: f.id })).job.task.id, f.id);
});
test("a live Darwin download parent cannot be reconciled away", options, async t => {
  const f = await interrupted(t, false);
  await assert.rejects(f.updater.reconcile({ id: f.id }), /可靠凭据/); await access(f.gate);
});
for (const damage of ["commands", "services", "piLock", "parentWitness", "armed", "servicePending", "identity"]) test(`Darwin download recovery remains fail-closed for ${damage}`, options, async t => {
  const f = await interrupted(t);
  const manifest = JSON.parse(await readFile(f.manifest, "utf8"));
  if (damage === "armed") {
    const gate = JSON.parse(await readFile(f.gate, "utf8")); gate.state = "armed"; gate.identity = { platform: "darwin" }; await writeFile(f.gate, JSON.stringify(gate));
  } else if (damage === "servicePending") {
    const db = new DatabaseSync(join(f.root, "updates/jobs.sqlite"));
    try { const body = JSON.parse((db.prepare("SELECT body FROM job").get() as any).body); body.servicePending = true; db.prepare("UPDATE job SET body=?").run(JSON.stringify(body)); } finally { db.close(); }
  } else {
    if (damage === "commands" || damage === "services") manifest[damage] = [{}];
    else if (damage === "identity") manifest.attemptId = "00000000-0000-0000-0000-000000000000";
    else manifest[damage] = {};
    await writeFile(f.manifest, JSON.stringify(manifest));
  }
  await assert.rejects(f.updater.reconcile({ id: f.id })); await access(f.gate);
});
test("EPERM is not proof of parent death and changed witnesses cannot be released", options, async t => {
  const f = await interrupted(t), reconciler = await createUpdaterReconciler(f.root);
  t.after(() => reconciler.dispose());
  const db = new DatabaseSync(join(f.root, "updates/jobs.sqlite"));
  let row: any; try { row = db.prepare("SELECT token,pid,body FROM job").get(); } finally { db.close(); }
  const kill = t.mock.method(process, "kill", () => { throw Object.assign(Error("denied"), { code: "EPERM" }); });
  assert.throws(() => reconciler.inspect(row), /可靠凭据/); kill.mock.restore();
  const plan = reconciler.inspect(row);
  const manifest = JSON.parse(await readFile(f.manifest, "utf8")); manifest.commands.push({}); await writeFile(f.manifest, JSON.stringify(manifest));
  assert.throws(() => reconciler.release(plan, row), /已变化/); await access(f.gate);
});
