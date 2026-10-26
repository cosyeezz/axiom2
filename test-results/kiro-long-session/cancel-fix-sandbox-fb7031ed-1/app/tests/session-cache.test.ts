import assert from "node:assert/strict";
import { test } from "node:test";
import { Lru } from "../src/shared/lru.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { transcriptMessages } from "../src/server/transcript.js";
import { compactionInstructions, compactionShortSummary } from "../src/server/compaction-display.js";

test("compression short summaries ignore quoted examples and prefer the current split-turn summary", () => {
  assert.equal(compactionShortSummary("## Progress So Far\n- 隐藏 `<axiom-summary>…</axiom-summary>` 内部标签。"), "上下文已压缩");
  assert.equal(compactionShortSummary("```xml\n<axiom-summary>代码示例</axiom-summary>\n```"), "上下文已压缩");
  assert.equal(compactionShortSummary("<axiom-summary>…</axiom-summary>"), "上下文已压缩");
  assert.equal(compactionShortSummary("<axiom-summary>旧主题</axiom-summary>\n\n---\n\n**Turn Context (split turn):**\n\n<axiom-summary>压缩卡片 Markdown 展示</axiom-summary>\n## Original Request\n优化卡片"), "压缩卡片 Markdown 展示");
  assert.equal(compactionShortSummary("No prior history.\n\n---\n\n**Turn Context (split turn):**\n\n<axiom-summary>优化压缩卡片</axiom-summary>\n## Original Request\n优化卡片"), "优化压缩卡片");
});
test("five-session LRU touches reads and evicts only the oldest", () => {
  const cache = new Lru<string, number>(5);
  for (let i = 1; i <= 5; i++) cache.set(String(i), i);
  assert.equal(cache.get("1"), 1);
  cache.set("6", 6);
  assert.equal(cache.size, 5);
  assert.equal(cache.has("2"), false);
  assert.deepEqual([...cache.keys()], ["3", "4", "5", "1", "6"]);
});
test("transcript uses native compacted entries, complete retained messages and numbered cards", () => {
  const manager = SessionManager.inMemory();
  const user = (text: string) => manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
  user("OLD_HIDDEN");
  const kept = user("RECENT_VISIBLE");
  manager.appendCompaction("<axiom-summary>会话性能优化</axiom-summary>\n## Goal\nFull handoff", kept, 20000);
  for (let i = 0; i < 125; i++) user(`new-${i}`);
  const rows = transcriptMessages(manager);
  assert.equal(rows.length, 127);
  assert.equal(rows[0].compression?.title, "上下文已压缩");
  assert.equal(rows[0].compression?.number, 1);
  assert.ok(rows[0].compression!.after! > 0);
  assert.ok(!rows.some((row) => row.text === "OLD_HIDDEN"));
  assert.equal(rows[1].text, "RECENT_VISIBLE");
  assert.equal(rows.at(-1)?.text, "new-124");
  manager.appendCompaction("<axiom-summary>" + "很长的摘要".repeat(30) + "</axiom-summary>", null, 5000);
  const next = transcriptMessages(manager);
  assert.equal(next.length, 1);
  assert.equal(next[0].compression?.number, 2);
  assert.equal(next[0].compression!.title, "上下文已压缩");
  assert.equal(Array.from(compactionShortSummary("<axiom-summary>" + "很长的摘要".repeat(30) + "</axiom-summary>")).length, 100);
  assert.equal(manager.getBranch().filter((e) => e.type === "message").length, 127, "raw history is never deleted");
  assert.match(compactionInstructions, /保留原生完整交接摘要结构和所有必要上下文/);
  assert.match(compactionInstructions, /无需额外生成卡片标题或短摘要/);
});
