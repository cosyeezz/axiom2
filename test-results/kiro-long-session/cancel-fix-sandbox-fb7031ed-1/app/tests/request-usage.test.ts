import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { lastRequestUsage } from "../src/server/request-usage.js";
import { AgentViews } from "../src/server/agents/views.js";
import { Store } from "../src/server/storage.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const reply = (input: number, cacheRead: number, cacheWrite = 0): AssistantMessage => ({
  role: "assistant", content: [{ type: "text", text: "reply" }],
  api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(),
  usage: { input, output: 10, cacheRead, cacheWrite, totalTokens: input + cacheRead + cacheWrite + 10,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

test("cache usage follows the latest native request on the active branch, across tools and compaction", () => {
  const manager = SessionManager.inMemory();
  assert.equal(lastRequestUsage(manager), null);
  const first = manager.appendMessage(reply(80, 20));
  manager.appendMessage(reply(10, 70, 20));
  manager.appendMessage({ role: "toolResult", toolCallId: "tool", toolName: "fixture", content: [],
    isError: false, timestamp: 1, usage: reply(1000, 9000).usage });
  manager.appendUsage("fixture", "fixture", "fixture", reply(9000, 1000).usage);
  manager.appendCompaction("summary", null, 10000, undefined, false, reply(1000, 1000).usage);
  manager.appendMessage({ role: "user", content: "next input", timestamp: 2 });
  const before = JSON.stringify(manager.getEntries());
  assert.deepEqual(lastRequestUsage(manager), { input: 10, cacheRead: 70, cacheWrite: 20 });
  assert.equal(JSON.stringify(manager.getEntries()), before, "display reads must not rewrite native usage");
  manager.branch(first);
  assert.deepEqual(lastRequestUsage(manager), { input: 80, cacheRead: 20, cacheWrite: 0 });
  manager.appendMessage(reply(100, 0));
  assert.deepEqual(lastRequestUsage(manager), { input: 100, cacheRead: 0, cacheWrite: 0 }, "valid zero cache is retained");
});

test("a newer failed/invalid request cannot reuse an older cache reading even when omitted from context", () => {
  for (const stopReason of ["error", "aborted"] as const) for (const usage of [undefined, { input: 10, cacheWrite: 0 }, { input: 0, cacheRead: 0, cacheWrite: 0 },
    { input: -1, cacheRead: 5, cacheWrite: 0 }, { input: NaN, cacheRead: 5, cacheWrite: 0 },
    { input: Infinity, cacheRead: 5, cacheWrite: 0 }, { input: Number.MAX_VALUE, cacheRead: Number.MAX_VALUE, cacheWrite: 0 }]) {
    const manager = SessionManager.inMemory();
    manager.appendMessage(reply(10, 90));
    const failed = manager.appendMessage({ ...reply(0, 0), stopReason, usage: usage as Usage });
    manager.appendContextEdit(failed, null);
    assert.equal(lastRequestUsage(manager), null);
  }
  const manager = SessionManager.inMemory();
  manager.appendMessage({ ...reply(25, 75), stopReason: "aborted" });
  assert.deepEqual(lastRequestUsage(manager), { input: 25, cacheRead: 75, cacheWrite: 0 }, "reported usage remains usable after cancellation");
});

test("saved snapshots recover legacy native usage read-only and settle exits without crossing sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-request-usage-"));
  const cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const create = () => store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: create().id }, other = { ...scope, sessionId: create().id };
    const manager = SessionManager.create(cwd, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "input", timestamp: 1 });
    manager.appendMessage(reply(800, 200));
    manager.appendMessage(reply(20, 80));
    const file = manager.getSessionFile()!;
    const lines = readFileSync(file, "utf8").split("\n");
    lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), version: 2 });
    const before = lines.join("\n");
    writeFileSync(file, before); // Persistent SessionManager.open would migrate this header to v3.
    const usage = { input: 820, cacheRead: 280, cacheWrite: 0, output: 20, total: 1120, cost: null, context: null };
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file,usage) VALUES(?,?,?)").run(scope.sessionId, file, JSON.stringify(usage));
    store.db.prepare("INSERT INTO agent_sessions(sessionId,usage) VALUES(?,?)").run(other.sessionId, JSON.stringify(usage));
    const views = new AgentViews(store, () => {});
    assert.deepEqual(views.info(scope).usage?.lastRequest, { input: 20, cacheRead: 80, cacheWrite: 0 });
    assert.equal(views.info(scope).usage?.total, 1120);
    assert.equal(views.info(other).usage?.lastRequest, undefined, "no native history means unknown, not aggregate input");
    assert.equal(store.db.prepare("SELECT usage FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.usage, JSON.stringify(usage));
    assert.equal(readFileSync(file, "utf8"), before);
    store.db.prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?").run(JSON.stringify({ ...usage, lastRequest: null }), scope.sessionId);
    assert.equal(views.info(scope).usage?.lastRequest, null, "a recorded unknown request is never backfilled with older history");
    // Exit recovery handles both sides of the shutdown/message_end IPC race.
    manager.appendMessage({ role: "user", content: "stalled request", timestamp: 3 });
    views.recoverRequestUsage(scope);
    assert.deepEqual(views.info(scope).usage?.lastRequest, { input: 20, cacheRead: 80, cacheWrite: 0 }, "no new native response preserves the last reading");
    for (const reported of [reply(0, 0), reply(25, 75)]) {
      manager.appendMessage({ ...reported, stopReason: "aborted" });
      const native = readFileSync(file, "utf8");
      views.recoverRequestUsage(scope);
      const settled = JSON.parse(String(store.db.prepare("SELECT usage FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.usage));
      assert.deepEqual(settled.lastRequest, reported.usage.input ? { input: 25, cacheRead: 75, cacheWrite: 0 } : null);
      assert.deepEqual(settled, { ...usage, lastRequest: settled.lastRequest }, "exit recovery preserves every cumulative/context field");
      assert.equal(readFileSync(file, "utf8"), native, "recovery does not rewrite native history");
    }
    assert.equal(views.info(other).usage?.lastRequest, undefined, "settlement does not touch another session");
    store.db.prepare("UPDATE agent_sessions SET file=?,usage=? WHERE sessionId=?").run(join(root, "missing.jsonl"), JSON.stringify(usage), scope.sessionId);
    assert.equal(views.info(scope).usage?.lastRequest, undefined);
    views.recoverRequestUsage(scope);
    assert.equal(views.info(scope).usage?.lastRequest, null, "unreadable history leaves exit recovery unknown");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
