import type { NativeTokenUsage } from "../contracts.js";
import { KiroChatError, kiroObject } from "./protocol.js";

/** Validate service counters only. Host SDK pricing and aggregation stay outside the component. */
export function readKiroTokenUsage(value: unknown): NativeTokenUsage | undefined {
  const source = kiroObject(value);
  const keys = { input: "uncachedInputTokens", output: "outputTokens", cacheRead: "cacheReadInputTokens", cacheWrite: "cacheWriteInputTokens" } as const;
  const count = (key: string) => {
    const value = source[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)
      throw new KiroChatError("Kiro token 用量格式无效。");
    return value;
  };
  for (const key of [...Object.values(keys), "totalTokens"]) if (source[key] != null) count(key);
  if (Object.values(keys).some(key => source[key] == null)) return undefined;
  const snapshot = { input: count(keys.input), output: count(keys.output), cacheRead: count(keys.cacheRead), cacheWrite: count(keys.cacheWrite) };
  const totalTokens = Object.values(snapshot).reduce((sum, value) => sum + value, 0);
  if (source.totalTokens != null && count("totalTokens") !== totalTokens)
    throw new KiroChatError("Kiro token 用量总计与分项不一致。");
  return { ...snapshot, totalTokens };
}
