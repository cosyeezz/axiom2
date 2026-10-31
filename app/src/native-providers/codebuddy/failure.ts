type ObjectValue = Record<string, unknown>;
export const codeBuddyObject = (value: unknown): ObjectValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;
const details = (value: unknown) => codeBuddyObject(codeBuddyObject(value)?.error) ?? codeBuddyObject(value);
const nonOverflowCodes = [401, 403, 429, 6004, 11102];
const overflowCodes = ["context_length_exceeded", "model_context_window_exceeded", "prompt_too_long", "input_too_long"];
export function codeBuddyBusinessCode(value: unknown): number | undefined {
  const codes = [codeBuddyObject(value)?.code, details(value)?.code].flatMap(code => {
    const number = typeof code === "number" ? code : typeof code === "string" && /^\d{1,6}$/.test(code) ? Number(code) : undefined;
    return number !== undefined && Number.isSafeInteger(number) && number !== 0 ? [number] : [];
  });
  return codes.find(code => nonOverflowCodes.includes(code)) ?? codes[0];
}
export function codeBuddyOverflowCode(value: unknown): boolean {
  return [codeBuddyObject(value), details(value)].some(error => [error?.code, error?.type].some(code => typeof code === "string" && overflowCodes.includes(code)));
}
export function codeBuddyFailure(httpStatus: number, value: unknown) {
  const code = codeBuddyBusinessCode(value), object = codeBuddyObject(value);
  const status = code === 6004 ? 429 : httpStatus >= 400 ? httpStatus
    : code === 11102 ? 403 : code !== undefined && code >= 400 && code <= 599 ? code
      : object?.error || code !== undefined || details(value)?.message ? 400 : 502;
  const description = details(value)?.message ?? details(value)?.msg;
  const overflow = ![401, 403, 429].includes(status) && !(code !== undefined && nonOverflowCodes.includes(code)) &&
    (codeBuddyOverflowCode(value) || typeof description === "string" && /^(?:prompt (?:is )?too long\b|prompt exceeds max length\b|your input exceeds the context window\b|this model's maximum context length\b|input length .+ exceeds (?:the )?(?:model's )?maximum context length\b)/i.test(description));
  const message = status === 429 ? "CodeBuddy 请求过于频繁或额度不足，请稍后重试并检查账号额度（code 6004 / HTTP 429）。"
    : code === 11102 ? "CodeBuddy 当前账号无法使用此模型（code 11102），请选择其他模型。"
    : status === 401 || status === 403 ? `CodeBuddy 认证失败（HTTP ${status}），请重新登录。`
    : overflow ? "CodeBuddy 上下文超出模型窗口（context_length_exceeded），请压缩会话或减少输入。"
    : `CodeBuddy 请求失败（HTTP ${status}${code === undefined ? "" : `，code ${code}`}）。`;
  return { status, businessCode: code, category: status === 429 ? "quota" : code === 11102 ? "permission" : status === 401 || status === 403 ? "auth" : overflow ? "context" : "upstream",
    error: { message, type: "codebuddy_error", ...(overflow ? { code: "context_length_exceeded" } : {}) } };
}
export class CodeBuddyServiceError extends Error {
  readonly info: ReturnType<typeof codeBuddyFailure>;
  constructor(status: number, value: unknown) { const info = codeBuddyFailure(status, value); super(info.error.message); this.info = info; }
}
const messages = {
  request: "CodeBuddy 请求参数或上下文无效；未发送请求。",
  target: "CodeBuddy 请求目标、模型、身份或受保护参数被修改；未发送请求。",
  thinking: "CodeBuddy 不支持所请求的思考设置；未静默改变设置。",
  tool: "CodeBuddy 工具关联、参数 JSON 或声明的 JSON Schema 无效；未执行工具。",
  response: "CodeBuddy 未返回有效的原生流式响应。",
  stream: "CodeBuddy 流事件格式无效或超过安全上限。",
  terminal: "CodeBuddy 流缺失完整成功终态、被截断或遭拒绝；未执行工具。",
  usage: "CodeBuddy 返回了无效的用量计数。",
} as const;
export class CodeBuddyProtocolError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}
