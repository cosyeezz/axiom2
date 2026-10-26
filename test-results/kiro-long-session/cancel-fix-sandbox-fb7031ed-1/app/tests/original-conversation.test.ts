import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { transcriptMessages, transcriptImage } from "../src/server/transcript.js";
import { Store } from "../src/server/storage.js";
import { AgentViews } from "../src/server/agents/views.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
const reply = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now() }) as any;

test("segmented tool reads include cross-boundary results before native persistence", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-history-transient-"));
  const cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const manager = SessionManager.create(cwd, join(root, "native"));
    manager.appendMessage({ ...reply(""), content: [{ type: "toolCall", id: "late-tool", name: "read", arguments: { path: "late.ts" } }] });
    const segmentId = manager.appendCompaction("summary", null, 1000);
    const file = manager.getSessionFile()!;
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, file);
    const before = readFileSync(file, "utf8"), views = new AgentViews(store, () => {});
    const group = views.historyIndex(scope).segments[0].groups[0];
    views.messageChanged(scope, { id: "tool-late-tool", role: "toolResult", text: "not yet on disk", toolCallId: "late-tool" });
    assert.equal(views.historyRead(scope, segmentId, group.id).messages.find(message => message.id === "tool-late-tool")?.text, "not yet on disk");
    assert.equal(views.message(scope, "tool-late-tool", true)?.text, "not yet on disk");
    assert.throws(() => views.historyRead(scope, segmentId, "not-owned"), /不属于/);
    views.flush(scope);
    assert.equal(readFileSync(file, "utf8"), before);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("original view crosses every compaction, omits summaries and preserves native context edits and branch ownership", () => {
  const manager = SessionManager.inMemory();
  const user = (content: string) => manager.appendMessage({ role: "user", content, timestamp: Date.now() });
  user("first");
  const edited = manager.appendMessage(reply("replaced"));
  manager.appendContextEdit(edited, { content: "replacement" });
  const failed = manager.appendMessage(reply("excluded attempt"));
  manager.appendContextEdit(failed, null);
  const fork = user("retained");
  manager.appendCompaction("summary one", fork, 2000);
  manager.appendMessage(reply("middle"));
  manager.appendCompaction("summary two", null, 2000);
  user("latest");
  const before = JSON.stringify(manager.getEntries());
  assert.deepEqual(transcriptMessages(manager).map((m) => m.text), ["summary two", "latest"]);
  assert.deepEqual(transcriptMessages(manager, true).map((m) => m.text), ["first", "replacement", "retained", "middle", "latest"]);
  assert.equal(JSON.stringify(manager.getEntries()), before, "reading never mutates the source tree");
  manager.branch(fork);
  user("other branch");
  assert.deepEqual(transcriptMessages(manager, true).map((m) => m.text), ["first", "replacement", "retained", "other branch"]);
});

test("original history supports full text, tool results and native images without changing the current cache", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-original-"));
  const cwd = join(root, "project"); mkdirSync(cwd);
  const store = new Store(root);
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const create = () => store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: create().id }, other = { workspaceId: workspace.id, sessionId: create().id };
    const manager = SessionManager.create(cwd, join(root, "sessions"));
    const imageId = manager.appendMessage({ role: "user", content: [{ type: "image", mimeType: "image/png", data: png }], timestamp: 1 });
    const full = "long answer ".repeat(2000);
    const answerId = manager.appendMessage(reply(full));
    manager.appendMessage({ ...reply(""), content: [{ type: "toolCall", id: "read-call", name: "read", arguments: { path: "a.txt" } }] });
    manager.appendMessage({ role: "toolResult", toolCallId: "read-call", toolName: "read", content: [{ type: "text", text: "saved output" }], isError: false, timestamp: 1 });
    manager.appendCustomMessageEntry("axiom-append", "steering", true, { axiomInput: "queue" });
    manager.appendCustomMessageEntry("private", "not displayed", false);
    manager.appendCompaction("summary", null, 3000);
    manager.appendMessage(reply("latest"));
    const file = manager.getSessionFile()!;
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(scope.sessionId, file);
    const before = readFileSync(file, "utf8");
    const views = new AgentViews(store, () => {});
    const current = views.transcript(scope);
    views.messageChanged(scope, { id: "live", role: "assistant", text: "streaming", streaming: true });
    const original = views.original(scope);
    assert.equal(original.get(answerId)?.text, full);
    assert.equal(original.get("tool-read-call")?.text, "saved output");
    assert.equal(original.get("input-queue")?.role, "user");
    assert.equal(original.get("live")?.streaming, true);
    assert.ok(![...original.values()].some((message) => message.compression || message.text === "not displayed"));
    assert.equal(views.message(scope, answerId, true)?.text, full);
    assert.equal(views.message(scope, "tool-read-call", true)?.text, "saved output");
    assert.equal(views.image(scope, imageId, "imag1").data, png);
    assert.equal(transcriptImage(manager, imageId, "imag1", true).data, png);
    assert.throws(() => transcriptImage(manager, imageId, "imag1"), { code: "NOT_FOUND" });
    assert.throws(() => views.message(other, answerId, true), { code: "NOT_FOUND" });
    assert.throws(() => views.original({ ...scope, workspaceId: "foreign" }));
    assert.throws(() => views.image(other, imageId, "imag1"), { code: "NOT_FOUND" });
    assert.equal(current.has(answerId), false);
    assert.equal(views.transcript(scope), current);
    assert.equal(readFileSync(file, "utf8"), before);
    views.flush(scope);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
