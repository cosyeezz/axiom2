import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { Costs } from "../src/server/costs.js";
import { ModelUsageStatistics } from "../src/server/model-usage-statistics.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const reply = (amount: number, model = "model-one", provider: string | undefined = "fixture") => ({ role: "assistant", content: [{ type: "text", text: "fixture answer" }], stopReason: "stop", api: "openai-completions", provider, model,
  usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 10, totalTokens: 170, cost: { input: amount / 2, output: amount / 2, cacheRead: 0, cacheWrite: 0, total: amount } }, timestamp: Date.now() }) as any;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-statistics-")), store = new Store(root), costs = new Costs(store), tasks = new TaskRecords(store);
  store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(id),body TEXT NOT NULL); CREATE TABLE memory_usage(id TEXT PRIMARY KEY,sessionId TEXT,kind TEXT,provider TEXT,model TEXT,usage TEXT)");
  const project = (name: string) => { const path = join(root, name); mkdirSync(path); return store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path, authorized: true } }) as Workspace; };
  const first = project("first"), second = project("second");
  const session = (workspace: Workspace = first): Scope => {
    const value = store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: { title: "主会话" } }) as Session;
    return { workspaceId: workspace.id, sessionId: value.id };
  };
  const history = (scope: Scope, amount: number, model = "model-one", provider = "fixture") => {
    const manager = SessionManager.create(store.workspace(scope.workspaceId).path, join(root, "histories"));
    manager.appendMessage({ role: "user", content: "question", timestamp: 1 }); manager.appendMessage(reply(amount, model, provider));
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(scope.sessionId, manager.getSessionFile()!);
    return manager;
  };
  return { root, store, costs, tasks, first, second, session, history, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("global retained statistics count each root family once across workspaces, preserving models/categories/unknown values", async () => {
  const f = fixture();
  try {
    const parent = f.session(), another = f.session(), foreign = f.session(f.second);
    f.history(parent, .1); f.history(another, .2); f.history(foreign, .3, "second-model", "second-provider");
    const [task] = f.tasks.create(parent, "delegate", "fixture", [{ task: "Child" }], { provider: "fixture", id: "model-one", thinking: "off" }).taskIds;
    const child = { workspaceId: parent.workspaceId, sessionId: String(f.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(task)!.sessionId) };
    const childHistory = f.history(child, .4, "child-model"); childHistory.appendMessage({ ...reply(0, "unknown-price"), provider: undefined });
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?)").run("memory", parent.sessionId, "query", "fixture", "memory-model", JSON.stringify(reply(.5).usage));
    const statistics = new ModelUsageStatistics(f.store, f.costs), report = await statistics.read();
    assert.equal(report.totalRoots, 3); assert.equal(report.scannedRoots, 3); assert.equal(report.partial, false);
    assert.ok(Math.abs(report.total.knownCost - 1.5) < 1e-9); assert.equal(report.total.unknownCost, 1);
    assert.equal(report.byWorkspace.length, 2); assert.equal(report.models.find(m => m.model === "child-model")!.total.knownCost, .4);
    assert.equal(report.categories.find(c => c.category === "subagent")!.total.knownCost, .4);
    assert.equal(report.categories.find(c => c.category === "tool")!.total.knownCost, .5);
    assert.equal(report.models.find(m => m.model === "unknown-price")!.provider, null, "do not guess an unknown provider from current configuration");
    const fixtureProvider = report.providers.find(row => row.provider === "fixture")!;
    assert.ok(Math.abs(fixtureProvider.total.knownCost - 1.2) < 1e-9);
    assert.equal(fixtureProvider.byWorkspace.length, 1); assert.equal(fixtureProvider.byWorkspace[0].roots, 2);
    assert.equal(fixtureProvider.categories.find(row => row.category === "subagent")!.total.knownCost, .4);
    assert.equal(fixtureProvider.categories.find(row => row.category === "tool")!.total.knownCost, .5);
    assert.equal(report.providers.find(row => row.provider === "second-provider")!.byWorkspace[0].id, f.second.id);
    assert.equal(report.providers.find(row => row.provider === null)!.total.unknownCost, 1);
    assert.equal(report.providers.reduce((sum, row) => sum + row.total.tokens.input, 0), report.total.tokens.input);
    const local = await statistics.read(f.first.id); assert.equal(local.totalRoots, 2); assert.ok(Math.abs(local.total.knownCost - 1.2) < 1e-9);
    assert.equal(local.models.some(m => m.model === "second-model"), false);
  } finally { f.close(); }
});

