import { useSyncExternalStore } from "react";
import type { CapabilityReloadSelection } from "../shared/capabilities.js";

export type SelectionDrafts = Partial<Record<"session" | "defaults", CapabilityReloadSelection>>;
const selections = new Map<string, SelectionDrafts>();
const listeners = new Set<() => void>();
const empty: SelectionDrafts = {};
const storageKey = (key: string) => `capability-drafts:${key}`;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function valid(value: unknown, target: "session" | "defaults"): value is CapabilityReloadSelection {
  if (!value || typeof value !== "object") return false;
  const item = value as CapabilityReloadSelection;
  return item.target === target && Number.isSafeInteger(item.revision) && item.revision >= 0 && typeof item.catalogRevision === "string" &&
    [item.skills, item.mcp].every(ids => Array.isArray(ids) && ids.length <= 2000 && ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 1024) && new Set(ids).size === ids.length);
}
function read(key: string): SelectionDrafts {
  if (!key) return empty;
  if (!selections.has(key)) {
    const restored: SelectionDrafts = {};
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey(key)) ?? "null");
      for (const target of ["session", "defaults"] as const) if (valid(stored?.[target], target)) restored[target] = stored[target];
    } catch { /* Keep drafts in memory when browser storage is unavailable. */ }
    selections.set(key, restored);
  }
  return selections.get(key)!;
}
function update(key: string, target: "session" | "defaults", value?: CapabilityReloadSelection) {
  if (!key) return;
  const next = { ...read(key), [target]: value };
  selections.set(key, next);
  try {
    if (next.session || next.defaults) sessionStorage.setItem(storageKey(key), JSON.stringify(next));
    else sessionStorage.removeItem(storageKey(key));
  } catch { /* The in-memory draft remains available until the page is closed. */ }
  for (const listener of listeners) listener();
}

/** Tab-local drafts survive composer remounts and the other target's successful reload. */
export function useCapabilityDrafts(key: string) {
  const drafts = useSyncExternalStore(subscribe, () => read(key));
  return { drafts, update: (target: "session" | "defaults", value?: CapabilityReloadSelection) => update(key, target, value) };
}
