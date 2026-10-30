import { markdown, markdownTokens } from "./markdown.js";
import type { HtmlResource } from "./html-preview.js";

export type FileReference = { messageId: string; href: string; skillId?: never } | { skillId: string; messageId?: never; href?: never };
export interface FileSaveResult { revision: string; size: number; modified: string }
export interface ArchiveEntry { name: string; size: number; directory: boolean }
export interface OfficePart { name: string; text: string }
export interface FilePreview {
  name: string; path: string; size: number; modified: string;
  kind: "markdown" | "code" | "text" | "image" | "pdf" | "audio" | "video" | "archive" | "office" | "unsupported";
  entries?: ArchiveEntry[]; archiveMember?: string; officeParts?: OfficePart[]; directory?: boolean;
  language?: string; text?: string; encoding?: string; data?: string; mimeType?: string; reason?: string; line?: number;
  resources?: HtmlResource[]; resourceNotice?: string;
  revision?: string; editable?: boolean; editReason?: string;
}
/** A local link, never a remote, device, anchor-only or executable URL. */
export function localFileLink(href: string): { path: string; line?: number; fragment?: string } | null {
  if (!href || href.length > 4096 || /[\x00-\x1f\x7f]/.test(href) || /^[\u200b\u200c\ufeff]*#/.test(href)) return null;
  // Generated links can carry an invisible separator before an absolute path.
  // Strip only that prefix; relative names and characters inside filenames stay literal.
  let path = href.replace(/^[\u200b\u200c\ufeff]+(?=[\\/]|[a-z]:[\\/]|file:\/\/)/i, "");
  if (/^file:\/\//i.test(path)) {
    try { const url = new URL(path); if ((url.hostname && url.hostname !== "localhost") || url.search) return null; path = url.pathname + url.hash; } catch { return null; }
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) && !/^[^:/\\]+\.[a-z\d]+:\d+(?::\d+)?$/i.test(path.split("#")[0])) return null;
  path = path.replace(/\\/g, "/");
  // Split URL syntax before decoding: %23 belongs to the filename, not a fragment.
  const hash = path.indexOf("#");
  let fragment = hash < 0 ? "" : path.slice(hash + 1);
  if (hash >= 0) path = path.slice(0, hash);
  if (path.includes("?")) return null;
  const suffix = path.match(/:(\d+)(?::\d+)?$/);
  if (suffix) path = path.slice(0, -suffix[0].length);
  try { path = decodeURIComponent(path).replace(/\\/g, "/"); fragment = decodeURIComponent(fragment); } catch { return null; }
  if (!path || path.startsWith("//") || /[\x00-\x1f\x7f]/.test(path + fragment) || /:/.test(path.replace(/^[a-z]:/i, ""))) return null;
  const selector = fragment.match(/^L(\d+)(?:C\d+)?$/i);
  const line = selector ? Number(selector[1]) : suffix ? Number(suffix[1]) : undefined;
  return { path, ...(line && Number.isSafeInteger(line) ? { line } : {}), ...(fragment && !selector ? { fragment } : {}) };
}
export function hasFileLink(text: string, href: string): boolean {
  let found = false;
  markdown.walkTokens(markdownTokens(text), token => { if (token.type === "link" && token.href === href) found = true; });
  return found;
}
