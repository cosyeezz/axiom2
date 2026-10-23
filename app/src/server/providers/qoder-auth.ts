import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { object, QoderError, qoderFailure, qoderJson, qoderReadJson, qoderSignal, qoderSites, type QoderIdentity, type QoderRegion } from "./qoder-protocol.js";

// No invented 30-day lifetime or refresh success: missing/expired deadlines fail closed.
export function qoderExpiry(data: Record<string, unknown>, relativeUnit: "seconds" | "milliseconds" | "pat"): number {
  let expires: number;
  if (data.expires_at !== undefined && data.expires_at !== null && data.expires_at !== "") {
    const absolute = data.expires_at;
    expires = typeof absolute === "number"
      ? Math.floor(absolute > 1e12 ? absolute / 1000 : absolute) * 1000 : typeof absolute === "string" ? Date.parse(absolute) : NaN;
  } else {
    const relative = typeof data.expires_in === "string" && data.expires_in.trim() ? Number(data.expires_in) : data.expires_in;
    expires = typeof relative === "number" && Number.isFinite(relative) && relative > 0
      // Official CLI 1.1.78 Yye: PAT values > 86400 are milliseconds, otherwise seconds.
      ? Date.now() + relative * (relativeUnit === "seconds" || relativeUnit === "pat" && relative <= 86400 ? 1000 : 1) : NaN;
  }
  if (!Number.isSafeInteger(expires) || expires <= Date.now()) throw new QoderError("Qoder 未返回有效令牌期限，请重新登录。");
  return expires;
}
function nonempty(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
export function packQoderCredential(credential: OAuthCredential, region: QoderRegion): string {
  if (credential.region !== region || !nonempty(credential.access) || !nonempty(credential.userId) || !nonempty(credential.machineId))
    throw new QoderError("Qoder 凭据地区或账号信息不完整，请重新登录。");
  return JSON.stringify({ region, token: credential.access, userId: credential.userId, machineId: credential.machineId });
}
export function qoderOAuth(region: QoderRegion, options: { fetch?: typeof fetch; pollIntervalMs?: number; loginTimeoutMs?: number } = {}): OAuthAuth {
  const site = qoderSites[region];
  return {
    name: site.name, loginLabel: `登录 ${site.name}`, isSubscription: true,
    async login(interaction) {
      const signal = qoderSignal(interaction.signal, options.loginTimeoutMs ?? 300000);
      const verifier = randomBytes(32).toString("base64url"), nonce = randomUUID(), machineId = randomUUID();
      const params = new URLSearchParams({ challenge: createHash("sha256").update(verifier).digest("base64url"), challenge_method: "S256", machine_id: machineId, nonce });
      signal.throwIfAborted();
      interaction.notify({ type: "auth_url", url: `${site.login}?${params}`, instructions: `请在浏览器完成 ${site.name} 授权。此接入为实验性，尚未完成真实账号联调。` });
      const query = new URLSearchParams({ nonce, verifier, challenge_method: "S256" });
      try {
        while (true) {
          await delay(options.pollIntervalMs ?? 2000, undefined, { signal });
          const response = await (options.fetch ?? globalThis.fetch)(`${site.open}/api/v1/deviceToken/poll?${query}`, {
            headers: { Accept: "application/json", "User-Agent": "Go-http-client/2.0" }, redirect: "error", signal: qoderSignal(signal),
          });
          if (response.status === 202 || response.status === 404) { await response.body?.cancel(); continue; }
          if (!response.ok) { await response.body?.cancel(); throw qoderFailure(response.status); }
          const data = await qoderReadJson(response, false, signal);
          if (!nonempty(data.token) || !data.token.startsWith("dt-") || !nonempty(data.user_id)) throw new QoderError("Qoder 授权响应缺少设备令牌或用户信息。");
          const credential: OAuthCredential = { type: "oauth", access: data.token, refresh: nonempty(data.refresh_token) ? data.refresh_token : "", expires: qoderExpiry(data, "seconds"), userId: data.user_id, machineId, region };
          signal.throwIfAborted();
          return credential;
        }
      } catch (error) {
        interaction.signal.throwIfAborted();
        if (signal.aborted) throw Error("Qoder 登录超时，请重新开始。");
        if (error instanceof QoderError) throw error;
        throw Error("Qoder 登录请求失败，请检查连接后重试。");
      }
    },
    async refresh(credential, signal) {
      signal.throwIfAborted();
      packQoderCredential(credential, region);
      if (!credential.refresh) throw Error("Qoder 缺少刷新令牌，请重新登录。");
      const data = await qoderJson(options.fetch ?? globalThis.fetch, `${site.open}/api/v1/deviceToken/refresh`, {
        method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "qoder/1.1.78" },
        body: JSON.stringify({ refresh_token: credential.refresh, machine_id: credential.machineId, machine_token: credential.machineId }),
      });
      if (!nonempty(data.device_token) || !data.device_token.startsWith("dt-") || !nonempty(data.refresh_token)) throw Error("Qoder 刷新响应不完整，请重新登录。");
      return { ...credential, access: data.device_token, refresh: data.refresh_token, expires: qoderExpiry(data, "seconds") };
    },
    async toAuth(credential) { return { apiKey: packQoderCredential(credential, region) }; },
  };
}

// Per-provider, bounded, memory-only cache; no token/user data in logs or model catalogs.
export class QoderCredentials {
  private cache = new Map<string, QoderIdentity & { expires: number }>();
  constructor(private region: QoderRegion) {}
  async resolve(key: string | undefined, transport: typeof fetch, signal?: AbortSignal): Promise<QoderIdentity> {
    signal?.throwIfAborted();
    if (!key) throw Error("Qoder 缺少认证，请登录或配置 Personal Access Token。");
    if (!key.startsWith("pt-")) {
      let data: Record<string, unknown>;
      try { data = object(JSON.parse(key)); } catch { throw Error("Qoder API key 仅支持 Personal Access Token（pt-），设备令牌请使用浏览器登录。"); }
      if (data.region !== this.region || !nonempty(data.token) || !data.token.startsWith("dt-") || !nonempty(data.userId) || !nonempty(data.machineId)) throw Error("Qoder 凭据地区或格式错误，请重新登录。");
      return { token: data.token, userId: data.userId, machineId: data.machineId };
    }
    const digest = createHash("sha256").update(key).digest("hex"), cached = this.cache.get(digest);
    if (cached && cached.expires > Date.now() + 300000) return cached;
    const site = qoderSites[this.region];
    const machineId = cached?.machineId ?? randomUUID();
    const data = await qoderJson(transport, `${site.open}/api/v1/jobToken/exchange`, {
      method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "qodercli/1.0.0", "Cosy-Version": "1.0.0", "Cosy-ClientType": "5" },
      body: JSON.stringify({ personal_token: key, machine_id: machineId, machine_token: machineId }),
    });
    if (!nonempty(data.token) || !data.token.startsWith("jt-")) throw Error("Qoder PAT 交换未返回有效任务令牌。");
    const expires = qoderExpiry(data, "pat");
    const info = await qoderJson(transport, `${site.open}/api/v1/userinfo`, { signal, headers: { Authorization: `Bearer ${data.token}`, Accept: "application/json", "User-Agent": "qodercli/1.0.0" } });
    const userId = info.id ?? info.userId ?? info.user_id;
    if (!nonempty(userId)) throw Error("Qoder 未返回签名所需的用户 ID。");
    const identity = { token: data.token, userId, machineId, expires };
    signal?.throwIfAborted();
    if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(digest, identity);
    return identity;
  }
}
