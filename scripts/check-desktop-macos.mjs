// Native WKWebView integration check. Only an isolated --test-instance app runs the probe.
import assert from "node:assert/strict";
import { spawn, execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { verifySourceProof } from "./native-source-proof.mjs";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "darwin");
assert.ok(process.env.AXIOM_DESKTOP_BINARY, "Set the isolated probe application binary");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceProof = JSON.parse(await readFile(join(repo, "app/test-results/native-source-proof.json"), "utf8"));
const productionDmg = await readFile(join(repo, "app/Axiom2.dmg"));
verifySourceProof(sourceProof, { productSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), probeSha: process.env.AXIOM_REGRESSION_REF || process.env.GITHUB_SHA, dmg: { size: productionDmg.length, sha256: createHash("sha256").update(productionDmg).digest("hex") } });
const root = await realpath(await mkdtemp(join(tmpdir(), "axiom-native-views-")));
const data = join(root, "data"), pi = join(root, "pi"), workspace = join(root, "workspace");
await Promise.all([mkdir(data), mkdir(pi), mkdir(workspace)]);
let port;
do {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, "127.0.0.1", done));
  port = socket.address().port;
  await new Promise((done) => socket.close(done));
} while (port === 4317);
const fixtureURL = `http://127.0.0.1:${port}/`;
const assertFixtureURL = (snapshot) => assert.equal(snapshot.views.find((view) => view.label === "axiom-workbench")?.url, fixtureURL, "Native workbench must use the isolated fixture endpoint");
const env = { ...process.env, AXIOM_DATA_DIR: data, AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: pi, AXIOM_PORT: String(port) };
const cli = join(repo, "bin/axiom2.mjs"), report = join(root, "probe.json");
const run = promisify(execFile);
const service = async (action) => JSON.parse((await run(process.execPath, [cli, action, "--json"], { env, timeout: 55000 })).stdout);
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } };
const stop = async () => {
  const before = await service("status");
  assert.equal((await service("stop")).state, "stopped");
  const until = Date.now() + 10000;
  while (before.pid && isAlive(before.pid)) { if (Date.now() > until) throw Error("Backend exit is unconfirmed"); await delay(100); }
};
let native, exited, log;
const launch = async (mode) => {
  await rm(report, { force: true });
  log = createWriteStream(join(root, `native-${mode}.log`));
  native = spawn(process.env.AXIOM_DESKTOP_BINARY, [], { env: { ...env, AXIOM_DESKTOP_PROBE_REPORT: report, AXIOM_DESKTOP_PROBE_MODE: mode }, stdio: ["ignore", "pipe", "pipe"] });
  native.stdout.pipe(log, { end: false }); native.stderr.pipe(log, { end: false });
  exited = new Promise((done, reject) => { native.once("error", reject); native.once("exit", (code, signal) => done({ code, signal })); });
  void exited.catch(() => {});
  await new Promise((done, reject) => { native.once("spawn", done); native.once("error", reject); });
};
const waitReport = async (phase) => {
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    let value;
    try { value = JSON.parse(await readFile(report, "utf8")); } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    if (value?.phase === "failed") throw Error(JSON.stringify(value));
    if (value?.phase === phase) return value;
    if (native.exitCode !== null || native.signalCode !== null) throw Error(`Native client exited before ${phase}: ${native.exitCode ?? native.signalCode}`);
    await delay(100);
  }
  throw Error(`Native probe timed out waiting for ${phase}`);
};
const waitExit = async () => {
  const outcome = await Promise.race([exited, delay(10000, null, { ref: false }).then(() => { throw Error("Native exit is unconfirmed"); })]);
  assert.equal(outcome.code, 0, `Unexpected native exit: ${JSON.stringify(outcome)}`);
  log.end();
};
let complete = false;
try {
  assert.equal((await service("start")).state, "running");
  const db = new DatabaseSync(join(data, "axiom.sqlite"));
  try {
    db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("desktop-probe-workspace", workspace, workspace, "Mac 单窗口项目");
    db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)").run("desktop-probe-session", "desktop-probe-workspace", "Mac 单窗口会话", Date.now());
  } finally { db.close(); }
  await stop();
  await launch("full");
  const checkpoint = await waitReport("checkpoint");
  assert.deepEqual(checkpoint.snapshot.windows, ["pake"]);
  assert.equal(checkpoint.snapshot.views.length, 2);
  assert.equal(checkpoint.snapshot.current, "workbench");
  assertFixtureURL(checkpoint.snapshot);
  const visible = await run("/usr/bin/swift", [join(repo, "scripts/check-macos-window.swift"), String(native.pid)], { timeout: 45000 });
  console.log("Native window while workbench is visible:", visible.stdout.trim());
  await run(process.env.AXIOM_DESKTOP_BINARY, [], { env, timeout: 15000 });
  await writeFile(join(root, "probe.ack"), "continue");
  if (process.platform === "darwin") {
    const hidden = await waitReport("dock-hidden");
    assert.equal(hidden.snapshot.visible, false);
    assert.equal(hidden.snapshot.current, "workbench");
    await run("/usr/bin/open", ["-a", resolve(dirname(process.env.AXIOM_DESKTOP_BINARY), "../..")], { timeout: 15000 });
  }
  const full = await waitReport("finished");
  assertFixtureURL(full.snapshot);
  await waitExit();
  const running = await service("status");
  assert.equal(running.state, "running", "Closing the native window must preserve the background service");
  await copyFile(report, join(root, "full-result.json"));
  await launch("reopen");
  const reopened = await waitReport("finished");
  assert.equal(reopened.snapshot.current, "control");
  assert.deepEqual(reopened.snapshot.views.map(view => view.label), ["pake"]);
  await waitExit();
  const afterReopen = await service("status");
  assert.equal(afterReopen.state, "running");
  assert.equal(afterReopen.pid, running.pid, "Reopening must reuse the existing service");
  const evidence = { success: true, node: process.version, fixtureURL, sourceProof, full, reopened, nativeWindow: JSON.parse(visible.stdout), backendSurvivedNativeClose: true, secondInstanceReusedWindow: true, macMenusAndDock: process.platform === "darwin" };
  await mkdir(join(repo, "app/test-results"), { recursive: true });
  await writeFile(join(repo, "app/test-results/desktop-macos.json"), JSON.stringify(evidence, null, 2));
  console.log("PASS: native macOS single-window control/workbench switching, command isolation, draft/scroll/selection/focus, resize, start/stop, native close, and reopening with the existing backend.");
  complete = true;
} finally {
  try {
    if (native && native.exitCode === null && native.signalCode === null) {
      native.kill();
      const deadline = Date.now() + 10000;
      while (native.exitCode === null && native.signalCode === null) {
        if (Date.now() >= deadline) throw Error("Native cleanup exit is unconfirmed");
        await delay(50);
      }
    }
    log?.end();
    if (!complete) {
      const diagnostics = join(repo, "app/test-results/macos-probe-failure");
      await mkdir(diagnostics, { recursive: true });
      for (const name of ["probe.json", "native-full.log", "native-reopen.log"]) {
        await copyFile(join(root, name), join(diagnostics, name)).catch((error) => { if (error.code !== "ENOENT") console.error(error); });
      }
    }
    await stop();
    if (complete) await rm(root, { recursive: true, force: true });
    else console.error("Retained isolated native macOS fixture:", root);
  } catch (error) { console.error("Retained isolated native macOS fixture:", root); throw error; }
}
