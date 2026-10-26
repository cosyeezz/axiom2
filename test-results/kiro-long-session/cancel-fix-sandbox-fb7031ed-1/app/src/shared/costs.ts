import type { Scope } from "./protocol.js";

export const costCategories = ["main", "subagent", "compression", "tool", "other"] as const;
export type CostCategory = typeof costCategories[number];
export const costLabels: Record<CostCategory, string> = {
  main: "主 Agent", subagent: "子 Agent", compression: "压缩", tool: "工具内部调用", other: "其他模型调用",
};
export const costParts = ["input", "output", "cacheRead", "cacheWrite"] as const;
export type CostPart = typeof costParts[number];
export const costPartLabels: Record<CostPart, string> = {
  input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入",
};
export interface CostTotals {
  /** Usage records, not necessarily individual API calls (summaries/tools may aggregate). */
  records: number;
  knownCost: number;
  unknownCost: number;
  tokens: Record<CostPart, number>;
  unknownTokens: number;
  parts: Record<CostPart, number>;
  unknownParts: number;
}
export interface CostRow extends CostTotals {
  id: string;
  category: CostCategory;
  sessionId: string;
  source: string;
  provider: string | null;
  model: string | null;
  status?: string;
  timestamp?: number;
}
export interface CostSession {
  id: string;
  title: string;
  taskId: string | null;
  status: string | null;
}
export interface CostReport {
  scope: Scope;
  requestedSessionId: string;
  title: string;
  updatedAt: number;
  sessions: CostSession[];
  rows: CostRow[];
  total: CostTotals;
  warnings: string[];
}
export const costsScope = (scope: Scope) => `costs:${scope.workspaceId}:${scope.sessionId}`;
export function emptyCostTotals(): CostTotals {
  return { records: 0, knownCost: 0, unknownCost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    unknownTokens: 0, parts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, unknownParts: 0 };
}
export function sumCosts(rows: readonly CostTotals[]): CostTotals {
  const total = emptyCostTotals();
  for (const row of rows) {
    total.records += row.records;
    total.knownCost += row.knownCost;
    total.unknownCost += row.unknownCost;
    total.unknownTokens += row.unknownTokens;
    total.unknownParts += row.unknownParts;
    for (const part of costParts) { total.tokens[part] += row.tokens[part]; total.parts[part] += row.parts[part]; }
  }
  return total;
}
export function costTokens(total: CostTotals): string {
  if (!total.records) return "—";
  const known = costParts.reduce((sum, part) => sum + total.tokens[part], 0);
  if (total.unknownTokens && !known) return "未知";
  return `${known.toLocaleString("zh-CN")}${total.unknownTokens ? " + 未知" : ""}`;
}
export function costAmount(total: CostTotals): string {
  if (!total.records) return "—";
  if (total.unknownCost && !total.knownCost) return "未知";
  return `$${total.knownCost.toFixed(4)}${total.unknownCost ? " + 未知" : ""}`;
}
