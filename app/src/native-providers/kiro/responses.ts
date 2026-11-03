import { setImmediate } from "node:timers/promises";
import { KiroChatError, kiroObject, kiroText, type kiroNativeChatRequest, type KiroJson } from "./protocol.js";
import type { KiroEvent } from "./eventstream.js";
import { classifyKiroFailure, KiroServiceFailure } from "./failure.js";

// Version-bound observed compatibility, not all Claude models or a full experiment resolver.
// Sonnet 5.5: official-current-route-01-fields.json records the enterprise CLI Responses path.
export const usesKiroResponses = (modelId: string) => modelId === "deepseek-3.2" || modelId === "claude-sonnet-5.5" || modelId === "claude-opus-5.5";
export const KIRO_CONTINUATION_METADATA = "kiro:agent_continuation_id";

/** KAS0.66.70 creates a v4 UUID at graph creation, then carries it through its calls. */
export function validateKiroContinuationId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new KiroChatError("Kiro 续接标识必须是调用方逻辑轮的 UUID v4；未发送无效标识。");
  return value;
}

/** KAS NAi/MAi/OAi: no invented budget_tokens mapping or empty reasoning object. */
export function kiroResponsesReasoning(additional: unknown): Record<string, string> {
  const object = (value: unknown): KiroJson => value !== null && typeof value === "object" && !Array.isArray(value) ? value as KiroJson : {};
  const fields = object(additional), thinking = object(fields.thinking), output = object(fields.output_config), fallback = object(fields.reasoning);
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  const result: Record<string, string> = {};
  if (nonempty(thinking.type)) result.type = thinking.type;
  const effort = nonempty(output.effort) ? output.effort : fallback.effort;
  if (nonempty(effort)) result.effort = effort;
  if (nonempty(thinking.display)) result.summary = thinking.display;
  return result;
}

/** Reuse the native history safety checks/aliases; never replace the caller's tools or policy. */
export function kiroResponsesRequest(payload: ReturnType<typeof kiroNativeChatRequest>["payload"] & { additionalModelRequestFields?: Record<string, unknown> }, continuationId?: unknown) {
  const continuation = validateKiroContinuationId(continuationId);
  const state = payload.conversationState;
  const input: KiroJson[] = [];
  for (const item of [...state.history ?? [], state.currentMessage]) {
    if ("assistantResponseMessage" in item) {
      const message = item.assistantResponseMessage;
      if (message.content) input.push({ role: "assistant", content: message.content });
      for (const call of message.toolUses ?? []) input.push({ type: "function_call", call_id: call.toolUseId, name: call.name, arguments: JSON.stringify(call.input) });
    } else {
      const message = item.userInputMessage;
      for (const value of message.userInputMessageContext?.toolResults ?? []) {
        const result = kiroObject(value);
        // Preserve error/success status as well as all result text blocks; no fabricated success.
        input.push({ type: "function_call_output", call_id: result.toolUseId, output: JSON.stringify({ status: result.status, content: result.content }) });
      }
      if (message.content || message.images?.length) {
        const content = message.images?.length ? [
          ...(message.content ? [{ type: "input_text", text: message.content }] : []),
          ...message.images.map(image => ({ type: "input_image", image_url: `data:image/${image.format};base64,${image.source.bytes}` })),
        ] : message.content;
        input.push({ role: "user", content });
      }
    }
  }
  const current = state.currentMessage.userInputMessage;
  const tools = (current.userInputMessageContext?.tools ?? []).map(value => {
    const tool = kiroObject(kiroObject(value).toolSpecification);
    return { type: "function", name: tool.name, description: tool.description, parameters: kiroObject(tool.inputSchema).json };
  });
  const reasoning = kiroResponsesReasoning(payload.additionalModelRequestFields);
  return { model: current.modelId, input, tools, stream: true, origin: "KIRO_CLI", ...("profileArn" in payload ? { profileArn: payload.profileArn } : {}),
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
    metadata: { "kiro:agent_mode": "vibe", "kiro:conversation_id": state.conversationId, "kiro:root_conversation_id": state.conversationId,
      ...(continuation === undefined ? {} : { [KIRO_CONTINUATION_METADATA]: continuation }) } };
}

