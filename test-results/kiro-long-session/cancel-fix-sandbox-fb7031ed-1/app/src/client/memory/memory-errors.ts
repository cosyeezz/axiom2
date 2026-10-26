export function publicMemoryError(value: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[凭据已隐藏]")
    .replace(/((?:api[-_ ]?key|authorization|bearer|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;，；]+)/gi, "$1[凭据已隐藏]")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^,;，；\r\n]{20,}/g, "[本地路径]")
    .replace(/(^|[\s(])\/(?:[^/\s,;，；]+\/){2,}[^\s,;，；)]*/g, "$1[本地路径]");
  const chars = Array.from(normalized || "整理失败");
  return chars.length > 500 ? `${chars.slice(0, 500).join("")}…` : chars.join("");
}
