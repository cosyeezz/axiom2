import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, estimateTokens } from "@earendil-works/pi-coding-agent";
import { currentContextUsage, estimateContextMessages, measureContext } from "../src/server/context-usage.js";
import { agentSessionUsage } from "../src/server/agent-session-usage.js";

function assistant(total = 180095, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text: "reply" }], api: "openai-completions", provider: "fixture", model: "fixture", stopReason, timestamp: 2,
    usage: { input: total - 2, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: total,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const user = (manager: SessionManager, text: string) => manager.appendMessage({ role: "user", content: text, timestamp: 1 });

test("usage calibration and trailing messages are shared by live and frozen context, without writes", () => {
  const manager = SessionManager.inMemory();
  user(manager, "long history".repeat(100)); manager.appendMessage(assistant());
  user(manager, "tail".repeat(10));
  const toolResult = { role: "toolResult" as const, toolCallId: "read-1", toolName: "read", content: [{ type: "text" as const, text: "tool result" }], isError: false, timestamp: 3 };
  manager.appendMessage(toolResult);
  const expected = 180105 + estimateTokens(toolResult);
  const before = JSON.stringify(manager.getEntries()), frozen = structuredClone(manager.getBranch());
  assert.deepEqual(measureContext(frozen), { tokens: expected, source: "model-usage" });
  assert.equal(currentContextUsage(manager, 272000)!.tokens, measureContext(frozen).tokens);
  assert.equal(currentContextUsage(manager, 272000)!.source, "model-usage");
  assert.equal(JSON.stringify(manager.getEntries()), before);
  user(manager, "later".repeat(100));
  assert.equal(measureContext(frozen).tokens, expected);
  assert.ok(currentContextUsage(manager, 272000)!.tokens! > measureContext(frozen).tokens);
  for (const window of [0, -1, NaN, Infinity]) assert.equal(currentContextUsage(manager, window), null);
  assert.deepEqual(measureContext([]), { tokens: 0, source: "message-estimate" });
});

test("system replacements and removed tools contribute only the folded current prompt", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "system", content: "base", sections: { rules: "obsolete".repeat(1000), removed: "removed".repeat(100) }, toolsAdded: [{ name: "old", description: "old tool", parameters: { type: "object" } }], timestamp: 1 });
  manager.appendMessage({ role: "system", content: "", sections: { rules: "new", removed: null }, toolsRemoved: [{ name: "old" }], timestamp: 2 });
  const result = measureContext(manager.getBranch());
  assert.equal(result.source, "message-estimate");
  assert.equal(result.tokens, estimateTokens({ role: "system", content: "base", sections: { rules: "new" }, timestamp: 2 }));
});

test("context edits, repeated compactions, branches and failed/zero responses cannot revive invalid usage", () => {
  const manager = SessionManager.inMemory();
  const input = user(manager, "input"); manager.appendMessage(assistant(29000));
  manager.appendContextEdit(input, { content: "edited" });
  const estimated = () => estimateContextMessages(manager.buildSessionProjection().messages);
  assert.deepEqual(measureContext(manager.getBranch()), { tokens: estimated(), source: "message-estimate" });
  const valid = manager.appendMessage(assistant(30000));
  assert.equal(measureContext(manager.getBranch()).tokens, 30000);
  manager.appendMessage(assistant(99000, "error")); manager.appendMessage(assistant(98000, "aborted"));
  const zero = assistant(0); zero.usage.input = zero.usage.output = 0; manager.appendMessage(zero);
  assert.ok(measureContext(manager.getBranch()).tokens < 31000);
  manager.branch(valid); assert.equal(measureContext(manager.getBranch()).tokens, 30000);
  manager.appendCompaction("summary", input, 30000);
  assert.deepEqual(measureContext(manager.getBranch()), { tokens: estimated(), source: "message-estimate" });
  manager.appendMessage(assistant(200)); assert.equal(measureContext(manager.getBranch()).tokens, 200);
  manager.appendCompaction("second", null, 200);
  assert.equal(measureContext(manager.getBranch()).tokens, estimated());
});

