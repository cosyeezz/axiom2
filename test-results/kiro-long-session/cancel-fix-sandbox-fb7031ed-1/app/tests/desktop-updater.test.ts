import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const { createUpdater, newer, execute } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
const base = "https://github.com/cosyeezz/axiom2/releases/download/";
const oldVersion = "0.2.3", nextVersion = "0.3.0";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext, options: { source?: boolean; brokenControl?: boolean } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "axiom-update-"));
  t.after(() => rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const root = join(temporary, "data");
  const packageRoot = options.source ? join(temporary, "source") : join(temporary, "prefix/node_modules/@cosyeezz/axiom2");
  const cli = join(packageRoot, "bin/axiom2.mjs");
  async function packageAt(path: string, version: string) {
    await mkdir(join(path, "bin"), { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name: "@cosyeezz/axiom2", version }));
    await writeFile(join(path, "bin/axiom2.mjs"), "// fixture executable\n");
    if (options.brokenControl && version === nextVersion) {
      await writeFile(join(path, "bin/axiom2.mjs"), await readFile(new URL("../../bin/axiom2.mjs", import.meta.url)));
      await writeFile(join(path, "bin/service.mjs"), "export const broken = ; // simulate a damaged control module\n");
    }
  }
  await packageAt(packageRoot, oldVersion);
  await mkdir(root);
  await writeFile(join(root, "installation.json"), JSON.stringify({ node: process.execPath, cli }));
  await writeFile(join(root, "user-data"), "preserve projects and sessions");
  const bytes: Record<string, Buffer> = { "axiom2.tgz": Buffer.from("verified service fixture"), "Axiom2.msi": Buffer.from("verified installer fixture") };
  if (process.platform === "linux") bytes[`axiom-owner-linux-${process.arch}`] = await readFile(new URL(`../../bin/native/linux-${process.arch}/axiom-owner`, import.meta.url));
  const release = { tag_name: `v${nextVersion}`, draft: false, prerelease: false, assets: Object.entries(bytes).map(([name, value]) => ({ name, state: "uploaded", size: value.length, digest: `sha256:${digest(value)}`, browser_download_url: `${base}v${nextVersion}/${name}` })) };
  const calls: string[] = [];
  let state = "running", failInstall = false, failNewStart = false, failOldStart = false, concurrentStart = false;
  let runtimeVersion: string | null | undefined;
  let refuseStop = false;
  let holdInstall: ReturnType<typeof gate> | null = null;
  const installEntered = gate();
  const command = async (_node: string, args: string[]) => {
    if (args[1] === "install") {
      calls.push("install"); installEntered.resolve();
      if (holdInstall) await holdInstall.promise;
      if (failInstall) throw Error("simulated install failure");
      const stage = args[args.indexOf("--prefix") + 1];
      assert.ok(args.includes("--ignore-scripts"));
      assert.ok(args.includes("--omit=dev"));
      assert.ok(args.includes("--install-strategy=shallow"));
      const candidate = join(stage, "node_modules/@cosyeezz/axiom2");
      await packageAt(candidate, nextVersion);
      await mkdir(join(candidate, "node_modules/test-dependency/node_modules/nested-dependency"), { recursive: true });
      await writeFile(join(candidate, "node_modules/test-dependency/index.js"), "export const available = true;");
      await writeFile(join(candidate, "node_modules/test-dependency/node_modules/nested-dependency/index.js"), "export const nested = true;");
      await mkdir(join(stage, "node_modules/.bin"));
      await writeFile(join(stage, "node_modules/.bin/axiom2"), "staging-only self shim");
      return "";
    }
    const version = JSON.parse(await readFile(join(dirname(dirname(args[0])), "package.json"), "utf8")).version;
    if (options.brokenControl && version === nextVersion) {
      calls.push(`${args[1]}:${version}`);
      return execute(_node, args, { env: { ...process.env, AXIOM_DATA_DIR: root }, fetcher });
    }
    if (args[1] === "--version") return version;
    const action = args[1]; calls.push(`${action}:${version}`);
    if (action === "stop") {
      if (refuseStop) return JSON.stringify({ state: "stopping", active: [] });
      state = "stopped";
      if (concurrentStart) {
        concurrentStart = false; state = "running";
        await writeFile(join(root, "service-control.json"), JSON.stringify({ pid: process.pid, token: "e".repeat(64), port: 12345 }));
      }
    }
    if (action === "start") {
      if ((version === nextVersion && failNewStart) || (version === oldVersion && failOldStart)) return JSON.stringify({ state: "error", message: "simulated startup failure" });
      state = "running";
    }
    return JSON.stringify({ state: action === "stop" ? "stopped" : state, version: runtimeVersion === undefined ? version : runtimeVersion, active: [], ...(state === "running" ? { pid: 123456 } : {}) });
  };
  const fetcher = async (url: string) => {
    if (url.endsWith("/latest")) return new Response(JSON.stringify(release));
    const asset = release.assets.find(asset => asset.browser_download_url === url);
    assert.ok(asset, `Unexpected fixture URL: ${url}`);
    return new Response(new Uint8Array(bytes[asset.name]));
  };
  const updater = createUpdater({ root, fetcher, command, isAlive: (pid: number) => pid === process.pid });
  const installedVersion = async () => JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
  return { root, packageRoot, cli, bytes, release, calls, updater, command, fetcher, installedVersion, packageAt, state: () => state,
    refuseStop: () => { refuseStop = true; },
    reportVersion: (value: string | null) => { runtimeVersion = value; },
    raceStart: () => { concurrentStart = true; },
    failInstall: () => { failInstall = true; }, failNew: () => { failNewStart = true; }, failOld: (value: boolean) => { failOldStart = value; },
    pauseInstall: () => { holdInstall = gate(); return { entered: installEntered.promise, release: () => holdInstall!.resolve() }; } };
}

