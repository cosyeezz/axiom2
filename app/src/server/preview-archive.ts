import yauzl from "yauzl";
import { createGunzip, crc32 } from "node:zlib";
import { Readable } from "node:stream";
import type { ArchiveEntry } from "../shared/file-preview.js";

const MiB = 1024 * 1024;
async function inflateGzip(bytes: Buffer, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = Readable.from([bytes]), decoder = createGunzip();
  const abort = () => { input.destroy(); decoder.destroy(Error("读取压缩包已取消")); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = []; let length = 0;
  try {
    input.pipe(decoder);
    for await (const chunk of decoder) {
      signal.throwIfAborted(); length += chunk.length;
      if (length > archiveLimits.expanded) throw Error("GZIP 超过 128 MiB 展开上限");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  } finally { signal.removeEventListener("abort", abort); input.destroy(); decoder.destroy(); }
}
export const archiveLimits = { entries: 2000, expanded: 128 * MiB, member: 8 * MiB, selected: 32 * MiB };
function safeName(raw: string) {
  const name = raw.replace(/\/$/, "");
  if (!name || name.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === "..")) throw Error("压缩包包含不安全的成员路径");
  return name;
}
/** Never writes archive members to disk, follows links, or runs their contents. */
export async function previewArchive(bytes: Buffer, name: string, select: (name: string) => boolean = () => false, signal = AbortSignal.timeout(10000)) {
  signal.throwIfAborted();
  const entries: ArchiveEntry[] = [], contents = new Map<string, Buffer>(), names = new Set<string>();
  let expanded = 0, selected = 0;
  const add = (raw: string, size: number, directory: boolean) => {
    signal.throwIfAborted();
    const path = safeName(raw);
    if (names.has(path) || !Number.isSafeInteger(size) || size < 0) throw Error("压缩包成员重复或大小无效");
    names.add(path); expanded += size;
    if (names.size > archiveLimits.entries || expanded > archiveLimits.expanded) throw Error("压缩包超过 2000 项或 128 MiB 展开上限");
    const wanted = !directory && select(path);
    if (wanted && (size > archiveLimits.member || (selected += size) > archiveLimits.selected)) throw Error("成员超过 8 MiB 或本次展开超过 32 MiB");
    entries.push({ name: path, size, directory });
    return { path, wanted };
  };
  if (/\.(?:tar|tgz|tar\.gz|gz)$/i.test(name)) {
    const tar = /\.(?:tgz|gz)$/i.test(name) ? await inflateGzip(bytes, signal) : bytes;
    if (/\.gz$/i.test(name) && !/\.tar\.gz$/i.test(name)) {
      const item = add(name.replace(/\.gz$/i, ""), tar.length, false);
      if (item.wanted) contents.set(item.path, tar);
    } else {
      let terminated = false;
      for (let at = 0; at + 512 <= tar.length;) {
        const header = tar.subarray(at, at + 512);
        if (header.every(b => b === 0)) { if (at + 1024 > tar.length || !tar.subarray(at).every(b => b === 0)) throw Error("TAR 结束块无效"); terminated = true; break; }
        const string = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
        const octal = (start: number, length: number) => { const s = string(start, length).trim(); if (!/^[0-7]+$/.test(s)) throw Error("TAR 数字字段无效"); return parseInt(s, 8); };
        const checksum = [...header].reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0);
        if (checksum !== octal(148, 8)) throw Error("TAR 校验失败");
        const type = string(156, 1), size = octal(124, 12), prefix = string(345, 155);
        if (!["", "0", "5"].includes(type)) throw Error("TAR 链接、特殊成员或扩展头暂不支持");
        const item = add((prefix ? prefix + "/" : "") + string(0, 100), size, type === "5");
        if (at + 512 + size > tar.length) throw Error("TAR 成员被截断");
        if (item.wanted) contents.set(item.path, tar.subarray(at + 512, at + 512 + size));
        at += 512 + Math.ceil(size / 512) * 512;
      }
      if (!terminated) throw Error("TAR 被截断或缺少结束块");
    }
  } else {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
    let stream: Readable | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => fail(Error("读取压缩包已取消"));
        const cleanup = () => signal.removeEventListener("abort", abort);
        const fail = (error: Error) => { cleanup(); stream?.destroy(); zip.close(); reject(error); };
        signal.addEventListener("abort", abort, { once: true });
        zip.on("error", fail);
        zip.on("end", () => { cleanup(); resolve(); });
        zip.on("entry", (entry: yauzl.Entry) => {
          void (async () => {
            const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (entry.isEncrypted() || kind && ![0o100000, 0o040000].includes(kind)) throw Error("不预览加密 ZIP、链接或特殊成员");
            const item = add(entry.fileName, entry.uncompressedSize, entry.fileName.endsWith("/"));
            if (item.wanted) {
              stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value!)));
              const chunks: Buffer[] = []; let length = 0, crc = 0;
              for await (const chunk of stream) {
                signal.throwIfAborted(); length += chunk.length;
                if (length > entry.uncompressedSize || length > archiveLimits.member) throw Error("ZIP 实际展开大小超限");
                crc = crc32(chunk, crc); chunks.push(chunk);
              }
              stream = undefined;
              if (length !== entry.uncompressedSize || crc !== entry.crc32) throw Error("ZIP 成员校验失败");
              contents.set(item.path, Buffer.concat(chunks, length));
            }
            zip.readEntry();
          })().catch(fail);
        });
        if (signal.aborted) abort(); else zip.readEntry();
      });
    } finally { stream?.destroy(); zip.close(); }
  }
  return { entries, contents };
}
