import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { htmlResourceLinks, type HtmlResource } from "../shared/html-preview.js";

const key = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
/** Direct CSS/JS companions only, inside the linked document directory. */
export async function htmlResources(path: string, text: string, authorize: () => unknown, signal: AbortSignal): Promise<{ resources: HtmlResource[]; resourceNotice?: string }> {
  const resources: HtmlResource[] = [];
  const directory = dirname(path);
  let total = 0, skipped = 0;
  const links = htmlResourceLinks(text);
  for (const [index, link] of links.entries()) {
    if (index >= 16) { skipped++; continue; }
    try {
      signal.throwIfAborted(); authorize();
      const name = decodeURIComponent(link.href.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
      if (!name || /[\x00-\x1f\x7f:]/.test(name) || isAbsolute(name) || name.startsWith("/") || name.split("/").some(part => part === ".." || part.startsWith(".") && part !== ".")) throw new Error("path");
      if (!(link.kind === "style" ? /\.css$/i : /\.m?js$/i).test(name)) throw new Error("type");
      const target = resolve(directory, name), rel = relative(directory, target);
      if (!rel || rel.startsWith("..") || isAbsolute(rel) || key(await realpath(target)) !== key(target)) throw new Error("path");
      const before = await lstat(target);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 1024 * 1024 || total + before.size > 2 * 1024 * 1024) throw new Error("size");
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) throw new Error("changed");
        const buffer = Buffer.alloc(info.size + 1); let length = 0;
        while (length < buffer.length) { const result = await handle.read(buffer, length, buffer.length - length, length); if (!result.bytesRead) break; length += result.bytesRead; }
        const after = await lstat(target), final = await handle.stat();
        if (key(await realpath(target)) !== key(target) || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== info.dev || after.ino !== info.ino || final.size !== info.size || final.mtimeMs !== info.mtimeMs || final.ctimeMs !== info.ctimeMs || length !== info.size) throw new Error("changed");
        signal.throwIfAborted(); authorize();
        const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
        if (content.includes("\0")) throw new Error("binary");
        total += length; resources.push({ ...link, text: content });
      } finally { await handle.close(); }
    } catch { signal.throwIfAborted(); authorize(); skipped++; }
  }
  return { resources, ...(skipped ? { resourceNotice: `${skipped} 个样式或脚本未加载（缺失、超限或不在同目录内）` } : {}) };
}