export class KiroResponsesError extends KiroChatError {
  constructor(readonly protocolCode: string, readonly eventType?: string) { super("Kiro Responses 流格式无效、状态不一致或被截断；未执行不完整的工具请求。"); }
}
// Codes are local constants only, never provider text or payload fragments.
const invalid = (code = "invalid-sse", eventType?: string) => new KiroResponsesError(code, eventType);
// Event type names are protocol identifiers; keep only bounded, lowercase dotted names (no payload).
const safeEventType = (type: string) => /^[a-z0-9_.:]{1,80}$/.test(type) ? type : "unsafe";

/** Bounded UTF-8 SSE parser, with timer fairness even for synchronously buffered chunks. */
export async function* readKiroSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<KiroJson> {
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let buffer = "", data: string[] = [], bytes = 0, eventSize = 0, events = 0, work = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) buffer += decoder.decode();
      else {
        bytes += chunk.value.byteLength;
        if (bytes > 64 * 1024 * 1024) throw invalid();
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length) {
            if (++events > 100000) throw invalid();
            const text = data.join("\n"); data = []; eventSize = 0;
            if (text !== "[DONE]") {
              let value: KiroJson;
              try { value = kiroObject(JSON.parse(text)); } catch { throw invalid(); }
              yield value;
            }
          }
        } else if (line.startsWith("data:")) {
          const part = line.slice(5).replace(/^ /, ""); eventSize += part.length;
          if (eventSize > 16 * 1024 * 1024) throw invalid();
          data.push(part);
        }
        if (++work >= 128) { work = 0; await setImmediate(undefined, { signal }); signal.throwIfAborted(); }
      }
      if (buffer.length > 16 * 1024 * 1024) throw invalid();
      if (++work >= 128) { work = 0; await setImmediate(undefined, { signal }); signal.throwIfAborted(); }
      if (chunk.done) break;
    }
    if (buffer.trim() || data.length || !events) throw invalid();
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

