import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatMessage } from "../src/shared/agent.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import { processSlices } from "../src/shared/process-layout.js";
import { chatMessage, transcriptMessages } from "../src/server/transcript.js";
import { historyProjection } from "../src/server/history-projection.js";
import { editableMessage, rewriteBranch } from "../src/server/session-rewrite.js";

const assistant = (text: string, phase = "commentary", runId = "old") => ({ role: "assistant", axiomRunId: runId,
  content: [{ type: "text", text, textSignature: JSON.stringify({ v: 1, id: "private", phase }) }], stopReason: "stop", timestamp: 1 }) as any;
const task = () => ({ role: "assistant", axiomRunId: "old", content: [
  { type: "thinking", thinking: "检查名称" }, { type: "text", text: "过程说明" },
  { type: "toolCall", id: "delegate", name: "delegate", arguments: { tasks: [] } },
], stopReason: "toolUse", timestamp: 1 }) as any;
const oldProcess = (manager: SessionManager) => {
  manager.appendMessage({ role: "user", content: "修复名称及缓存", timestamp: 1 });
  return manager.appendMessage(task());
};
const assertFolded = (groups: ReturnType<typeof threadGroups>, id: string) => {
  const matching = groups.filter(group => group.ids.includes(id));
  assert.equal(matching.length, 1, "all contributions of the earlier message belong to one outer process");
  assert.equal(matching[0].folded, true, "the completed delivery must settle its pre-append process");
  return matching[0];
};

test("native appended inputs settle earlier process only on a complete final, without enclosing the user", () => {
  const manager = SessionManager.inMemory();
  const earlier = oldProcess(manager);
  manager.appendCustomMessageEntry("axiom-append", "追加懒加载", true, { axiomInput: "append" });
  manager.appendMessage(assistant("落实追加要求", "commentary", "resumed"));
  const messages = transcriptMessages(manager, true);
  const final: ChatMessage = { id: "final", role: "assistant", text: "完整交付", phase: "final_answer", status: "completed", runId: "resumed" };
  assert.ok(!threadGroups(messages).some(g => g.folded));
  for (const patch of [{ streaming: true }, { status: "running" }, { status: "failed" }, { status: "cancelled" }, { text: "" }, { error: "failed" }] as Partial<ChatMessage>[]) {
    assert.ok(!threadGroups([...messages, { ...final, ...patch }]).some(g => g.folded), JSON.stringify(patch));
  }
  for (const archived of [false, true]) {
    const groups = threadGroups([...messages, final], { archived });
    const process = assertFolded(groups, earlier);
    assert.deepEqual(processSlices([messages.find(m => m.id === earlier)!], process.thinkingOnlyIds, process.callsOnlyIds, process.bodyHiddenIds).map(s => s.kind), ["process", "body", "task"]);
    assert.equal(groups.find(g => g.ids.includes("input-append"))?.activity, false);
    assert.ok(!groups.some(g => g.activity && g.ids.includes("input-append")));
    assert.deepEqual(groups.filter(g => !g.activity).map(g => g.ids[0]), [messages[0].id, "input-append", "final"]);
  }
  const append = chatMessage({ role: "custom", customType: "axiom-append", display: true, content: "追加", details: { axiomInput: "a" } }, "input-a")!;
  assert.equal(append.inputContinuation, true, "live conversion has the same ownership as native history");
});

test("twice rewritten append preserves continuation across compactions and native reload", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-delivery-continuation-"));
  try {
    const manager = SessionManager.create(root, join(root, "sessions"));
    const earlier = oldProcess(manager);
    const first = manager.appendCompaction("first storage checkpoint", null, 10000);
    manager.appendMessage(assistant("压缩后核验缓存"));
    manager.appendCustomMessageEntry("axiom-append", "追加懒加载", true, { axiomInput: "append" });
    rewriteBranch(manager, editableMessage(manager, "input-append"), "rewrite-one", []);
    manager.appendMessage({ role: "user", content: "继续", timestamp: 2, axiomId: "replacement", axiomInputIds: ["rewrite-one"] } as any);
    manager.appendMessage(assistant("即将被替代的过程"));
    rewriteBranch(manager, editableMessage(manager, "replacement"), "rewrite-two", []);
    manager.appendMessage({ role: "user", content: "追加懒加载", timestamp: 3, axiomId: "rewritten", axiomInputIds: ["rewrite-two"] } as any);
    manager.appendMessage(assistant("实施懒加载", "commentary", "new"));
    const second = manager.appendCompaction("second storage checkpoint", null, 20000);
    assert.ok(!historyProjection(manager, "before").index.segments.flatMap(s => s.groups).some(g => g.folded));
    manager.appendMessage(assistant("完整交付", "final_answer", "new"));
    for (const native of [manager, SessionManager.open(manager.getSessionFile()!)]) {
      const messages = transcriptMessages(native, true);
      assert.ok(!messages.some(m => m.id === "input-append" || m.id === "replacement"), "abandoned branch inputs never reappear");
      assert.equal(messages.find(m => m.id === "rewritten")?.inputContinuation, true);
      assertFolded(threadGroups(messages), earlier);
      const projection = historyProjection(native, "after");
      assertFolded(projection.index.segments.find(s => s.id === first)!.groups, earlier);
      assert.equal(projection.index.segments.find(s => s.id === second)!.groups.find(g => g.ids.includes("rewritten"))?.activity, false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("normal requests and prior deliveries remain boundaries, never inferred from wording or input IDs", () => {
  for (const rewritten of [false, true]) {
    const manager = SessionManager.inMemory();
    const earlier = oldProcess(manager);
    manager.appendMessage({ role: "user", content: "继续", timestamp: 2, axiomId: "new-user", axiomInputIds: ["ordinary"] } as any);
    if (rewritten) {
      rewriteBranch(manager, editableMessage(manager, "new-user"), "ordinary-rewrite", []);
      manager.appendMessage({ role: "user", content: "继续", timestamp: 3, axiomInputIds: ["ordinary-rewrite"] } as any);
    }
    manager.appendMessage(assistant("新请求交付", "final_answer", "new"));
    const groups = threadGroups(transcriptMessages(manager, true));
    assert.ok(groups.filter(g => g.ids.includes(earlier)).every(g => !g.folded));
  }
  const manager = SessionManager.inMemory();
  const earlier = oldProcess(manager);
  manager.appendMessage(assistant("首次完整交付", "final_answer"));
  manager.appendCustomMessageEntry("axiom-append", "follow-up", true, { axiomInput: "follow" });
  manager.appendMessage(assistant("尚未交付的后续过程", "commentary", "next"));
  const groups = threadGroups(transcriptMessages(manager, true));
  assertFolded(groups, earlier);
  assert.equal(groups.at(-1)?.activity, false, "a previous final must not fold a new follow-up tail");
  assert.ok(!groups.find(g => g.folded)?.ids.includes("input-follow"));
});
