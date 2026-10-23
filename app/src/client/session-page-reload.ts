import { hasUnsavedFileEdits } from "./file-edit-guard.js";
import type { Scope } from "../shared/protocol.js";
import type { CapabilityReloadSelection } from "../shared/capabilities.js";
import { reloadScope, type ReloadState } from "../shared/reload.js";
import { command, scopeSnapshot, subscribeScope } from "./transport.js";
import { flushDraftsForPageReload } from "./draft-persistence.js";

let refreshing = false;
/** Follow only an explicitly accepted operation in this window, even after its dialog closes. */
export async function reloadSessionAndPage(scope: Scope, capabilities?: CapabilityReloadSelection, onApplied?: () => void) {
  const key = reloadScope(scope);
  let accepted: ReloadState | undefined, unsubscribe = () => {};
  let inspect = () => {};
  const completed = new Promise<void>((resolve, reject) => {
    inspect = () => {
      if (!accepted) return;
      const snapshot = scopeSnapshot<ReloadState | null>(key);
      const state = snapshot?.id === accepted.id ? snapshot : accepted;
      if (state.status === "completed") resolve();
      else if (state.status === "failed") reject(new Error(state.error || "重载未完成，页面未刷新。"));
    };
    unsubscribe = subscribeScope(key, inspect);
  });
  try {
    accepted = await command<ReloadState>("agent.reload", capabilities ? { capabilities } : {}, scope);
    inspect();
    await completed;
    onApplied?.();
  } finally { unsubscribe(); }
  if (refreshing) return;
  refreshing = true;
  try {
    if (hasUnsavedFileEdits()) throw new Error("文件仍有未保存编辑，请先保存后手动刷新页面。");
    try { await flushDraftsForPageReload(); }
    catch {
      // Configuration reload already succeeded. Keep unsaved input in memory
      // without surfacing optional draft persistence failures to the user.
      refreshing = false;
      return;
    }
    if (hasUnsavedFileEdits()) throw new Error("文件仍有未保存编辑，请先保存后手动刷新页面。");
    window.location.reload();
  } catch (error) {
    refreshing = false;
    throw new Error(`配置已重载，页面尚未刷新：${error instanceof Error ? error.message : "请稍后手动刷新。"}`);
  }
}
