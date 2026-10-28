// Real pool -> production compression worker -> production idle-writer apply.
// Host observer mirrors Compressions IPC handling; no HTTP server or real account.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Compression } from "../../src/shared/compression.js";
import type { ProcessingRecord } from "../../src/shared/processing.js";
import type { Session, Workspace } from "../../src/shared/protocol.js";

const [root, variant] = process.argv.slice(2);
assert.ok(root); assert.ok(["priced", "missing", "zero", "partial", "retry", "auth", "cancel", "aborted-result"].includes(variant));
assert.equal(process.env.HOME, join(root, "home")); assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, "sdk"));
process.env.AXIOM_FIXTURE_USAGE_CASE = variant;
Socket.prototype.connect = function () { throw Error("Socket forbidden in isolated Kiro compression host"); } as typeof Socket.prototype.connect;
globalThis.fetch = async () => { throw Error("Host HTTP forbidden in isolated Kiro compression fixture"); };

const pi = join(root, "pi"), cwd = join(root, "project"); mkdirSync(cwd);
const selection = { provider: "kiro", id: "compression-fixture", thinking: "off" as const };
const modelsRaw = JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{
  id: selection.id, contextWindow: 8192, maxTokens: 1024, baseUrl: "https://q.us-east-1.amazonaws.com",
  cost: { input: 2, output: 8, cacheRead: .5, cacheWrite: 3,
    tiers: [{ inputTokensAbove: 150, input: 20, output: 80, cacheRead: 5, cacheWrite: 30 }] },
}] } } });
writeFileSync(join(pi, "models.json"), modelsRaw);
writeFileSync(join(pi, "settings.json"), JSON.stringify({ packages: [], cacheWarming: "off", compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 } }));
const { SessionManager, convertToLlm } = await import("@earendil-works/pi-coding-agent");
const { normalizeContext, InMemoryCredentialStore, InMemoryModelsStore } = await import("@earendil-works/pi-ai");
const { createModelRuntime } = await import("../../src/server/model-runtime.js");
const { captureCompressionPrefix } = await import("../../src/server/compression-request.js");
const { ExecutionProfiles } = await import("../../src/server/execution-profile.js");
const { ExecutionPool } = await import("../../src/server/execution-pool.js");
const { sameLease } = await import("../../src/server/execution-protocol.js");
const { captureCompression, applyCompression } = await import("../../src/server/compression-context.js");
const { Store } = await import("../../src/server/storage.js");
const { TaskRecords } = await import("../../src/server/tasks/records.js");
const { ProcessingRecords } = await import("../../src/server/processing-records.js");
const { Costs } = await import("../../src/server/costs.js");
const { sumCosts } = await import("../../src/shared/costs.js");
const { usageCost } = await import("../../src/server/usage-cost.js");
const { kiroCompactionAttemptKind, kiroUsageInfo } = await import("../../src/shared/kiro-usage.js");
let store = new Store(root); new TaskRecords(store);
const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
const scope = { workspaceId: workspace.id, sessionId: session.id }, manager = SessionManager.create(cwd, join(root, "sessions"));
const oldUsage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
for (const [index, content] of ["EARLY_HISTORY", "CURRENT_REQUEST"].entries()) {
  manager.appendMessage({ role: "user", content, timestamp: index + 1 });
  manager.appendMessage({ role: "assistant", api: "kiro-chat", provider: "kiro", model: selection.id, timestamp: index + 1,
    stopReason: "stop", content: [{ type: "text", text: index ? "LATEST_REPLY".repeat(20) : "EARLY_REPLY" }], usage: oldUsage });
}
// Synthetic chat prefix for this worker-only harness; the main-chat capture is
// exercised separately through the real loopback agent tests.
const runtime = await createModelRuntime({ providerIds: [selection.provider], modelsPath: join(pi, "models.json"),
  credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
const model = runtime.getModel(selection.provider, selection.id)!;
assert.ok(model);
const request = captureCompressionPrefix(manager, selection, model,
  normalizeContext({ systemPrompt: "OWNED_CHAT_PREFIX", messages: convertToLlm(manager.buildSessionProjection().messages) }),
  { sessionId: manager.getSessionId(), cacheRetention: "short" });
const file = manager.getSessionFile()!, snapshot = captureCompression(manager), snapshotFile = join(root, "snapshot.jsonl");
writeFileSync(snapshotFile, [snapshot.header, ...snapshot.entries].map(entry => JSON.stringify(entry)).join("\n") + "\n");
store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, file);
store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL,body TEXT NOT NULL)");
const records = ProcessingRecords.for(store), id = records.start(scope, "compression", "Owned Kiro host fixture");
const job: Compression = { id, requestId: id, trigger: "manual", state: "running", phase: "snapshot", startedAt: Date.now(), endedAt: null,
  selection, summary: "", error: null, messageCount: 4, before: null, after: null, usage: null };
