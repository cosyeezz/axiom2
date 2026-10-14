import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
const { createUpdater, newer } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
const base = "https://github.com/cosyeezz/axiom2/releases/download/";
const oldVersion = "0.2.3", nextVersion = "0.3.0";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
async function fixture(t: TestContext, options: { source?: boolean } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "axiom-update-"));
  t.after(() => rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const root = join(temporary, "data");
  const packageRoot = options.source ? join(temporary, "source") : join(temporary, "prefix/node_modules/@cosyeezz/axiom2");
  const cli = join(packageRoot, "bin/axiom2.mjs");
  async function packageAt(path: string, version: string) {
    await mkdir(join(path, "bin"), { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name: "@cosyeezz/axiom2", version }));
    await writeFile(join(path, "bin/axiom2.mjs"), "// fixture executable\n");
  }
  await packageAt(packageRoot, oldVersion);
  await mkdir(root);
  await writeFile(join(root, "installation.json"), JSON.stringify({ node: process.execPath, cli }));
  await writeFile(join(root, "user-data"), "preserve projects and sessions");
  const bytes: Record<string, Buffer> = { "axiom2.tgz": Buffer.from("verified service fixture"), "Axiom2.msi": Buffer.from("verified installer fixture") };
  const release = { tag_name: `v${nextVersion}`, draft: false, prerelease: false, assets: Object.entries(bytes).map(([name, value]) => ({ name, size: value.length, digest: `sha256:${digest(value)}`, browser_download_url: `${base}v${nextVersion}/${name}` })) };
  const calls: string[] = [];
  let state = "running", failInstall = false, failNewStart = false, failOldStart = false, concurrentStart = false;
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
      await packageAt(join(stage, "node_modules/@cosyeezz/axiom2"), nextVersion);
      await mkdir(join(stage, "node_modules/test-dependency"));
      await writeFile(join(stage, "node_modules/test-dependency/index.js"), "export const available = true;");
      return "";
    }
    const version = JSON.parse(await readFile(join(dirname(dirname(args[0])), "package.json"), "utf8")).version;
    if (args[1] === "--version") return version;
    const action = args[1]; calls.push(`${action}:${version}`);
    if (action === "stop") {
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
    return JSON.stringify({ state: action === "stop" ? "stopped" : state, version, active: [], ...(state === "running" ? { pid: 123456 } : {}) });
  };
  const fetcher = async (url: string) => {
    if (url.endsWith("/latest")) return new Response(JSON.stringify(release));
    return new Response(bytes[url.split("/").at(-1)!].toString("utf8"));
  };
  const updater = createUpdater({ root, fetcher, command, isAlive: (pid: number) => pid === process.pid });
  const installedVersion = async () => JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
  return { root, packageRoot, cli, bytes, release, calls, updater, command, installedVersion, packageAt, state: () => state,
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
  assert.match(result.job.message, /校验失败/);
  assert.equal(await f.installedVersion(), oldVersion);
  assert.equal(f.state(), "running");
  assert.deepEqual(f.calls, []);
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
  await writeFile(join(f.root, "updates/transaction.json"), JSON.stringify({ id, stage, backup, packageRoot: f.packageRoot, node: process.execPath, cli: f.cli, wasRunning: true }));
  const result = await f.updater.runJob("recover");
  assert.equal(result.job.phase, "complete", result.job.message);
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
