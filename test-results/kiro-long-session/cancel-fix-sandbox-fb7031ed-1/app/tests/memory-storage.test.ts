import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { initializeMemoryStorage, legacyMemoryRoot, memoryRoot, memoryRulesPath } from "../src/server/memory-storage.js";
import { initializeMemory, memoryDirectory } from "../src/server/memory-files.js";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "axiom-memory-migration-"));
  const root = join(temp, "data"), target = join(temp, "short", "memory");
  mkdirSync(root);
  const entry = initializeMemory(root, "session-one"), old = memoryDirectory(root, "session-one");
  return { temp, root, target, entry, old, close: () => rmSync(temp, { recursive: true, force: true }) };
}

test("migration preserves originals and binary artifacts, rewrites local absolute references, and commits a durable location", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.old, "references")); mkdirSync(join(f.old, "artifacts"));
    const evidence = join(f.old, "references", "事实.md"), binary = Buffer.from([0, 255, 1, 254]);
    writeFileSync(evidence, "已核实事实");
    writeFileSync(join(f.old, "artifacts", "plot.png"), binary);
    const original = `\ufeff# 目标\r\n事实见引用。[^fact]\r\n\r\n[^fact]: [事实](<${evidence}>)\r\n`;
    writeFileSync(f.entry, original);
    initializeMemoryStorage(f.root, ["session-one"], f.target);
    const next = memoryDirectory(f.root, "session-one");
    assert.equal(next, join(f.target, "session-one"));
    assert.equal(readFileSync(f.entry, "utf8"), original, "old files are recovery copies, not rewritten");
    assert.equal(readFileSync(join(next, "MEMORY.md"), "utf8"), original.replace(legacyMemoryRoot(f.root), f.target));
    assert.deepEqual(readFileSync(join(next, "artifacts", "plot.png")), binary);
    assert.equal(existsSync(memoryRulesPath(f.root)), false, "new memory storage does not generate a rules file");
    writeFileSync(join(next, "MEMORY.md"), "迁移后继续工作");
    initializeMemoryStorage(f.root, ["session-one"], f.target);
    assert.equal(readFileSync(join(next, "MEMORY.md"), "utf8"), "迁移后继续工作");
    rmSync(join(next, "MEMORY.md"));
    initializeMemoryStorage(f.root, ["session-one"], f.target);
    assert.equal(existsSync(join(next, "MEMORY.md")), false, "restart must not resurrect an intentionally deleted entry");
    assert.equal(JSON.parse(readFileSync(join(f.root, "memory-location.json"), "utf8")).directory, f.target);
    assert.ok(!readdirSync(f.target).some((name) => name.startsWith(".migration-")));
  } finally { f.close(); }
});

test("conflicting migration destinations remain untouched and the old root stays authoritative", () => {
  const f = fixture();
  try {
    writeFileSync(f.entry, "旧资料");
    mkdirSync(join(f.target, "session-one"), { recursive: true });
    writeFileSync(join(f.target, "session-one", "MEMORY.md"), "目标已有的新资料");
    assert.throws(() => initializeMemoryStorage(f.root, ["session-one"], f.target), /不同内容/);
    assert.equal(memoryRoot(f.root), legacyMemoryRoot(f.root));
    assert.equal(readFileSync(f.entry, "utf8"), "旧资料");
    assert.equal(readFileSync(join(f.target, "session-one", "MEMORY.md"), "utf8"), "目标已有的新资料");
    assert.equal(existsSync(join(f.root, "memory-location.json")), false);
  } finally { f.close(); }
});

test("interrupted migrations can reuse identical copies, while linked sources never escape into the destination", () => {
  const f = fixture();
  try {
    initializeMemory(f.root, "session-two");
    const outside = join(f.temp, "outside.md"); writeFileSync(outside, "private");
    const link = join(memoryDirectory(f.root, "session-two"), "alias.md"); symlinkSync(outside, link);
    assert.throws(() => initializeMemoryStorage(f.root, ["session-one", "session-two"], f.target), /链接/);
    assert.equal(memoryRoot(f.root), legacyMemoryRoot(f.root));
    assert.ok(existsSync(join(f.target, "session-one", "MEMORY.md")));
    assert.equal(existsSync(join(f.target, "session-two")), false);
    rmSync(link);
    initializeMemoryStorage(f.root, ["session-one", "session-two"], f.target);
    assert.equal(memoryRoot(f.root), f.target);
  } finally { f.close(); }
});

