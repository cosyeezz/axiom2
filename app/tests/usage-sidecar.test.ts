import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, getPriority } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Store } from "../src/server/storage.js";
import { UsageSidecar } from "../src/server/usage-sidecar.js";
import { UsageSidecarEngine, usageView } from "../src/server/usage-sidecar-engine.js";
import { usageCost } from "../src/server/usage-cost.js";
import type { ModelUsageStatistics, UsageRecordFilter, UsageRecordPage } from "../src/shared/model-usage.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const usage = (input = 100, cost = .01) => ({ input, output: 20, cacheRead: 0, cacheWrite: 0, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
const entry = (id: string, input = 100) => ({ type: "message", id, timestamp: 1700000000000, message: { role: "assistant", provider: "fixture", model: "local", stopReason: "stop", usage: usage(input), content: [{ type: "text", text: "PRIVATE_TRANSCRIPT_MUST_NOT_BE_INDEXED" }] } });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-sidecar-")), data = join(root, "data"), models = join(root, "models"); mkdirSync(models);
  const store = new Store(data);
  store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT,body TEXT); CREATE TABLE memory_usage(id TEXT PRIMARY KEY,sessionId TEXT,kind TEXT,provider TEXT,model TEXT,usage TEXT,createdAt INTEGER)");
  const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const session = () => store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: { title: "sidecar fixture" } }) as Session;
  const history = (value: Session, rows: unknown[]) => {
    const file = join(root, `${value.id}.jsonl`);
    writeFileSync(file, [JSON.stringify({ type: "session", id: crypto.randomUUID(), version: 3, cwd: root }), ...rows.map(row => JSON.stringify(row))].join("\n") + "\n");
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(value.id, file); return file;
  };
  const engines = new Set<UsageSidecarEngine>(), managers = new Set<UsageSidecar>();
  const engine = () => { const value = new UsageSidecarEngine(data, models, { pauseMs: 0, pollMs: 0, cooldownMs: 0 }); engines.add(value); return value; };
  const manager = () => { const value = new UsageSidecar(store, models, { pauseMs: 0, pollMs: 20, cooldownMs: 0, initialDelayMs: 0 }); managers.add(value); return value; };
  return { root, data, models, store, workspace, session, history, engine, manager,
    async stop(value: UsageSidecarEngine) { engines.delete(value); await value.close(); },
    async close() { await Promise.all([...engines].map(value => value.close())); await Promise.all([...managers].map(value => value.close())); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const page = (engine: UsageSidecarEngine, params: UsageRecordFilter = {}) => engine.read(params) as UsageRecordPage;
async function eventually<T>(read: () => T | Promise<T>, valid: (value: T) => boolean, timeout = 12_000) {
  const start = Date.now(); let value = await read();
  while (!valid(value) && Date.now() - start < timeout) { await sleep(25); value = await read(); }
  assert.ok(valid(value), `condition not reached in ${timeout}ms: ${JSON.stringify(value).slice(0, 500)}`); return value;
}

test("reads only prepared views, shares full aggregates, and never writes the source", async () => {
  const f = fixture(); try {
    f.history(f.session(), Array.from({ length: 25 }, (_, i) => entry(String(i))));
    const engine = f.engine(), params = { analytics: true, timeZone: "UTC", pageSize: 10 };
    const initial = page(engine, params); assert.equal(initial.building, true); assert.equal(initial.updatedAt, 0);
    assert.equal(initial.background?.state, "preparing");
    await engine.tick(); const ready = page(engine, params);
    assert.equal(ready.count, 25); assert.equal(ready.rows.length, 10); assert.equal(ready.total.tokens.input, 2500);
    assert.equal(ready.analytics?.trend.reduce((sum, item) => sum + item.count, 0), 25); assert.equal(ready.background?.state, "ready");
    const builder = Reflect.get(engine, "ledger"); builder.read = () => { throw Error("foreground source scan"); }; builder.queryPublished = () => { throw Error("foreground aggregate"); };
    ready.total.tokens.input = -1;
    const hot = page(engine, params); assert.equal(hot.total.tokens.input, 2500); assert.equal(hot.snapshot, ready.snapshot);
    const next = page(engine, { ...params, page: 2, snapshot: ready.snapshot }); assert.equal(next.building, true); assert.equal(next.page, 2);
    assert.equal(page(engine, { ...params, query: "unprepared filter" }).building, true);
    assert.throws(() => engine.source.exec("UPDATE workspaces SET name='forbidden'"), /readonly|read.only/i);
    assert.equal(f.store.db.prepare("SELECT name FROM workspaces WHERE id=?").get(f.workspace.id)!.name, f.workspace.name);
    const stored = engine.materialized.db.prepare("SELECT data FROM usage_records").all().map(row => row.data).join("");
    assert.equal(stored.includes("PRIVATE_TRANSCRIPT"), false);
  } finally { await f.close(); }
});

test("restart reuses persisted publication and views before any source rebuild", async () => {
  const f = fixture(); try {
    f.history(f.session(), [entry("one"), entry("two")]); const first = f.engine(); page(first); await first.tick(); const before = page(first);
    await f.stop(first); const after = f.engine();
    Reflect.get(after, "ledger").read = () => { throw Error("must not rebuild while serving"); };
    const reused = page(after); assert.equal(reused.count, 2); assert.equal(reused.snapshot, before.snapshot); assert.equal(reused.updatedAt, before.updatedAt);
    assert.ok(reused.background?.publishedAt); assert.equal(readFileSync(join(f.data, "cache/usage/v1.sqlite")).includes(Buffer.from("PRIVATE_TRANSCRIPT")), false);
  } finally { await f.close(); }
});

test("file append, replacement, and in-place compression corrections replace generations without double charge", async () => {
  const f = fixture(); try {
    const session = f.session(), file = f.history(session, [entry("first")]), engine = f.engine(); page(engine); await engine.tick(); const first = page(engine);
    appendFileSync(file, JSON.stringify(entry("appended")) + "\n");
    assert.equal(page(engine).count, 1, "reads cannot synchronously discover or calculate appended usage");
    await engine.tick(); assert.equal(page(engine).count, 2); assert.notEqual(page(engine).snapshot, first.snapshot);
    f.history(session, [entry("first", 700)]); await engine.tick(); assert.equal(page(engine).count, 1); assert.equal(page(engine).total.tokens.input, 700);
    const job = { id: "compression", state: "completed", phase: "done", selection: { provider: "fixture", id: "local" }, billing: usageCost(usage(200, .5)) };
    f.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(job.id, session.id, JSON.stringify(job));
    await engine.tick(); assert.equal(page(engine).count, 2); assert.equal(page(engine).total.tokens.input, 900);
    job.billing = usageCost(usage(900, .9)); f.store.db.prepare("UPDATE compressions SET body=? WHERE id=?").run(JSON.stringify(job), job.id);
    await engine.tick(); const corrected = page(engine); assert.equal(corrected.count, 2); assert.equal(corrected.total.records, 2); assert.equal(corrected.total.tokens.input, 1600);
    assert.ok(Math.abs(corrected.total.knownCost - .91) < 1e-12); assert.equal(corrected.background?.verifiedThrough, corrected.updatedAt);
  } finally { await f.close(); }
});

test("publication failure and abandoned staging keep the prior complete view visible", async () => {
  const f = fixture(); try {
    const session = f.session(), file = f.history(session, [entry("first")]), engine = f.engine(); page(engine); await engine.tick(); const before = page(engine);
    appendFileSync(file, JSON.stringify(entry("second")) + "\n");
    const publish = engine.materialized.publish.bind(engine.materialized); engine.materialized.publish = () => { throw Error("simulated crash before head switch"); };
    await engine.tick(); const failed = page(engine); assert.equal(failed.count, 1); assert.equal(failed.snapshot, before.snapshot); assert.equal(failed.background?.state, "error");
    engine.materialized.publish = publish;
    const orphan = engine.materialized.begin(JSON.stringify(null)); engine.materialized.append(orphan, before.rows);
    await f.stop(engine); const restored = f.engine();
    assert.equal(page(restored).count, 1); assert.ok(Number(restored.materialized.db.prepare("SELECT count(*) AS n FROM usage_records WHERE generation=?").get(orphan.id)!.n) > 0, "startup serves persisted views before reclaiming invisible staging");
    await restored.tick(); assert.equal(page(restored).count, 2); assert.equal(page(restored).background?.state, "ready");
    assert.equal(restored.materialized.db.prepare("SELECT count(*) AS n FROM usage_records WHERE generation=?").get(orphan.id)!.n, 0);
  } finally { await f.close(); }
});

test("deletion and archive fail closed before stale financial views can be served", async () => {
  const f = fixture(); try {
    const session = f.session(); f.history(session, [entry("first")]); const engine = f.engine();
    page(engine); page(engine, { workspaceId: f.workspace.id, rootSessionId: session.id }); await engine.tick(); assert.equal(page(engine).count, 1);
    f.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(Date.now(), session.id);
    assert.equal(page(engine).building, true); assert.equal(page(engine).count, 0);
    assert.throws(() => page(engine, { rootSessionId: session.id }), /会话不存在/);
    await engine.tick(); assert.equal(page(engine).count, 0); assert.equal(page(engine).building, false);
    f.store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(f.workspace.id);
    assert.throws(() => page(engine, { workspaceId: f.workspace.id }), /工作空间不存在/);
  } finally { await f.close(); }
});

test("deleted subagent sources immediately invalidate cached views and stay excluded after rebuilding", async () => {
  const f = fixture(); try {
    const main = f.session(), child = f.session();
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)")
      .run("child-task", f.workspace.id, main.id, child.id, "anchor", "child", Date.now());
    f.history(main, [entry("main")]); f.history(child, [entry("child")]); const engine = f.engine(); page(engine); await engine.tick(); assert.equal(page(engine).count, 2);
    f.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(Date.now(), child.id);
    assert.equal(page(engine).building, true); assert.equal(page(engine).count, 0);
    await engine.tick(); const rebuilt = page(engine); assert.equal(rebuilt.count, 1); assert.equal(rebuilt.rows[0].sessionId, main.id); assert.equal(rebuilt.partial, false);
  } finally { await f.close(); }
});

test("a transient materialization failure clears after successful view-only retry", async () => {
  const f = fixture(); try {
    f.history(f.session(), [entry("first")]); const engine = f.engine(); page(engine); await engine.tick();
    const save = engine.materialized.save.bind(engine.materialized); engine.materialized.save = () => { throw Error("temporary derived writer failure"); };
    const params = { providerId: "fixture" }; page(engine, params); await engine.tick(); assert.equal(page(engine, params).background?.state, "error");
    engine.materialized.save = save;
    for (const failure of Reflect.get(engine, "viewFailures").values()) failure.retryAt = 0;
    Reflect.get(engine, "ledger").read = () => { throw Error("view retry must not rebuild sources"); };
    await engine.tick(); const ready = page(engine, params); assert.equal(ready.count, 1); assert.equal(ready.background?.state, "ready");
  } finally { await f.close(); }
});

test("an oversized view cannot starve other prepared views in the same scope", async () => {
  const f = fixture(); try {
    const rows = Array.from({ length: 3500 }, (_, i) => { const row = entry(String(i)); row.message.model = `${i}-${"m".repeat(150)}`; return row; });
    f.history(f.session(), rows); const engine = f.engine(), good = { providerId: "fixture", pageSize: 1 };
    engine.read({}, "statistics"); page(engine, good);
    engine.materialized.db.prepare("UPDATE views SET touched=? WHERE key=?").run(Date.now() + 1000, usageView({}, "statistics").key);
    await engine.tick();
    assert.equal(engine.read({}, "statistics").background?.state, "error");
    const ready = page(engine, good); assert.equal(ready.count, 3500); assert.equal(ready.background?.state, "ready"); assert.equal(ready.rows.length, 1);
  } finally { await f.close(); }
});

test("publication metadata remains fail-closed when a subagent is deleted during final verification", async () => {
  const f = fixture(); try {
    const main = f.session(), child = f.session();
    f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)")
      .run("race-task", f.workspace.id, main.id, child.id, "anchor", "child", Date.now());
    f.history(main, [entry("main")]); f.history(child, [entry("child")]); const engine = f.engine(); page(engine);
    const prepare = engine.source.prepare.bind(engine.source); let deleted = false;
    engine.source.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (sql.startsWith("SELECT s.id,s.workspaceId,s.deletedAt")) {
        const all = statement.all.bind(statement);
        statement.all = (...args: any[]) => { const rows = all(...args); if (!deleted) { deleted = true; f.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(Date.now(), child.id); } return rows; };
      }
      return statement;
    };
    await engine.tick(); assert.equal(deleted, true);
    assert.equal(page(engine).count, 0); assert.equal(page(engine).building, true, "never authenticate the new deleted state against pre-deletion accounting");
    await engine.tick(); assert.equal(page(engine).count, 1);
  } finally { await f.close(); }
});

