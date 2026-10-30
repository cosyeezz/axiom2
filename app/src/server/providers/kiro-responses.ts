import { setImmediate } from "node:timers/promises";
import { KiroChatError, kiroObject, kiroText, type kiroNativeChatRequest, type KiroJson } from "./kiro-native-protocol.js";
import type { KiroEvent } from "./kiro-eventstream.js";
import { classifyKiroFailure, KiroServiceFailure } from "./kiro-failure.js";

// Version-bound observed routing, not a heuristic for all Kiro models.
export const usesKiroResponses = (modelId: string) => modelId === "deepseek-3.2";

/** Reuse the native history safety checks/aliases; never replace the caller's tools or policy. */
export function kiroResponsesRequest(payload: ReturnType<typeof kiroNativeChatRequest>["payload"]) {
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
  return { model: current.modelId, input, tools, stream: true, origin: "KIRO_CLI", ...("profileArn" in payload ? { profileArn: payload.profileArn } : {}),
    metadata: { "kiro:agent_mode": "vibe", "kiro:conversation_id": state.conversationId, "kiro:root_conversation_id": state.conversationId } };
}

export class KiroResponsesError extends KiroChatError {
  constructor(readonly protocolCode: string) { super("Kiro Responses 流格式无效、状态不一致或被截断；未执行不完整的工具请求。"); }
}
// Codes are local constants only, never provider text or payload fragments.
const invalid = (code = "invalid-sse") => new KiroResponsesError(code);

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
    } else if (type === "response.output_text.delta" || type === "response.reasoning_text.delta" || type === "response.reasoning_summary_text.delta") {
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
        if (!Array.isArray(item.content) || item.content.some(part => kiroObject(part).type !== "output_text") || item.content.map(part => kiroObject(part).text).join("") !== value.value) throw invalid();
      }
      value.ended = true;
    } else if (type === "response.completed") {
      const response = kiroObject(raw.response);
      // Captured Kiro tool turns finish with status requires_action; text-only turns use completed.
      const callsTool = [...slots.values()].some(s => s.type === "function_call");
      if (!kiroText(response.id) || !(response.status === "completed" || callsTool && response.status === "requires_action") || response.model !== model || responseId && response.id !== responseId || !Array.isArray(response.output) || response.output.length !== slots.size || [...slots.values()].some(s => !s.ended)) throw invalid("response-terminal-mismatch");
      for (let i = 0; i < response.output.length; i++) {
        const item = kiroObject(response.output[i]), value = slots.get(i);
        if (!value || item.id !== value.id || item.type !== value.type) throw invalid();
        if (value.type === "function_call" && (item.arguments !== value.value || item.call_id !== value.callId || item.name !== value.name)) throw invalid("tool-final-mismatch");
        if (value.type === "message" && (!Array.isArray(item.content) || item.content.some(part => kiroObject(part).type !== "output_text") || item.content.map(part => kiroObject(part).text).join("") !== value.value)) throw invalid();
      }
      completed = true; kind = "metadataEvent";
      // The captured Kiro response reports credits/percentage only. Do not turn them into tokens.
      const usage = response.usage == null ? {} : kiroObject(response.usage);
      if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
        const cached = usage.input_tokens_details == null ? undefined : kiroObject(usage.input_tokens_details).cached_tokens;
        if (cached !== undefined && typeof usage.input_tokens === "number" && typeof cached === "number") {
          data.tokenUsage = { uncachedInputTokens: usage.input_tokens - cached, outputTokens: usage.output_tokens, cacheReadInputTokens: cached, cacheWriteInputTokens: 0, totalTokens: usage.total_tokens };
        }
      }
    } else if (type === "response.failed" || type === "error") {
      const error = type === "error" ? raw : kiroObject(raw.response).error;
      const failure = error && typeof error === "object" ? kiroObject(error) : {};
      throw new KiroServiceFailure(classifyKiroFailure({ stage: "stream", status: 200, codes: [failure.code], body: { state: "json", data: failure } }));
    } else if (type === "response.incomplete" || type.includes("refusal")) {
      throw new KiroChatError("Kiro Responses 未完整完成或拒绝了请求；未将部分结果视为成功。");
    } else if (!["response.content_part.added", "response.content_part.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.done", "response.reasoning_text.done"].includes(type)) {
      throw invalid("unknown-event");
    }
    yield { headers: { ":message-type": "event", ":event-type": kind }, data, providerEvent: raw, progress };
  }
  if (!completed) throw invalid("missing-completed");
}
