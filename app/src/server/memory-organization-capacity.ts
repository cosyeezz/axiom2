import { Buffer } from "node:buffer";
import { AppError } from "../shared/protocol.js";

/** No character/token ratio. UTF-8 byte lengths are a deliberately conservative
 * input/output reservation for byte-based model tokenizers, plus framing slack.
 * This may reject a request a provider tokenizer could fit; never truncate it.
 * Providers can still stop at a stricter limit; incomplete output never publishes. */
export function organizationModelBudget(input: { prompt: string; systemPrompt?: string; outputReserve?: number }, model: { contextWindow: number; maxTokens: number }) {
  const inputReservation = Buffer.byteLength(input.prompt, "utf8") + Buffer.byteLength(input.systemPrompt ?? "", "utf8") + 4096;
  const reserve = input.outputReserve ?? 1024;
  if (!Number.isSafeInteger(reserve) || reserve < 1 || !Number.isFinite(model.contextWindow) || !Number.isFinite(model.maxTokens))
    throw new AppError("MEMORY_LIMIT", "整理模型容量配置无效，未发送请求");
  const maxTokens = Math.floor(Math.min(model.maxTokens, model.contextWindow - inputReservation));
  if (maxTokens < reserve) throw new AppError("MEMORY_LIMIT", "整理模型上下文或完整输出容量不足（保守UTF-8字节预留），未截断原标题或发送请求");
  return { maxTokens };
}
