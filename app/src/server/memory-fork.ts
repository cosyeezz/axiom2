import { lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AppError } from "../shared/protocol.js";
import { memoryTemplate } from "../shared/memory.js";
import { memoryDirectory, readMemoryBytes, within } from "./memory-files.js";
import { ensureMemoryDirectory } from "./memory-storage.js";

const maxBytes = 32 * 1024 * 1024;
type Entry = { path: string; directory: boolean; signature: string };

/** Bounded metadata manifest, including directories so additions/removals conflict. */
function manifest(directory: string): Entry[] {
  const entries: Entry[] = [];
  let files = 0, directories = 0, bytes = 0;
  const visit = (local: string, depth: number) => {
    const path = join(directory, local), stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat && !local) return; // Unused/legacy sessions may have no memory yet.
    if (!stat) throw new AppError("REVISION_CONFLICT", "复制期间记忆资料改变，请重试分支操作");
    if (stat.isSymbolicLink() || realpathSync(path) !== resolve(path) ||
        (!local && !stat.isDirectory()) || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))
      throw new AppError("MEMORY_PATH", "记忆复制只接受无链接的普通文件和目录");
    if (stat.isDirectory()) directories++;
    else { files++; bytes += stat.size; }
    if (directories > 4000 || files > 2000 || bytes > maxBytes || depth > 128)
      throw new AppError("MEMORY_LIMIT", "记忆复制超过预算（2000 个文件、4000 个目录、32 MiB 或 128 层）");
    entries.push({ path: local, directory: stat.isDirectory(),
      signature: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}` });
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(local, child), depth + 1);
  };
  visit("", 0);
  return entries;
}

/** Keep relative links as-is; local absolute links must resolve into the new copy. */
function rebase(bytes: Buffer, path: string, source: string, target: string): Buffer {
  if (!/\.(md|txt)$/i.test(path) || bytes.includes(0)) return bytes;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return bytes; }
  const localPath = (value: string) => {
    const hash = value.indexOf("#"), path = hash < 0 ? value : value.slice(0, hash), fragment = hash < 0 ? "" : value.slice(hash);
    let decoded = path;
    try { decoded = decodeURIComponent(path); } catch { /* A raw filename may contain a literal percent sign. */ }
    if (!isAbsolute(decoded) || !within(source, resolve(decoded))) return value;
    const mapped = join(target, relative(source, resolve(decoded)));
    const spelling = value.includes("\\") ? mapped : mapped.replaceAll("\\", "/");
    return (decoded === path ? spelling : encodeURI(spelling).replaceAll("#", "%23").replaceAll("?", "%3F")) + fragment;
  };
  const roots = [...new Set([source, source.replaceAll("\\", "/"), encodeURI(source.replaceAll("\\", "/"))])]
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Match whole URL/angle tokens first: an external URL containing a local-looking
  // substring is not a file reference. Plain paths need a token boundary too.
  const tokens = new RegExp(String.raw`(?:[a-zA-Z][a-zA-Z\d+.-]*:)?\/\/[^\s<>"'\x60]+|<[^>\r\n]*>|(^|[\s([="'\x60])((?:${roots})(?=$|[\\/#\s<>"'\x60)\]])[^\s<>"'\x60)\]]*)`, "gm");
  return Buffer.from(text.replace(tokens, (token, prefix: string | undefined, path: string | undefined) => {
    if (path !== undefined) return (prefix ?? "") + localPath(path);
    if (token.startsWith("<")) return `<${localPath(token.slice(1, -1))}>`;
    return token;
  }));
}

/**
 * Copy current memory, not memory at the selected transcript message. No source
 * files are created or modified. Recheck observed revisions, but this is not an
 * OS-level atomic snapshot against arbitrary concurrent filesystem writers.
 * The caller owns the returned directory and must remove it on DB rollback.
 */
export function copyForkMemory(root: string, sourceId: string, targetId: string): string {
  const source = memoryDirectory(root, sourceId), target = memoryDirectory(root, targetId);
  ensureMemoryDirectory(dirname(target));
  const before = manifest(source);
  const main = before.find(entry => entry.path === "MEMORY.md");
  if (main?.directory) throw new AppError("MEMORY_PATH", "记忆入口不是普通文件");
  if (!main && before.filter(entry => !entry.directory).length >= 2000)
    throw new AppError("MEMORY_LIMIT", "补建记忆入口后超过 2000 个文件预算");
  // Ownership starts only after exclusive mkdir; never remove an existing target.
  mkdirSync(target, { mode: 0o700 });
  try {
    let copiedBytes = 0;
    for (const entry of before) {
      if (!entry.path) continue;
      const path = join(target, entry.path);
      if (entry.directory) mkdirSync(path, { mode: 0o700 });
      else {
        const bytes = rebase(readMemoryBytes(join(source, entry.path), maxBytes - copiedBytes), entry.path, source, target);
        copiedBytes += bytes.length;
        if (copiedBytes > maxBytes) throw new AppError("MEMORY_LIMIT", "记忆复制超过 32 MiB 预算");
        writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      }
    }
    if (!main)
      writeFileSync(join(target, "MEMORY.md"), memoryTemplate, { flag: "wx", mode: 0o600 });
    if (JSON.stringify(manifest(source)) !== JSON.stringify(before))
      throw new AppError("REVISION_CONFLICT", "复制期间记忆资料改变，请重试分支操作");
    return target;
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}
