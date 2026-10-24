import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const { createUpdater } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
async function fixture(t: TestContext, options: { missingEntry?: boolean; missingShim?: boolean; wrongVersion?: boolean; linkedNpm?: boolean; noBackend?: boolean; noNpm?: boolean; onCommand?: (args: string[], settings: any) => Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "axiom-pi-update-")); t.after(() => rm(root, { recursive: true, force: true }));
  const node = join(root, "node/bin/node"), npm = options.linkedNpm ? join(root, "node/share/npm/bin/npm-cli.js") : join(dirname(node), "node_modules/npm/bin/npm-cli.js");
  const cli = join(root, "service/bin/axiom2.mjs"), prefix = join(root, "global"), modules = join(prefix, process.platform === "win32" ? "node_modules" : "lib/node_modules");
  const pkgPath = join(modules, "@earendil-works/pi-coding-agent/package.json");
  const put = async (path: string, body: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof body === "string" ? body : JSON.stringify(body)); };
  await put(node, "fixture"); if (!options.noNpm) await put(npm, "fixture"); await put(cli, "fixture");
  if (options.linkedNpm) await symlink(npm, join(dirname(node), "npm"));
  await put(join(root, "service/package.json"), { name: "@cosyeezz/axiom2", version: "0.4.1" });
  await put(join(root, "service/node_modules/@earendil-works/pi-coding-agent/package.json"), { name: "@earendil-works/pi-coding-agent", version: "1.1.0", exports: { ".": { import: "./index.js" } } });
  await put(join(root, "service/node_modules/@earendil-works/pi-coding-agent/index.js"), "fixture");
  if (!options.noBackend) await put(join(root, "installation.json"), { node, cli });
  const entry = join(dirname(pkgPath), "dist/bundle/cli.js");
  const shim = process.platform === "win32" ? join(prefix, "pi.cmd") : join(prefix, "bin/pi");
  const installVersion = async (version: string) => {
    await put(pkgPath, { name: "@earendil-works/pi-coding-agent", version, bin: { pi: "dist/bundle/cli.js" } });
    if (!options.missingEntry) await put(entry, "fixture");
    if (!options.missingShim) await put(shim, "fixture");
  };
  await installVersion("0.85.1");
  const installs: string[][] = []; let fail = false;
  const command = async (_node: string, args: string[], settings: any) => {
    await options.onCommand?.(args, settings);
    assert.equal(_node, node);
    if (args[1] === "--version") {
      assert.equal(args[0], entry);
      await access(join(dirname(dirname(pkgPath)), ".axiom-pi-update.lock"));
      return options.wrongVersion ? "0.0.0" : "1.1.1";
    }
    assert.equal(await realpath(args[0]), await realpath(npm));
    if (args[1] === "root") return modules;
    assert.equal(args[1], "install"); installs.push(args);
    assert.ok(args.includes("--bin-links=true"));
    assert.equal(args[args.indexOf("--prefix") + 1], prefix); assert.ok(args.includes("--engine-strict")); assert.ok(args.includes("--@earendil-works:registry=https://registry.npmjs.org"));
    if (fail) throw Error("fixture failure");
    await installVersion("1.1.1"); return "";
  };
  const updater = createUpdater({ root, command, runtimeNode: node, env: { ...process.env, PATH: "" }, fetcher: async () => new Response(JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.1.1" })) });
  return { root, modules, updater, installs, installVersion, pkgPath, put, fail: () => { fail = true; } };
}
test("terminal Pi installs without a backend or installation record", async t => {
  const f = await fixture(t, { noBackend: true });
  await rm(dirname(f.modules), { recursive: true, force: true });
  const state = await f.updater.piCheck();
  assert.equal(state.pi.runtimeVersion, null); assert.equal(state.serviceVersion, null); assert.equal(state.managed, false);
  assert.equal(state.pi.cli.version, null);
  const result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "complete", result.job.message); assert.equal(result.pi.cli.version, "1.1.1");
  await assert.rejects(access(join(f.root, "installation.json")));
  assert.equal((await f.updater.runJob("service", "0.4.1")).job.phase, "error");
  assert.equal(f.installs.length, 1);
});
test("standalone Pi reports the missing npm dependency without requesting backend installation", async t => {
  const f = await fixture(t, { noBackend: true, noNpm: true });
  const state = await f.updater.piRefresh();
  assert.match(state.pi.cli.error, /找不到 npm/);
  assert.doesNotMatch(state.pi.cli.error, /安装.*后台/);
  assert.equal(f.installs.length, 0);
});
test("pi check distinguishes embedded runtime and CLI, upgrades only the inspected global prefix", async t => {
  const f = await fixture(t), state = await f.updater.piCheck();
  assert.equal(state.pi.runtimeVersion, "1.1.0"); assert.equal(state.pi.cli.version, "0.85.1"); assert.equal(f.installs.length, 0);
  const result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "complete", result.job.message); assert.equal(result.pi.cli.version, "1.1.1"); assert.equal(result.pi.runtimeVersion, "1.1.0"); assert.equal(f.installs.length, 1);
  assert.equal(f.installs[0].at(-1), "@earendil-works/pi-coding-agent@1.1.1");
  await assert.rejects(access(join(dirname(dirname(f.pkgPath)), ".axiom-pi-update.lock")));
});
test("pi rejects stale release tokens and changed installation identity before npm", async t => {
  const f = await fixture(t), old = await f.updater.piCheck(), current = await f.updater.piCheck();
  let result = await f.updater.runJob("pi", old.pi.release.token); assert.equal(result.job.phase, "error"); assert.equal(f.installs.length, 0);
  await f.installVersion("1.0.0");
  result = await f.updater.runJob("pi", current.pi.release.token); assert.equal(result.job.phase, "error"); assert.match(result.job.message, /已改变/); assert.equal(f.installs.length, 0);
});
test("pi failure refreshes actual version and releases installation lock", async t => {
  const f = await fixture(t), state = await f.updater.piCheck(); f.fail();
  const result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "error"); assert.equal(result.pi.cli.version, "0.85.1");
  await assert.rejects(access(join(dirname(dirname(f.pkgPath)), ".axiom-pi-update.lock")));
});
test("pi cross-data installation lock prevents a second updater touching shared CLI", async t => {
  const f = await fixture(t), state = await f.updater.piCheck();
  const lock = join(dirname(dirname(f.pkgPath)), ".axiom-pi-update.lock"); await f.put(lock, { pid: process.pid });
  const result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "error"); assert.equal(f.installs.length, 0); assert.equal(JSON.parse(await readFile(lock, "utf8")).pid, process.pid);
});
test("corrupt optional pi caches do not block the original updater status", async t => {
  const f = await fixture(t);
  await f.put(join(f.root, "updates/pi-installation.json"), "{"); await f.put(join(f.root, "updates/pi-release.json"), "{");
  const state = await f.updater.status(); assert.equal(state.serviceVersion, "0.4.1"); assert.ok(state.pi.cli.error); assert.equal(state.pi.release, null);
  const fresh = await f.updater.piCheck(); assert.equal(fresh.pi.cli.version, "0.85.1"); assert.ok(fresh.pi.release.token);
});
test("pi installs into a previously absent global directory without changing embedded runtime", async t => {
  const f = await fixture(t);
  await rm(dirname(f.modules), { recursive: true, force: true });
  const state = await f.updater.piCheck();
  assert.equal(state.pi.cli.version, null);
  const result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "complete", result.job.message);
  assert.equal(result.pi.cli.version, "1.1.1");
  assert.equal(result.pi.runtimeVersion, "1.1.0");
  assert.equal(f.installs.length, 1);
});
test("pi refuses legacy installations and downgrades before invoking npm install", async t => {
  const f = await fixture(t);
  const legacy = join(f.modules, "@mariozechner/pi-coding-agent/package.json");
  await f.put(legacy, { name: "@mariozechner/pi-coding-agent", version: "0.60.0" });
  let state = await f.updater.piCheck();
  assert.equal(state.pi.cli.legacy, true);
  let result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "error"); assert.match(result.job.message, /旧命名空间/);
  await rm(dirname(legacy), { recursive: true, force: true });
  await f.installVersion("2.0.0");
  state = await f.updater.piCheck();
  result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "error"); assert.match(result.job.message, /未执行降级/);
  assert.equal(f.installs.length, 0);
});
test("pi resolves an npm symlink beside the registered Node outside the usual layout", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t, { linkedNpm: true });
  const state = await f.updater.piCheck();
  const result = await f.updater.runJob("pi", state.pi.release.token);
  assert.equal(result.job.phase, "complete", result.job.message);
  assert.equal(f.installs.length, 1);
});
for (const options of [{ missingEntry: true }, { missingShim: true }, { wrongVersion: true }]) {
  test(`pi does not report success for an unusable CLI: ${Object.keys(options)[0]}`, async t => {
    const f = await fixture(t, options), state = await f.updater.piCheck();
    const result = await f.updater.runJob("pi", state.pi.release.token);
    assert.equal(result.job.phase, "error");
    assert.match(result.job.message, /命令入口不完整|未通过运行验证/);
    assert.equal(result.pi.cli.version, "1.1.1");
    assert.equal(result.pi.release.token, null, "changed installation requires a fresh check before retry");
    assert.ok((await f.updater.piCheck()).pi.release.token);
    await assert.rejects(access(join(dirname(dirname(f.pkgPath)), ".axiom-pi-update.lock")));
  });
}
test("changing global modules symlink invalidates pi upgrade confirmation", async t => {
  const f = await fixture(t), a = join(f.root, "a"), b = join(f.root, "b");
  await rm(f.modules, { recursive: true, force: true });
  for (const dir of [a, b]) await f.put(join(dir, "@earendil-works/pi-coding-agent/package.json"), { name: "@earendil-works/pi-coding-agent", version: "0.85.1" });
  await symlink(a, f.modules, process.platform === "win32" ? "junction" : "dir");
  const state = await f.updater.piCheck(); await rm(f.modules); await symlink(b, f.modules, process.platform === "win32" ? "junction" : "dir");
  const result = await f.updater.runJob("pi", state.pi.release.token); assert.equal(result.job.phase, "error"); assert.equal(f.installs.length, 0);
});

