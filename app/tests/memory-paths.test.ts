import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, readdirSync, rmSync, symlinkSync, linkSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { digest, initializeMemory, memoryFiles, memoryPath, replaceMemoryFile, textFile } from "../src/server/memory-files.js";

const directoryLink = (target: string, path: string) => symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");

test("trusted data-root aliases preserve memory IO and the exclusive store lock", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-root-alias-"));
  const actual = join(root, "actual"), alias = join(root, "alias");
  mkdirSync(actual); directoryLink(actual, alias);
  const data = join(alias, "data");
  const store = new Store(data);
  try {
    assert.equal(store.root, realpathSync(data));
    assert.throws(() => new Store(join(actual, "data")), { code: "SERVICE_ALREADY_RUNNING" });
    const entry = initializeMemory(data, "session-one");
    assert.equal(entry, join(store.root, "memory", "sessions", "session-one", "MEMORY.md"));
    const directory = dirname(entry);
    assert.equal(memoryPath(directory, "MEMORY.md"), entry);
    const before = readFileSync(entry);
    replaceMemoryFile(entry, digest(before), "saved through trusted root alias");
    assert.equal(textFile(entry), "saved through trusted root alias");
    assert.deepEqual(memoryFiles(directory).map(file => file.path), ["MEMORY.md"]);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const parts of [["memory"], ["memory", "sessions"], ["memory", "sessions", "session-one"]]) {
  test(`memory initialization rejects a link at ${parts.join("/")} before creating descendants`, () => {
    const root = mkdtempSync(join(tmpdir(), "axiom-memory-link-"));
    const data = join(root, "data"), outside = join(root, "outside");
    mkdirSync(data); mkdirSync(outside);
    const link = join(data, ...parts);
    mkdirSync(dirname(link), { recursive: true }); directoryLink(outside, link);
    try {
      assert.throws(() => initializeMemory(data, "session-one"), { code: "MEMORY_PATH" });
      assert.deepEqual(readdirSync(outside), [], "rejection must not create files through the link");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("memory reads and saves reject linked descendants and hardlinked files", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-file-links-"));
  try {
    const entry = initializeMemory(root, "session-one"), directory = dirname(entry);
    const outside = join(root, "outside"); mkdirSync(outside);
    const original = join(outside, "source.md"); writeFileSync(original, "private source");
    directoryLink(outside, join(directory, "references"));
    const linked = join(directory, "references", "source.md");
    assert.throws(() => memoryPath(directory, "references/source.md"), { code: "MEMORY_PATH" });
    assert.throws(() => memoryFiles(directory), { code: "MEMORY_PATH" });
    assert.throws(() => textFile(linked), { code: "MEMORY_PATH" });
    assert.throws(() => replaceMemoryFile(linked, digest("private source"), "changed"), { code: "MEMORY_PATH" });
    rmSync(join(directory, "references"), { recursive: true });
    linkSync(original, join(directory, "alias.md"));
    assert.throws(() => memoryPath(directory, "alias.md"), { code: "MEMORY_PATH" });
    assert.throws(() => memoryFiles(directory), { code: "MEMORY_PATH" });
    assert.throws(() => textFile(join(directory, "alias.md")), { code: "MEMORY_PATH" });
    assert.throws(() => replaceMemoryFile(join(directory, "alias.md"), digest("private source"), "changed"), { code: "MEMORY_PATH" });
    assert.equal(readFileSync(original, "utf8"), "private source");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
