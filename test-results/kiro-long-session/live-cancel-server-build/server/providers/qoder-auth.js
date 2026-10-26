import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { object, QoderError, qoderFailure, qoderJson, qoderReadJson, qoderSignal, qoderSites } from "./qoder-protocol.js";
const clientId = "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb";
// Axiom-owned IDs only. Device credentials persist theirs; PAT-only IDs are stable for this process.
// No official client configuration or hardware fingerprints are read.
const machineIds = { intl: randomUUID(), cn: randomUUID() };
const nonempty = (value) => typeof value === "string" && !!value.trim();
const firstString = (data, keys) => keys.map(key => data[key]).find(nonempty);
function numeric(value) { const n = typeof value === "string" && value.trim() ? Number(value) : value; return typeof n === "number" && Number.isFinite(n) ? n : undefined; }
// No invented lifetime: absent, invalid or expired access deadlines fail closed.
export function qoderExpiry(data, relativeUnit) {
    const absolute = [data.expires_at, data.expiresAt].find(value => typeof value === "number" || nonempty(value)) ?? numeric(data.expire_time) ?? numeric(data.expireTime);
    let expires = typeof absolute === "number" ? absolute > 1e12 ? absolute : absolute * 1000 : typeof absolute === "string" && absolute.trim() ? Date.parse(absolute) : NaN;
    if (!Number.isFinite(expires) && relativeUnit !== "absolute") {
        const relative = numeric(data.expires_in);
        expires = relative !== undefined && relative > 0 ? Date.now() + relative * (relativeUnit === "seconds" || relativeUnit === "pat" && relative <= 86400 ? 1000 : 1) : NaN;
    }
    if (!Number.isSafeInteger(expires) || expires <= Date.now())
        throw new QoderError("Qoder 未返回有效令牌期限，请重新登录。");
    return expires;
}
function refreshExpiry(data, mode) {
    const expires_at = [data.refresh_token_expires_at, data.refreshTokenExpiresAt].find(value => typeof value === "number" || nonempty(value)) ?? numeric(data.refresh_token_expire_time) ?? numeric(data.refreshTokenExpireTime);
    if (expires_at == null && data.refresh_token_expires_in == null)
        return;
    return qoderExpiry({ expires_at, expires_in: data.refresh_token_expires_in }, mode);
}
export function packQoderCredential(credential, region) {
    if (credential.region !== region || !nonempty(credential.access) || !nonempty(credential.userId) || !nonempty(credential.machineId))
        throw new QoderError("Qoder 凭据地区或账号信息不完整，请重新登录。");
    return JSON.stringify({ region, token: credential.access, userId: credential.userId, machineId: credential.machineId });
}
export function qoderOAuth(region, options = {}) {
    const site = qoderSites[region];
    return {
        name: site.name, loginLabel: `登录 ${site.name}`, isSubscription: true,
        async login(interaction) {
            const signal = qoderSignal(interaction.signal, options.loginTimeoutMs ?? 300000);
            const verifier = randomBytes(32).toString("base64url"), nonce = randomUUID(), machineId = machineIds[region];
            const params = new URLSearchParams({ challenge: createHash("sha256").update(verifier).digest("base64url"), challenge_method: "S256", machine_id: machineId, nonce, client_id: clientId });
            signal.throwIfAborted();
            interaction.notify({ type: "auth_url", url: `${site.login}?${params}`, instructions: `请在浏览器完成 ${site.name} 授权。此接入为实验性，尚未完成真实账号联调。` });
            const query = new URLSearchParams({ nonce, verifier, challenge_method: "S256" });
            try {
                while (true) {
                    let response;
                    try {
                        response = await (options.fetch ?? globalThis.fetch)(`${site.open}/api/v1/deviceToken/poll?${query}`, { headers: { Accept: "application/json", "User-Agent": "Go-http-client/2.0" }, redirect: "error", signal: qoderSignal(signal) });
                    }
                    catch {
                        signal.throwIfAborted(); /* Polling a transient network failure is safe: no inference is sent. */
                    }
                    if (response && response.status !== 202 && response.status !== 404) {
                        if (!response.ok) {
                            void response.body?.cancel().catch(() => { });
                            throw qoderFailure(response.status);
                        }
                        const data = await qoderReadJson(response, false, signal);
                        if (!nonempty(data.token) || !data.token.startsWith("dt-") || !nonempty(data.user_id))
                            throw new QoderError("Qoder 授权响应缺少设备令牌或用户信息。");
                        const refreshExpires = refreshExpiry(data, "seconds");
                        const credential = { type: "oauth", access: data.token, refresh: nonempty(data.refresh_token) ? data.refresh_token : "", expires: qoderExpiry(data, "seconds"), userId: data.user_id, machineId, region, ...(refreshExpires ? { refreshExpires } : {}) };
                        signal.throwIfAborted();
                        return credential;
                    }
                    void response?.body?.cancel().catch(() => { });
                    await delay(options.pollIntervalMs ?? 1000, undefined, { signal });
                }
            }
            catch (error) {
                interaction.signal.throwIfAborted();
                if (signal.aborted)
                    throw Error("Qoder 登录超时，请重新开始。");
                if (error instanceof QoderError)
                    throw error;
                throw Error("Qoder 登录请求失败，请检查连接后重试。");
            }
        },
        async refresh(credential, signal) {
            signal.throwIfAborted();
            packQoderCredential(credential, region);
            if (!credential.refresh || typeof credential.refreshExpires === "number" && credential.refreshExpires <= Date.now())
                throw Error("Qoder 刷新令牌缺失或已过期，请重新登录。");
            const data = await qoderJson(options.fetch ?? globalThis.fetch, `${site.open}/api/v1/deviceToken/refresh`, {
                method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "qoder/1.1.78" }, body: JSON.stringify({ refresh_token: credential.refresh, machine_id: credential.machineId }),
            });
            if (!nonempty(data.device_token) || !data.device_token.startsWith("dt-") || !nonempty(data.refresh_token))
                throw Error("Qoder 刷新响应不完整，请重新登录。");
            return { ...credential, access: data.device_token, refresh: data.refresh_token, expires: qoderExpiry(data, "absolute"), refreshExpires: refreshExpiry(data, "absolute") };
        },
        async toAuth(credential) { return { apiKey: packQoderCredential(credential, region) }; },
    };
}
function waitFor(pending, signal) {
    if (!signal)
        return pending;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
// Region/provider-scoped, bounded, memory-only cache; concurrent PAT exchanges share a job.
export class QoderCredentials {
    region;
    cache = new Map();
    pending = new Map();
    constructor(region) {
        this.region = region;
    }
    async resolve(key, transport, signal) {
        signal?.throwIfAborted();
        if (!key)
            throw Error("Qoder 缺少认证，请登录或配置 Personal Access Token。");
        if (!key.startsWith("pt-")) {
            let data;
            try {
                data = object(JSON.parse(key));
            }
            catch {
                throw Error("Qoder API key 仅支持 Personal Access Token（pt-），设备令牌请使用浏览器登录。");
            }
            if (data.region !== this.region || !nonempty(data.token) || !data.token.startsWith("dt-") || !nonempty(data.userId) || !nonempty(data.machineId))
                throw Error("Qoder 凭据地区或格式错误，请重新登录。");
            return { token: data.token, userId: data.userId, machineId: data.machineId };
        }
        const digest = createHash("sha256").update(key).digest("hex"), cached = this.cache.get(digest);
        if (cached && cached.expires > Date.now() + 300000)
            return cached;
        let pending = this.pending.get(digest);
        if (!pending) {
            if (this.pending.size >= 16)
                throw new QoderError("Qoder 并发认证请求过多，请稍后重试。");
            pending = this.exchange(key, digest, transport);
            this.pending.set(digest, pending);
            void pending.finally(() => this.pending.delete(digest)).catch(() => { });
        }
        return waitFor(pending, signal);
    }
    async exchange(key, digest, transport) {
        const site = qoderSites[this.region], machineId = machineIds[this.region];
        // Individual cancellation must not abort another caller's shared authentication. The job is bounded.
        const signal = qoderSignal(undefined, 15000);
        const data = await qoderJson(transport, `${site.open}/api/v1/jobToken/exchange`, {
            method: "POST", signal, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "qodercli/1.1.78", "Cosy-Version": "1.1.78", "Cosy-ClientType": "5" }, body: JSON.stringify({ personal_token: key, machine_id: machineId }),
        });
        const token = firstString(data, ["token", "device_token", "access_token"]);
        if (!token || !/^(?:jt|dt)-/.test(token))
            throw Error("Qoder PAT 交换未返回有效任务令牌。");
        const expires = qoderExpiry(data, "pat");
        const info = await qoderJson(transport, `${site.open}/api/v1/userinfo`, { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "qodercli/1.1.78" } });
        const userId = firstString(info, ["id", "user_id", "uid"]);
        if (!userId)
            throw Error("Qoder 未返回签名所需的用户 ID。");
        const identity = { token, userId, machineId, expires };
        if (this.cache.size >= 16)
            this.cache.delete(this.cache.keys().next().value);
        this.cache.set(digest, identity);
        return identity;
    }
}
//# sourceMappingURL=qoder-auth.js.map