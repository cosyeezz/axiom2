import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AppError } from "../shared/protocol.js";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const textRevision = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const locks = new Map<string, Promise<unknown>>();
const conflict = () => new AppError("REVISION_CONFLICT", "文件已被修改，请保留当前编辑，重新读取最新内容后合并。");
const forbidden = () => new AppError("FILE_EDIT_FORBIDDEN", "只能编辑普通 UTF-8 文本文件，不支持符号链接或硬链接。");

/** Serialize all application writes to the same canonical file, across sessions. */
export async function saveTextFile(path: string, revision: string, text: string, skill: boolean,
  authorize: () => Promise<void>, signal: AbortSignal) {
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  const previous = locks.get(key);
  const operation = (async () => {
    await previous?.catch(() => {});
    await authorize(); signal.throwIfAborted();
    const limit = skill ? 128 * 1024 : 1024 * 1024;
    if (Buffer.byteLength(text, "utf8") > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
      throw new AppError("FILE_EDIT_INVALID", `文件内容无效或超过 ${skill ? "128 KiB" : "1 MiB"} 编辑上限。`);
    if (skill) {
      try {
        const { frontmatter } = parseFrontmatter(text);
        if (typeof frontmatter.name !== "string" || !frontmatter.name.trim() || frontmatter.name.length > 200 ||
          typeof frontmatter.description !== "string" || !frontmatter.description.trim() || frontmatter.description.length > 4096) throw Error();
      } catch { throw new AppError("SKILL_INVALID", "技能的 YAML 名称或描述无效，请修正后保存。"); }
    }
    const inspect = async () => {
      if ((process.platform === "win32" ? (await realpath(path)).toLowerCase() : await realpath(path)) !== key) throw forbidden();
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit) throw forbidden();
      return info;
    };
    const before = await inspect();
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let temporary: string | undefined;
    try {
      const info = await handle.stat();
      if (info.dev !== before.dev || info.ino !== before.ino || !info.isFile() || info.nlink !== 1 || info.size > limit) throw forbidden();
      const bytes = Buffer.alloc(info.size + 1); let length = 0;
      while (length < bytes.length) { const part = await handle.read(bytes, length, bytes.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
      const original = bytes.subarray(0, length);
      if (length !== info.size || textRevision(original) !== revision) throw conflict();
      let oldText: string;
      try { oldText = new TextDecoder("utf-8", { fatal: true }).decode(original); }
      catch { throw forbidden(); }
      if (original.includes(0)) throw forbidden();
      // Textareas normalize line endings. Retain the file's uniform CRLF style and BOM.
      if (oldText.includes("\r\n") && !/(?<!\r)\n/.test(oldText)) text = text.replace(/\r?\n/g, "\r\n");
      const bom = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
      const output = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, "utf8")]);
      if (output.length > limit) throw new AppError("FILE_EDIT_INVALID", "保存内容超过文件编辑上限。");
      temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
      const target = await open(temporary, "wx", info.mode & 0o777);
      try { await target.chmod(info.mode & 0o777); await target.writeFile(output); await target.sync(); } finally { await target.close(); }
      await authorize(); signal.throwIfAborted();
      const final = await handle.stat();
      // Windows can reject replacing a destination while its read handle is open.
      // Close it before the final path identity check and atomic replacement.
      await handle.close();
      const current = await inspect();
      if (current.dev !== info.dev || current.ino !== info.ino || current.size !== info.size ||
        current.mtimeMs !== info.mtimeMs || current.ctimeMs !== info.ctimeMs || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs) throw conflict();
      await rename(temporary, path); temporary = undefined;
      return { revision: textRevision(output), size: output.length, modified: new Date().toISOString() };
    } finally {
      await handle.close();
      if (temporary) await unlink(temporary).catch(() => {});
    }
  })();
  locks.set(key, operation);
  try { return await operation; } finally { if (locks.get(key) === operation) locks.delete(key); }
}
