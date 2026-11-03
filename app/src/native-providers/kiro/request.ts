import { randomUUID } from "node:crypto";
import { kiroNativeHttp } from "./http.js";
import { KiroChatError, kiroObject, kiroText, kiroNativeChatRequest, kiroNativeEndpoint, type KiroJson, type KiroNativeContext, type KiroNativeProfile } from "./protocol.js";
import { kiroResponsesRequest, usesKiroResponses, KIRO_CONTINUATION_METADATA, validateKiroContinuationId } from "./responses.js";
import { waitForNative as waitForKiro } from "../abort.js";

export { kiroNativeChatRequest, KiroChatError, type KiroNativeContext, type KiroNativeMessage } from "./protocol.js";
export { readKiroResponses, readKiroSse } from "./responses.js";
export { readKiroEvents } from "./eventstream.js";

// Version-bound compatibility target, not the installed Axiom/Node version.
// Exact macOS value observed in docs/evidence/kiro-macos-native-02/mitm-manual-official-chat-01/SUMMARY.md.
// Other os values are platform substitutions, not separately captured parity evidence.
export const KIRO_CLI_COMPATIBILITY = Object.freeze({ cliVersion: "2.36.0", kasVersion: "0.66.70" });
export function kiroCliUserAgent(platform: NodeJS.Platform = process.platform) {
  const { cliVersion, kasVersion } = KIRO_CLI_COMPATIBILITY;
  return `KiroCLI/${cliVersion} KAS/${kasVersion} os/${platform} md/appVersion-${cliVersion} app/AmazonQ-For-CLI acp-client/kiro-cli`;
}

/** Credentials belong to the caller. No Pi auth ticket, credential store, registry or agent is required. */
export type KiroNativeAccount = KiroNativeProfile & { access: string; expires: number; authMethod?: string };
export type KiroNativeIdentity = { continuationId?: string };
export function createKiroNativeRequest(modelId: string, context: KiroNativeContext, account: KiroNativeProfile, sessionId?: string, identity: KiroNativeIdentity = {}) {
  const request = kiroNativeChatRequest(modelId, context, account, sessionId);
  const responses = usesKiroResponses(modelId);
  return { ...request, payload: responses ? kiroResponsesRequest(request.payload, identity.continuationId) : request.payload, responses };
}

/** Fixed native destination and protected wire identity, shared by standalone callers and the Pi adapter. */
export function prepareKiroNativeRequest(modelId: string, account: KiroNativeAccount, request: KiroJson, extraHeaders: Record<string, string | null> = {}) {
  if (!kiroText(modelId) || !kiroText(account.access, 32768) || !Number.isSafeInteger(account.expires) || account.expires <= Date.now())
    throw new KiroChatError("Kiro 原生请求凭据或模型无效、已过期，请刷新认证。");
  if (account.authMethod === "identity-center" && !account.profileArn)
    throw new KiroChatError("Kiro Identity Center 原生请求需要先解析账号 profile。");
  const responses = usesKiroResponses(modelId), endpoint = kiroNativeEndpoint(account);
  const identity = responses ? kiroObject(request) : kiroObject(kiroObject(kiroObject(request.conversationState).currentMessage).userInputMessage);
  if (request.profileArn !== account.profileArn || (responses ? identity.model : identity.modelId) !== modelId || identity.origin !== "KIRO_CLI" || responses && identity.stream !== true)
    throw new KiroChatError("Kiro 请求钩子不能替换账号 profile、所选模型 ID、流模式或 CLI origin。");
  if (responses && request.metadata !== undefined) validateKiroContinuationId(kiroObject(request.metadata)[KIRO_CONTINUATION_METADATA]);
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body, "utf8") > 10 * 1024 * 1024) throw new KiroChatError("Kiro 聊天请求超过本地 10 MiB 限制；请压缩上下文。");
  const headers = new Headers();
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value !== null && !/^(?:authorization|proxy-authorization|host|cookie|content-.*|accept.*|user-agent|x-amz.*|amz-sdk-.*|x-kiro-.*|tokentype|connection|transfer-encoding)$/i.test(key)) headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${account.access}`);
  headers.set("x-amzn-codewhisperer-optout", "true");
  // Both GAR middleware and Responses sender use ICn(authMethod): IdC -> SSO_OIDC.
  // Never infer enterprise identity from generic OIDC or accept a caller's spoofed value.
  if (account.authMethod === "identity-center") headers.set("TokenType", "SSO_OIDC");
  if (responses) {
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", kiroCliUserAgent());
    headers.set("x-amzn-kiro-origin", "KIRO_CLI");
    if (account.profileArn) headers.set("x-amzn-kiro-profile", account.profileArn);
    // Still single-attempt: do not advertise the official adaptive budget before implementing it.
    headers.set("x-kiro-attempt", "1;max=1");
  } else {
    // KAS 0.66.70 selects AwsJson1_0Protocol + KiroRuntimeService (not the REST schema trait).
    // Root path and binary eventstream remain; this does not claim full Smithy identity parity.
    // Evidence: docs/evidence/kiro-enterprise-validation-01/sonnet-routing-static/REPORT.md.
    headers.set("Content-Type", "application/x-amz-json-1.0"); headers.set("Accept", "application/vnd.amazon.eventstream");
    headers.set("x-amz-target", "KiroRuntimeService.GenerateAssistantResponse");
    headers.set("amz-sdk-invocation-id", randomUUID()); headers.set("amz-sdk-request", "attempt=1; max=1");
  }
  return { url: endpoint + (responses ? "v1/responses" : ""), init: { method: "POST", redirect: "error", headers, body } satisfies RequestInit };
}

export function cancelKiroBody(response: Response) { if (response.body && !response.body.locked) void response.body.cancel().catch(() => {}); }

/** Bound even a supplied transport/hook that ignores cancellation; release late response bodies. */
export { waitForKiro };

/** Fetch-shaped adapter for SDK instrumentation; this does not use Fetch for Responses. */
export const kiroNativeFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).pathname !== "/v1/responses") return globalThis.fetch(input, init);
  if (init?.method !== "POST" || typeof init.body !== "string" || init.redirect !== "error")
    throw new KiroChatError("Kiro 原生传输需要已校验的 POST 请求；不回退到通用 Fetch。");
  return kiroNativeHttp(url, { headers: new Headers(init.headers), body: init.body }, init.signal ?? AbortSignal.timeout(600_000));
};

/** One native HTTP request. No implicit retry, fallback provider, Pi lifecycle or global proxy mutation. */
export function sendKiroNativeRequest(prepared: ReturnType<typeof prepareKiroNativeRequest>, signal: AbortSignal, transport?: typeof fetch) {
  signal.throwIfAborted();
  const work = (transport ?? kiroNativeFetch)(prepared.url, { ...prepared.init, signal });
  return waitForKiro(work, signal, cancelKiroBody);
}