test("custom data roots keep memory and shared rules isolated and never replace an existing rules file", () => {
  const f = fixture();
  try {
    initializeMemoryStorage(f.root, ["session-one"]);
    assert.equal(memoryRoot(f.root), legacyMemoryRoot(f.root));
    writeFileSync(memoryRulesPath(f.root), "用户保留的规则");
    initializeMemoryStorage(f.root, ["session-one"]);
    initializeMemory(f.root, "session-two");
    assert.equal(readFileSync(memoryRulesPath(f.root), "utf8"), "用户保留的规则");
    assert.equal(existsSync(f.target), false);
  } finally { f.close(); }
});

test("invalid or unavailable bindings never prevent startup and never replace the recovery source", async () => {
  const f = fixture();
  let store: Store | undefined, memories: Memories | undefined;
  try {
    const binding = join(f.root, "memory-location.json");
    for (const content of ["{broken", JSON.stringify({ version: 1, dataRoot: f.root, directory: f.target })]) {
      writeFileSync(binding, content);
      store = new Store(f.root);
      memories = new Memories(store, () => {});
      assert.equal(memoryRoot(f.root), legacyMemoryRoot(f.root));
      assert.equal(readFileSync(binding, "utf8"), content);
      assert.equal(existsSync(f.target), false, "missing destination must not become an empty replacement");
      await memories.close(); memories = undefined; store.close(); store = undefined;
    }
  } finally { await memories?.close(); store?.close(); f.close(); }
});

test("a copied binding cannot redirect another data root to the original memory", () => {
  const f = fixture();
  try {
    initializeMemoryStorage(f.root, ["session-one"], f.target);
    const otherRoot = join(f.temp, "other-data"); mkdirSync(otherRoot);
    writeFileSync(join(otherRoot, "memory-location.json"), readFileSync(join(f.root, "memory-location.json")));
    initializeMemoryStorage(otherRoot, ["session-one"]);
    assert.equal(memoryRoot(otherRoot), legacyMemoryRoot(otherRoot));
    const entry = initializeMemory(otherRoot, "session-one");
    writeFileSync(entry, "独立实例");
    assert.notEqual(readFileSync(join(f.target, "session-one", "MEMORY.md"), "utf8"), "独立实例");
  } finally { f.close(); }
});

test("store restart, scanner and reference reads use the migrated location and preserve source ownership", async () => {
  const f = fixture();
  let store: Store | undefined, memories: Memories | undefined;
  try {
    store = new Store(f.root);
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: f.temp, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id }) as Session;
    const other = store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const original = join(memoryDirectory(f.root, session.id), "MEMORY.md");
    writeFileSync(original, "迁移中的当前事实");
    initializeMemoryStorage(f.root, [session.id, other.id], f.target);
    store.close(); store = new Store(f.root);
    memories = new Memories(store, () => {});
    assert.equal(memories.read(scope).content, "迁移中的当前事实");
    const foreign = join(memoryDirectory(f.root, other.id), "MEMORY.md");
    const entry = join(memoryDirectory(f.root, session.id), "MEMORY.md");
    writeFileSync(entry, `无越权读取。[^foreign]\n\n[^foreign]: [其他会话](<${foreign}>)\n`);
    assert.throws(() => memories!.read(scope, foreign), "explicit links cannot grant reads of another session's memory even inside the workspace");
    await memories.scanAsync(scope);
    assert.match(memories.snapshot(scope)!.entry, /无越权读取/);
    assert.equal(readFileSync(original, "utf8"), "迁移中的当前事实");
  } finally { await memories?.close(); store?.close(); f.close(); }
});
