import type { NativeAuthInteraction, NativeCredentialStore, NativeOAuth, NativeOAuthCredential } from "./contracts.js";
import { waitForNative } from "./abort.js";

/** Optional standalone lifecycle. SDKs which already own locked refresh use oauth directly. */
export function createNativeAccount<C extends NativeOAuthCredential>(oauth: NativeOAuth<C>, store: NativeCredentialStore<C>) {
  const active = new Set<AbortController>();
  let disposed = false;
  function invalidate() {
    for (const controller of active) controller.abort(new DOMException("账号操作已失效。", "AbortError"));
  }
  async function operation<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (disposed) throw new Error("原生账号组件已关闭。");
    signal.throwIfAborted();
    const controller = new AbortController();
    const bounded = AbortSignal.any([signal, controller.signal]);
    active.add(controller);
    try {
      const value = await waitForNative(work(bounded), bounded);
      bounded.throwIfAborted();
      return value;
    } finally { active.delete(controller); }
  }
  function validate(credential: C) {
    const token = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 32768 && !/[\r\n\0]/.test(value);
    if (credential.type !== "oauth" || !token(credential.access) || !token(credential.refresh) || !Number.isSafeInteger(credential.expires))
      throw new Error("原生账号存储中的凭据无效。");
  }
  return {
    /** Login is interactive only when explicitly requested; it cannot overwrite a newer account. */
    login(interaction: NativeAuthInteraction): Promise<C> {
      return operation(interaction.signal, async signal => {
        const initial = await store.read(signal);
        signal.throwIfAborted();
        const credential = await oauth.login({ ...interaction, signal });
        signal.throwIfAborted(); validate(credential);
        if (credential.expires <= Date.now()) throw new Error("登录返回的凭据已过期。");
        const committed = await store.transaction(async current => {
          signal.throwIfAborted();
          if (current.revision !== initial.revision) throw new Error("登录期间账号存储已变化；未覆盖较新的账号。");
          return credential;
        }, signal);
        signal.throwIfAborted();
        if (!committed.credential) throw new Error("登录凭据未保存。");
        return committed.credential;
      });
    },
    /** Read/refresh is serialized by the injected secure store, not a second background owner. */
    resolve(signal: AbortSignal): Promise<C> {
      return operation(signal, async bounded => {
        const snapshot = await store.transaction(async current => {
          bounded.throwIfAborted();
          if (!current.credential) throw new Error("原生账号尚未登录。");
          validate(current.credential);
          if (current.credential.expires > Date.now()) return undefined;
          const refreshed = await oauth.refresh(current.credential, bounded);
          bounded.throwIfAborted(); validate(refreshed);
          if (refreshed.expires <= Date.now()) throw new Error("刷新返回的凭据已过期。");
          return refreshed;
        }, bounded);
        bounded.throwIfAborted();
        if (!snapshot.credential) throw new Error("原生账号已退出。");
        return snapshot.credential;
      });
    },
    logout(signal: AbortSignal): Promise<void> {
      invalidate();
      return operation(signal, async bounded => {
        await store.transaction(async () => { bounded.throwIfAborted(); return null; }, bounded);
      });
    },
    /** Host calls this on an externally selected account change; no credentials are retained here. */
    invalidate,
    dispose() { disposed = true; invalidate(); },
  };
}
