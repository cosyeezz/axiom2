import { useSyncExternalStore } from "react";
import { brandMarks, type BrandMark } from "./brand-marks.js";

/** Display-only card icon choice. Stored locally per account; never sent to the server or used for routing. */
export type AccountIconChoice = `brand:${BrandMark}` | `glyph:${GenericGlyph}`;
const genericGlyphs = { cpu: "芯片", server: "服务器", globe: "网络", "key-round": "钥匙", database: "数据库", brain: "模型", network: "接口", star: "星标" } as const;
type GenericGlyph = keyof typeof genericGlyphs;

export const accountIconOptions: { value: AccountIconChoice; label: string }[] = [
  ...Object.entries(brandMarks).map(([id, mark]) => ({ value: `brand:${id}` as AccountIconChoice, label: mark.label })),
  ...Object.entries(genericGlyphs).map(([id, label]) => ({ value: `glyph:${id}` as AccountIconChoice, label })),
];
const valid = (value: unknown): value is AccountIconChoice => accountIconOptions.some(option => option.value === value);

/** Provider default: brand mark when the provider is known, otherwise a neutral chip glyph. */
export function defaultAccountIcon(providerId: string): AccountIconChoice {
  const id = providerId.toLowerCase();
  if (id.startsWith("openai")) return "brand:openai";
  if (id.includes("anthropic") || id.includes("claude")) return "brand:anthropic";
  if (id.includes("gemini") || id.includes("google")) return "brand:gemini";
  if (id.includes("deepseek")) return "brand:deepseek";
  if (id.includes("copilot")) return "brand:copilot";
  return api(id) ? "glyph:network" : "glyph:cpu";
}
const api = (id: string) => id === "fixture" || id.includes("api");

const storageKey = "axiom.model-account-icons";
const listeners = new Set<() => void>();
let cache: Record<string, AccountIconChoice> | undefined;
function read(): Record<string, AccountIconChoice> {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
    cache = Object.fromEntries(Object.entries(parsed && typeof parsed === "object" ? parsed : {}).filter(([, value]) => valid(value))) as Record<string, AccountIconChoice>;
  } catch { cache = {}; }
  return cache;
}
function publish() { for (const listener of listeners) listener(); }
addEventListener("storage", event => { if (event.key === storageKey) { cache = undefined; publish(); } });

/** Explicit choice, or undefined when the provider default applies. */
export function useAccountIcon(accountId: string) {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => read()[accountId]);
}
export function setAccountIcon(accountId: string, choice: AccountIconChoice | undefined) {
  const next = { ...read() };
  if (choice) next[accountId] = choice; else delete next[accountId];
  cache = next;
  try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Choice still applies for this page when storage is blocked. */ }
  publish();
}