// KAS 0.66.70 T2u; unknown reasons end the turn as END_TURN.
const incompleteStops: Record<string, string> = { max_output_tokens: "MAX_TOKENS", content_filter: "CONTENT_FILTERED", compaction_required_for_model_handoff: "COMPACTION_REQUIRED_FOR_MODEL_HANDOFF" };
const partText = (part: unknown) => { const value = kiroObject(part); return value.type === "output_text" ? value.text : value.type === "refusal" ? value.refusal : undefined; };
const messageMatches = (item: KiroJson, text: string) => Array.isArray(item.content) && item.content.every(part => typeof partText(part) === "string") && item.content.map(partText).join("") === text;
function reasoningEnvelope(encrypted: string): KiroJson | undefined {
  let value: unknown;
  try { value = JSON.parse(encrypted); } catch { return; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const envelope = value as KiroJson;
  if (typeof envelope.redactedContent === "string" && envelope.redactedContent) return { redactedContent: envelope.redactedContent };
  const text = envelope.reasoningText && typeof envelope.reasoningText === "object" ? envelope.reasoningText as KiroJson : undefined;
  if (text && typeof text.text === "string" && typeof text.signature === "string") return { signature: text.signature };
}
function usageOf(response: KiroJson): KiroJson {
  // The captured Kiro response reports credits/percentage only. Do not turn them into tokens.
  const usage = response.usage == null ? {} : kiroObject(response.usage);
  if (usage.input_tokens === undefined && usage.output_tokens === undefined) return {};
  const cached = usage.input_tokens_details == null ? undefined : kiroObject(usage.input_tokens_details).cached_tokens;
  if (cached === undefined || typeof usage.input_tokens !== "number" || typeof cached !== "number") return {};
  return { tokenUsage: { uncachedInputTokens: usage.input_tokens - cached, outputTokens: usage.output_tokens, cacheReadInputTokens: cached, cacheWriteInputTokens: 0, totalTokens: usage.total_tokens } };
}

type Slot = { id: string; type: string; name?: string; callId?: string; value: string; ended: boolean; parts: Map<number, string> };
export type KiroResponsesEvent = KiroEvent & { providerEvent: KiroJson; progress: boolean };

/** Normalize only after validating Responses lifecycle; share strict native tool validation downstream. */
export async function* readKiroResponses(body: ReadableStream<Uint8Array>, signal: AbortSignal, model: string, observe?: (event: KiroJson) => Promise<void>): AsyncGenerator<KiroResponsesEvent> {
  const slots = new Map<number, Slot>(), ids = new Set<string>();
  let completed = false, responseId: string | undefined;
  for await (const raw of readKiroSse(body, signal)) {
    await observe?.(raw); signal.throwIfAborted();
    if (completed || typeof raw.type !== "string") throw invalid("event-after-completion-or-missing-type");
    const type = raw.type;
    let kind = "responsesControlEvent", data: KiroJson = {}, progress = false;
    const slot = () => {
      const value = slots.get(raw.output_index as number);
      if (!value || value.ended || raw.item_id !== undefined && raw.item_id !== value.id) throw invalid("slot-reference");
      return value;
    };
    if (type === "response.created" || type === "response.in_progress") {
      const response = kiroObject(raw.response);
      if (!kiroText(response.id) || responseId && response.id !== responseId || response.model !== undefined && response.model !== model) throw invalid();
      responseId = response.id;
    } else if (type === "response.output_item.added") {
      progress = true;
      const item = kiroObject(raw.item), index = raw.output_index;
      if (!Number.isSafeInteger(index) || (index as number) < 0 || slots.has(index as number) || slots.size >= 1024 || !kiroText(item.id) || ids.has(item.id)) throw invalid();
      if (!["message", "function_call", "reasoning"].includes(item.type as string)) throw invalid();
      const value: Slot = { id: item.id, type: item.type as string, value: "", ended: false, parts: new Map() };
      ids.add(item.id); slots.set(index as number, value);
      if (item.type === "function_call") {
        if (!kiroText(item.call_id, 256) || !kiroText(item.name, 64) || item.arguments !== undefined && item.arguments !== "") throw invalid();
        value.callId = item.call_id; value.name = item.name;
        kind = "toolUseEvent"; data = { toolUseId: item.call_id, name: item.name };
      }
    } else if (type === "response.output_text.delta" || type === "response.reasoning_text.delta" || type === "response.reasoning.delta" || type === "response.reasoning_summary_text.delta") {
      progress = true;
      const value = slot(), thinking = type !== "response.output_text.delta";
      if (value.type !== (thinking ? "reasoning" : "message") || typeof raw.delta !== "string") throw invalid();
      if (!thinking) {
        if (!Number.isSafeInteger(raw.content_index) || (raw.content_index as number) < 0) throw invalid();
        const index = raw.content_index as number;
        value.parts.set(index, (value.parts.get(index) ?? "") + raw.delta);
      }
      value.value += raw.delta;
      if (value.value.length > 16 * 1024 * 1024) throw invalid();
      kind = thinking ? "reasoningContentEvent" : "assistantResponseEvent";
      data = thinking ? { text: raw.delta } : { content: raw.delta, ...(responseId ? { messageId: responseId } : {}) };
    } else if (type === "response.refusal.delta" || type === "response.refusal.done") {
      // KAS 0.66.70 JOo: refusal.delta is shown as answer text; refusal.done only when no delta arrived.
      const value = slot(), done = type === "response.refusal.done", text = done ? raw.refusal : raw.delta;
      if (value.type !== "message" || typeof text !== "string" || !Number.isSafeInteger(raw.content_index) || (raw.content_index as number) < 0) throw invalid("refusal");
      const index = raw.content_index as number;
      if (!done || !value.parts.has(index)) {
        progress = true;
        value.parts.set(index, (value.parts.get(index) ?? "") + text); value.value += text;
        if (value.value.length > 16 * 1024 * 1024) throw invalid();
        kind = "assistantResponseEvent"; data = { content: text, ...(responseId ? { messageId: responseId } : {}) };
      }
    } else if (type === "response.function_call_arguments.delta") {
      progress = true; const value = slot();
      if (value.type !== "function_call" || typeof raw.delta !== "string") throw invalid();
      value.value += raw.delta;
      if (value.value.length > 16 * 1024 * 1024) throw invalid();
      kind = "toolUseEvent"; data = { toolUseId: value.callId, input: raw.delta };
    } else if (type === "response.function_call_arguments.done" || type === "response.output_text.done") {
      const value = slot();
      if (type === "response.function_call_arguments.done" ? value.type !== "function_call" || raw.arguments !== value.value : value.type !== "message" || raw.text !== (value.parts.get(raw.content_index as number) ?? "")) throw invalid("delta-done-mismatch");
    } else if (type === "response.output_item.done") {
      const value = slot(), item = kiroObject(raw.item);
      if (item.id !== value.id || item.type !== value.type) throw invalid("item-identity");
      if (value.type === "function_call") {
        if (item.arguments !== value.value || item.call_id !== value.callId || item.name !== value.name) throw invalid("tool-item-done-mismatch");
        kind = "toolUseEvent"; data = { toolUseId: value.callId, stop: true };
      } else if (value.type === "message") {
        if (!messageMatches(item, value.value)) throw invalid();
      } else if (typeof item.encrypted_content === "string" && item.encrypted_content) {
        // KAS 0.66.70 MOo: the envelope carries either redactedContent or reasoningText.signature; undecodable is ignored.
        const envelope = reasoningEnvelope(item.encrypted_content);
        if (envelope) { kind = "reasoningContentEvent"; data = envelope; }
      }
      value.ended = true;
    } else if (type === "response.incomplete" || type === "response.completed" && kiroObject(raw.response).status === "incomplete") {
      // KAS 0.66.70 JOo u()/T2u: incomplete is a terminal stop reason, not a stream failure. Held tool stops are not released.
      const response = kiroObject(raw.response);
      if (!kiroText(response.id) || response.model !== undefined && response.model !== model || responseId && response.id !== responseId) throw invalid("response-terminal-mismatch");
      const details = response.incomplete_details == null ? {} : kiroObject(response.incomplete_details), reason = details.reason;
      const stopReason = typeof reason === "string" && Object.hasOwn(incompleteStops, reason) ? incompleteStops[reason] : "END_TURN";
      completed = true; kind = "metadataEvent";
      data = { incomplete: { stopReason, ...(typeof reason === "string" ? { reason: safeEventType(reason) } : {}), known: stopReason !== "END_TURN" }, ...usageOf(response) };
    } else if (type === "response.completed") {
      const response = kiroObject(raw.response);
      // Captured Kiro tool turns finish with status requires_action; text-only turns use completed.
      const callsTool = [...slots.values()].some(s => s.type === "function_call");
      if (!kiroText(response.id) || !(response.status === "completed" || callsTool && response.status === "requires_action") || response.model !== model || responseId && response.id !== responseId || !Array.isArray(response.output) || response.output.length !== slots.size || [...slots.values()].some(s => !s.ended)) throw invalid("response-terminal-mismatch");
      for (let i = 0; i < response.output.length; i++) {
        const item = kiroObject(response.output[i]), value = slots.get(i);
        if (!value || item.id !== value.id || item.type !== value.type) throw invalid();
        if (value.type === "function_call" && (item.arguments !== value.value || item.call_id !== value.callId || item.name !== value.name)) throw invalid("tool-final-mismatch");
        if (value.type === "message" && !messageMatches(item, value.value)) throw invalid();
      }
      completed = true; kind = "metadataEvent"; data = usageOf(response);
    } else if (type === "response.failed" || type === "error") {
      const error = type === "error" ? raw : kiroObject(raw.response).error;
      const failure = error && typeof error === "object" ? kiroObject(error) : {};
      throw new KiroServiceFailure(classifyKiroFailure({ stage: "stream", status: 200, codes: [failure.code], body: { state: "json", data: failure } }));
    } else if (!["response.content_part.added", "response.content_part.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.done", "response.reasoning_text.done", "kiro:keep_alive"].includes(type)) {
      // KAS 0.66.70 (kiro-cli 2.35.1-2.37.0) JOo ignores every other event, e.g. response.reasoning_part.* seen on
      // claude-opus-5.5 high (chat-live-10). Report only the filtered type name so ignored events stay observable.
      kind = "responsesIgnoredEvent"; data = { eventType: safeEventType(type) };
    }
    yield { headers: { ":message-type": "event", ":event-type": kind }, data, providerEvent: raw, progress };
  }
  if (!completed) throw invalid("missing-completed");
}
