// Only a bounded, credential-redacted message crosses IPC or enters persisted UI state.
// Never serialize the error object, request headers, response body or stack wholesale.
export function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message
    : typeof error === "string" ? error : "";
  const safe = message
    .replace(/\b(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/([?&](?:api[-_]?key|access[-_]?token|token|key|secret|signature)=)[^\s&#"']+/gi, "$1[已隐藏]")
    .replace(/\b(Bearer|Basic)\s+[a-z0-9._~+\/-]+=*/gi, "$1 [已隐藏]")
    .replace(/(["']?(?:authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|key|token|secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;\r\n}]+)/gi, "$1[已隐藏]")
    .replace(/\bsk-[a-z0-9_-]+/gi, "[已隐藏]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  return safe ? safe.slice(0, 2000) + (safe.length > 2000 ? "…（错误信息已截断）" : "") : fallback;
}

export function modelRequestError(error: unknown) {
  return `模型请求失败：${errorMessage(error, "未收到具体错误原因。")}`;
}