test("statistics are single-flight and cache unchanged families without consuming session invalidations", async () => {
  const f = fixture();
  try {
    const scope = f.session(), history = f.history(scope, .1), original = f.costs.get.bind(f.costs);
    let parses = 0; f.costs.get = requested => { parses++; return original(requested); };
    const statistics = new ModelUsageStatistics(f.store, f.costs);
    const a = statistics.read(), b = statistics.read(); assert.equal(a, b);
    await a; assert.equal(parses, 1); assert.equal(f.costs.changed(scope), false);
    await statistics.read(); assert.equal(parses, 1);
    history.appendMessage(reply(.2));
    assert.ok(Math.abs((await statistics.read()).total.knownCost - .3) < 1e-9); assert.equal(parses, 2);
    assert.equal(f.costs.changed(scope), true, "statistics refresh cannot swallow an update owed to an existing cost view");
  } finally { f.close(); }
});

test("statistics exclude deleted roots and archived projects, and leave recovered legacy/trailing JSONL bytes unchanged", async () => {
  const f = fixture();
  try {
    const live = f.session(), deleted = f.session(), archived = f.session(f.second);
    const history = f.history(live, .1); f.history(deleted, 9); f.history(archived, 99);
    f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(deleted.sessionId);
    f.store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(f.second.id);
    const file = history.getSessionFile()!, lines = readFileSync(file, "utf8").trimEnd().split("\n"), header = JSON.parse(lines[0]);
    header.version = 1; lines[0] = JSON.stringify(header);
    writeFileSync(file, lines.join("\n") + '\n{"type":"message"');
    const before = readFileSync(file, "utf8"), report = await new ModelUsageStatistics(f.store, f.costs).read();
    assert.equal(report.totalRoots, 1); assert.equal(report.scannedRoots, 1);
    assert.equal(readFileSync(file, "utf8"), before, "statistics-only migration/recovery must not rewrite native history");
    assert.equal(report.workspaces.length, 1);
  } finally { f.close(); }
});

test("unreadable history remains unknown; bounded root/file/DB scans are explicitly partial instead of zero-complete", async () => {
  const f = fixture();
  try {
    const scope = f.session(), history = f.history(scope, .1); rmSync(history.getSessionFile()!);
    const report = await new ModelUsageStatistics(f.store, f.costs).read();
    assert.equal(report.total.unknownCost, 1); assert.ok(report.warnings.length > 0);
    const noRoots = await new ModelUsageStatistics(f.store, f.costs, { roots: 0, bytes: 1000, milliseconds: 3000 }).read();
    assert.equal(noRoots.partial, true); assert.equal(noRoots.scannedRoots, 0); assert.equal(noRoots.totalRoots, 1);
    f.history(scope, .1);
    const noBytes = await new ModelUsageStatistics(f.store, f.costs, { roots: 10, bytes: 1, milliseconds: 3000 }).read();
    assert.equal(noBytes.partial, true); assert.equal(noBytes.scannedRoots, 0);
    const history2 = f.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!;
    rmSync(String(history2.file)); f.store.db.prepare("UPDATE agent_sessions SET file=NULL WHERE sessionId=?").run(scope.sessionId);
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?)").run("oversize", scope.sessionId, "query", "fixture", "m", " ".repeat(1000));
    const noDbBytes = await new ModelUsageStatistics(f.store, f.costs, { roots: 10, bytes: 100, milliseconds: 3000 }).read();
    assert.equal(noDbBytes.partial, true); assert.equal(noDbBytes.scannedRoots, 0, "DB-only sources must obey size budget before parsing");
    const noDbRows = await new ModelUsageStatistics(f.store, f.costs, { roots: 10, bytes: 100000, milliseconds: 3000, databaseRows: 0 }).read();
    assert.equal(noDbRows.partial, true); assert.equal(noDbRows.scannedRoots, 0);
  } finally { f.close(); }
});

