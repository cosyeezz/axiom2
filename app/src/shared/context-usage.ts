/** Context occupancy, not cumulative or billable request tokens. */
export type ContextMeasurementSource = "model-usage" | "message-estimate";
export interface ContextMeasurement {
  tokens: number;
  source: ContextMeasurementSource;
}
export const contextSourceLabel = (source?: ContextMeasurementSource) =>
  source === "model-usage" ? "模型用量校准＋新增消息估算"
    : source === "message-estimate" ? "按当前有效消息估算，待模型用量校准"
    : "历史估算（来源未记录）";
