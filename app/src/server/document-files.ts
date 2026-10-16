import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { AppError, object, type Command, type Scope } from "../shared/protocol.js";
import { hasFileLink, localFileLink, type FilePreview } from "../shared/file-preview.js";
import type { ChatMessage } from "../shared/agent.js";
import type { Store } from "./storage.js";
const key = (p: string) => process.platform === "win32" ? p.toLowerCase() : p;
const forbidden = () => new AppError("FILE_PREVIEW_FORBIDDEN", "只能查看本会话助手回复中明确链接的本地文件，不支持符号链接或设备路径");
const languages: Record<string, string> = { js:"javascript", jsx:"javascript", mjs:"javascript", cjs:"javascript", ts:"typescript", tsx:"typescript", json:"json", css:"css", html:"xml", htm:"xml", xml:"xml", svg:"xml", py:"python", sh:"bash", bash:"bash", yml:"yaml", yaml:"yaml", toml:"toml", rs:"rust", go:"go", java:"java", c:"c", h:"c", cpp:"cpp", cs:"csharp", sql:"sql", ps1:"powershell" };
const binary = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "gz", "7z", "rar", "exe", "dll", "ico", "woff", "woff2", "ttf", "mp4", "mp3", "wav", "db", "sqlite", "wasm"]);
export function decodeFileText(bytes: Buffer): { text: string; encoding: string } | null {
  let encoding = "utf-8", start = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; start = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; start = 2; }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes.includes(0)) return null;
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(start)); }
  catch {
    if (encoding !== "utf-8") return null;
    try { encoding = "gb18030"; text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { return null; }
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return null;
  return { text, encoding: encoding.toUpperCase() + (encoding === "gb18030" ? " · 自动识别" : "") };
}
export class DocumentFiles {
  private reading = 0;
  private revealing = false;
  constructor(private store: Store, private message?: (scope: Scope, id: string) => ChatMessage | null,
    private reveal?: (path: string, directory: boolean, signal: AbortSignal) => Promise<void>) {}
  async command(c: Command, signal: AbortSignal = AbortSignal.timeout(10000)): Promise<FilePreview | null> {
    const p = object(c.params ?? {});
    if (Object.keys(p).some(k => !["messageId", "href"].includes(k)) || typeof p.messageId !== "string" || !p.messageId || p.messageId.length > 200 || typeof p.href !== "string")
      throw new AppError("INVALID_INPUT", "文件预览需要消息标识与文件链接");
    const ref = localFileLink(p.href);
    if (!ref) throw forbidden();
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! }, href = p.href, id = p.messageId;
    const authorize = () => {
      this.store.session(scope.workspaceId, scope.sessionId);
      const workspace = this.store.workspace(scope.workspaceId);
      if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
      const m = this.message?.(scope, id);
      if (m?.role !== "assistant" || !hasFileLink(m.text, href)) throw forbidden();
      return workspace;
    };
    const workspace = authorize();
    const path = resolve(workspace.path, ref.path);
    if (!isAbsolute(path) || path.startsWith("\\\\") || (process.platform === "win32" && path.split(/[\\/]/).some(part => /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part)))) throw forbidden();
    const inspect = async () => {
      if (key(await realpath(path)) !== key(path)) throw forbidden();
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.isFile() && stat.nlink !== 1) throw forbidden();
      return stat;
    };
    if (this.reading >= 4) throw new AppError("LIMIT", "文件预览请求过多，请稍后重试");
    this.reading++;
    try {
      const before = await inspect();
      signal.throwIfAborted();
      authorize();
      if (c.op === "files.reveal") {
        if (this.revealing) throw new AppError("LIMIT", "正在打开文件位置，请稍候");
        if (!this.reveal) throw new AppError("FILE_REVEAL_UNAVAILABLE", "当前服务不支持打开本地位置");
        this.revealing = true;
        try { await this.reveal(path, before.isDirectory(), signal); } finally { this.revealing = false; }
        return null;
      }
      const result: FilePreview = { name: basename(path), path, size: before.size, modified: before.mtime.toISOString(), kind: "unsupported", line: ref.line };
      if (before.isDirectory()) return { ...result, reason: "这是一个文件夹，可打开本地位置浏览。" };
      const ext = extname(path).slice(1).toLowerCase();
      if (binary.has(ext)) return { ...result, reason: "此格式暂不支持内嵌预览，可在本地位置用对应应用打开。" };
      const media = ["png", "jpg", "jpeg", "gif", "webp", "pdf"].includes(ext), limit = media ? 8 * 1024 * 1024 : 1024 * 1024;
      if (before.size > limit) return { ...result, reason: `文件超过 ${media ? "8" : "1"} MiB 预览上限，请打开本地位置查看。` };
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size > limit) throw forbidden();
        const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1)); let length = 0;
        while (length < buffer.length) { const r = await handle.read(buffer, length, buffer.length - length, length); if (!r.bytesRead) break; length += r.bytesRead; }
        const after = await inspect(), final = await handle.stat(); signal.throwIfAborted(); authorize();
        if (after.dev !== info.dev || after.ino !== info.ino || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs || length !== info.size)
          throw new AppError("FILE_CHANGED", "文件在读取期间发生变化，请重新加载");
        const bytes = buffer.subarray(0, length);
        const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
          : /^GIF8[79]a$/.test(bytes.subarray(0,6).toString()) ? "image/gif"
          : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp"
          : bytes.subarray(0,5).toString() === "%PDF-" ? "application/pdf" : undefined;
        if (mime) return { ...result, kind: mime === "application/pdf" ? "pdf" : "image", mimeType: mime, data: bytes.toString("base64") };
        if (media) return { ...result, reason: "文件内容与格式不符，无法预览。" };
        const decoded = decodeFileText(bytes);
        if (!decoded) return { ...result, reason: "无法可靠解码此文件，或文件包含二进制内容。请在本地应用中查看。" };
        return { ...result, ...decoded, kind: ["md", "markdown", "mdown"].includes(ext) ? "markdown" : languages[ext] ? "code" : "text", language: languages[ext] };
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      throw new AppError("FILE_READ_FAILED", code === "ENOENT" || code === "ENOTDIR" ? "文件不存在或已移动" : c.op === "files.reveal" ? "无法打开本地位置，请检查桌面环境与文件权限" : "无法读取文件，请检查文件权限后重试");
    } finally { this.reading--; }
  }
}