test("desktop update version ordering is numeric and refuses malformed or equal versions", () => {
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("0.3.0", "0.3.0"), false);
  assert.equal(newer("0.2.9", "0.3.0"), false);
  assert.equal(newer("1.0.0-beta", "0.3.0"), false);
});

test("desktop update refuses release assets outside the fixed repository", async (t) => {
  const f = await fixture(t);
  f.release.assets[0].browser_download_url = "https://example.com/untrusted.tgz";
  await assert.rejects(f.updater.check(), /附件信息无效/);
  assert.deepEqual(f.calls, []);
});

test("download checksum failure preserves the running service and installed version", async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  f.bytes["axiom2.tgz"] = Buffer.from("tampered");
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "error");
  assert.match(result.job.message, /大小不符.*预期.*实际/);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
  assert.deepEqual(f.calls, []);
});

test("same-size checksum mismatch includes expected and actual digests before touching service", async t => {
  const f = await fixture(t); await f.updater.check();
  f.bytes["axiom2.tgz"] = Buffer.alloc(f.bytes["axiom2.tgz"].length, 120);
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "error"); assert.match(result.job.message, /SHA-256 不符.*预期 [a-f0-9]{64}，实际 [a-f0-9]{64}/);
  assert.deepEqual(f.calls, []);
});
test("npm command errors expose bounded output and exit code instead of a log-only instruction", async t => {
  const root = await mkdtemp(join(tmpdir(), "axiom-npm-error-")); t.after(() => rm(root, { recursive: true, force: true }));
  const log = join(root, "output.log");
  const { fetcher } = await fixture(t);
  await assert.rejects(execute(process.execPath, ["-e", "console.error('npm error code ECONNRESET'); process.exit(7)"], { log, fetcher }), (error: Error) => {
    assert.match(error.message, /退出[（\s]7[）。]/);
    assert.match(error.message, /ECONNRESET/);
    return true;
  });
  await assert.rejects(execute(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], { log, fetcher, timeoutMs: 100 }), { code: "total-timeout" });
});
test("successful desktop backend update keeps CLI location, dependencies and user data", async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "complete", result.job.message);
  assert.equal(await f.installedVersion(), nextVersion);
  assert.equal(f.state(), "running");
  assert.equal(JSON.parse(await readFile(join(f.root, "installation.json"), "utf8")).cli, f.cli);
  assert.equal(await readFile(join(f.root, "user-data"), "utf8"), "preserve projects and sessions");
  await access(join(f.packageRoot, "node_modules/test-dependency/index.js"));
  await access(join(f.packageRoot, "node_modules/test-dependency/node_modules/nested-dependency/index.js"));
  await assert.rejects(access(join(f.packageRoot, "node_modules/.bin/axiom2")), { code: "ENOENT" });
  const previous = JSON.parse(await readFile(join(f.root, "updates/previous-version.json"), "utf8"));
  assert.equal(JSON.parse(await readFile(join(previous.backup, "package.json"), "utf8")).version, oldVersion);
  assert.equal(result.recovery, false);
  assert.ok(f.calls.indexOf("install") < f.calls.indexOf(`stop:${oldVersion}`));
});

