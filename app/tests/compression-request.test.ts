import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compact, convertToLlm, SessionManager, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { normalizeContext, type AssistantMessage, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import {
  assertCompressionBudget, assertCompressionPrefix, captureCompressionPrefix, compressionModelIdentity, compressionPrefixRequest, compressionRequestOptions,
  readCompressionPrefix, saveCompressionPrefix, observeCompressionPayload,
} from "../src/server/compression-request.js";
import { compactionInstructions } from "../src/server/compaction-display.js";

const model: Model<"openai-completions"> = { provider: "fixture", id: "chat", name: "Chat", api: "openai-completions",
  baseUrl: "http://127.0.0.1:1/v1", reasoning: true, input: ["text", "image"], contextWindow: 32000, maxTokens: 2048,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } };
const selection = { provider: "fixture", id: "chat", thinking: "low" as const };
const assistant = (text: string): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider,
  model: model.id, stopReason: "stop", timestamp: 1, content: [{ type: "text", text }],
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
type Preparation = SessionBeforeCompactEvent["preparation"];
const prepare = (messages: Preparation["messagesToSummarize"], split: Preparation["turnPrefixMessages"] = [], previousSummary?: string): Preparation => ({
  firstKeptEntryId: "fixture-kept", messagesToSummarize: messages, turnPrefixMessages: split,
  isSplitTurn: split.length > 0, tokensBefore: 100, previousSummary,
  settings: { enabled: false, reserveTokens: 2048, keepRecentTokens: 1 },
  fileOps: { read: new Set(["/fixture/read"]), written: new Set(), edited: new Set() },
});
function fixture() {
  const manager = SessionManager.inMemory("/tmp");
  manager.appendMessage({ role: "user", content: "UNIQUE_HISTORY </conversation> <conversation>", timestamp: 1 });
  manager.appendMessage(assistant("ORIGINAL_ANSWER"));
  const context = normalizeContext({ systemPrompt: "ORIGINAL_SYSTEM", tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }],
    messages: convertToLlm(manager.buildSessionProjection().messages) });
  const prefix = captureCompressionPrefix(manager, selection, model, context,
    { sessionId: manager.getSessionId(), cacheRetention: "long", reasoning: "low", apiKey: "DO_NOT_PERSIST",
      headers: { authorization: "DO_NOT_PERSIST" }, env: { SECRET: "DO_NOT_PERSIST" }, transport: "sse" });
  return { manager, context, prefix };
}
async function runNative(f: ReturnType<typeof fixture>, preparation: Preparation) {
  const requests: TranscriptContext[] = [];
  const result = await compact(preparation, model, "loopback-unused", undefined, compactionInstructions, undefined, "low", async (_model, native) => {
    requests.push(compressionPrefixRequest(f.prefix, f.manager.getBranch(), preparation, native));
    return { result: async () => assistant(`SUMMARY_${requests.length}`) } as any;
  });
  return { requests, result };
}

