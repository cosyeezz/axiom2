import { saveTextFile, textRevision } from "./file-edit.js";
import { previewFilePath } from "./preview-path.js";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { AppError, object, type Command, type Scope } from "../shared/protocol.js";
import { hasFileLink, localFileLink, type FilePreview, type FileSaveResult } from "../shared/file-preview.js";
import type { ChatMessage } from "../shared/agent.js";
import type { Store } from "./storage.js";
import { htmlResources } from "./html-preview.js";
import { previewArchive } from "./preview-archive.js";
import { archiveExtension, officeExtension, mediaExtension, mediaMime, officePreview } from "./preview-formats.js";
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
  private async save(c: Command, signal: AbortSignal): Promise<FileSaveResult> {
    const p = object(c.params ?? {});
    if (Object.keys(p).some(key => !["messageId", "href", "skillId", "revision", "text"].includes(key)) ||
      typeof p.revision !== "string" || !/^[a-f0-9]{64}$/.test(p.revision) || typeof p.text !== "string")
      throw new AppError("INVALID_INPUT", "保存文件需要原始修订与文本内容。");
    const params = p.skillId !== undefined ? { skillId: p.skillId } : { messageId: p.messageId, href: p.href };
    if (p.skillId !== undefined && (p.messageId !== undefined || p.href !== undefined)) throw forbidden();
    const read = () => this.command({ ...c, op: "files.document", params }, signal) as Promise<FilePreview>;
    const file = await read();
    const authorize = async () => {
      const current = await read();
      if (current.path !== file.path || !current.editable || current.revision !== p.revision)
        throw new AppError("REVISION_CONFLICT", "文件已改变或不可编辑，请保留编辑并重新读取最新内容。");
    };
    try { return await saveTextFile(file.path, p.revision, p.text, p.skillId !== undefined, authorize, signal); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("FILE_SAVE_FAILED", "文件保存失败，当前编辑已保留，请检查文件权限后重试。");
    }
  }
  private reading = 0;
  private revealing = false;
  constructor(private store: Store, private message?: (scope: Scope, id: string) => ChatMessage | null,
    private reveal?: (path: string, directory: boolean, signal: AbortSignal) => Promise<void>,
    private skillPath?: (scope: Scope, id: string) => Promise<string>) {}
  async command(c: Command, signal: AbortSignal = AbortSignal.timeout(10000)): Promise<FilePreview | FileSaveResult | null> {
    if (c.op === "files.save") return this.store.external(c, () => this.save(c, signal)) as Promise<FileSaveResult>;
    const p = object(c.params ?? {});
    const skill = typeof p.skillId === "string" && p.skillId.length > 0 && p.skillId.length <= 200;
    const member = c.op === "files.document" && typeof p.entry === "string" ? p.entry : undefined;
    if (p.entry !== undefined && (!member || member.length > 1024 || typeof p.archiveRevision !== "string" || !/^[a-f0-9]{64}$/.test(p.archiveRevision))) throw new AppError("INVALID_INPUT", "读取成员需要压缩包修订和有效名称");
    if (Object.keys(p).some(k => !(skill ? ["skillId"] : c.op === "files.document" ? ["messageId", "href", "entry", "archiveRevision"] : ["messageId", "href"]).includes(k)) || !skill && (typeof p.messageId !== "string" || !p.messageId || p.messageId.length > 200 || typeof p.href !== "string"))
      throw new AppError("INVALID_INPUT", "文件预览需要消息链接或技能标识");
    const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! }, href = p.href as string, id = p.messageId as string;
    this.store.session(scope.workspaceId, scope.sessionId);
    const source = skill ? await this.skillPath?.(scope, p.skillId as string) : undefined;
    const ref = skill ? source ? { path: source } : null : localFileLink(href);
    if (!ref) throw forbidden();
    const authorize = () => {
      this.store.session(scope.workspaceId, scope.sessionId);
      const workspace = this.store.workspace(scope.workspaceId);
      if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
      if (!skill) {
        const m = this.message?.(scope, id);
        if (m?.role !== "assistant" || !hasFileLink(m.text, href)) throw forbidden();
      }
      return workspace;
    };
    const workspace = authorize();
    let path = resolve(workspace.path, ref.path);
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
      path = await previewFilePath(path);
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
      let result: FilePreview = { name: basename(path), path, size: before.size, modified: before.mtime.toISOString(), kind: "unsupported", line: ref.line };
      if (before.isDirectory()) return { ...result, directory: true, reason: "这是一个文件夹；可打开本地位置，或确认后启动其中的网页项目。" };
      let ext = extname(path).slice(1).toLowerCase();
      const archive = archiveExtension.test(path), office = officeExtension.test(path), playable = mediaExtension.test(path);
      if (member && !archive) throw new AppError("INVALID_INPUT", "只能从压缩包读取成员");
      if (binary.has(ext) && !archive && !office && !playable) return { ...result, reason: "此格式尚无内嵌解析器；旧版 Office、加密文档等可用本地应用打开。" };
      const media = ["png", "jpg", "jpeg", "gif", "webp", "pdf"].includes(ext);
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) throw forbidden();
        const buffer = Buffer.alloc(info.size + 1); let length = 0;
        while (length < buffer.length) { signal.throwIfAborted(); const r = await handle.read(buffer, length, buffer.length - length, length); if (!r.bytesRead) break; length += r.bytesRead; }
        const after = await inspect(), final = await handle.stat(); signal.throwIfAborted(); authorize();
        if (after.dev !== info.dev || after.ino !== info.ino || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs || length !== info.size)
          throw new AppError("FILE_CHANGED", "文件在读取期间发生变化，请重新加载");
        let bytes: Buffer = buffer.subarray(0, length);
        if (archive) {
          const revision = textRevision(bytes);
          if (member && p.archiveRevision !== revision) throw new AppError("REVISION_CONFLICT", "压缩包已改变，请返回目录并重新加载");
          try {
            const parsed = await previewArchive(bytes, result.name, name => name === member, signal);
            signal.throwIfAborted(); authorize();
            if (!member) return { ...result, kind: "archive", entries: parsed.entries, revision, resourceNotice: "只读目录；按需在内存中展开，不写入磁盘、不执行成员。" };
            const content = parsed.contents.get(member);
            if (!content) throw Error("压缩包成员不存在或为文件夹");
            bytes = content; ext = extname(member).slice(1).toLowerCase();
            result = { ...result, name: basename(member), size: bytes.length, archiveMember: member, revision, editable: false };
          } catch (error) { signal.throwIfAborted(); authorize(); return { ...result, reason: (error as Error).message }; }
        }
        if (officeExtension.test(result.name)) {
          try { const office = await officePreview(bytes, result.name, signal); signal.throwIfAborted(); authorize(); return { ...result, ...office }; }
          catch (error) { signal.throwIfAborted(); authorize(); return { ...result, reason: (error as Error).message }; }
        }
        if (mediaExtension.test(result.name)) {
          const format = mediaMime(bytes, result.name);
          return format ? { ...result, ...format, data: bytes.toString("base64") } : { ...result, reason: "音视频内容与格式不符，无法预览。" };
        }
        if (member && (archiveExtension.test(result.name) || binary.has(ext))) return { ...result, reason: "此成员为嵌套压缩包或暂未解析的二进制文件，不递归展开。" };
        const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
          : /^GIF8[79]a$/.test(bytes.subarray(0,6).toString()) ? "image/gif"
          : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp"
          : bytes.subarray(0,5).toString() === "%PDF-" ? "application/pdf" : undefined;
        if (mime) return { ...result, kind: mime === "application/pdf" ? "pdf" : "image", mimeType: mime, data: bytes.toString("base64") };
        if (media) return { ...result, reason: "文件内容与格式不符，无法预览。" };
        const decoded = decodeFileText(bytes);
        if (!decoded) return { ...result, reason: "无法可靠解码此文件，或文件包含二进制内容。请在本地应用中查看。" };
        const companions = !member && ["html", "htm"].includes(ext) ? await htmlResources(path, decoded.text, authorize, signal) : {};
        signal.throwIfAborted(); authorize();
        const editable = !member && decoded.encoding === "UTF-8" && bytes.length <= (skill ? 128 * 1024 : 1024 * 1024);
        return { ...result, ...decoded, ...companions, revision: textRevision(bytes), editable,
          ...(!editable ? { editReason: member ? "压缩包成员仅供只读预览。" : decoded.encoding !== "UTF-8" ? "此编码仅支持预览，编辑需要 UTF-8 文本。" : skill ? "技能文件超过 128 KiB 编辑上限。" : "文件超过 1 MiB 编辑上限，仅供只读预览。" } : {}),
          kind: !member && ["md", "markdown", "mdown"].includes(ext) ? "markdown" : languages[ext] ? "code" : "text", language: languages[ext] };
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      throw new AppError("FILE_READ_FAILED", code === "ENOENT" || code === "ENOTDIR" ? "文件不存在或已移动" : c.op === "files.reveal" ? "无法打开本地位置，请检查桌面环境与文件权限" : "无法读取文件，请检查文件权限后重试");
    } finally { this.reading--; }
  }
}
