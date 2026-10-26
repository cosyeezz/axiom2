import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { PickedAttachment } from "../shared/protocol.js";
export async function remoteDirectory(path = homedir(), offset = 0) {
  if (!isAbsolute(path) || path.includes("\0")) throw Error("请输入电脑上的绝对路径");
  const directory = resolve(path);
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory() || entry.isFile())
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  return { path: directory, parent: dirname(directory), total: entries.length, offset, entries: entries.slice(offset, offset + 200).map((entry) => ({ name: entry.name, path: join(directory, entry.name), directory: entry.isDirectory() })) };
}
export async function remoteSelection(paths: string[]): Promise<PickedAttachment[]> {
  return Promise.all([...new Set(paths)].map(async (path) => {
    if (!isAbsolute(path) || path.includes("\0")) throw Error("请选择有效的电脑路径");
    const info = await stat(path);
    if (!info.isDirectory() && !info.isFile()) throw Error("只能选择文件或文件夹");
    return { path: resolve(path), name: basename(path) || path, kind: info.isDirectory() ? "folder" : /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?|heic)$/i.test(extname(path)) ? "image" : "file" };
  }));
}
