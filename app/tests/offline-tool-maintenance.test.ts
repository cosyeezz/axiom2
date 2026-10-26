import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, symlinkSync, linkSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { offlineToolRequest } from "../desktop/tool-maintenance.js";
import { atomicRtkJson, readRtkConfig, rtkConfigPath } from "../src/server/integrations/rtk-config.js";
import { cleanupRows } from "../src/client/pages/desktop-cleanup.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-offline-rtk-")));
  const versions = [0, 1].map(() => `v1.0.0-${randomUUID()}`), base = join(root, "integrations/rtk");
  for (const name of versions) { mkdirSync(join(base, "versions", name), { recursive: true }); writeFileSync(join(base, "versions", name, "rtk"), "owned program"); }
  atomicRtkJson(rtkConfigPath(root), { format: 1, revision: "initial", enabled: true, level: "balanced", subagents: true, installation: { version: "1.0.0", directory: versions[0] } });
  mkdirSync(join(base, "originals")); writeFileSync(join(base, "originals/keep.txt"), "original"); writeFileSync(join(base, "effects.sqlite"), "stats");
  const get = () => offlineToolRequest(root, { op: "rtk.get", requestId: randomUUID() }).data;
  const remove = (requestId = randomUUID()) => offlineToolRequest(root, { op: "rtk.uninstall", requestId, params: { confirm: true, revision: "f".repeat(64) } });
  return { root, base, versions, get, remove, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
// Compare all contents, identities and directory mtimes: rejection precedes even coordination writes.
function tree(path: string): unknown {
  const stat = lstatSync(path, { bigint: true });
  return [String(stat.dev), String(stat.ino), String(stat.mtimeNs), String(stat.ctimeNs), stat.isDirectory() ? readdirSync(path).sort().map(name => [name, tree(join(path, name))]) : readFileSync(path).toString("hex")];
}
test("offline preview lists exact versions without pruning or enabling deletion", () => {
  const f = fixture();
  try {
    const state = f.get(), row = cleanupRows({ rtk: state })[0];
    assert.equal(state.cleanupPaths?.length, 2); assert.equal(state.offline, true);
    assert.equal(state.offlineUninstall?.allowed, false); assert.match(state.offlineUninstall!.reason, /历史工作进程退出证明/);
    assert.equal(row.available, false); assert.equal(row.readOnly, true);
    for (const name of f.versions) assert.ok(row.scope.some(path => path.includes(name)));
    assert.deepEqual(readdirSync(join(f.base, "versions")).sort(), f.versions.sort());
    assert.equal(readFileSync(join(f.base, "effects.sqlite"), "utf8"), "stats"); assert.equal(existsSync(join(f.base, "job.json")), false);
    assert.equal(existsSync(join(f.root, "tool-maintenance.sqlite")), false);
  } finally { f.cleanup(); }
});
for (const mode of ["no descriptor", "dead backend", "new admission lock", "new version registration", "orphan versions", "old accepted request", "unfinished install"] as const) test(`offline uninstall refuses ${mode} with no filesystem mutation`, () => {
  const f = fixture(), requestId = randomUUID();
  try {
    if (mode === "dead backend") writeFileSync(join(f.root, "service-control.json"), JSON.stringify({ pid: 2147483647 }));
    if (mode === "new admission lock") f.get();
    if (mode === "new version registration") atomicRtkJson(rtkConfigPath(f.root), { ...readRtkConfig(f.root), revision: randomUUID() });
    if (mode === "orphan versions") rmSync(rtkConfigPath(f.root));
    if (mode === "unfinished install" || mode === "old accepted request") atomicRtkJson(join(f.base, "job.json"), { id: requestId, kind: mode === "unfinished install" ? "install" : "uninstall", running: true, message: "previous task" });
    if (mode === "old accepted request") {
      const db = new DatabaseSync(join(f.root, "tool-maintenance.sqlite"));
      try { db.exec("CREATE TABLE requests(id TEXT PRIMARY KEY, digest TEXT, job TEXT)"); db.prepare("INSERT INTO requests VALUES(?,?,?)").run(requestId, "a".repeat(64), JSON.stringify({ id: requestId, kind: "uninstall", running: false, message: "old success" })); } finally { db.close(); }
    }
    const before = tree(f.root);
    for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => f.remove(requestId), /缺少历史工作进程退出证明/);
    assert.deepEqual(tree(f.root), before);
  } finally { f.cleanup(); }
});
test("legacy offline snapshots and nonempty scopes cannot reopen deletion permission", () => {
  const f = fixture();
  try {
    const state = f.get(); delete state.offlineUninstall;
    state.cleanup = { paths: state.cleanupPaths!, revision: "a".repeat(64) };
    const row = cleanupRows({ rtk: state })[0];
    assert.equal(row.available, false); assert.equal(row.readOnly, true); assert.match(row.warning!, /退出证明/);
    rmSync(rtkConfigPath(f.root)); assert.equal(cleanupRows({ rtk: f.get() })[0].available, false);
  } finally { f.cleanup(); }
});
for (const [name, setup, message] of [
  ["live backend", (root: string) => writeFileSync(join(root, "service-control.json"), JSON.stringify({ pid: process.pid })), /后台退出/],
  ["invalid descriptor", (root: string) => writeFileSync(join(root, "service-control.json"), "{}"), /后台退出/],
  ["unconfirmed owner", (root: string) => writeFileSync(join(root, `.axiom-command-${randomUUID()}.json`), "{}"), /进程退出待核实/],
  ["transaction", (root: string) => { mkdirSync(join(root, "updates")); writeFileSync(join(root, "updates/transaction.json"), "{}"); }, /恢复事务/],
] as const) test(`offline preview retains barrier for ${name}`, () => {
  const f = fixture();
  try { setup(f.root); assert.throws(f.get, message); assert.equal(readRtkConfig(f.root).revision, "initial"); assert.equal(existsSync(join(f.base, "job.json")), false); }
  finally { f.cleanup(); }
});
test("maintenance lease and startup reservation still exclude offline preview", () => {
  const f = fixture(); f.get();
  const lease = new DatabaseSync(join(f.root, "service-maintenance.sqlite")), startup = new DatabaseSync(join(f.root, "service-startup.sqlite"));
  try {
    lease.exec("BEGIN IMMEDIATE"); assert.throws(f.get, /后台正在安装/); lease.exec("ROLLBACK");
    startup.prepare("INSERT INTO startup VALUES(1,?,?)").run("a".repeat(64), process.pid);
    assert.throws(f.get, /启动或维护/); assert.equal(startup.prepare("SELECT token FROM startup").get()?.token, "a".repeat(64));
  } finally { lease.close(); startup.close(); f.cleanup(); }
});
test("preview does not repair interrupted jobs", () => {
  const f = fixture();
  try {
    atomicRtkJson(join(f.base, "job.json"), { id: randomUUID(), kind: "uninstall", running: true, message: "interrupted" });
    const before = tree(f.base), state = f.get();
    assert.equal(state.job?.running, false); assert.match(state.job!.error!, /中断/); assert.deepEqual(tree(f.base), before);
  } finally { f.cleanup(); }
});
for (const kind of ["hardlink", "symlink"]) test(`offline preview rejects ${kind} config without changing its target`, t => {
  const f = fixture();
  try {
    const outside = join(f.root, "outside.json"); writeFileSync(outside, readFileSync(rtkConfigPath(f.root))); rmSync(rtkConfigPath(f.root));
    try { if (kind === "hardlink") linkSync(outside, rtkConfigPath(f.root)); else symlinkSync(outside, rtkConfigPath(f.root)); }
    catch (error) {
      if (kind === "symlink" && process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Windows file symlink creation requires Developer Mode or elevated privilege; hardlink rejection is covered separately"); return; }
      throw error;
    }
    assert.throws(f.get, /维护记录/); assert.equal(JSON.parse(readFileSync(outside, "utf8")).revision, "initial");
  } finally { f.cleanup(); }
});
test("offline preview rejects FIFO without blocking", { skip: process.platform === "win32" }, () => {
  const f = fixture(); try { execFileSync("mkfifo", [join(f.root, "service-control.json")]); assert.throws(f.get, /维护记录/); } finally { f.cleanup(); }
});
test("invalid commands and IDs are rejected before any coordination write", () => {
  const f = fixture();
  try {
    const before = tree(f.root);
    for (const requestId of [[randomUUID()], null, 123]) assert.throws(() => offlineToolRequest(f.root, { op: "rtk.get", requestId }), /清理请求无效/);
    for (const request of [{ op: "resources.remove", requestId: randomUUID() }, { op: "rtk.get", requestId: randomUUID(), root: f.root }, { op: "rtk.get", requestId: randomUUID(), params: { path: f.root } }]) assert.throws(() => offlineToolRequest(f.root, request));
    assert.deepEqual(tree(f.root), before);
  } finally { f.cleanup(); }
});
test("bundled host reads with plain Node but rejects all deletion and oversized input", async () => {
  const f = fixture();
  try {
    // @ts-expect-error Build scripts are deliberately plain ESM.
    const { buildToolMaintenance } = await import("../../scripts/build-tool-maintenance.mjs");
    const entry = join(f.root, "host.mjs"); await buildToolMaintenance(entry);
    const run = (input: string) => spawnSync(process.execPath, [entry], { env: { ...process.env, AXIOM_DATA_DIR: f.root }, input, encoding: "utf8", timeout: 5000 });
    const read = run(JSON.stringify({ op: "rtk.get", requestId: randomUUID() })); assert.equal(read.status, 0, read.stderr);
    const state = JSON.parse(read.stdout).data; assert.equal(state.cleanupPaths.length, 2); assert.equal(state.offlineUninstall.allowed, false);
    const before = tree(f.root);
    const denied = run(JSON.stringify({ op: "rtk.uninstall", requestId: randomUUID(), params: { confirm: true, revision: state.revision } }));
    assert.equal(denied.status, 1); assert.match(JSON.parse(denied.stdout).message, /历史工作进程退出证明/); assert.deepEqual(tree(f.root), before);
    const oversized = run(" ".repeat(16385)); assert.equal(oversized.status, 1); assert.match(JSON.parse(oversized.stdout).message, /请求过大/);
  } finally { f.cleanup(); }
});
