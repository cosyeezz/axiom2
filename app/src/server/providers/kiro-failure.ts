import { setImmediate as yieldImmediate } from "node:timers/promises";
import { kiroObservedValidationReasons, type KiroObservedValidationReason } from "../../shared/kiro-failure.js";

const MAX_ERROR_BYTES = 16 * 1024;
export type KiroErrorBody = { state: "empty" | "json" | "invalid" | "too-large" | "timeout" | "aborted" | "unreadable"; data?: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function readBounded(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => { signal.throwIfAborted(); return reader.read(); }).then(value => {
      signal.removeEventListener("abort", abort); resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

/** Error bodies are optional evidence, never an unbounded response.text() or a user-facing error. */
export async function readKiroErrorBody(response: Response, signal: AbortSignal, timeoutMs = 1000): Promise<KiroErrorBody> {
  if (!response.body) return { state: "empty" };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 1000) : 1000)]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    deadline.throwIfAborted();
    if (Number(response.headers.get("content-length")) > MAX_ERROR_BYTES) return { state: "too-large" };
    reader = response.body.getReader();
    const buffer = Buffer.allocUnsafe(MAX_ERROR_BYTES); let size = 0, reads = 0, lastYield = performance.now();
    for (;;) {
      const next = await readBounded(reader, deadline); deadline.throwIfAborted();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) return { state: "unreadable" };
      if (size + next.value.byteLength > MAX_ERROR_BYTES) return { state: "too-large" };
      buffer.set(next.value, size); size += next.value.byteLength;
      if (++reads >= 256 || performance.now() - lastYield >= 8) {
        await yieldImmediate(undefined, { signal: deadline }); reads = 0; lastYield = performance.now();
      }
    }
    if (!size) return { state: "empty" };
    try {
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
      return record(parsed) ? { state: "json", data: parsed } : { state: "invalid" };
    } catch { return { state: "invalid" }; }
  } catch { return { state: signal.aborted ? "aborted" : deadline.aborted ? "timeout" : "unreadable" }; }
  finally {
    // Neither a hostile injected reader nor an uncooperative cancel may hold the request open.
    if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    else if (!response.body.locked) { try { void response.body.cancel().catch(() => {}); } catch {} }
  }
}

