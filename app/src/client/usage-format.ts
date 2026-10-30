import { costParts, type CostTotals } from "../shared/costs.js";
export const tokenSum = (total: CostTotals) => costParts.reduce((sum, part) => sum + total.tokens[part], 0);
export const exact = (value: number) => Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumSignificantDigits: 21 }) : "无法核对";
export const compactNumber = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : value >= 1e15 || value > 0 && value < 0.01 ? value.toExponential(2) : value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
export const percent = (value: number | undefined) => value === undefined ? "—" : value > 0 && value < .1 ? "<0.1%" : value < 100 && value > 99.9 ? ">99.9%" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
export const money = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "—" : Math.abs(value) >= 1e6 || value !== 0 && Math.abs(value) < 0.00005 ? `$${value.toExponential(3)}` : `$${value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
export function tokens(total: CostTotals | undefined, part?: typeof costParts[number]) {
  if (!total?.records) return "—";
  const value = part ? total.tokens[part] : tokenSum(total);
  if (!Number.isFinite(value) || !value && total.unknownTokens) return "—";
  return compactNumber(value);
}
export function tokenTitle(total: CostTotals | undefined, part?: typeof costParts[number]) {
  if (tokens(total, part) === "—") return "尚无可核对数据";
  return `${total!.unknownTokens ? "已确认部分：" : ""}${exact(part ? total!.tokens[part] : tokenSum(total!))} Token`;
}
export function amount(total: CostTotals, showEstimate = true) {
  const value = total.knownCost;
  if (!total.records || !Number.isFinite(value) || !value && total.unknownCost) return "—";
  return `${money(value)}${showEstimate && total.estimatedRecords ? "（含估算）" : ""}`;
}
export function amountTitle(total: CostTotals) {
  return amount(total) === "—" ? "尚无可核对的费用" : `${total.unknownCost ? "已知部分：" : ""}${exact(total.knownCost)} USD${total.estimatedRecords ? `；其中 ${exact(total.estimatedCost ?? 0)} USD 为公开参考价估算，非实际扣款；${total.estimateSources?.join("；") ?? ""}` : ""}`;
}
