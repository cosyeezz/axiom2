import { DocumentFiles } from "./document-files.js";
import type { FilePreview } from "../shared/file-preview.js";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { AppError, attachmentInput, attachmentLimits, attachmentName, object, type Attachment, type Command, type FileCompletion, type ImageAttachment, type PickedAttachment, type Scope } from "../shared/protocol.js";
import type { Store } from "./storage.js";
import type { ChatMessage } from "../shared/agent.js";
import { hasMarkdownImage, markdownImagePath } from "../shared/markdown.js";

const exec = promisify(execFile);
/** Public SDK agent directory plus explicit PATH entries; never execute a project-local fd. */
export async function findFd(): Promise<string> {
  const names = process.platform === "win32" ? ["fd.exe", "fdfind.exe"] : ["fd", "fdfind"];
  const dirs = [join(getAgentDir(), "bin"), ...(process.env.PATH ?? "").split(delimiter).filter(isAbsolute)];
  for (const dir of new Set(dirs)) for (const name of names) {
    const candidate = join(dir, name);
    try {
      const { stdout } = await exec(candidate, ["--version"], { timeout: 1500, maxBuffer: 4096, windowsHide: true });
      if (/^(?:fd|fdfind)\s+\d/m.test(stdout)) return candidate;
    } catch { /* Try next installed candidate; no automatic downloads. */ }
  }
  throw new AppError("FILE_COMPLETION_UNAVAILABLE", "原生 @ 文件补全需要 fd；请安装 fd（或 fdfind）到 PATH，或先通过 pi 安装其工具。");
}

const pathKey = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
const scopeKey = (scope: Scope) => JSON.stringify([scope.workspaceId, scope.sessionId]);
const denied = () => new AppError("IMAGE_PREVIEW_FORBIDDEN", "只能预览本会话上传或明确选择的图片，不能读取其他路径或符号链接");

export class Files {
  private documents: DocumentFiles;
  private fd?: Promise<string>;
  private searching = 0;
  private previewing = 0;
  constructor(private readonly store: Store,
    private readonly message?: (scope: Scope, id: string) => ChatMessage | null,
    reveal?: (path: string, directory: boolean, signal: AbortSignal) => Promise<void>) {
    this.documents = new DocumentFiles(store, message, reveal);
    store.db.exec(`CREATE TABLE IF NOT EXISTS picked_images(
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      path TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(sessionId,path))`);
  }

  /** Trusted native picker only: never expose registration as a client command. */
  registerPicked(scope: Scope, items: readonly PickedAttachment[]) {
    this.authorize(scope);
    const save = this.store.db.prepare("INSERT INTO picked_images(sessionId,path,name) VALUES(?,?,?) ON CONFLICT(sessionId,path) DO UPDATE SET name=excluded.name");
    for (const item of items) if (item.kind === "image") save.run(scope.sessionId, pathKey(resolve(item.path)), item.name);
  }

  private authorize(scope: Scope) {
    this.store.session(scope.workspaceId, scope.sessionId);
    if (!this.store.workspace(scope.workspaceId).authorized)
      throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
  }

