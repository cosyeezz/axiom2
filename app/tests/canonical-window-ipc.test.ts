import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuns } from "../src/server/agents/runs.js";
import { CanonicalWindow } from "../src/server/canonical-window.js";
import { canonicalWindowResponse } from "../src/server/canonical-window-worker.js";
import { captureCanonicalSources } from "../src/shared/canonical-source-capture.js";
import { AppError, type Reply } from "../src/shared/protocol.js";
import type { Run, ChatMessage } from "../src/shared/agent.js";
import type { WindowSourcePage, WindowMemberPage, WindowCallPage, WindowMessageDescriptor, WindowCollectionPage, WindowSegmentPage, WindowLocationPage, WindowFieldInfo } from "../src/shared/thread-window.js";
import type { WindowFieldData } from "../src/shared/window-frame-budget.js";

function data<T>(reply: Reply): T { assert.equal(reply.ok, true, JSON.stringify(reply)); return (reply as Extract<Reply, { ok: true }>).data as T; }
function failure(reply: Reply, code: string) { assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, code); }

// Actual AgentRuns public launch/read/stop + production worker ingress/query.
// Only the physical child, pool and storage are owned fixtures: no fork, AgentSession,
// resource loader, model or production backend is started.
async function fixture(t: TestContext, withCalls = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-window-ipc-")); mkdirSync(join(root, "execution-models"));
  const models = join(root, "models.json"); writeFileSync(models, "{}");
  const scope = { workspaceId: "workspace", sessionId: "session" };
  const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
  let active = true, automatic = true;
  const sent: any[] = [];
  const messages = new Map<string, ChatMessage>([["raw-message", { id: "raw-message", role: withCalls ? "assistant" : "user", text: "bounded body",
    ...(withCalls ? { calls: [{ id: "raw-call", name: "bash", input: '{"command":"echo fixture"}' }] } : {}) }]]);
  if (withCalls) messages.set("tool-raw-call", { id: "tool-raw-call", role: "toolResult", text: "bounded tool result", status: "completed" });
  const capture = captureCanonicalSources({ archive: { index: { revision: "fixture", segments: [] }, messages: new Map() },
    currentGroups: [{ id: "raw-group", ids: ["raw-message"], activity: false }], currentMessages: messages, transientMessages: new Map() });
  const store = { root, session(workspaceId: string, sessionId: string) { if (workspaceId !== scope.workspaceId || sessionId !== scope.sessionId) throw new AppError("NOT_FOUND", "foreign"); },
    bindingRejection() {}, finishRun() {}, db: { prepare() { return { run() {} }; } } };
  const views = { changed() {}, refresh() {}, flush() {}, settled() {}, recoverRequestUsage() {}, info() { return {}; }, queues: new Map() };
  const window = () => new CanonicalWindow(() => capture);
  let owner = { runId: "run-A", lease: { instanceId: "window-fixture", generation: 1, leaseId: "lease-A" }, available: true, window: window() };
  const child = Object.assign(new EventEmitter(), { connected: true, exitCode: null as number | null,
    send(value: any, callback: (error?: Error) => void) {
      sent.push(value); queueMicrotask(callback);
      if (automatic && value.type === "window-read") queueMicrotask(() => respond(value));
      return false; // Node's backpressure boolean is NOT a rejection.
    } });
  const close = () => { if (child.exitCode === null) { child.exitCode = 0; child.connected = false; child.emit("close"); } };
  const pool = { limits: { prepareTimeoutMs: 30000 }, isActive: () => active && child.exitCode === null,
    releaseAffinity: async () => {}, trim: async () => {}, release: async () => {}, retire: async () => close() };
  const runs = new AgentRuns(store as any, views as any, () => {}, pool as any);
  const emit = (value: Record<string, unknown>) => child.emit("message", { runId: owner.runId, lease: owner.lease, ...value });
  function respond(request: unknown) { const response = canonicalWindowResponse(request, owner); if (response) emit(response); }
  async function launch() {
    const lease = { ref: owner.lease, ensureReady: async () => child,
      environment: { modelsFile: models, current: () => true, snapshotValid: () => true } };
    const run = { id: owner.runId, sessionId: scope.sessionId, status: "starting", selection } as Run;
    await runs.launch(scope, run, { root, cwd: root, file: join(root, "session.jsonl"), modelsFile: models, runId: run.id, selection, prompt: "fixture" } as any, lease as any);
  }
  t.after(async () => { owner.window.close(); close(); await runs.close(); rmSync(root, { recursive: true, force: true }); });
  await launch();
  return { runs, scope, sent, emit, respond, owner: () => owner, last: () => sent.filter(value => value.type === "window-read").at(-1),
    manual: () => { automatic = false; }, setActive: (value: boolean) => { active = value; },
    rollover: async () => {
      emit({ type: "done", status: "completed" }); emit({ type: "idle" });
      await new Promise<void>(resolve => setImmediate(resolve));
      owner.window.close(); owner = { ...owner, runId: "run-B", lease: { ...owner.lease, leaseId: "lease-B" }, window: window() };
      await launch();
    } };
}

