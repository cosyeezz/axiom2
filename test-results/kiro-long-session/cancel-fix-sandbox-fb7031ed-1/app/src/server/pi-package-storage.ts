import "./pi-settings-storage.js";
import { recoverProcessOwner } from "./process-owner-record.js";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { lstatSync, realpathSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PiPackageRequest } from "./pi-package-protocol.js";

type Parsed = { type: "npm"; name: string; version?: string } | { type: "git"; host: string; path: string } | { type: "local"; path: string };
export function assertPackagePath(root: string, target: string) {
  const tail = relative(resolve(root), resolve(target));
  if (tail === ".." || tail.startsWith(`..${sep}`) || isAbsolute(tail)) throw Error("包路径不在托管范围内。");
  let at = realpathSync(root);
  for (const part of tail.split(sep).filter(Boolean)) {
    at = join(at, part);
    try { if (lstatSync(at).isSymbolicLink()) throw Error("托管包路径被链接替换，未执行文件操作。"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
}
export function piPackagePlan(request: PiPackageRequest) {
  const settingsPath = request.local ? join(request.cwd, ".pi", "settings.json") : join(request.agentDir, "settings.json");
  const settingsRoot = request.local ? request.cwd : dirname(request.agentDir);
  assertPackagePath(dirname(request.agentDir), join(request.agentDir, "settings.json"));
  assertPackagePath(request.cwd, join(request.cwd, ".pi", "settings.json"));
  const settings = SettingsManager.create(request.cwd, request.agentDir, { projectTrusted: true });
  if (settings.drainErrors().length) throw Error("资源配置无法读取。");
  const manager = new DefaultPackageManager({ cwd: request.cwd, agentDir: request.agentDir, settingsManager: settings });
  const parse = Reflect.get(manager, "parseSource") as ((source: string) => Parsed) | undefined;
  if (typeof parse !== "function") throw Error("资源包管理器版本不兼容。");
  const parsed = parse.call(manager, request.source);
  const base = request.local ? join(request.cwd, ".pi") : request.agentDir;
  const resolveLocal = Reflect.get(manager, request.fromSettings ? "resolvePathFromBase" : "resolvePath");
  const source = parsed.type === "local" ? resolveLocal.call(manager, parsed.path, base) as string : request.source;
  const normalize = Reflect.get(manager, "normalizePackageSourceForSettings");
  if (typeof normalize !== "function") throw Error("资源包管理器版本不兼容。");
  const storedSource = normalize.call(manager, source, request.local ? "project" : "user") as string;
  let directory: string | undefined = parsed.type === "local" ? source : undefined;
  if (parsed.type === "npm") {
    if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(parsed.name) || parsed.version && !/^[a-zA-Z0-9.*+~^|<>= _-]+$/.test(parsed.version)) throw Error("npm 包名或版本格式无效。");
    directory = join(base, "npm", "node_modules", ...parsed.name.split("/"));
    for (const name of ["package.json", "package-lock.json", "npm-shrinkwrap.json"]) assertPackagePath(settingsRoot, join(base, "npm", name));
  } else if (parsed.type === "git") {
    if (!/^[a-zA-Z0-9.-]+$/.test(parsed.host) || parsed.path.split("/").some(part => !part || part === "." || part === ".." || !/^[a-zA-Z0-9._-]+$/.test(part))) throw Error("Git 包路径格式无效。");
    directory = join(base, "git", parsed.host, ...parsed.path.split("/"));
  }
  if (directory && parsed.type !== "local") {
    assertPackagePath(settingsRoot, directory);
    for (const name of ["package.json", "package-lock.json", "node_modules", ".git"]) assertPackagePath(settingsRoot, join(directory, name));
  }
  const match = Reflect.get(manager, "packageSourcesMatch") as (existing: unknown, input: string, scope: string) => boolean;
  if (typeof match !== "function") throw Error("资源包管理器版本不兼容。");
  const matches = (entry: unknown) => match.call(manager, entry, source, request.local ? "project" : "user");
  const initial = (request.local ? settings.getProjectSettings() : settings.getGlobalSettings()).packages ?? [];
  return { manager, parsed, source, storedSource, directory, settingsPath, settingsRoot, matches, initialIdentity: JSON.stringify(initial.filter(matches)) };
}

function removalRecord(request: PiPackageRequest, plan = piPackagePlan(request)) {
  const key = plan.parsed.type === "npm" ? ["npm", plan.parsed.name] : plan.parsed.type === "git" ? ["git", plan.parsed.host, plan.parsed.path] : ["local", plan.source];
  const directory = join(dirname(plan.settingsPath), "axiom-package-removals");
  const file = join(directory, `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`);
  assertPackagePath(plan.settingsRoot, file);
  return { plan, directory, file };
}
export function listPiPackageRemovals(request: Pick<PiPackageRequest, "cwd" | "agentDir" | "local">) {
  const directory = join(request.local ? join(request.cwd, ".pi") : request.agentDir, "axiom-package-removals");
  try { lstatSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  assertPackagePath(request.local ? request.cwd : dirname(request.agentDir), directory);
  let names: string[];
  try { names = readdirSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return names.filter(name => name.endsWith(".json")).map(name => {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw Error("资源包待清理记录名称无效，请检查记录。");
    const file = join(directory, name);
    assertPackagePath(request.local ? request.cwd : dirname(request.agentDir), file);
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value?.format !== 1 || typeof value.source !== "string" || !value.source || value.source.length > 1000) throw Error("资源包待清理记录无效，未开始清理。");
    const planned = removalRecord({ ...request, action: "remove", source: value.source, fromSettings: true });
    if (planned.file !== file) throw Error("资源包待清理记录与来源不一致。");
    return { source: value.source as string, path: file, directory: planned.plan.directory, managed: planned.plan.parsed.type !== "local" };
  });
}
export function finishPiPackageRemoval(request: PiPackageRequest) {
  const { plan, file } = removalRecord(request);
  if (plan.initialIdentity !== "[]") throw Error("资源包声明已被重新添加，请刷新核实；待清理记录已保留。");
  if (plan.parsed.type !== "local" && plan.directory && existsSync(plan.directory)) throw Error("资源包目录仍存在，已保留待清理记录；请检查共享依赖或文件权限后重试。");
  rmSync(file, { force: true });
}

/** Hold across files and configuration, not merely the final settings write.
 * npm packages in one prefix share a dependency tree; Git repos are independent. */
export async function lockPiPackage(request: PiPackageRequest) {
  const plan = piPackagePlan(request), base = request.local ? join(request.cwd, ".pi") : request.agentDir;
  const target = (plan.parsed.type === "npm" ? join(base, "npm") : plan.parsed.type === "git" ? plan.directory! : plan.settingsPath) + ".axiom-operation";
  const unresolved = `${target}.unconfirmed.json`;
  assertPackagePath(plan.settingsRoot, `${target}.lock`);
  assertPackagePath(plan.settingsRoot, unresolved);
  mkdirSync(dirname(target), { recursive: true });
  const module = await import(new URL("./core/settings-manager.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
  const storage = new module.FileSettingsStorage(request.cwd, request.agentDir);
  let release: () => void;
  try { release = storage.acquireLockSyncWithRetry(target); }
  catch { throw Error("同一安装目录正在维护，请等待该任务完成后重试。"); }
  try {
    if (existsSync(unresolved) && !recoverProcessOwner(unresolved)) throw Error("此安装目录有退出未确认的进程记录，请先核实后台进程；未开始新操作。");
    if (request.action === "install" && existsSync(removalRecord(request).file)) throw Error("此资源包卸载尚未完成，请先清理残留文件再安装。");
  }
  catch (error) { release(); throw error; }
  return { release, ownerPath: unresolved, unconfirmed() { if (!existsSync(unresolved)) writeFileSync(unresolved, JSON.stringify({ recordedAt: Date.now(), action: request.action }) + "\n", { flag: "wx", mode: 0o600 }); } };
}

/** Parent-only commit: installer cancellation cannot truncate settings. Merge under
 * the same SDK file lock, retaining unrelated concurrent package declarations. */
export async function commitPiPackage(request: PiPackageRequest, initialIdentity: string, signal: AbortSignal) {
  const plan = piPackagePlan(request), pending = request.action === "remove" ? removalRecord(request, plan) : undefined;
  const module = await import(new URL("./core/settings-manager.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as { FileSettingsStorage: new (cwd: string, agentDir: string) => { acquireLockSyncWithRetry(path: string): () => void } };
  signal.throwIfAborted();
  assertPackagePath(plan.settingsRoot, plan.settingsPath);
  mkdirSync(dirname(plan.settingsPath), { recursive: true });
  const storage = new module.FileSettingsStorage(request.cwd, request.agentDir);
  if (typeof storage.acquireLockSyncWithRetry !== "function") throw Error("资源配置锁版本不兼容。");
  const release = storage.acquireLockSyncWithRetry(plan.settingsPath), temp = `${plan.settingsPath}.${randomUUID()}.tmp`;
  try {
    assertPackagePath(plan.settingsRoot, plan.settingsPath);
    let current: Record<string, unknown>;
    try { current = JSON.parse(readFileSync(plan.settingsPath, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; current = {}; }
    if (!current || typeof current !== "object" || Array.isArray(current) || current.packages !== undefined && !Array.isArray(current.packages)) throw Error("资源配置格式无效。");
    const packages = (current.packages ?? []) as (string | { source: string })[];
    if (JSON.stringify(packages.filter(plan.matches)) !== initialIdentity) throw Error("此包声明已被其他操作修改，请刷新核实；未覆盖新配置。");
    const previous = packages.find(plan.matches);
    if (pending) {
      assertPackagePath(plan.settingsRoot, pending.file);
      mkdirSync(pending.directory, { recursive: true, mode: 0o700 });
      // SettingsManager reads also take the SDK lock: never recreate it here.
      // Publish complete intent before withdrawing references; no deletion starts on write failure.
      if (!existsSync(pending.file)) {
        const staged = `${pending.file}.${randomUUID()}.tmp`;
        try {
          writeFileSync(staged, JSON.stringify({ format: 1, source: plan.storedSource, recordedAt: Date.now() }) + "\n", { flag: "wx", mode: 0o600 });
          renameSync(staged, pending.file);
        } finally { rmSync(staged, { force: true }); }
      } else {
        const record = JSON.parse(readFileSync(pending.file, "utf8"));
        if (record?.format !== 1 || record.source !== plan.storedSource) throw Error("资源包待清理记录与当前来源不一致，请刷新核实。");
      }
    }
    current.packages = packages.filter(item => !plan.matches(item));
    if (request.action === "install") (current.packages as unknown[]).push(typeof previous === "object" ? { ...previous, source: plan.storedSource } : plan.storedSource);
    signal.throwIfAborted();
    writeFileSync(temp, JSON.stringify(current, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temp, plan.settingsPath);
  } finally { rmSync(temp, { force: true }); release(); }
}
