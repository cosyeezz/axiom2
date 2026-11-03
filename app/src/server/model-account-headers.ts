import { readFileSync } from "node:fs";
import type { Credential } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";
import { accountKeyReference, isAccountKeyReference, isAuthenticationHeader } from "../shared/account-auth-headers.js";

type Definition = { headers?: Record<string, unknown>; models?: (Definition & { id?: string })[]; modelOverrides?: Record<string, Definition> };
/** Keep connection headers editable, but never allow them to silently replace a selected account. */
export function installAccountHeaders(runtime: ModelRuntime, path: string | null, credential: (provider: string) => Promise<Credential | undefined>) {
  let providers: Record<string, Definition> = {};
  const reload = () => {
    providers = {};
    if (path) {
      try { providers = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")).providers ?? {}; }
      catch { /* SDK owns malformed/missing configuration diagnostics. */ }
    }
  };
  reload();
  const definitions = (provider: string, model?: { id: string; headers?: Record<string, string> }, all = false) => {
    const config = Object.hasOwn(providers, provider) ? providers[provider] : {};
    return [config, ...(all ? config.models ?? [] : (config.models ?? []).filter(row => row.id === model?.id)),
      ...(all ? Object.values(config.modelOverrides ?? {}) : model && config.modelOverrides?.[model.id] ? [config.modelOverrides[model.id]] : []), ...(model ? [model] : [])];
  };
  const check = async (provider: string, model?: { id: string; headers?: Record<string, string> }, all = false) => {
    const stored = await credential(provider);
    for (const definition of definitions(provider, model, all)) {
      for (const [name, value] of Object.entries(definition.headers ?? {})) {
        if (isAccountKeyReference(value)) {
          // Native OAuth may use packed credentials or one-shot handoffs. Those
          // must NEVER be exposed as a generic header (Kiro/Qoder in particular).
          if (stored?.type !== "api_key")
            throw new AppError("ACCOUNT_HEADER_UNSUPPORTED", "账号认证头引用仅支持已保存的 API Key 账号；OAuth 使用供应商原生认证。");
        } else if (typeof value === "string" && value.includes(accountKeyReference)) {
          throw new AppError("ACCOUNT_HEADER_INVALID", "账号认证头只能使用 {{account.key}} 或 Bearer {{account.key}}。");
        } else if (stored && isAuthenticationHeader(name)) {
          throw new AppError("ACCOUNT_HEADER_CONFLICT", "连接或模型中存在写死的认证头，与所选账号冲突。请删除该覆盖，或为 API Key 账号使用 {{account.key}} 引用；原配置未修改。");
        }
      }
    }
    return stored;
  };
  const getAuth = runtime.getAuth.bind(runtime);
  runtime.getAuth = (async (target: Parameters<typeof getAuth>[0] | string, options?: Parameters<typeof getAuth>[1]) => {
    const provider = typeof target === "string" ? target : target.provider;
    const stored = await check(provider, typeof target === "string" ? undefined : target);
    const resolution = await (typeof target === "string" ? getAuth(target, options) : getAuth(target, options));
    if (!resolution) return resolution;
    const headers = { ...resolution.auth.headers };
    for (const [name, value] of Object.entries(headers)) {
      if (!isAccountKeyReference(value)) continue;
      if (stored?.type !== "api_key" || !resolution.auth.apiKey)
        throw new AppError("ACCOUNT_HEADER_UNSUPPORTED", "无法将当前账号认证绑定到请求头；未发送请求。");
      headers[name] = value.replace(accountKeyReference, resolution.auth.apiKey);
    }
    return { ...resolution, auth: { ...resolution.auth, headers } };
  }) as typeof runtime.getAuth;
  // Native catalog refresh does not necessarily call getAuth. Check before it
  // can refresh OAuth or send provider requests, not only during inference.
  const refresh = runtime.refresh.bind(runtime);
  runtime.refresh = async options => {
    reload();
    if (options?.allowNetwork)
      for (const provider of options.providers ?? runtime.getProviders().map(row => row.id)) await check(provider, undefined, true);
    return refresh(options);
  };
}