test("rejected preflights consume the cumulative database row budget instead of rescanning every family", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 4; index++) {
      const scope = f.session(); f.history(scope, .1);
      for (let record = 0; record < 10; record++) f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?)")
        .run(`${index}-${record}`, scope.sessionId, "query", "fixture", "m", JSON.stringify(reply(.1).usage));
    }
    let memoryScans = 0, versions = 0;
    const prepare = f.store.db.prepare.bind(f.store.db);
    f.store.db.prepare = sql => { if (sql.includes("AS bytes FROM memory_usage")) memoryScans++; return prepare(sql); };
    f.costs.version = () => { versions++; throw Error("over-budget family must not reach fingerprint parsing"); };
    const report = await new ModelUsageStatistics(f.store, f.costs, { roots: 10, bytes: 1000000, milliseconds: 3000, databaseRows: 5 }).read();
    assert.equal(report.partial, true); assert.equal(report.totalRoots, 4); assert.equal(report.scannedRoots, 0);
    assert.equal(memoryScans, 1, "the first rejected family exhausts the global row budget"); assert.equal(versions, 0);
  } finally { f.close(); }
});

test("size guards include large project names, titles, memory IDs and task IDs before loading accounting sources", async () => {
  for (const field of ["workspace-name", "root-title", "memory-id", "task-id"]) {
    const f = fixture();
    try {
      const scope = f.session(); f.history(scope, .1);
      const large = "x".repeat(20000);
      if (field === "workspace-name") f.store.db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(large, scope.workspaceId);
      if (field === "root-title") f.store.db.prepare("UPDATE sessions SET title=? WHERE id=?").run(large, scope.sessionId);
      if (field === "memory-id") f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?)").run(large, scope.sessionId, "query", "fixture", "m", JSON.stringify(reply(.1).usage));
      if (field === "task-id") {
        const child = f.session();
        // Insert with the large key from the start, preserving all foreign-key relationships.
        f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt,title) VALUES(?,?,?,?,?,?,'queued','{}',?,?)")
          .run(large, scope.workspaceId, scope.sessionId, child.sessionId, "fixture", "fixture", Date.now(), "Child");
      }
      let versions = 0;
      f.costs.version = () => { versions++; throw Error("oversize metadata must not be materialized by Costs"); };
      // The project-name case fits x4 but not the repeated owner/version/get workspace reads.
      const report = await new ModelUsageStatistics(f.store, f.costs, { roots: 10, bytes: field === "workspace-name" ? 200000 : 8192, milliseconds: 3000 }).read();
      assert.equal(report.partial, true, field); assert.equal(report.scannedRoots, 0, field); assert.equal(versions, 0, field);
    } finally { f.close(); }
  }
});

test("skipped families still yield to the event loop", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 8; index++) {
      const scope = f.session();
      f.tasks.create(scope, "delegate", "fixture", [{ task: "Child" }], { provider: "fixture", id: "model-one", thinking: "off" });
    }
    let yielded = false; setImmediate(() => { yielded = true; });
    const report = await new ModelUsageStatistics(f.store, f.costs, { roots: 10, bytes: 1000000, milliseconds: 3000, familySessions: 1 }).read();
    assert.equal(report.scannedRoots, 0); assert.equal(report.partial, true); assert.equal(yielded, true);
  } finally { f.close(); }
});
