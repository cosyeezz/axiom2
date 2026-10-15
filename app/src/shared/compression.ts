import type { Scope } from "./protocol.js";
import type { Selection } from "./agent.js";

export interface AutoCompression {
  enabled: boolean;
  tokens: number;
  percent: number;
}
export const defaultAutoCompression: AutoCompression = { enabled: true, tokens: 100_000, percent: 80 };
export function autoCompressionThreshold(settings: AutoCompression, contextWindow?: number | null): number {
  return contextWindow != null && Number.isFinite(contextWindow) && contextWindow > 0
    ? Math.min(settings.tokens, Math.ceil(contextWindow * settings.percent / 100))
    : settings.tokens;
}
export interface CompressionPreferences {
  selection: Selection | null;
  auto: AutoCompression;
}
export const compressionPreferencesScope = "compression-preferences";
export const emptyCompressionPreferences: CompressionPreferences = { selection: null, auto: defaultAutoCompression };

export interface Compression {
  id: string;
  requestId: string;
  trigger?: "manual" | "auto";
  state: "running" | "completed" | "cancelled" | "failed" | "interrupted";
  phase: "snapshot" | "summarizing" | "applying" | "done";
  appliedAt?: number | null;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  before: number | null;
  after: number | null;
  summary: string;
  error: string | null;
  selection: { provider: string; id: string };
  /** Per-request accounting, retained even when the summary is not applied. */
  billing?: import("./costs.js").CostTotals;
  usage: {
    input: number;
    output: number;
    total: number;
    cost: number | null;
  } | null;
}
export const compressionScope = (s: Scope) =>
  `compression:${s.workspaceId}:${s.sessionId}`;
export const compressionLabels: Record<Compression["state"], string> = {
  running: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
  interrupted: "已中断",
};