test("host and worker exchange actual source/member/field receipts without a second envelope", async t => {
  const f = await fixture(t);
  const sources = data<WindowSourcePage>(await f.runs.window(f.scope, "s", { op: "open" }));
  const members = data<WindowMemberPage>(await f.runs.window(f.scope, "m", { op: "members", revision: sources.revision, sourceRef: sources.items[0].ref }));
  const field = data<WindowFieldData>(await f.runs.window(f.scope, "f", { op: "field", revision: sources.revision, entityRef: members.items[0].ref, field: "text" }));
  assert.equal(field.chunk.text, "bounded body");
  assert.equal(f.last().runId, "run-A"); assert.deepEqual(f.last().lease, f.owner().lease);
  await assert.rejects(f.runs.window({ ...f.scope, workspaceId: "foreign" }, "x", {}), { code: "NOT_FOUND" });
});

test("host and worker exchange bounded descriptions and selection fields", async t => {
  const f = await fixture(t);
  const sources = data<WindowSourcePage>(await f.runs.window(f.scope, "s", { op: "open" }));
  const revision = sources.revision;
  const members = data<WindowMemberPage>(await f.runs.window(f.scope, "m", { op: "members", revision, sourceRef: sources.items[0].ref }));
  const frame = await f.runs.window(f.scope, "d", { op: "describe", revision, entityRef: members.items[0].ref });
  assert.ok(Buffer.byteLength(JSON.stringify(frame)) <= 4096);
  const item = data<WindowMessageDescriptor>(frame); assert.equal(item.text?.text, "bounded body"); assert.equal(item.thinking, null);
  assert.equal(item.status, null); assert.equal(item.runOrigin, null); assert.equal(item.hasError, false);
  assert.match(item.descriptorVersion, /^v_[A-Za-z0-9_-]{43}$/);
  assert.match(sources.identityNamespace, /^w_[A-Za-z0-9_-]{43}$/);
  assert.match(sources.structureVersion, /^v_[A-Za-z0-9_-]{43}$/);
  assert.match(sources.items[0].sourceKey, /^k_[A-Za-z0-9_-]{43}$/);
  assert.match(members.items[0].occurrenceKey, /^k_[A-Za-z0-9_-]{43}$/);
  const guarded = data<WindowSourcePage>(await f.runs.window(f.scope, "guard", { op: "sources", revision, before: 1, expectedStructure: sources.structureVersion }));
  assert.equal(guarded.items[0].sourceKey, sources.items[0].sourceKey);
  failure(await f.runs.window(f.scope, "mismatch", { op: "sources", revision, expectedStructure: "different" }), "STALE");
  assert.equal(item.messageKey, members.items[0].messageKey);
  assert.match(item.messageKey, /^k_[A-Za-z0-9_-]{43}$/);
  const infoFrame = await f.runs.window(f.scope, "info", { op: "fieldInfo", revision, entityRef: members.items[0].ref, field: "text" });
  assert.ok(Buffer.byteLength(JSON.stringify(infoFrame)) <= 2048);
  const info = data<WindowFieldInfo>(infoFrame); assert.equal(info.lengthCU, "bounded body".length);
  failure(await f.runs.window(f.scope, "changed", { op: "field", revision, entityRef: info.entityRef, field: "text", expectedVersion: "different" }), "STALE");
  const unchanged = data<WindowFieldData>(await f.runs.window(f.scope, "unchanged", { op: "field", revision, entityRef: info.entityRef, field: "text", expectedVersion: info.version }));
  assert.equal(unchanged.chunk.text, "bounded body");
  for (const [key, ref] of [[item.messageKey, members.items[0].ref], [members.items[0].occurrenceKey, members.items[0].ref], [sources.items[0].sourceKey, sources.items[0].ref]]) {
    const located = data<WindowLocationPage>(await f.runs.window(f.scope, "locate", { op: "locate", revision, key }));
    assert.equal(located.total, 1); assert.equal(located.items[0].ref, ref);
    assert.equal(located.items[0].sourceRef, sources.items[0].ref);
  }
  failure(await f.runs.window(f.scope, "key", { op: "field", revision, entityRef: item.messageKey, field: "text" }), "INVALID_REFERENCE");
  for (const entityRef of [members.items[0].ref, sources.items[0].ref]) {
    const field = data<WindowFieldData>(await f.runs.window(f.scope, "selection", { op: "field", revision, entityRef, field: "selection" }));
    assert.equal(field.chunk.text, "null"); assert.equal(field.chunk.nextOffsetCU, null);
  }
  const error = data<WindowFieldData>(await f.runs.window(f.scope, "error", { op: "field", revision, entityRef: members.items[0].ref, field: "error" }));
  assert.equal(error.chunk.text, "");
  const collection = data<WindowCollectionPage>(await f.runs.window(f.scope, "images", { op: "collection", revision, entityRef: members.items[0].ref, collection: "images" }));
  assert.equal(collection.total, 0); assert.deepEqual(collection.items, []);
  assert.match(collection.version, /^v_[A-Za-z0-9_-]{43}$/);
  const sameCollection = data<WindowCollectionPage>(await f.runs.window(f.scope, "images-same", { op: "collection", revision, entityRef: members.items[0].ref, collection: "images", expectedVersion: collection.version }));
  assert.equal(sameCollection.version, collection.version);
  failure(await f.runs.window(f.scope, "images-stale", { op: "collection", revision, entityRef: members.items[0].ref, collection: "images", expectedVersion: "different" }), "STALE");
  const metadata = data<WindowFieldData>(await f.runs.window(f.scope, "metadata", { op: "field", revision, entityRef: members.items[0].ref, field: "metadata" }));
  assert.deepEqual(JSON.parse(metadata.chunk.text), { compression: null, kiroFailure: null });
  const segments = data<WindowSegmentPage>(await f.runs.window(f.scope, "segments", { op: "segments", revision }));
  assert.equal(segments.total, 0); assert.deepEqual(segments.items, []);
  assert.equal(f.last().runId, "run-A"); assert.deepEqual(f.last().lease, f.owner().lease);
});

