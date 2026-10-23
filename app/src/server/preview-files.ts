import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const key = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
export const previewMime: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml", ".csv": "text/csv", ".map": "application/json", ".wasm": "application/wasm",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".pdf": "application/pdf",
};
export function previewPath(root: string, name: string) {
  if (!name || /[\\:\x00-\x1f\x7f]/.test(name) || isAbsolute(name) || name.split("/").some(p => p.startsWith(".") && p !== "." && p !== "..")) throw Error("预览资源路径不允许");
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) throw Error("预览资源超出授权目录");
  return path;
}
export async function readPreviewFile(root: string, name: string, signal: AbortSignal, limit = 16 * 1024 * 1024) {
  signal.throwIfAborted();
  const path = previewPath(root, name);
  if (key(await realpath(root)) !== key(root) || key(await realpath(path)) !== key(path)) throw Error("预览资源不能使用符号链接");
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit) throw Error("预览资源不是普通文件或超过大小上限");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size || info.nlink !== 1 || !info.isFile()) throw Error("预览资源已改变");
    const buffer = Buffer.alloc(info.size + 1); let at = 0;
    while (at < buffer.length) { signal.throwIfAborted(); const r = await handle.read(buffer, at, buffer.length - at, at); if (!r.bytesRead) break; at += r.bytesRead; }
    const after = await lstat(path), final = await handle.stat();
    if (key(await realpath(path)) !== key(path) || after.nlink !== 1 || after.dev !== info.dev || after.ino !== info.ino || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs || at !== info.size) throw Error("预览资源读取期间改变");
    signal.throwIfAborted(); return buffer.subarray(0, at);
  } finally { await handle.close(); }
}
