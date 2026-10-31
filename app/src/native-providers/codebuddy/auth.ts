/*!
 * CodeBuddy CN OAuth adapted from https://github.com/decolua/9router
 * commit 87a74e1bda3677193c6f71a7e2100c90311f0689.
 * MIT License — Copyright (c) 2024-2026 decolua and contributors
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { setTimeout as delay } from "node:timers/promises";
import type { NativeOAuth, NativeOAuthCredential } from "../contracts.js";
import { createCodeBuddyJsonRequest, validCodeBuddyToken as validToken, type CodeBuddyEnvelope as Envelope } from "./json.js";

export interface CodeBuddyOAuthOptions {
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  loginTimeoutMs?: number;
  requestTimeoutMs?: number;
}
const anonymousHeaders = {
  "X-No-Authorization": "true", "X-No-User-Id": "true",
  "X-No-Enterprise-Id": "true", "X-No-Department-Info": "true",
};
const failure = (body: Envelope) => new Error(`CodeBuddy 认证失败（code ${typeof body.code === "number" && Number.isSafeInteger(body.code) ? body.code : "unknown"}），请重新登录。`);

/** Pure CN OAuth protocol. No persistence, refresh scheduler, SDK or interactive login on import. */
export function createCodeBuddyOAuth(options: CodeBuddyOAuthOptions = {}): NativeOAuth<NativeOAuthCredential> {
  for (const value of [options.pollIntervalMs, options.loginTimeoutMs, options.requestTimeoutMs]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647))
      throw new Error("CodeBuddy 认证超时配置无效。");
  }
  const request = createCodeBuddyJsonRequest(options, "认证");
  const token = (body: Envelope, previousRefresh?: string): NativeOAuthCredential => {
    const data = body.data;
    if (body.code !== 0 || !validToken(data?.accessToken)) throw failure(body);
    const refresh = data?.refreshToken === undefined || data.refreshToken === "" ? previousRefresh : data?.refreshToken;
    if (!validToken(refresh)) throw new Error("CodeBuddy 未返回有效刷新令牌，请重新登录。");
    const now = Date.now();
    // Legacy CLI protocol: absolute milliseconds precede relative seconds. One hour is a local fallback, not upstream TTL.
    const expires = data!.expiresAt ? Number(data!.expiresAt)
      : now + (data!.expiresIn === undefined ? 3600 : Number(data!.expiresIn)) * 1000;
    if (!Number.isSafeInteger(expires) || expires <= now) throw new Error("CodeBuddy 返回的令牌有效期无效。");
    return { type: "oauth", access: data!.accessToken as string, refresh, expires };
  };
  return {
    async login(interaction) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), options.loginTimeoutMs ?? 300_000);
      const signal = AbortSignal.any([interaction.signal, timeout.signal]);
      try {
        const start = await request("/v2/plugin/auth/state?platform=CLI", { method: "POST", body: "{}", headers: anonymousHeaders }, signal);
        if (start.code !== 0 || typeof start.data?.state !== "string" || !start.data.state || typeof start.data.authUrl !== "string") throw failure(start);
        let url: URL;
        try { url = new URL(start.data.authUrl); } catch { throw new Error("CodeBuddy 未返回有效授权地址。"); }
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("CodeBuddy 未返回有效 HTTPS 授权地址。");
        interaction.notify({ type: "auth_url", url: url.href, instructions: "请在浏览器完成 CodeBuddy 国内版登录，完成后会自动连接。" });
        while (true) {
          await delay(options.pollIntervalMs ?? 1000, undefined, { signal });
          const result = await request(`/v2/plugin/auth/token?state=${encodeURIComponent(start.data.state)}`, { method: "GET", headers: anonymousHeaders }, signal, 11217);
          if (result.code === 11217) continue;
          const credential = token(result);
          signal.throwIfAborted();
          return credential;
        }
      } catch (error) {
        interaction.signal.throwIfAborted();
        if (signal.aborted) throw new Error("CodeBuddy 登录超时，请重新开始登录。");
        throw error;
      } finally { clearTimeout(timer); }
    },
    async refresh(credential, signal) {
      signal.throwIfAborted();
      if (!validToken(credential.access) || !validToken(credential.refresh)) throw new Error("CodeBuddy 缺少有效刷新凭据，请重新登录。");
      return token(await request("/v2/plugin/auth/token/refresh", {
        method: "POST", body: "{}", headers: {
          Authorization: `Bearer ${credential.access}`, "X-Refresh-Token": credential.refresh, "X-Auth-Refresh-Source": "plugin",
        },
      }, signal), credential.refresh);
    },
  };
}
