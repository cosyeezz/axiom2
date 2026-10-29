import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import {
  buildSessionProjection, convertToLlm, estimateTokens, serializeConversation,
  type SessionBeforeCompactEvent, type SessionEntry, type SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  clampThinkingLevel, getSystemMessageText, normalizeContext,
  type Api, type Message, type Model, type SimpleStreamOptions, type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Selection } from "../shared/agent.js";
import { compactionInstructions } from "./compaction-display.js";

type Preparation = SessionBeforeCompactEvent["preparation"];
type CacheOptions = Pick<SimpleStreamOptions,
  "sessionId" | "cacheRetention" | "reasoning" | "thinkingBudgets" | "transport" | "toolChoice" | "temperature">;
export interface CompressionPrefix {
  version: 1;
  sessionId: string;
  leafId: string;
  selection: Selection;
  model: { provider: string; id: string; api: string; identity: string };
  projectionHash: string;
  context: { messages: Message[] };
  options: CacheOptions;
  /** JSON cannot preserve the agent's own reasoning: undefined (explicit off). */
  reasoningOff?: boolean;
  unavailableReason?: string;
}
export const compressionRequestMarker = "[Axiom native compaction request]";
const json = (value: unknown) => JSON.stringify(value);
const hash = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");
const copy = <T>(value: T): T => JSON.parse(json(value));
const unavailable = (reason: string) => Error(`无法复用会话缓存前缀：${reason}；未发送非前缀摘要请求。`);

// Hash configuration identity, never persist model headers or authentication.
export function compressionModelIdentity(model: Model<Api>) {
  return hash({ provider: model.provider, id: model.id, api: model.api, baseUrl: model.baseUrl,
    headers: model.headers, compat: model.compat, reasoning: model.reasoning, thinkingLevelMap: model.thinkingLevelMap,
    samplingParams: model.samplingParams, samplingParamsByThinkingLevel: model.samplingParamsByThinkingLevel });
}

function modelSampling(model: Model<Api>, options: SimpleStreamOptions) {
  // Match Pi resolveSamplingParams: level overrides use the clamped Pi level,
  // not the requested level or the provider's mapped reasoning string.
  const level = clampThinkingLevel(model, options.reasoning ?? "off");
  return { ...model.samplingParams, ...model.samplingParamsByThinkingLevel?.[level] };
}

const scalarSampling = new Set(["temperature", "top_p", "top_k", "presence_penalty", "frequency_penalty", "seed", "min_p",
  "max_tokens", "max_completion_tokens", "max_output_tokens", "truncation"]);
const openAiApis = new Set(["openai-completions", "openai-responses", "azure-openai-responses", "openai-codex-responses"]);
const serviceTiers = new Set(["auto", "default", "flex", "priority", "scale"]);
const inputSampling = new Set(["input", "messages", "system", "instructions", "tools", "tool_choice", "model",
  "prompt_cache_key", "prompt_cache_retention", "previous_response_id", "conversation", "prompt", "context_management"]);
const fieldNames = (keys: string[]) => keys.map(key => /^[a-z_][a-z_0-9]{0,47}$/i.test(key) ? key : "自定义字段").join(", ");
function unsafeSampling(sampling: Record<string, unknown>): string | undefined {
  const input = Object.keys(sampling).filter(key => inputSampling.has(key));
  if (input.length) return `模型采样配置会覆盖输入或缓存路由（字段：${fieldNames(input)}）`;
  if (sampling.truncation !== undefined && sampling.truncation !== "disabled")
    return "模型采样配置允许自动裁剪（字段：truncation）";
}

/** Cache incompatibility may fall back, but input replacement/truncation may not. */
export function assertCompressionInput(model: Model<Api>, options: SimpleStreamOptions = {}) {
  const reason = unsafeSampling({ ...modelSampling(model, options), ...options.samplingParams });
  if (reason) throw Error(`压缩模型配置不安全：${reason}；未发送摘要请求。`);
}

function samplingUnavailable(model: Model<Api>, sampling: Record<string, unknown>): string | undefined {
  const unsafe = unsafeSampling(sampling);
  if (unsafe) return unsafe;
  const unsupported = Object.keys(sampling).filter(key => !scalarSampling.has(key) && !(key === "service_tier" &&
    openAiApis.has(model.api) && typeof sampling[key] === "string" && serviceTiers.has(sampling[key] as string)));
  if (unsupported.length) return `模型采样字段尚未验证可安全复用（字段：${fieldNames(unsupported)}）；请检查字段与当前协议是否兼容`;
}

