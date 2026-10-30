import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { RtkService } from "../src/server/integrations/rtk.js";
import { atomicRtkJson, readRtkConfig, rtkConfigPath, rtkDirectory } from "../src/server/integrations/rtk-config.js";
import { cleanRtkVersions } from "../src/server/integrations/rtk-versions.js";
import { createProcessOwner } from "../src/server/process-owner-record.js";
import { assertToolProcessesStopped } from "../src/server/integrations/tool-process.js";
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const name = () => `v1.0.0-${randomUUID()}`;
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "axiom-rtk-removal-"));
  const names = [name(), name()];
  atomicRtkJson(rtkConfigPath(root), { format: 1, revision: "initial", enabled: true, level: "aggressive", subagents: false, installation: { directory: names[0], version: "1.0.0" } });
  for (const item of names) { const dir = join(rtkDirectory(root), "versions", item); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(join(dir, "sentinel"), "program"); }
  return { root, names, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
async function uninstall(s: RtkService) {
  await s.command({ op: "rtk.uninstall", requestId: randomUUID(), params: { confirm: true, revision: s.snapshot().revision } });
  const deadline = Date.now() + 5000;
  while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); }
  return s.snapshot();
}
for (const depth of [0, 1, 2, 3]) test(`RTK pruning refuses junction at managed path depth ${depth} without deleting external files`, () => {
  const base = fs.mkdtempSync(join(tmpdir(), "axiom-rtk-links-")), root = join(base, "root"), outside = join(base, "outside");
  fs.mkdirSync(root); fs.mkdirSync(outside);
  const parents = ["integrations", "rtk", "versions"], leaf = name();
  try {
    const link = join(root, ...parents.slice(0, depth), ...(depth === 3 ? [leaf] : [parents[depth]]));
    fs.mkdirSync(join(root, ...parents.slice(0, depth)), { recursive: true });
    const target = depth === 3 ? outside : join(outside, ...parents.slice(depth + 1));
    fs.mkdirSync(target, { recursive: true });
    const old = join(target, ...(depth === 3 ? [] : [leaf])); fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(join(old, "sentinel"), "external");
    fs.utimesSync(old, 0, 0);
    const newer = join(target, name()); fs.mkdirSync(newer);
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => cleanRtkVersions(root), /托管安装目录/);
    assert.equal(fs.readFileSync(join(old, "sentinel"), "utf8"), "external");
    assert.ok(fs.existsSync(newer));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
test("RTK startup cleanup defers injected execution until initialization completes", async () => {
  const f = fixture(); let ready = false, calls = 0;
  const old = join(rtkDirectory(f.root), "versions", name()); fs.mkdirSync(old); fs.utimesSync(old, 0, 0);
  const s = new RtkService(f.root, () => {}, { removal: async work => { calls++; assert.ok(ready); return work(); } });
  try { ready = true; await turn(); assert.equal(calls, 1); assert.equal(fs.existsSync(old), false); }
  finally { await s.close(); f.cleanup(); }
});
test("RTK stale path confirmation does not block forced uninstall", async () => {
  const f = fixture(); let calls = 0;
  const s = new RtkService(f.root, () => {}, { removal: async work => { calls++; return work(); } });
  try {
    await turn(); calls = 0;
    const before = s.snapshot(), bytes = fs.readFileSync(rtkConfigPath(f.root), 'utf8');
    assert.deepEqual(before.cleanup!.paths, f.names.map(name => join(rtkDirectory(f.root), 'versions', name)).sort());
    const extra = join(rtkDirectory(f.root), 'versions', name()); fs.mkdirSync(extra);
    await s.command({ op: 'rtk.uninstall', requestId: randomUUID(), params: { confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.revision } });
    const deadline = Date.now() + 5000;
    while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); }
    assert.equal(s.snapshot().job?.error, undefined); void bytes;
    assert.equal(readRtkConfig(f.root).installation, undefined);
    assert.equal(fs.existsSync(extra), false, "component standard: every managed version is removed");
  } finally { await s.close(); f.cleanup(); }
});
test("RTK explicit removal does not wait for an application-root tool owner", async () => {
  const f = fixture(), s = new RtkService(f.root, () => {});
  const path = join(f.root, `.axiom-command-${randomUUID()}.json`), owner = createProcessOwner(path);
  try {
    assert.throws(() => assertToolProcessesStopped(f.root), { code: "stop-unconfirmed" });
    const before = s.snapshot();
    await s.command({ op: "rtk.uninstall", requestId: randomUUID(), params: { confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.revision } });
    const deadline = Date.now() + 5000;
    while (s.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); }
    assert.equal(s.snapshot().job?.error, undefined);
    for (const name of f.names) assert.equal(fs.existsSync(join(rtkDirectory(f.root), "versions", name)), false);
    assert.equal(fs.existsSync(path), true, "removal must not stop or clear the tool owner");
  } finally { owner.stopped("not-started"); owner.confirmed(); await s.close(); f.cleanup(); }
});
test("RTK uninstall revokes before deletion, retries a busy file and recovers persistent failure on the next uninstall", async t => {
  const f = fixture(); let s = new RtkService(f.root, () => {});
  const originalRm = fs.rmSync;
  fs.mkdirSync(join(rtkDirectory(f.root), "originals")); fs.writeFileSync(join(rtkDirectory(f.root), "originals", "keep.txt"), "original");
  fs.writeFileSync(join(rtkDirectory(f.root), "effects.sqlite"), "statistics");
  let deletes = 0, persistent = true;
  const mock = t.mock.method(fs, "rmSync", ((path, options) => {
    if (f.names.some(item => String(path).endsWith(item))) {
      assert.equal(readRtkConfig(f.root).installation, undefined);
      if (++deletes === 2) throw Object.assign(Error("busy"), { code: "EBUSY" });
      if (persistent && String(path).endsWith(f.names[1])) throw Object.assign(Error("busy"), { code: "EBUSY" });
    }
    return originalRm(path, options);
  }) as typeof fs.rmSync); syncBuiltinESMExports();
  try {
    assert.match((await uninstall(s)).job!.error!, /部分文件/);
    assert.ok(fs.existsSync(join(rtkDirectory(f.root), "versions", f.names[1])));
    persistent = false; deletes = 0;
    await s.close(); s = new RtkService(f.root, () => {});
    assert.equal((await uninstall(s)).job!.error, undefined, "a single busy delete is retried automatically");
    mock.mock.restore(); syncBuiltinESMExports();
    assert.equal(readRtkConfig(f.root).removalPending, undefined);
    assert.deepEqual(s.snapshot().settings, { enabled: false, level: "aggressive", subagents: false }, "uninstall disables RTK and keeps other settings");
    assert.equal(fs.readFileSync(join(rtkDirectory(f.root), "effects.sqlite"), "utf8"), "statistics");
    assert.equal(fs.readFileSync(join(rtkDirectory(f.root), "originals", "keep.txt"), "utf8"), "original");
    for (const item of f.names) assert.equal(fs.existsSync(join(rtkDirectory(f.root), "versions", item)), false);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});
for (const failedWrite of [1, 2]) test(`RTK uninstall safely recovers configuration publication failure ${failedWrite}`, async t => {
  const f = fixture(), s = new RtkService(f.root, () => {}), rename = fs.renameSync;
  let writes = 0;
  const mock = t.mock.method(fs, "renameSync", ((source, target) => {
    if (String(target) === rtkConfigPath(f.root) && ++writes === failedWrite) throw Object.assign(Error("disk unavailable"), { code: "EACCES" });
    return rename(source, target);
  }) as typeof fs.renameSync); syncBuiltinESMExports();
  try {
    const first = await uninstall(s);
    if (failedWrite === 1) {
      assert.ok(first.job!.error);
      assert.equal(readRtkConfig(f.root).installation?.directory, f.names[0]);
      for (const item of f.names) assert.ok(fs.existsSync(join(rtkDirectory(f.root), "versions", item)));
    } else { assert.equal(first.job!.error, undefined, "forced uninstall publishes configuration once"); assert.equal(writes, 1); }
    mock.mock.restore(); syncBuiltinESMExports();
    assert.equal((await uninstall(s)).job!.error, undefined);
    assert.equal(readRtkConfig(f.root).installation, undefined); assert.equal(readRtkConfig(f.root).removalPending, undefined);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); await s.close(); f.cleanup(); }
});
