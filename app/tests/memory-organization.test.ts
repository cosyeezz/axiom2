import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "./temporary.js";
import { Store } from "../src/server/storage.js";
import { Memories, type MemoryExecution } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryOrganizationScope, memorySummaryVersion, type MemoryOrganization } from "../src/shared/memory.js";
import type { Command, Scope, Session, Workspace } from "../src/shared/protocol.js";

const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
const answer = { answer: JSON.stringify({ title: "任务成果", summary: "已完成记忆浏览改进，资料查找更加清晰，验证已通过。" }), incomplete: false };
const until = async (condition: () => boolean) => {
  const end = Date.now() + 10_000;
  while (!condition()) { assert.ok(Date.now() < end, "condition timed out"); await new Promise((resolve) => setTimeout(resolve, 10)); }
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-manual-memory-")), project = join(root, "project"); mkdirSync(project);
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = (workspaceId = workspace.id, content = "## 目标与范围\n完成记忆浏览改进\n") => {
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId }) as Session;
    const scope = { workspaceId, sessionId: session.id };
    writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), content);
    return scope;
  };
  const scope = create(), published: { scope: string; data: unknown }[] = [];
  let onProgress: ((job: MemoryOrganization) => void) | undefined;
  const memories = new Memories(store, (scope, data) => {
    published.push({ scope, data });
    if (scope === memoryOrganizationScope(workspace.id)) onProgress?.(data as MemoryOrganization);
  });
  clearInterval((memories as any).timer); (memories as any).watcher?.close();
  const command = (op: string, target: Partial<Scope> = scope, params = {}, requestId = randomUUID()) => memories.command({ requestId, op, ...target, params });
  const entry = (target = scope) => JSON.parse(String(store.db.prepare("SELECT body FROM memory_sources WHERE sessionId=?").get(target.sessionId)!.body));
  const seed = (target: Scope, patch: Record<string, unknown>) => store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry(target), ...patch }), target.sessionId);
  const calls: MemoryExecution[] = [];
  memories.runner = { close: async () => {}, execute: async (input) => { calls.push(input); input.read(input.scope.sessionId, "MEMORY.md"); return answer; } };
  const ready = async () => { await command("memory.configure", scope, { organizerModel: selection }); await memories.scanAsync(); };
  const done = async (workspaceId = workspace.id) => { await until(() => memories.organization(workspaceId)?.status !== "running"); return memories.organization(workspaceId)!; };
  return { root, store, workspace, scope, create, memories, published, command, entry, seed, calls, ready, done,
    onProgress(callback: (job: MemoryOrganization) => void) { onProgress = callback; },
    async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("manual source organization bypasses quiet time and preserves the background interval and source bytes", async () => {
  const f = fixture();
  try {
    await f.ready();
    const original = f.entry(), path = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), bytes = readFileSync(path);
    await f.memories.organize(); assert.equal(f.calls.length, 0);
    const cadence = (f.memories as any).lastOrganized;
    const accepted = await f.command("memory.organize") as MemoryOrganization;
    assert.equal(accepted.status, "running"); assert.equal(accepted.processed, 0);
    const done = await f.done(); assert.equal(done.status, "completed"); assert.equal(done.succeeded, 1);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0]!.selection, selection);
    assert.equal(f.entry().summaryVersion, memorySummaryVersion); assert.equal(f.entry().updatedAt, original.updatedAt);
    assert.deepEqual(readFileSync(path), bytes); assert.ok((f.memories as any).lastOrganized >= cadence);
    assert.equal(f.memories.preferences().intervalMs, 300_000);
    assert.ok(f.published.some((event) => event.scope === memoryOrganizationScope(f.workspace.id) && (event.data as MemoryOrganization).status === "completed"));
    await f.command("memory.organize"); await f.done(); assert.equal(f.calls.length, 2, "source button explicitly regenerates a ready summary");
  } finally { await f.close(); }
});

