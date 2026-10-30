// Coordinator event/lease tests, deliberately separate from real-SDK observer evidence.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuns } from "../src/server/agents/runs.js";
import type { Run, Selection } from "../src/shared/agent.js";
import { AppError } from "../src/shared/protocol.js";

const provider = "openai-codex", api = "openai-codex-responses", credentialKey = "a".repeat(64), accountId = "1915f13b-3442-4aca-8705-db81023d1811";
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-quota-runs-")); mkdirSync(join(root, "execution-models"));
  const file = join(root, "models.json"); writeFileSync(file, "{}");
  const scope = { workspaceId: "workspace", sessionId: "session" }, selection: Selection = { provider, id: "fixture-A", thinking: "off" };
  let active = true;
  const store = { root, session(workspace: string, session: string) { if (workspace !== scope.workspaceId || session !== scope.sessionId) throw new AppError("NOT_FOUND", "wrong scope"); },
    bindingRejection() {}, finishRun() {}, db: { prepare() { return { run() {} }; } } };
  const views = { changed() {}, refresh() {}, flush() {}, settled() {}, recoverRequestUsage() {}, info() { return {}; }, messages: new Map(), queues: new Map() };
  const child = Object.assign(new EventEmitter(), { connected: true, exitCode: null as number | null, signalCode: null,
    send(_value: unknown, callback: () => void) { queueMicrotask(callback); return true; } });
  const close = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit("close"); } };
  const lease = { ref: { instanceId: "quota-fixture", generation: 1, leaseId: "lease-A" },
    environment: { modelsFile: file, current: () => true, snapshotValid: () => true, env: { AXIOM_MODEL_ACCOUNT_BINDINGS: JSON.stringify({ [provider]: accountId }) } }, ensureReady: async () => child };
  const pool = { limits: { prepareTimeoutMs: 30000 }, isActive: () => active && child.exitCode === null, hasAffinity: () => false,
    releaseAffinity: async () => {}, trim: async () => {}, invalidate: async () => {}, release: async () => {}, retire: async () => close() };
  const runs = new AgentRuns(store as any, views as any, () => {}, pool as any);
  (runs as any).kill = close;
  const run = { id: "run-A", sessionId: scope.sessionId, status: "starting", selection: { ...selection } } as Run;
  t.after(async () => { close(); await runs.close(); rmSync(root, { recursive: true, force: true }); });
  await runs.launch(scope, run, { root, cwd: root, file: join(root, "session.jsonl"), modelsFile: file, runId: run.id, selection, prompt: "fixture" } as any, lease as any);
  const emit = (event: Record<string, unknown>) => child.emit("message", { runId: run.id, lease: lease.ref, ...event });
  const request = (requestId = "physical-A", modelRevision = 0, selected = selection) => ({ type: "model-request", provider, api, selection: selected, requestId, modelRevision });
  const proof = (requestId = "physical-A", modelRevision = 0, selected = selection) => ({ ...request(requestId, modelRevision, selected), type: "model-account-proof", credentialKey });
  const target = () => runs.accountUsageTarget(scope);
  return { runs, run, scope, selection, emit, request, proof, target, lease, close, setActive: (value: boolean) => { active = value; } };
}

test("real receive requires a live acknowledged physical request and matching proof, and later requests revoke old proof", async t => {
  const f = await fixture(t); assert.equal(f.target(), null);
  f.emit({ type: "running" }); f.emit(f.request()); assert.equal(f.target(), null);
  f.emit(f.proof()); assert.equal(f.target()?.accountId, accountId); assert.equal(f.target()?.source, "execution");
  f.emit(f.request("physical-B")); assert.equal(f.target(), null);
  f.emit(f.proof("physical-A")); assert.equal(f.target(), null, "late same-model proof cannot revive old physical request");
  f.emit(f.proof("physical-B")); assert.equal(f.target()?.credentialKey, credentialKey);
  f.emit(f.proof("physical-A")); assert.equal(f.target()?.credentialKey, credentialKey, "late proof cannot overwrite valid new proof");
});

test("setModel clears proof until the applied selection and current revision make a new request; switching back cannot reuse an old generation", async t => {
  const f = await fixture(t), b = { ...f.selection, id: "fixture-B" }; f.emit({ type: "running" }); f.emit(f.request()); f.emit(f.proof()); assert.ok(f.target());
  f.runs.setModel(f.scope, b, "{}"); assert.equal(f.target(), null);
  f.emit({ type: "model-applied", selection: b }); assert.equal(f.target(), null);
  f.emit(f.request("old", 0)); f.emit(f.proof("old", 0)); assert.equal(f.target(), null);
  f.emit(f.request("new", 1, b)); f.emit(f.proof("new", 1, b)); assert.ok(f.target());
  f.runs.setModel(f.scope, f.selection, "{}"); f.emit(f.request("original", 0)); f.emit(f.proof("original", 0)); assert.equal(f.target(), null);
  f.emit(f.request("back", 2)); f.emit(f.proof("back", 2)); assert.ok(f.target());
});

test("foreign run, lease generation, API, provider and selection never authorize proof", async t => {
  const f = await fixture(t); f.emit({ type: "running" });
  for (const change of [{ runId: "foreign-run" }, { lease: { ...f.lease.ref, leaseId: "foreign" } }, { lease: { ...f.lease.ref, generation: 2 } },
    { requestId: "wrong" }, { modelRevision: 4 }, { api: "openai-completions" }, { provider: "other" }, { selection: { ...f.selection, id: "other" } }]) {
    f.emit(f.request()); f.emit({ ...f.proof(), ...change }); assert.equal(f.target(), null);
    f.emit(f.proof()); assert.ok(f.target(), "a rejected foreign proof must not prevent the correct owner from proving itself");
  }
  f.emit({ ...f.request(), api: "custom" }); f.emit({ ...f.proof(), api: "custom" }); assert.equal(f.target(), null);
  f.emit({ ...f.request(), provider: "other" }); f.emit({ ...f.proof(), provider: "other" }); assert.equal(f.target(), null);
});

test("captured binding is bounded; root slot is explicit; pending/inactive/finishing/closed/stopping owners cannot show a record", async t => {
  const f = await fixture(t); f.emit(f.request()); f.emit(f.proof()); assert.equal(f.target(), null, "starting is not running"); f.emit({ type: "running" }); assert.ok(f.target());
  for (const value of ["broken", "[]", "null", JSON.stringify({ [provider]: "../auth.json" }), JSON.stringify({ [provider]: 7 })]) {
    f.lease.environment.env.AXIOM_MODEL_ACCOUNT_BINDINGS = value; assert.equal(f.target(), null);
  }
  f.lease.environment.env.AXIOM_MODEL_ACCOUNT_BINDINGS = "{}"; assert.equal(f.target()?.accountId, null);
  f.setActive(false); assert.equal(f.target(), null); f.setActive(true); assert.ok(f.target());
  assert.throws(() => f.runs.accountUsageTarget({ ...f.scope, workspaceId: "foreign" }), { code: "NOT_FOUND" });
  f.run.status = "stopping"; assert.equal(f.target(), null); f.run.status = "running";
  f.emit({ type: "done", status: "completed" }); assert.equal(f.target(), null); f.emit({ type: "closed" }); assert.equal(f.target(), null);
});