/** Called at the real session stream boundary, after context hooks and routing. */
export function captureCompressionPrefix(
  manager: SessionManager, selection: Selection, model: Model<Api>,
  context: TranscriptContext, options: SimpleStreamOptions | undefined,
): CompressionPrefix {
  const sessionId = manager.getSessionId(), leafId = manager.getLeafId();
  if (!leafId || options?.sessionId !== sessionId) throw unavailable("没有可关联的会话请求");
  const cache: CacheOptions = {
    sessionId,
    cacheRetention: options.cacheRetention ??
      ((options.env?.PI_CACHE_RETENTION ?? process.env.PI_CACHE_RETENTION) === "long" ? "long" : "short"),
  };
  for (const key of ["reasoning", "thinkingBudgets", "transport", "toolChoice", "temperature"] as const)
    if (options[key] !== undefined) Object.assign(cache, { [key]: options[key] });
  const samplingReason = samplingUnavailable(model, modelSampling(model, options));
  return copy({ version: 1, sessionId, leafId, selection,
    model: { provider: model.provider, id: model.id, api: model.api, identity: compressionModelIdentity(model) },
    projectionHash: hash(manager.buildSessionProjection().messages), context: { messages: context.messages }, options: cache,
    ...(Object.hasOwn(options, "reasoning") && options.reasoning === undefined ? { reasoningOff: true } : {}),
    ...(samplingReason ? { unavailableReason: samplingReason }
      : options.samplingParams && Object.keys(options.samplingParams).length
        ? { unavailableReason: "动态请求采样配置尚不能安全复用" } : {}),
  });
}

