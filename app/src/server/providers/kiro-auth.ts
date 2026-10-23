import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { kiroCallback } from "./kiro-callback.js";

// Protocol references and remaining CLI/IDE differences: docs/kiro-auth.md.
const socialOrigin = "https://prod.us-east-1.auth.desktop.kiro.dev";
const builderStartUrl = "https://view.awsapps.com/start";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const scopes = ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"];
type Json = Record<string, unknown>;
type Method = "builder-id" | "identity-center" | "social";
export interface KiroCredential extends OAuthCredential {
  authMethod: Method;
  authRegion: string;
  startUrl?: string;
  clientId?: string;
  clientSecret?: string;
  clientSecretExpiresAt?: number;
  profileArn?: string;
}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Kiro 认证响应格式无效。");
  return value as Json;
}
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 32768 || /[\r\n\0]/.test(value))
    throw new Error(`Kiro ${label}无效，请重新登录。`);
  return value;
}
function seconds(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 31_536_000)
    throw new Error("Kiro 返回的有效期或轮询间隔无效。");
  return value;
}
function region(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(value) || value.startsWith("cn-"))
    throw new Error("Kiro 认证区域无效；当前适配不支持 AWS 中国区域。");
  return value;
}
function httpsUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(required(value, "授权地址")); } catch { throw new Error("Kiro 授权地址无效。"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href.length > 8192)
    throw new Error("Kiro 授权地址必须是不含凭据或片段的 HTTPS 地址。");
  return url.href;
}
function oidcOrigin(authRegion: string) { return `https://oidc.${region(authRegion)}.amazonaws.com`; }
function expiry(body: Json): number {
  // Social portal may return RFC3339 expiresAt; OIDC supplies expiresIn seconds.
  const expires = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt)
    : Date.now() + seconds(body.expiresIn) * 1000;
  if (!Number.isSafeInteger(expires) || expires <= Date.now()) throw new Error("Kiro 返回的令牌有效期无效。");
  return expires;
}
function token(body: Json, metadata: Omit<KiroCredential, "type" | "access" | "refresh" | "expires">, previous?: OAuthCredential): KiroCredential {
  return {
    ...metadata, type: "oauth", access: required(body.accessToken, "访问令牌"),
    refresh: required(body.refreshToken === undefined ? previous?.refresh : body.refreshToken, "刷新令牌"),
    expires: expiry(body),
    ...(body.profileArn === undefined ? {} : { profileArn: required(body.profileArn, "账号配置") }),
  } as KiroCredential;
}
function metadata(credential: OAuthCredential): Omit<KiroCredential, "type" | "access" | "refresh" | "expires"> {
  const method = credential.authMethod;
  if (method !== "builder-id" && method !== "identity-center" && method !== "social")
    throw new Error("Kiro 凭据缺少登录类型，请重新登录。");
  const result = { authMethod: method, authRegion: region(credential.authRegion) } as KiroCredential;
  if (credential.profileArn !== undefined) result.profileArn = required(credential.profileArn, "账号配置");
  if (method !== "social") {
    result.startUrl = httpsUrl(credential.startUrl);
    result.clientId = required(credential.clientId, "客户端 ID");
    result.clientSecret = required(credential.clientSecret, "客户端密钥");
    const expiresAt = credential.clientSecretExpiresAt;
    if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      throw new Error("Kiro OIDC 客户端注册已过期，请重新登录。");
    result.clientSecretExpiresAt = expiresAt;
  } else if (result.authRegion !== "us-east-1") {
    throw new Error("Kiro 个人社交登录的认证区域无效，请重新登录。");
  }
  return result;
}

