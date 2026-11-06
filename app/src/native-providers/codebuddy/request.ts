import { codeBuddySessionId, codeBuddyUuid7 } from "./ids.js";
import type { NativeContext, NativeInputContent, NativeModel, NativeStreamOptions, NativeThinkingLevel } from "../contracts.js";
import { waitForNative } from "../abort.js";
import { codeBuddyBaseUrl, codeBuddyHeaders } from "./identity.js";
import { validCodeBuddyToken } from "./json.js";
import { codeBuddyObject, CodeBuddyProtocolError } from "./failure.js";

export interface CodeBuddyIdentity {
  invocationId?: string;
  rootRequestId?: string;
  parentSessionId?: string;
  agentType?: string;
  intent?: string;
  runtime?: string;
  purpose?: string;
}
export interface CodeBuddyStreamOptions extends NativeStreamOptions { identity?: CodeBuddyIdentity }
const identifier = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max && /^[a-zA-Z0-9_.:/-]+$/.test(value);
// Chat-completions history preserves call IDs, including the SDK's call_id|item_id.
// This content-only allowance must not broaden protocol identity/header validation.
const callIdentifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:/|\-]+$/.test(value);
const toolName = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const fail = (code: ConstructorParameters<typeof CodeBuddyProtocolError>[0] = "request"): never => { throw new CodeBuddyProtocolError(code); };
const samplingKeys = ["top_p", "frequency_penalty", "presence_penalty", "seed", "stop"];
function checkSampling(key: string, value: unknown) {
  if (!samplingKeys.includes(key)) return fail();
  if (key === "stop") {
    if (!(typeof value === "string" || Array.isArray(value) && value.length <= 4 && value.every(item => typeof item === "string"))) return fail();
  } else if (typeof value !== "number" || !Number.isFinite(value) || key === "top_p" && (value < 0 || value > 1) || key.endsWith("penalty") && Math.abs(value) > 2 || key === "seed" && !Number.isSafeInteger(value)) return fail();
}
function checkTemperature(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) return fail();
}

function content(value: NativeInputContent, model: NativeModel): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return fail();
  const blocks = value.map(part => {
    if (part.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
    // CLI 2.179.0 normalizeMessageImages retains image_url blocks in product-gateway tool results.
    if (part.type === "image" && model.input.includes("image") && typeof part.data === "string" && /^(image\/(?:png|jpeg|gif|webp))$/.test(part.mimeType ?? "") &&
      part.data.length > 0 && part.data.length <= 8 * 1024 * 1024 && /^[A-Za-z0-9+/]*={0,2}$/.test(part.data))
      return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
    return fail(); // Never silently strip unsupported images.
  });
  return blocks.every(block => block.type === "text") ? blocks.map(block => block.text).join("\n") : blocks;
}

export function codeBuddyMessages(model: NativeModel, context: NativeContext) {
  const messages: Record<string, unknown>[] = [], seenCalls = new Set<string>(), pending = new Map<string, string>();
  if (context.systemPrompt !== undefined) {
    if (typeof context.systemPrompt !== "string") return fail();
    messages.push({ role: "system", content: context.systemPrompt });
  }
  if (!Array.isArray(context.messages) || !context.messages.length || context.messages.length > 10000) return fail();
  for (const message of context.messages) {
    if (message.role !== "toolResult" && pending.size) return fail("tool");
    if (message.role === "user") messages.push({ role: "user", content: content(message.content, model) });
    else if (message.role === "toolResult") {
      if (pending.get(message.toolCallId) !== message.toolName) return fail("tool");
      pending.delete(message.toolCallId);
      messages.push({ role: "tool", tool_call_id: message.toolCallId, content: content(message.content, model) });
    } else if (message.role === "assistant") {
      if (!Array.isArray(message.content)) return fail();
      const text: string[] = [], reasoning: string[] = [], calls: Record<string, unknown>[] = [];
      for (const block of message.content) {
        if (block.type === "text" && typeof block.text === "string") text.push(block.text);
        else if (block.type === "thinking" && typeof block.thinking === "string" && !block.redacted) { if (block.thinking.length) reasoning.push(block.thinking); }
        else if (block.type === "toolCall") {
          if (!callIdentifier(block.id) || !toolName(block.name) || !codeBuddyObject(block.arguments) || seenCalls.has(block.id) || ["error", "aborted", "length"].includes(message.stopReason ?? "")) return fail("tool");
          seenCalls.add(block.id); pending.set(block.id, block.name);
          calls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.arguments) } });
        } else return fail();
      }
      // CLI sanitizeEmptyContent omits assistant entries with no text, reasoning or calls.
      if (text.join("") || reasoning.length || calls.length)
        messages.push({ role: "assistant", content: text.join(""), ...(reasoning.length ? { reasoning_content: reasoning.join("") } : {}), ...(calls.length ? { tool_calls: calls } : {}) });
    } else return fail();
  }
  if (pending.size) return fail("tool");
  return { messages, seenCalls };
}

