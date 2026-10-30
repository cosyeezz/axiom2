import type { UsageRequestType } from "../shared/model-usage.js";
import { usageRangeError } from "./usage-dates.js";
export type UsageDraft = { workspace: string; provider: string; session: string; requestType: "" | UsageRequestType; from: string; to: string; query: string };
export const emptyUsageDraft = (): UsageDraft => ({ workspace: "", provider: "", session: "", requestType: "", from: "", to: "", query: "" });
export type UsagePageState = { draft: UsageDraft; applied: UsageDraft; requested: boolean; page: number; pageSize: number; snapshot?: { workspace: string; id: string } };
export const usagePageStateKey = "axiom.usage.page.v1";
const ttl = 5 * 60_000, maxBytes = 8192;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function validDraft(value: unknown): value is UsageDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as UsageDraft;
  if (!["workspace", "provider", "session", "from", "to", "query"].every(key => typeof draft[key as keyof UsageDraft] === "string")) return false;
  if (draft.workspace.length > 160 || draft.session.length > 160 || draft.query.length > 200 || draft.provider.length > 1000 || draft.from.length > 10 || draft.to.length > 10) return false;
  if (!["", "main", "subagent", "compression"].includes(draft.requestType) || usageRangeError(draft)) return false;
  if (draft.provider) { try { const id: unknown = JSON.parse(draft.provider); if (id !== null && (typeof id !== "string" || !id.length || id.length > 160)) return false; } catch { return false; } }
  return true;
}
/** Only navigation intent survives a document change; never persist reports or authorization. */
export function readUsagePageState(storage?: StorageLike, now = Date.now()): UsagePageState | undefined {
  try {
    const local = storage ?? sessionStorage, raw = local.getItem(usagePageStateKey);
    if (!raw) return undefined;
    if (raw.length > maxBytes) { local.removeItem(usagePageStateKey); return undefined; }
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.savedAt) || now < value.savedAt || now - value.savedAt >= ttl || !validDraft(value.draft) || !validDraft(value.applied) || typeof value.requested !== "boolean" ||
      !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 1_000_000 || ![20, 50, 100].includes(value.pageSize)) { local.removeItem(usagePageStateKey); return undefined; }
    const snapshot = value.snapshot;
    if (snapshot !== undefined && (!snapshot || typeof snapshot.workspace !== "string" || snapshot.workspace.length > 160 || typeof snapshot.id !== "string" || !snapshot.id.length || snapshot.id.length > 160)) return undefined;
    return { draft: value.draft, applied: value.applied, requested: value.requested, page: value.page, pageSize: value.pageSize, ...(snapshot ? { snapshot } : {}) };
  } catch { return undefined; }
}
export function saveUsagePageState(state: UsagePageState, storage?: StorageLike, now = Date.now()) {
  try {
    // Explicitly whitelist fields: callers cannot accidentally persist ledger/account data.
    const draft = (value: UsageDraft) => Object.fromEntries(Object.keys(emptyUsageDraft()).map(key => [key, value[key as keyof UsageDraft]]));
    const encoded = JSON.stringify({ savedAt: now, draft: draft(state.draft), applied: draft(state.applied), requested: state.requested,
      page: state.page, pageSize: state.pageSize, ...(state.snapshot ? { snapshot: { workspace: state.snapshot.workspace, id: state.snapshot.id } } : {}) });
    if (encoded.length <= maxBytes) (storage ?? sessionStorage).setItem(usagePageStateKey, encoded);
  } catch { /* Blocked/full storage must not affect the page. */ }
}
