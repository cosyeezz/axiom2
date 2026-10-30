import { randomUUID } from "node:crypto";
import { kiroNativeHttp } from "./kiro-native-http.js";
import { KiroChatError, kiroObject, kiroText, kiroNativeChatRequest, kiroNativeEndpoint, type KiroJson, type KiroNativeContext, type KiroNativeProfile } from "./kiro-native-protocol.js";
import { kiroResponsesRequest, usesKiroResponses } from "./kiro-responses.js";

export { kiroNativeChatRequest, KiroChatError, type KiroNativeContext, type KiroNativeMessage } from "./kiro-native-protocol.js";
export { readKiroResponses, readKiroSse } from "./kiro-responses.js";
export { readKiroEvents } from "./kiro-eventstream.js";

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
export function createKiroNativeRequest(modelId: string, context: KiroNativeContext, account: KiroNativeProfile, sessionId?: string) {
  const request = kiroNativeChatRequest(modelId, context, account, sessionId);
  const responses = usesKiroResponses(modelId);
  return { ...request, payload: responses ? kiroResponsesRequest(request.payload) : request.payload, responses };
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
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body, "utf8") > 10 * 1024 * 1024) throw new KiroChatError("Kiro 聊天请求超过本地 10 MiB 限制；请压缩上下文。");
  const headers = new Headers();
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value !== null && !/^(?:authorization|proxy-authorization|host|cookie|content-.*|accept.*|user-agent|x-amz.*|amz-sdk-.*|x-kiro-.*|tokentype|connection|transfer-encoding)$/i.test(key)) headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${account.access}`);
  headers.set("x-amzn-codewhisperer-optout", "true");
  if (responses) {
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", kiroCliUserAgent());
    headers.set("x-amzn-kiro-origin", "KIRO_CLI");
    if (account.profileArn) headers.set("x-amzn-kiro-profile", account.profileArn);
    // No transport retry yet. An observed header name does not prove the CLI retry policy.
    headers.set("x-kiro-attempt", "1;max=1");
  } else {
    // Preserve the older eventstream path until its client identity has a version-bound baseline.
    headers.set("Content-Type", "application/x-amz-json-1.0"); headers.set("Accept", "application/vnd.amazon.eventstream");
    headers.set("x-amz-target", "AmazonCodeWhispererStreamingService.GenerateAssistantResponse");
    headers.set("amz-sdk-invocation-id", randomUUID()); headers.set("amz-sdk-request", "attempt=1; max=1");
  }
  return { url: endpoint + (responses ? "v1/responses" : ""), init: { method: "POST", redirect: "error", headers, body } satisfies RequestInit };
}

export function cancelKiroBody(response: Response) { if (response.body && !response.body.locked) void response.body.cancel().catch(() => {}); }

/** Bound even a supplied transport/hook that ignores cancellation; release late response bodies. */
export function waitForKiro<T>(work: T | PromiseLike<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; signal.removeEventListener("abort", abort); reject(signal.reason); } };
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

/** One native HTTP request. No implicit retry, fallback provider, Pi lifecycle or global proxy mutation. */
export function sendKiroNativeRequest(prepared: ReturnType<typeof prepareKiroNativeRequest>, signal: AbortSignal, transport?: typeof fetch) {
  signal.throwIfAborted();
  const work = transport ? transport(prepared.url, { ...prepared.init, signal })
    : new URL(prepared.url).pathname === "/v1/responses" ? kiroNativeHttp(prepared.url, prepared.init, signal)
    : globalThis.fetch(prepared.url, { ...prepared.init, signal });
  return waitForKiro(work, signal, cancelKiroBody);
}