for (const stage of ["root", "--version"]) test(`pi ${stage} probe follows live budgets and cancellation without starting more commands`, { timeout: 10000 }, async t => {
  let enabled = false, captured: any, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const f = await fixture(t, { onCommand: async (args, options) => {
    if (!enabled || args[1] !== stage) return;
    assert.ok(options.signal, "probe must share the maintenance cancellation signal");
    options.signal.throwIfAborted();
    captured = options; enter();
    await new Promise<void>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  } });
  const state = await f.updater.piCheck(); enabled = true;
  const work = f.updater.runJob("pi", state.pi.release.token);
  await entered;
  const running = await f.updater.status(), id = running.job.task.id;
  try {
    assert.equal(running.job.task.capabilities.cancel, true);
    const initial = captured.getTimeout();
    assert.ok(initial > 20000, "the old fixed 20 second limit must not govern a maintained probe");
    const budgets = { ...running.job.task.budgets, totalMs: running.job.task.budgets.totalMs + 5000 };
    await f.updater.maintenanceControl("extend", { id, budgets });
    const end = Date.now() + 3000;
    while (captured.getTimeout() === initial && Date.now() < end) await delay(20);
    assert.equal(captured.getTimeout(), initial + 5000, "extension changes the running command limit without resetting elapsed time");
    await f.updater.maintenanceControl("cancel", { id });
    const result = await work;
    assert.equal(result.job.task.status, "cancelled");
    assert.equal(result.job.task.error.code, "cancelled");
    assert.equal(f.installs.length, stage === "root" ? 0 : 1);
    assert.equal(result.pi.release.token, null, "interrupted inspection invalidates the previous confirmation");
    await assert.rejects(access(join(dirname(dirname(f.pkgPath)), ".axiom-pi-update.lock")));
  } finally {
    await f.updater.maintenanceControl("cancel", { id }).catch(() => {}); await work;
  }
});
