import { useSyncExternalStore } from "react";
import { command } from "./transport.js";
import {
  scopeKey,
  type Attachment,
  type Draft,
  type Scope,
} from "../shared/protocol.js";

// New document = new viewing instance; sessionStorage restores drafts without sharing writes across tabs.
const viewId = crypto.randomUUID();
const drafts = new Map<string, Draft & { error: string }>();
const listeners = new Map<string, Set<() => void>>();
const saves = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function get(scope: Scope) {
  const key = scopeKey(scope);
  if (!drafts.has(key)) {
    let text = "",
      attachment: Attachment | null = null,
      error = "";
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`draft:${key}`) || "null",
      );
      if (saved) {
        text = saved.text;
        attachment = saved.attachment;
      }
    } catch {
      error = "本地草稿无法读取，请检查浏览器存储。";
    }
    drafts.set(key, { text, attachment, revision: 0, error });
  }
  return drafts.get(key)!;
}
export function updateDraft(
  scope: Scope,
  patch: Partial<Pick<Draft, "text" | "attachment">>,
) {
  const key = scopeKey(scope),
    next = { ...get(scope), ...patch, error: "" };
  try {
    sessionStorage.setItem(
      `draft:${key}`,
      JSON.stringify({ text: next.text, attachment: next.attachment }),
    );
  } catch {
    next.error = "浏览器草稿保存失败；请勿关闭页面。";
  }
  drafts.set(key, next);
  listeners.get(key)?.forEach((fn) => fn());
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      const save = (saves.get(key) || Promise.resolve()).then(async () => {
        const captured = get(scope);
        try {
          // Reconcile a previous uncertain save before this new edit; never replay mutations on reconnect.
          const current = await command<Draft>("draft.get", { viewId }, scope);
          const saved = await command<Draft>(
            "draft.save",
            {
              viewId,
              text: captured.text,
              attachment: captured.attachment,
              revision: current.revision,
            },
            scope,
          );
          drafts.set(key, { ...get(scope), revision: saved.revision });
        } catch (error) {
          drafts.set(key, { ...get(scope), error: (error as Error).message });
        }
        listeners.get(key)?.forEach((fn) => fn());
      });
      saves.set(key, save);
    }, 300),
  );
}
export function useDraft(scope: Scope) {
  const key = scopeKey(scope);
  return useSyncExternalStore(
    (fn) => {
      const group = listeners.get(key) || new Set<() => void>();
      listeners.set(key, group);
      group.add(fn);
      return () => {
        group.delete(fn);
      };
    },
    () => get(scope),
  );
}
