import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createInstalledResourceLoader } from "../src/server/installed-resource-loader.js";
import { runPiPackage } from "../src/server/pi-package-process.js";
import { commitPiPackage, listPiPackageRemovals, lockPiPackage, piPackagePlan } from "../src/server/pi-package-storage.js";
import { MaintenanceService } from "../src/server/maintenance.js";
import { defaultMaintenanceBudgets, MaintenanceError } from "../src/shared/maintenance.js";
import { linuxProcessStart } from "../src/server/process-owner-linux-identity.js";

function fixture(mode = "normal") {
  const root = mkdtempSync(join(tmpdir(), "axiom-pi-package-")), agentDir = join(root, "pi"); mkdirSync(agentDir);
  const fake = join(root, "fake-npm.mjs");
  writeFileSync(fake, `import fs from 'node:fs'; import path from 'node:path'; import {spawn} from 'node:child_process';
const args=process.argv.slice(2), root=${JSON.stringify(root)}, mode=${JSON.stringify(mode)};
if(args[0]==='root') { console.log(path.join(root,'unused-global')); process.exit(0); }
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args)+'\\n');
const prefix=args[args.indexOf('--prefix')+1], pkg=path.join(prefix,'node_modules','fixture');
if(args[0]==='uninstall') {
 fs.writeFileSync(path.join(root,'settings-at-remove.json'),fs.readFileSync(path.join(root,'pi','settings.json')));
 if(mode==='remove-fails-once' && !fs.existsSync(path.join(root,'allow-remove'))) process.exit(1);
}
if(mode==='hang' || mode==='crash' || mode==='orphan') { const leaf=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); if(mode==='orphan') leaf.unref(); fs.writeFileSync(path.join(root,'pids.json'),JSON.stringify([process.pid,leaf.pid])); while(!fs.existsSync(path.join(root,'captured'))) await new Promise(r=>setTimeout(r,10)); if(mode==='crash') { process.kill(process.ppid,'SIGKILL'); setInterval(()=>{},1000); } else if(mode==='hang') setInterval(()=>{},1000); }
if(mode!=='hang' && mode!=='crash') {
 if(mode==='slow') { fs.writeFileSync(path.join(root,'started'),'1'); await new Promise(r=>setTimeout(r,9000)); }
 if(args[0]==='uninstall') fs.rmSync(pkg,{recursive:true,force:true});
 else { fs.mkdirSync(pkg,{recursive:true}); fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:mode==='wrong-name'?'impostor':'fixture',version:mode==='wrong-version'?'9.0.0':'1.2.3'})); }
}
`);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ npmCommand: [process.execPath, fake] }));
  return { root, agentDir, fake, request: { action: "install" as const, source: "npm:fixture@latest", cwd: root, agentDir, local: false } };
}
async function until(check: () => boolean) { const end = Date.now() + (process.platform === "linux" ? 90000 : 15000); while (!check()) { assert.ok(Date.now() < end, "fixture did not become ready"); await new Promise(r => setTimeout(r, 30)); } }
type OwnedIdentity = { pid: number; start?: string };
async function captureInstaller(f: ReturnType<typeof fixture>): Promise<OwnedIdentity[]> {
  let pids: number[] = [];
  await until(() => { try { pids = JSON.parse(readFileSync(join(f.root, "pids.json"), "utf8")); return pids.length === 2; } catch { return false; } });
  let identities: OwnedIdentity[];
  if (process.platform === "linux") {
    const journal = JSON.parse(readFileSync(join(f.agentDir, "npm.axiom-operation.unconfirmed.json"), "utf8"));
    assert.equal(journal.state, "armed");
    assert.equal(linuxProcessStart(journal.identity.initPid), journal.identity.startTime);
    identities = [];
    const visit = (pid: number) => {
      identities.push({ pid, start: linuxProcessStart(pid) });
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
      for (const child of children.split(/\s+/).filter(Boolean)) visit(Number(child));
    };
    visit(journal.identity.initPid);
    // Match the fixture's internal PIDs to the actually observed outer tree.
    const internal = identities.map(item => readFileSync(`/proc/${item.pid}/status`, "utf8").match(/^NSpid:\s+([^\n]+)$/m)?.[1].trim().split(/\s+/).at(-1));
    for (const pid of pids) assert.ok(internal.includes(String(pid)), `installer PID ${pid} was not found inside its owned namespace`);
    assert.ok(identities.length >= 4);
  } else identities = pids.map(pid => ({ pid }));
  writeFileSync(join(f.root, "captured"), "1");
  return identities;
}
function assertInstallerGone(identities: OwnedIdentity[]) {
  for (const item of identities) {
    if (process.platform === "linux") {
      try { assert.notEqual(linuxProcessStart(item.pid), item.start, `owned process ${item.pid} still exists`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    } else assert.throws(() => process.kill(item.pid, 0), "installer descendants must have exited");
  }
}

test("resource loader skips missing/mismatched packages and remote temporary sources on every reload", async () => {
  const f = fixture();
  try {
    const installed = join(f.agentDir, "npm", "node_modules", "fixture"); mkdirSync(join(installed, "skills", "available"), { recursive: true });
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "fixture", version: "1.2.3" }));
    writeFileSync(join(installed, "skills", "available", "SKILL.md"), "---\nname: available\ndescription: installed fixture\n---\n");
    const settingsManager = SettingsManager.inMemory({ npmCommand: [process.execPath, f.fake], packages: ["npm:fixture@1.2.3", "npm:missing@1.0.0", "git:github.com/fixture/missing"] });
    let warnings = 0;
    const loader = createInstalledResourceLoader({ cwd: f.root, agentDir: f.agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: ["git:github.com/fixture/temporary"] }, () => warnings++);
    await loader.reload(); assert.equal(loader.getSkills().skills.some(s => s.filePath.startsWith(installed) && s.name === "available"), true);
    settingsManager.setPackages(["npm:fixture@2.0.0"]);
    await loader.reload(); assert.equal(loader.getSkills().skills.some(s => s.filePath.startsWith(installed)), false);
    assert.ok(warnings >= 2); assert.equal(existsSync(join(f.root, "calls.jsonl")), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("pi package child installs and removes in the requested scope and returns actual version", async () => {
  const f = fixture();
  const storageModule = await import(new URL("./core/settings-manager.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
  const prototype = storageModule.FileSettingsStorage.prototype, acquire = prototype.acquireLockSyncWithRetry;
  let protectedCommits = 0;
  prototype.acquireLockSyncWithRetry = function(path: string) {
    const release = acquire.call(this, path);
    const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    return () => {
      try {
        if (path.endsWith("settings.json") && existsSync(path) && readFileSync(path, "utf8") !== before) {
          const ownerPath = path === join(f.agentDir, "settings.json") ? join(f.agentDir, "npm.axiom-operation.unconfirmed.json") : join(f.root, ".pi", "npm.axiom-operation.unconfirmed.json");
          const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
          assert.equal(owner.hostPid, process.pid, "parent commit must retain its durable ownership gate");
          assert.equal(owner.state, "armed"); protectedCommits++;
        }
      } finally { release(); }
    };
  };
  try {
    const result = await runPiPackage(f.request, new AbortController().signal);
    assert.equal(result.version, "1.2.3"); assert.ok(existsSync(result.installedPath!));
    assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, ["npm:fixture@latest"]);
    await runPiPackage({ ...f.request, action: "remove" }, new AbortController().signal);
    assert.equal(existsSync(result.installedPath!), false);
    assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, []);
    const project = await runPiPackage({ ...f.request, local: true }, new AbortController().signal);
    assert.ok(project.installedPath!.startsWith(join(f.root, ".pi")));
    assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, []);
    assert.equal(protectedCommits, 3);
    assert.equal(existsSync(join(f.agentDir, "npm.axiom-operation.unconfirmed.json")), false);
    assert.equal(existsSync(join(f.root, ".pi", "npm.axiom-operation.unconfirmed.json")), false);
  } finally { prototype.acquireLockSyncWithRetry = acquire; rmSync(f.root, { recursive: true, force: true }); }
});

test("failed package removal withdraws references before npm and can resume after rediscovery", async () => {
  const f = fixture("remove-fails-once"), signal = new AbortController().signal, settingsPath = join(f.agentDir, "settings.json");
  try {
    const installed = await runPiPackage(f.request, signal);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    writeFileSync(settingsPath, JSON.stringify({ ...settings, packages: [...settings.packages, { source: "npm:other@2.0.0", skills: [] }], editor: "keep" }));
    await assert.rejects(runPiPackage({ ...f.request, action: "remove" }, signal));
    const remaining = [{ source: "npm:other@2.0.0", skills: [] }];
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, "settings-at-remove.json"), "utf8")).packages, remaining);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, remaining);
    assert.ok(existsSync(installed.installedPath!));
    const [pending] = listPiPackageRemovals(f.request); assert.equal(pending.source, f.request.source);
    await assert.rejects(runPiPackage(f.request, signal), /卸载尚未完成/);
    writeFileSync(join(f.root, "allow-remove"), "1");
    await runPiPackage({ ...f.request, source: pending.source, fromSettings: true, action: "remove" }, signal);
    assert.deepEqual(listPiPackageRemovals(f.request), []);
    assert.equal(existsSync(installed.installedPath!), false);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, remaining);
    assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).editor, "keep");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("cancelled uninstall retains discoverable cleanup intent and does not restore references", async () => {
  const f = fixture("hang"), controller = new AbortController(), settingsPath = join(f.agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  writeFileSync(settingsPath, JSON.stringify({ ...settings, packages: [f.request.source] }));
  const installed = join(f.agentDir, "npm", "node_modules", "fixture");
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "fixture", version: "1.2.3" }));
  const pending = runPiPackage({ ...f.request, action: "remove" }, controller.signal); void pending.catch(() => {});
  try {
    const identities = await captureInstaller(f);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, []);
    controller.abort(new MaintenanceError("cancelled", "cancel uninstall"));
    await assert.rejects(pending, (error: unknown) => error instanceof MaintenanceError && error.code === "cancelled");
    assert.equal(listPiPackageRemovals(f.request).length, 1);
    assertInstallerGone(identities);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, []);
  } finally { controller.abort(); await pending.catch(() => {}); rmSync(f.root, { recursive: true, force: true }); }
});