const categories = {
  AccessDeniedException: "auth", UnauthorizedException: "auth", UnrecognizedClientException: "auth",
  ValidationException: "validation", ServiceQuotaExceededException: "quota",
  ThrottlingException: "throttle", TooManyRequestsException: "throttle",
  InternalServerException: "transient", InternalServerError: "transient", ServiceUnavailableException: "transient",
  ContextLengthExceededException: "overflow", InputTooLongException: "overflow",
} as const;
type KnownCode = keyof typeof categories;
export type KiroFailureCategory = typeof categories[KnownCode] | "unknown";
export type KiroFailureInfo = {
  stage: "http" | "stream"; status: number; category: KiroFailureCategory; conflict: boolean;
  evidence: "code" | "local-signature" | "http-status" | "none"; code?: KnownCode; requestId?: string; bodyState?: KiroErrorBody["state"];
  observedValidationReason?: KiroObservedValidationReason;
};
function code(value: unknown): KnownCode | undefined {
  if (typeof value !== "string" || value.length > 256 || !/^(?:[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*#)?[A-Za-z][A-Za-z0-9_]*$/.test(value)) return;
  const name = value.slice(value.lastIndexOf("#") + 1);
  return Object.hasOwn(categories, name) ? name as KnownCode : undefined;
}
const allowedStatus: Record<Exclude<KiroFailureCategory, "unknown">, readonly number[]> = {
  auth: [400, 401, 403], validation: [400, 413, 422], quota: [400, 402, 403, 429],
  throttle: [400, 429, 503], overflow: [400, 413, 422], transient: [408, 500, 502, 503, 504, 520, 524],
};
// Local recognition policy, not a claim about the complete official service error contract.
const overflowSignatures = new Set(["input is too long for requested model", "context length exceeded", "prompt is too long"]);
function overflowMessage(value: unknown) {
  return typeof value === "string" && value.length <= 160 && overflowSignatures.has(value.trim().replace(/\.$/, "").toLowerCase());
}
/** Observation only: never changes categories, recovery messages, or retry/compaction policy. */
function observeValidationReason(objects: Record<string, unknown>[], category: KiroFailureCategory, conflict: boolean): KiroObservedValidationReason | undefined {
  if (conflict || category !== "validation" && category !== "overflow") return;
  const tokens = new Set<KiroObservedValidationReason["token"]>();
  for (const object of objects) {
    const reason = Object.getOwnPropertyDescriptor(object, "reason");
    if (!reason) continue;
    if (!("value" in reason)) return;
    const selfCodes = ["__type", "code", "type"].map(key => {
      const field = Object.getOwnPropertyDescriptor(object, key);
      return field && "value" in field ? code(field.value) : undefined;
    });
    // A header or another object's code must not lend meaning to this reason.
    if (!selfCodes.includes("ValidationException")) return;
    const token = kiroObservedValidationReasons.find(candidate => candidate === reason.value);
    if (!token) return; // Unknown or non-string reasons make the observation ambiguous.
    tokens.add(token);
  }
  if (tokens.size !== 1) return;
  const [token] = tokens;
  if (!token) return;
  return { token, contract: "unverified", source: "local-static-allowlist" };
}
export function classifyKiroFailure(input: { stage: "http" | "stream"; status: number; codes?: unknown[]; body?: KiroErrorBody; requestId?: unknown }): KiroFailureInfo {
  const objects = input.body?.state === "json" && input.body.data ? [input.body.data, ...(record(input.body.data.error) ? [input.body.data.error] : [])] : [];
  const objectCodes = (value: Record<string, unknown>) => [value.__type, value.code, value.type].map(code);
  const headerCodes = (input.codes ?? []).map(code);
  const known = [...new Set([...headerCodes, ...objects.flatMap(objectCodes)].filter((value): value is KnownCode => !!value))];
  const kinds = new Set<KiroFailureCategory>(known.map(value => categories[value]));
  let evidence: KiroFailureInfo["evidence"] = known.length ? "code" : "none";
  let category: KiroFailureCategory = kinds.size === 1 ? [...kinds][0] : "unknown", conflict = kinds.size > 1;
  // A signature may refine one validation category, never erase an existing conflict
  // or borrow a message from an unrelated nested error object.
  if (!conflict && category === "validation" && (objects.some(value => objectCodes(value).includes("ValidationException") && overflowMessage(value.message))
    || headerCodes.includes("ValidationException") && overflowMessage(objects[0]?.message))) {
    category = "overflow"; evidence = "local-signature";
  }
  if (category !== "unknown" && input.stage === "http" && !allowedStatus[category].includes(input.status)) { category = "unknown"; conflict = true; }
  if (!known.length && input.stage === "http") {
    // A real HTTP status is independent evidence, even when a proxy supplied non-JSON.
    if (input.status === 401 || input.status === 403) category = "auth";
    else if (allowedStatus.transient.includes(input.status)) category = "transient";
    if (category !== "unknown") evidence = "http-status";
  }
  const requestId = typeof input.requestId === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.requestId) ? input.requestId : undefined;
  const observedValidationReason = observeValidationReason(objects, category, conflict);
  return { stage: input.stage, status: input.status, category, conflict, evidence,
    ...(known.length === 1 ? { code: known[0] } : {}), ...(requestId ? { requestId } : {}), ...(input.body ? { bodyState: input.body.state } : {}),
    ...(observedValidationReason ? { observedValidationReason } : {}) };
}
const localFailureCodes = new Map([
  ["Kiro 未返回有效文本或工具调用，不能将空回复或未知事件视为成功。", "empty-response"],
  ["Kiro 工具调用 ID 与既有历史重复；未执行该工具。", "tool-id-duplicate"],
  ["Kiro token 用量总计与分项不一致。", "usage-inconsistent"],
  ["Kiro 工具参数超过本地 1 MiB 限制。", "tool-input-too-large"],
  ["Kiro 工具调用流被截断，未执行不完整的工具请求。", "tool-incomplete"],
  ["Kiro 工具参数 JSON 无效或被截断；未执行该工具。", "tool-json-invalid"],
  ["Kiro 工具参数不符合声明的 JSON Schema；未执行该工具。", "tool-schema-invalid"],
]);
/** Only exact, fixed local diagnostics may supplement the no-replay partial prefix. */
export function kiroLocalFailure(message: string) {
  const code = localFailureCodes.get(message);
  return code ? { code, note: message } : undefined;
}
export class KiroServiceFailure extends Error {
  constructor(readonly info: KiroFailureInfo) { super("Kiro 服务响应失败。"); }
}
export const kiroPartialFailure = "Kiro 响应未完整结束；已收到部分内容或工具片段，未重放请求。";
export function kiroFailureMessage(info: KiroFailureInfo, partial: boolean) {
  if (partial) return kiroPartialFailure;
  if (info.category === "auth") return "Kiro 认证或所选模型权限未通过，请检查账号、订阅、组织权限及 profile。";
  if (info.category === "quota") return "Kiro 服务报告配额限制；请检查服务配额和账号权限，未推断余额或周期。";
  if (info.category === "validation") return "Kiro 请求验证失败，请检查消息、所选模型及 profile。";
  if (info.category === "throttle") return "Kiro rate limit；服务暂时限制请求速率。";
  if (info.category === "transient") return "Kiro service unavailable；服务暂时未能完成请求。";
  if (info.category === "overflow") return "Kiro context length exceeded；服务报告输入超出上下文限制。";
  return "Kiro 服务响应失败；原因未确认，未自动重放请求。";
}
