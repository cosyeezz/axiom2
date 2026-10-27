import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { beginBuiltinOperation } from "../src/server/integrations/builtin-operation.js";
import { atomicReaJson, reaConfigPath, readReaConfig, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { reaDownloadPlan, clearReaDownloads, type DownloadId } from "../src/server/integrations/rea-download-cleanup.js";
import { reaRemovalPlan } from "../src/server/integrations/rea-removal.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { cleanupRows, cleanupProgress, acceptedCleanupJob } from "../src/client/pages/desktop-cleanup.js";

function fixture(proof = true) {
  const root = fs.mkdtempSync(join(tmpdir(), "axiom-rea-download-cleanup-"));
  const config: ReaConfig = { format: 1, revision: randomUUID(), enabled: false, skillInstalled: false, downloads: {}, engines: { ghidra: join(root, "external", "ghidra") } };
  const paths = {} as Record<DownloadId, string>;
  for (const id of ["ghidra", "hopper"] as const) {
    const directory = `${id}-${randomUUID()}`, filename = id === "ghidra" ? "package.zip" : "package.dmg";
    const path = paths[id] = join(root, "integrations/rea/downloads", directory);
    fs.mkdirSync(path, { recursive: true }); fs.writeFileSync(join(path, filename), "fixture");
    fs.writeFileSync(join(path, "source.json"), JSON.stringify({ installed: false, version: "1.0.0", format: id === "ghidra" ? "zip" : "dmg", url: id === "ghidra" ? "https://github.com/fixture/package.zip" : "https://www.hopperapp.com/downloader/public/Hopper-1.0.0-demo.dmg", sha256: "a".repeat(64), sha1: "b".repeat(40), size: 7 }));
    config.downloads![id] = { directory, filename, version: "1.0.0" };
    if (proof) { const install = beginBuiltinOperation(root, "rea", undefined, id); install.trackDirectory(path); install.finish(); install.close(); }
  }
  atomicReaJson(reaConfigPath(root), config);
  assert.deepEqual(readReaConfig(root), config, "cleanup fixtures must pass native configuration validation");
  const clean = (id: DownloadId, digest?: string) => {
    const op = beginBuiltinOperation(root, "rea");
    try {
      op.run(() => { const fresh = readReaConfig(root); clearReaDownloads(root, id, fresh.revision, digest ?? reaDownloadPlan(root, fresh, id, op.removalDirectories()).scope.revision); });
    } finally { try { op.finish(); } finally { op.close(); } }
  };
  return { root, paths, config, clean, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
for (const id of ["ghidra", "hopper"] as const) test(`clears only registered ${id} download and keeps unknown directories and engines`, () => {
  const f = fixture(), unknown = join(f.root, "integrations/rea/downloads", `${id}-${randomUUID()}`);
  fs.mkdirSync(unknown); fs.writeFileSync(join(unknown, "package"), "private installer copy");
  try {
    f.clean(id); const config = readReaConfig(f.root);
    assert.equal(fs.existsSync(f.paths[id]), false); assert.equal(config.downloads?.[id], undefined);
    assert.ok(fs.existsSync(unknown)); assert.ok(fs.existsSync(f.paths[id === "hopper" ? "ghidra" : "hopper"]));
    assert.deepEqual(config.engines, f.config.engines); assert.equal(config.enabled, false); assert.equal(config.downloadRemovalPending, undefined);
  } finally { f.close(); }
});
for (const mode of ["unknown", "hardlink", "symlink", "replacement", "no-proof", "private-copy"] as const) test(`preserves download and configuration on ${mode}`, () => {
  const f = fixture(mode !== "no-proof"), path = f.paths.ghidra;
  try {
    if (mode === "unknown") fs.writeFileSync(join(path, "keep"), "user file");
    if (mode === "hardlink" || mode === "symlink") {
      const outside = join(f.root, "outside"); fs.writeFileSync(outside, "outside"); fs.rmSync(join(path, "package.zip"));
      if (mode === "hardlink") fs.linkSync(outside, join(path, "package.zip")); else fs.symlinkSync(outside, join(path, "package.zip"));
    }
    if (mode === "replacement") { fs.renameSync(path, path + ".old"); fs.cpSync(path + ".old", path, { recursive: true }); }
    if (mode === "private-copy") {
      const file = join(path, "source.json"); fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), installerCopy: true }));
    }
    const before = fs.readFileSync(reaConfigPath(f.root), "utf8");
    assert.throws(() => f.clean("ghidra")); assert.ok(fs.existsSync(path)); assert.equal(fs.readFileSync(reaConfigPath(f.root), "utf8"), before);
  } finally { f.close(); }
});
test("read-only snapshot disables unproven download without adopting its inode", async () => {
  const f = fixture(false), service = new ReaService(f.root, () => {});
  try {
    const before = fs.readFileSync(reaConfigPath(f.root), "utf8");
    const row = cleanupRows({ rea: service.snapshot() }).find(row => row.id === "download:ghidra")!;
    assert.equal(row.available, false); assert.match(row.warning!, /原始维护归属证明/);
    assert.equal(fs.existsSync(join(f.root, "integrations/.maintenance")), false);
    assert.equal(fs.readFileSync(reaConfigPath(f.root), "utf8"), before);
    assert.ok(fs.existsSync(join(f.paths.ghidra, "package.zip")));
  } finally { await service.close(); f.close(); }
});
test("mismatched scoped proof disables only its own download", async () => {
  const f = fixture();
  fs.renameSync(f.paths.ghidra, f.paths.ghidra + ".old"); fs.cpSync(f.paths.ghidra + ".old", f.paths.ghidra, { recursive: true });
  const service = new ReaService(f.root, () => {});
  try {
    const rows = cleanupRows({ rea: service.snapshot() });
    assert.equal(rows.find(row => row.id === "download:ghidra")!.available, false);
    assert.equal(rows.find(row => row.id === "download:hopper")!.available, true);
  } finally { await service.close(); f.close(); }
});
test("config pending alone never authorizes directory adoption", () => {
  const f = fixture(false);
  try {
    const next = { ...f.config, downloads: {}, downloadRemovalPending: [f.config.downloads!.ghidra!.directory] };
    atomicReaJson(reaConfigPath(f.root), next);
    assert.throws(() => f.clean("ghidra"));
    assert.deepEqual(readReaConfig(f.root), next); assert.ok(fs.existsSync(join(f.paths.ghidra, "package.zip")));
  } finally { f.close(); }
});
test("empty pending directory resumes with global proof after source metadata is gone", async t => {
  const f = fixture(), rmdir = fs.rmdirSync;
  const mock = t.mock.method(fs, "rmdirSync", ((path, ...args) => {
    if (String(path) === f.paths.ghidra) throw Object.assign(Error("busy directory"), { code: "EBUSY" });
    return (rmdir as Function)(path, ...args);
  }) as typeof fs.rmdirSync); syncBuiltinESMExports();
  try {
    assert.throws(() => f.clean("ghidra"), /busy directory/);
    mock.mock.restore(); syncBuiltinESMExports();
    assert.deepEqual(fs.readdirSync(f.paths.ghidra), []);
    // The global operation persisted the original proof before revoking config.
    fs.rmSync(join(f.root, "integrations/.maintenance/rea/engines/ghidra/current.json"));
    const service = new ReaService(f.root, () => {});
    try { assert.equal(cleanupRows({ rea: service.snapshot() }).find(row => row.id === "download:ghidra")!.available, true); }
    finally { await service.close(); }
    f.clean("ghidra"); assert.equal(fs.existsSync(f.paths.ghidra), false);
    assert.equal(readReaConfig(f.root).downloadRemovalPending, undefined);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); f.close(); }
});
test("confirmed package identity rejects an in-place changed file", () => {
  const f = fixture();
  try {
    const digest = reaDownloadPlan(f.root, f.config, "ghidra").scope.revision;
    fs.writeFileSync(join(f.paths.ghidra, "package.zip"), "changed");
    assert.throws(() => f.clean("ghidra", digest)); assert.ok(fs.existsSync(f.paths.ghidra));
    assert.deepEqual(readReaConfig(f.root), f.config);
  } finally { f.close(); }
});
test("partial deletion resumes from original journal without complete metadata", t => {
  const f = fixture(), unlink = fs.unlinkSync;
  const mock = t.mock.method(fs, "unlinkSync", ((path) => {
    if (String(path) === join(f.paths.ghidra, "source.json")) throw Object.assign(Error("busy"), { code: "EBUSY" });
    return unlink(path);
  }) as typeof fs.unlinkSync); syncBuiltinESMExports();
  try {
    assert.throws(() => f.clean("ghidra"), /busy/);
    assert.equal(fs.existsSync(join(f.paths.ghidra, "package.zip")), false);
    assert.equal(readReaConfig(f.root).downloads?.ghidra, undefined); assert.equal(readReaConfig(f.root).downloadRemovalPending?.length, 1);
    mock.mock.restore(); syncBuiltinESMExports(); f.clean("ghidra");
    assert.equal(fs.existsSync(f.paths.ghidra), false); assert.equal(readReaConfig(f.root).downloadRemovalPending, undefined);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); f.close(); }
});
test("file changed after configuration revocation stays pending and is not deleted", t => {
  const f = fixture(), rename = fs.renameSync;
  const mock = t.mock.method(fs, "renameSync", ((from, to) => {
    rename(from, to);
    if (String(to) === reaConfigPath(f.root)) fs.writeFileSync(join(f.paths.ghidra, "package.zip"), "changed");
  }) as typeof fs.renameSync); syncBuiltinESMExports();
  try {
    assert.throws(() => f.clean("ghidra"), /文件已变化/);
    assert.equal(fs.readFileSync(join(f.paths.ghidra, "package.zip"), "utf8"), "changed");
    assert.equal(readReaConfig(f.root).downloadRemovalPending?.length, 1);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); f.close(); }
});
test("recreated previously removed pending directory is never adopted", t => {
  const f = fixture(), rename = fs.renameSync; let commits = 0;
  const mock = t.mock.method(fs, "renameSync", ((from, to) => {
    if (String(to) === reaConfigPath(f.root) && ++commits === 2) throw Error("commit interrupted");
    rename(from, to);
  }) as typeof fs.renameSync); syncBuiltinESMExports();
  try {
    assert.throws(() => f.clean("ghidra"), /commit interrupted/);
    mock.mock.restore(); syncBuiltinESMExports();
    assert.equal(fs.existsSync(f.paths.ghidra), false); assert.equal(readReaConfig(f.root).downloadRemovalPending?.length, 1);
    fs.mkdirSync(f.paths.ghidra); fs.writeFileSync(join(f.paths.ghidra, "keep"), "replacement");
    assert.throws(() => f.clean("ghidra")); assert.equal(fs.readFileSync(join(f.paths.ghidra, "keep"), "utf8"), "replacement");
  } finally { mock.mock.restore(); syncBuiltinESMExports(); f.close(); }
});
test("download journal paths never become engine removal paths", () => {
  const f = fixture();
  try { assert.deepEqual(reaRemovalPlan(f.root, f.config, [f.paths.ghidra], "ghidra").paths, []); }
  finally { f.close(); }
});
test("Hopper download cleanup preserves the external app and never authorizes engine uninstall", async () => {
  const f = fixture(), launcher = join(f.root, "external/Hopper Disassembler.app/Contents/MacOS/hopper");
  fs.mkdirSync(join(launcher, ".."), { recursive: true }); fs.writeFileSync(launcher, "external application");
  atomicReaJson(reaConfigPath(f.root), { ...f.config, engines: { ...f.config.engines, hopper: launcher } });
  const service = new ReaService(f.root, () => {});
  try {
    const before = service.snapshot();
    await assert.rejects(service.command({ op: "rea.engine-uninstall", requestId: randomUUID(), params: { engine: "hopper", revision: before.revision, confirm: true } }), { code: "EXTERNAL_INSTALLATION" });
    const accepted = await service.command({ op: "rea.clearDownloads", requestId: randomUUID(), params: { engine: "hopper", revision: before.revision, cleanupRevision: before.downloadCleanup!.hopper!.revision, confirm: true } });
    const jobId = accepted.jobs!.find(job => job.engine === "hopper")!.id;
    const deadline = Date.now() + 5000;
    while (service.snapshot().jobs?.some(job => job.running)) { assert.ok(Date.now() < deadline); await new Promise(resolve => setImmediate(resolve)); }
    const after = service.snapshot();
    assert.equal(after.jobs!.find(job => job.id === jobId)!.error, undefined);
    assert.equal(fs.existsSync(f.paths.hopper), false);
    assert.equal(fs.readFileSync(launcher, "utf8"), "external application");
    assert.equal(readReaConfig(f.root).engines!.hopper, launcher);
    assert.equal(after.engines!.find(engine => engine.id === "hopper")!.path, launcher);
    assert.deepEqual(after.downloadCleanup!.hopper!.paths, []);
  } finally { await service.close(); f.close(); }
});
test("download command requires scope confirmation and verifies its own async job", async () => {
  const f = fixture(); let barriers = 0;
  const service = new ReaService(f.root, () => {}, { removal: async work => { barriers++; return work(); } });
  try {
    const row = cleanupRows({ rea: service.snapshot() }).find(row => row.id === "download:hopper")!;
    const command = (params: Record<string, unknown>) => service.command({ op: row.op, requestId: randomUUID(), params });
    await assert.rejects(command({ revision: row.revision, engine: "hopper", confirm: true }), { code: "CONFIRM_REQUIRED" });
    const accepted = await command({ ...row.params, revision: row.revision, confirm: true });
    const id = acceptedCleanupJob(row, accepted, "unused"); assert.ok(id);
    const deadline = Date.now() + 5000;
    while (service.snapshot().jobs?.some(job => job.running)) { assert.ok(Date.now() < deadline); await new Promise(resolve => setImmediate(resolve)); }
    const after = service.snapshot();
    assert.equal(after.jobs?.find(job => job.id === id)?.error, undefined); assert.equal(barriers, 1);
    assert.equal(cleanupProgress(row, after, id).state, "verified"); assert.equal(fs.existsSync(f.paths.hopper), false);
    assert.ok(fs.existsSync(f.paths.ghidra));
  } finally { await service.close(); f.close(); }
});
