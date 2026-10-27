import type { Api, Model, ModelsStoreEntry, Provider } from "@earendil-works/pi-ai";
import { kiroOAuth } from "./kiro-auth.js";
import { fetchKiroCatalog, kiroCatalogScope, restoreKiroCatalog } from "./kiro-catalog.js";
import { kiroChat } from "./kiro-chat.js";

type CatalogEntry = ModelsStoreEntry & { cacheVersion: number; cacheScope: string };

type CacheReason = "uninitialized" | "credential-unavailable" | "missing" | "unscoped" | "unsupported-version" | "scope-mismatch" | "invalid" | "restored-v1" | "restored-v2";
export type KiroCatalogState = {
  generation: number;
  scope: string | undefined;
  cacheReason: CacheReason;
  source: "none" | "cache" | "network";
  refresh: "idle" | "pending" | "succeeded" | "failed";
};
export type KiroProvider = Provider & { catalogState(): KiroCatalogState };

/** Non-secret diagnostics only; never return scope hashes or credential fields. */
export function kiroConnectionNotices(connection: { api?: unknown; baseUrl?: unknown }, state?: KiroCatalogState): string[] {
  const notices: string[] = [];
  if (connection.api && connection.api !== "kiro-chat")
    notices.push("Kiro 连接仍使用旧协议或自定义 API。请保留原 modelId、账号及代理，手动改为 kiro-chat 后重新拉取目录；登录不会自动迁移配置，也不会改用 OpenAI。");
  if (connection.baseUrl)
    notices.push("Kiro 目录不接受显式 Base URL；聊天只接受固定服务元数据地址。请保留原 modelId、账号和代理，手动检查并清除连接的地址覆盖；代理应在供应商代理设置中配置，不会向自定义地址发送令牌。");
  const reason = state?.cacheReason ?? "uninitialized";
  const explanations: Record<CacheReason, string> = {
    uninitialized: "尚未载入目录缓存", "credential-unavailable": "当前登录元数据不可用，无法校验目录所属账号",
    missing: "缺少目录缓存", unscoped: "旧目录缓存未绑定账号范围", "unsupported-version": "目录缓存版本不受支持",
    "scope-mismatch": "目录缓存与当前登录或 profile 不匹配（刷新令牌轮转也会改变范围）",
    invalid: "目录缓存未通过完整性校验", "restored-v1": "已恢复同账号旧版目录，未声明的能力仍未知",
    "restored-v2": "已恢复同账号目录缓存",
  };
  notices.push(state?.source === "network"
    ? "本次已实时获取目录，但未验证文本推理或工具权限；零值单价不代表免费。"
    : `${explanations[reason]}。可主动点击拉取模型列表进行受控联网刷新；不会恢复其他账号目录、自动重登或改写模型配置。目录/缓存不代表文本推理或工具权限已验证，零值单价不代表免费。`);
  if (state?.refresh === "failed") notices.push("本次目录刷新失败；仅保留通过当前账号范围校验的缓存，不会发布不完整分页结果。");
  return notices;
}

/** Native account catalog and AWS event-stream chat adapter. */
export function kiroProvider(options: { fetch?: typeof fetch } = {}): KiroProvider {
  let models: Model<Api>[] = [];
  let scope: string | undefined;
  let generation = 0;
  let cacheReason: CacheReason = "uninitialized";
  let source: KiroCatalogState["source"] = "none";
  let refresh: KiroCatalogState["refresh"] = "idle";
  const chat = kiroChat(kiroOAuth(options), options.fetch);
  return {
    id: "kiro", name: "kiro", auth: { oauth: chat.auth },
    getModels: () => models,
    catalogState: () => ({ generation, scope, cacheReason, source, refresh }),
    // Availability may be read without refresh after logout or an account switch.
    filterModels: (items, credential) => {
      const current = kiroCatalogScope(credential);
      return current && current === scope ? items : [];
    },
    async refreshModels(context) {
      const current = kiroCatalogScope(context.credential);
      const stored = context.stored as Readonly<CatalogEntry> | undefined;
      const restored = current && stored && [1, 2].includes(stored.cacheVersion) && stored.cacheScope === current
        ? restoreKiroCatalog(stored.models, stored.cacheVersion === 1) : undefined;
      // Check on BOTH phases: OAuth refresh may rotate the token between them.
      // Missing, legacy, or invalid storage also invalidates a warm same-scope catalog.
      const reason: CacheReason = !current ? "credential-unavailable" : !stored ? "missing"
        : !stored.cacheScope ? "unscoped" : ![1, 2].includes(stored.cacheVersion) ? "unsupported-version"
        : stored.cacheScope !== current ? "scope-mismatch" : !restored ? "invalid"
        : stored.cacheVersion === 1 ? "restored-v1" : "restored-v2";
      if (!await context.publish({ update: () => {
        models = restored ?? []; scope = current; cacheReason = reason;
        source = restored ? "cache" : "none";
        refresh = context.allowNetwork && context.credential ? "pending" : "idle";
      } })) return;
      if (!context.allowNetwork || !context.credential) return;
      try {
        const fetched = await fetchKiroCatalog(context.credential, context.signal, options.fetch);
        const entry: CatalogEntry = { models: fetched, checkedAt: Date.now(), cacheVersion: 2, cacheScope: current! };
        await context.publish({ persist: entry, update: () => {
          models = fetched; scope = current; generation++; source = "network"; refresh = "succeeded";
        } });
      } catch (error) {
        await context.publish({ update: () => { refresh = "failed"; } });
        throw error;
      }
    },
    stream: (model, context, input) => chat.stream(model, context, input),
    streamSimple: chat.stream,
  };
}
