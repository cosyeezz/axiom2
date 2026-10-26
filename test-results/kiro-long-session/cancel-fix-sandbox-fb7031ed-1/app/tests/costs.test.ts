import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { Costs } from "../src/server/costs.js";
import { usageCost } from "../src/server/usage-cost.js";
import { costAmount, costTokens, emptyCostTotals, sumCosts } from "../src/shared/costs.js";
import type { Compression } from "../src/shared/compression.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const usage = (amount: number) => ({ input: 100, output: 20, cacheRead: 40, cacheWrite: 10, totalTokens: 170,
  cost: { input: amount / 2, output: amount / 4, cacheRead: amount / 8, cacheWrite: amount / 8, total: amount } });
const reply = (amount: number, model = "model-one") => ({ role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop", api: "openai-completions", provider: "fixture", model, usage: usage(amount), timestamp: Date.now() }) as any;
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "axiom-costs-"));
  const cwd = join(directory, "project"); mkdirSync(cwd);
  const store = new Store(directory), tasks = new TaskRecords(store), costs = new Costs(store);
  store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL REFERENCES sessions(id),body TEXT NOT NULL)");
  const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const create = () => store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: { title: "主会话" } }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: create().id };
  const transcript = (id: string) => {
    const manager = SessionManager.create(cwd, join(directory, "sessions"));
    manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
    manager.appendMessage(reply(0.1));
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(id, manager.getSessionFile()!);
    return manager;
  };
  const job = (id: string, sessionId: string, overrides: Partial<Compression> = {}) => {
    const value: Compression = { id, requestId: id, state: "completed", phase: "done", startedAt: 1700000000000, endedAt: 1700000001000,
      appliedAt: 1700000001000, messageCount: 3, before: 1000, after: 100, summary: "summary", error: null,
      selection: { provider: "summary", id: "summary-model" }, usage: { input: 100, output: 20, total: 170, cost: .2 }, ...overrides };
    store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(id, sessionId, JSON.stringify(value));
    return value;
  };
  return { directory, cwd, store, tasks, costs, scope, create, transcript, job, close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("costs include full main history, distinct children, compactions and tool models exactly once", () => {
  const f = fixture();
  try {
    const main = f.transcript(f.scope.sessionId);
    const old = main.appendMessage({ ...reply(.3, "requested-alias"), responseModel: "model-two" });
    main.appendContextEdit(old, null); // Billed retries/context edits still count.
    f.job("applied", f.scope.sessionId);
    main.appendCompaction("summary", null, 1000, { axiomCompressionId: "applied" }, true, usage(.2));
    const fork = main.appendMessage(reply(.4));
    main.branch(old);
    main.appendMessage(reply(.5));
    main.branch(fork); // Off-branch costs remain real historical spending.
    main.appendMessage({ role: "toolResult", toolName: "vision", toolCallId: "tool-1", content: [], isError: false, timestamp: 2, usage: usage(.6) });
    main.appendUsage("tool:search", "tool-provider", "search-model", usage(.7));
    main.appendUsage("cache_warm", "fixture", "model-one", usage(.8));
    f.job("unapplied", f.scope.sessionId, { state: "cancelled", phase: "applying", appliedAt: null, usage: { input: 100, output: 20, total: 170, cost: .9 } });
    const taskIds = f.tasks.create(f.scope, "delegate", "context", [{ task: "调查 A" }, { task: "调查 B" }], { provider: "fixture", id: "model-one", thinking: "off" }).taskIds;
    const childIds = taskIds.map((id) => String(f.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(id)!.sessionId));
    const child = f.transcript(childIds[0]);
    child.appendMessage({ ...reply(1, "requested-alias"), responseModel: "child-response-model" });
    f.transcript(childIds[1]);
    f.job("child-compression", childIds[0], { billing: sumCosts([usageCost(usage(1.1)), usageCost(usage(1.2))]) });
    child.appendCompaction("child summary", null, 1000, { axiomCompressionId: "child-compression" }, true, usage(2.3));
    // Another root in the same workspace must never bleed into this report.
    f.transcript(f.create().id).appendMessage(reply(99));
    const before = readFileSync(main.getSessionFile()!, "utf8");
    const report = f.costs.get(f.scope);
    const amount = (category: string) => sumCosts(report.rows.filter((row) => row.category === category)).knownCost;
    assert.ok(Math.abs(amount("main") - 1.3) < 1e-9);
    assert.ok(Math.abs(amount("subagent") - 1.2) < 1e-9);
    assert.ok(Math.abs(amount("compression") - 3.4) < 1e-9);
    assert.ok(Math.abs(amount("tool") - 1.3) < 1e-9);
    assert.equal(amount("other"), .8);
    assert.ok(Math.abs(report.total.knownCost - 8) < 1e-9);
    assert.equal(report.total.unknownCost, 0);
    assert.equal(report.sessions.length, 3);
    assert.equal(report.rows.filter((row) => row.category === "compression").length, 3);
    assert.equal(report.rows.find((row) => row.source === "vision")!.model, null, "never guess a tool model from agent selection");
    assert.equal(report.rows.find((row) => row.source === "search")!.model, "search-model");
    assert.equal(report.rows.find((row) => row.model === "model-two")!.knownCost, .3);
    assert.equal(report.rows.find((row) => row.model === "child-response-model")!.knownCost, 1);
    assert.ok(!report.rows.some((row) => row.model === "requested-alias"), "response model identifies actual main/child usage without repricing");
    assert.equal(report.rows.find((row) => row.status === "取消 · 未应用")!.unknownParts, 1);
    assert.equal(readFileSync(main.getSessionFile()!, "utf8"), before);
    const fromChild = f.costs.get({ ...f.scope, sessionId: childIds[0] });
    assert.deepEqual(fromChild.total, report.total);
    assert.equal(fromChild.requestedSessionId, childIds[0]);
    assert.equal(fromChild.scope.sessionId, f.scope.sessionId);
    assert.throws(() => f.costs.get({ ...f.scope, workspaceId: "foreign" }));
    assert.throws(() => f.costs.get({ ...f.scope, sessionId: "foreign" }));
  } finally { f.close(); }
});

test("unknown prices remain visible in mixed totals, and unreadable history never becomes zero", () => {
  const f = fixture();
  try {
    const main = f.transcript(f.scope.sessionId);
    main.appendMessage(reply(0));
    main.appendMessage({ ...reply(.2), usage: undefined });
    let report = f.costs.get(f.scope);
    assert.equal(report.total.knownCost, .1);
    assert.equal(report.total.unknownCost, 2);
    assert.equal(costAmount(report.total), "$0.1000 + 未知");
    assert.equal(report.total.unknownTokens, 1);
    rmSync(main.getSessionFile()!);
    report = f.costs.get(f.scope);
    assert.equal(report.warnings.length, 1);
    assert.equal(costAmount(report.total), "未知");
  } finally { f.close(); }
});

test("compression cancellations retain known partial usage; snapshot-only jobs incur no inferred charge", () => {
  const f = fixture();
  try {
    f.job("cancelled-before-request", f.scope.sessionId, { state: "cancelled", phase: "snapshot", appliedAt: null, usage: null });
    f.job("partial", f.scope.sessionId, { state: "failed", phase: "summarizing", appliedAt: null, usage: null,
      billing: sumCosts([usageCost(usage(.3)), usageCost(null)]) });
    f.job("legacy-failure", f.scope.sessionId, { state: "failed", phase: "summarizing", usage: null, appliedAt: null });
    const report = f.costs.get(f.scope);
    assert.equal(report.rows.length, 2);
    assert.equal(report.total.knownCost, .3);
    assert.equal(report.total.unknownCost, 2);
    assert.equal(costAmount(report.total), "$0.3000 + 未知");
  } finally { f.close(); }
});

test("cost invalidation ignores progress but tracks family, unknown records and late accounting writes", () => {
  const f = fixture();
  try {
    const main = f.transcript(f.scope.sessionId);
    f.costs.get(f.scope);
    assert.equal(f.costs.changed(f.scope), false);
    f.transcript(f.create().id).appendMessage(reply(99));
    assert.equal(f.costs.changed(f.scope), false, 'another owner is unrelated');
    main.appendMessage(reply(0));
    assert.equal(f.costs.changed(f.scope), true, 'unknown price is still a new record');
    assert.equal(f.costs.changed(f.scope), false);
    const [task] = f.tasks.create(f.scope, 'version-child', 'context', [{ task: 'child' }], { provider: 'fixture', id: 'model-one', thinking: 'off' }).taskIds;
    const childScope = { ...f.scope, sessionId: String(f.store.db.prepare('SELECT sessionId FROM tasks WHERE id=?').get(task)!.sessionId) };
    assert.equal(f.costs.changed(childScope), true, 'membership changes are visible from a child');
    assert.equal(f.costs.changed(f.scope), false, 'one baseline per family');
    f.transcript(childScope.sessionId);
    assert.equal(f.costs.changed(f.scope), true);
    f.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(task);
    assert.equal(f.costs.changed(f.scope), true, 'task state is part of the report');
    const job = f.job('late', childScope.sessionId, { state: 'cancelled', phase: 'summarizing', usage: null, appliedAt: null });
    assert.equal(f.costs.changed(f.scope), true);
    job.billing = usageCost(usage(.3));
    f.store.db.prepare('UPDATE compressions SET body=? WHERE id=?').run(JSON.stringify(job), job.id);
    assert.equal(f.costs.changed(f.scope), true, 'cancelled work can report late billing');
    f.store.db.exec('CREATE TABLE memory_usage(id TEXT PRIMARY KEY,sessionId TEXT,kind TEXT,provider TEXT,model TEXT,usage TEXT)');
    f.store.db.prepare('INSERT INTO memory_usage VALUES(?,?,?,?,?,?)').run('memory-charge', childScope.sessionId, 'query', 'fixture', 'model-one', JSON.stringify(usage(.1)));
    assert.equal(f.costs.changed(f.scope), true);
    f.store.db.prepare('UPDATE memory_usage SET usage=? WHERE id=?').run(JSON.stringify(usage(.2)), 'memory-charge');
    f.costs.get(childScope);
    assert.equal(f.costs.changed(f.scope), true, 'a direct read from one view must not consume a changed memory row notification owed to other views');
    assert.equal(f.costs.changed(f.scope), false);
    rmSync(main.getSessionFile()!);
    assert.equal(f.costs.changed(f.scope), true, 'lost transcript must expose incomplete accounting');
  } finally { f.close(); }
});

test("cost reports expose task titles without task contents and invalidate title changes", () => {
  const f = fixture();
  try {
    const { taskIds } = f.tasks.create(f.scope, "titles", "context", [
      { title: "核对费用", task: "完整任务正文不应出现在费用明细中" },
      { task: "历史任务正文同样不应作为标题" },
    ], { provider: "fixture", id: "model-one", thinking: "off" });
    const children = taskIds.map(id => String(f.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(id)!.sessionId));
    children.forEach(id => f.transcript(id));
    const report = f.costs.get(f.scope);
    assert.deepEqual(children.map(id => report.sessions.find(session => session.id === id)!.title), ["核对费用", "子任务"]);
    assert.ok(!JSON.stringify(report).includes("任务正文"));
    assert.equal(f.costs.changed(f.scope), false);
    f.store.db.prepare("UPDATE tasks SET title=? WHERE id=?").run("复核账单", taskIds[0]);
    assert.equal(f.costs.changed(f.scope), true);
    assert.equal(f.costs.get(f.scope).sessions.find(session => session.id === children[0])!.title, "复核账单");
  } finally { f.close(); }
});

test("token totals include cache usage and distinguish empty, zero and unknown records", () => {
  assert.equal(costTokens(emptyCostTotals()), "—");
  assert.equal(costTokens(sumCosts([usageCost(usage(.1)), usageCost(usage(.2))])), "340");
  assert.equal(costTokens(usageCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })), "0");
  assert.equal(costTokens(usageCost(null)), "未知");
  assert.equal(costTokens(sumCosts([usageCost(usage(.1)), usageCost(null)])), "170 + 未知");
  assert.equal(costTokens(usageCost({ input: 100, output: 20 })), "120 + 未知");
});

test("recorded parts are finite and consistent; totals do not round before aggregation", () => {
  assert.equal(usageCost({ cost: { total: Infinity } }).unknownCost, 1);
  assert.equal(usageCost({ cost: { total: -1 } }).knownCost, 0);
  const records = Array.from({ length: 10 }, () => usageCost(usage(.00001)));
  assert.equal(costAmount(sumCosts(records)), "$0.0001");
  const inconsistent = usageCost({ ...usage(1), cost: { ...usage(1).cost, total: 5 } });
  assert.equal(inconsistent.knownCost, 5);
  assert.equal(inconsistent.unknownParts, 1);
  assert.equal(inconsistent.parts.input, 0);
});