test("manual acceptance is idempotent and shares the single background slot", async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await f.ready(); let calls = 0;
    f.memories.runner = { close: async () => release(), execute: async (input) => { calls++; input.read(f.scope.sessionId, "MEMORY.md"); await gate; return answer; } };
    const c: Command = { requestId: randomUUID(), op: "memory.organize", ...f.scope, params: {} };
    const accepted = await f.memories.command(c); await until(() => calls === 1);
    assert.deepEqual(await f.memories.command(c), accepted);
    await assert.rejects(f.command("memory.organize"), { code: "MEMORY_BUSY" });
    await assert.rejects(f.memories.command({ ...c, params: { changed: true } }), { code: "REQUEST_CONFLICT" });
    await f.memories.organize(); assert.equal(calls, 1);
    release(); await f.done();
    assert.deepEqual(await f.memories.command(c), accepted); assert.equal(calls, 1, "replaying a completed acceptance never starts another model");
  } finally { release(); await f.close(); }
});

test("workspace request covers all pending sources beyond four, skips ready and empty sources, continues after failure", async () => {
  const f = fixture();
  try {
    const pending = [f.scope, ...Array.from({ length: 5 }, () => f.create())], ready = f.create(), empty = f.create(f.workspace.id, "");
    const project = join(f.root, "other"); mkdirSync(project);
    const other = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const foreign = f.create(other.id);
    await f.ready(); f.seed(ready, { status: "ready", summary: "现有有效摘要", summaryVersion: memorySummaryVersion, indexedAt: Date.now() });
    const calls: string[] = [];
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls.push(input.scope.sessionId); input.read(input.scope.sessionId, "MEMORY.md");
      if (input.scope.sessionId === pending[1]!.sessionId) throw Error("模型暂不可用");
      return answer;
    } };
    await f.command("memory.organize", { workspaceId: f.workspace.id }); const done = await f.done();
    assert.equal(done.status, "partial"); assert.equal(done.total, 8); assert.equal(done.processed, 8);
    assert.equal(done.succeeded, 5); assert.equal(done.failed, 1); assert.equal(done.skipped, 2);
    assert.deepEqual(new Set(calls), new Set(pending.map((scope) => scope.sessionId)));
    assert.equal(f.entry(ready).summary, "现有有效摘要"); assert.equal(f.entry(empty).summary, ""); assert.equal(f.entry(foreign).summary, "");
  } finally { await f.close(); }
});