const save = () => store.db.prepare("INSERT INTO compressions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(id, session.id, JSON.stringify(job));
save();
const profiles = new ExecutionProfiles(root), pool = new ExecutionPool({ targetReadyTotal: 0 }, "managed");
const prepared = profiles.prepare({ entry: "compression", cwd, modelDir: pi, modelsRaw, selection, mode: "managed" });
assert.equal(prepared.reuse, "single-use");
const environment = { ...prepared, workerPath: fileURLToPath(new URL("./kiro-compression-worker.ts", import.meta.url)),
  execArgv: ["--import", import.meta.resolve("tsx"), "--import", new URL("../vite-assets.mjs", import.meta.url).href] };
let permits = 0, requests = 0, closed = false, terminal: any, completed: any, outcome = "";
const physical: any[] = [], billing: any[] = [];
try {
  const lease = await pool.acquire({ environment, kind: "compression-summary", signal: new AbortController().signal,
    requestStartedAtMonoMs: performance.now(), beforeExecute: () => { assert.equal(requests, 0); permits++; } });
  const child = await lease.ensureReady();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { void pool.retire(lease.ref, "fixture_timeout", true); reject(Error("Real compression worker did not close")); }, 20_000);
    child.once("error", reject);
    child.on("message", (event: any) => {
      try {
        if (event.type === "fixture_request") {
          assert.ok(permits > 0, "HTTP can only occur after the pool execution permit"); requests = event.count;
          if (variant === "cancel") child.send({ type: "stop", lease: lease.ref });
          return;
        }
        if (!sameLease(event.lease, lease.ref)) return;
        if (event.type === "phase") { job.phase = "summarizing"; save(); }
        if (event.type === "model_call") { records.callStart(id, "生成摘要", event.input, selection, event.id); records.callSent(id, event.id); }
        if (event.type === "model_result") { physical.push(event); records.callFinish(id, event.id, event.output, event.error, event.usage); }
        if (event.type === "billing") { job.billing = event.billing; billing.push(event.billing); save(); }
        if (event.type === "completed") { completed = event; outcome = "completed"; }
        if (event.type === "failed" || event.type === "cancelled") { terminal = event; outcome = event.type; }
        if (event.type === "closed") closed = true;
      } catch (error) { reject(error); void pool.retire(lease.ref, "fixture_assertion", true); }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      try { assert.equal(code, 0); assert.equal(signal, null); assert.equal(closed, true); resolve(); } catch (error) { reject(error); }
    });
    child.send({ type: "start", lease: lease.ref, input: { executionGate: true, root, cwd, file: snapshotFile, modelsFile: environment.modelsFile, selection, request } },
      error => { if (error) reject(error); });
  });
  await lease.released;
  assert.equal(permits, 1); assert.ok(billing.length >= 2); assert.equal(billing[0].records, 1); assert.equal(billing[0].unknownCost, 1);
  assert.equal(physical.length, requests); assert.equal(job.billing?.records, requests);
  assert.deepEqual(job.billing, sumCosts(physical.map(event => usageCost(event.usage))));
  assert.ok(physical.every(event => kiroUsageInfo(event.usage)?.scope === "request"));
  const success = !["auth", "cancel", "aborted-result"].includes(variant);
  assert.equal(outcome, success ? "completed" : variant === "cancel" ? "cancelled" : "failed");
  const scratch = SessionManager.open(snapshotFile);
  assert.equal(scratch.getEntries().filter(entry => entry.type === "usage" && entry.kind === kiroCompactionAttemptKind).length, 0,
    "external billing remains the scratch worker's sole physical ledger");
  if (success) {
    assert.ok(completed); assert.equal(terminal, undefined);
    const info = kiroUsageInfo(completed.entry.usage);
    if (info?.scope !== "summary") throw Error("missing outgoing summary marker");
    assert.equal(info.requests.length, 2);
    assert.equal(info.state, variant === "missing" ? "unknown" : variant === "partial" ? "partial" : "complete");
    assert.deepEqual(kiroUsageInfo(completed.usage), info);
    const native = scratch.getEntries().find(entry => entry.type === "compaction");
    assert.ok(native?.type === "compaction"); assert.deepEqual(native.usage, completed.entry.usage);
    assert.equal(applyCompression(manager, snapshot, completed.entry, id), true);
    const bytes = readFileSync(file, "utf8");
    assert.equal(applyCompression(SessionManager.open(file), snapshot, completed.entry, id), false);
    assert.equal(readFileSync(file, "utf8"), bytes);
    job.state = "completed"; job.phase = "done"; job.appliedAt = Date.now(); job.summary = completed.summary;
    job.usage = completed.usage; job.before = completed.before; job.after = completed.after;
    assert.equal(completed.usage.cost, variant === "missing" || variant === "partial" ? null : variant === "zero" ? 0 : job.billing!.knownCost);
    assert.equal(completed.usage.cacheRead, variant === "zero" || variant === "missing" ? 0 : 6);
    assert.equal(completed.usage.cacheWrite, variant === "zero" || variant === "missing" ? 0 : 8);
  } else {
    assert.equal(completed, undefined); assert.ok(terminal);
    assert.equal(scratch.getEntries().some(entry => entry.type === "compaction"), false);
    assert.equal(SessionManager.open(file).getEntries().some(entry => entry.type === "compaction"), false);
    job.state = variant === "cancel" ? "cancelled" : "failed"; job.error = terminal.error ?? "fixture cancelled";
  }
  job.endedAt = Date.now(); save(); records.syncCompression(scope, job);
  const expectedBilling = job.billing, expectedJob = JSON.parse(JSON.stringify(job));
  store.close(); store = new Store(root);
  const reopenedJob = JSON.parse(String(store.db.prepare("SELECT body FROM compressions WHERE id=?").get(id)!.body));
  assert.deepEqual(reopenedJob, expectedJob);
  const record = ProcessingRecords.for(store).command({ op: "processing.get", requestId: randomUUID(), workspaceId: workspace.id, params: { id } }) as ProcessingRecord;
  assert.equal(record.calls.length, requests); assert.equal(record.state, job.state);
  assert.ok(record.calls.every(call => kiroUsageInfo(call.usage)?.scope === "request"));
  const report = new Costs(store).get(scope), rows = report.rows.filter(row => row.category === "compression");
  assert.equal(rows.length, 1, "job billing and applied summary are never billed twice");
  assert.deepEqual(sumCosts(rows), expectedBilling);
  if (success) {
    const compactions = SessionManager.open(file).getEntries().filter(entry => entry.type === "compaction");
    assert.equal(compactions.length, 1); assert.deepEqual(kiroUsageInfo(compactions[0].usage), kiroUsageInfo(job.usage));
  }
  await pool.close(); assert.equal(pool.stats().total, 0);
  console.log(JSON.stringify({ variant, requests, outcome, physical: physical.length, billing: expectedBilling,
    applied: success ? 1 : 0, childrenClosed: closed, permits }));
} finally {
  await pool.close(); environment.release(); store.close(); assert.equal(profiles.size, 0);
}
