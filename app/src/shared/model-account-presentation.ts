import type { ModelAccount } from "./model-accounts.js";

export type ModelAccountPresentation = { kind: "generic" | "openai-subscription"; label?: string; metricIds?: string[] };
const generic: ModelAccountPresentation = { kind: "generic" };
// Provider display capabilities are separate from authentication and upstream metric adapters.
const presentations: ReadonlyMap<string, ModelAccountPresentation> = new Map([
  ["openai", { kind: "openai-subscription", label: "订阅余额与额度", metricIds: ["primary_window", "secondary_window"] }],
  ["openai-codex", { kind: "openai-subscription", label: "订阅余额与额度", metricIds: ["primary_window", "secondary_window"] }],
]);
export function modelAccountPresentation(account: Pick<ModelAccount, "providerId" | "type">): ModelAccountPresentation {
  return account.type === "oauth" ? presentations.get(account.providerId) ?? generic : generic;
}
export function modelAccountAuthCounts(accounts: readonly ModelAccount[]) {
  const counts = new Map<string, number>();
  for (const account of accounts) if (account.type) counts.set(account.providerId, (counts.get(account.providerId) ?? 0) + 1);
  return counts;
}
/** Apply eligibility to the complete account set before any search/provider filtering. */
export function displayModelAccounts(accounts: readonly ModelAccount[]) {
  const counts = modelAccountAuthCounts(accounts);
  return accounts.filter(account => account.type && (modelAccountPresentation(account).kind !== "generic" || (counts.get(account.providerId) ?? 0) >= 2));
}