test("dependency installation failure does not stop or replace the old service", async (t) => {
  const f = await fixture(t);
  await f.updater.check(); f.failInstall();
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "error");
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
  assert.deepEqual(f.calls, ["install"]);
});

test("failed new-service startup restores the previous program and running service", async (t) => {
  const f = await fixture(t);
  await f.updater.check(); f.failNew();
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "error");
  assert.match(result.job.message, /已恢复/);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
  assert.equal(result.recovery, false);
});

test("a candidate with a valid version but broken control imports rolls back using the backup CLI", async (t) => {
  const f = await fixture(t, { brokenControl: true });
  await f.updater.check();
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "error");
  assert.match(result.job.message, /已恢复之前的服务程序/);
  assert.ok(f.calls.includes(`--version:${nextVersion}`));
  assert.ok(f.calls.includes(`start:${nextVersion}`));
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
  assert.equal(result.recovery, false);
  assert.equal(JSON.parse(await readFile(join(f.root, "installation.json"), "utf8")).cli, f.cli);
});

test("explicit recovery bypasses an existing candidate CLI whose control imports are broken", async (t) => {
  const f = await fixture(t, { brokenControl: true });
  const { backup } = await recoveryRecord(f);
  await rename(f.packageRoot, backup);
  await f.packageAt(f.packageRoot, nextVersion);
  assert.equal(await execute(process.execPath, [f.cli, "--version"], { fetcher: f.fetcher }), nextVersion);
  for (const action of ["status", "stop", "start"]) {
    await assert.rejects(execute(process.execPath, [f.cli, action, "--json"], { env: { ...process.env, AXIOM_DATA_DIR: f.root }, fetcher: f.fetcher }), /Unexpected token/);
  }
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "complete", result.job.message);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
  assert.equal(result.recovery, false);
  assert.equal(JSON.parse(await readFile(join(f.root, "installation.json"), "utf8")).cli, f.cli);
});

test("backup control must confirm shutdown before recovery can move a damaged candidate", async (t) => {
  const f = await fixture(t, { brokenControl: true });
  const { backup } = await recoveryRecord(f);
  await rename(f.packageRoot, backup);
  await f.packageAt(f.packageRoot, nextVersion);
  f.refuseStop();
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "error");
  assert.match(result.job.message, /尚未确认服务停止/);
  assert.equal(result.recovery, true);
  assert.equal(await f.installedVersion(), nextVersion);
  assert.equal(JSON.parse(await readFile(join(backup, "package.json"), "utf8")).version, oldVersion);
});

test("failed rollback remains recoverable on a later explicit retry", async (t) => {
  const f = await fixture(t);
  await f.updater.check(); f.failNew(); f.failOld(true);
  const failed = await f.updater.runJob("service", nextVersion);
  assert.equal(failed.job.phase, "error");
  assert.equal(failed.recovery, true);
  f.failOld(false);
  const recovered = await f.updater.runJob("recover");
  assert.equal(recovered.job.phase, "complete", recovered.job.message);
  assert.equal(recovered.recovery, false);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
});

