import { randomUUID } from "node:crypto";
import { object, QoderError, qoderFailure } from "./qoder-protocol.js";
import { qoderReplayDetail } from "./qoder-client.js";

// Legacy K2/Got/fRe semantics. Pi still owns text/tool assembly and usage accounting.
export function unwrapQoderSse(response: Response, signal?: AbortSignal, options: { onNotification?: (notifications: unknown[]) => void; finishIdleMs?: number } = {}): Response {
  if (!response.ok || !response.body) throw qoderFailure(response.status);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    void response.body.cancel().catch(() => {}); throw new QoderError("Qoder 未返回事件流，请检查账号权限。");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder();
  let buffer = "", data: string[] = [], event = "", frameBytes = 0, ended = false, cancelled = false, finish: string | undefined, finalUsage = false;
  let signature = "", reasoningItem: Record<string, unknown> | undefined, replaySent = false;
  const queue: Uint8Array[] = [], limit = 4 * 1024 * 1024;
  const replayEntries: Record<string, unknown>[] = [];
  const tools = new Map<number, { id: string; name: string; arguments: string }>();
  let legacyToolId: string | undefined;
  const malformedTool = () => new QoderError("Qoder 工具流格式无效（MALFORMED_TOOL_CALL_STREAM）。");
  const validateTools = () => {
    const ids = new Set<string>();
    for (const tool of tools.values()) {
      if (!tool.id || !tool.name || ids.has(tool.id)) throw malformedTool();
      ids.add(tool.id);
      try { const args = tool.arguments.trim() ? JSON.parse(tool.arguments) : {}; object(args); } catch { throw malformedTool(); }
    }
  };
  const emit = (value: unknown) => queue.push(encoder.encode(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`));
  const terminal = () => {
    if (!finish) throw new QoderError("Qoder 事件流提前结束，缺少结束状态。");
    if (!ended) { ended = true; emit("[DONE]"); }
  };
  const parse = (text: string): Record<string, unknown> => {
    try { return object(JSON.parse(text)); } catch { throw new QoderError("Qoder 事件流包含无效 JSON。"); }
  };
  const notification = (value: unknown): boolean => {
    if (typeof value !== "string" || !value.startsWith("[NOTIFICATIONS]")) return false;
    if (!value.startsWith("[NOTIFICATIONS]#")) return true;
    try { const valueObject = JSON.parse(value.slice("[NOTIFICATIONS]#".length)); if (Array.isArray(valueObject?.notifications) && valueObject.notifications.length) options.onNotification?.(valueObject.notifications); } catch { /* Official notifications are best effort, never model text. */ }
    return true;
  };
  const finishReason = (value: unknown) => {
    if (value == null || value === "null") return;
    if (value === "model_context_window_exceeded") throw new QoderError("Qoder 模型上下文窗口已超限（HTTP 413）。");
    if (["content_filter", "refusal", "sensitive"].includes(String(value))) return "content_filter";
    if (value === "function_call") return "tool_calls";
    if (["stop", "length", "tool_calls"].includes(String(value))) return String(value);
    throw new QoderError("Qoder 返回未知结束状态。");
  };
  const frame = () => {
    frameBytes = 0;
    const frameEvent = event; event = "";
    if (!data.length || ended) { data = []; return; }
    const raw = data.join("\n").trim(); data = [];
    if (!raw || raw === "[NOT_EXCEED_QUOTA]" || raw.startsWith("[EXCEED_QUOTA]") || notification(raw)) return;
    if (raw === "[DONE]") { terminal(); return; }
    const envelope = parse(raw);
    // Preserve the existing explicit notification payload path; generic notification
    // markers must still pass wrapper status checks below.
    if (typeof envelope.body === "string" && envelope.body.startsWith("[NOTIFICATIONS]#") && notification(envelope.body)) return;
    let chunk = envelope;
    if (Object.hasOwn(envelope, "statusCodeValue")) {
      if (frameEvent !== "finish" && Number(envelope.statusCodeValue) !== 200) {
        let code: unknown; try { code = typeof envelope.body === "string" ? JSON.parse(envelope.body)?.code : object(envelope.body).code; } catch { /* Never expose raw server errors. */ }
        const status = Number(envelope.statusCodeValue) || 502;
        const body = typeof envelope.body === "string" ? envelope.body.trim() : undefined;
        const bodyKind = body !== undefined ? !body ? "blank" : body.startsWith("[NOTIFICATIONS]") ? "notification" : body.startsWith("[EXCEED_QUOTA]") || body === "[NOT_EXCEED_QUOTA]" ? "quota" : body === "[DONE]" ? "done" : (() => { try { JSON.parse(body); return "json"; } catch { return "text"; } })()
          : envelope.body == null ? "null" : Array.isArray(envelope.body) ? "array" : typeof envelope.body === "object" ? "object" : "other";
        const eventKind = frameEvent === "error" ? "error" : frameEvent ? "other" : "message";
        const numericCode = (typeof code === "number" || typeof code === "string" && /^\d+$/.test(code)) && Number.isSafeInteger(Number(code)) && Number(code) >= 0 && Number(code) <= 1_000_000 ? Number(code) : "none";
        throw new QoderError(`${qoderFailure(status, code).message} [sse_wrapper status=${status} event=${eventKind} body=${bodyKind} code=${numericCode}]`);
      }
      if (envelope.body == null) return;
      if (typeof envelope.body === "string") {
        const body = envelope.body.trim();
        // K2/LEA treats wrapped keepalives and quota markers as control frames, not JSON.
        // A wrapped DONE is not a completion: a choice finish_reason is still required.
        if (!body || body === "[DONE]" || body === "[NOT_EXCEED_QUOTA]" || body.startsWith("[EXCEED_QUOTA]") || notification(body)) return;
        chunk = parse(body);
      } else chunk = object(envelope.body);
    }
    if (chunk.error || chunk.code !== undefined && ![0, "0", 200, "200"].includes(chunk.code as number | string)) throw qoderFailure(502, chunk.code ?? (typeof chunk.error === "object" && chunk.error ? (chunk.error as Record<string, unknown>).code : undefined));
    if (chunk.queue && object(chunk.queue).isQueued === true) throw qoderFailure(502, 10605);
    if (!Array.isArray(chunk.choices) && chunk.choices != null) throw new QoderError("Qoder 事件流 choices 格式无效。");
    if (chunk.choices == null || (chunk.choices as unknown[]).length === 0) {
      // Official fRe skips auxiliary JSON without choices. Limit that tolerance to empty
      // frames and known metadata, including usage-only frames; usage must not bypass it.
      const metadataOnly = Object.entries(chunk).every(([key, value]) => {
        if (key === "choices") return value == null || Array.isArray(value) && value.length === 0;
        if (key === "usage") return value == null || typeof value === "object" && !Array.isArray(value);
        if (key === "id" || key === "object" || key === "model") return typeof value === "string";
        if (key === "created") return typeof value === "number" && Number.isFinite(value) && value >= 0;
        if (key === "system_fingerprint" || key === "service_tier") return value == null || typeof value === "string";
        if (key === "code") return [0, "0", 200, "200"].includes(value as number | string);
        if (key === "queue") {
          const queue = object(value);
          return queue.isQueued === false && Object.keys(queue).every(key => key === "isQueued");
        }
        return false;
      });
      if (!metadataOnly) throw new QoderError("Qoder 事件流缺少 choices（未知事件结构）。");
      if (chunk.usage == null) return;
      chunk.choices = [];
    }
    for (const value of chunk.choices as unknown[]) {
      const choice = object(value), delta = choice.delta == null ? choice.message == null ? {} : object(choice.message) : object(choice.delta);
      choice.delta = delta; delete choice.message;
      const reason = finishReason(choice.finish_reason ?? delta.finish_reason);
      const hasContent = Object.entries(delta).some(([key, value]) => key !== "role" && key !== "finish_reason" && value != null && value !== "" && !(key === "tool_calls" && Array.isArray(value) && !value.length));
      if (finish && reason && finish !== reason) throw new QoderError("Qoder 事件流包含冲突的结束状态（conflicting_finish_reason）。");
      if (finish && hasContent) throw new QoderError("Qoder 事件流结束后仍返回内容（content_after_finish）。");
      if (delta.reasoning_item != null) {
        const item = object(delta.reasoning_item);
        if (reasoningItem && item.id && reasoningItem.id && item.id !== reasoningItem.id) {
          replayEntries.push({ ...(signature ? { signature } : {}), item: reasoningItem }); signature = ""; reasoningItem = undefined;
        }
        reasoningItem = { ...reasoningItem, ...item };
      }
      if (typeof delta.signature === "string") signature += delta.signature;
      if (typeof delta.reasoning_content_signature === "string") signature += delta.reasoning_content_signature;
      if (typeof delta.encrypted_content === "string") reasoningItem = { ...reasoningItem, type: "reasoning", encrypted_content: delta.encrypted_content };
      delete delta.signature; delete delta.reasoning_content_signature; delete delta.reasoning_item; delete delta.encrypted_content;
      if (delta.function_call != null) {
        if (delta.tool_calls != null) throw malformedTool();
        const call = object(delta.function_call); legacyToolId ??= randomUUID();
        delta.tool_calls = [{ index: 0, ...(tools.has(0) ? {} : { id: legacyToolId, type: "function" }), function: call }]; delete delta.function_call;
      }
      if (delta.tool_calls != null) {
        if (!Array.isArray(delta.tool_calls)) throw malformedTool();
        for (const rawTool of delta.tool_calls) {
          const tool = object(rawTool), index = tool.index;
          if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw malformedTool();
          const fn = object(tool.function ?? {}), previous = tools.get(index);
          if (!previous && (typeof tool.id !== "string" || !tool.id.trim())) throw malformedTool();
          if (previous && tool.id !== undefined && tool.id !== previous.id) throw malformedTool();
          const name = fn.name;
          if (name !== undefined && (typeof name !== "string" || previous?.name && name !== previous.name)) throw malformedTool();
          if (fn.arguments !== undefined && typeof fn.arguments !== "string") throw malformedTool();
          tools.set(index, { id: previous?.id ?? String(tool.id), name: previous?.name || String(name ?? ""), arguments: (previous?.arguments ?? "") + (fn.arguments ?? "") });
        }
      }
      if (reason) {
        validateTools();
        choice.finish_reason = reason; finish = reason;
        if (!replaySent && (signature || reasoningItem || replayEntries.length)) {
          if (signature || reasoningItem) replayEntries.push({ ...(signature ? { signature } : {}), ...(reasoningItem ? { item: reasoningItem } : {}) });
          delta.reasoning_details = [qoderReplayDetail({ entries: replayEntries })];
          replaySent = true;
        }
      } else delete choice.finish_reason;
      delete delta.finish_reason;
    }
    if (chunk.usage != null) {
      const usage = object(chunk.usage), number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
      const input = number(usage.prompt_tokens ?? usage.input_tokens), output = number(usage.completion_tokens ?? usage.output_tokens);
      if (input === undefined || output === undefined) throw new QoderError("Qoder 用量响应无效。");
      const details = usage.prompt_tokens_details == null ? {} : object(usage.prompt_tokens_details);
      const cached = number(details.cached_tokens ?? usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens);
      chunk.usage = { ...usage, prompt_tokens: input, completion_tokens: output, total_tokens: number(usage.total_tokens) ?? input + output, prompt_tokens_details: { ...details, ...(cached === undefined ? {} : { cached_tokens: cached }) } };
      if (finish) finalUsage = true;
    }
    emit(chunk);
  };
  const line = (value: string) => {
    frameBytes += Buffer.byteLength(value) + 1;
    if (frameBytes > limit) throw new QoderError("Qoder 单个事件超过大小限制。");
    value = value.replace(/\r$/, "");
    if (!value) frame();
    else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
    else if (value.startsWith("event:")) event = value.slice(6).trim();
  };
  const lines = (eof = false) => {
    let index: number;
    while (!ended && (index = buffer.indexOf("\n")) >= 0) { const value = buffer.slice(0, index); buffer = buffer.slice(index + 1); line(value); }
    if (!ended && frameBytes + Buffer.byteLength(buffer) > limit) throw new QoderError("Qoder 单个事件超过大小限制。");
    if (eof && !ended) { if (buffer) line(buffer); buffer = ""; frame(); if (!ended) terminal(); }
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const cleanup = () => { signal?.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal?.throwIfAborted();
        while (!queue.length && !ended && !cancelled) {
          // Some legacy gateways never close after final usage. Allow a bounded idle grace instead
          // of discarding all subsequent frames immediately. Set Infinity for strict EOF/DONE behavior.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const idleMs = options.finishIdleMs ?? 1000;
          const item = await (finish && finalUsage && !buffer && !data.length && !event && Number.isFinite(idleMs) ? Promise.race([reader.read(), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), Math.max(1, idleMs)); })]) : reader.read()).finally(() => clearTimeout(timer));
          signal?.throwIfAborted();
          if (!item) { terminal(); break; }
          buffer += item.done ? decoder.decode() : decoder.decode(item.value, { stream: true });
          lines(item.done);
        }
        if (cancelled) return;
        if (queue.length) controller.enqueue(queue.shift()!);
        if (ended && !queue.length) { cleanup(); controller.close(); }
      } catch (error) {
        cleanup(); if (!cancelled) controller.error(signal?.aborted ? signal.reason : error instanceof QoderError ? error : new QoderError("Qoder 事件流读取失败，响应不完整。"));
      }
    },
    cancel() { cancelled = true; cleanup(); },
  });
  return new Response(stream, { status: response.status, headers: { ...Object.fromEntries(response.headers), "content-type": "text/event-stream" } });
}