  private async preview(scope: Scope, p: Record<string, unknown>, reference?: () => string): Promise<ImageAttachment> {
    const id = p.id === undefined ? "imag1" : p.id;
    if (typeof id !== "string" || !/^imag[1-9]\d{0,8}$/.test(id) ||
      typeof p.path !== "string" || !isAbsolute(p.path) || p.path.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(p.path) || p.path.split(/[\\/]/).includes(".."))
      throw new AppError("INVALID_INPUT", "图片预览需要有效绝对路径与 imag1 等图片编号");
    const path = resolve(p.path), key = pathKey(path);
    const dir = resolve(this.store.root, "attachments", scope.workspaceId, scope.sessionId);
    let name = reference ? reference() : this.store.db.prepare("SELECT name FROM picked_images WHERE sessionId=? AND path=?").get(scope.sessionId, key)?.name;
    let uploaded = false;
    if (pathKey(dirname(path)) === pathKey(dir)) {
      // A directory prefix alone is not provenance: require an actual committed upload.
      const row = this.store.db.prepare(`SELECT response FROM external_requests
        WHERE state='committed' AND scope=? AND json_valid(response)
        AND json_extract(response,'$.path')=? LIMIT 1`).get(scopeKey(scope), path);
      if (row) {
        const attachment = JSON.parse(String(row.response)) as Attachment;
        name = attachment.name;
        uploaded = true;
      }
    }
    if (!name) throw denied();
    if (this.previewing >= 4) throw new AppError("LIMIT", "图片预览请求过多，请稍后重试");
    this.previewing++;
    try {
      const checkPath = async () => {
        if (uploaded) {
          // Trust the configured root, but no symlinks/junctions below it (including ancestors).
          let current = await realpath(this.store.root);
          for (const part of ["attachments", scope.workspaceId, scope.sessionId, basename(path)]) {
            current = join(current, part);
            if ((await lstat(current)).isSymbolicLink()) throw denied();
          }
          if (pathKey(await realpath(path)) !== pathKey(current)) throw denied();
        } else if (pathKey(await realpath(path)) !== key) throw denied();
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw denied();
        return info;
      };
      const before = await checkPath();
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) throw denied();
        if (info.size > attachmentLimits.uploadBytes)
          throw new AppError("IMAGE_TOO_LARGE", "图片预览单张最多 10 MiB");
        // Bounded even if another local process grows the file after stat.
        const buffer = Buffer.alloc(Math.min(info.size + 1, attachmentLimits.uploadBytes + 1));
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        const after = await checkPath(), final = await handle.stat();
        if (final.size > attachmentLimits.uploadBytes || length > attachmentLimits.uploadBytes)
          throw new AppError("IMAGE_TOO_LARGE", "图片预览单张最多 10 MiB");
        if (after.dev !== info.dev || after.ino !== info.ino || final.size !== info.size ||
          final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs || length !== info.size)
          throw new AppError("IMAGE_CHANGED", "图片在读取期间发生变化，请重试");
        const bytes = buffer.subarray(0, length);
        const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
          : ["GIF87a", "GIF89a"].some((signature) => bytes.subarray(0, 6).equals(Buffer.from(signature))) ? "image/gif"
          : bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP")) ? "image/webp" : null;
        if (!mimeType) throw new AppError("INVALID_IMAGE", "文件不是支持的图片：仅可预览 PNG/JPEG/GIF/WebP");
        this.authorize(scope); // Session deletion/authorization changes may overtake filesystem reads.
        reference?.(); // The bound assistant image must still exist after the asynchronous read.
        return { id, name: String(name), mimeType, data: bytes.toString("base64") };
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") throw new AppError("IMAGE_NOT_FOUND", "图片文件不存在或已移动");
      if (code === "ELOOP") throw denied();
      throw new AppError("IMAGE_READ_FAILED", "图片文件无法读取，请检查文件访问权限");
    } finally { this.previewing--; }
  }

  async command(c: Command, signal?: AbortSignal): Promise<FileCompletion | Attachment | ImageAttachment | FilePreview | null> {
    if (c.op === "files.document" || c.op === "files.reveal") return this.documents.command(c, signal);
    const session = this.store.session(c.workspaceId, c.sessionId);
    const workspace = this.store.workspace(session.workspaceId);
    if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    const p = object(c.params ?? {});
    if (c.op === "files.markdownImage") {
      if (Object.keys(p).some((key) => !["messageId", "href"].includes(key)) ||
        typeof p.messageId !== "string" || !p.messageId || p.messageId.length > 200 ||
        typeof p.href !== "string")
        throw new AppError("INVALID_INPUT", "回复图片需要消息标识与图片引用");
      const href = p.href, messageId = p.messageId, path = markdownImagePath(href);
      if (!path || !isAbsolute(path)) throw new AppError("INVALID_INPUT", "回复图片需要本地绝对路径");
      const scope = { workspaceId: workspace.id, sessionId: session.id };
      const reference = () => {
        const message = this.message?.(scope, messageId);
        if (message?.role !== "assistant" || !hasMarkdownImage(message.text, href))
          throw new AppError("IMAGE_PREVIEW_FORBIDDEN", "只能读取此会话助手回复中明确引用的图片");
        return basename(path);
      };
      return this.preview(scope, { path }, reference);
    }
    if (c.op === "files.preview") return this.preview({ workspaceId: workspace.id, sessionId: session.id }, p);
    if (c.op === "files.upload") {
      // Receipt makes explicit retries idempotent; completing/searching never records mutations.
      return this.store.external(c, async () => {
        const name = attachmentName(p.name);
        if (typeof p.data !== "string" || p.data.length > Math.ceil(attachmentLimits.uploadBytes / 3) * 4 ||
          p.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))
          throw new AppError("INVALID_UPLOAD", "文件须为有效 base64，单个文件最多 10 MiB");
        const bytes = Buffer.from(p.data, "base64");
        if (bytes.length > attachmentLimits.uploadBytes || bytes.toString("base64") !== p.data)
          throw new AppError("INVALID_UPLOAD", "文件须为有效 base64，单个文件最多 10 MiB");
        const dir = resolve(this.store.root, "attachments", workspace.id, session.id);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        // Neither folder paths nor original basenames select an on-disk destination.
        const extension = extname(name);
        const file = join(dir, randomUUID() + (/^\.[a-z0-9]{1,16}$/i.test(extension) ? extension : ""));
        const reference = p.id === undefined ? null : attachmentInput({ name, path: file, id: p.id, kind: p.kind });
        await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
        if (reference) return reference;
        return { name, text: `用户选择的文件保存在服务端路径 ${JSON.stringify(file)}（${bytes.length} 字节）。可使用工具按路径读取；未自动解析内容，不表示模型能够直接理解该文件格式。` };
      }) as Promise<Attachment>;
    }
    if (c.op !== "files.complete") throw new AppError("UNKNOWN_OPERATION", "不支持的文件操作");
    if (typeof p.text !== "string" || p.text.length > 12000 || p.text.includes("\0") ||
      !Number.isInteger(p.cursor) || Number(p.cursor) < 0 || Number(p.cursor) > p.text.length)
      throw new AppError("INVALID_INPUT", "补全文本或光标位置无效");
    const before = p.text.slice(0, Number(p.cursor));
    const lines = p.text.split("\n"), beforeLines = before.split("\n");
    if (!beforeLines.at(-1)!.includes("@")) return null;
    if (this.searching >= 4) throw new AppError("LIMIT", "文件补全请求过多，请稍后重试");
    this.searching++;
    try {
      this.fd ??= findFd().catch((error) => { this.fd = undefined; throw error; });
      const provider = new CombinedAutocompleteProvider([], workspace.path, await this.fd);
      const result = await provider.getSuggestions(lines, beforeLines.length - 1, beforeLines.at(-1)!.length, { signal: AbortSignal.timeout(3000) });
      // Revalidate after async filesystem work; never return another/deleted session's response.
      this.store.session(workspace.id, session.id);
      if (!result?.prefix.startsWith("@")) return null;
      return { prefix: result.prefix, items: result.items.slice(0, 20).map(({ value, label, description }) => ({ value, label, ...(description === undefined ? {} : { description }) })) };
    } finally { this.searching--; }
  }
}
