import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/storage.js";
import { ModelUsageLedger } from "../src/server/model-usage-ledger.js";
import { usageCost } from "../src/server/usage-cost.js";
import { sumCosts } from "../src/shared/costs.js";
import { estimateTokenBalance } from "../src/shared/provider-usage.js";
import { usageModelPricing } from "../src/server/model-metadata.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
const usage = (input = 100, cost = .01) => ({ input, output: 20, cacheRead: 30, cacheWrite: 5, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
const entry = (id: string, provider = "fixture", timestamp: number | undefined = 1700000000000) => ({ type: "message", id, ...(timestamp !== undefined ? { timestamp: new Date(timestamp).toISOString() } : {}), message: { role: "assistant", provider, model: "local-model", usage: usage(), stopReason: "stop", ...(timestamp !== undefined ? { timestamp } : {}) } });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-ledger-")), store = new Store(root), models = join(root, "pricing"); mkdirSync(models);
  store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT,body TEXT); CREATE TABLE memory_usage(id TEXT PRIMARY KEY,sessionId TEXT,kind TEXT,provider TEXT,model TEXT,usage TEXT,createdAt INTEGER)");
  const workspace = (name: string) => { const path = join(root, name); mkdirSync(path); return store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path, authorized: true } }) as Workspace; };
  const a = workspace("first"), b = workspace("second");
  const session = (w = a) => store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id, params: { title: `会话-${w.name}` } }) as Session;
  const history = (s: Session, entries: unknown[], w = a) => {
    const file = join(root, `${s.id}.jsonl`); writeFileSync(file, [JSON.stringify({ type: "session", id: crypto.randomUUID(), version: 3, cwd: w.path }), ...entries.map(row => JSON.stringify(row))].join("\n") + "\n");
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(s.id, file); return file;
  };
  const ledgers: ModelUsageLedger[] = [];
  const ledger = (limits = {}) => { const instance = new ModelUsageLedger(store, models, { milliseconds: 60_000, ...limits }); ledgers.push(instance); return instance; };
  return { root, store, models, a, b, session, history, ledger, async close() { await Promise.all(ledgers.map(value => value.close())); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("public-price estimates survive per-entry pagination, category and SQL total aggregation", async () => {
  const f = fixture(); try {
    const s = f.session(), missing = { input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 0 };
    const row = entry("unpriced"); row.message.model = "glm-5.3"; row.message.usage = { ...missing, cost: usage(0, 0).cost };
    const recorded = entry("recorded"); recorded.message.model = "glm-5.3";
    const unpriced = { ...missing, totalTokens: 3_100_000, cost: usage(0, 0).cost }, priced = { ...unpriced, cost: usage(0, .7).cost };
    const checkpointUsage = { input: 2_000_000, output: 200_000, cacheRead: 4_000_000, cacheWrite: 0, totalTokens: 6_200_000, cost: priced.cost };
    f.history(s, [row, recorded, { type: "usage", id: "retry", kind: "native_compaction_attempt", provider: "fixture", model: "deepseek-v4.1-flash", usage: missing },
      { type: "compaction", id: "native", usage: checkpointUsage, details: { axiomNativeCompaction: { version: 1, calls: [priced, unpriced].map(usage => ({ provider: "fixture", model: "glm-5.3", usage })) } } }]);
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run("memory", s.id, "query", "fixture", "glm-5.3", JSON.stringify(missing), null);
    const ledger = f.ledger(), report = await ledger.read({ pageSize: 1 });
    assert.equal(report.count, 5); assert.equal(report.rows.length, 1); assert.equal(report.total.estimatedRecords, 4);
    assert.ok(Math.abs(report.total.estimatedCost! - 7.512) < 1e-10);
    assert.ok(Math.abs(report.total.knownCost - 8.222) < 1e-10);
    assert.equal(report.total.estimateSources?.length, 2);
    const all = await ledger.read({ pageSize: 100 });
    assert.equal(all.rows.find(row => row.category === "compression")?.estimatedRecords, 1);
    assert.ok(all.rows.filter(row => row.estimatedRecords).every(row => row.estimateSources?.[0].includes("https://")));
    assert.equal(all.rows.find(row => row.source === "记忆查询")?.estimatedRecords, 1);
    const main = await ledger.read({ rootSessionId: s.id, agentRole: "main", pageSize: 1 });
    assert.deepEqual(main.total, report.total, "filtered SQL totals and estimate sources must retain the whole matching set");
    const children = await ledger.read({ rootSessionId: s.id, agentRole: "subagent" });
    assert.equal(children.total.estimatedRecords, undefined); assert.equal(children.total.estimateSources, undefined); assert.equal(children.count, 0);
  } finally { await f.close(); }
});

test("per-entry pagination and all-filter totals share a stable snapshot, including readable-name search", async () => {
  const f = fixture(); try {
    f.history(f.session(), Array.from({ length: 30 }, (_, i) => entry(`a-${i}`, "fixture", 1700000000000 + i)));
    f.history(f.session(f.b), Array.from({ length: 15 }, (_, i) => entry(`b-${i}`, "other", 1700000001000 + i)), f.b);
    writeFileSync(join(f.models, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "local-model", name: "Readable model" }] } } }));
    const ledger = f.ledger(), first = await ledger.read(), second = await ledger.read({ snapshot: first.snapshot, page: 2 });
    assert.equal(first.count, 45); assert.equal(first.rows.length, 20); assert.equal(first.total.tokens.input, 4500); assert.equal(second.total.tokens.input, 4500);
    assert.equal(second.snapshot, first.snapshot); assert.equal(second.page, 2); assert.equal(second.rows.length, 20);
    assert.equal(first.rows.some(row => second.rows.some(next => row.id === next.id)), false);
    assert.equal((await ledger.read({ page: 3 })).rows.length, 5);
    const provider = await ledger.read({ providerId: "fixture", query: "Readable model" });
    assert.equal(provider.count, 30); assert.equal(provider.total.tokens.input, 3000); assert.equal(provider.rows[0].name, "Readable model");
    const space = await ledger.read({ workspaceId: f.b.id }); assert.equal(space.count, 15); assert.equal(space.total.tokens.input, 1500);
    assert.equal((await ledger.read({ from: 1700000001000 })).count, 15);
    assert.equal((await ledger.read({ providerId: null })).count, 0);
    assert.equal((await ledger.read({ query: "%" })).count, 0, "search treats LIKE wildcards literally");
    assert.equal((await ledger.read({ query: "none", page: 99 })).page, 1);
    assert.equal(ledger.workspaces().length, 2);
  } finally { await f.close(); }
});
test("paging never rescans a changed transcript; explicit refresh resets an obsolete snapshot to page one", async () => {
  const f = fixture(); try {
    const s = f.session(), file = f.history(s, Array.from({ length: 22 }, (_, i) => entry(String(i))));
    const ledger = f.ledger(), first = await ledger.read();
    appendFileSync(file, JSON.stringify(entry("later")) + "\n");
    assert.equal((await ledger.read({ page: 2, snapshot: first.snapshot })).count, 22);
    const next = await ledger.read({ page: 2, snapshot: first.snapshot, refresh: true });
    assert.equal(next.count, 23); assert.equal(next.page, 1); assert.notEqual(next.snapshot, first.snapshot); assert.ok(next.warnings.some(value => value.includes("第一页")));
  } finally { await f.close(); }
});
test("copied native fork entries are counted once while distinct historical branches and subagent calls remain", async () => {
  const f = fixture(); try {
    const original = f.session(), fork = f.session(), child = f.session();
    f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(original.id, fork.id);
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)")
      .run("task", f.a.id, original.id, child.id, "anchor", "child", Date.now());
    f.history(original, [entry("shared"), entry("discarded-branch")]);
    f.history(fork, [entry("shared"), entry("fork-only")]); f.history(child, [entry("child")]);
    const report = await f.ledger().read(); assert.equal(report.count, 4); assert.equal(report.total.records, 4); assert.equal(report.totalRoots, 2);
    assert.equal(report.rows.filter(row => row.category === "subagent").length, 1); assert.equal(report.partial, false);
  } finally { await f.close(); }
});
test("session directory is bounded metadata only, excluding child, deleted and archived sessions", async () => {
  const f = fixture(); try {
    const main = f.session(), child = f.session(), deleted = f.session(), foreign = f.session(f.b);
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)")
      .run("child-directory", f.a.id, main.id, child.id, "anchor", "child", Date.now());
    f.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(Date.now(), deleted.id);
    f.store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(f.b.id);
    f.history(main, [entry("PRIVATE_HISTORY_NOT_IN_DIRECTORY")]);
    const ledger = f.ledger(), directory = ledger.sessions();
    assert.equal(directory.truncated, false); assert.deepEqual(directory.sessions.map(row => row.id), [main.id]);
    assert.deepEqual(Object.keys(directory.sessions[0]).sort(), ["id", "title", "workspaceId", "workspaceName"].sort());
    assert.equal(JSON.stringify(directory).includes("PRIVATE_HISTORY"), false); assert.equal(Reflect.get(ledger, "cache").size, 0, "directory must not start a ledger snapshot");
    assert.deepEqual(ledger.sessions({ workspaceId: f.a.id }), directory);
    assert.throws(() => ledger.sessions({ workspaceId: f.b.id }), /工作空间不存在/);
    assert.throws(() => ledger.sessions({ workspaceId: "" }));
    for (const id of [child.id, deleted.id, foreign.id, "missing"]) await assert.rejects(ledger.read({ rootSessionId: id }), /会话不存在/);
    await assert.rejects(ledger.read({ workspaceId: f.b.id, rootSessionId: main.id }), /工作空间不存在/);
    assert.equal(Reflect.get(ledger, "cache").size, 0, "invalid selections must fail before scanning");
    for (let i = 0; i < 1001; i++) f.session();
    const bounded = ledger.sessions(); assert.equal(bounded.sessions.length, 1000); assert.equal(bounded.truncated, true);
  } finally { await f.close(); }
});
test("session and agent filters share one snapshot, including tool, compression, memory and unavailable accounting", async () => {
  const f = fixture(); try {
    const main = f.session(), other = f.session(), child = f.session(), missing = f.session(), foreign = f.session(f.b);
    for (const [i, s] of [child, missing].entries()) f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)")
      .run(`filter-child-${i}`, f.a.id, main.id, s.id, "anchor", "child", Date.now());
    for (const s of [main, child]) {
      f.history(s, [entry(`${s.id}-assistant`), { type: "message", id: `${s.id}-tool`, timestamp: 1700000000000, message: { role: "toolResult", toolName: "fixture-tool", usage: usage(2) } },
        { type: "compaction", id: `${s.id}-compression`, timestamp: 1700000000000, usage: usage(3) }]);
      f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run(`${s.id}-memory`, s.id, "title", "fixture", "local-model", JSON.stringify(usage(4)), 1700000000000);
    }
    f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(missing.id, join(f.root, "missing.jsonl"));
    const file = f.history(other, [entry("other")]); f.history(foreign, [entry("foreign")], f.b);
    f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run("child-aggregate", child.id, JSON.stringify({ id: "child-aggregate", state: "completed", phase: "done", selection: { provider: "fixture", id: "local-model" }, billing: sumCosts([usageCost(usage(5)), usageCost(usage(6))]) }));
    const ledger = f.ledger(), all = await ledger.read({ pageSize: 100 });
    const family = await ledger.read({ rootSessionId: main.id, pageSize: 100, snapshot: all.snapshot });
    assert.equal(family.snapshot, all.snapshot); assert.equal(family.count, 10); assert.equal(family.total.records, 11);
    for (const agentRole of ["main", "subagent"] as const) {
      const expected = all.rows.filter(row => row.rootSessionId === main.id && (agentRole === "main" ? row.sessionId === row.rootSessionId : row.sessionId !== row.rootSessionId));
      const filtered = await ledger.read({ rootSessionId: main.id, agentRole, pageSize: 2, snapshot: all.snapshot });
      const total = sumCosts(expected);
      assert.equal(filtered.snapshot, all.snapshot); assert.equal(filtered.count, expected.length); assert.equal(filtered.rows.length, 2);
      assert.equal(filtered.total.records, total.records); assert.deepEqual(filtered.total.tokens, total.tokens); assert.equal(filtered.total.unknownCost, total.unknownCost);
      assert.ok(Math.abs(filtered.total.knownCost - total.knownCost) < 1e-10);
      const whole = await ledger.read({ rootSessionId: main.id, agentRole, pageSize: 100 });
      assert.deepEqual(new Set(whole.rows.map(row => row.category)), new Set([agentRole, "tool", "compression", "other"]));
      assert.ok(whole.rows.every(row => expected.some(next => next.id === row.id)));
    }
    const combined = await ledger.read({ rootSessionId: main.id, agentRole: "subagent", providerId: "fixture", query: "会话标题", from: 1700000000000, to: 1700000000000 });
    assert.equal(combined.count, 1); assert.equal(combined.total.tokens.input, 4); assert.equal(combined.rows[0].sessionId, child.id);
    assert.equal((await ledger.read({ rootSessionId: other.id, agentRole: "subagent", page: 99 })).page, 1);
    assert.equal((await ledger.read({ rootSessionId: other.id, agentRole: "subagent" })).count, 0);
    await assert.rejects(ledger.read({ workspaceId: f.b.id, rootSessionId: main.id }), /所选工作空间/);
    appendFileSync(file, JSON.stringify(entry("new-after-snapshot")) + "\n");
    const stable = await ledger.read({ rootSessionId: other.id, agentRole: "main" });
    assert.equal(stable.count, 1); assert.equal(stable.snapshot, all.snapshot, "changing filters must not rescan changed histories");
    assert.equal((await ledger.read({ rootSessionId: other.id, refresh: true })).count, 2);
  } finally { await f.close(); }
});
test("session filtering preserves workspace fork deduplication instead of rebilling inherited entries", async () => {
  const f = fixture(); try {
    const original = f.session(), fork = f.session();
    f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(original.id, fork.id);
    f.history(original, [entry("shared"), entry("original-only")]); f.history(fork, [entry("shared"), entry("fork-only")]);
    const ledger = f.ledger(), all = await ledger.read(), a = await ledger.read({ rootSessionId: original.id }), b = await ledger.read({ rootSessionId: fork.id, agentRole: "main" });
    assert.equal(all.count, 3); assert.equal(a.count, 2); assert.equal(b.count, 1); assert.equal(a.total.records + b.total.records, all.total.records);
    assert.equal(a.snapshot, all.snapshot); assert.equal(b.snapshot, all.snapshot);
  } finally { await f.close(); }
});
test("multi-level fork attribution visits the parent before an earlier-sorting grandchild", async () => {
  const f = fixture(); try {
    const original = f.session(), descendants = [f.session(), f.session()].sort((a, b) => a.id.localeCompare(b.id));
    const [grandchild, parent] = descendants;
    assert.ok(grandchild.id < parent.id);
    f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(original.id, parent.id);
    f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(parent.id, grandchild.id);
    f.history(original, [entry("ancestor-shared")]);
    f.history(parent, [entry("ancestor-shared"), entry("parent-owned")]);
    f.history(grandchild, [entry("ancestor-shared"), entry("parent-owned"), entry("grandchild-owned")]);
    const ledger = f.ledger(), all = await ledger.read(); assert.equal(all.count, 3);
    for (const s of [original, parent, grandchild]) {
      const own = await ledger.read({ rootSessionId: s.id }); assert.equal(own.count, 1); assert.equal(own.snapshot, all.snapshot);
      assert.equal(own.rows[0].sessionId, s.id);
    }
    assert.equal(all.partial, false); assert.equal(all.scannedRoots, 3);
  } finally { await f.close(); }
});
test("verified ancestor caching preserves deduplication through a long in-scope fork chain", async () => {
  const f = fixture(); try {
    let previous: Session | undefined;
    for (let i = 0; i < 66; i++) {
      const s = f.session(); if (previous) f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(previous.id, s.id);
      f.history(s, [entry("chain-shared"), ...(i === 65 ? [entry("chain-tail-only")] : [])]); previous = s;
    }
    const ledger = f.ledger(), all = await ledger.read();
    assert.equal(all.count, 2); assert.equal(all.total.records, 2); assert.equal(all.partial, false);
    assert.equal(all.processedRoots, 66); assert.equal(all.scannedRoots, 66);
    assert.equal((await ledger.read({ rootSessionId: previous!.id })).count, 1);
  } finally { await f.close(); }
});
test("unverified deep lineage cannot create duplicate billing identities, while unique database accounting remains visible", async () => {
  const f = fixture(); try {
    const chain: Session[] = [];
    for (let i = 0; i < 66; i++) {
      const s = f.session(); if (i) f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(chain[i - 1].id, s.id);
      if (i > 0 && i < 65) f.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(Date.now(), s.id);
      chain.push(s);
    }
    const leaf = chain.at(-1)!;
    f.history(chain[0], [entry("deep-shared")]);
    f.history(leaf, [entry("deep-shared"), entry("unverified-tail"), { type: "message", id: "deep-tool", message: { role: "toolResult", toolName: "fixture", usage: usage(9) } },
      { type: "compaction", id: "deep-native", usage: usage(10) }]);
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run("verified-memory", leaf.id, "title", "fixture", "local-model", JSON.stringify(usage(7)), 1700000000000);
    f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run("verified-job", leaf.id, JSON.stringify({ id: "verified-job", state: "completed", phase: "done", selection: { provider: "fixture", id: "local-model" }, billing: usageCost(usage(8)) }));
    const ledger = f.ledger(), all = await ledger.read();
    assert.equal(all.count, 3); assert.equal(all.total.tokens.input, 115); assert.equal(all.partial, true);
    assert.equal(all.processedRoots, 2); assert.equal(all.scannedRoots, 1); assert.equal(all.building, false);
    assert.ok(all.warnings.some(warning => warning.includes("谱系上限")));
    const own = await ledger.read({ rootSessionId: leaf.id, agentRole: "main" });
    assert.equal(own.count, 2); assert.equal(own.total.tokens.input, 15); assert.deepEqual(new Set(own.rows.map(row => row.category)), new Set(["other", "compression"]));
  } finally { await f.close(); }
});
test("missing, invalid, cross-workspace and cyclic fork parents fail closed without dropping root progress", async () => {
  const f = fixture(); try {
    const foreign = f.session(f.b); f.history(foreign, [entry("valid-foreign")], f.b);
    for (const parent of ["missing-parent", "x".repeat(161), "", foreign.id, "self"]) {
      const s = f.session(); f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(parent === "self" ? s.id : parent, s.id);
      f.history(s, [entry("must-not-invent-origin")]);
    }
    const a = f.session(), b = f.session();
    f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(a.id, b.id);
    f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(b.id, a.id);
    f.history(a, [entry("cycle")]); f.history(b, [entry("cycle")]);
    const all = await f.ledger().read();
    assert.equal(all.count, 1); assert.equal(all.rows[0].sessionId, foreign.id); assert.equal(all.partial, true);
    assert.equal(all.totalRoots, 8); assert.equal(all.processedRoots, 8); assert.equal(all.scannedRoots, 1);
  } finally { await f.close(); }
});
test("compression keeps billing then native usage precedence, aggregates honestly, and does not add applied jobs twice", async () => {
  const f = fixture(); try {
    const s = f.session();
    const job = (id: string, billing?: unknown) => f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(id, s.id, JSON.stringify({ id, state: "completed", phase: "done", startedAt: 1700000000000, selection: { provider: "fixture", id: "local-model" }, usage: null, ...(billing ? { billing } : {}) }));
    job("old"); job("aggregate", sumCosts([usageCost(usage(200)), usageCost(usage(300))]));
    f.history(s, ["old", "aggregate"].map(id => ({ type: "compaction", id, timestamp: "2023-11-14T22:13:20Z", usage: usage(100), details: { axiomCompressionId: id } })));
    const report = await f.ledger().read(); assert.equal(report.count, 2); assert.equal(report.total.records, 3); assert.equal(report.total.tokens.input, 600);
    assert.equal(report.total.unknownTokens, 0); assert.equal(report.rows.find(row => row.kind === "aggregate")?.records, 2);
    assert.equal(report.total.tokens.cacheRead, 90);
  } finally { await f.close(); }
});
test("changed staged transcript rolls back compression deduplication without losing independent positive billing", async () => {
  const f = fixture(); try {
    const s = f.session();
    f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run("billed", s.id, JSON.stringify({ id: "billed", state: "completed", phase: "done", selection: { provider: "fixture", id: "local-model" }, billing: usageCost(usage(200, .7)) }));
    const file = f.history(s, [{ type: "compaction", id: "checkpoint", usage: usage(), details: { axiomCompressionId: "billed" } }, ...Array.from({ length: 30 }, (_, i) => entry(String(i)))]);
    const ledger = f.ledger({ bytes: 1024 });
    assert.equal((await ledger.read()).building, true);
    assert.equal((await ledger.read({ continue: true })).building, true);
    appendFileSync(file, JSON.stringify(entry("appended")) + "\n");
    const report = await finish(ledger);
    assert.equal(report.total.knownCost, .7); assert.equal(report.total.unknownCost, 1);
    assert.equal(report.rows.filter(row => row.category === "compression").length, 1);
    assert.equal(report.rows.some(row => row.source === "原始记录不可读取"), true);
  } finally { await f.close(); }
});