test("Kiro unknown/partial/invalid/complete-zero never backfill older or retained numeric usage", () => {
  for (const marker of [
    { version: 1, scope: "request", state: "unknown", pricing: { kind: "unknown" } },
    { version: 1, scope: "request", state: "partial", pricing: { kind: "unknown" } },
    { version: 99 },
    { version: 1, scope: "request", state: "complete", pricing: { kind: "unknown" } },
  ]) {
    const manager = SessionManager.inMemory(); user(manager, "owned");
    const earlier = assistant(29000); earlier.provider = "kiro"; manager.appendMessage(earlier);
    const latest = assistant(marker.state === "complete" ? 0 : 29000);
    latest.provider = "kiro";
    if (marker.state === "complete") latest.usage.input = latest.usage.output = 0;
    Object.assign(latest.usage, { axiomKiro: marker });
    const id = manager.appendMessage(latest);
    // The latest raw attempted request remains the provenance even when omitted.
    manager.appendContextEdit(id, null);
    assert.deepEqual(measureContext(manager.getBranch(), { provider: "kiro" }), {
      tokens: estimateContextMessages(manager.buildSessionProjection().messages), source: "message-estimate",
    });
  }
  const manager = SessionManager.inMemory(), complete = assistant(150);
  complete.provider = "kiro";
  Object.assign(complete.usage, { axiomKiro: { version: 1, scope: "request", state: "complete", pricing: { kind: "unknown" } } });
  manager.appendMessage(complete);
  assert.deepEqual(measureContext(manager.getBranch()), { tokens: 150, source: "model-usage" });
});

test("Kiro baseline provenance survives newer failed requests and provider switches", () => {
  for (const provider of ["kiro", "fixture"]) for (const stopReason of ["stop", "error", "aborted"] as const) {
    const manager = SessionManager.inMemory();
    manager.appendMessage(assistant(28000));
    const partial = assistant(29000); partial.provider = "kiro";
    Object.assign(partial.usage, { axiomKiro: { version: 1, scope: "request", state: "partial", pricing: { kind: "unknown" } } });
    manager.appendMessage(partial);
    if (stopReason !== "stop") {
      const failed = assistant(99000, stopReason); failed.provider = "kiro";
      Object.assign(failed.usage, { axiomKiro: { version: 1, scope: "request", state: "complete", pricing: { kind: "unknown" } } });
      manager.appendMessage(failed);
    }
    assert.deepEqual(measureContext(manager.getBranch(), { provider }), {
      tokens: estimateContextMessages(manager.buildSessionProjection().messages), source: "message-estimate",
    }, `${provider}/${stopReason}`);
  }
});

test("public SDK context readings agree with the common measurement through edits and compactions", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-context-measurement-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider("fixture", { api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 1000 }] });
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "", appendSystemPrompt: [] });
  await resourceLoader.reload();
  const manager = SessionManager.inMemory(root);
  const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model: runtime.getModel("fixture", "fixture")!, thinkingLevel: "off", settingsManager, resourceLoader, sessionManager: manager, noTools: "all" });
  t.after(() => session.dispose());
  const compare = () => {
    const native = session.getContextUsage()!, measured = measureContext(manager.getBranch());
    assert.equal(measured.tokens, native.tokens ?? estimateContextMessages(manager.buildSessionProjection().messages));
    assert.equal(agentSessionUsage(session)?.context?.tokens, measured.tokens);
  };
  const input = user(manager, "history".repeat(1000)); manager.appendMessage(assistant()); compare();
  user(manager, "tail"); compare();
  manager.appendContextEdit(input, { content: "replacement" }); compare();
  manager.appendMessage(assistant(30000)); compare();
  manager.appendCompaction("summary", input, 30000); compare();
  manager.appendMessage(assistant(200)); compare();
});
