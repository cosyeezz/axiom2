import { createHash } from "node:crypto";
import type { ChatMessage, MessagePart } from "../shared/agent.js";
import { AppError } from "../shared/protocol.js";

/** UTF-16 offsets match existing message/result contracts; pages never split a surrogate pair. */
export function messagePart(message: ChatMessage | null, params: Record<string, unknown>): MessagePart {
  if (Object.keys(params).some((key) => !["id", "field", "callId", "offset", "revision"].includes(key)) ||
    !["text", "thinking", "input"].includes(String(params.field)) ||
    (params.field === "input" ? typeof params.callId !== "string" : params.callId !== undefined))
    throw new AppError("INVALID_INPUT", "请选择消息正文、思考或指定调用参数");
  if (!message) throw new AppError("NOT_FOUND", "消息不存在或不属于此会话");
  const call = params.field === "input" ? message.calls?.find((value) => value.id === params.callId) : undefined;
  if (params.field === "input" && !call) throw new AppError("NOT_FOUND", "调用不存在或不属于此消息");
  const text = params.field === "input" ? call!.input : params.field === "thinking" ? message.thinking ?? "" : message.text;
  const revision = createHash("sha256").update(text).digest("hex");
  const offset = params.offset ?? 0;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 ||
    (params.revision !== undefined && typeof params.revision !== "string") || (Number(offset) > 0 && !params.revision))
    throw new AppError("INVALID_INPUT", "消息分页位置或修订无效");
  if (params.revision !== undefined && params.revision !== revision)
    throw new AppError("REVISION_CONFLICT", "记录已更新，请重新读取");
  const start = Number(offset);
  if (start > text.length) throw new AppError("INVALID_INPUT", "消息分页位置超出正文长度");
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? "") && /[\uD800-\uDBFF]/.test(text[start - 1]))
    throw new AppError("INVALID_INPUT", "分页位置不能拆分字符");
  let end = Math.min(text.length, start + 16000);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return { text: text.slice(start, end), offset: start, totalLength: text.length, nextOffset: end < text.length ? end : null, revision };
}
