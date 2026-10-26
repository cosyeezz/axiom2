import { createHash } from "node:crypto";
import { AppError } from "../shared/protocol.js";
/** Returns one hidden field in full. Conversations are never paged; other fields stay out of the response. */
export function messagePart(message, params) {
    if (Object.keys(params).some((key) => !["id", "field", "callId"].includes(key)) ||
        !["text", "thinking", "input"].includes(String(params.field)) ||
        (params.field === "input" ? typeof params.callId !== "string" : params.callId !== undefined))
        throw new AppError("INVALID_INPUT", "请选择消息正文、思考或指定调用参数");
    if (!message)
        throw new AppError("NOT_FOUND", "消息不存在或不属于此会话");
    const call = params.field === "input" ? message.calls?.find((value) => value.id === params.callId) : undefined;
    if (params.field === "input" && !call)
        throw new AppError("NOT_FOUND", "调用不存在或不属于此消息");
    const text = params.field === "input" ? call.input : params.field === "thinking" ? message.thinking ?? "" : message.text;
    return { text, totalLength: text.length, revision: createHash("sha256").update(text).digest("hex") };
}
//# sourceMappingURL=message-part.js.map