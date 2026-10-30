import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs, { closeSync, existsSync, ftruncateSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { copyForkMemory } from "../src/server/memory-fork.js";
import { initializeMemory, memoryDirectory, memoryFiles } from "../src/server/memory-files.js";
import { initializeMemoryStorage } from "../src/server/memory-storage.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-fork-"));
  const source = memoryDirectory(root, "source"), target = memoryDirectory(root, "branch");
  initializeMemory(root, "source");
  return { root, source, target, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("fork copies the whole memory tree, preserves bytes, rebases local references and isolates writes", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.source, "details", "目标"), { recursive: true });
    mkdirSync(join(f.source, "references")); mkdirSync(join(f.source, "empty"));
    const main = "\ufeff# [In progress] 目标\r\n## [Completed] 核验\r\n";
    const detail = `详情 [相对](../references/依据.txt) [绝对](<${f.source}/references/依据.txt>)\r\n` +
      `[编码](${encodeURI(`${f.source}/references/依据.txt`)}) [外部](<${f.root}/external.md>)\r\n` +
      `相似前缀 ${f.source}-other/MEMORY.md\r\n`;
    writeFileSync(join(f.source, "MEMORY.md"), main);
    writeFileSync(join(f.source, "details", "目标.md"), detail);
    writeFileSync(join(f.source, "details", "目标", "核验.md"), "通过");
    writeFileSync(join(f.source, "references", "依据.txt"), "FACT");
    const binary = Buffer.from([0, 255, 1, 254]), invalidText = Buffer.from([255, 254, 65]);
    writeFileSync(join(f.source, "references", "plot.png"), binary);
    writeFileSync(join(f.source, "references", "invalid.txt"), invalidText);
    writeFileSync(join(f.source, "references", "evidence.jsonl"), '{"fact":1}\n');
    assert.equal(copyForkMemory(f.root, "source", "branch"), f.target);
    assert.deepEqual(readdirSync(f.target, { recursive: true }).sort(), readdirSync(f.source, { recursive: true }).sort());
    assert.equal(readFileSync(join(f.target, "MEMORY.md"), "utf8"), main);
    assert.equal(readFileSync(join(f.target, "details", "目标.md"), "utf8"), detail
      .replaceAll(`${f.source}/`, `${f.target}/`).replaceAll(`${encodeURI(f.source)}/`, `${encodeURI(f.target)}/`));
    assert.deepEqual(readFileSync(join(f.target, "references", "plot.png")), binary);
    assert.deepEqual(readFileSync(join(f.target, "references", "invalid.txt")), invalidText);
    assert.equal(readFileSync(join(f.target, "references", "evidence.jsonl"), "utf8"), '{"fact":1}\n');
    for (const path of ["MEMORY.md", join("details", "目标.md")]) {
      assert.notEqual(lstatSync(join(f.source, path)).ino, lstatSync(join(f.target, path)).ino);
      assert.equal(lstatSync(join(f.target, path)).nlink, 1);
      if (process.platform !== "win32") assert.equal(lstatSync(join(f.target, path)).mode & 0o777, 0o600);
    }
    writeFileSync(join(f.target, "MEMORY.md"), "BRANCH");
    writeFileSync(join(f.source, "references", "依据.txt"), "SOURCE LATER");
    assert.equal(readFileSync(join(f.source, "MEMORY.md"), "utf8"), main);
    assert.equal(readFileSync(join(f.source, "details", "目标.md"), "utf8"), detail);
    assert.equal(readFileSync(join(f.target, "references", "依据.txt"), "utf8"), "FACT");
  } finally { f.close(); }
});

test("path rebasing preserves external URLs and normalizes local destinations before mapping", () => {
  const f = fixture();
  try {
    const external = `[网页](https://example.test${f.source}/detail.md)\n` +
      `https://example.test/?path=${f.source}/detail.md\nHTTPS://example.test/?path=${f.source}/detail.md\n` +
      `[网络](//example.test/?path=${f.source}/detail.md)\n`;
    const original = external + `[本地](<${f.source}/../source/detail.md#section#part>)\n` +
      `[外部资料](<${f.source}/../outside.md>)\n` +
      `普通路径 ${f.source}/details/note.md\n` +
      `[目录](<${f.source}>)\n` +
      `[百分号](<${f.source}/report 100%.md>)\n` +
      `[编码百分号](${encodeURI(`${f.source}/report 100%.md`)})\n`;
    writeFileSync(join(f.source, "detail.md"), original);
    copyForkMemory(f.root, "source", "branch");
    assert.equal(readFileSync(join(f.target, "detail.md"), "utf8"), external +
      `[本地](<${f.target}/detail.md#section#part>)\n` +
      `[外部资料](<${f.source}/../outside.md>)\n` +
      `普通路径 ${f.target}/details/note.md\n` +
      `[目录](<${f.target}>)\n` +
      `[百分号](<${f.target}/report 100%.md>)\n` +
      `[编码百分号](${encodeURI(`${f.target}/report 100%.md`)})\n`);
    assert.equal(readFileSync(join(f.source, "detail.md"), "utf8"), original);
  } finally { f.close(); }
});

test("fork respects migrated memory bindings instead of the legacy data directory", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, "MEMORY.md"), "BOUND SOURCE");
    initializeMemoryStorage(f.root, ["source"], join(f.root, "short-memory"));
    const target = copyForkMemory(f.root, "source", "branch");
    assert.equal(target, memoryDirectory(f.root, "branch"));
    assert.equal(readFileSync(join(target, "MEMORY.md"), "utf8"), "BOUND SOURCE");
    assert.equal(existsSync(f.target), false);
  } finally { f.close(); }
});

