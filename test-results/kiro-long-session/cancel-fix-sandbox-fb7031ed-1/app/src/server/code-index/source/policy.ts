import { constants } from "node:fs";
import { lstat, open, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { digest, sha256 } from "../domain/json.js";
import { IndexError, requireIndex } from "../domain/errors.js";
import { readHeldFile } from "./held-file.js";
import type { Coverage, FileSnapshot, ScopeDefinition } from "../contracts.js";

export const policyVersion = "file-policy/1";
export const globVersion = "bounded-glob/1";
const deniedDirectories = new Set([".git", ".aoci", ".pi", "node_modules", "dist", "build", "target", "coverage", ".next", ".cache", ".venv", "vendor"]);
const binaryExtensions = /\.(?:png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|7z|tar|woff2?|ttf|eot|mp[34]|wav|exe|dll|so|dylib|sqlite(?:3)?|db|lockb)$/i;
const secrets = /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\..*)?|auth\.json|aoci(?:\.[\w-]+)?\.txt)$|\.(?:pem|key|p12|pfx|keystore)$/i;
export interface FilePolicyOptions { excludes?: string[]; maxFileBytes?: number; maxFiles?: number; maxSnapshotBytes?: number; runtimeRoot?: string }
export interface FileManifest {
  files: Map<string, FileSnapshot>;
  members: { path: string; contentHash: string | null; state: "present" | "oversize" | "unreadable" | "binary" }[];
  complete: boolean; gaps: Coverage["gaps"];
}
export function relativePath(input: string): string {
  requireIndex(typeof input === "string" && input.length > 0 && input.length <= 4096 && !/[\uD800-\uDFFF]/u.test(input), "INVALID_INPUT", "无效的相对路径。");
  const normalized = input.replaceAll("\\", "/");
  requireIndex(!normalized.startsWith("/") && !normalized.split("/").some(part => !part || part === "." || part === ".." || /[\x00-\x1f<>:"|?*]|[. ]$/.test(part)), "ACCESS_DENIED", "路径不在索引读取范围内。");
  return normalized;
}
export function glob(pattern: string): RegExp {
  requireIndex(pattern.length > 0 && pattern.length <= 1024 && !pattern.includes("\\") && !pattern.startsWith("/") && !pattern.split("/").some(p => p === ".." || p === "." || !p) && !/[\x00-\x1f:[\]{}]/.test(pattern), "INVALID_INPUT", "索引范围模式无效。");
  let result = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") { i++; if (pattern[i + 1] === "/") { i++; result += "(?:.*/)?"; } else result += ".*"; }
    else if (c === "*") result += "[^/]*";
    else if (c === "?") result += "[^/]";
    else result += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return new RegExp(`${result}$`, process.platform === "win32" ? "i" : "");
}
export function normalizeScope(definition: ScopeDefinition): ScopeDefinition {
  requireIndex(definition.include.length > 0 && definition.include.length <= 32 && definition.exclude.length <= 32, "INVALID_INPUT", "索引范围数量无效。");
  for (const item of [...definition.include, ...definition.exclude]) glob(item);
  return { include: [...new Set(definition.include)].sort(), exclude: [...new Set(definition.exclude)].sort() };
}
export function scopeMatches(definition: ScopeDefinition, file: string) {
  return definition.include.some(p => glob(p).test(file)) && !definition.exclude.some(p => glob(p).test(file));
}
export function category(file: string): FileSnapshot["category"] {
  if (/\.(?:[cm]?[jt]sx?|py|rs|go|java|c|cpp|h|cs|rb|php|sh|ps1|sql)$/i.test(file)) return "code";
  if (/\.(?:md|mdx|txt|rst|adoc)$/i.test(file)) return "document";
  if (/\.(?:jsonc?|ya?ml|toml|ini|xml)$/i.test(file)) return "config";
  return "text";
}
function pathKey(value: string) { return process.platform === "win32" ? value.toLowerCase() : value; }
export class FilePolicy {
  readonly hash: string;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxSnapshotBytes: number;
  private readonly exclusions: RegExp[];
  private constructor(readonly root: string, private readonly options: FilePolicyOptions) {
    this.maxFileBytes = options.maxFileBytes ?? 1_048_576;
    this.maxFiles = options.maxFiles ?? 20_000;
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? 64 * 1024 * 1024;
    this.exclusions = (options.excludes ?? []).map(glob);
    this.hash = digest({ version: policyVersion, globVersion, excludes: [...(options.excludes ?? [])].sort(), maxFileBytes: this.maxFileBytes, maxFiles: this.maxFiles, maxSnapshotBytes: this.maxSnapshotBytes, runtimeRoot: options.runtimeRoot ?? null });
  }
  static async create(root: string, options: FilePolicyOptions = {}) {
    const actual = await realpath(root);
    requireIndex((await lstat(actual)).isDirectory(), "ACCESS_DENIED", "索引工作区不可访问。");
    return new FilePolicy(actual, options);
  }
  allows(input: string): boolean {
    try {
      const relative = relativePath(input), parts = relative.split("/");
      if (parts.some(part => deniedDirectories.has(part.toLowerCase()) || secrets.test(part))) return false;
      if (binaryExtensions.test(relative) || /(?:^|\/)(?:eval-answers|holdout-answers|future-patches)(?:\/|$)/i.test(relative)) return false;
      if (this.exclusions.some(pattern => pattern.test(relative))) return false;
      if (this.options.runtimeRoot) {
        const abs = pathKey(path.resolve(this.root, relative)), runtime = pathKey(path.resolve(this.options.runtimeRoot));
        if (abs === runtime || abs.startsWith(runtime + path.sep)) return false;
      }
      return true;
    } catch { return false; }
  }
  /** Check every ancestor, including the root, before and after opening. */
  async resolve(input: string): Promise<string> {
    const relative = relativePath(input);
    requireIndex(this.allows(relative), "ACCESS_DENIED", "路径不在索引读取范围内。");
    const currentRoot = await realpath(this.root);
    requireIndex(pathKey(currentRoot) === pathKey(this.root) && !(await lstat(this.root)).isSymbolicLink(), "ACCESS_DENIED", "索引工作区身份已变化。");
    let absolute = this.root;
    for (const part of relative.split("/")) {
      absolute = path.join(absolute, part);
      const stat = await lstat(absolute);
      requireIndex(!stat.isSymbolicLink(), "ACCESS_DENIED", "索引不跟随链接或重解析目录。");
    }
    const actual = await realpath(absolute), rel = path.relative(this.root, actual);
    requireIndex(rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) && pathKey(actual) === pathKey(absolute), "ACCESS_DENIED", "路径身份已变化。");
    return absolute;
  }
  async read(input: string, signal?: AbortSignal): Promise<FileSnapshot> {
    signal?.throwIfAborted();
    const relative = relativePath(input), absolute = await this.resolve(relative);
    const before = await lstat(absolute);
    requireIndex(before.isFile(), "INVALID_INPUT", "需要普通文本文件。");
    const raw = readHeldFile(absolute, this.maxFileBytes);
    signal?.throwIfAborted();
    await this.resolve(relative);
    requireIndex(!raw.includes(0), "INVALID_INPUT", "文件不是支持的UTF-8文本。");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw); }
    catch { throw new IndexError("INVALID_INPUT", "文件不是支持的UTF-8文本。"); }
    return { path: relative, contentHash: sha256(raw), text, sizeBytes: raw.length, category: category(relative) };
  }
  async scan(signal?: AbortSignal): Promise<FileManifest> {
    const result: FileManifest = { files: new Map(), members: [], complete: true, gaps: [] };
    let totalBytes = 0, visited = 0;
    const reasons = new Map<string, number>();
    const gap = (reason: string) => { reasons.set(reason, (reasons.get(reason) ?? 0) + 1); result.complete = false; };
    const walk = async (directory: string): Promise<void> => {
      signal?.throwIfAborted();
      let entries;
      try {
        if (directory) await this.resolve(directory);
        else requireIndex(pathKey(await realpath(this.root)) === pathKey(this.root), "ACCESS_DENIED", "索引根身份变化。");
        entries = await readdir(path.join(this.root, directory), { withFileTypes: true });
      } catch { gap("directory_unavailable"); return; }
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        signal?.throwIfAborted();
        const relative = directory ? `${directory}/${entry.name}` : entry.name;
        if (!this.allows(relative)) continue;
        if (++visited > this.maxFiles) { gap("file_limit"); return; }
        if (entry.isSymbolicLink()) { gap("link_skipped"); continue; }
        if (entry.isDirectory()) { await walk(relative); continue; }
        if (!entry.isFile()) { gap("special_file_skipped"); continue; }
        try {
          const file = await this.read(relative, signal);
          if (totalBytes + file.sizeBytes > this.maxSnapshotBytes) { gap("snapshot_limit"); result.members.push({ path: relative, contentHash: file.contentHash, state: "oversize" }); continue; }
          totalBytes += file.sizeBytes; result.files.set(relative, file);
          result.members.push({ path: relative, contentHash: file.contentHash, state: "present" });
        } catch (error) {
          signal?.throwIfAborted();
          const state = error instanceof IndexError && error.code === "BUDGET_EXCEEDED" ? "oversize" : error instanceof IndexError && error.code === "INVALID_INPUT" ? "binary" : "unreadable";
          result.members.push({ path: relative, contentHash: null, state }); gap(state);
        }
      }
    };
    await walk("");
    result.members.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    result.gaps = [...reasons].map(([code, count]) => ({ code, description: `有${count}项未能完整读取。` }));
    return result;
  }
}

export async function workspaceIdentity(root: string): Promise<{ root: string; indexKey: string }> {
  const actual = await realpath(root);
  let worktree: string | null = null;
  try {
    const marker = path.join(actual, ".git"), stat = await lstat(marker);
    if (!stat.isSymbolicLink() && stat.isFile() && stat.size <= 16_384) {
      const text = readHeldFile(marker, 16_384).toString("utf8");
      if (/^gitdir: /.test(text)) worktree = pathKey(path.resolve(actual, text.slice(8).trim()));
    } else if (stat.isDirectory() && !stat.isSymbolicLink()) worktree = pathKey(marker);
  } catch { /* Non-Git folders are valid workspaces. */ }
  return { root: actual, indexKey: digest({ namespace: "axiom-code-index/1", root: pathKey(actual), worktree }) };
}