export async function prepareCodeBuddyRequest(model: NativeModel, access: string, context: NativeContext, options: CodeBuddyStreamOptions, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!identifier(model.id) || !validCodeBuddyToken(access)) return fail();
  if (options.thinkingBudgets !== undefined) return fail("thinking");
  const { messages, seenCalls } = codeBuddyMessages(model, context);
  const definitions = context.tools ?? [], names = new Set<string>();
  if (definitions.length > 128 || definitions.length && typeof options.validateToolInput !== "function") return fail("tool");
  for (const tool of definitions) {
    if (!toolName(tool.name) || names.has(tool.name) || typeof tool.description !== "string" || !codeBuddyObject(tool.parameters)) return fail("tool");
    names.add(tool.name);
  }
  const tools = definitions.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters) } }));
  let effort: string | undefined;
  if (options.reasoning !== undefined) {
    if (typeof options.reasoning !== "string") return fail("thinking");
    const requested = options.reasoning === "none" ? "off" : options.reasoning;
    const mapped = model.thinking.levels?.[requested as NativeThinkingLevel];
    if (!mapped) return fail("thinking");
    effort = mapped;
  } else if (model.thinking.levels?.off) effort = "none";
  // CLI resolveCacheRetention: an explicit value wins; otherwise the 1H-cache disable switch
  // selects "short", and the default is "long". Latched per session by the CLI.
  const disableLongCache = options.cacheRetention === undefined && (() => {
    const raw = process.env.CODEBUDDY_DISABLE_PROMPT_CACHING_1H ?? process.env.CODEBUDDY_CN_DISABLE_PROMPT_CACHING_1H;
    return typeof raw === "string" && ["1", "true", "yes"].includes(raw.trim().toLowerCase());
  })();
  const body: Record<string, unknown> = { model: model.id, messages, stream: true, stream_options: { include_usage: true },
    cache_retention: options.cacheRetention ?? (disableLongCache ? "short" : "long"),
    ...(tools.length ? { tools } : {}), ...(effort ? { reasoning_effort: effort, ...(effort !== "none" ? { reasoning_summary: "auto" } : {}) } : {}) };
  if (options.toolChoice !== undefined) {
    const choice = options.toolChoice, object = codeBuddyObject(choice), fn = codeBuddyObject(object?.function);
    if (!(typeof choice === "string" && ["auto", "none", "required"].includes(choice)) && !(object?.type === "function" && toolName(fn?.name) && names.has(fn.name))) return fail("tool");
    if (!tools.length && choice !== "none") return fail("tool");
    body.tool_choice = structuredClone(choice);
  }
  const max = options.maxTokens ?? model.maxOutputTokens;
  if (max !== undefined) {
    if (!Number.isSafeInteger(max) || (max as number) <= 0 || model.maxOutputTokens !== undefined && (max as number) > model.maxOutputTokens) return fail();
    body.max_tokens = max;
  }
  // CLI sends temperature 1 on every chat-completions call; caller value overrides.
  if (options.temperature !== undefined) checkTemperature(options.temperature);
  if (options.samplingParams !== undefined) {
    const sampling = codeBuddyObject(options.samplingParams);
    if (!sampling) return fail();
    for (const [key, value] of Object.entries(sampling)) {
      // Temperature has one channel only; a duplicate source is rejected, not merged.
      if (key === "temperature") return fail("target");
      checkSampling(key, value); body[key] = value;
    }
  }
  body.temperature = options.temperature ?? 1;
  const protectedValues = JSON.stringify([body.model, body.messages, body.tools, body.stream, body.stream_options, body.reasoning_effort, body.reasoning_summary, body.tool_choice, body.cache_retention]);
  const replacement = await waitForNative(options.onPayload?.(body), signal);
  signal.throwIfAborted();
  const payload = replacement === undefined ? body : codeBuddyObject(replacement);
  let serialized: string, final: Record<string, unknown> | undefined;
  try { serialized = JSON.stringify(payload); final = codeBuddyObject(JSON.parse(serialized)); }
  catch { return fail("target"); }
  // Validate the actual serialized bytes, not objects with getters/toJSON supplied by a hook.
  if (!final || JSON.stringify([final.model, final.messages, final.tools, final.stream, final.stream_options, final.reasoning_effort, final.reasoning_summary, final.tool_choice, final.cache_retention]) !== protectedValues ||
      final.n !== undefined && final.n !== 1 || final.store !== undefined && final.store !== false ||
      Object.keys(final).some(key => !["model", "messages", "tools", "stream", "stream_options", "reasoning_effort", "reasoning_summary", "tool_choice", "cache_retention", "max_tokens", "temperature", "n", "store", ...samplingKeys].includes(key))) return fail("target");
  if (max !== undefined && final.max_tokens === undefined || final.max_tokens !== undefined && (!Number.isSafeInteger(final.max_tokens) || (final.max_tokens as number) <= 0 || max !== undefined && (final.max_tokens as number) > (max as number))) return fail();
  if (final.temperature !== undefined) checkTemperature(final.temperature);
  for (const key of samplingKeys) if (Object.hasOwn(final, key)) checkSampling(key, final[key]);
  if (Buffer.byteLength(serialized) > 10 * 1024 * 1024) return fail();
  const identity = options.identity ?? {};
  if (!codeBuddyObject(identity) || Object.keys(identity).some(key => !["invocationId", "rootRequestId", "parentSessionId", "agentType", "intent", "runtime", "purpose"].includes(key))) return fail("target");
  const session = options.sessionId ?? codeBuddySessionId(), run = options.continuationId ?? codeBuddyUuid7(), invocation = identity.invocationId ?? codeBuddyUuid7();
  // CLI buildConversationHeaders always emits these for a main conversation call; explicit
  // identity still overrides. Values are CLI defaults, not fabricated account attributes.
  const fixed: Record<string, string> = { ...codeBuddyHeaders, Authorization: `Bearer ${access}`, Accept: "application/json", "Content-Type": "application/json",
    "X-Conversation-ID": session, "X-Conversation-Request-ID": run, "X-Request-ID": invocation, "X-Conversation-Message-ID": invocation,
    "X-Root-Request-ID": run, "X-Agent-Type": "main", "X-Agent-Intent": "craft", "X-Agent-Runtime": "other", "X-Agent-Purpose": "conversation" };
  for (const id of [session, run, invocation]) if (!identifier(id)) return fail("target");
  for (const [field, header] of [["rootRequestId", "X-Root-Request-ID"], ["parentSessionId", "X-Parent-Conversation-ID"], ["agentType", "X-Agent-Type"], ["intent", "X-Agent-Intent"], ["runtime", "X-Agent-Runtime"], ["purpose", "X-Agent-Purpose"]] as const) {
    const value = identity[field]; if (value !== undefined) { if (!identifier(value)) return fail("target"); fixed[header] = value; }
  }
  const headers = new Headers(fixed), supplied = new Set<string>();
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    const lower = key.toLowerCase();
    if (supplied.has(lower)) return fail("target"); supplied.add(lower);
    const protectedHeader = headers.has(key) || /^(?:authorization|proxy-authorization|host|cookie|content-length|transfer-encoding|connection|user-agent|x-(?:conversation|request|root|parent|agent|ide|product|domain|user|enterprise|department|codebuddy))/.test(lower);
    if (protectedHeader) { if (value !== headers.get(key)) return fail("target"); continue; }
    // Only CLI-evidenced fields generated above may reach the wire. SDK tracing,
    // host branding and arbitrary caller x-* headers are not protocol extensions.
    // Existing protected fields still reject conflicting values rather than overriding auth.
  }
  return { url: `${codeBuddyBaseUrl}/chat/completions`, body: serialized, headers, seenCalls, tools: structuredClone(definitions), toolChoice: body.tool_choice, invocation, run, session };
}