test("derived writer rejects file and directory aliases without modifying the source", async () => {
  for (const mode of ["database-symlink", "database-hardlink", "wal-symlink", "directory-symlink"]) {
    const f = fixture(); try {
      const cache = join(f.data, "cache"), directory = join(cache, "usage"), source = join(f.data, "axiom.sqlite");
      if (mode === "directory-symlink") symlinkSync(f.data, cache);
      else {
        mkdirSync(directory, { recursive: true }); const target = join(directory, mode === "wal-symlink" ? "v1.sqlite-wal" : "v1.sqlite");
        if (mode === "database-hardlink") linkSync(source, target); else symlinkSync(source, target);
      }
      assert.throws(() => f.engine(), /unsafe usage cache/, mode);
      assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='usage_records'").get(), undefined);
      assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM workspaces").get()!.n, 1);
    } finally { await f.close(); }
  }
});

test("bounded query registry and derived legacy statistics use the same accounting publication", async () => {
  const f = fixture(); try {
    f.history(f.session(), [entry("first"), entry("second")]); const engine = f.engine();
    for (let i = 0; i < 50; i++) page(engine, { query: String(i) });
    assert.equal(engine.materialized.db.prepare("SELECT count(*) AS n FROM views").get()!.n, 32);
    assert.equal((engine.read({}, "statistics") as ModelUsageStatistics).updatedAt, 0);
    await engine.tick(); const stats = engine.read({}, "statistics") as ModelUsageStatistics;
    assert.equal(stats.total.records, 2); assert.equal(stats.total.tokens.input, 200); assert.equal(stats.models.length, 1); assert.equal(stats.providers[0].byWorkspace[0].roots, 1);
    assert.equal(usageView({ providerId: null }).key === usageView({}).key, false);
    assert.equal(usageView({ query: "", refresh: true, continue: true, snapshot: "ignored" }).key, usageView({}).key);
  } finally { await f.close(); }
});