test("recovery works after interruption between directory renames with a missing original CLI", async (t) => {
  const f = await fixture(t);
  const id = "d".repeat(32);
  const stage = join(dirname(f.packageRoot), `.axiom2-update-${id}`);
  const backup = join(dirname(f.packageRoot), `.axiom2-backup-${id}`);
  await mkdir(stage); await mkdir(join(f.root, "updates"));
  await rename(f.packageRoot, backup);
  await writeFile(join(f.root, "updates/transaction.json"), JSON.stringify({ id, stage, backup, packageRoot: f.packageRoot, node: process.execPath, cli: f.cli, previousVersion: oldVersion, wasRunning: true }));
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "complete", result.job.message);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
});

async function recoveryRecord(f: Awaited<ReturnType<typeof fixture>>, wasRunning = true) {
  const id = "a".repeat(32);
  const stage = join(dirname(f.packageRoot), `.axiom2-update-${id}`);
  const backup = join(dirname(f.packageRoot), `.axiom2-backup-${id}`);
  await mkdir(stage); await mkdir(join(f.root, "updates"), { recursive: true });
  await writeFile(join(f.root, "updates/transaction.json"), JSON.stringify({ id, stage, backup, packageRoot: f.packageRoot, node: process.execPath, cli: f.cli, previousVersion: oldVersion, wasRunning }));
  return { stage, backup };
}

test("recovery keeps its journal when the backup is missing and the installed version is not the previous version", async (t) => {
  const f = await fixture(t);
  await recoveryRecord(f, false);
  await f.packageAt(f.packageRoot, nextVersion);
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "error");
  assert.equal(result.recovery, true);
  assert.equal(await f.installedVersion(), nextVersion);
  assert.deepEqual(f.calls, []);
});

test("recovery rejects a backup of the wrong version before stopping or moving programs", async (t) => {
  const f = await fixture(t);
  const { backup } = await recoveryRecord(f);
  await f.packageAt(f.packageRoot, nextVersion);
  await f.packageAt(backup, "9.9.9");
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "error");
  assert.equal(result.recovery, true);
  assert.equal(await f.installedVersion(), nextVersion);
  assert.deepEqual(f.calls, []);
});

test("recovery retains its journal when a running instance reports the wrong version", async (t) => {
  const f = await fixture(t);
  await recoveryRecord(f); f.reportVersion(nextVersion);
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "error");
  assert.equal(result.recovery, true);
  assert.equal(await f.installedVersion(), oldVersion);
});

test("recovery can finish an already-restored legacy installation without a runtime version field", async (t) => {
  const f = await fixture(t);
  await recoveryRecord(f); f.reportVersion(null);
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "complete", result.job.message);
  assert.equal(result.recovery, false);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
});

test("concurrent desktop updates cannot both mutate one installation", async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  const paused = f.pauseInstall();
  const first = f.updater.runJob("service", nextVersion);
  try {
    await paused.entered;
    assert.equal((await f.updater.busy()).busy, true);
    await assert.rejects(f.updater.runJob("service", nextVersion), /已有更新正在进行/);
  } finally { paused.release(); }
  assert.equal((await first).job.phase, "complete");
  assert.equal(f.calls.filter((value) => value === "install").length, 1);
});

test("source checkouts and changed confirmation versions are never replaced", async (t) => {
  const source = await fixture(t, { source: true });
  await source.updater.check();
  assert.equal((await source.updater.runJob("service", nextVersion)).job.phase, "error");
  assert.equal(await source.installedVersion(), oldVersion);
  assert.deepEqual(source.calls, []);
  const f = await fixture(t);
  await f.updater.check();
  assert.match((await f.updater.runJob("service", "0.2.9")).job.message, /版本已变化/);
  assert.deepEqual(f.calls, []);
});

test("an already-ready concurrent service prevents package replacement even without a startup row", async (t) => {
  const f = await fixture(t);
  await f.updater.check(); f.raceStart();
  const result = await f.updater.runJob("service", nextVersion);
  assert.equal(result.job.phase, "error");
  assert.match(result.job.message, /服务实例已变化/);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
});