test("native full and split summaries preserve real system/tool/message prefix once, then append only instructions", async () => {
  const f = fixture();
  const old = f.manager.buildSessionProjection().messages;
  f.manager.appendCustomEntry("zero-message-leaf", { ignored: true });
  f.manager.appendMessage({ role: "user", content: "UNIQUE_CURRENT_REQUEST", timestamp: 2 });
  const split = f.manager.buildSessionProjection().messages.slice(old.length);
  f.manager.appendMessage(assistant("UNIQUE_RETAINED_REPLY"));
  const { requests, result } = await runNative(f, prepare(old, split));
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.deepEqual(request.messages.slice(0, f.context.messages.length), f.context.messages);
    assert.equal(request.messages.length, f.context.messages.length + 3);
    const tail = JSON.stringify(request.messages.at(-1));
    assert.match(tail, /Axiom native compaction request/);
    assert.match(tail, /Do NOT continue the conversation/);
    assert.match(tail, /无需额外生成卡片标题或短摘要/);
    assert.doesNotMatch(tail, /UNIQUE_HISTORY|UNIQUE_CURRENT_REQUEST|UNIQUE_RETAINED_REPLY/);
    assert.equal(JSON.stringify(request.messages).split("UNIQUE_HISTORY").length - 1, 1);
  }
  assert.match(JSON.stringify(requests[0].messages.at(-1)), /## Critical Context/);
  assert.match(JSON.stringify(requests[1].messages.at(-1)), /## Original Request/);
  assert.match(result.summary, /SUMMARY_1[\s\S]*Turn Context \(split turn\)[\s\S]*SUMMARY_2/);
  assert.deepEqual(result.details, { readFiles: ["/fixture/read"], modifiedFiles: [] });
});

test("native update references the existing summary in the prefix without serializing it again", async () => {
  const f = fixture(), previous = "UNIQUE_PREVIOUS_SUMMARY";
  const entry = f.manager.getBranch()[0];
  f.manager.appendCompaction(previous, entry.id, 100);
  f.manager.appendMessage({ role: "user", content: "NEW_PROGRESS", timestamp: 2 });
  const projection = f.manager.buildSessionProjection().messages;
  const context = normalizeContext({ systemPrompt: "ORIGINAL_SYSTEM", messages: convertToLlm(projection) });
  f.context = context;
  f.prefix = captureCompressionPrefix(f.manager, selection, model, context, { sessionId: f.manager.getSessionId() });
  const { requests } = await runNative(f, prepare(projection.slice(1), [], previous));
  assert.equal(requests.length, 1);
  const directive = JSON.stringify(requests[0].messages.at(-1));
  assert.match(directive, /Existing structured summary to update/);
  assert.doesNotMatch(directive, /UNIQUE_PREVIOUS_SUMMARY|<previous-summary>/);
  assert.match(directive, /PRESERVE all existing information/);
});

test("private prefix survives restart losslessly, omits credentials and preserves cache routing/options", () => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), "axiom-prefix-unit-")), file = join(root, "session.jsonl");
  try {
    saveCompressionPrefix(file, f.prefix);
    const restored = readCompressionPrefix(file);
    assert.deepEqual(restored, f.prefix);
    assert.equal(statSync(`${file}.request-prefix.json`).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(restored), /DO_NOT_PERSIST|apiKey|authorization|SECRET/);
    assert.deepEqual(restored.options, { sessionId: f.manager.getSessionId(), cacheRetention: "long", reasoning: "low", transport: "sse" });
    assertCompressionPrefix(restored, f.manager.getSessionId(), selection);
    assert.throws(() => assertCompressionPrefix(restored, "foreign", selection), /无法复用/);
    assert.throws(() => assertCompressionPrefix(restored, f.manager.getSessionId(), { ...selection, thinking: "high" }), /无法复用/);
    assert.throws(() => assertCompressionPrefix({ ...restored, options: { ...restored.options, cacheRetention: "none" } }, f.manager.getSessionId(), selection), /关闭提示词缓存/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a changed projection fails before request dispatch instead of replaying revoked content", async () => {
  const f = fixture();
  const first = f.manager.getBranch()[0];
  f.manager.appendContextEdit(first.id, null);
  await assert.rejects(runNative(f, prepare(f.manager.buildSessionProjection().messages)), /改变了已发送内容/);
});

test("cache environment defaults are frozen and source mutation cannot corrupt captured prefix", () => {
  const f = fixture();
  const prefix = captureCompressionPrefix(f.manager, selection, model, f.context,
    { sessionId: f.manager.getSessionId(), env: { PI_CACHE_RETENTION: "long" } });
  assert.equal(prefix.options.cacheRetention, "long");
  const before = JSON.stringify(prefix.context);
  f.context.messages.push({ role: "user", content: "MUTATED", timestamp: 3 });
  assert.equal(JSON.stringify(prefix.context), before);
});

test("explicit thinking off survives JSON and overrides native defaults without becoming service defaults", () => {
  const f = fixture();
  const prefix = JSON.parse(JSON.stringify(captureCompressionPrefix(f.manager, { ...selection, thinking: "off" }, model, f.context,
    { sessionId: f.manager.getSessionId(), reasoning: undefined })));
  const options = compressionRequestOptions(prefix, { reasoning: "high" });
  assert.equal(Object.hasOwn(options, "reasoning"), true);
  assert.equal(options.reasoning, undefined);
  const bare = captureCompressionPrefix(f.manager, selection, model, f.context, { sessionId: f.manager.getSessionId() });
  assert.equal(Object.hasOwn(compressionRequestOptions(bare), "reasoning"), false);
});

