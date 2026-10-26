// Offline integration: real Store, Agents and native branch projection; no model or worker process.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Agents } from "../src/server/agents.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { AgentRuns } from "../src/server/agents/runs.js";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import type { MemoryExecution } from "../src/server/memories.js";
import type { ChatMessage, Run } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const selection = { provider: "offline-title", id: "fixture", thinking: "off" as const };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-title-fallback-integration-")), project = join(root, "project"), pi = join(root, "pi");
  mkdirSync(project); mkdirSync(pi);
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {} }));
  writeFileSync(join(pi, "auth.json"), "{}");
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {}, undefined, () => false);
  agents.pool.limits.targetReadyTotal = 0; agents.pool.limits.maxPrewarming = 0;
  const requests: MemoryExecution[] = [];
  agents.memories.runner = { close: async () => {}, execute: async (input: MemoryExecution) => { requests.push(input); return { answer: "修复首尾导航", incomplete: false }; } };
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const manager = SessionManager.create(project, join(root, "native"));
  store.db.prepare("INSERT INTO agent_sessions(sessionId,file,selection) VALUES(?,?,?)").run(session.id, manager.getSessionFile()!, JSON.stringify(selection));
  const insertRun = (startedAt: number, origin?: Run["origin"]) => {
    const run: Run = { id: randomUUID(), sessionId: session.id, status: "running", selection, startedAt, endedAt: null, error: null, origin };
    store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,origin) VALUES(?,?,?,?,?,?)")
      .run(run.id, run.sessionId, run.status, JSON.stringify(selection), startedAt, origin ?? null);
    return run;
  };
  const internals = agents as unknown as { views: AgentViews; runs: AgentRuns };
  const message = (run: Run, body: ChatMessage) => {
    // AgentRuns updates the view before invoking this host callback.
    internals.views.messageChanged(scope, body);
    internals.runs.onEvent!(scope, run, { type: "message", message: body });
  };
  t.after(async () => {
    try { assert.equal(agents.pool.stats().live, 0); await agents.close(); }
    finally { store.close(); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); }
  });
  return { store, agents, scope, manager, requests, insertRun, message };
}

test("real source uses first user run rather than internal run or latest run, and retains compacted first input", async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const internal = f.insertRun(Date.now() - 100000, "memory_continuation");
  f.agents.titles.start(f.scope, internal);
  t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 0, "internal work alone never starts the fallback clock");
  const first = f.insertRun(Date.now());
  f.manager.appendMessage({ role: "user", content: "首次需求：修复首尾图标", timestamp: Date.now() });
  f.manager.appendMessage({ role: "assistant", axiomRunId: first.id, content: [{ type: "text", text: "箭头顶回到首尾，尖括号跳交互点。" }], stopReason: "stop", timestamp: Date.now() } as any);
  f.manager.appendCompaction("SECRET_COMPACTION", null, 1000);
  f.agents.refresh(f.scope);
  assert.equal(f.agents.messages(f.scope).some(message => message.text.includes("首次需求")), false, "default context no longer contains first input");
  f.agents.titles.start(f.scope, first);
  t.mock.timers.tick(10000);
  const next = f.insertRun(Date.now()); f.agents.titles.start(f.scope, next);
  t.mock.timers.tick(19999); await tick(); assert.equal(f.requests.length, 0);
  t.mock.timers.tick(1); await tick(); assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(f.requests[0].prompt), { firstUser: "首次需求：修复首尾图标", assistantBodies: ["箭头顶回到首尾，尖括号跳交互点。"] });
  assert.equal(f.store.session(f.scope.workspaceId, f.scope.sessionId).title, "修复首尾导航");
});

test("due fallback observes live prose through the host message event and excludes native tools and internal outputs", async t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const run = f.insertRun(Date.now()), internal = f.insertRun(Date.now(), "task_notification");
  f.manager.appendMessage({ role: "user", content: "修复图标跳转", timestamp: Date.now() });
  f.manager.appendMessage({ role: "assistant", axiomRunId: run.id, content: [{ type: "toolCall", id: "read", name: "read", arguments: { path: "SECRET_TOOL" } }], stopReason: "toolUse", timestamp: Date.now() } as any);
  f.manager.appendMessage({ role: "toolResult", toolCallId: "read", toolName: "read", content: [{ type: "text", text: "SECRET_RESULT" }], isError: false, timestamp: Date.now() });
  f.manager.appendMessage({ role: "assistant", axiomRunId: internal.id, content: [{ type: "text", text: "SECRET_INTERNAL" }], stopReason: "stop", timestamp: Date.now() } as any);
  f.agents.refresh(f.scope); f.agents.titles.start(f.scope, run);
  t.mock.timers.tick(30000); await tick(); assert.equal(f.requests.length, 0);
  f.message(run, { id: "live-prose", runId: run.id, role: "assistant", text: "正在区分首尾跳转和交互点跳转。", streaming: true, status: "running", thinking: "SECRET_THINKING" });
  await tick(); assert.equal(f.requests.length, 1);
  assert.deepEqual(JSON.parse(f.requests[0].prompt), { firstUser: "修复图标跳转", assistantBodies: ["正在区分首尾跳转和交互点跳转。"] });
  assert.doesNotMatch(f.requests[0].prompt, /SECRET/);
  assert.equal(f.store.session(f.scope.workspaceId, f.scope.sessionId).title, "修复首尾导航");
});
