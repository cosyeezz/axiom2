import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { defaultDataRoot } from "./data-root.js";
import { memoryRules } from "../shared/memory.js";
import { AppError } from "../shared/protocol.js";

const roots = new Map<string, string>();
const bindingPath = (root: string) => join(root, "memory-location.json");
export const legacyMemoryRoot = (root: string) => join(root, "memory", "sessions");
const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };

function boundMemoryRoot(root: string): string {
  const path = bindingPath(root);
  if (!existsSync(path)) return legacyMemoryRoot(root);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error("记忆目录绑定不是普通文件");
  const binding = JSON.parse(readFileSync(path, "utf8"));
  if (binding.version !== 1 || typeof binding.dataRoot !== "string" || typeof binding.directory !== "string" || !isAbsolute(binding.directory)) throw Error("记忆目录绑定无效");
  // Copying an application data directory must not share another instance's memory.
  if (binding.dataRoot !== root) return legacyMemoryRoot(root);
  const directory = resolve(binding.directory);
  if (!existsSync(directory)) throw Error("绑定的记忆目录缺失，保留绑定并暂用旧目录");
  return directory;
}
/** Custom data roots remain self-contained. The binding is committed only after migration. */
export function memoryRoot(root: string): string {
  root = canonical(root);
  const cached = roots.get(root);
  if (cached) return cached;
  let directory = legacyMemoryRoot(root);
  try { directory = boundMemoryRoot(root); }
  catch { /* Startup reports invalid bindings. Optional memory never blocks the service. */ }
  roots.set(root, directory);
  return directory;
}
export const memoryRulesPath = (root: string) => join(memoryRoot(root), "RULES.md");

/** Never follow a managed directory link while creating descendants. */
export function ensureMemoryDirectory(path: string) {
  const parent = resolve(path, "..");
  if (parent !== path) ensureMemoryDirectory(parent);
  // Windows rejects mkdir on an existing drive root with EPERM, not EEXIST.
  if (!lstatSync(path, { throwIfNoEntry: false })) {
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new AppError("MEMORY_PATH", "记忆目录不能使用符号链接");
}
function initializeRules(directory: string) {
  ensureMemoryDirectory(directory);
  const path = join(directory, "RULES.md");
  try { writeFileSync(path, memoryRules, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error("记忆规则不是普通文件");
}
/** A complete tree signature detects changes during copying, including large artifacts. */
function tree(directory: string): Map<string, string> {
  const entries = new Map<string, string>();
  const visit = (path: string, name: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || realpathSync(path) !== path || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw Error("旧记忆包含链接或特殊文件，未迁移");
    entries.set(name, `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`);
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child), name ? `${name}/${child}` : child);
  };
  visit(directory, "");
  return entries;
}
function copyTree(source: string, target: string, oldRoot: string, newRoot: string) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) { mkdirSync(to, { mode: 0o700 }); copyTree(from, to, oldRoot, newRoot); }
    else if (entry.isFile() && lstatSync(from).nlink === 1) {
      copyFileSync(from, to, constants.COPYFILE_EXCL);
      if (/\.(md|txt)$/i.test(entry.name) && lstatSync(to).size <= 4 * 1024 * 1024) {
        const bytes = readFileSync(to);
        // Leave binary/invalid UTF-8 files untouched, including their original BOM.
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { continue; }
        let rewritten = text;
        const spellings = [oldRoot, oldRoot.replaceAll("\\", "/"), encodeURI(oldRoot.replaceAll("\\", "/"))];
        const replacements = [newRoot, newRoot.replaceAll("\\", "/"), encodeURI(newRoot.replaceAll("\\", "/"))];
        for (let index = 0; index < spellings.length; index++)
          for (const separator of ["/", "\\"]) rewritten = rewritten.split(`${spellings[index]}${separator}`).join(`${replacements[index]}${separator}`);
        if (rewritten !== text) writeFileSync(to, rewritten);
      }
    } else throw Error("旧记忆包含链接或特殊文件，未迁移");
  }
}
function sameTree(left: string, right: string): boolean {
  const a = [...tree(left).keys()], b = [...tree(right).keys()];
  return JSON.stringify(a) === JSON.stringify(b) && a.every((name) => {
    const l = join(left, name), r = join(right, name);
    return lstatSync(l).isDirectory() ? lstatSync(r).isDirectory() : lstatSync(r).isFile() && readFileSync(l).equals(readFileSync(r));
  });
}

/** Called once under Store's exclusive lock. Originals remain as a recovery copy. */
export function initializeMemoryStorage(root: string, sessionIds: string[], target?: string) {
  root = canonical(root);
  // A committed location is authoritative even when its entry was later deleted.
  if (existsSync(bindingPath(root))) {
    roots.delete(root);
    const directory = boundMemoryRoot(root);
    initializeRules(directory); roots.set(root, directory); return;
  }
  const oldRoot = legacyMemoryRoot(root);
  const destination = target ?? (root === canonical(defaultDataRoot()) ? join(canonical(homedir()), ".axiom", "memory") : oldRoot);
  if (destination === oldRoot) { initializeRules(oldRoot); return; }
  ensureMemoryDirectory(destination);
  const originals: Array<[string, string]> = [];
  for (const id of sessionIds) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw Error("记忆会话标识无效");
    const source = join(oldRoot, id), final = join(destination, id);
    if (!existsSync(source)) continue;
    const signature = JSON.stringify([...tree(source)]);
    const stage = mkdtempSync(join(destination, ".migration-"));
    try {
      copyTree(source, stage, oldRoot, destination);
      tree(stage);
      if (JSON.stringify([...tree(source)]) !== signature) throw Error("迁移期间旧记忆改变，保留原目录");
      if (existsSync(final)) {
        if (!sameTree(stage, final)) throw Error(`目标记忆已存在不同内容，保留原目录：${id}`);
      } else renameSync(stage, final);
      originals.push([source, signature]);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  for (const [source, signature] of originals) if (JSON.stringify([...tree(source)]) !== signature) throw Error("迁移期间旧记忆改变，保留原目录");
  initializeRules(destination);
  // Publish complete JSON atomically under Store's exclusive lock.
  const pending = mkdtempSync(join(root, ".memory-location-"));
  try {
    const path = join(pending, "binding.json");
    writeFileSync(path, JSON.stringify({ version: 1, dataRoot: root, directory: destination }), { flag: "wx", mode: 0o600 });
    if (existsSync(bindingPath(root))) throw Error("记忆目录绑定已变化，未覆盖");
    renameSync(path, bindingPath(root));
  } finally { rmSync(pending, { recursive: true, force: true }); }
  roots.set(root, destination);
}
