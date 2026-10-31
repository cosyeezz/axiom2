import { waitForNative } from "../abort.js";
import { codeBuddyHeaders, codeBuddyOrigin } from "./identity.js";

export type CodeBuddyEnvelope = { code?: unknown; data?: Record<string, unknown> };
export const validCodeBuddyToken = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  && value.length <= 32768 && !/[\r\n\0]/.test(value);

/** Bounded fixed-origin JSON requests, shared by auth and catalog. Never redirects or retries. */
export function createCodeBuddyJsonRequest(options: { fetch?: typeof fetch; requestTimeoutMs?: number }, label: "认证" | "目录") {
  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error("CodeBuddy 请求超时配置无效。");
  return async (path: string, init: RequestInit, callerSignal: AbortSignal, pendingCode?: number): Promise<CodeBuddyEnvelope> => {
    callerSignal.throwIfAborted();
    if (!/^\/v(?:2\/plugin\/auth\/(?:state\?platform=CLI|token(?:\?state=[^#]*|\/refresh))|3\/config)$/.test(path))
      throw new Error("CodeBuddy 请求目标无效。");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = AbortSignal.any([callerSignal, timeout.signal]);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      try {
        response = await waitForNative((options.fetch ?? globalThis.fetch)(codeBuddyOrigin + path, {
          ...init, redirect: "error", signal, headers: {
            Accept: "application/json", "Content-Type": "application/json", "User-Agent": codeBuddyHeaders["User-Agent"],
            "X-Requested-With": "XMLHttpRequest", "X-Domain": "copilot.tencent.com", "X-Product": "SaaS", ...init.headers,
          },
        }), signal, late => { void late.body?.cancel().catch(() => {}); });
      } catch {
        callerSignal.throwIfAborted();
        if (signal.aborted) throw new Error(`CodeBuddy ${label}请求超时，请稍后重试。`);
        throw new Error(`CodeBuddy ${label}网络请求失败，请稍后重试。`);
      }
      signal.throwIfAborted();
      const httpFailure = () => new Error(`CodeBuddy ${label}请求失败（HTTP ${response!.status}），请检查账号。`);
      let body: CodeBuddyEnvelope;
      try {
        if (!response.body) throw new Error();
        reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "", bytes = 0;
        for (;;) {
          const chunk = await waitForNative(reader.read(), signal);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1024 * 1024) throw new Error();
          text += decoder.decode(chunk.value, { stream: true });
        }
        body = JSON.parse(text + decoder.decode());
      } catch {
        callerSignal.throwIfAborted();
        if (signal.aborted) throw new Error(`CodeBuddy ${label}请求超时，请稍后重试。`);
        if (!response.ok) throw httpFailure();
        throw new Error(`CodeBuddy ${label}响应不是有效 JSON 或超过大小限制，请稍后重试。`);
      }
      signal.throwIfAborted();
      if (!response.ok && !(pendingCode !== undefined && body?.code === pendingCode)) throw httpFailure();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`CodeBuddy ${label}响应格式无效。`);
      return body;
    } finally {
      clearTimeout(timer);
      if (reader) {
        void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch { /* Non-cooperative host stream is already canceled. */ }
      } else { void response?.body?.cancel().catch(() => {}); }
    }
  };
}
