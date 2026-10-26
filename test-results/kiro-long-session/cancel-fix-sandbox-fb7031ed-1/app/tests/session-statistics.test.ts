import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Store } from "../src/server/storage.js";
import { AgentViews } from "../src/server/agents/views.js";
import { sessionState } from "../src/shared/session-state.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const reply = (text: string, axiomId?: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now(), axiomId }) as any;

test("sidebar counts user/assistant history across compaction and deduplicates live deltas", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-message-count-"));
  const cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const session = store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const publications: string[] = [];
  const views = new AgentViews(store, name => publications.push(name), () => false);
  try {
    assert.equal(views.messageCount(scope), 0);
    const manager = SessionManager.create(cwd, join(root, "native"));
    manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
    manager.appendMessage(reply("answer"));
    manager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "output" }], isError: false, timestamp: 1 });
    manager.appendCustomMessageEntry("axiom-append", "follow up", true, { axiomInput: "follow-up" });
    manager.appendCustomMessageEntry("axiom-result", "internal", true);
    const removed = manager.appendMessage(reply("discarded retry"));
    manager.appendContextEdit(removed, null);
    manager.appendCompaction("summary", null, 1000);
    manager.appendMessage(reply("latest"));
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
    assert.equal(views.messageCount(scope), 4);
    assert.equal(views.messages.size, 0, "counting must not hydrate chat bodies");
    assert.equal(views.messageCount(scope), 4);
    views.messageChanged(scope, { id: "live", role: "assistant", text: "a", streaming: true });
    views.flush(scope);
    assert.equal(views.messageCount(scope), 5);
    assert.deepEqual(publications, [`sessions:${workspace.id}`]);
    publications.length = 0;
    views.messageChanged(scope, { id: "live", role: "assistant", text: "abc", streaming: false });
    views.flush(scope);
    assert.equal(views.messageCount(scope), 5);
    assert.deepEqual(publications, [], "token updates do not republish sidebar counts");
    manager.appendMessage(reply("abc", "live"));
    assert.equal(views.messageCount(scope), 5, "native persistence does not double count");
    views.persisted(scope, ["live"]);
    assert.equal(views.messageCount(scope), 5, "count does not fall after transient cleanup");
    const point = manager.getLeafId()!;
    manager.appendMessage(reply("abandoned branch"));
    assert.equal(views.messageCount(scope), 6);
    manager.branch(point);
    manager.appendMessage({ role: "user", content: "new branch", timestamp: 2 });
    views.refresh(scope);
    assert.equal(views.messageCount(scope), 6, "only the active branch counts");
    store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(join(root, "missing.jsonl"), session.id);
    assert.equal(views.messageCount(scope), undefined, "unreadable is unknown, not zero");
  } finally { views.forget(scope); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("sidebar phase labels stay compact", () => {
  const labels = { initializing: "初始化", requesting: "请求中", generating: "生成中", executing_tools: "执行工具", retry_wait: "等待重试", retrying: "重试中", compacting: "压缩中", settling: "收尾中" } as const;
  for (const [phase, label] of Object.entries(labels))
    assert.equal(sessionState({ runStatus: "running", phase: phase as keyof typeof labels }).label, label);
  assert.equal(sessionState({ runStatus: "starting" }).label, "初始化");
});
