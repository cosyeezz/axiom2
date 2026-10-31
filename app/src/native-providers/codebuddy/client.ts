import type { NativeContext, NativeModel, NativeStreamEvent, NativeToolCall, NativeTokenUsage } from "../contracts.js";
import { waitForNative } from "../abort.js";
import { codeBuddyObject, codeBuddyBusinessCode, codeBuddyOverflowCode, CodeBuddyProtocolError, CodeBuddyServiceError } from "./failure.js";
import { codeBuddyNativeFetch } from "./http.js";
import { prepareCodeBuddyRequest, type CodeBuddyStreamOptions } from "./request.js";
import { readCodeBuddySse } from "./sse.js";
import { codeBuddyUsage } from "./usage.js";

export interface CodeBuddyStreamInput { model: NativeModel; access: string; context: NativeContext; options?: CodeBuddyStreamOptions }
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,256}$/.test(value);
/** Empty legacy placeholders are not calls. Never accept a nonempty legacy invocation. */
function emptyLegacyCall(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const object = codeBuddyObject(value);
  return !!object && Object.keys(object).every(key => ["name", "arguments"].includes(key) && (object[key] === null || object[key] === ""));
}
const close = (response: Response) => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => {}); };
async function errorBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) return undefined;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(1000)]), reader = response.body.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await waitForNative(reader.read(), bounded); if (part.done) break;
      size += part.value.byteLength; if (size > 16 * 1024) return undefined;
      parts.push(part.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
  } catch { return undefined; }
  finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
}

