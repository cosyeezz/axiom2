import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, realpathSync, lstatSync, readdirSync, statSync, openSync, closeSync, fstatSync, readSync, writeSync, ftruncateSync, constants } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, extname, sep } from "node:path";
import { AppError } from "../shared/protocol.js";
import { memoryTemplate, type MemoryCatalogEntry, type MemoryFile } from "../shared/memory.js";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const within = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };
export interface MemoryTextSnapshot { revision: string; content: string; size: number; updatedAt: number }
export interface MemoryTextPage extends MemoryTextSnapshot { offset: number; nextOffset: number | null }
/**
 * Request-scoped decoded-text cache. A revision probe is intentionally still
 * required for every page so an unchanged cache never masks an external edit.
 */
export class MemoryTextCache {
  private readonly entries = new Map<string, MemoryTextSnapshot>();
  private bytes = 0;
  constructor(private readonly maxBytes = 1024 * 1024) {}
  clear() { this.entries.clear(); this.bytes = 0; }
  read(key: string, offset: number, limit: number, revision: () => string, load: () => MemoryTextSnapshot): MemoryTextPage {
    const current = revision(), cached = this.entries.get(key);
    let snapshot = cached?.revision === current ? cached : undefined;
    if (!snapshot) {
      if (cached) { this.entries.delete(key); this.bytes -= Buffer.byteLength(cached.content); }
      snapshot = load();
      if (snapshot.revision !== current) throw new AppError("REVISION_CONFLICT", "读取期间资料改变，请重新读取");
      const size = Buffer.byteLength(snapshot.content);
      if (size <= this.maxBytes && this.bytes + size <= this.maxBytes) { this.entries.set(key, snapshot); this.bytes += size; }
    }
    const nextOffset = snapshot.content.length > offset + limit ? offset + limit : null;
    return { ...snapshot, content: snapshot.content.slice(offset, offset + limit), offset, nextOffset };
  }
}
/**
 * Explicit external links are derived from one memory source revision. The
 * caller must still validate the selected target on every access; this cache
 * only avoids reparsing unchanged Markdown link declarations.
 */
export class MemoryLinkCache {
  private readonly entries = new Map<string, { revision: string; links: string[] }>();
  links(key: string, revision: string, load: () => string[]) {
    const cached = this.entries.get(key);
    if (cached?.revision === revision) return [...cached.links];
    const links = load();
    this.entries.set(key, { revision, links: [...links] });
    return links;
  }
  clear() { this.entries.clear(); }
}
const shortText = (value: string, limit: number) => Array.from(value).slice(0, limit).join("");
/**
 * Keep every selected source visible to the model while bounding descriptive
 * fields. The caller still provides the complete document only through read.
 */
