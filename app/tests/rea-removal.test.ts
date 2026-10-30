import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { atomicReaJson, readReaConfig, reaConfigPath, reaDirectory, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { removeRea } from "../src/server/integrations/rea-removal.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { beginBuiltinOperation } from "../src/server/integrations/builtin-operation.js";
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "axiom-rea-remove-"));
  const version = `v6.7.0-${randomUUID()}`, engine = `java-${randomUUID()}`;
  const program = join(reaDirectory(root), "versions", version), directory = join(reaDirectory(root), "engines", engine), path = join(directory, "jdk");
  fs.mkdirSync(program, { recursive: true }); fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(join(program, "sentinel"), "program"); fs.writeFileSync(join(path, "sentinel"), "engine");
  const config: ReaConfig = { format: 1, revision: randomUUID(), enabled: true, skillInstalled: false, mcpInstalled: true, installation: { version: "6.7.0", directory: version }, engines: { java: path }, managedEngines: { java: [{ directory: engine, path }] } };
  atomicReaJson(reaConfigPath(root), config);
  return { root, program, directory, path, config, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test("REA program removal preserves engine installations and user choices", () => {
  const f = fixture();
  try {
    removeRea(f.root, f.config.revision);
    const next = readReaConfig(f.root);
    assert.equal(next.installation, undefined); assert.equal(next.removalPending, undefined);
    assert.equal(next.enabled, true); assert.equal(next.skillInstalled, false); assert.equal(next.mcpInstalled, true);
    assert.deepEqual(next.engines, f.config.engines); assert.deepEqual(next.managedEngines, f.config.managedEngines);
    assert.equal(fs.existsSync(f.program), false); assert.ok(fs.existsSync(f.path));
  } finally { f.cleanup(); }
});
for (const external of [false, true]) test(`REA engine removal preserves unrelated files and ${external ? 'external binding' : 'clears owned binding'}`, () => {
  const f = fixture(), legacy = join(reaDirectory(f.root), "engines", `java-${randomUUID()}`), externalPath = join(f.root, "external-jdk");
  fs.mkdirSync(legacy); fs.mkdirSync(externalPath); fs.writeFileSync(join(externalPath, "sentinel"), "outside");
  try {
    if (external) atomicReaJson(reaConfigPath(f.root), { ...f.config, engines: { java: externalPath } });
    removeRea(f.root, f.config.revision, "java");
    const next = readReaConfig(f.root);
    assert.equal(next.engines?.java, external ? externalPath : undefined); assert.equal(next.managedEngines?.java, undefined);
    assert.ok(fs.existsSync(f.program)); assert.ok(fs.existsSync(legacy)); assert.equal(fs.existsSync(f.directory), false);
    assert.equal(fs.readFileSync(join(externalPath, "sentinel"), "utf8"), "outside");
  } finally { f.cleanup(); }
});
test("REA legacy absolute engine paths do not grant deletion ownership", () => {
  const f = fixture();
  try {
    atomicReaJson(reaConfigPath(f.root), { ...f.config, managedEngines: undefined });
    const before = fs.readFileSync(reaConfigPath(f.root), "utf8");
    assert.throws(() => removeRea(f.root, f.config.revision, "java"), { code: "EXTERNAL_INSTALLATION" });
    assert.equal(fs.readFileSync(reaConfigPath(f.root), "utf8"), before); assert.ok(fs.existsSync(f.path));
  } finally { f.cleanup(); }
});
test("REA removal refuses a linked parent before revoking configuration", () => {
  const f = fixture(), actual = join(f.root, "engine-target"), parent = join(reaDirectory(f.root), "engines");
  fs.renameSync(parent, actual); fs.symlinkSync(actual, parent, process.platform === "win32" ? "junction" : "dir");
  try {
    const before = fs.readFileSync(reaConfigPath(f.root), "utf8");
    assert.throws(() => removeRea(f.root, f.config.revision, "java"), /托管安装目录/);
    assert.equal(fs.readFileSync(reaConfigPath(f.root), "utf8"), before); assert.ok(fs.existsSync(f.path));
  } finally { f.cleanup(); }
});
test("REA engine deletion failure preserves pending cleanup and revokes the owned binding", t => {
  const f = fixture(), rm = fs.rmSync;
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (String(path) === f.directory) { assert.equal(readReaConfig(f.root).engines?.java, undefined); throw Object.assign(Error("busy"), { code: "EBUSY" }); }
    return rm(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    assert.throws(() => removeRea(f.root, f.config.revision, "java"), /部分程序文件/);
    mock.mock.restore(); syncBuiltinESMExports();
    const pending = readReaConfig(f.root); assert.equal(pending.removalPending?.length, 1); assert.equal(pending.managedEngines?.java, undefined);
    removeRea(f.root, pending.revision, "java");
    assert.equal(readReaConfig(f.root).removalPending, undefined); assert.equal(fs.existsSync(f.directory), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); f.cleanup(); }
});
for (const replaced of [false, true]) test(`global engine removal ${replaced ? "rejects a substituted directory" : "accepts the original directory"} from a scoped installation`, () => {
  const f = fixture();
  const install = beginBuiltinOperation(f.root, "rea", undefined, "java");
  install.trackDirectory(f.directory); install.finish(); install.close();
  const before = fs.readFileSync(reaConfigPath(f.root), "utf8"), moved = join(f.root, "original-installation");
  if (replaced) {
    fs.renameSync(f.directory, moved); fs.mkdirSync(f.directory);
    fs.writeFileSync(join(f.directory, "sentinel"), "replacement must survive");
  }
  const removal = beginBuiltinOperation(f.root, "rea");
  try {
    if (replaced) {
      assert.throws(() => removal.run(() => removeRea(f.root, f.config.revision, "java")), { code: "stop-unconfirmed" });
      assert.equal(fs.readFileSync(reaConfigPath(f.root), "utf8"), before);
      assert.equal(fs.readFileSync(join(f.directory, "sentinel"), "utf8"), "replacement must survive");
      assert.ok(fs.existsSync(join(moved, "jdk", "sentinel")));
    } else {
      removal.run(() => removeRea(f.root, f.config.revision, "java"));
      assert.equal(fs.existsSync(f.directory), false); assert.equal(readReaConfig(f.root).managedEngines?.java, undefined);
    }
    removal.finish();
  } finally { removal.close(); f.cleanup(); }
});

test("REA uninstall runs without server-side confirmation or revision and keeps engines", async () => {
  const f = fixture(); let called = false;
  const s = new ReaService(f.root, () => {}, { removal: async work => { called = true; return work(); } });
  const command = (params: Record<string, unknown>) => s.command({ op: "rea.uninstall", requestId: randomUUID(), params });
  try {
    // Component standard: confirmation happens in the client dialog only.
    await command({ revision: "stale" });
    const deadline = Date.now() + 5000;
    while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await new Promise<void>(done => setImmediate(done)); }
    assert.equal(called, true); assert.equal(s.snapshot().job?.error, undefined); assert.equal(s.snapshot().version, undefined);
    assert.equal(fs.existsSync(f.program), false); assert.ok(fs.existsSync(f.path));
  } finally { await s.close(); f.cleanup(); }
});
