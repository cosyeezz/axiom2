import { setTimeout as delay } from "node:timers/promises";
import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";

import { codeBuddyHeaders } from "./codebuddy-models.js";

const origin = "https://copilot.tencent.com";
const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": codeBuddyHeaders["User-Agent"],
  "X-Requested-With": "XMLHttpRequest",
  "X-Domain": "copilot.tencent.com",
  "X-Product": "SaaS",
};
const anonymousHeaders = {
  "X-No-Authorization": "true", "X-No-User-Id": "true",
  "X-No-Enterprise-Id": "true", "X-No-Department-Info": "true",
};
type Envelope = { code?: unknown; data?: Record<string, unknown> };

// Injectable transport/timings keep protocol tests offline. Production uses the fixed CN origin.
export function codeBuddyOAuth(options: {
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  loginTimeoutMs?: number;
} = {}): OAuthAuth {
  const request = async (path: string, init: RequestInit, signal: AbortSignal, pendingCode?: number): Promise<Envelope> => {
    signal.throwIfAborted();
    const response = await (options.fetch ?? globalThis.fetch)(origin + path, {
      ...init, redirect: "error", signal,
      headers: { ...headers, ...init.headers },
    });
    signal.throwIfAborted();
    const httpFailure = () => new Error(`CodeBuddy 认证请求失败（HTTP ${response.status}），请重新登录。`);
    let body: Envelope;
    try { body = await response.json(); }
    catch {
      signal.throwIfAborted();
      if (!response.ok) throw httpFailure();
      throw new Error("CodeBuddy 认证响应不是有效 JSON，请稍后重试。");
    }
    signal.throwIfAborted();
    // The official poller accepts pending business codes from rejected HTTP responses too.
    if (!response.ok && !(pendingCode !== undefined && body?.code === pendingCode)) throw httpFailure();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("CodeBuddy 认证响应格式无效。");
    return body;
  };
  const failure = (body: Envelope) => new Error(`CodeBuddy 认证失败（code ${typeof body.code === "number" ? body.code : "unknown"}），请重新登录。`);
  const token = (body: Envelope, previousRefresh?: string): OAuthCredential => {
    const data = body.data;
    if (body.code !== 0 || typeof data?.accessToken !== "string" || !data.accessToken.trim()) throw failure(body);
    const refresh = typeof data.refreshToken === "string" && data.refreshToken.trim() ? data.refreshToken : previousRefresh;
    if (!refresh) throw new Error("CodeBuddy 未返回刷新令牌，请重新登录。");
    const now = Date.now();
    // CLI 2.173.0 preserves absolute expiresAt (milliseconds) before deriving expiresIn (seconds).
    // If neither is supplied, one hour is Axiom's conservative refresh schedule, not an upstream TTL.
    const expires = data.expiresAt
      ? Number(data.expiresAt)
      : now + (data.expiresIn === undefined ? 3600 : Number(data.expiresIn)) * 1000;
    if (!Number.isSafeInteger(expires) || expires <= now)
      throw new Error("CodeBuddy 返回的令牌有效期无效。");
    return { type: "oauth", access: data.accessToken, refresh, expires };
  };
  return {
    name: "CodeBuddy 国内版",
    loginLabel: "登录 CodeBuddy 国内版",
    async login(interaction) {
      const signal = AbortSignal.any([interaction.signal, AbortSignal.timeout(options.loginTimeoutMs ?? 300_000)]);
      try {
        const start = await request("/v2/plugin/auth/state?platform=CLI", {
          method: "POST", body: "{}", headers: anonymousHeaders,
        }, signal);
        if (start.code !== 0 || typeof start.data?.state !== "string" || !start.data.state || typeof start.data.authUrl !== "string") throw failure(start);
        let url: URL;
        try { url = new URL(start.data.authUrl); }
        catch { throw new Error("CodeBuddy 未返回有效授权地址。"); }
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error("CodeBuddy 未返回有效 HTTPS 授权地址。");
        interaction.notify({ type: "auth_url", url: url.href, instructions: "请在浏览器完成 CodeBuddy 国内版登录，完成后会自动连接。" });
        while (true) {
          await delay(options.pollIntervalMs ?? 1000, undefined, { signal });
          const result = await request(`/v2/plugin/auth/token?state=${encodeURIComponent(start.data.state)}`, {
            method: "GET", headers: anonymousHeaders,
          }, signal, 11217);
          if (result.code === 11217) continue;
          const credential = token(result);
          signal.throwIfAborted();
          return credential;
        }
      } catch (error) {
        interaction.signal.throwIfAborted();
        if (signal.aborted) throw new Error("CodeBuddy 登录超时，请重新开始登录。");
        throw error;
      }
    },
    async refresh(credential, signal) {
      if (!credential.refresh) throw new Error("CodeBuddy 缺少刷新令牌，请重新登录。");
      return token(await request("/v2/plugin/auth/token/refresh", {
        method: "POST", body: "{}",
        headers: {
          Authorization: `Bearer ${credential.access}`,
          "X-Refresh-Token": credential.refresh, "X-Auth-Refresh-Source": "plugin",
        },
      }, signal), credential.refresh);
    },
    async toAuth(credential) { return { apiKey: credential.access }; },
  };
}