export function compactMemoryCandidates(candidates: readonly Pick<MemoryCatalogEntry, "sessionId" | "title" | "revision" | "summary" | "keywords">[], options: {
  totalSources?: number; unreadableCandidates?: number; maxChars?: number;
} = {}) {
  const maxChars = options.maxChars ?? 16000;
  const projection = candidates.map((candidate) => ({
    // These identify subsequent read calls and evidence checks, so they are
    // never abbreviated. Only descriptive text is eligible for a budget cut.
    sessionId: candidate.sessionId,
    title: shortText(candidate.title, 160),
    revision: candidate.revision,
    keywords: candidate.keywords.slice(0, 6).map((keyword) => shortText(keyword, 40)),
    summary: "",
  }));
  const envelope = () => JSON.stringify({
    totalSources: options.totalSources ?? candidates.length,
    candidateCount: candidates.length,
    unreadableCandidates: options.unreadableCandidates ?? 0,
    coverage: "候选摘要只是有界索引投影，可能不完整或过时；必须读取当前资料后才能据此断言。",
    candidates: projection,
  });
  let base = envelope();
  // Prefer retaining a little metadata from every source, but identity is
  // sacred: exhaust descriptive text before rejecting an unrepresentable set.
  while (base.length > maxChars) {
    const title = [...projection].sort((a, b) => b.title.length - a.title.length)[0];
    if (title?.title.length) title.title = shortText(title.title, Array.from(title.title).length - 1);
    else {
      const keyword = [...projection].reverse().find((item) => item.keywords.some(Boolean));
      if (!keyword) throw new AppError("MEMORY_LIMIT", "候选身份元数据超过提示投影预算");
      const index = keyword.keywords.length - 1;
      const value = keyword.keywords[index]!;
      if (Array.from(value).length === 1) keyword.keywords.pop();
      else keyword.keywords[index] = shortText(value, Array.from(value).length - 1);
    }
    base = envelope();
  }
  let remaining = maxChars - base.length;
  for (let index = 0; index < candidates.length; index++) {
    const slots = candidates.length - index;
    const summary = shortText(candidates[index]!.summary, Math.floor(remaining / slots));
    projection[index]!.summary = summary;
    remaining -= summary.length;
  }
  let text = envelope();
  // JSON escaping can expand a quote or a control character beyond the source
  // string length, so trim previews against the serialized budget as well.
  while (text.length > maxChars) {
    const target = [...projection].reverse().find((item) => item.summary.length);
    if (!target) throw new AppError("MEMORY_LIMIT", "候选元数据超过提示投影预算");
    target.summary = shortText(target.summary, Array.from(target.summary).length - 1);
    text = envelope();
  }
  return text;
}
type Evidence = { revision: string; nextOffset: number | null; content: string; complete: boolean };
/** Tracks only gap-free pages from offset zero; revision changes discard evidence. */
export class MemoryReadEvidence {
  private readonly entries = new Map<string, Evidence>();
  record(key: string, page: Pick<MemoryTextPage, "revision" | "content" | "offset" | "nextOffset">) {
    const previous = this.entries.get(key);
    if (previous?.revision !== undefined && previous.revision !== page.revision) this.entries.delete(key);
    const current = this.entries.get(key);
    if (current?.complete || page.offset !== (current?.nextOffset ?? 0) || page.nextOffset !== null && page.nextOffset !== page.offset + page.content.length) return false;
    const next: Evidence = { revision: page.revision, nextOffset: page.nextOffset, content: (current?.content ?? "") + page.content, complete: page.nextOffset === null };
    this.entries.set(key, next);
    return next.complete;
  }
  get(key: string, revision?: string) {
    const entry = this.entries.get(key);
    return entry && (!revision || entry.revision === revision) ? { ...entry } : undefined;
  }
  clear() { this.entries.clear(); }
}
export function memoryDirectory(root: string, sessionId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new AppError("INVALID_INPUT", "记忆会话标识无效");
  return join(root, "memory", "sessions", sessionId);
}
export function initializeMemory(root: string, sessionId: string) {
  // The application root is trusted; descendants are not. Resolve only this
  // boundary, then validate each level before creating the next one.
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const actualRoot = realpathSync(root);
  const directory = memoryDirectory(actualRoot, sessionId);
  let current = actualRoot;
  for (const segment of relative(actualRoot, directory).split(sep)) {
    current = join(current, segment);
    try { mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current)
      throw new AppError("MEMORY_PATH", "记忆目录不能使用符号链接");
  }
  const path = join(directory, "MEMORY.md");
  try { writeFileSync(path, memoryTemplate, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).nlink !== 1) throw new AppError("MEMORY_PATH", "记忆入口不是普通文件");
  return path;
}
export function memoryPath(directory: string, input: string) {
  const path = resolve(directory, input);
  if (!within(directory, path) || path === directory || extname(path).toLowerCase() === ".jsonl")
    throw new AppError("MEMORY_PATH", "只能读取所属记忆资料，不能读取原始对话");
  const actual = realpathSync(path);
  if (!within(realpathSync(directory), actual) || actual !== path || !statSync(actual).isFile() || statSync(actual).nlink !== 1)
    throw new AppError("MEMORY_PATH", "记忆资料不能通过链接越过读取边界");
  return actual;
}
export function memoryFiles(directory: string): MemoryFile[] {
  const files: MemoryFile[] = [];
  let visited = 0;
  const visit = (dir: string) => {
    if (++visited > 4000 || realpathSync(dir) !== resolve(dir)) throw new AppError("MEMORY_LIMIT", "记忆目录扫描超出预算或路径发生变化");
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new AppError("MEMORY_PATH", "记忆目录包含符号链接，未生成索引");
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && extname(path).toLowerCase() !== ".jsonl") {
        if (files.length >= 2000) throw new AppError("MEMORY_LIMIT", "记忆资料超过单次扫描 2000 个文件预算");
        const stat = statSync(memoryPath(directory, relative(directory, path)));
        // Large artifacts use filesystem metadata, text sources use actual bytes.
        const revision = stat.size <= 4 * 1024 * 1024 ? digest(readMemoryBytes(path)) : digest(`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
        files.push({ path: relative(directory, path).split(sep).join("/"), revision, size: stat.size, updatedAt: stat.mtimeMs });
      }
    }
  };
  visit(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function readMemoryBytes(path: string, maxBytes = 4 * 1024 * 1024) {
  const before = lstatSync(path);
  if (realpathSync(path) !== resolve(path) || !before.isFile() || before.nlink !== 1) throw new AppError("MEMORY_PATH", "只能读取无链接的普通资料文件");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const held = fstatSync(fd);
    if (held.dev !== before.dev || held.ino !== before.ino || !held.isFile() || held.nlink !== 1) throw new AppError("MEMORY_PATH", "资料身份已变化");
    if (held.size > maxBytes) throw new AppError("MEMORY_LIMIT", `文件超过单次读取预算 ${maxBytes} 字节`);
    const bytes = Buffer.alloc(held.size + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, length); if (!count) break; length += count; }
    const after = fstatSync(fd), named = lstatSync(path);
    if (realpathSync(path) !== resolve(path) || named.dev !== held.dev || named.ino !== held.ino || named.nlink !== 1 || after.mtimeMs !== held.mtimeMs || after.ctimeMs !== held.ctimeMs || after.size !== held.size || length !== held.size)
      throw new AppError("REVISION_CONFLICT", "读取期间资料改变，请重新读取");
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}
export function replaceMemoryFile(path: string, revision: string, content: string) {
  const before = lstatSync(path);
  const original = readMemoryBytes(path);
  if (digest(original) !== revision) throw new AppError("REVISION_CONFLICT", "资料已改变，请重新读取后合并");
  const fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = fstatSync(fd), named = lstatSync(path);
    if (realpathSync(path) !== resolve(path) || !held.isFile() || held.nlink !== 1 || held.dev !== before.dev || held.ino !== before.ino || held.mtimeMs !== before.mtimeMs || held.ctimeMs !== before.ctimeMs || named.ino !== held.ino || named.dev !== held.dev)
      throw new AppError("REVISION_CONFLICT", "保存期间资料改变，未覆盖新版本");
    // TextDecoder hides a leading UTF-8 BOM from editors. Preserve it on a
    // no-op or local edit so byte-based revisions and on-disk encoding agree.
    const bytes = original.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && !content.startsWith("\ufeff")
      ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]) : Buffer.from(content);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
    ftruncateSync(fd, bytes.length);
  } finally { closeSync(fd); }
}
export function textFile(path: string, maxBytes = 4 * 1024 * 1024) {
  const buffer = readMemoryBytes(path, maxBytes);
  if (buffer.includes(0)) throw new AppError("MEMORY_BINARY", "此产物不是文本，请使用支持的预览方式");
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}
export function referencedPaths(directory: string, document: string) {
  return [...document.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)].flatMap((m) => {
    try { const target = decodeURIComponent((m[1] ?? m[2]).replace(/#.*$/, "")); return /^(?:https?:|data:|javascript:|file:)/i.test(target) ? [] : [resolve(dirname(directory), target)]; }
    catch { return []; }
  });
}