test("pi package cancellation waits for installer and its descendant to exit", async () => {
  const f = fixture("hang"), controller = new AbortController();
  const pending = runPiPackage(f.request, controller.signal); void pending.catch(() => {});
  try {
    const identities = await captureInstaller(f);
    controller.abort(new MaintenanceError("cancelled", "cancel fixture"));
    await assert.rejects(pending, (e: unknown) => e instanceof MaintenanceError && e.code === "cancelled");
    assertInstallerGone(identities);
    assert.equal(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, undefined);
  } finally { controller.abort(); await pending.catch(() => {}); rmSync(f.root, { recursive: true, force: true }); }
});

test("pi package install budget can be extended while the installer is running", async () => {
  const f = fixture("slow"), controller = new AbortController(), service = new MaintenanceService(f.root);
  const budgets = { ...defaultMaintenanceBudgets, installMs: 8000, totalMs: process.platform === "linux" ? 180000 : 30000 };
  const pending = service.run({ id: "extend", resource: "pi-package", label: "fixture", action: "install", cancel: true, params: { budgets } }, controller, async () => {
    const operation = runPiPackage(f.request, controller.signal); void operation.catch(() => {});
    try {
      await until(() => existsSync(join(f.root, "started")));
      const { maintenancePhase } = await import("../src/server/maintenance.js"); maintenancePhase("installing");
      return await operation;
    } catch (error) { controller.abort(error); await operation.catch(() => {}); throw error; }
  }); void pending.catch(() => {});
  try {
    await until(() => service.snapshot().tasks[0]?.phase === "installing");
    service.command({ requestId: "extend-budget", op: "maintenance.extend", params: { id: "extend", budgets: { ...budgets, installMs: 20000 } } });
    assert.equal((await pending).version, "1.2.3"); assert.equal(service.snapshot().tasks[0].status, "succeeded");
  } finally { controller.abort(); await pending.catch(() => {}); service.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("pi package rejects escaping names and linked npm/git parents before running installers", async () => {
  const f = fixture();
  try {
    await assert.rejects(runPiPackage({ ...f.request, source: "npm:../../../external" }, new AbortController().signal));
    const external = join(f.root, "external"); mkdirSync(external); writeFileSync(join(external, "keep"), "preserve");
    mkdirSync(join(f.agentDir, "npm")); symlinkSync(external, join(f.agentDir, "npm", "node_modules"), "junction");
    await assert.rejects(runPiPackage(f.request, new AbortController().signal), /链接/);
    mkdirSync(join(f.agentDir, "git")); symlinkSync(external, join(f.agentDir, "git", "github.com"), "junction");
    await assert.rejects(runPiPackage({ ...f.request, action: "remove", source: "git:github.com/fixture/repo" }, new AbortController().signal), /链接/);
    assert.equal(existsSync(join(f.root, "calls.jsonl")), false);
    assert.equal(readFileSync(join(external, "keep"), "utf8"), "preserve");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("parent settings commit merges unrelated declarations and refuses same-package conflicts", async () => {
  const f = fixture(), settingsPath = join(f.agentDir, "settings.json"), signal = new AbortController().signal;
  try {
    const plan = piPackagePlan(f.request), initial = JSON.parse(readFileSync(settingsPath, "utf8"));
    writeFileSync(settingsPath, JSON.stringify({ ...initial, packages: ["npm:other@2.0.0"], editor: "keep" }));
    await commitPiPackage(f.request, plan.initialIdentity, signal);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, ["npm:other@2.0.0", "npm:fixture@latest"]);
    const before = piPackagePlan(f.request);
    writeFileSync(settingsPath, JSON.stringify({ ...initial, packages: ["npm:fixture@9.0.0"] }));
    const changed = readFileSync(settingsPath, "utf8");
    await assert.rejects(commitPiPackage(f.request, before.initialIdentity, signal), /其他操作修改/);
    assert.equal(readFileSync(settingsPath, "utf8"), changed);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("local package paths are stored and matched relative to their settings scope", async () => {
  const f = fixture(), signal = new AbortController().signal;
  try {
    mkdirSync(join(f.root, "local-package"));
    const request = { ...f.request, source: "./local-package" }, plan = piPackagePlan(request);
    await commitPiPackage(request, plan.initialIdentity, signal);
    const stored = JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages[0];
    const removal = { ...request, action: "remove" as const, source: stored, fromSettings: true };
    const next = piPackagePlan(removal);
    assert.equal(next.directory, join(f.root, "local-package"));
    await commitPiPackage(removal, next.initialIdentity, signal);
    assert.deepEqual(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, []);
    assert.ok(existsSync(join(f.root, "local-package")));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("package operation locks serialize one npm prefix and retain unconfirmed cleanup barriers", async () => {
  const f = fixture();
  try {
    const held = await lockPiPackage(f.request);
    try {
      await assert.rejects(lockPiPackage({ ...f.request, source: "npm:other" }), /同一安装目录正在维护/);
      const project = await lockPiPackage({ ...f.request, local: true }); project.release();
      held.unconfirmed();
    } finally { held.release(); }
    await assert.rejects(runPiPackage(f.request, new AbortController().signal), /退出未确认/);
    assert.equal(existsSync(join(f.root, "calls.jsonl")), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const mode of ["wrong-name", "wrong-version"]) test(`pi package ${mode} is not committed`, async () => {
  const f = fixture(mode);
  try {
    await assert.rejects(runPiPackage({ ...f.request, source: "npm:fixture@1.2.3" }, new AbortController().signal));
    assert.equal(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, undefined);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const mode of ["crash", "orphan"]) test(`pi package ${mode} cleans descendants before returning`, async () => {
  const f = fixture(mode), controller = new AbortController();
  const pending = runPiPackage(f.request, controller.signal); void pending.catch(() => {});
  try {
    const identities = await captureInstaller(f);
    if (mode === "crash") await assert.rejects(pending); else assert.equal((await pending).version, "1.2.3");
    assertInstallerGone(identities);
    if (mode === "crash") assert.equal(JSON.parse(readFileSync(join(f.agentDir, "settings.json"), "utf8")).packages, undefined);
  } finally { controller.abort(); await pending.catch(() => {}); rmSync(f.root, { recursive: true, force: true }); }
});