test("unknown timestamps remain unknown and memory/native namespaces cannot collide", async () => {
  const f = fixture(); try {
    const s = f.session(); f.history(s, [{ type: "usage", id: "same", kind: "tool:memory", provider: "fixture", model: "local-model", usage: usage() }]);
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run("same", s.id, "query", "fixture", "local-model", JSON.stringify(usage()), null);
    const report = await f.ledger().read(); assert.equal(report.count, 2); assert.ok(report.rows.every(row => row.timestamp === undefined));
    assert.equal((await f.ledger().read({ from: 0 })).count, 0);
  } finally { await f.close(); }
});
test("wrong-workspace, symlink, hardlink and missing transcripts are never accepted as verified calls or repaired", async () => {
  for (const mode of ["foreign", "symlink", "hardlink", "missing"]) {
    const f = fixture(); try {
      const s = f.session(), file = f.history(s, [entry("secret")], mode === "foreign" ? f.b : f.a), before = readFileSync(file);
      const alias = join(f.root, "alias");
      if (mode === "symlink") { symlinkSync(file, alias); f.store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(alias, s.id); }
      if (mode === "hardlink") linkSync(file, alias);
      if (mode === "missing") rmSync(file);
      const report = await f.ledger().read(); assert.equal(report.partial, true, mode); assert.equal(report.total.tokens.input, 0, mode); assert.equal(report.rows[0]?.kind, "unavailable", mode);
      assert.equal(report.scannedRoots, 0, "unreadable is not a completely verified family");
      if (mode !== "missing") assert.deepEqual(readFileSync(file), before);
    } finally { await f.close(); }
  }
});
test("row, file, line and cumulative database budgets produce explicit partial results", async () => {
  const f = fixture(); try {
    const s = f.session(); f.history(s, Array.from({ length: 10 }, (_, i) => entry(String(i))));
    const rows = await f.ledger({ rows: 3 }).read(); assert.equal(rows.count, 3); assert.equal(rows.partial, true); assert.equal(rows.scannedRoots, 0);
    assert.equal((await f.ledger({ bytes: 1 }).read()).partial, true);
    assert.equal((await f.ledger({ lineBytes: 1 }).read()).total.tokens.input, 0);
    for (let i = 0; i < 12; i++) f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run(String(i), s.id, "query", "fixture", "local-model", JSON.stringify(usage()), null);
    assert.equal((await f.ledger({ databaseRows: 5 }).read()).partial, true);
    const malformed = f.history(s, [entry("fine")]); appendFileSync(malformed, '{"type":"message"'); const before = readFileSync(malformed);
    const partial = await f.ledger().read(); assert.equal(partial.partial, true); assert.deepEqual(readFileSync(malformed), before);
  } finally { await f.close(); }
});
test("invalid filter values are rejected, never coerced into scans or unbounded pages", async () => {
  const f = fixture(); try {
    const ledger = f.ledger(); for (const input of [{ page: 0 }, { page: "2" }, { pageSize: 101 }, { workspaceId: "" }, { providerId: 7 }, { from: Infinity }, { from: 2, to: 1 }, { query: "x".repeat(201) }, { refresh: "true" }, { continue: "true" }, { rootSessionId: "" }, { rootSessionId: "x".repeat(161) }, { rootSessionId: 7 }, { agentRole: "all" }, { agentRole: null }, { agentRole: "tool" }]) assert.throws(() => ledger.read(input));
  } finally { await f.close(); }
});
test("balance estimate uses exact local current prices and absolute tokens only, not credits or historical charges", async () => {
  const f = fixture(); try {
    writeFileSync(join(f.models, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "local-model", cost: { input: 2, output: 10, cacheRead: .2, cacheWrite: 3 } }], modelOverrides: { "local-model": { cost: { output: 12 } } } } } }));
    const pricing = usageModelPricing(f.models, "fixture"), metric = { id: "tokens", label: "balance", kind: "tokens" as const, model: "local-model", remaining: 1_000_000, used: 100 };
    assert.deepEqual(estimateTokenBalance(metric, pricing), { low: .2, high: 12 });
    assert.deepEqual(estimateTokenBalance({ ...metric, part: "input" }, pricing), { low: 2, high: 2 });
    assert.equal(estimateTokenBalance({ ...metric, model: "upstream-copy" }, pricing), undefined);
    assert.equal(estimateTokenBalance({ ...metric, remaining: null }, pricing), undefined);
    assert.equal(estimateTokenBalance(metric, [{ ...pricing[0], tiered: true }]), undefined);
    assert.equal(estimateTokenBalance(metric, [{ model: "local-model", prices: { input: 2 } }]), undefined);
  } finally { await f.close(); }
});

