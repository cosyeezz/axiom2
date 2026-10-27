import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { AgentViews, historyCacheBytes } from "../src/server/agents/views.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const reply = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() }) as any;

test("two large histories stay cached together instead of rebuilding on every switch", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-history-budget-"));
  const cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    // Each projection is ~18 MiB estimated (UTF-16), matching real 18–21 MiB sessions; together they exceed 32 MiB.
    const scopes = [0, 1].map(() => {
      const session = store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
      const manager = SessionManager.create(cwd, join(root, "native"));
      manager.appendMessage({ role: "user", content: "start", timestamp: Date.now() } as any);
      for (let i = 0; i < 9; i++) manager.appendMessage(reply(String(i).repeat(1_000_000)));
      manager.appendCompaction("summary", null, 1000);
      store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
      return { workspaceId: workspace.id, sessionId: session.id };
    });
    const views = new AgentViews(store, () => {});
    const first = views.historyIndex(scopes[0]), second = views.historyIndex(scopes[1]);
    assert.equal(views.historyIndex(scopes[0]), first, "switching back must reuse the cached projection");
    assert.equal(views.historyIndex(scopes[1]), second);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("history cache budget scales with physical memory within 64–256 MiB", () => {
  const MiB = 1024 * 1024, GiB = 1024 * MiB;
  assert.equal(historyCacheBytes(4 * GiB), 64 * MiB);
  assert.equal(historyCacheBytes(16 * GiB), 102 * MiB);
  assert.equal(historyCacheBytes(32 * GiB), 204 * MiB);
  assert.equal(historyCacheBytes(128 * GiB), 256 * MiB);
});

test("switching among many small histories keeps them all cached", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-history-count-"));
  const cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const scopes = Array.from({ length: 12 }, () => {
      const session = store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
      const manager = SessionManager.create(cwd, join(root, "native"));
      manager.appendMessage({ role: "user", content: "start", timestamp: Date.now() } as any);
      manager.appendMessage(reply("old reply"));
      manager.appendCompaction("summary", null, 1000);
      store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
      return { workspaceId: workspace.id, sessionId: session.id };
    });
    const views = new AgentViews(store, () => {});
    const first = scopes.map(scope => views.historyIndex(scope));
    scopes.forEach((scope, i) => assert.equal(views.historyIndex(scope), first[i], `history ${i} must still be cached`));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