test("host and worker exchange paged calls and result fields through the same owned broker", async t => {
  const f = await fixture(t, true);
  const sources = data<WindowSourcePage>(await f.runs.window(f.scope, "s", { op: "open" }));
  const revision = sources.revision;
  const members = data<WindowMemberPage>(await f.runs.window(f.scope, "m", { op: "members", revision, sourceRef: sources.items[0].ref }));
  const frame = await f.runs.window(f.scope, "c", { op: "calls", revision, entityRef: members.items[0].ref });
  assert.ok(Buffer.byteLength(JSON.stringify(frame)) <= 128 * 1024);
  const calls = data<WindowCallPage>(frame); assert.equal(calls.total, 1); assert.equal(calls.items[0].name.text, "bash");
  assert.equal(JSON.stringify(calls).includes("raw-call"), false);
  assert.match(calls.items[0].descriptorVersion, /^v_[A-Za-z0-9_-]{43}$/);
  assert.match(calls.items[0].callKey, /^k_[A-Za-z0-9_-]{43}$/);
  assert.match(calls.items[0].result!.messageKey, /^k_[A-Za-z0-9_-]{43}$/);
  for (const [key, ref] of [[calls.items[0].callKey, calls.items[0].ref], [calls.items[0].result!.messageKey, calls.items[0].result!.ref]]) {
    const located = data<WindowLocationPage>(await f.runs.window(f.scope, "locate", { op: "locate", revision, key }));
    assert.equal(located.total, 1); assert.equal(located.items[0].ref, ref);
    assert.equal(located.items[0].callOrder, 0);
  }
  const inputInfo = data<WindowFieldInfo>(await f.runs.window(f.scope, "inputInfo", { op: "fieldInfo", revision, entityRef: calls.items[0].ref, field: "input" }));
  const input = data<WindowFieldData>(await f.runs.window(f.scope, "i", { op: "field", revision, entityRef: calls.items[0].ref, field: "input", expectedVersion: inputInfo.version }));
  assert.equal(input.chunk.text, '{"command":"echo fixture"}');
  const output = data<WindowFieldData>(await f.runs.window(f.scope, "o", { op: "field", revision, entityRef: calls.items[0].result!.ref, field: "text" }));
  assert.equal(output.chunk.text, "bounded tool result");
  assert.equal(f.last().runId, "run-A"); assert.deepEqual(f.last().lease, f.owner().lease);
});