async function finish(ledger: ModelUsageLedger, params: Parameters<ModelUsageLedger["read"]>[0] = {}) {
  let report = await ledger.read(params);
  for (let step = 0; report.building; step++) {
    assert.ok(step < 500, "bounded scans must make progress rather than repeat a prefix");
    report = await ledger.read({ ...params as object, snapshot: report.snapshot, continue: true });
  }
  return report;
}
test("continuation reaches later providers without rescanning pages or exposing unverified file prefixes", async () => {
  const f = fixture(); try {
    const sessions = [f.session(), f.session()].sort((a, b) => a.id < b.id ? -1 : 1);
    f.history(sessions[0], Array.from({ length: 12 }, (_, i) => entry(`heavy-${i}`, "early")));
    f.history(sessions[1], [entry("target", "later")]);
    const ledger = f.ledger({ bytes: 700 }), first = await ledger.read({ providerId: "later" });
    assert.equal(first.building, true); assert.equal(first.count, 0); assert.equal(first.total.records, 0);
    const page = await ledger.read({ snapshot: first.snapshot, page: 2, providerId: "later" });
    assert.equal(page.snapshot, first.snapshot, "record pages never advance the scan cursor");
    assert.equal(page.processedRoots, first.processedRoots);
    const complete = await finish(ledger, { providerId: "later" });
    assert.equal(complete.building, false); assert.equal(complete.partial, false); assert.equal(complete.count, 1);
    assert.equal(complete.total.tokens.input, 100); assert.equal(complete.processedRoots, 2); assert.equal(complete.scannedRoots, 2);
    assert.notEqual(complete.snapshot, first.snapshot);
    const all = await ledger.read(); assert.equal(all.count, 13); assert.equal(all.total.tokens.input, 1300);
    assert.equal((await ledger.read({ page: 2, snapshot: first.snapshot })).page, 1);
  } finally { await f.close(); }
});
test("large non-accounting compression bodies do not consume later families' scan budget", async () => {
  const f = fixture(); try {
    const sessions = [f.session(), f.session()].sort((a, b) => a.id < b.id ? -1 : 1);
    f.history(sessions[0], [entry("first", "early")]); f.history(sessions[1], [entry("target", "later")]);
    for (let i = 0; i < 8; i++) f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(`job-${i}`, sessions[0].id,
      JSON.stringify({ selection: { provider: "early", id: "local-model" }, startedAt: 1700000000000, state: "completed", phase: "done",
        billing: usageCost(usage(7)), summary: "PRIVATE_UNUSED_SNAPSHOT".repeat(10_000) }));
    const report = await finish(f.ledger({ bytes: 1024, databaseRows: 10 }));
    assert.equal(report.partial, false); assert.equal(report.processedRoots, 2); assert.equal(report.count, 10);
    assert.equal(report.total.tokens.input, 256); assert.ok(report.providers.includes("later"));
    assert.equal(JSON.stringify(report).includes("PRIVATE_UNUSED_SNAPSHOT"), false);
  } finally { await f.close(); }
});
test("a source changed between scan slices rolls back its entire staged transcript", async () => {
  const f = fixture(); try {
    const file = f.history(f.session(), Array.from({ length: 10 }, (_, i) => entry(String(i))));
    const ledger = f.ledger({ bytes: 700 }), first = await ledger.read(); assert.equal(first.building, true); assert.equal(first.count, 0);
    appendFileSync(file, JSON.stringify(entry("appended")) + "\n"); const bytes = readFileSync(file);
    const report = await finish(ledger); assert.equal(report.building, false); assert.equal(report.partial, true);
    assert.equal(report.total.tokens.input, 0); assert.equal(report.scannedRoots, 0); assert.equal(report.processedRoots, 1);
    assert.equal(report.rows[0]?.kind, "unavailable"); assert.deepEqual(readFileSync(file), bytes);
  } finally { await f.close(); }
});
test("a paused source replaced by a symlink to the same inode rolls back all staged calls", async () => {
  const f = fixture(); try {
    const file = f.history(f.session(), Array.from({ length: 12 }, (_, i) => entry(String(i))));
    const ledger = f.ledger({ bytes: 700 }), first = await ledger.read();
    assert.equal(first.building, true); assert.equal(first.count, 0);
    const held = `${file}.held`, bytes = readFileSync(file);
    renameSync(file, held); symlinkSync(held, file, "file");
    // Following stat still sees the original inode, size and timestamps. The
    // final path check must nevertheless reject the newly installed symlink.
    const report = await finish(ledger);
    assert.equal(report.building, false); assert.equal(report.partial, true);
    assert.equal(report.total.tokens.input, 0); assert.equal(report.scannedRoots, 0); assert.equal(report.processedRoots, 1);
    assert.equal(report.rows[0]?.kind, "unavailable"); assert.deepEqual(readFileSync(held), bytes);
  } finally { await f.close(); }
});
test("a single-source row cap cannot prevent following families from being verified", async () => {
  const f = fixture(); try {
    const sessions = [f.session(), f.session()].sort((a, b) => a.id < b.id ? -1 : 1);
    f.history(sessions[0], [entry("first", "early")]); f.history(sessions[1], [entry("target", "later")]);
    for (let i = 0; i < 6; i++) f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run(String(i), sessions[0].id, "query", "early", "local-model", JSON.stringify(usage()), null);
    const ledger = f.ledger({ sourceRows: 2, databaseRows: 3 }), report = await finish(ledger);
    assert.equal(report.building, false); assert.equal(report.partial, true); assert.equal(report.processedRoots, 2);
    assert.equal((await ledger.read({ providerId: "later" })).count, 1); assert.equal(report.count, 4);
    assert.equal(report.scannedRoots, 1);
  } finally { await f.close(); }
});
test("malformed or oversized database accounting stays explicit without blocking later sources", async () => {
  const f = fixture(); try {
    const s = f.session(); f.history(s, [entry("actual", "later")]);
    const insert = f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)");
    insert.run("broken", s.id, "{bad json"); insert.run("missing-selection", s.id, JSON.stringify({ state: "completed" }));
    insert.run("oversized-usage", s.id, JSON.stringify({ selection: { provider: "fixture", id: "local-model" }, state: "completed", phase: "done", usage: { input: 9, padding: "x".repeat(10_000) } }));
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run("memory", s.id, "query", "fixture", "local-model", JSON.stringify({ input: 5, padding: "x".repeat(20_000) }), null);
    const ledger = f.ledger({ bytes: 700 }), report = await finish(ledger);
    assert.equal(report.partial, true); assert.equal(report.building, false); assert.equal(report.count, 3);
    assert.equal(report.total.tokens.input, 100); assert.equal(report.total.unknownTokens, 2);
    assert.equal((await ledger.read({ providerId: "later" })).count, 1);
    assert.ok(report.warnings.some(warning => warning.includes("单行上限")));
    assert.equal(report.scannedRoots, 0);
  } finally { await f.close(); }
});
test("expired or evicted paused scans release their source state and restart with a fresh snapshot", async () => {
  const f = fixture(); try {
    f.history(f.session(), Array.from({ length: 4 }, (_, i) => entry(String(i))));
    f.history(f.session(f.b), [entry("other")], f.b);
    const ledger = f.ledger({ bytes: 700, ttl: 20 }), first = await ledger.read({ workspaceId: f.a.id });
    assert.equal(first.building, true);
    await new Promise(resolve => setTimeout(resolve, 50));
    const restarted = await ledger.read({ workspaceId: f.a.id, snapshot: first.snapshot, continue: true });
    assert.notEqual(restarted.snapshot, first.snapshot); assert.equal(restarted.count, 0);
    await ledger.read({ workspaceId: f.b.id }); await ledger.read();
    const evicted = await ledger.read({ workspaceId: f.a.id });
    assert.notEqual(evicted.snapshot, restarted.snapshot); assert.equal(evicted.count, 0);
    await ledger.close(); assert.throws(() => ledger.read());
  } finally { await f.close(); }
});