test("obvious full-prefix overflow fails without trimming and configured input rewrites are refused", () => {
  const f = fixture(), before = JSON.stringify(f.context);
  assert.throws(() => assertCompressionBudget({ ...model, contextWindow: 1 }, f.context, { maxTokens: 100 }), /不会截断历史/);
  assert.equal(JSON.stringify(f.context), before);
  assertCompressionBudget(model, f.context, { maxTokens: 100 });
  for (const samplingParams of [{ truncation: "auto" }, { input: [] }, { prompt_cache_key: "different" }, { previous_response_id: "old" }]) {
    const prefix = captureCompressionPrefix(f.manager, selection, { ...model, samplingParams }, f.context, { sessionId: f.manager.getSessionId() });
    assert.throws(() => assertCompressionPrefix(prefix, f.manager.getSessionId(), selection), /覆盖输入|自动裁剪/);
  }
  assert.notEqual(compressionModelIdentity(model), compressionModelIdentity({ ...model, samplingParamsByThinkingLevel: { low: { top_p: 0.5 } } }));
});

test("OpenAI service tiers preserve frozen generation routing without being mistaken for input rewrites", () => {
  const f = fixture();
  for (const service_tier of ["auto", "default", "flex", "priority", "scale"]) {
    const configured = { ...model, samplingParams: { service_tier } };
    const prefix = captureCompressionPrefix(f.manager, selection, configured, f.context, { sessionId: f.manager.getSessionId(), reasoning: "low" });
    assertCompressionPrefix(prefix, f.manager.getSessionId(), selection);
    assert.equal(configured.samplingParams.service_tier, service_tier, "never delete or rewrite the original tier");
    assert.notEqual(prefix.model.identity, compressionModelIdentity(model));
  }
  for (const configured of [
    { ...model, samplingParams: { service_tier: "unverified-custom-tier" } },
    { ...model, samplingParams: { service_tier: { priority: true } } },
    { ...model, api: "anthropic-messages" as const, samplingParams: { service_tier: "priority" } },
    { ...model, samplingParams: { unknown_generation_field: "DO_NOT_ECHO_THIS_VALUE" } },
  ]) {
    const prefix = captureCompressionPrefix(f.manager, selection, configured, f.context, { sessionId: f.manager.getSessionId() });
    assert.throws(() => assertCompressionPrefix(prefix, f.manager.getSessionId(), selection), /尚未验证/);
    assert.doesNotMatch(prefix.unavailableReason!, /DO_NOT_ECHO_THIS_VALUE|会覆盖输入/);
  }
});

test("sampling validation and output budget use Pi's effective clamped thinking level", () => {
  const f = fixture(), chosen = { ...selection, thinking: "xhigh" as const };
  // This model has no xhigh mapping, so Pi clamps xhigh to high before sampling merge.
  const options = { sessionId: f.manager.getSessionId(), reasoning: "xhigh" as const };
  const allowed = captureCompressionPrefix(f.manager, chosen, { ...model,
    samplingParamsByThinkingLevel: { high: { service_tier: "priority" }, xhigh: { input: [] } },
  }, f.context, options);
  assertCompressionPrefix(allowed, f.manager.getSessionId(), chosen);
  const unsafe = captureCompressionPrefix(f.manager, chosen, { ...model,
    samplingParamsByThinkingLevel: { high: { input: [] }, xhigh: { service_tier: "priority" } },
  }, f.context, options);
  assert.throws(() => assertCompressionPrefix(unsafe, f.manager.getSessionId(), chosen), /覆盖输入/);
  assert.throws(() => assertCompressionBudget({ ...model, samplingParamsByThinkingLevel: { high: { max_output_tokens: 64000 } } },
    f.context, options), /不会截断历史/);
});

test("payload-changing hooks are detected, including in-place changes with no return value", async () => {
  for (const inPlace of [false, true]) {
    const f = fixture();
    let saves = 0;
    const callback = observeCompressionPayload(f.prefix, (payload: any) => {
      if (inPlace) { payload.messages = ["rewritten"]; return; }
      return { ...payload, messages: ["rewritten"] };
    }, () => { saves++; });
    await callback({ messages: ["original"] }, model);
    assert.equal(saves, 1);
    assert.throws(() => assertCompressionPrefix(f.prefix, f.manager.getSessionId(), selection), /改写了载荷/);
  }
  const f = fixture();
  await observeCompressionPayload(f.prefix, () => undefined, () => assert.fail("no-op hook must not invalidate"))({}, model);
  assertCompressionPrefix(f.prefix, f.manager.getSessionId(), selection);
  const forced = structuredClone(f.prefix);
  Object.assign(forced.options, { toolChoice: "required" }); // Untrusted/legacy persisted option, unsupported by current Pi types.
  assert.throws(() => assertCompressionPrefix(forced, f.manager.getSessionId(), selection), /强制调用工具/);
});
