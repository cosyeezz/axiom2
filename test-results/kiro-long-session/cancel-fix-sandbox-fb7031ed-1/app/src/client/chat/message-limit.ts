// Shared by live composer feedback and the last check before creating a request.
export const messageTextLimit = 12000;
export function messageLengthError(text: string) {
  return text.length > messageTextLimit
    ? `消息共 ${text.length.toLocaleString("zh-CN")} 字，超过 12,000 字上限。内容已完整保留，请缩短或分开发送。`
    : "";
}
