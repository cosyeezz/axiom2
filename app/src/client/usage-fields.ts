import { costParts, type CostPart, type CostTotals } from "../shared/costs.js";

export const usageColumns = [
  { id: "time", label: "调用时间", group: "基本信息", width: 106, text: true },
  { id: "context", label: "工作空间 / 会话", group: "基本信息", width: 132, text: true },
  { id: "model", label: "模型 / 供应商", group: "基本信息", width: 138, text: true },
  { id: "provider", label: "供应商", group: "基本信息", width: 100, text: true },
  { id: "source", label: "调用来源", group: "基本信息", width: 116, text: true },
  { id: "category", label: "调用类别", group: "基本信息", width: 94, text: true },
  { id: "kind", label: "账务类型", group: "基本信息", width: 88, text: true },
  { id: "status", label: "来源状态", group: "基本信息", width: 88, text: true },
  { id: "sessionId", label: "会话 ID", group: "基本信息", width: 124, text: true },
  { id: "records", label: "账务条数", group: "基本信息", width: 74, text: false },
  { id: "input", label: "普通输入", group: "Token 用量", width: 74, text: false },
  { id: "cacheRead", label: "缓存读取", group: "Token 用量", width: 74, text: false },
  { id: "cacheHit", label: "缓存命中率", group: "Token 用量", width: 82, text: false },
  { id: "cacheWrite", label: "缓存写入", group: "Token 用量", width: 74, text: false },
  { id: "inputTotal", label: "输入合计", group: "Token 用量", width: 78, text: false },
  { id: "output", label: "输出", group: "Token 用量", width: 70, text: false },
  { id: "total", label: "总 Token", group: "Token 用量", width: 78, text: false },
  { id: "amount", label: "消费金额", group: "费用信息", width: 100, text: false },
  { id: "inputCost", label: "输入费用", group: "费用信息", width: 94, text: false },
  { id: "cacheReadCost", label: "缓存读取费用", group: "费用信息", width: 100, text: false },
  { id: "cacheWriteCost", label: "缓存写入费用", group: "费用信息", width: 100, text: false },
  { id: "outputCost", label: "输出费用", group: "费用信息", width: 94, text: false },
  { id: "estimatedCost", label: "其中参考估算", group: "费用信息", width: 104, text: false },
  { id: "pricing", label: "计价状态", group: "费用信息", width: 106, text: true },
] as const;
export type UsageColumnId = typeof usageColumns[number]["id"];
export type UsageView = { columns: UsageColumnId[]; density: "compact" | "comfortable" };
export const usageViewKey = "axiom.usage.view.v1";
export const defaultUsageColumns: UsageColumnId[] = ["time", "context", "model", "source", "input", "cacheRead", "cacheHit", "cacheWrite", "output", "total", "amount"];
export function normalizeUsageView(value: unknown): UsageView {
  const source = value && typeof value === "object" ? value as Partial<UsageView> : {};
  const columns = Array.isArray(source.columns) ? usageColumns.filter(column => source.columns!.includes(column.id)).map(column => column.id) : [];
  return { columns: columns.length ? columns : [...defaultUsageColumns], density: source.density === "comfortable" ? "comfortable" : "compact" };
}
export function readUsageView(storage: Pick<Storage, "getItem">): UsageView {
  try { const value = storage.getItem(usageViewKey); return normalizeUsageView(value && value.length <= 8192 ? JSON.parse(value) : undefined); }
  catch { return normalizeUsageView(undefined); }
}
function completeTokens(total: CostTotals | undefined): total is CostTotals {
  return !!total && Number.isFinite(total.records) && total.records > 0 && total.unknownTokens === 0 && costParts.every(part => Number.isFinite(total.tokens[part]) && total.tokens[part] >= 0);
}
export function usageInputTotal(total: CostTotals | undefined): number | undefined {
  if (!completeTokens(total)) return;
  const value = total.tokens.input + total.tokens.cacheRead + total.tokens.cacheWrite;
  return Number.isFinite(value) ? value : undefined;
}
/** Token-weighted cache reads, not a percentage of network requests. */
export function usageCacheHit(total: CostTotals | undefined): number | undefined {
  const input = usageInputTotal(total);
  return input !== undefined && input > 0 ? total!.tokens.cacheRead / input * 100 : undefined;
}
export const usageCacheHitDescription = "Token 维度：缓存读取 ÷（普通输入＋缓存读取＋缓存写入）；不是请求命中率。数据不完整或输入合计为零时不计算。";
export function usageCostPart(total: CostTotals, part: CostPart): number | undefined {
  return total.records > 0 && total.unknownParts === 0 && Number.isFinite(total.parts[part]) && total.parts[part] >= 0 ? total.parts[part] : undefined;
}
export function usagePricingLabel(total: CostTotals): string {
  if (total.unknownCost) return total.knownCost > 0 ? `部分计价${total.estimatedRecords ? " · 含估算" : ""}` : "未计价";
  return total.estimatedRecords ? "含参考估算" : "已记录金额";
}
export const usageColumnDescriptions: Partial<Record<UsageColumnId, string>> = {
  input: "普通输入 Token，不包含缓存读取和缓存写入。", cacheRead: "从缓存读取的输入 Token。", cacheWrite: "写入或创建缓存的输入 Token；不是模型输出。",
  inputTotal: "普通输入＋缓存读取＋缓存写入；缺失数据时不计算。", output: "模型输出 Token。", total: "普通输入＋缓存读取＋缓存写入＋输出；不完整时仅展示已确认部分。",
  cacheHit: usageCacheHitDescription, amount: "已记录历史费用及有来源的公开参考估算（USD）；不是官方余额或完整实际账单。",
  records: "来源内的账务条数，不等于网络请求次数。", status: "本机来源状态，不是 HTTP 状态或请求成功率。",
  estimatedCost: "已包含在消费金额中的公开参考价估算子集，不可再相加；不是额外扣款。",
  inputCost: "历史账务中的普通输入费用（USD）；缺少完整分项时不显示。", outputCost: "历史账务中的输出费用（USD）；缺少完整分项时不显示。",
  cacheReadCost: "历史账务中的缓存读取费用（USD）；缺少完整分项时不显示。", cacheWriteCost: "历史账务中的缓存写入费用（USD）；缺少完整分项时不显示。",
};