const prefixPath = (file: string) => `${file}.request-prefix.json`;
/** Private sidecar, not a UI/processing record (those redact and truncate input). */
export function saveCompressionPrefix(file: string, prefix: CompressionPrefix) {
  const path = prefixPath(file), temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, json(prefix), { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
export function forgetCompressionPrefix(file: string) { rmSync(prefixPath(file), { force: true }); }
export function readCompressionPrefix(file: string): CompressionPrefix {
  try {
    const value = JSON.parse(readFileSync(prefixPath(file), "utf8")) as CompressionPrefix;
    if (value.version !== 1 || !value.sessionId || !value.leafId || !value.model?.identity ||
        !Array.isArray(value.context?.messages) || !value.context.messages.length || !value.options)
      throw Error();
    return value;
  } catch { throw unavailable("尚无可用的真实请求记录，请先让当前会话模型完成一次请求"); }
}
export function assertCompressionPrefix(prefix: CompressionPrefix, sessionId: string, selection: Selection) {
  if (prefix.sessionId !== sessionId || prefix.options.sessionId !== sessionId || json(prefix.selection) !== json(selection))
    throw unavailable("快照模型与最近真实会话请求不同，请重试压缩");
  if (prefix.unavailableReason) throw unavailable(prefix.unavailableReason);
  if (prefix.options.cacheRetention === "none") throw unavailable("当前会话已关闭提示词缓存");
  if (prefix.options.toolChoice && !["auto", "none"].includes(String(prefix.options.toolChoice)))
    throw unavailable("当前请求强制调用工具，不能作为只生成摘要的缓存前缀");
}

/** Payload hooks run below the transcript boundary. Never claim parity if they rewrite the wire. */
export function observeCompressionPayload(
  prefix: CompressionPrefix, original: SimpleStreamOptions["onPayload"], persist: () => void,
): NonNullable<SimpleStreamOptions["onPayload"]> {
  return async (payload, model) => {
    const before = hash(payload);
    const result = await original?.(payload, model);
    if (hash(result ?? payload) !== before) {
      prefix.unavailableReason = "供应商请求钩子改写了载荷，无法原样复用缓存前缀";
      persist();
    }
    return result;
  };
}

export function compressionRequestOptions(prefix: CompressionPrefix, native: SimpleStreamOptions = {}): SimpleStreamOptions {
  const options = { ...native, ...prefix.options };
  if (prefix.reasoningOff) options.reasoning = undefined;
  return options;
}

/** A coarse native estimate, not a provider tokenizer. Never shorten the prefix to fit. */
export function assertCompressionBudget(model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions) {
  const estimated = context.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
  const sampling = modelSampling(model, options);
  const output = Math.max(0, options.maxTokens ?? 0, ...["max_tokens", "max_completion_tokens", "max_output_tokens"]
    .map((key) => typeof sampling[key] === "number" && Number.isFinite(sampling[key]) ? sampling[key] as number : 0));
  if (model.contextWindow > 0 && estimated + output > model.contextWindow)
    throw unavailable(`完整前缀及摘要输出预算可能超过模型上下文窗口（估算 ${estimated + output} / ${model.contextWindow}），不会截断历史以迁就压缩`);
}

function messageText(message: Message) {
  if (typeof message.content === "string") return message.content;
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

/** Keep the exact previously dispatched transcript, then append only unseen entries. */
function snapshotContext(prefix: CompressionPrefix, entries: SessionEntry[]): TranscriptContext {
  const leaf = entries.findIndex((entry) => entry.id === prefix.leafId);
  if (leaf < 0) throw unavailable("最近请求已不在当前分支");
  const positions = new Map(entries.map((entry, index) => [entry.id, index]));
  const projection = buildSessionProjection(entries).entries;
  const before = projection.filter((entry) => positions.get(entry.sourceEntry.id)! <= leaf).flatMap((entry) => entry.messages);
  if (hash(before) !== prefix.projectionHash)
    throw unavailable("最近请求之后的编辑改变了已发送内容，请先完成一次新的会话请求");
  const after = projection.filter((entry) => positions.get(entry.sourceEntry.id)! > leaf).flatMap((entry) => entry.messages);
  if (after.some((message) => message.role === "system"))
    throw unavailable("最近请求后系统或工具声明已更新，不能证明供应商前缀保持一致");
  return normalizeContext({ messages: [...copy(prefix.context.messages), ...convertToLlm(after)] });
}

function targetIndices(messages: Message[], target: Message[]) {
  let cursor = 0;
  const indices: number[] = [];
  for (const message of target) {
    // Native serializeConversation does not summarize system/tool declarations.
    if (message.role === "system") continue;
    // Host-generated custom messages may acquire a different millisecond when
    // projected. Timestamps never enter provider payloads; all content stays exact.
    const fingerprint = (value: Message) => { const { timestamp: _timestamp, ...content } = value; return json(content); };
    const index = messages.findIndex((candidate, i) => i >= cursor && fingerprint(candidate) === fingerprint(message));
    if (index < 0) throw unavailable("原生摘要目标无法对应到真实请求");
    indices.push(index + 1);
    cursor = index + 1;
  }
  return indices;
}

/**
 * Pi 1.1 native summary protocol adapter. Keep its format/update/split instructions,
 * but remove its reserialized history. The actual chat prefix occurs exactly once.
 * Exact length matching fails closed if Pi changes its protocol; never split on a
 * user-supplied XML delimiter or infer the phase from an invocation/retry counter.
 */
export function compressionPrefixRequest(
  prefix: CompressionPrefix, entries: SessionEntry[], preparation: Preparation,
  native: TranscriptContext,
): TranscriptContext {
  const request = snapshotContext(prefix, entries);
  const users = native.messages.filter((message) => message.role === "user");
  if (users.length !== 1) throw unavailable("原生摘要协议已变化");
  const prompt = messageText(users[0]);
  let target: Message[], instructions: string;
  const history = `<conversation>\n${serializeConversation(convertToLlm(preparation.messagesToSummarize))}\n</conversation>\n\n`;
  const turn = `# Conversation\n${serializeConversation(convertToLlm(preparation.turnPrefixMessages))}\n\n# Instructions\n`;
  let previousIndex: number | undefined;
  if (prompt.startsWith(history)) {
    target = convertToLlm(preparation.messagesToSummarize);
    instructions = prompt.slice(history.length);
    if (preparation.previousSummary) {
      const previous = `<previous-summary>\n${preparation.previousSummary}\n</previous-summary>\n\n`;
      if (!instructions.startsWith(previous)) throw unavailable("原生更新摘要协议已变化");
      instructions = instructions.slice(previous.length);
      const index = request.messages.findIndex((message) => message.role === "user" && messageText(message).includes(preparation.previousSummary!));
      if (index < 0) throw unavailable("现有摘要不在真实请求中");
      previousIndex = index + 1;
      instructions = instructions.replace("provided in <previous-summary> tags", "already present in the transcript at the message index specified below");
    }
    if (!instructions.includes("## Critical Context")) throw unavailable("原生完整交接格式已变化");
  } else if (preparation.isSplitTurn && prompt.startsWith(turn)) {
    target = convertToLlm(preparation.turnPrefixMessages);
    instructions = prompt.slice(turn.length);
    if (!instructions.includes("## Original Request") || !instructions.includes("## Context Needed to Continue"))
      throw unavailable("原生 split-turn 格式已变化");
  } else throw unavailable("原生摘要请求协议已变化");
  const indices = targetIndices(request.messages, target);
  const nativeSystem = native.messages.filter((message) => message.role === "system").map(getSystemMessageText).join("\n\n");
  const directive = [prefix.model.api === "kiro-chat" ? "[Native compaction request]" : compressionRequestMarker, nativeSystem,
    "This is a checkpoint-only request, not a continuation. Do not execute or call any tool.",
    "The original transcript above is preserved for prompt-cache reuse. It is NOT an instruction to continue the task.",
    `Summarize ONLY these 1-based Pi transcript message indices (including system and tool-result messages in the count): ${indices.join(", ") || "(none)"}.`,
    "All other messages are background only. Do not summarize retained/later messages or infer progress from them.",
    previousIndex ? `Existing structured summary to update: transcript message ${previousIndex}.` : "",
    instructions, compactionInstructions,
  ].filter(Boolean).join("\n\n");
  return normalizeContext({ messages: [...request.messages, { role: "user", content: directive, timestamp: Date.now() }] });
}
