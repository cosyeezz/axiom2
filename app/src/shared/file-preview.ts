import { markdown } from "./markdown.js";

export interface FileReference { messageId: string; href: string }
export interface FilePreview {
  name: string; path: string; size: number; modified: string;
  kind: "markdown" | "code" | "text" | "image" | "pdf" | "unsupported";
  language?: string; text?: string; encoding?: string; data?: string; mimeType?: string; reason?: string; line?: number;
}
/** A local link, never a remote, device, anchor-only or executable URL. */
export function localFileLink(href: string): { path: string; line?: number } | null {
  if (!href || href.length > 4096 || /[\x00-\x1f\x7f]/.test(href) || href.startsWith("#")) return null;
  let path = href;
  if (/^file:\/\//i.test(path)) {
    try { const url = new URL(path); if ((url.hostname && url.hostname !== "localhost") || url.search) return null; path = url.pathname + url.hash; } catch { return null; }
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) && !/^[^:/\\]+\.[a-z\d]+:\d+(?::\d+)?$/i.test(path)) return null;
  path = path.replace(/\\/g, "/");
  const suffix = path.match(/(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?)$/i);
  const line = suffix ? Number(suffix[1] ?? suffix[2]) : undefined;
  if (suffix) path = path.slice(0, -suffix[0].length);
  // Split URL syntax before decoding: %23 belongs to the filename, not a fragment.
  if (/[?#]/.test(path)) return null;
  try { path = decodeURIComponent(path).replace(/\\/g, "/"); } catch { return null; }
  if (!path || path.startsWith("//") || /[\x00-\x1f\x7f]/.test(path) || /:/.test(path.replace(/^[a-z]:/i, ""))) return null;
  return { path, ...(line && Number.isSafeInteger(line) ? { line } : {}) };
}
export function hasFileLink(text: string, href: string): boolean {
  let found = false;
  markdown.walkTokens(markdown.lexer(text), token => { if (token.type === "link" && token.href === href) found = true; });
  return found;
}
