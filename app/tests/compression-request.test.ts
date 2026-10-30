import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compact, convertToLlm, SessionManager, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { normalizeContext, type AssistantMessage, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import {
  assertCompressionBudget, assertCompressionInput, assertCompressionPrefix, captureCompressionPrefix, compressionModelIdentity, compressionPrefixRequest, compressionRequestOptions,
  readCompressionPrefix, saveCompressionPrefix, observeCompressionPayload,
} from "../src/server/compression-request.js";
import { compactionInstructions } from "../src/server/compaction-display.js";
import { includeAllCompressionMessages } from "../src/server/compression-context.js";

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

test("input-replacing or truncating sampling is unsafe even without cache reuse", () => {
  for (const samplingParams of [{ messages: [] }, { input: "replacement" }, { system: "replacement" }, { truncation: "auto" }])
    assert.throws(() => assertCompressionInput({ ...model, samplingParams }), /配置不安全/);
  assert.throws(() => assertCompressionInput({ ...model, samplingParamsByThinkingLevel: { low: { truncation: "auto" } } }, { reasoning: "low" }), /配置不安全/);
  assert.throws(() => assertCompressionInput(model, { samplingParams: { instructions: "replacement" } }), /配置不安全/);
  assert.doesNotThrow(() => assertCompressionInput({ ...model, samplingParams: { user: "safe-routing-label", top_p: 0.5, truncation: "disabled" } }));
});

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

test("Kiro compaction uses a neutral generated marker without editing the original transcript", async () => {
  const f = fixture(), kiroModel = { ...model, provider: "kiro", api: "kiro-chat" as const };
  f.context = normalizeContext({ systemPrompt: "Caller Axiom system must remain",
    messages: convertToLlm(f.manager.buildSessionProjection().messages) });
  f.prefix = captureCompressionPrefix(f.manager, { ...selection, provider: "kiro" }, kiroModel, f.context,
    { sessionId: f.manager.getSessionId() });
  const { requests } = await runNative(f, prepare(f.manager.buildSessionProjection().messages));
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].messages.slice(0, f.context.messages.length), f.context.messages);
  const directive = requests[0].messages.at(-1)!;
  assert.equal(directive.role, "user");
  assert.ok(typeof directive.content === "string" && directive.content.startsWith("[Native compaction request]\n"));
  assert.match(JSON.stringify(requests[0]), /Caller Axiom system must remain/);
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

test("stopped-session native summary targets the final reply and includes tail file operations", async () => {
  const f = fixture();
  f.manager.appendMessage({ ...assistant(""), content: [{ type: "toolCall", id: "last-write", name: "write", arguments: { path: "/tail/file", content: "saved" } }] });
  f.manager.appendMessage({ role: "toolResult", toolCallId: "last-write", toolName: "write", content: [{ type: "text", text: "saved" }],
    isError: false, timestamp: 2 });
  f.manager.appendMessage(assistant("FINAL_SAVED_REPLY"));
  const preparation = prepare(f.manager.buildSessionProjection().messages.slice(0, 1));
  preparation.isSplitTurn = true;
  includeAllCompressionMessages(preparation, f.manager.getBranch());
  assert.equal(preparation.isSplitTurn, false);
  assert.deepEqual(preparation.turnPrefixMessages, []);
  assert.equal(preparation.messagesToSummarize.length, 5);
  const { requests, result } = await runNative(f, preparation);
  assert.equal(requests.length, 1, "the complete stopped context uses one full native summary");
  const directive = JSON.stringify(requests[0].messages.at(-1));
  assert.match(directive, /indices .*: 2, 3, 4, 5, 6/);
  assert.match(JSON.stringify(requests[0].messages.at(-2)), /FINAL_SAVED_REPLY/);
  assert.deepEqual(result.details, { readFiles: ["/fixture/read"], modifiedFiles: ["/tail/file"] });
});

test("stopped-session updates inherit the previous summary without reviving archived messages", async () => {
  const f = fixture();
  f.manager.appendCompaction("EXISTING_FULL_SUMMARY", null, 100);
  f.manager.appendMessage({ role: "user", content: "AFTER_CHECKPOINT", timestamp: 2 });
  f.manager.appendMessage(assistant("FINAL_AFTER_CHECKPOINT"));
  f.context = normalizeContext({ systemPrompt: "ORIGINAL_SYSTEM", messages: convertToLlm(f.manager.buildSessionProjection().messages) });
  f.prefix = captureCompressionPrefix(f.manager, selection, model, f.context, { sessionId: f.manager.getSessionId() });
  const preparation = prepare([], [], "EXISTING_FULL_SUMMARY");
  includeAllCompressionMessages(preparation, f.manager.getBranch());
  assert.equal(preparation.messagesToSummarize.length, 2);
  const { requests } = await runNative(f, preparation);
  assert.doesNotMatch(JSON.stringify(requests), /UNIQUE_HISTORY|ORIGINAL_ANSWER/);
  assert.match(JSON.stringify(requests[0].messages.at(-1)), /Existing structured summary to update/);
});

test("stopped-session tail metadata preserves previous files and nested read, write and edit calls", () => {
  const f = fixture();
  f.manager.appendCompaction("PREVIOUS", null, 100, { readFiles: ["/previous/read"], modifiedFiles: ["/previous/write"] });
  f.manager.appendMessage({ role: "user", content: "continue", timestamp: 2 });
  f.manager.appendMessage({ ...assistant(""), content: [{ type: "toolCall", id: "nested-parent", name: "bash", arguments: { command: "nested" } }] });
  f.manager.appendMessage({ role: "toolResult", toolCallId: "nested-parent", toolName: "bash", content: [{ type: "text", text: "done" }],
    nestedCalls: { complete: false, calls: [
      { id: "read", name: "read", arguments: { path: "/tail/read" }, status: "ok" },
      { id: "write", name: "write", arguments: { path: "/tail/write" }, status: "ok" },
      { id: "edit", name: "edit", arguments: { path: "/tail/edit" }, status: "ok" },
      { id: "omitted", name: "read", argumentsBytes: 100000, status: "error" },
    ] }, isError: false, timestamp: 3 });
  f.manager.appendMessage(assistant("final"));
  const preparation = prepare([], [], "PREVIOUS");
  preparation.fileOps.read = new Set(["/previous/read"]);
  preparation.fileOps.written.add("/previous/write");
  includeAllCompressionMessages(preparation, f.manager.getBranch());
  assert.equal(preparation.previousSummary, "PREVIOUS");
  assert.deepEqual([...preparation.fileOps.read].sort(), ["/previous/read", "/tail/read"]);
  assert.deepEqual([...preparation.fileOps.written].sort(), ["/previous/write", "/tail/write"]);
  assert.deepEqual([...preparation.fileOps.edited], ["/tail/edit"]);
});

test("private prefix survives restart losslessly, omits credentials and preserves cache routing/options", () => {
  const f = fixture(), root = mkdtempSync(join(tmpdir(), "axiom-prefix-unit-")), file = join(root, "session.jsonl");
  try {
    saveCompressionPrefix(file, f.prefix);
    const restored = readCompressionPrefix(file);
    assert.deepEqual(restored, f.prefix);
    assert.ok(restored);
    if (process.platform !== "win32") assert.equal(statSync(`${file}.request-prefix.json`).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(restored), /DO_NOT_PERSIST|apiKey|authorization|SECRET/);
    assert.deepEqual(restored.options, { sessionId: f.manager.getSessionId(), cacheRetention: "long", reasoning: "low", transport: "sse" });
    const uncached = { ...restored, options: { ...restored.options, cacheRetention: "none" as const } };
    assert.equal(compressionRequestOptions(uncached).cacheRetention, "none");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a changed projection continues native summary without replaying revoked content", async () => {
  const f = fixture();
  const first = f.manager.getBranch()[0];
  f.manager.appendContextEdit(first.id, null);
  const { requests } = await runNative(f, prepare(f.manager.buildSessionProjection().messages));
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests), /Axiom native compaction request/);
  assert.match(JSON.stringify(requests), /ORIGINAL_ANSWER/);
  assert.doesNotMatch(JSON.stringify(requests), /UNIQUE_HISTORY/);
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

test("cache compatibility checks preserve configuration and never permit input rewrites", () => {
  const f = fixture();
  for (const samplingParams of [
    { service_tier: "ultrafast" }, { service_tier: "unverified-custom-tier" }, { service_tier: { custom: true } },
    { unknown_generation_field: "custom" }, { truncation: "auto" }, { input: [] },
    { prompt_cache_key: "custom-cache", prompt_cache_retention: "custom-retention" }, { previous_response_id: "old" },
  ]) {
    const configured = { ...model, contextWindow: 1, samplingParams };
    const before = JSON.stringify(configured);
    const prefix = captureCompressionPrefix(f.manager, selection, configured, f.context, { sessionId: f.manager.getSessionId() });
    assert.throws(() => assertCompressionPrefix(prefix, f.manager.getSessionId(), selection), /无法复用/);
    assert.equal(JSON.stringify(configured), before, "cache validation does not rewrite user configuration");
  }
  assert.throws(() => assertCompressionBudget({ ...model, contextWindow: 1 }, f.context, { maxTokens: 100 }), /不会截断历史/);
  assert.throws(() => assertCompressionBudget(model, f.context, { samplingParams: { max_output_tokens: 64000 } }), /不会截断历史/);
  assertCompressionBudget(model, f.context, { maxTokens: 100 });
  assert.notEqual(compressionModelIdentity(model), compressionModelIdentity({ ...model, samplingParamsByThinkingLevel: { low: { top_p: 0.5 } } }));
});

test("dynamic request sampling survives capture losslessly but requires native fallback", () => {
  const f = fixture(), samplingParams = { service_tier: "custom-tier", metadata: { trace: "fixture" }, top_p: 0.42 };
  const prefix = captureCompressionPrefix(f.manager, selection, model, f.context,
    { sessionId: f.manager.getSessionId(), reasoning: "low", samplingParams });
  const frozen = structuredClone(samplingParams);
  samplingParams.metadata.trace = "mutated";
  assert.deepEqual(compressionRequestOptions(prefix, {}, model).samplingParams, frozen);
  assert.throws(() => assertCompressionPrefix(prefix, f.manager.getSessionId(), selection), /动态请求采样/);
});

test("a new model configuration keeps its current generation options rather than old dynamic overrides", () => {
  const f = fixture();
  const prefix = captureCompressionPrefix(f.manager, selection, model, f.context,
    { sessionId: f.manager.getSessionId(), reasoning: "low", samplingParams: { service_tier: "priority" } });
  const configured = { ...model, samplingParams: { service_tier: "ultrafast" } };
  const options = compressionRequestOptions(prefix, { reasoning: "high", samplingParams: { top_p: 0.7 } }, configured);
  assert.equal(options.sessionId, f.manager.getSessionId());
  assert.equal(options.reasoning, "high");
  assert.deepEqual(options.samplingParams, { top_p: 0.7 });
  assert.equal(configured.samplingParams.service_tier, "ultrafast");
});

test("missing, malformed and unsupported sidecars are optional cache misses", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-prefix-missing-")), file = join(root, "session.jsonl");
  try {
    assert.equal(readCompressionPrefix(file), undefined);
    writeFileSync(`${file}.request-prefix.json`, "not json");
    assert.equal(readCompressionPrefix(file), undefined);
    writeFileSync(`${file}.request-prefix.json`, JSON.stringify({ version: 999 }));
    assert.equal(readCompressionPrefix(file), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("damaged optional cache messages fall back to the native request without blocking it", async () => {
  const f = fixture(), preparation = prepare(f.manager.buildSessionProjection().messages);
  f.prefix.context.messages = JSON.parse("[null]");
  const { requests } = await runNative(f, preparation);
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests), /Axiom native compaction request/);
  assert.match(JSON.stringify(requests), /UNIQUE_HISTORY/);
  assert.match(JSON.stringify(requests), /ORIGINAL_ANSWER/);
});

test("missing or stale prefixes and changed native protocols still dispatch native summary content", async () => {
  const f = fixture(), preparation = prepare(f.manager.buildSessionProjection().messages);
  const native = normalizeContext({ systemPrompt: "NATIVE_SUMMARY_SYSTEM", messages: [
    { role: "user", content: "NEW_NATIVE_PROTOCOL with CURRENT_VALID_HISTORY", timestamp: 1 },
  ] });
  for (const prefix of [undefined, { ...f.prefix, leafId: "removed-branch" }, f.prefix]) {
    const request = compressionPrefixRequest(prefix, f.manager.getBranch(), preparation, native);
    assert.match(JSON.stringify(request), /CURRENT_VALID_HISTORY/);
    assert.match(JSON.stringify(request), /Axiom native compaction request/);
    assert.doesNotMatch(JSON.stringify(request), /UNIQUE_HISTORY/);
  }
  const original = structuredClone(native);
  compressionPrefixRequest(undefined, [], undefined, native);
  assert.deepEqual(native, original, "fallback does not mutate the native request");
  f.prefix.unavailableReason = "legacy sampling or provider hook rejection";
  const { requests } = await runNative(f, preparation);
  assert.deepEqual(requests[0].messages.slice(0, f.context.messages.length), f.context.messages,
    "a legacy rejection reason does not disable usable prefix reuse");
});

test("later system updates fall back to the native summary instead of reusing an unverified prefix", async () => {
  const f = fixture();
  f.manager.appendMessage({ role: "system", content: [{ type: "text", text: "UPDATED_SYSTEM" }], timestamp: 3 });
  f.manager.appendMessage({ role: "user", content: "LATEST_TASK", timestamp: 4 });
  const { requests } = await runNative(f, prepare(f.manager.buildSessionProjection().messages));
  assert.notDeepEqual(requests[0].messages.slice(0, f.context.messages.length), f.context.messages);
  assert.match(JSON.stringify(requests), /LATEST_TASK/);
});

test("forced tool choice becomes a text checkpoint rather than blocking compression", () => {
  const f = fixture();
  Object.assign(f.prefix.options, { toolChoice: "required" });
  assert.equal(compressionRequestOptions(f.prefix).toolChoice, "none");
  assert.equal(compressionRequestOptions(undefined, { toolChoice: "auto" }).toolChoice, "auto");
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
