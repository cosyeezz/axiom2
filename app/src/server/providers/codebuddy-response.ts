// Normalize errors before OpenAI's SDK parses HTTP/SSE responses. The SDK can
// throw data.error / event:error before provider hooks, exposing upstream echoes.
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;
const details = (value: unknown) => object(object(value)?.error) ?? object(value);
const nonOverflowCodes = [401, 403, 429, 6004, 11102];
const overflowCodes = ["context_length_exceeded", "model_context_window_exceeded", "prompt_too_long", "input_too_long"];
function businessCode(value: unknown): number | undefined {
  // Parse both envelopes independently: a nested string must not hide a numeric
  // quota/auth code. Known non-overflow failures outrank generic business codes.
  const codes = [object(value)?.code, details(value)?.code].flatMap(code => {
    const number = typeof code === "number" ? code : typeof code === "string" && /^\d{1,6}$/.test(code) ? Number(code) : undefined;
    return number !== undefined && Number.isSafeInteger(number) && number !== 0 ? [number] : [];
  });
  return codes.find(code => nonOverflowCodes.includes(code)) ?? codes[0];
}
function hasOverflowCode(value: unknown): boolean {
  return [object(value), details(value)].some(error => [error?.code, error?.type].some(code => typeof code === "string" && overflowCodes.includes(code)));
}
function isOverflow(value: unknown, status: number, code?: number): boolean {
  if ([401, 403, 429].includes(status) || code !== undefined && nonOverflowCodes.includes(code)) return false;
  const error = details(value);
  if (hasOverflowCode(value)) return true;
  // Inspect only known, anchored descriptions; never forward their raw contents.
  const message = error?.message ?? error?.msg;
  return typeof message === "string" && /^(?:prompt (?:is )?too long\b|prompt exceeds max length\b|your input exceeds the context window\b|this model's maximum context length\b|input length .+ exceeds (?:the )?(?:model's )?maximum context length\b)/i.test(message);
}
function normalizedError(httpStatus: number, value: unknown) {
  const code = businessCode(value);
  const status = code === 6004 ? 429 : httpStatus >= 400 ? httpStatus
    : code === 11102 ? 403 : code !== undefined && code >= 400 && code <= 599 ? code
      : object(value)?.error || code !== undefined || details(value)?.message ? 400 : 502;
  const overflow = isOverflow(value, status, code);
  let message: string;
  if (status === 429) message = "CodeBuddy 请求过于频繁或额度不足，请稍后重试并检查账号额度（code 6004 / HTTP 429）。";
  else if (code === 11102) message = "CodeBuddy 当前账号无法使用此模型（code 11102），请选择其他模型。";
  else if (status === 401 || status === 403) message = `CodeBuddy 认证失败（HTTP ${status}），请重新登录。`;
  else if (overflow) message = "CodeBuddy 上下文超出模型窗口（context_length_exceeded），请压缩会话或减少输入。";
  else message = `CodeBuddy 请求失败（HTTP ${status}${code === undefined ? "" : `，code ${code}`}）。`;
  return { status: overflow && status < 400 ? 400 : status, error: { message, type: "codebuddy_error", ...(overflow ? { code: "context_length_exceeded" } : {}) } };
}

function normalizeEvent(frame: string): string {
  const data: string[] = [];
  let event = "";
  for (const line of frame.split(/\r\n|\r|\n/)) {
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    if (field === "event") event = value;
  }
  if (!data.length) return frame;
  const text = data.join("\n");
  if (text === "[DONE]") return frame;
  let value: unknown;
  try { value = JSON.parse(text); } catch { if (event !== "error") return frame; }
  if (event !== "error" && !object(value)?.error && businessCode(value) === undefined && !hasOverflowCode(value)) return frame;
  return `data: ${JSON.stringify({ error: normalizedError(200, value).error })}\n\n`;
}

function normalizeStream(response: Response): Response {
  if (!response.body) return response;
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  let buffer = "", frame = "";
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { buffer += decoder.decode(chunk, { stream: true }); drain(controller, false); },
    flush(controller) {
      buffer += decoder.decode();
      drain(controller, true);
      if (frame || buffer) controller.enqueue(encoder.encode(normalizeEvent(frame + buffer)));
    },
  });
  function drain(controller: TransformStreamDefaultController<Uint8Array>, final: boolean) {
    for (;;) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0 || (!final && buffer[index] === "\r" && index === buffer.length - 1)) return;
      const end = index + (buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1);
      frame += buffer.slice(0, end);
      buffer = buffer.slice(end);
      if (index === 0) { controller.enqueue(encoder.encode(normalizeEvent(frame))); frame = ""; }
    }
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  // pipeThrough preserves upstream cancellation/backpressure, rather than buffering
  // the complete completion or detaching a background reader from its caller.
  return new Response(response.body.pipeThrough(transform), { status: response.status, statusText: response.statusText, headers });
}

export function codeBuddyFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await transport(input, init);
    if (response.ok && response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) return normalizeStream(response);
    let value: unknown;
    try { value = await response.json(); } catch { /* Only the HTTP status is safe to retain. */ }
    const { status, error } = normalizedError(response.status, value);
    const headers = new Headers({ "content-type": "application/json" });
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) headers.set("retry-after", retryAfter);
    return new Response(JSON.stringify({ error }), { status, headers });
  };
}
