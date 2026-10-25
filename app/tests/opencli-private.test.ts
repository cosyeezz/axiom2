import assert from "node:assert/strict";
import { test } from "node:test";
import fs, { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, delimiter } from "node:path";
import { randomUUID } from "node:crypto";
import { OpenCliService } from "../src/server/integrations/opencli.js";
import { applyOpenCliEnvironment, openCliConfigPath, openCliEnvironment, openCliCommandDirectory, readOpenCliConfig } from "../src/server/integrations/opencli-runtime.js";
import { openCliResources } from "../src/server/integrations/opencli-resources.js";
import { openCliFixture } from "./fixtures/opencli.js";
const call = (service: OpenCliService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle(s: OpenCliService) { const until = Date.now() + 5000; while (s.snapshot().job?.running) { assert.ok(Date.now() < until); await turn(); } return s.snapshot(); }

test("OpenCLI: migration preserves external files and old versions, reload replaces environment", async () => {
  const f = openCliFixture(); f.install("1.8.8");
  const s = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm, undefined, undefined, f.runtime);
  try {
    await call(s, "opencli.check"); await settle(s);
    await call(s, "opencli.save", { ...s.snapshot().settings, revision: "" });
    await call(s, "opencli.install", { version: "1.8.8" }); assert.equal((await settle(s)).job?.error, undefined);
    const first = readOpenCliConfig(f.root)!;
    assert.equal(first.migration?.packageRoot, f.packageRoot); assert.equal(first.migration?.externalFilesRetained, true);
    assert.ok(first.directory); assert.notEqual(first.packageRoot, f.packageRoot); assert.ok(existsSync(f.packageRoot));
    f.setVersion("1.8.9"); await call(s, "opencli.check"); await settle(s);
    await call(s, "opencli.install", { version: "1.8.9" }); assert.equal((await settle(s)).job?.error, undefined);
    const second = readOpenCliConfig(f.root)!;
    assert.notEqual(first.packageRoot, second.packageRoot); assert.ok(existsSync(first.packageRoot));
    const base = { PATH: "base", OPENCLI_PROFILE: "outside", OPENCLI_WINDOW: "foreground" };
    const env = { ...base, KEEP: "untouched" };
    applyOpenCliEnvironment(env, openCliEnvironment(first, base)); applyOpenCliEnvironment(env, openCliEnvironment(second, base));
    assert.equal(env.PATH.split(delimiter)[0], openCliCommandDirectory(second)); assert.ok(!env.PATH.includes(openCliCommandDirectory(first))); assert.equal(env.KEEP, "untouched");
    applyOpenCliEnvironment(env, base); assert.equal(env.PATH, "base"); assert.equal(env.OPENCLI_PROFILE, "outside");
    const offline = new OpenCliService(f.root, () => {}, f.execute, () => { throw Error("npm missing"); }, undefined, undefined, f.runtime);
    try { await call(offline, "opencli.refresh"); assert.equal((await settle(offline)).version, "1.8.9"); await call(offline, "opencli.doctor"); assert.ok((await settle(offline)).diagnostic); } finally { await offline.close(); }
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: candidate cannot publish over configuration changes or with missing disabled skills", async () => {
  const f = openCliFixture(); f.install("1.8.8"); let breakSkills = false;
  const s = new OpenCliService(f.root, () => {}, async (args, options) => {
    const result = await f.execute(args, options);
    if (breakSkills && args[1] === "install") rmSync(join(args[args.indexOf("--prefix") + 1], "node_modules", "@jackwener", "opencli", "skills", "opencli-browser"), { recursive: true });
    return result;
  }, f.locateNpm, undefined, undefined, f.runtime);
  try {
    await call(s, "opencli.check"); await settle(s);
    await call(s, "opencli.save", { ...s.snapshot().settings, enabled: false, revision: "" });
    const original = readOpenCliConfig(f.root)!;
    let release!: () => void; f.hold(new Promise<void>(resolve => { release = resolve; }));
    await call(s, "opencli.install", { version: "1.8.8" }); await turn();
    const concurrent = { ...original, revision: randomUUID(), profile: "other-window" };
    writeFileSync(openCliConfigPath(f.root), JSON.stringify(concurrent)); release();
    assert.match((await settle(s)).job!.error!, /配置已变化/); assert.deepEqual(readOpenCliConfig(f.root), concurrent);
    await call(s, "opencli.refresh"); await settle(s); breakSkills = true;
    await call(s, "opencli.install", { version: "1.8.8" }); assert.match((await settle(s)).job!.error!, /技能缺失/);
    assert.deepEqual(readOpenCliConfig(f.root), concurrent); assert.ok(existsSync(f.packageRoot));
    assert.deepEqual(readdirSync(join(f.root, "integrations", "opencli", "versions")), []);
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: uninstall uses admission, preserves external files and prevents automatic global reconnection", async () => {
  const f = openCliFixture(); f.install("1.8.8"); let blocked = true;
  const s = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm, undefined, async work => { if (blocked) throw Error("active worker"); return work(); }, f.runtime);
  try {
    await call(s, "opencli.check"); await settle(s);
    await call(s, "opencli.install", { version: "1.8.8" }); await settle(s);
    const managed = readOpenCliConfig(f.root)!;
    await assert.rejects(call(s, "opencli.uninstall", { revision: s.snapshot().revision }), { code: "CONFIRM_REQUIRED" });
    await call(s, "opencli.uninstall", { confirm: true, revision: s.snapshot().revision }); assert.match((await settle(s)).job!.error!, /active worker/);
    assert.deepEqual(readOpenCliConfig(f.root), managed); assert.ok(existsSync(managed.packageRoot));
    blocked = false; await call(s, "opencli.uninstall", { confirm: true, revision: s.snapshot().revision }); assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(readOpenCliConfig(f.root)!.detached, true); assert.equal(existsSync(managed.packageRoot), false); assert.ok(existsSync(f.packageRoot));
    await call(s, "opencli.refresh"); assert.equal((await settle(s)).version, undefined); assert.equal(openCliResources(f.root, f.root).managed, false);
    await call(s, "opencli.install", { version: "1.8.8" }); assert.equal((await settle(s)).version, "1.8.8");
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenCLI: failed file removal is persisted before deletion and retried after restart", async t => {
  const f = openCliFixture(); let s = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm, undefined, undefined, f.runtime);
  const remove = fs.rmSync; let fail = false, target = "";
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (fail && String(path) === target) { assert.equal(readOpenCliConfig(f.root)!.detached, true); throw Error("busy"); }
    return remove(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    await call(s, "opencli.check"); await settle(s); await call(s, "opencli.install", { version: "1.8.8" }); await settle(s);
    target = join(f.root, "integrations", "opencli", "versions", readOpenCliConfig(f.root)!.directory!); fail = true;
    await call(s, "opencli.uninstall", { confirm: true, revision: s.snapshot().revision }); assert.match((await settle(s)).job!.error!, /部分文件/);
    assert.equal(s.snapshot().removalPending, true); await s.close(); fail = false;
    s = new OpenCliService(f.root, () => {}, f.execute, f.locateNpm, undefined, undefined, f.runtime);
    await call(s, "opencli.uninstall", { confirm: true, revision: s.snapshot().revision }); assert.equal((await settle(s)).job?.error, undefined);
    assert.equal(existsSync(target), false); assert.equal(readOpenCliConfig(f.root)!.removalPending, undefined);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const defect of ["linked-package", "wrong-shim", "wrong-skill"]) test(`OpenCLI: rejects ${defect} before switching its current installation`, async () => {
  const f = openCliFixture(); f.install("1.8.8");
  const s = new OpenCliService(f.root, () => {}, async (args, options) => {
    const result = await f.execute(args, options);
    if (args[1] === "install") {
      const prefix = args[args.indexOf("--prefix") + 1], pkg = join(prefix, "node_modules", "@jackwener", "opencli"), bin = join(prefix, "node_modules", ".bin");
      if (defect === "linked-package") { fs.rmSync(pkg, { recursive: true }); fs.symlinkSync(f.packageRoot, pkg, process.platform === "win32" ? "junction" : "dir"); }
      else if (defect === "wrong-shim") {
        if (process.platform === "win32") fs.writeFileSync(join(bin, "opencli.cmd"), "@echo 0.0.0\r\n");
        else { const wrong = join(prefix, "wrong.js"); fs.writeFileSync(wrong, "#!/usr/bin/env node\nconsole.log('0.0.0');\n"); fs.chmodSync(wrong, 0o755); fs.rmSync(join(bin, "opencli")); fs.symlinkSync(wrong, join(bin, "opencli")); }
      } else fs.writeFileSync(join(pkg, "skills", "opencli-browser", "SKILL.md"), "---\nname: unrelated\ndescription: bad fixture\n---\n");
    }
    return result;
  }, f.locateNpm, undefined, undefined, f.runtime);
  try {
    await call(s, "opencli.check"); await settle(s); await call(s, "opencli.save", { ...s.snapshot().settings, enabled: false, revision: "" });
    const original = readOpenCliConfig(f.root);
    await call(s, "opencli.install", { version: "1.8.8" }); assert.ok((await settle(s)).job?.error);
    assert.deepEqual(readOpenCliConfig(f.root), original); assert.ok(existsSync(f.packageRoot));
    assert.deepEqual(readdirSync(join(f.root, "integrations", "opencli", "versions")), []);
  } finally { await s.close(); rmSync(f.root, { recursive: true, force: true }); }
});