export function kiroOAuth(options: {
  fetch?: typeof fetch;
  loginTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Offline tests can observe/skip waits; production always honors the server interval. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  callback?: typeof kiroCallback;
} = {}): OAuthAuth {
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const request = async (url: string, body: Json, signal: AbortSignal, polling = false): Promise<Json> => {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs ?? 30_000)]);
    bounded.throwIfAborted();
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, {
        method: "POST", redirect: "error", signal: bounded,
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body),
      });
    } catch {
      signal.throwIfAborted();
      throw new Error("Kiro 认证网络请求失败或超时，请检查网络后重试。");
    }
    bounded.throwIfAborted();
    let data: Json;
    try { data = object(await response.json()); }
    catch {
      bounded.throwIfAborted();
      throw new Error(`Kiro 认证响应无效（HTTP ${response.status}）。`);
    }
    bounded.throwIfAborted();
    if (response.ok) return data;
    const code = typeof data.error === "string" ? data.error : typeof data.__type === "string" ? data.__type.split("#").at(-1) : undefined;
    if (polling && response.status === 400) {
      if (code === "authorization_pending" || code === "AuthorizationPendingException") return { pending: true };
      if (code === "slow_down" || code === "SlowDownException") return { pending: true, slowDown: true };
    }
    if (code === "access_denied" || code === "AccessDeniedException") throw new Error("Kiro 授权被拒绝；请检查账号权限及组织是否允许此登录方式。");
    if (code === "expired_token" || code === "ExpiredTokenException") throw new Error("Kiro 设备授权已过期，请重新登录。");
    throw new Error(`Kiro 认证请求失败（HTTP ${response.status}），请重新登录或联系管理员。`);
  };
  const oidcLogin = async (method: "builder-id" | "identity-center", interaction: ProviderAuthInteraction, signal: AbortSignal): Promise<KiroCredential> => {
    const startUrl = method === "builder-id" ? builderStartUrl : httpsUrl((await interaction.prompt({
      type: "text", message: "请输入管理员提供的 IAM Identity Center Start URL。暂不支持独立 external_idp / Entra 直连；经 Identity Center 联邦的组织可用。", signal,
      placeholder: "https://your-org.awsapps.com/start",
    })).trim());
    const authRegion = method === "builder-id" ? "us-east-1" : region((await interaction.prompt({
      type: "text", message: "请输入组织的 IAM Identity Center 区域", placeholder: "us-east-1", signal,
    })).trim());
    const origin = oidcOrigin(authRegion);
    const flow = await interaction.prompt({ type: "select", message: "选择 AWS 授权流程；组织禁用设备授权时请选择浏览器，不会自动降级绕过策略。", signal, options: [
      { id: "pkce", label: "浏览器授权（PKCE，推荐）" },
      { id: "device", label: "设备授权（适合远程服务，需组织允许）" },
    ] });
    if (flow === "pkce") {
      const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
      const callback = await (options.callback ?? kiroCallback)(state, signal, { oidc: true });
      try {
        const redirectUri = `${callback.origin}/oauth/callback`;
        const registration = await request(`${origin}/client/register`, {
          clientName: "Axiom Kiro", clientType: "public", scopes,
          grantTypes: ["authorization_code", "refresh_token"], issuerUrl: startUrl, redirectUris: [redirectUri],
        }, signal);
        const clientId = required(registration.clientId, "客户端 ID"), clientSecret = required(registration.clientSecret, "客户端密钥");
        const clientSecretExpiresAt = typeof registration.clientSecretExpiresAt === "number" ? registration.clientSecretExpiresAt * 1000 : NaN;
        if (!Number.isSafeInteger(clientSecretExpiresAt) || clientSecretExpiresAt <= Date.now()) throw new Error("Kiro OIDC 客户端注册有效期无效。");
        const url = new URL(`${origin}/authorize`);
        url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scopes: scopes.join(" "),
          state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
        interaction.notify({ type: "auth_url", url: url.href });
        const callbackResult = await callback.wait(interaction);
        signal.throwIfAborted();
        const body = await request(`${origin}/token`, { clientId, clientSecret, grantType: "authorization_code", code: callbackResult.code, codeVerifier: verifier, redirectUri }, signal);
        return token(body, { authMethod: method, authRegion, startUrl, clientId, clientSecret, clientSecretExpiresAt });
      } finally { await callback.close(); }
    }
    if (flow !== "device") throw new Error("Kiro 授权流程无效。");
    const registration = await request(`${origin}/client/register`, {
      clientName: "Axiom Kiro", clientType: "public", scopes,
      grantTypes: [deviceGrant, "refresh_token"], issuerUrl: startUrl,
    }, signal);
    const clientId = required(registration.clientId, "客户端 ID"), clientSecret = required(registration.clientSecret, "客户端密钥");
    const clientSecretExpiresAt = typeof registration.clientSecretExpiresAt === "number" ? registration.clientSecretExpiresAt * 1000 : NaN;
    if (!Number.isSafeInteger(clientSecretExpiresAt) || clientSecretExpiresAt <= Date.now()) throw new Error("Kiro OIDC 客户端注册有效期无效。");
    const device = await request(`${origin}/device_authorization`, { clientId, clientSecret, startUrl }, signal);
    const deviceCode = required(device.deviceCode, "设备码"), userCode = required(device.userCode, "用户验证码");
    const verificationUri = httpsUrl(device.verificationUriComplete ?? device.verificationUri);
    const expiresIn = seconds(device.expiresIn);
    let interval = seconds(device.interval, 5) * 1000;
    const pollSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(expiresIn * 1000, 2_147_483_647))]);
    interaction.notify({ type: "device_code", userCode, verificationUri, intervalSeconds: interval / 1000, expiresInSeconds: expiresIn });
    try {
      while (true) {
        await wait(interval, pollSignal);
        pollSignal.throwIfAborted();
        const result = await request(`${origin}/token`, { clientId, clientSecret, deviceCode, grantType: deviceGrant }, pollSignal, true);
        if (result.pending) { if (result.slowDown) interval += 5000; continue; }
        pollSignal.throwIfAborted();
        return token(result, { authMethod: method, authRegion, startUrl, clientId, clientSecret, clientSecretExpiresAt });
      }
    } catch (error) {
      signal.throwIfAborted();
      if (pollSignal.aborted) throw new Error("Kiro 设备授权已过期，请重新登录。");
      throw error;
    }
  };
  return {
    name: "Kiro（仅认证）", loginLabel: "登录 Kiro 个人或组织账号",
    async login(interaction) {
      const signal = AbortSignal.any([interaction.signal, AbortSignal.timeout(options.loginTimeoutMs ?? 600_000)]);
      try {
        signal.throwIfAborted();
        const method = await interaction.prompt({ type: "select", message: "选择 Kiro 登录方式（同一供应商仅保存一个账号）", signal, options: [
          { id: "builder-id", label: "个人 · AWS Builder ID" },
          { id: "social", label: "个人 · Google / GitHub（浏览器 PKCE）" },
          { id: "identity-center", label: "企业 · IAM Identity Center" },
        ] });
        if (method === "builder-id" || method === "identity-center") return await oidcLogin(method, interaction, signal);
        if (method !== "social") throw new Error("Kiro 登录方式无效。");
        const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const callback = await (options.callback ?? kiroCallback)(state, signal);
        try {
          const url = new URL("https://app.kiro.dev/signin");
          url.search = new URLSearchParams({ state, code_challenge: challenge, code_challenge_method: "S256", redirect_uri: callback.origin, redirect_from: "kirocli" }).toString();
          interaction.notify({ type: "auth_url", url: url.href, instructions: "请选择 Google 或 GitHub；请勿在此分支选择组织或 Builder ID。" });
          const result = await callback.wait(interaction);
          signal.throwIfAborted();
          const body = await request(`${socialOrigin}/oauth/token`, { code: result.code, code_verifier: verifier, redirect_uri: result.redirectUri }, signal);
          return token(body, { authMethod: "social", authRegion: "us-east-1" });
        } finally { await callback.close(); }
      } catch (error) {
        interaction.signal.throwIfAborted();
        if (signal.aborted) throw new Error("Kiro 登录超时，请重新开始登录。");
        throw error;
      }
    },
    async refresh(credential, signal) {
      signal.throwIfAborted();
      const meta = metadata(credential), refreshToken = required(credential.refresh, "刷新令牌");
      const result = meta.authMethod === "social"
        ? await request(`${socialOrigin}/refreshToken`, { refreshToken }, signal)
        : await request(`${oidcOrigin(String(meta.authRegion))}/token`, { clientId: meta.clientId, clientSecret: meta.clientSecret, refreshToken, grantType: "refresh_token" }, signal);
      return token(result, meta, credential);
    },
    async toAuth(credential) { return { apiKey: required(credential.access, "访问令牌") }; },
  };
}