test("verified client installer survives unrelated Pi jobs, release checks and updater restart", async t => {
  const f = await fixture(t);
  await f.updater.check(); await f.updater.runJob("client", nextVersion);
  const initial = await f.updater.installer();
  assert.equal((await f.updater.status()).clientInstaller.version, nextVersion);
  await f.updater.piRefresh();
  assert.equal((await f.updater.status()).job.kind, "pi-refresh");
  assert.deepEqual(await f.updater.installer(), initial);
  await f.updater.runJob("check");
  const restarted = createUpdater({ root: f.root, command: f.command, fetcher: f.fetcher });
  assert.deepEqual(await restarted.installer(), initial);
  await writeFile(initial.installer, "tampered");
  await assert.rejects(restarted.installer(), /安装包已变化/);
  const after = await restarted.status();
  assert.equal(after.clientInstaller, null);
  assert.equal(after.job.kind, "check"); assert.equal(after.job.phase, "complete", "invalid artifact cannot overwrite an unrelated current task");
});

test("legacy ready jobs migrate their installer before an unrelated task replaces them", async t => {
  const f = await fixture(t);
  await f.updater.check(); await f.updater.runJob("client", nextVersion);
  const original = await f.updater.installer();
  const db = new DatabaseSync(join(f.root, "updates/jobs.sqlite"));
  try { db.prepare('DELETE FROM client_installer').run(); } finally { db.close(); }
  await f.updater.piRefresh();
  assert.equal((await f.updater.status()).job.kind, "pi-refresh");
  assert.deepEqual(await createUpdater({ root: f.root }).installer(), original);
});

test("failed newer client download retains the previously verified installer", async t => {
  const f = await fixture(t);
  await f.updater.check(); await f.updater.runJob("client", nextVersion);
  const original = await f.updater.installer(), version = "0.4.0", expected = Buffer.from("a different newer installer");
  f.release.tag_name = `v${version}`;
  for (const asset of f.release.assets) {
    asset.browser_download_url = `${base}v${version}/${asset.name}`;
    if (asset.name === "Axiom2.msi") { asset.digest = `sha256:${digest(expected)}`; asset.size = expected.length; }
  }
  await f.updater.check();
  const result = await f.updater.runJob("client", version);
  assert.equal(result.job.phase, "error");
  assert.equal(result.clientInstaller.version, nextVersion);
  assert.deepEqual(await f.updater.installer(), original);
  assert.equal((await f.updater.status()).job.phase, "error", "starting a valid old artifact must not mutate the failed download job");
});

for (const damage of ["invalid-json", "bad-url", "missing-file"]) test(`invalid installer state is isolated from unrelated tasks: ${damage}`, async t => {
  const f = await fixture(t);
  await f.updater.check(); await f.updater.runJob("client", nextVersion);
  const original = await f.updater.installer(); await f.updater.piRefresh();
  if (damage === "missing-file") await rm(original.installer);
  else {
    const db = new DatabaseSync(join(f.root, "updates/jobs.sqlite"));
    try {
      let body = "{";
      if (damage === "bad-url") { const value = JSON.parse((db.prepare('SELECT body FROM client_installer WHERE id=1').get() as any).body); value.asset.url = "https://example.com/installer.msi"; body = JSON.stringify(value); }
      db.prepare('UPDATE client_installer SET body=? WHERE id=1').run(body);
    } finally { db.close(); }
  }
  assert.equal((await f.updater.status()).clientInstaller, null);
  await assert.rejects(f.updater.installer());
  const state = await f.updater.status();
  assert.equal(state.job.kind, "pi-refresh"); assert.equal(state.job.phase, "complete");
});

test("client installer is rehashed before handing it to the native launcher", async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  const result = await f.updater.runJob("client", nextVersion);
  assert.equal(result.job.phase, "ready");
  const { installer } = await f.updater.installer();
  assert.deepEqual(await readFile(installer), f.bytes["Axiom2.msi"]);
  await writeFile(installer, "tampered after download");
  await assert.rejects(f.updater.installer(), /安装包已变化/);
  assert.equal((await f.updater.status()).job.phase, "error");
  assert.deepEqual(f.calls, []);
});
