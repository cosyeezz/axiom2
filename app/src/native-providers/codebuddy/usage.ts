import type { NativeTokenUsage } from "../contracts.js";
import { codeBuddyObject, CodeBuddyProtocolError } from "./failure.js";
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Counts are upstream facts, never model prices. Missing counters are partial, not fabricated zeros. */
export function codeBuddyUsage(value: unknown): NativeTokenUsage | undefined {
  const usage = codeBuddyObject(value);
  if (!usage) throw new CodeBuddyProtocolError("usage");
  const prompt = usage.prompt_tokens, output = usage.completion_tokens, total = usage.total_tokens;
  const detail = codeBuddyObject(usage.prompt_tokens_details), cached = detail?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
  for (const value of [prompt, output, total, cached, usage.prompt_cache_miss_tokens])
    if (value !== undefined && !count(value)) throw new CodeBuddyProtocolError("usage");
  if (detail?.cached_tokens !== undefined && usage.prompt_cache_hit_tokens !== undefined && detail.cached_tokens !== usage.prompt_cache_hit_tokens) throw new CodeBuddyProtocolError("usage");
  if (!count(prompt) || !count(output)) return undefined;
  if (!count(cached) || cached > prompt || !Number.isSafeInteger(prompt + output) || total !== undefined && total !== prompt + output ||
      usage.prompt_cache_miss_tokens !== undefined && usage.prompt_cache_miss_tokens !== prompt - cached) throw new CodeBuddyProtocolError("usage");
  return { input: prompt - cached, output, cacheRead: cached, cacheWrite: 0, totalTokens: prompt + output };
}