test("manual operations enforce workspace authorization and source ownership", async () => {
  const f = fixture();
  try {
    await f.ready(); const project = join(f.root, "other"); mkdirSync(project);
    const other = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    await assert.rejects(f.command("memory.organize", { ...f.scope, workspaceId: other.id }), { code: "SCOPE_MISMATCH" });
    await assert.rejects(f.command("memory.summaries.clear", f.scope, {}), { code: "CONFIRMATION_REQUIRED" });
    f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.workspace.id);
    await assert.rejects(f.command("memory.organize"), { code: "AUTHORIZATION_REQUIRED" });
    await assert.rejects(f.command("memory.summaries.clear", f.scope, { confirmed: true }), { code: "AUTHORIZATION_REQUIRED" });
    assert.throws(() => f.memories.organization(f.workspace.id), { code: "AUTHORIZATION_REQUIRED" }); assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test("clear removes only generated fields, preserves source timing, read errors and other workspace results", async () => {
  const f = fixture();
  try {
    const missing = f.create();
    const project = join(f.root, "other"); mkdirSync(project);
    const other = f.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const foreign = f.create(other.id); await f.ready();
    const path = join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), bytes = readFileSync(path), original = f.entry();
    const generated = { title: "旧模型主题", summary: "旧摘要", summaryVersion: 1, dependencies: [{ sessionId: f.scope.sessionId, path: "MEMORY.md", revision: "old" }], keywords: ["旧词"], status: "ready", indexedAt: 123 };
    f.seed(f.scope, generated); f.seed(foreign, generated);
    rmSync(join(memoryDirectory(f.root, missing.sessionId), "MEMORY.md")); await f.memories.scanAsync(missing);
    const missingBefore = f.entry(missing), preferences = f.memories.preferences();
    f.store.db.prepare("INSERT INTO memory_usage VALUES(?,?,?,?,?,?,?)").run(randomUUID(), f.scope.sessionId, "organize", "fixture", "fixture", "{}", Date.now());
    f.store.db.prepare("INSERT INTO memory_corrections VALUES(?,?,?,?)").run(randomUUID(), f.workspace.id, "明确排除的旧事实", Date.now());
    const c: Command = { requestId: randomUUID(), op: "memory.summaries.clear", workspaceId: f.workspace.id, params: { confirmed: true } };
    const cleared = await f.memories.command(c) as { cleared: number }; assert.equal(cleared.cleared, 1);
    const current = f.entry(); assert.equal(current.summary, ""); assert.equal(current.summaryVersion, undefined);
    assert.deepEqual(current.keywords, []); assert.deepEqual(current.dependencies, []); assert.equal(current.indexedAt, null); assert.equal(current.status, "pending");
    assert.equal(current.title, f.store.session(f.workspace.id, f.scope.sessionId).title);
    for (const key of ["revision", "updatedAt", "excerpt", "hasContent", "entryChars", "deleted"]) assert.deepEqual(current[key], original[key]);
    assert.equal(f.entry(missing).reason, missingBefore.reason); assert.equal(f.entry(missing).error, missingBefore.error); assert.equal(f.entry(missing).status, "error");
    assert.deepEqual(readFileSync(path), bytes); assert.equal(f.entry(foreign).summary, "旧摘要"); assert.deepEqual(f.memories.preferences(), preferences);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM memory_usage").get()!.n, 1);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM memory_corrections").get()!.n, 1);
    f.seed(f.scope, { summary: "以后新生成的摘要" });
    assert.deepEqual(await f.memories.command(c), cleared); assert.equal(f.entry().summary, "以后新生成的摘要", "clear replay has no new deletion side effect");
  } finally { await f.close(); }
});

for (const lateFailure of [false, true]) test(`clearing an in-flight organization prevents late ${lateFailure ? "failure" : "success"} from republishing`, async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await f.ready(); const original = f.entry(); let entered = false;
    f.memories.runner = { close: async () => release(), execute: async (input) => {
      input.read(f.scope.sessionId, "MEMORY.md"); entered = true; await gate;
      if (lateFailure) throw Error("晚到的旧失败"); return answer;
    } };
    await f.command("memory.organize"); await until(() => entered);
    await f.command("memory.summaries.clear", { workspaceId: f.workspace.id }, { confirmed: true });
    const cleared = f.entry(); assert.equal(cleared.summary, ""); assert.equal(cleared.status, "pending");
    release(); assert.equal((await f.done()).status, "cancelled"); await f.memories.scanAsync(f.scope);
    assert.equal(f.entry().summary, ""); assert.equal(f.entry().status, "pending"); assert.equal(f.entry().error, undefined);
    assert.equal(f.entry().updatedAt, original.updatedAt); assert.equal(f.entry().revision, original.revision);
  } finally { release(); await f.close(); }
});

test("source changes reject obsolete results while concurrent renames survive successful publication", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      input.read(f.scope.sessionId, "MEMORY.md");
      writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), "来源中的新事实");
      return answer;
    } };
    await f.command("memory.organize"); assert.equal((await f.done()).status, "failed"); assert.equal(f.entry().summary, "");
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      input.read(f.scope.sessionId, "MEMORY.md");
      f.store.execute({ requestId: randomUUID(), op: "session.rename", ...f.scope, params: { title: "整理期间的新名称" } }); f.memories.rename(f.scope);
      return answer;
    } };
    await f.command("memory.organize"); assert.equal((await f.done()).status, "completed"); assert.equal(f.entry().sourceTitle, "整理期间的新名称"); assert.equal(f.entry().title, "任务成果");
  } finally { await f.close(); }
});