test("missing memory gets an independent empty entry without creating or repairing the source", () => {
  const f = fixture();
  try {
    rmSync(f.source, { recursive: true });
    copyForkMemory(f.root, "source", "branch");
    assert.equal(readFileSync(join(f.target, "MEMORY.md"), "utf8"), "");
    assert.equal(existsSync(f.source), false);
    mkdirSync(f.source); mkdirSync(join(f.source, "details"));
    writeFileSync(join(f.source, "details", "legacy.md"), "retained");
    const second = copyForkMemory(f.root, "source", "branch-two");
    assert.equal(readFileSync(join(second, "MEMORY.md"), "utf8"), "");
    assert.equal(readFileSync(join(second, "details", "legacy.md"), "utf8"), "retained");
    assert.equal(existsSync(join(f.source, "MEMORY.md")), false);
  } finally { f.close(); }
});

test("existing targets are never overwritten or cleaned up", () => {
  const f = fixture();
  try {
    mkdirSync(f.target); writeFileSync(join(f.target, "MEMORY.md"), "EXISTING");
    assert.throws(() => copyForkMemory(f.root, "source", "branch"), { code: "EEXIST" });
    assert.equal(readFileSync(join(f.target, "MEMORY.md"), "utf8"), "EXISTING");
    assert.throws(() => copyForkMemory(f.root, "source", "source"), { code: "EEXIST" });
    assert.equal(existsSync(join(f.source, "MEMORY.md")), true);
  } finally { f.close(); }
});

test("fork rejects source file links, directory links and invalid memory entries", () => {
  const f = fixture();
  try {
    const outside = join(f.root, "outside"); mkdirSync(outside);
    writeFileSync(join(outside, "private.md"), "PRIVATE");
    const alias = join(f.source, "alias");
    for (const kind of ["file", "directory", "hardlink"]) {
      if (kind === "hardlink") linkSync(join(outside, "private.md"), alias);
      else symlinkSync(kind === "file" ? join(outside, "private.md") : outside, alias, kind === "file" ? "file" : "junction");
      assert.throws(() => copyForkMemory(f.root, "source", "branch"), { code: "MEMORY_PATH" });
      assert.equal(existsSync(f.target), false);
      rmSync(alias);
    }
    rmSync(f.source, { recursive: true }); symlinkSync(outside, f.source, "junction");
    assert.throws(() => copyForkMemory(f.root, "source", "branch"), { code: "MEMORY_PATH" });
    rmSync(f.source); mkdirSync(join(f.source, "MEMORY.md"), { recursive: true });
    assert.throws(() => copyForkMemory(f.root, "source", "branch"), { code: "MEMORY_PATH" });
    assert.equal(existsSync(f.target), false);
    assert.equal(readFileSync(join(outside, "private.md"), "utf8"), "PRIVATE");
  } finally { f.close(); }
});

for (const scenario of ["write-failure", "source-change", "source-addition"]) test(`fork removes partial copies on ${scenario}`, () => {
  const f = fixture(), originalWrite = fs.writeFileSync;
  let writes = 0;
  writeFileSync(join(f.source, "MEMORY.md"), "SOURCE");
  writeFileSync(join(f.source, "detail.md"), "DETAIL");
  const hook = mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    if (String(args[0]).startsWith(f.target)) {
      if (scenario === "write-failure" && ++writes === 2) throw Error("fixture write failure");
      if (scenario === "source-change") originalWrite(join(f.source, "MEMORY.md"), "CHANGED SOURCE");
      if (scenario === "source-addition") originalWrite(join(f.source, "new.md"), "NEW");
    }
    return originalWrite(...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => copyForkMemory(f.root, "source", "branch"), scenario === "write-failure" ? /fixture write failure/ : { code: "REVISION_CONFLICT" });
    assert.equal(existsSync(f.target), false);
    assert.equal(readFileSync(join(f.source, "detail.md"), "utf8"), "DETAIL");
  } finally { hook.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

test("a missing main entry reserves a file slot so a successful fork remains scannable", () => {
  const f = fixture();
  try {
    rmSync(join(f.source, "MEMORY.md"));
    for (let index = 0; index < 2000; index++) writeFileSync(join(f.source, `${index}.md`), "");
    assert.throws(() => copyForkMemory(f.root, "source", "branch"), { code: "MEMORY_LIMIT" });
    assert.equal(existsSync(f.target), false);
    rmSync(join(f.source, "1999.md"));
    copyForkMemory(f.root, "source", "branch");
    assert.equal(memoryFiles(f.target).length, 2000);
    assert.equal(readFileSync(join(f.target, "MEMORY.md"), "utf8"), "");
    assert.equal(existsSync(join(f.source, "MEMORY.md")), false);
  } finally { f.close(); }
});

test("fork refuses oversized memory without allocating or leaving a partial destination", () => {
  const f = fixture();
  try {
    const fd = openSync(join(f.source, "large.bin"), "wx");
    try { ftruncateSync(fd, 32 * 1024 * 1024 + 1); } finally { closeSync(fd); }
    assert.throws(() => copyForkMemory(f.root, "source", "branch"), { code: "MEMORY_LIMIT" });
    assert.equal(existsSync(f.target), false);
  } finally { f.close(); }
});