/** Independent native client: one send, no SDK, token refresh, model retry, filesystem or tool execution. */
export function createCodeBuddyClient(transport: typeof fetch = codeBuddyNativeFetch) {
  const lifetime = new AbortController();
  async function* stream({ model, access, context, options = {} }: CodeBuddyStreamInput): AsyncGenerator<NativeStreamEvent> {
    const timeout = new AbortController();
    const duration = options.timeoutMs ?? 120000;
    const timer = setTimeout(() => timeout.abort(new DOMException("CodeBuddy 请求超时。", "TimeoutError")), Number.isSafeInteger(duration) && duration > 0 ? Math.min(duration, 3600000) : 120000);
    const signal = AbortSignal.any([lifetime.signal, timeout.signal, ...(options.signal ? [options.signal] : [])]);
    let response: Response | undefined, partial = false, stage = "request";
    const diagnostic = (type: string, details: Record<string, unknown>): NativeStreamEvent => ({ type: "diagnostic", diagnostic: { type, timestamp: Date.now(), details } });
    try {
      signal.throwIfAborted();
      if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 3600000) throw new CodeBuddyProtocolError("request");
      const prepared = await prepareCodeBuddyRequest(model, access, context, options, signal);
      stage = "transport"; signal.throwIfAborted();
      response = await waitForNative((options.fetch ?? transport)(prepared.url, { method: "POST", headers: prepared.headers, body: prepared.body, signal, redirect: "error" }), signal, close);
      signal.throwIfAborted(); stage = "response";
      await waitForNative(options.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers) }), signal);
      signal.throwIfAborted();
      if (!response.ok) throw new CodeBuddyServiceError(response.status, await errorBody(response, signal));
      if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
        const value = await errorBody(response, signal);
        if (codeBuddyObject(value)?.error || codeBuddyBusinessCode(value) !== undefined || codeBuddyOverflowCode(value)) throw new CodeBuddyServiceError(response.status, value);
        throw new CodeBuddyProtocolError("response");
      }
      stage = "stream";
      yield { type: "start" }; signal.throwIfAborted();
      let finished: "stop" | "tool_calls" | undefined, done = false, hasText = false, responseId: string | undefined, usage: NativeTokenUsage | undefined, usagePartial = false;
      const tools = new Map<number, { call: NativeToolCall; json: string }>(), ids = new Set(prepared.seenCalls);
      for await (const frame of readCodeBuddySse(response.body, signal)) {
        if (done) throw new CodeBuddyProtocolError("terminal");
        if (frame.data === "[DONE]") {
          if (frame.event === "error" || !finished) throw new CodeBuddyProtocolError("terminal");
          done = true; continue;
        }
        let event: Record<string, unknown> | undefined;
        try { event = codeBuddyObject(JSON.parse(frame.data)); } catch { /* Invalid upstream JSON is never exposed. */ }
        if (frame.event === "error" || event?.error || codeBuddyBusinessCode(event) !== undefined || codeBuddyOverflowCode(event)) throw new CodeBuddyServiceError(response.status, event);
        if (!event || frame.event && !["message", "completion"].includes(frame.event) || !Array.isArray(event.choices) || event.choices.length > 1) throw new CodeBuddyProtocolError("stream");
        if (event.id !== undefined) {
          if (!identifier(event.id) || responseId && event.id !== responseId) throw new CodeBuddyProtocolError("stream");
          if (!responseId) { responseId = event.id; yield { type: "response-id", id: responseId }; }
        }
        if (event.model !== undefined && event.model !== model.id) throw new CodeBuddyProtocolError("target");
        await waitForNative(options.onProviderEvent?.(structuredClone(event)), signal); signal.throwIfAborted();
        if (event.usage !== undefined && event.usage !== null) {
          usagePartial = true; yield { type: "usage", state: "partial" }; signal.throwIfAborted();
          const counts = codeBuddyUsage(event.usage);
          if (counts) {
            if (usage && ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].some(key => counts[key as keyof NativeTokenUsage] < usage![key as keyof NativeTokenUsage])) throw new CodeBuddyProtocolError("usage");
            usage = counts; usagePartial = false; yield { type: "usage", state: "complete", counts };
          }
        }
        if (!event.choices.length) { if (!event.usage) throw new CodeBuddyProtocolError("stream"); continue; }
        const choice = codeBuddyObject(event.choices[0]), delta = codeBuddyObject(choice?.delta);
        if (!choice || choice.index !== 0 || !delta || finished) throw new CodeBuddyProtocolError("terminal");
        if (delta.role !== undefined && delta.role !== "assistant" || delta.refusal || !emptyLegacyCall(delta.function_call)) throw new CodeBuddyProtocolError("terminal");
        for (const field of ["content", "reasoning_content"] as const) {
          const text = delta[field];
          if (text !== undefined && text !== null) {
            if (typeof text !== "string") throw new CodeBuddyProtocolError("stream");
            if (text) {
              partial = true;
              if (field === "content") { hasText ||= !!text.trim(); yield { type: "text", delta: text }; }
              else yield { type: "thinking", delta: text };
            }
          }
        }
        if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
          if (!Array.isArray(delta.tool_calls)) throw new CodeBuddyProtocolError("tool");
          for (const raw of delta.tool_calls) {
            const fragment = codeBuddyObject(raw), fn = codeBuddyObject(fragment?.function);
            if (!fragment || !Number.isSafeInteger(fragment.index) || (fragment.index as number) < 0 || (fragment.index as number) >= 128 || !fn ||
                fragment.type !== undefined && fragment.type !== "function") throw new CodeBuddyProtocolError("tool");
            const index = fragment.index as number;
            let tool = tools.get(index);
            if (!tool) {
              if (!identifier(fragment.id) || ids.has(fragment.id) || typeof fn.name !== "string" || !prepared.tools.some(item => item.name === fn.name) || prepared.toolChoice === "none") throw new CodeBuddyProtocolError("tool");
              const forced = codeBuddyObject(codeBuddyObject(prepared.toolChoice)?.function)?.name;
              if (forced !== undefined && fn.name !== forced) throw new CodeBuddyProtocolError("tool");
              ids.add(fragment.id); tool = { call: { id: fragment.id, name: fn.name, arguments: {} }, json: "" }; tools.set(index, tool);
              partial = true; yield { type: "tool-start", id: tool.call.id, name: tool.call.name };
            // Subsequent CN argument fragments carry an empty name: no name delta,
            // never a replacement. The first fragment still requires a declared name.
            } else if (fragment.id !== undefined && fragment.id !== tool.call.id || fn.name !== undefined && fn.name !== "" && fn.name !== tool.call.name) throw new CodeBuddyProtocolError("tool");
            if (fn.arguments !== undefined) {
              if (typeof fn.arguments !== "string") throw new CodeBuddyProtocolError("tool");
              tool.json += fn.arguments;
              if (tool.json.length > 1024 * 1024) throw new CodeBuddyProtocolError("tool");
              yield { type: "tool-delta", id: tool.call.id, delta: fn.arguments };
            }
          }
        }
        // The CN stream uses an empty string for an unfinished choice; it is never a terminal.
        if (choice.finish_reason !== undefined && choice.finish_reason !== null && choice.finish_reason !== "") {
          if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") throw new CodeBuddyProtocolError("terminal");
          finished = choice.finish_reason as "stop" | "tool_calls";
          if (finished === "tool_calls" ? !tools.size : tools.size > 0) throw new CodeBuddyProtocolError("terminal");
        }
      }
      signal.throwIfAborted();
      if (!done || !finished || !tools.size && !hasText || !tools.size && (prepared.toolChoice === "required" || codeBuddyObject(prepared.toolChoice))) throw new CodeBuddyProtocolError("terminal");
      // Candidates become complete only AFTER finish + DONE + clean EOF. Host still owns execution approval.
      for (const { call, json } of tools.values()) {
        try {
          const parsed = codeBuddyObject(JSON.parse(json));
          if (!parsed) throw Error(); call.arguments = parsed;
          const definition = prepared.tools.find(tool => tool.name === call.name);
          if (!definition || !options.validateToolInput) throw Error();
          const validated = await waitForNative(options.validateToolInput(structuredClone(definition), structuredClone(call)), signal);
          if (JSON.stringify(validated) !== JSON.stringify(call.arguments)) throw Error();
        } catch { signal.throwIfAborted(); throw new CodeBuddyProtocolError("tool"); }
      }
      signal.throwIfAborted();
      for (const { call } of tools.values()) { yield { type: "tool-end", call: structuredClone(call) }; signal.throwIfAborted(); }
      if (!usage || usagePartial) yield diagnostic("codebuddy-usage-incomplete", { state: usagePartial ? "partial" : "unavailable", note: "零值不是实际计量或免费保证。" });
      signal.throwIfAborted();
      yield { type: "done", reason: tools.size ? "toolUse" : "stop" };
    } catch (error) {
      const aborted = lifetime.signal.aborted || options.signal?.aborted;
      yield diagnostic("codebuddy-failure", { stage, partial, ...(error instanceof CodeBuddyProtocolError ? { protocolCode: error.code } : {}),
        ...(error instanceof CodeBuddyServiceError ? { category: error.info.category, status: error.info.status, businessCode: error.info.businessCode } : {}), retry: "disabled" });
      yield { type: "error", reason: aborted ? "aborted" : "error", message: aborted ? "CodeBuddy 请求已取消。" : timeout.signal.aborted ? "CodeBuddy 请求超时。"
        : error instanceof CodeBuddyProtocolError || error instanceof CodeBuddyServiceError ? error.message : "CodeBuddy 网络、请求钩子或响应异常；未回显敏感数据。" };
    } finally { clearTimeout(timer); if (response) close(response); }
  }
  return { stream, dispose() { lifetime.abort(new DOMException("CodeBuddy 客户端已关闭。", "AbortError")); } };
}
