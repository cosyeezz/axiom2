import type { NativeModel } from "../contracts.js";
import { codeBuddyBuiltinModels, parseCodeBuddyConfiguration } from "./models.js";
import { createCodeBuddyJsonRequest, validCodeBuddyToken } from "./json.js";

export interface CodeBuddyCatalogSnapshot {
  models: NativeModel[];
  source: "builtin" | "network";
  /** Configuration visibility is never a proof of account inference permission or quota. */
  permissionsVerified: false;
}

export async function fetchCodeBuddyCatalog(access: string, signal: AbortSignal, transport?: typeof fetch): Promise<NativeModel[]> {
  signal.throwIfAborted();
  if (!validCodeBuddyToken(access)) throw new Error("CodeBuddy 目录需要有效账号令牌。");
  // Official buildRepoParams([]) -> [] and Axios default serializer emits no query.
  // No repository collector, workspace metadata, profile spoofing or remote endpoint override.
  const envelope = await createCodeBuddyJsonRequest({ fetch: transport, requestTimeoutMs: 5000 }, "目录")("/v3/config", {
    method: "GET", headers: { Authorization: `Bearer ${access}`, Connection: "close" },
  }, signal);
  if (envelope.code !== undefined && envelope.code !== 0) throw new Error("CodeBuddy 目录请求被拒绝，请检查账号。");
  return parseCodeBuddyConfiguration(envelope.data);
}

/** Optional account-local RAM catalog. No disk cache, token hashing, refresh ownership or implicit IO. */
export function createCodeBuddyCatalog(transport?: typeof fetch) {
  let scope: string | undefined, cached: CodeBuddyCatalogSnapshot | undefined;
  let epoch = 0, disposed = false;
  let pending: AbortController | undefined;
  function invalidate() {
    epoch++;
    pending?.abort(new DOMException("CodeBuddy 目录操作已失效。", "AbortError"));
    pending = undefined; scope = undefined; cached = undefined;
  }
  function select(access: string, accountKey?: string) {
    if (disposed) throw new Error("CodeBuddy 目录组件已关闭。");
    if (!validCodeBuddyToken(access)) throw new Error("CodeBuddy 目录需要有效账号令牌。");
    if (accountKey !== undefined && (!accountKey || accountKey.length > 256 || /[\r\n\0]/.test(accountKey)))
      throw new Error("CodeBuddy 目录账号范围无效。");
    // A trusted host key may span token rotation; without one, only the exact current token may reuse RAM.
    const next = accountKey === undefined ? `token:${access}` : `account:${accountKey}`;
    if (scope !== next) { invalidate(); scope = next; }
  }
  return {
    get(access: string, accountKey?: string): CodeBuddyCatalogSnapshot {
      select(access, accountKey);
      return structuredClone(cached ?? { models: codeBuddyBuiltinModels(), source: "builtin", permissionsVerified: false });
    },
    async refresh(access: string, requested: AbortSignal, accountKey?: string): Promise<CodeBuddyCatalogSnapshot> {
      requested.throwIfAborted(); select(access, accountKey);
      pending?.abort(new DOMException("CodeBuddy 目录请求已被新请求替代。", "AbortError"));
      const controller = new AbortController(); pending = controller;
      const current = ++epoch;
      const signal = AbortSignal.any([requested, controller.signal]);
      try {
        const models = await fetchCodeBuddyCatalog(access, signal, transport);
        signal.throwIfAborted();
        if (current !== epoch || disposed) throw new DOMException("CodeBuddy 目录操作已失效。", "AbortError");
        cached = { models, source: "network", permissionsVerified: false };
        return structuredClone(cached);
      } finally { if (pending === controller) pending = undefined; }
    },
    invalidate,
    dispose() { disposed = true; invalidate(); },
  };
}
