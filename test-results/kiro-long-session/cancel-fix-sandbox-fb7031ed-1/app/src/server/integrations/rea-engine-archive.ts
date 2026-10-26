import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, crc32 } from "node:zlib";
import tar from "tar-stream";
import yauzl from "yauzl";

export function archivePath(raw: string) {
  const name = raw.replace(/\/$/, "");
  if (!name || name.length > 2048 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith("/")) throw Error("压缩包路径不安全。");
  const parts = name.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("压缩包包含非法或平台保留路径。");
  return name;
}
/** Parse archives, but never let an archive library create paths or links. */
export async function extractEngineArchive(archive: string, destination: string, format: "zip" | "tar.gz", signal: AbortSignal, maxBytes = 4 * 1024 * 1024 * 1024) {
  const boundary = await realpath(destination);
  const names = new Map<string, string>(), files = new Set<string>();
  const links: { name: string; target: string }[] = [];
  let count = 0, total = 0;
  async function entry(raw: string, type: string, size: number, mode: number, source: Readable, link?: string, expectedCrc?: number) {
    signal.throwIfAborted();
    const name = archivePath(raw), key = name.toLowerCase();
    if (++count > 100_000 || !Number.isSafeInteger(size) || size < 0 || size > 1024 * 1024 * 1024) throw Error("压缩包成员超出限制。");
    if (names.has(key)) throw Error("压缩包包含重复或大小写冲突路径。");
    // Check implicit directories too, for case-insensitive Windows/macOS filesystems.
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/"), old = names.get(parent.toLowerCase());
      if (old && old !== parent || files.has(parent.toLowerCase())) throw Error("压缩包目录冲突。");
      names.set(parent.toLowerCase(), parent);
    }
    names.set(key, name);
    if (type === "directory") { await mkdir(join(destination, name), { recursive: true, mode: 0o700 }); source.resume(); return; }
    if (type === "symlink" || type === "link") {
      if (size !== 0) throw Error("压缩包链接不得包含载荷。");
      if (!link || /[\\:\x00-\x1f\x7f]/.test(link) || link.startsWith("/")) throw Error("压缩包链接不安全。");
      const target = archivePath(posix.normalize(type === "link" ? link : posix.join(posix.dirname(name), link)));
      links.push({ name, target }); files.add(key); source.resume(); return;
    }
    if (type !== "file") throw Error("压缩包包含不支持的特殊文件。");
    files.add(key); let bytes = 0, crc = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length; total += chunk.length; crc = crc32(chunk, crc);
      callback(bytes > size || total > maxBytes ? Error("压缩包展开大小超限。") : null, chunk);
    } });
    const output = join(destination, name);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await pipeline(source, meter, createWriteStream(output, { flags: "wx", mode: mode & 0o111 ? 0o700 : 0o600 }), { signal });
    if (bytes !== size || expectedCrc !== undefined && crc !== expectedCrc) throw Error("压缩包成员校验失败。");
    await chmod(output, mode & 0o111 ? 0o700 : 0o600);
  }
  if (format === "tar.gz") {
    const extractor = tar.extract();
    extractor.on("entry", (header, stream, next) => {
      // Directory entries can follow an implicit parent created by earlier members.
      const key = header.name.replace(/\/$/, "").toLowerCase();
      if (header.type === "directory" && names.get(key) === header.name.replace(/\/$/, "") && !files.has(key)) names.delete(key);
      void entry(header.name, header.type ?? "file", header.size ?? 0, header.mode ?? 0, Readable.from(stream, { objectMode: false }), header.linkname).then(() => next(), error => extractor.destroy(error));
    });
    await pipeline(createReadStream(archive), createGunzip(), extractor, { signal });
  } else {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value!)));
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { zip.close(); reject(Error("解包已取消。")); };
        signal.addEventListener("abort", abort, { once: true });
        const fail = (error: Error) => { signal.removeEventListener("abort", abort); zip.close(); reject(error); };
        zip.on("error", fail);
        zip.on("end", () => { signal.removeEventListener("abort", abort); resolve(); });
        zip.on("entry", (item: yauzl.Entry) => {
          void (async () => {
            const mode = item.externalFileAttributes >>> 16, kind = mode & 0o170000;
            if (item.isEncrypted() || kind && ![0o100000, 0o040000].includes(kind)) throw Error("ZIP 包含加密或链接/特殊文件。");
            const directory = item.fileName.endsWith("/");
            const key = item.fileName.replace(/\/$/, "").toLowerCase();
            if (directory && names.get(key) === item.fileName.replace(/\/$/, "") && !files.has(key)) names.delete(key);
            const stream = directory ? Readable.from([]) : await new Promise<Readable>((resolve, reject) => zip.openReadStream(item, (error, stream) => error ? reject(error) : resolve(stream!)));
            await entry(item.fileName, directory ? "directory" : "file", item.uncompressedSize, mode, stream, undefined, directory ? undefined : item.crc32);
            zip.readEntry();
          })().catch(fail);
        });
        if (signal.aborted) abort(); else zip.readEntry();
      });
    } finally { zip.close(); }
  }
  // Materialize safe file links as copies; no symlink privilege or reparse point on Windows.
  for (let pass = 0; links.length && pass < count; pass++) {
    let progressed = false;
    for (let i = links.length - 1; i >= 0; i--) {
      signal.throwIfAborted(); const link = links[i];
      let target: string;
      try { target = await realpath(join(destination, link.target)); } catch { continue; }
      const rel = relative(boundary, target);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error("压缩包链接逃逸。");
      const info = await stat(target);
      if (!info.isFile() || total + info.size > maxBytes) throw Error("压缩包链接目标非普通文件或展开大小超限。");
      total += info.size;
      const output = join(destination, link.name);
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      await copyFile(target, output, 1); links.splice(i, 1); progressed = true;
    }
    if (!progressed) throw Error("压缩包含无法解析的链接。");
  }
  if (links.length || !files.size) throw Error("压缩包为空或链接无效。");
}
