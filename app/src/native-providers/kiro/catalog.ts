import { createHash, randomUUID } from "node:crypto";
import type { NativeModel } from "../contracts.js";
import type { KiroCredential } from "./auth.js";
import { kiroThinkingCapabilities } from "./thinking.js";
import { resolveKiroProfile } from "./profile.js";

type Json = Record<string, unknown>;
const maxBytes = 2 * 1024 * 1024;
const maxModels = 1000;
const regions = new Set(["us-east-1", "eu-central-1"]);
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Kiro 模型目录响应格式无效。");
  return value as Json;
}
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
}
export function validateKiroCredential(input: unknown): KiroCredential {
  const credential = input && typeof input === "object" && !Array.isArray(input) ? input as Partial<KiroCredential> : undefined;
  if (credential?.type !== "oauth" || !text(credential.access, 32768) || !text(credential.refresh, 32768) ||
      !["builder-id", "identity-center", "social"].includes(String(credential.authMethod)) ||
      !text(credential.authRegion, 64) || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(credential.authRegion) || credential.authRegion.startsWith("cn-") ||
      typeof credential.expires !== "number" || !Number.isSafeInteger(credential.expires))
    throw Error("Kiro 目录凭据无效，请重新登录。");
  if (credential.authMethod === "social" && credential.authRegion !== "us-east-1")
    throw Error("Kiro 个人社交登录的认证区域无效，请重新登录。");
  if (credential.profileArn !== undefined && (!text(credential.profileArn, 2048) ||
      !/^arn:aws:(?:codewhisperer|qdeveloper):(?:us-east-1|eu-central-1):\d{12}:profile\/[A-Za-z0-9._/-]+$/.test(credential.profileArn)))
    throw Error("Kiro profile ARN 无效或区域不受支持，请重新选择账号配置。");
  return credential as KiroCredential;
}
export function kiroServiceRegion(credential: KiroCredential): string {
  // CLI selects the service region from the chosen profile, not the SSO login region.
  const region = credential.profileArn?.split(":")[3];
  return region && regions.has(region) ? region : "us-east-1";
}
export function kiroCatalogScope(credential: unknown): string | undefined {
  try {
    const value = validateKiroCredential(credential);
    return createHash("sha256").update(JSON.stringify(["kiro-catalog-v1", value.authMethod, value.authRegion,
      value.refresh, value.profileArn ?? null, kiroServiceRegion(value)])).digest("hex");
  } catch { return undefined; }
}
function limit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === 0) return undefined; // Unknown, including nullable service fields.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 100_000_000)
    throw Error("Kiro 模型 token 上限格式无效。");
  return value;
}
export interface KiroCatalogModel extends NativeModel {
  serviceRegion: string;
  declaredInputTypes?: string[];
}
/** Native facts, not an SDK Model, API routing configuration or price estimate. */
export function describeKiroModel(value: unknown, serviceRegion: string): KiroCatalogModel {
  if (!regions.has(serviceRegion)) throw Error("Kiro 服务区域不受支持。");
  const item = object(value);
  if (!text(item.modelId, 512) || item.modelName != null && !text(item.modelName, 1024))
    throw Error("Kiro 模型标识或名称无效。");
  const limits = item.tokenLimits == null ? {} : object(item.tokenLimits);
  const inputTypes = item.supportedInputTypes;
  if (inputTypes != null && (!Array.isArray(inputTypes) || !inputTypes.every(value => text(value, 128))))
    throw Error("Kiro 模型输入能力格式无效。");
  return {
    id: item.modelId, name: typeof item.modelName === "string" ? item.modelName : item.modelId,
    serviceRegion,
    // IMAGE is an upstream declaration, not a guess from the model name. Missing
    // declarations remain unknown; text is the baseline, not evidence of no vision.
    input: inputTypes?.includes("IMAGE") ? ["text", "image"] : ["text"], thinking: kiroThinkingCapabilities(item.modelId),
    ...(inputTypes != null ? { declaredInputTypes: [...inputTypes] } : {}),
    contextWindow: limit(limits.maxInputTokens), maxOutputTokens: limit(limits.maxOutputTokens),
  };
}
/** Bound waiting even when an injected transport/reader ignores the abort signal. */
function waitForCatalog<T>(work: PromiseLike<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); reject(signal.reason);
    };
    Promise.resolve(work).then(value => {
      if (settled) { late?.(value); return; }
      settled = true; signal.removeEventListener("abort", abort); resolve(value);
    }, error => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); reject(error);
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
function cancelCatalogBody(response: Response) {
  if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
}
async function responseJson(response: Response, signal: AbortSignal): Promise<Json> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    cancelCatalogBody(response);
    throw Error("Kiro 模型目录响应超过本地 2 MiB 限制。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Kiro 模型目录响应为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await waitForCatalog(reader.read(), signal); }
      catch {
        signal.throwIfAborted();
        throw Error("Kiro 模型目录响应读取失败，请检查网络后重试。");
      }
      const { done, value } = chunk;
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("Kiro 模型目录响应超过本地 2 MiB 限制。");
      chunks.push(value);
    }
    try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch { throw Error("Kiro 模型目录响应格式无效。"); }
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function fetchKiroCatalog(credential: unknown, signal: AbortSignal, transport: typeof fetch = globalThis.fetch): Promise<KiroCatalogModel[]> {
  const selected = validateKiroCredential(credential);
  if (selected.expires <= Date.now()) throw Error("Kiro 访问令牌已过期，请刷新认证后重试。");
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  // Enterprise tokens may lack a profile. Resolve it from this account only;
  // management rejects a missing ARN. Never mutate/persist the caller credential.
  const account = selected.authMethod === "identity-center" && !selected.profileArn
    ? await waitForCatalog(resolveKiroProfile(selected, bounded,
      (input, init) => waitForCatalog(transport(input, init), bounded, cancelCatalogBody)), bounded)
    : selected;
  bounded.throwIfAborted();
  const serviceRegion = kiroServiceRegion(account), baseUrl = `https://management.${serviceRegion}.kiro.dev`;
  const models = new Map<string, KiroCatalogModel>(), tokens = new Set<string>();
  let nextToken: string | undefined;
  // Kiro CLI's control-plane client uses AWS JSON 1.0, not the legacy
  // CodeWhisperer query/body serializer (see docs/evidence/kiro-catalog-repair-01).
  // Preserve the selected identity; discovery must never invent or borrow a profile.
  for (let page = 0; page < 20; page++) {
    bounded.throwIfAborted();
    const body = { origin: "KIRO_CLI", ...(account.profileArn ? { profileArn: account.profileArn } : {}),
      ...(nextToken ? { nextToken } : {}) };
    const url = new URL(baseUrl + "/");
    let response: Response;
    try {
      response = await waitForCatalog(transport(url.href, {
        method: "POST", redirect: "error", signal: bounded,
        headers: { Authorization: `Bearer ${account.access}`, "Content-Type": "application/x-amz-json-1.0",
          Accept: "application/json", "x-amz-target": "KiroControlPlaneBearerService.ListAvailableModels",
          "amz-sdk-invocation-id": randomUUID(), "amz-sdk-request": "attempt=1; max=1" },
        body: JSON.stringify(body),
      }), bounded, cancelCatalogBody);
    } catch {
      bounded.throwIfAborted();
      throw Error("Kiro 模型目录网络请求失败，请检查网络后重试。");
    }
    if (bounded.aborted) {
      cancelCatalogBody(response);
      bounded.throwIfAborted();
    }
    if (!response.ok) {
      cancelCatalogBody(response);
      if (response.status === 401) throw Error("Kiro 认证已失效，请重新登录后拉取模型目录。");
      if (response.status === 403) throw Error("Kiro 账号无权读取模型目录，请检查订阅、组织权限及所选 profile。");
      if (response.status === 429) throw Error("Kiro 模型目录请求被限流，请稍后重试。");
      throw Error(`Kiro 模型目录请求失败（HTTP ${response.status}）。`);
    }
    const result = await responseJson(response, bounded);
    if (!Array.isArray(result.models) || result.models.length > maxModels)
      throw Error("Kiro 模型目录缺少有效的 models 数组。");
    // The current CLI accepts a catalog without a default. A supplied default
    // must still be valid and must never add an identity outside models[].
    if (result.defaultModel != null) describeKiroModel(result.defaultModel, serviceRegion);
    for (const item of result.models) {
      const model = describeKiroModel(item, serviceRegion);
      if (!models.has(model.id)) models.set(model.id, model);
      if (models.size > maxModels) throw Error("Kiro 模型目录超过本地 1000 项限制。");
    }
    bounded.throwIfAborted();
    if (result.nextToken === undefined || result.nextToken === null || result.nextToken === "") return [...models.values()];
    if (!text(result.nextToken, 8192) || tokens.has(result.nextToken))
      throw Error("Kiro 模型目录分页标记无效或重复。");
    nextToken = result.nextToken;
    tokens.add(nextToken);
  }
  throw Error("Kiro 模型目录超过本地 20 页限制；未发布不完整目录。");
}