test("child lifecycle is low-priority, bounded, recovers from worker loss, and never blocks source writes", async () => {
  const f = fixture(); try {
    const session = f.session(); f.history(session, [entry("first")]); const sidecar = f.manager();
    const cold = await sidecar.read(); assert.equal(cold.building, true); assert.equal(sidecar.status.pid, undefined);
    sidecar.start(); const ready = await eventually(() => sidecar.read(), value => value.count === 1 && !value.building);
    assert.ok(sidecar.status.pid); assert.ok(getPriority(sidecar.status.pid!) >= 10);
    const pid = sidecar.status.pid!; process.kill(pid, "SIGSTOP");
    try {
      const reads = Array.from({ length: 80 }, () => sidecar.read());
      const started = performance.now(); f.store.db.prepare("UPDATE sessions SET title='main write remains independent' WHERE id=?").run(session.id);
      assert.ok(performance.now() - started < 100); await Promise.all(reads);
      assert.equal(sidecar.status.pending, 16, "timeouts must not free still-in-flight IPC slots");
    } finally { process.kill(pid, "SIGCONT"); }
    await eventually(() => sidecar.status.pending, value => value === 0);
    process.kill(pid, "SIGKILL");
    await eventually(() => sidecar.status, value => value.restarts >= 1);
    const resumed = await eventually(() => sidecar.read(), value => value.count === 1 && !value.building);
    assert.ok(resumed.updatedAt >= ready.updatedAt); assert.notEqual(sidecar.status.pid, pid);
    const closed = performance.now(); await sidecar.close(); assert.ok(performance.now() - closed < 2000);
  } finally { await f.close(); }
});