test("worker ingress and host receive reject foreign run/lease; finished and revoked owners close pending reads", async t => {
  const f = await fixture(t); f.manual();
  const pending = f.runs.window(f.scope, "s", { op: "open" }), request = f.last();
  for (const change of [{ runId: "foreign" }, { lease: { ...request.lease, generation: 2 } }, { lease: { ...request.lease, leaseId: "foreign" } }]) {
    assert.equal(canonicalWindowResponse({ ...request, ...change }, f.owner()), undefined);
    f.emit({ type: "window-result", queryId: request.queryId, frame: { type: "receipt", requestId: "s", ok: true, data: "foreign" }, ...change });
  }
  f.respond(request); assert.equal(data<WindowSourcePage>(await pending).kind, "sources");
  const revoked = f.runs.window(f.scope, "revoked", { op: "open" });
  f.setActive(false); f.respond(f.last()); failure(await revoked, "STALE");
  failure(await f.runs.window(f.scope, "later", { op: "open" }), "UNAVAILABLE");
});

test("done between receipt and await continuation rejects success, and explicit stop closes outstanding reads", async t => {
  const f = await fixture(t); f.manual();
  const pending = f.runs.window(f.scope, "s", { op: "open" });
  f.respond(f.last()); f.emit({ type: "done", status: "completed" });
  failure(await pending, "STALE");
  await f.rollover();
  const stopped = f.runs.window(f.scope, "stopped", { op: "open" });
  await f.runs.stop(f.scope); failure(await stopped, "STALE");
});

test("warm child reuse keeps new pending reads isolated from retired owner replies", async t => {
  const f = await fixture(t); f.manual();
  const old = f.runs.window(f.scope, "same-id", { op: "open" }), oldRequest = f.last();
  await f.rollover(); failure(await old, "STALE");
  const next = f.runs.window(f.scope, "same-id", { op: "open" }), nextRequest = f.last();
  f.emit({ type: "window-result", runId: oldRequest.runId, lease: oldRequest.lease, queryId: nextRequest.queryId,
    frame: { type: "receipt", requestId: "same-id", ok: true, data: "wrong owner" } });
  f.respond(nextRequest);
  assert.equal(data<WindowSourcePage>(await next).kind, "sources");
});