test("accepted work survives the request socket signal and explicit cancel clears indexing without another model call", async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await f.ready(); let input: MemoryExecution | undefined;
    f.memories.runner = { close: async () => release(), execute: async (value) => { input = value; value.read(f.scope.sessionId, "MEMORY.md"); await gate; return answer; } };
    const socket = new AbortController();
    const accepted = await f.memories.command({ requestId: randomUUID(), op: "memory.organize", ...f.scope }, socket.signal) as MemoryOrganization;
    socket.abort(); await until(() => !!input); assert.equal(input!.signal!.aborted, false);
    assert.equal((await f.command("memory.organize.get") as MemoryOrganization).id, accepted.id);
    await f.command("memory.organize.cancel", f.scope, { id: accepted.id }); assert.equal(input!.signal!.aborted, true);
    release(); assert.equal((await f.done()).status, "cancelled"); assert.equal(f.entry().status, "pending"); assert.equal(f.entry().summary, "");
  } finally { release(); await f.close(); }
});

test("cancelled manual work waits a full background interval before a stable source is retried", async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await f.ready(); f.seed(f.scope, { updatedAt: Date.now() - 31 * 60_000 });
    let calls = 0;
    f.memories.runner = { close: async () => release(), execute: async (input) => {
      calls++; input.read(f.scope.sessionId, "MEMORY.md"); await gate; return answer;
    } };
    const job = await f.command("memory.organize") as MemoryOrganization; await until(() => calls === 1);
    await f.command("memory.organize.cancel", f.scope, { id: job.id }); release(); await f.done();
    await f.memories.organize(); assert.equal(calls, 1, "next scheduler tick cannot immediately undo cancellation");
    (f.memories as any).lastOrganized = Date.now() - f.memories.preferences().intervalMs;
    await f.memories.organize(); assert.equal(calls, 2, "the normal later cycle can retry stable sources");
  } finally { release(); await f.close(); }
});

for (const action of ["cancel", "close", "clear"] as const) test(`final progress yield respects ${action} before normal completion`, async () => {
  const f = fixture(); let finish: Promise<unknown> | undefined;
  try {
    await f.ready();
    f.onProgress((job) => {
      if (job.status !== "running" || !job.total || job.processed !== job.total || finish) return;
      // Run after publication, during the final setImmediate yield.
      finish = Promise.resolve().then(() => action === "close" ? f.memories.close()
        : f.command(action === "clear" ? "memory.summaries.clear" : "memory.organize.cancel", f.scope, action === "clear" ? { confirmed: true } : { id: job.id }));
    });
    await f.command("memory.organize"); const job = await f.done(); await finish;
    assert.equal(job.status, action === "close" ? "interrupted" : "cancelled");
    if (action === "clear") assert.equal(f.entry().summary, "");
  } finally { await f.close(); }
});

test("closing waits for accepted work and records interrupted status, restart never resumes old work", async () => {
  const f = fixture(); let entered = false;
  try {
    await f.ready();
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      input.read(f.scope.sessionId, "MEMORY.md"); entered = true;
      await new Promise((_, reject) => input.signal!.addEventListener("abort", () => reject(Error("closed")), { once: true })); return answer;
    } };
    await f.command("memory.organize"); await until(() => entered); await f.memories.close();
    assert.equal(f.memories.organization(f.workspace.id)!.status, "interrupted");
    const job = { ...f.memories.organization(f.workspace.id)!, status: "running", endedAt: null };
    f.store.db.prepare("UPDATE memory_organizations SET body=? WHERE workspaceId=?").run(JSON.stringify(job), f.workspace.id);
    const restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer);
    try { assert.equal(restarted.organization(f.workspace.id)!.status, "interrupted"); assert.equal(restarted.organization(f.workspace.id)!.id, job.id); }
    finally { await restarted.close(); }
  } finally { await f.close(); }
});
