import { object, QoderError, qoderFailure } from "./qoder-protocol.js";

// Adapt envelope/finish/usage differences; pi owns text/tool/reasoning parsing.
// Malformed streams and mid-stream failures never become text or success.
export function unwrapQoderSse(response: Response, signal?: AbortSignal): Response {
  if (!response.ok || !response.body) throw qoderFailure(response.status);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    void response.body.cancel().catch(() => {});
    throw new QoderError("Qoder 未返回事件流，请检查账号权限。");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder();
  let buffer = "", data: string[] = [], frameBytes = 0, ended = false, cancelled = false, finish: string | undefined;
  const queue: Uint8Array[] = [], limit = 4 * 1024 * 1024;
  const emit = (value: unknown) => queue.push(encoder.encode(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`));
  const terminal = () => {
    if (!finish) throw new QoderError("Qoder 事件流提前结束，缺少结束状态。");
    if (!ended) { ended = true; emit("[DONE]"); }
  };
  const parse = (text: string): Record<string, unknown> => {
    try { return object(JSON.parse(text)); } catch { throw new QoderError("Qoder 事件流包含无效 JSON。"); }
  };
  const frame = () => {
    frameBytes = 0;
    if (!data.length || ended) { data = []; return; }
    const raw = data.join("\n"); data = [];
    if (raw === "[DONE]") { terminal(); return; }
    const envelope = parse(raw);
    if (Number(envelope.statusCodeValue) !== 200) throw qoderFailure(Number(envelope.statusCodeValue) || 502, envelope.body, "sse");
    if (envelope.body === "[DONE]") { terminal(); return; }
    if (envelope.body === "" || envelope.body == null) return;
    const chunk = typeof envelope.body === "string" ? parse(envelope.body) : object(envelope.body);
    if (chunk.error || chunk.code !== undefined && ![0, "0", 200, "200"].includes(chunk.code as number | string)) throw qoderFailure(502, chunk, "sse");
    if (!Array.isArray(chunk.choices)) throw new QoderError("Qoder 事件流缺少 choices。");
    for (const value of chunk.choices) {
      const choice = object(value), delta = choice.delta == null ? {} : object(choice.delta);
      choice.delta = delta;
      const reason = choice.finish_reason ?? delta.finish_reason;
      if (reason != null) {
        if (!["stop", "length", "tool_calls", "function_call", "content_filter"].includes(String(reason))) throw new QoderError("Qoder 返回未知结束状态。");
        choice.finish_reason = reason; finish = String(reason); delete delta.finish_reason;
      }
    }
    if (chunk.usage != null) {
      const usage = object(chunk.usage);
      const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
      const input = number(usage.prompt_tokens ?? usage.input_tokens), output = number(usage.completion_tokens ?? usage.output_tokens);
      if (input === undefined || output === undefined) throw new QoderError("Qoder 用量响应无效。");
      const details = usage.prompt_tokens_details == null ? {} : object(usage.prompt_tokens_details);
      const cached = number(details.cached_tokens ?? usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens);
      chunk.usage = { ...usage, prompt_tokens: input, completion_tokens: output, total_tokens: number(usage.total_tokens) ?? input + output,
        prompt_tokens_details: { ...details, ...(cached === undefined ? {} : { cached_tokens: cached }) } };
    }
    emit(chunk);
    // Reference legacy protocol sends final usage with/after finish, then may keep alive.
    // Earlier interim usage must NOT satisfy termination when finish arrives later.
    if (finish && chunk.usage != null) terminal();
  };
  const line = (value: string) => {
    frameBytes += Buffer.byteLength(value) + 1;
    if (frameBytes > limit) throw new QoderError("Qoder 单个事件超过大小限制。");
    value = value.replace(/\r$/, "");
    if (!value) frame();
    else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  };
  const lines = (eof = false) => {
    let index: number;
    while (!ended && (index = buffer.indexOf("\n")) >= 0) {
      const value = buffer.slice(0, index); buffer = buffer.slice(index + 1); line(value);
    }
    if (!ended && frameBytes + Buffer.byteLength(buffer) > limit) throw new QoderError("Qoder 单个事件超过大小限制。");
    if (eof && !ended) {
      if (buffer) line(buffer);
      buffer = ""; frame();
      if (!ended) terminal();
    }
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  // A custom transport's cancel promise may never settle. Output completion must not depend on it.
  const cleanup = () => { signal?.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal?.throwIfAborted();
        while (!queue.length && !ended && !cancelled) {
          const item = await reader.read();
          signal?.throwIfAborted();
          buffer += item.done ? decoder.decode() : decoder.decode(item.value, { stream: true });
          lines(item.done);
        }
        if (cancelled) return;
        if (queue.length) controller.enqueue(queue.shift()!);
        if (ended && !queue.length) { cleanup(); controller.close(); }
      } catch (error) {
        cleanup();
        if (!cancelled) controller.error(signal?.aborted ? signal.reason : error instanceof QoderError ? error : new QoderError("Qoder 事件流读取失败，响应不完整。"));
      }
    },
    cancel() { cancelled = true; cleanup(); },
  });
  return new Response(stream, { status: response.status, headers: { ...Object.fromEntries(response.headers), "content-type": "text/event-stream" } });
}
