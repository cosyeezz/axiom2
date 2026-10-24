import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { tmpdir } from "./temporary.js";
import { digest, replaceMemoryFile } from "../src/server/memory-files.js";

function fixture(t: TestContext, content = "original body") {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "axiom-memory-save-"))), path = join(root, "memory.md");
  fs.writeFileSync(path, content, { mode: 0o600 });
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, path, content, revision: digest(content) };
}
function beforeWriteOpen(t: TestContext, path: string, change: () => void) {
  const open = fs.openSync; let changed = false;
  t.mock.method(fs, "openSync", ((file, flags, mode) => {
    if (file === path && typeof flags === "number" && (flags & fs.constants.O_RDWR) && !changed) { changed = true; change(); }
    return open(file, flags, mode);
  }) as typeof fs.openSync);
  syncBuiltinESMExports();
}
function afterFirstRead(t: TestContext, path: string, change: () => void) {
  const open = fs.openSync, read = fs.readSync; let target: number | undefined, changed = false;
  t.mock.method(fs, "openSync", ((file, flags, mode) => {
    const fd = open(file, flags, mode);
    if (file === path && typeof flags === "number" && (flags & fs.constants.O_RDWR)) target = fd;
    return fd;
  }) as typeof fs.openSync);
  t.mock.method(fs, "readSync", ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    const count = read(fd, buffer, offset, length, position);
    if (fd === target && count > 0 && !changed) { changed = true; change(); }
    return count;
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
}

for (const phase of ["before open", "during read"] as const) test(`metadata-only changes ${phase} do not invalidate unchanged bytes`, t => {
  const f = fixture(t, "\uFEFF中文正文😀\r\n"); let changes = 0;
  const change = () => {
    changes++;
    fs.chmodSync(f.path, 0o640); fs.chmodSync(f.path, 0o600);
    fs.utimesSync(f.path, new Date(1000), new Date(2000));
  };
  (phase === "before open" ? beforeWriteOpen : afterFirstRead)(t, f.path, change);
  replaceMemoryFile(f.path, f.revision, "已更新😀\r\n");
  assert.equal(changes, 1);
  assert.equal(fs.readFileSync(f.path, "utf8"), "\uFEFF已更新😀\r\n");
});

for (const phase of ["before open", "during read"] as const) test(`same-length content changes ${phase} are rejected even with mtime restored`, t => {
  const f = fixture(t), before = fs.statSync(f.path), external = "external body";
  assert.equal(Buffer.byteLength(external), Buffer.byteLength(f.content));
  const change = () => {
    fs.writeFileSync(f.path, external);
    fs.utimesSync(f.path, before.atime, before.mtime);
  };
  (phase === "before open" ? beforeWriteOpen : afterFirstRead)(t, f.path, change);
  assert.throws(() => replaceMemoryFile(f.path, f.revision, "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(f.path, "utf8"), external);
});

for (const content of ["short", "a much longer replacement body"]) test(`length-changing writes during read are rejected (${content.length} bytes)`, t => {
  const f = fixture(t);
  afterFirstRead(t, f.path, () => fs.writeFileSync(f.path, content));
  assert.throws(() => replaceMemoryFile(f.path, f.revision, "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(f.path, "utf8"), content);
});

for (const phase of ["before open", "during read"] as const) test(`same-content inode replacement ${phase} cannot pass the identity guard`, t => {
  const f = fixture(t), backup = join(f.root, "original.md");
  const change = () => { fs.renameSync(f.path, backup); fs.writeFileSync(f.path, f.content); };
  (phase === "before open" ? beforeWriteOpen : afterFirstRead)(t, f.path, change);
  assert.throws(() => replaceMemoryFile(f.path, f.revision, "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(f.path, "utf8"), f.content);
  assert.equal(fs.readFileSync(backup, "utf8"), f.content);
});

test("a hard link introduced during descriptor reading still blocks a write", t => {
  const f = fixture(t), alias = join(f.root, "alias.md");
  afterFirstRead(t, f.path, () => fs.linkSync(f.path, alias));
  assert.throws(() => replaceMemoryFile(f.path, f.revision, "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(alias, "utf8"), f.content);
});

test("a symlink substituted during descriptor reading never writes through to its target", { skip: process.platform === "win32" }, t => {
  const f = fixture(t), outside = join(f.root, "outside.md");
  fs.writeFileSync(outside, f.content);
  afterFirstRead(t, f.path, () => { fs.unlinkSync(f.path); fs.symlinkSync(outside, f.path); });
  assert.throws(() => replaceMemoryFile(f.path, f.revision, "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(outside, "utf8"), f.content);
});

test("parent-directory substitution is rejected even when it points to the original inode", { skip: process.platform === "win32" }, t => {
  const f = fixture(t), directory = join(f.root, "directory"), moved = join(f.root, "moved");
  fs.mkdirSync(directory);
  const path = join(directory, "memory.md"); fs.writeFileSync(path, f.content);
  beforeWriteOpen(t, path, () => { fs.renameSync(directory, moved); fs.symlinkSync(moved, directory); });
  assert.throws(() => replaceMemoryFile(path, f.revision, "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(join(moved, "memory.md"), "utf8"), f.content);
});

test("descriptor verification retains the source size budget and stale-revision guard", t => {
  const f = fixture(t);
  assert.throws(() => replaceMemoryFile(f.path, digest("stale"), "must not overwrite"), { code: "REVISION_CONFLICT" });
  assert.equal(fs.readFileSync(f.path, "utf8"), f.content);
  fs.writeFileSync(f.path, "x".repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => replaceMemoryFile(f.path, digest(fs.readFileSync(f.path)), "must not overwrite"), { code: "MEMORY_LIMIT" });
  assert.equal(fs.statSync(f.path).size, 4 * 1024 * 1024 + 1);
});
