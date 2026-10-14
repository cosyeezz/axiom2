import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens, SessionManager } from "@earendil-works/pi-coding-agent";
import { contextUsage } from "../src/server/context-usage.js";

const unknown = { tokens: null, window: 32000, percent: null };
test("post-compaction display estimates the committed projection, not retained provider usage", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "old history".repeat(1000), timestamp: 1 });
  const kept = manager.appendMessage({ role: "user", content: "retained input", timestamp: 2 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "retained reply" }],
    api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: 3,
    usage: { input: 29000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 29010,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  manager.appendCompaction("short summary", kept, 29010);
  const first = contextUsage(manager, unknown)!;
  assert.ok(first.tokens! > 0 && first.tokens! < 100);
  assert.equal(first.estimated, true);
  assert.equal(first.tokens, manager.buildSessionProjection().messages.reduce((n, m) => n + estimateTokens(m), 0));
  assert.equal(first.percent, first.tokens! / 32000 * 100);
  manager.appendCustomMessageEntry("tail", "new input after snapshot".repeat(20), true);
  assert.ok(contextUsage(manager, unknown)!.tokens! > first.tokens!);
  manager.appendCompaction("next summary", null, 100);
  assert.equal(contextUsage(manager, unknown)!.tokens, estimateTokens(manager.buildSessionProjection().messages[0]));
});

test("system section updates replace old content rather than inflate the estimate", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "system", content: "base", sections: { rules: "obsolete".repeat(1000) }, timestamp: 1 });
  manager.appendMessage({ role: "system", content: "", sections: { rules: "current" }, timestamp: 2 });
  const context = contextUsage(manager, unknown)!;
  assert.equal(context.tokens, estimateTokens({ role: "system", content: "base", sections: { rules: "current" }, timestamp: 2 }));
  assert.ok(context.tokens! < 10);
});

test("native readings win; missing capacity stays unknown and estimation never writes", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "context", timestamp: 1 });
  const before = JSON.stringify(manager.getEntries());
  const native = { tokens: 120, window: 32000, percent: 0.375 };
  assert.equal(contextUsage(manager, native), native);
  assert.equal(contextUsage(manager, null), null);
  for (const window of [0, -1, NaN]) {
    const value = { ...unknown, window };
    assert.equal(contextUsage(manager, value), value);
  }
  contextUsage(manager, unknown);
  assert.equal(JSON.stringify(manager.getEntries()), before);
});
