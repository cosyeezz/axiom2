import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { withPiSettingsLock, writePiSettingsBytes } from "./pi-settings-storage.js";
import { lockResourcePaths, withResourceFiles } from "./resource-file-lock.js";
import { beginNpmOperation, claimNpmOperation, listNpmPending, type NpmOperation, type NpmPending } from "./resource-npm-operation.js";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DefaultPackageManager, SettingsManager, getAgentDir, loadSkills, type McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import { AppError, object, text, type Command } from "../shared/protocol.js";
import { skillImportName } from "../shared/skill-import.js";
import { importSkillName, nameImportedSkill } from "./skill-import.js";
import { changeResourceReferences, type ResourceReferenceChange } from "./resource-references.js";
import { configProjection, restoreConfig } from "./resource-config.js";
import type { ResourceDetail, ResourceItem, ResourceJob, ResourceScope, ResourceState } from "../shared/resources.js";
import type { Store } from "./storage.js";
import { capabilityFileDigest, discoverCapabilities, skillId } from "./capability-resources.js";
import { runPiPackage } from "./pi-package-process.js";
import { listPiPackageRemovals, piPackagePlan } from "./pi-package-storage.js";
import { MaintenanceError } from "../shared/maintenance.js";
import { runMaintenance, maintenancePhase } from "./maintenance.js";
import { findNpmCli, type OpenCliExecute } from "./integrations/opencli.js";
import { runRtk, assertToolProcessesStopped } from "./integrations/rtk-process.js";
import { reaConfigPath } from "./integrations/rea-runtime.js";

type McpConfig = ReturnType<NonNullable<McpExtensionOptions["loadConfig"]>>["servers"][number]["config"];
// Version-bound Pi 1.1.0 bridge, matching capability discovery. No extension is executed here.
const piEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const validation = import(new URL("./core/mcp-servers.js", piEntry).href) as Promise<{ validateMcpServerConfig(name: string, raw: unknown): McpConfig | string }>;
type AuthBackend = { withLock<T>(fn: (raw: string | undefined) => { result: T; next?: string }): T };
const authStorage = import(new URL("./core/auth-storage.js", piEntry).href) as Promise<{ FileAuthStorageBackend: new (path: string) => AuthBackend }>;
const oauth = import(new URL("./extensions/mcp/oauth.js", piEntry).href) as Promise<{ McpOAuthCredentialStore: new (backend: AuthBackend, lockDir: string) => { forServer(name: string, url: string): { withRefreshLock<T>(fn: () => Promise<T>): Promise<T> } } }>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fileIdentity(path: string) {
  try { const stat = lstatSync(path); return digest([capabilityFileDigest(path), realpathSync(path), stat.isSymbolicLink(), stat.isDirectory()]); }
  catch { return capabilityFileDigest(path); }
}
const mcpOverride = (raw: any) => raw && typeof raw === "object" && !Array.isArray(raw) && !["command", "url", "type"].some(key => key in raw);
const inside = (parent: string, child: string) => { const p = relative(resolve(parent), resolve(child)); return p !== "" && !p.startsWith(`..${sep}`) && p !== ".." && !isAbsolute(p); };
function json(path: string): Record<string, any> {
  try { const value = JSON.parse(readFileSync(path, "utf8")); if (!value || Array.isArray(value) || typeof value !== "object") throw Error(); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new AppError("RESOURCE_FILE_INVALID", "资源配置无法读取，请修复文件后重试；未覆盖原文件。"); }
}
function atomic(path: string, value: unknown) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new AppError("RESOURCE_SHARED", "配置文件通过链接共享或已被替换，未覆盖文件；请先检查原来源。");
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
function npmSpec(value: unknown) {
  const spec = text(value, "npm 包名", 250).replace(/^npm:/, "");
  const match = /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z0-9._-]+))?$/.exec(spec);
  if (!match) throw new AppError("INVALID_INPUT", "请填写 npm 包名，可附加版本号或 dist-tag。");
  return { spec, name: match[1] };
}
export type ResourceNpmExecute = (args: string[], options: Parameters<OpenCliExecute>[1] & { onStopped: (proof: "not-started" | "tree-cleaned") => void }) => Promise<string>;
const executeResourceNpm: ResourceNpmExecute = async (args, options) => (await runRtk(process.execPath, args, {
  root: options.cwd, env: options.env, signal: options.signal, timeout: options.timeout, output: "tail", onStopped: options.onStopped,
})).toString("utf8");
type Managed = { scopeId?: string; id: string; kind: "skill" | "mcp"; name: string; source: string; directory: string; paths?: string[]; version?: string; bin?: string };
type Target = { builtin?: boolean; sharedOwned?: boolean; referenceOnly?: boolean; item: ResourceItem; skillPaths?: string[]; path?: string; managed?: Managed; package?: { source: string; cwd: string; local: boolean }; mcp?: { path: string; raw: any }[] };
type Operation = { replacements?: Target[]; job: ResourceJob; controller: AbortController; keys: string[]; checks: { read: () => unknown; identity: string }[]; pending?: Promise<void>; npm?: NpmOperation; npmSettled?: boolean };
function canonical(path: string): string {
  let at = resolve(path), tail: string[] = [];
  while (!existsSync(at) && dirname(at) !== at) { tail.unshift(basename(at)); at = dirname(at); }
  const value = join(realpathSync(at), ...tail);
  return process.platform === "win32" ? value.toLowerCase() : value;
}
export class Resources {
  private state: ResourceState = { revision: "", items: [], scopes: [], warnings: [] };
  private targets = new Map<string, Target>();
  private files = new Map<string, string>();
  private operations = new Map<string, Operation>();
  private reserved = new Map<string, string>();
  private refreshPending?: Promise<ResourceState>;
  private commitEpoch = 0;
  private closed = false;
  private readonly recordsPath: string;
  private readonly jobPath: string;
  constructor(readonly store: Store, readonly sharedPiDir: string, private readonly publish: () => void,
    private readonly beforeChange: () => Promise<void>, private readonly execute: ResourceNpmExecute = executeResourceNpm) {
    this.recordsPath = join(store.root, "resources", "installed.json");
    this.jobPath = join(store.root, "resources", "job.json");
    const persisted = json(this.jobPath);
    const saved = (Array.isArray(persisted.jobs) ? persisted.jobs : persisted.job ? [persisted.job] : []) as ResourceJob[];
    this.state.jobs = saved.map(job => ({ ...job, running: false, ...(job.running ? { message: "上次操作被中断", error: "请刷新检查实际资源；未自动重复操作。" } : {}) }));
    this.state.job = this.state.jobs.at(-1);
  }
  get busy() { return this.operations.size > 0; }
  snapshot() { return structuredClone(this.state); }
  private records(): Managed[] { const records = json(this.recordsPath).items ?? []; if (!Array.isArray(records)) throw Error("资源安装记录无效。"); return records; }
  private npmPending() { return listNpmPending(join(this.store.root, "resources")); }
  private npmDomain(record: NpmPending) { return record.kind === "mcp" ? this.mcpPath(this.scope(record.scopeId)) : this.settings(record.scopeId); }
  private npmLive(record: NpmPending) {
    if (this.operations.get(record.jobId)?.npm) return true;
    try { const claim = claimNpmOperation(join(this.store.root, "resources"), record, this.npmDomain(record)); claim.close(); return false; }
    catch (error) { return error instanceof AppError && error.code === "RESOURCE_BUSY"; }
  }
  private directoryReferenced(directory: string, ignoreRecord?: string, project?: (path: string, config: any) => any) {
    const root = canonical(directory);
    const overlap = (path: string, parents = false) => { const value = canonical(path); return value === root || inside(root, value) || parents && inside(value, root); };
    if (this.records().some(record => record.id !== ignoreRecord && [record.directory, ...(record.paths ?? [])].some(path => overlap(path, true)))) return true;
    for (const path of this.resourceFiles().filter(path => ["settings.json", "mcp.json"].includes(basename(path)))) {
      const config = project ? project(path, json(path)) : json(path);
      if (basename(path) === "settings.json") {
        for (const entry of [...(Array.isArray(config.skills) ? config.skills : []), ...(Array.isArray(config.packages) ? config.packages : [])]) {
          const source = typeof entry === "string" ? entry : entry?.source;
          if (typeof source !== "string" || /^(npm:|git:|https?:|[!-])/.test(source)) continue;
          const value = source.replace(/^\+/, "");
          if (overlap(value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(path), value), true)) return true;
        }
      } else {
        const mentioned = (value: unknown): boolean => {
          if (typeof value === "string") {
            const normalized = value.replace(/\\/g, "/"), candidate = process.platform === "win32" ? normalized.toLowerCase() : normalized;
            const needle = root.replace(/\\/g, "/");
            return candidate.includes(needle) || isAbsolute(value) && overlap(value);
          }
          return !!value && typeof value === "object" && Object.values(value).some(mentioned);
        };
        if (mentioned(config.mcpServers)) return true;
      }
    }
    return false;
  }
  private assertDirectoryRemoval(directory: string, context?: Operation, ignoreRecord?: string, project?: (path: string, config: any) => any) {
    const pending = this.npmPending().filter(record => record.directory === directory);
    if (pending.some(record => !context?.npm?.ready || context.npm.record.jobId !== record.jobId)) throw new MaintenanceError("stop-unconfirmed", `安装进程退出尚未确认或父提交尚未完成，已保留文件与记录。位置：${directory}`);
    if (context?.npm && [context.npm.record.directory, context.npm.record.previous?.directory].includes(directory)) context.npm.assertDirectory(directory);
    if (this.directoryReferenced(directory, ignoreRecord, project)) throw new AppError("RESOURCE_COMMIT_PENDING", "仍有配置或安装记录引用此目录，已保留文件；请核实提交或回滚结果。");
    assertToolProcessesStopped(directory);
  }
  private removeDirectory(directory: string, context?: Operation, locked = false, ignoreRecord?: string) {
    const work = () => {
      this.assertDirectoryRemoval(directory, context, ignoreRecord);
      rmSync(directory, { recursive: true, force: true });
    };
    return locked ? work() : withResourceFiles(this.resourceFiles(), work);
  }
  private recoverNpmPending() {
    for (const pending of this.npmPending()) {
      if (this.operations.has(pending.jobId) || pending.format !== 2 || pending.phase !== "ready" || pending.unconfirmed) continue;
      let claim: NpmOperation | undefined;
      try {
        claim = claimNpmOperation(join(this.store.root, "resources"), pending, this.npmDomain(pending));
        withResourceFiles(this.resourceFiles(), () => {
          claim!.assertDirectory(); assertToolProcessesStopped(pending.directory);
          const record = this.records().find(record => record.directory === pending.directory && record.kind === pending.kind && (record.scopeId ?? "global") === pending.scopeId);
          if (record) {
            if (!existsSync(pending.directory)) return;
            let complete = false;
            if (record.kind === "skill" && record.paths?.length) {
              const settingsPath = this.settings(pending.scopeId), skills = json(settingsPath).skills;
              complete = Array.isArray(skills) && record.paths.every(path => inside(pending.directory, path) && skills.some(entry => {
                if (typeof entry !== "string" || /^[!-]/.test(entry)) return false;
                const value = entry.replace(/^\+/, "");
                return canonical(value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settingsPath), value)) === canonical(path);
              }));
            } else if (record.kind === "mcp" && record.name === pending.name) {
              const config = json(this.mcpPath(this.scope(pending.scopeId))).mcpServers?.[record.name];
              complete = Array.isArray(config?.args) && config.args.some((arg: unknown) => typeof arg === "string" && isAbsolute(arg) && inside(pending.directory, arg));
            }
            if (!complete) return; // A partial commit stays available for repair.
            if (pending.previous && existsSync(pending.previous.directory)) {
              claim!.assertDirectory(pending.previous.directory);
              this.removeDirectory(pending.previous.directory, undefined, true);
            }
          } else {
            if (this.directoryReferenced(pending.directory)) return;
            assertToolProcessesStopped(pending.directory);
            rmSync(pending.directory, { recursive: true, force: true });
          }
          const saved = json(this.jobPath), jobs: ResourceJob[] = Array.isArray(saved.jobs) ? saved.jobs : saved.job ? [saved.job] : [];
          const prior = jobs.find(job => job.id === pending.jobId);
          this.persistJobs([prior && !prior.running ? prior : { ...prior, id: pending.jobId, running: false, scopeId: pending.scopeId,
            label: prior?.label ?? pending.name ?? pending.packageName, message: "已核实上次安装的目录与引用，未重新执行安装。", error: "上次任务被中断；已恢复文件与配置记录，请核实资源实际状态。" }], true);
          claim!.finish(); this.commitEpoch++;
        });
      } catch { /* Busy, changed identities, and ambiguous commits retain the gate. */ }
      finally { claim?.close(); }
    }
  }
  private save(records: Managed[]) { atomic(this.recordsPath, { items: records }); }
  private scopes(): ResourceScope[] { return [{ id: "global", name: "全局", kind: "global" }, ...this.store.workspaces().filter(w => w.authorized).map(w => ({ id: w.id, name: w.name, path: w.path, kind: "project" as const }))]; }
  private scope(id: unknown = "global") {
    const scope = this.scopes().find(s => s.id === id);
    if (!scope) throw new AppError("RESOURCE_SCOPE_MISSING", "项目已移除或未授权，请重新选择作用范围。");
    return scope;
  }
  private settings(scopeId = "global") { const scope = this.scope(scopeId); return scope.path ? join(scope.path, ".pi", "settings.json") : join(this.store.root, "pi", "settings.json"); }
  private mcpPath(scope: ResourceScope) { return scope.path ? join(scope.path, ".pi", "mcp.json") : join(this.sharedPiDir, "mcp.json"); }
  private mcpId(path: string, name: string) { return path === join(this.sharedPiDir, "mcp.json") ? `mcp:${name}` : `mcp:${digest(path)}:${name}`; }
  private contexts() { return [this.store.root, ...this.store.workspaces().filter(w => w.authorized).map(w => w.path)]; }
  private manager(cwd: string) {
    const settingsManager = SettingsManager.create(cwd, join(this.store.root, "pi"), { projectTrusted: true });
    if (settingsManager.drainErrors().length) throw Error("技能设置格式无效，请先修复设置文件。");
    return { settingsManager, manager: new DefaultPackageManager({ cwd, agentDir: join(this.store.root, "pi"), settingsManager }) };
  }
  refresh(_finishing = false): Promise<ResourceState> {
    if (this.refreshPending) return this.refreshPending;
    this.refreshPending = (async () => {
      this.recoverNpmPending();
      while (!await this.scan(this.commitEpoch)) { /* A commit invalidated this scan; read again. */ }
      return this.snapshot();
    })().finally(() => { this.refreshPending = undefined; });
    return this.refreshPending;
  }
  private async scan(epoch: number) {
    const targets = new Map<string, Target>(), files = new Map<string, string>(), warnings = new Set<string>();
    let invalidated = false;
    const track = (path: string) => {
      const identity = fileIdentity(path);
      if (files.has(path)) { if (files.get(path) !== identity) invalidated = true; }
      else files.set(path, identity);
    };
    track(this.recordsPath); track(this.settings());
    const records = this.records();
    for (const pending of this.npmPending()) if (pending.unconfirmed || !this.npmLive(pending)) warnings.add(`资源安装进程或配置提交尚未确认，相关操作已阻止，文件保留于：${pending.directory}`);
    const scopes = this.scopes();
    for (const scope of scopes) { track(this.settings(scope.id)); track(this.mcpPath(scope)); }
    for (const cwd of this.contexts()) { track(join(cwd, ".pi", "settings.json")); track(join(cwd, ".pi", "mcp.json")); }
    const add = (target: Omit<Target, "item"> & { item: Omit<ResourceItem, "scopeId"> & { scopeId?: string } }) => { if (!targets.has(target.item.id)) targets.set(target.item.id, { ...target, item: { scopeId: "global", ...target.item } }); };
    const packages: { root: string; id: string }[] = [];
    const packageReferences: { root: string; id?: string }[] = [];
    const skillScopes = new Map<string, Map<string, string>>();
    const scopedSkills = new Map<string, { name: string; description: string; source: string; builtin?: undefined; fallback?: undefined }[]>();
    const identity = (path: string) => { try { return skillId(realpathSync(path)); } catch { return skillId(path); } };
    for (const cwd of this.contexts()) {
      const { manager } = this.manager(cwd);
      const resolved = await manager.resolve(async () => "skip"), map = new Map<string, string>();
      for (const resource of [...resolved.extensions, ...resolved.skills, ...resolved.prompts, ...resolved.themes])
        if (resource.metadata.origin === "top-level" && !resource.path.startsWith("builtin:")) packageReferences.push({ root: resource.path });
      scopedSkills.set(cwd, []);
      for (const entry of resolved.skills.filter(e => e.enabled)) {
        const scopeId = entry.metadata.scope === "project" ? scopes.find(s => s.path === cwd)?.id : "global";
        const loaded = loadSkills({ cwd, agentDir: join(this.store.root, "pi"), skillPaths: [entry.path], includeDefaults: false });
        for (const guide of loaded.skills) {
          if (!map.has(identity(guide.filePath))) map.set(identity(guide.filePath), scopeId ?? "unregistered");
          scopedSkills.get(cwd)!.push({ name: guide.name, description: guide.description, source: guide.filePath });
        }
      }
      skillScopes.set(cwd, map);
      for (const pkg of manager.listConfiguredPackages()) {
        const local = pkg.scope === "project", settingsPath = local ? join(cwd, ".pi", "settings.json") : this.settings();
        track(settingsPath);
        const id = digest([settingsPath, pkg.source]);
        const owned = !!pkg.installedPath && (inside(join(this.store.root, "pi", "npm"), pkg.installedPath) || inside(join(this.store.root, "pi", "git"), pkg.installedPath) || local && (inside(join(cwd, ".pi", "npm"), pkg.installedPath) || inside(join(cwd, ".pi", "git"), pkg.installedPath)));
        if (pkg.installedPath) { packages.push({ root: pkg.installedPath, id }); packageReferences.push({ root: pkg.installedPath, id }); }
        add({ item: { id, scopeId: local ? scopes.find(s => s.path === cwd)?.id ?? "global" : "global", kind: "package", name: pkg.source, description: "pi 资源包 · 包含的技能与其他资源一起管理", source: pkg.installedPath ?? settingsPath, managed: owned, removable: true,
          cleanup: ["移除 pi 包声明", ...(owned ? [`删除托管包及其依赖：${pkg.installedPath}`] : ["外部共享源文件保留（本应用不拥有）"])], note: local ? `工作空间：${cwd}` : "应用级资源包" }, package: { source: pkg.source, cwd, local } });
      }
    }
    for (const scope of scopes) {
      const local = scope.kind === "project", cwd = scope.path ?? this.store.root, settingsPath = this.settings(scope.id);
      track(join(dirname(settingsPath), "axiom-package-removals"));
      let removals: ReturnType<typeof listPiPackageRemovals>;
      try { removals = listPiPackageRemovals({ cwd, local, agentDir: join(this.store.root, "pi") }); }
      catch { warnings.add(`${scope.name}的资源包待清理记录无法核实，请检查目录链接、记录格式与权限后刷新；未自动清理。`); continue; }
      for (const pending of removals) {
        track(pending.path); track(settingsPath);
        const id = digest([settingsPath, pending.source]);
        const note = "卸载尚未完成。请继续清理；完成前不能重新安装或更新此包。";
        const existing = targets.get(id);
        if (existing) { existing.item.removalPending = true; existing.item.note = note; }
        else add({ package: { source: pending.source, cwd, local }, item: { id, scopeId: scope.id, kind: "package", name: pending.source,
          description: "pi 资源包 · 卸载待清理", source: pending.directory ?? settingsPath, managed: pending.managed, removable: true, removalPending: true,
          cleanup: ["确认此范围的包声明已移除", ...(pending.managed ? [`清理托管包及其依赖：${pending.directory}`] : ["外部共享源文件保留（本应用不拥有）"]), "移除待清理记录"], note } });
        if (pending.directory) { packages.push({ root: pending.directory, id }); packageReferences.push({ root: pending.directory, id }); }
      }
    }
    for (const record of records) {
      if (!inside(join(this.store.root, "resources"), record.directory)) throw Error("资源安装记录路径无效。");
      if (!scopes.some(s => s.id === (record.scopeId ?? "global"))) { warnings.add("已移除项目的安装记录保留在磁盘，请恢复项目授权后管理。"); continue; }
      const guides = record.kind === "skill" ? loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: record.paths ?? [], includeDefaults: false }).skills : [];
      guides.forEach(guide => track(guide.filePath));
      if (record.kind === "skill") add({ item: { scopeId: record.scopeId ?? "global", id: record.id, kind: "skill", name: guides.map(s => s.name).join("、") || record.name, description: guides[0]?.description ?? "应用安装的技能", source: record.source, version: record.version, managed: true, removable: true,
        cleanup: [`删除安装目录及依赖：${record.directory}`, "移除技能路径、安装记录和默认选择"] }, managed: record, skillPaths: guides.map(guide => guide.filePath) });
      track(record.directory); track(join(record.directory, "package.json"));
    }
    const mcpPaths = new Set([join(this.sharedPiDir, "mcp.json"), ...this.contexts().map(cwd => join(cwd, ".pi", "mcp.json"))]);
    for (const cwd of this.contexts()) {
      const catalog = await discoverCapabilities(this.store.root, cwd, this.sharedPiDir);
      catalog.warnings.forEach(w => warnings.add(w));
      catalog.files.forEach(file => { if (capabilityFileDigest(file.path) !== file.digest) invalidated = true; track(file.path); });
      for (const server of catalog.config.servers.filter(server => server.source === reaConfigPath(this.store.root))) {
        add({ builtin: true, item: { id: "builtin:rea:mcp", kind: "mcp", name: server.name, description: "REA 内置 MCP 服务", source: server.source, builtin: "rea",
          managed: true, removable: false, cleanup: [], note: "由内置工具 REA 管理；安装、卸载、更新和默认启用请到内置工具设置。" } });
      }
      // Management must include scoped copies hidden by runtime name precedence.
      const catalogPaths = new Set(catalog.skills.map(skill => identity(skill.source)));
      const scopedName = (skill: { name: string; source: string }) => `${skillScopes.get(cwd)?.get(identity(skill.source)) ?? "global"}:${skill.name}`;
      const catalogNames = new Set(catalog.skills.map(scopedName));
      const hidden = (scopedSkills.get(cwd) ?? []).filter(skill => {
        const key = scopedName(skill);
        if (catalogPaths.has(identity(skill.source)) || catalogNames.has(key)) return false;
        catalogNames.add(key); return true;
      });
      for (const skill of [...catalog.skills, ...hidden]) {
        const scopeId = skillScopes.get(cwd)?.get(identity(skill.source)) ?? "global";
        if (scopeId === "unregistered") continue;
        if (skill.builtin && !skill.fallback) {
          add({ builtin: true, skillPaths: [skill.source], item: { id: `skill:${skillId(skill.source)}`, kind: "skill", name: skill.name, description: skill.description, builtin: skill.builtin,
            source: skill.source, managed: true, removable: false, cleanup: [], note: `随内置 ${skill.builtin === "rea" ? "REA" : "OpenCLI"} 安装包提供；安装、卸载及更新请到内置工具设置。` } });
          continue;
        }
        if (records.some(record => (record.scopeId ?? "global") === scopeId && record.paths?.some(path => skill.source === path || inside(path, skill.source)))) continue;
        const owner = packages.find(pkg => inside(pkg.root, skill.source) && targets.get(pkg.id)?.item.scopeId === scopeId);
        if (owner) { const target = targets.get(owner.id)!; (target.skillPaths ??= []).push(skill.source); continue; }
        // A linked guide owns only its link, never its containing directory.
        const path = basename(skill.source) === "SKILL.md" && !lstatSync(skill.source).isSymbolicLink() ? dirname(skill.source) : skill.source;
        const linked = lstatSync(path).isSymbolicLink();
        const protectedPath = this.contexts().some(cwd => resolve(cwd) === resolve(path)) || [this.sharedPiDir, this.store.root, join(this.sharedPiDir, "skills")].includes(resolve(path));
        // Configured roots may themselves use OS aliases (e.g. /var on macOS).
        // Below those roots an ancestor symlink gives no ownership of its descendants.
        const roots = new Set([this.sharedPiDir, ...this.contexts()].map(value => resolve(value)));
        let parent = dirname(path), linkedParent = false;
        while (parent !== dirname(parent) && !roots.has(resolve(parent))) {
          if (lstatSync(parent).isSymbolicLink()) { linkedParent = true; break; }
          parent = dirname(parent);
        }
        const externalPackage = path.split(sep).includes("node_modules") || !linked && realpathSync(path).split(sep).includes("node_modules");
        const removable = !protectedPath && !externalPackage && !linkedParent;
        track(path);
        add({ item: { scopeId, id: scopeId === "global" ? `skill:${skillId(skill.source)}` : `skill:${scopeId}:${skillId(skill.source)}`, kind: "skill", name: skill.name, description: skill.description, source: skill.source, managed: false, removable, deletable: removable && !linked,
          cleanup: [linked ? `移除技能链接：${path}（链接目标及同目录其他文件保留）` : `删除技能及目录内附属文件：${path}`, "移除直接路径引用和默认选择"], note: linkedParent ? "技能位于父目录链接中，请通过链接来源或原安装管理器处理，应用不删除其目标内的文件。" : externalPackage ? "由外部工具包提供，请通过其安装管理器卸载。" : "本机技能；修改会影响共享此路径的其他程序。" }, path, skillPaths: [skill.source] });
      }
    }
    for (const path of mcpPaths) {
      track(path);
      const config = json(path);
      if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) throw Error("MCP 配置格式无效。");
      for (const [name, raw] of Object.entries(config.mcpServers ?? {})) {
        const scopeId = path === join(this.sharedPiDir, "mcp.json") ? "global" : scopes.find(s => s.path && join(s.path, ".pi", "mcp.json") === path)?.id ?? "global", id = this.mcpId(path, name);
        const record = records.find(r => r.kind === "mcp" && r.name === name && (r.scopeId ?? "global") === scopeId && (scopeId !== "global" || path === join(this.sharedPiDir, "mcp.json")));
        const globalNames = Object.keys(json(join(this.sharedPiDir, "mcp.json")).mcpServers ?? {});
        const target: Target = { item: { id, scopeId, kind: "mcp", name, description: scopeId !== "global" && !(raw as any)?.command && !(raw as any)?.url ? "项目覆盖 · 继承全局连接" : typeof (raw as any)?.url === "string" ? "远程 MCP 服务" : "本地 MCP 服务", source: path, version: record?.version, managed: !!record, removable: true,
          cleanup: [`仅删除${scopeId === "global" ? "全局" : "此项目"}配置中的 ${name}`, "清理不再被其他配置使用的 OAuth 凭据和默认选择", ...(record ? [`删除独立安装目录及依赖：${record.directory}`] : ["外部共享可执行程序及公共缓存保留（本应用不拥有）"])],
          note: scopeId !== "global" && globalNames.includes(name) ? "本项目覆盖了全局同名 MCP。删除项目配置后，全局定义会重新生效；如不想使用，请将本项目配置的 enabled 设为 false。" : scopeId === "global" ? "所有项目可使用；项目同名定义优先。共享配置也可能被终端 pi 使用。" : "仅在此项目中生效，其他项目和全局定义不受修改影响。" }, managed: record, mcp: [{ path, raw }] };
        target.item.cleanup.push(`配置：${path}`); add(target);
      }
    }
    for (const record of records.filter(r => r.kind === "mcp")) if (scopes.some(s => s.id === (record.scopeId ?? "global")) && ![...targets.values()].some(t => t.managed?.id === record.id)) add({ item: { id: `orphan:${record.id}`, scopeId: record.scopeId ?? "global", kind: "mcp", name: record.name, description: "安装目录待清理", source: record.directory, managed: true, removable: true, cleanup: [`删除遗留安装目录及依赖：${record.directory}`, "移除安装记录"] }, managed: record, mcp: [] });
    // Package roots protect all resource types, including filtered/disabled packages.
    for (const target of targets.values()) if (target.package && target.item.managed) {
      const own = packages.find(pkg => pkg.id === target.item.id);
      if (own && packageReferences.some(reference => {
        if (reference.id === target.item.id) return false;
        try { const root = realpathSync(own.root), path = realpathSync(reference.root); return identity(root) === identity(path) || inside(root, path); } catch { return false; }
      })) {
        target.sharedOwned = true; target.item.removable = false;
        target.item.note = "其他资源声明仍引用此包目录。请先解除这些引用，再更新或卸载。";
      }
    }
    // A discovery scope is not file ownership: detach shared/ancestor guides
    // from this scope, never delete a file still used by another scope.
    for (const target of targets.values()) if (!target.builtin && target.skillPaths?.length) {
      const scope = scopes.find(s => s.id === target.item.scopeId)!;
      const shared = [...targets.values()].some(other => other !== target && other.item.scopeId !== target.item.scopeId && other.skillPaths?.some(path => target.skillPaths!.some(own => identity(path) === identity(own))));
      if (shared && (target.managed || target.package)) {
        target.sharedOwned = true;
        target.item.removable = false;
        target.item.note = "其他作用范围仍引用此资源。请先移除其他范围的引用，再编辑、更新或卸载安装文件。";
      } else if (target.path && (shared || scope.path && !inside(scope.path, target.path))) {
        target.referenceOnly = true;
        target.item.removable = true;
        target.item.cleanup = ["仅移除此作用范围的技能引用，并加入排除规则", "保留技能正文、脚本和其他作用范围的引用"];
        target.item.note = "此技能文件由其他项目或全局共享；此处仅管理引用，文件内容需到原来源编辑。";
      }
    }
    for (const target of targets.values()) if (target.item.kind === "skill") {
      const protectedRoot = target.path && [join(this.store.root, "pi", "skills"), ...scopes.flatMap(s => s.path ? [join(s.path, ".pi", "skills")] : [])].some(path => resolve(path) === resolve(target.path!));
      target.item.deletable = !protectedRoot && !target.builtin && (!!target.managed || target.item.deletable === true);
      const owner = [...targets.values()].find(other => other.managed?.kind === "skill" && other.skillPaths?.some(path => target.skillPaths?.some(guide => canonical(guide) === canonical(path))));
      // Reference-only rows retain physical ownership, including the installation record in another scope.
      if (target.referenceOnly && target.path && !protectedRoot && target.item.deletable) target.item.deleteCleanup = [`永久删除共享技能目录及全部附属文件：${owner?.managed?.directory ?? target.path}`, "清理安装记录、所有已授权范围的直接路径引用、默认选择和会话选择；其他使用此文件的程序也会受影响"];
      target.item.renamable = !!(target.item.deletable && !(owner ?? target).managed?.source.startsWith("npm:") && this.guides(owner ?? target).length === 1);
      if (!target.item.renamable) target.item.renameBlockedReason = "链接、内置技能及多技能资源包需在原来源管理名称。";
      target.item.movable = !!(!protectedRoot && target.item.removable && !target.referenceOnly && !target.sharedOwned && (target.managed || target.path && !lstatSync(target.path).isSymbolicLink()));
      if (!target.item.movable) target.item.moveBlockedReason = "此技能由其他范围、链接或外部安装器共享，请先在原来源解除共享后移动。";
      target.item.copyable = target.item.movable;
      target.item.copyBlockedReason = target.item.moveBlockedReason;
    }
    for (const target of targets.values()) if (target.item.kind === "mcp") {
      const entry = target.mcp?.[0], scope = scopes.find(s => s.id === target.item.scopeId)!;
      const reason = target.builtin ? "此 MCP 由内置工具管理，作用范围固定为全局，无需移动。"
        : !entry ? "连接配置已不存在，请先恢复配置或清理遗留安装。"
        : target.mcp!.length !== 1 || entry.path !== this.mcpPath(scope) ? "此配置不属于独立的全局或项目来源，请先整理配置文件。"
        : mcpOverride(entry.raw) ? "此项目配置继承全局连接，请先保存完整连接配置后再移动。"
        : scope.kind === "global" && entry.raw?.auth ? "此 MCP 使用仅限全局的认证供应商，不能移入项目。" : undefined;
      const inherited = scope.kind === "global" && [...targets.values()].some(other => other !== target && other.item.name === target.item.name && other.mcp?.some(e => mcpOverride(e.raw)));
      target.item.copyable = !reason;
      target.item.copyBlockedReason = reason;
      target.item.movable = !reason && !inherited;
      target.item.moveBlockedReason = reason ?? (inherited ? "其他项目仍通过局部覆盖继承此全局连接，请先处理这些覆盖配置再移动。" : undefined);
      target.item.renamable = !target.builtin && !!entry && !mcpOverride(entry.raw);
      if (!target.item.renamable) target.item.renameBlockedReason = "请在原来源管理内置服务，继承配置需先保存完整连接配置。";
      target.item.deletable = target.item.removable;
    }
    if (invalidated || epoch !== this.commitEpoch || [...files].some(([path, hash]) => fileIdentity(path) !== hash)) return false;
    this.targets = targets; this.files = files;
    this.state = { ...this.state, scopes, items: [...targets.values()].map(t => t.item), warnings: [...warnings], revision: digest([scopes, [...files]]) };
    this.publish(); return true;
  }
  private assertFiles(context: Operation) {
    context.controller.signal.throwIfAborted();
    for (const check of context.checks) if (digest(check.read()) !== check.identity)
      throw new AppError("REVISION_CONFLICT", "此资源的文件或配置已改变，请刷新后重试。");
  }
  private persistJobs(updates: ResourceJob[], locked = false) {
    const work = () => {
      const saved = json(this.jobPath), prior: ResourceJob[] = Array.isArray(saved.jobs) ? saved.jobs : saved.job ? [saved.job] : [];
      const merged = new Map(prior.map(job => [job.id, job]));
      for (const job of updates) merged.set(job.id, job);
      const all = [...merged.values()], recent = new Set(all.filter(job => !job.running && !job.error).slice(-30).map(job => job.id));
      const jobs = all.filter(job => job.running || job.error || recent.has(job.id)), job = jobs.at(-1);
      atomic(this.jobPath, { job, jobs });
      this.state.jobs = jobs; this.state.job = job;
    };
    return locked ? work() : withResourceFiles([this.jobPath], work);
  }
  private notify() { this.persistJobs([...this.operations.values()].map(operation => operation.job)); this.publish(); }
  private conflicting(keys: string[], owner?: string) {
    return keys.some(key => [...this.reserved.entries()].some(([held, jobId]) => jobId !== owner && (key === held || key.startsWith("path:") && held.startsWith("path:") && (key.startsWith(held + sep) || held.startsWith(key + sep)))));
  }
  private resourceFiles(target?: Target, extra: string[] = []) {
    return [...new Set([this.recordsPath, ...this.scopes().flatMap(scope => [this.settings(scope.id), this.mcpPath(scope)]),
      ...[...this.files.keys()].filter(path => ["settings.json", "mcp.json"].includes(basename(path))),
      ...(target?.path ? [target.path] : []), ...(target?.managed ? [target.managed.directory] : []), ...extra])];
  }
  private physicalFiles(target?: Target) { return [target?.path, target?.managed?.directory].filter((path): path is string => !!path); }
  private commitFiles<T>(context: Operation, target: Target | undefined, work: () => T, extra: string[] = []) {
    const release = lockResourcePaths(this.physicalFiles(target));
    try { return withResourceFiles(this.resourceFiles(undefined, extra), () => {
      this.assertFiles(context);
      if (context.npm) {
        context.npm.assertDirectory(undefined, true);
        if (context.npm.record.previous) context.npm.assertDirectory(context.npm.record.previous.directory, true);
      }
      return work();
    }); }
    finally { release(); }
  }
  private reserveSkillNames(context: Operation, scopeId: string, names: string[]) {
    const keys = names.map(name => "skill-name:" + canonical(this.settings(scopeId)) + ":" + name);
    if (this.conflicting(keys, context.job.id)) throw new AppError("RESOURCE_BUSY", "同名技能正在安装或移动，请等待对应任务完成后重试；未覆盖技能配置。");
    const paths = [
      ...[...this.targets.values()].filter(target => target.item.id !== context.job.targetId && target.item.scopeId === scopeId).flatMap(target => target.skillPaths ?? []),
      ...this.records().filter(record => record.id !== context.job.targetId && (record.scopeId ?? "global") === scopeId && record.kind === "skill").flatMap(record => record.paths ?? []),
    ];
    const settingsPath = this.settings(scopeId), entries = json(settingsPath).skills ?? [];
    if (!Array.isArray(entries)) throw new AppError("RESOURCE_FILE_INVALID", "技能路径配置格式无效，未覆盖原配置。");
    paths.push(join(dirname(settingsPath), "skills"));
    if (scopeId === "global") paths.push(join(this.sharedPiDir, "skills"));
    for (const entry of entries) if (typeof entry === "string" && !/^[!-]/.test(entry)) {
      const value = entry.replace(/^\+/, "");
      paths.push(value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settingsPath), value));
    }
    const own = context.job.targetId ? this.targets.get(context.job.targetId) : undefined;
    const excluded = new Set(own ? this.guides(own).map(path => canonical(path)) : []);
    const existing = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [...new Set(paths)], includeDefaults: false }).skills;
    if (existing.some(skill => !excluded.has(canonical(skill.filePath)) && names.includes(skill.name))) throw new AppError("RESOURCE_CONFLICT", "此作用范围已有同名技能，请修改技能名称；未覆盖已有技能文件或配置。");
    for (const key of keys) if (!context.keys.includes(key)) { context.keys.push(key); this.reserved.set(key, context.job.id); }
  }
  private prepare(p: Record<string, unknown>, target: Target | undefined, scope: ResourceScope, op: string): Operation {
    const transfer = op === "resources.move" || op === "resources.copy";
    const keys = new Set<string>(), checks: Operation["checks"] = [];
    const check = (read: () => unknown) => checks.push({ read, identity: digest(read()) });
    const pathKey = (path: string) => keys.add("path:" + canonical(path));
    const kind = target?.item.kind ?? p.kind;
    const label = target?.item.name ?? (typeof p.name === "string" && p.name.trim() ? p.name.trim()
      : kind === "package" ? "pi 资源包" : typeof p.source === "string" ? p.source.startsWith("npm:") || kind === "mcp" ? npmSpec(p.source).name : basename(p.source) : "技能与 MCP");
    const resource = "resources:" + (target?.item.id ?? digest([scope.id, kind, p.name, p.source]));
    if (target) keys.add("target:" + target.item.id);
    if (kind === "package") {
      const request = { action: op === "resources.remove" ? "remove" as const : "install" as const, source: target?.package?.source ?? text(p.source, "pi 包来源", 1000), cwd: target?.package?.cwd ?? scope.path ?? this.store.root, local: scope.kind === "project", fromSettings: !!target, agentDir: join(this.store.root, "pi") };
      const plan = piPackagePlan(request);
      if (plan.parsed.type === "npm") pathKey(join(dirname(plan.settingsPath), "npm"));
      else if (plan.parsed.type === "git") pathKey(plan.directory!);
      else keys.add("packages:" + canonical(plan.settingsPath));
      check(() => { const entries = json(plan.settingsPath).packages ?? []; return entries.filter(plan.matches); });
    } else if (kind === "mcp") {
      const name = target?.item.name ?? text(p.name, "MCP 名称", 128);
      keys.add("mcp-name:" + name.replace(/-/g, "_"));
      for (const path of new Set([...(target?.mcp?.map(entry => entry.path) ?? [this.mcpPath(scope)]), ...(transfer ? [this.mcpPath(this.scope(p.destinationScopeId))] : [])]))
        check(() => json(path).mcpServers?.[name] ?? null);
    } else {
      const paths = [...(target?.skillPaths ?? []), ...(target?.managed?.paths ?? []), ...(target?.path ? [target.path] : [])];
      for (const path of paths) pathKey(path);
      const source = typeof p.source === "string" ? p.source : target?.managed?.source;
      const name = target?.item.name ?? (typeof p.name === "string" && p.name.trim() ? p.name.trim() : source && !source.startsWith("npm:") ? skillImportName(source) : undefined);
      const names = target ? loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: target.skillPaths ?? [], includeDefaults: false }).skills.map(skill => skill.name) : name ? [name] : [];
      for (const name of names) for (const id of [scope.id, ...(transfer ? [this.scope(p.destinationScopeId).id] : [])]) keys.add("skill-name:" + canonical(this.settings(id)) + ":" + name);
      if (transfer && target?.path) pathKey(join(dirname(this.settings(this.scope(p.destinationScopeId).id)), "skills", basename(target.path)));
      if (target) for (const settingsPath of this.files.keys()) if (basename(settingsPath) === "settings.json") check(() => {
        const entries = json(settingsPath).skills ?? [];
        return entries.filter((entry: unknown) => {
          if (typeof entry !== "string") return false;
          const value = entry.replace(/^[+!-]/, ""), absolute = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settingsPath), value);
          return paths.some(path => resolve(path) === absolute || inside(absolute, path));
        });
      });
    }
    const replacements = transfer && target && p.overwrite === true ? this.transferReplacements(target, this.scope(p.destinationScopeId)) : [];
    if (replacements.length) {
      for (const other of replacements) {
        const protectedTarget = this.prepare({}, other, this.scope(other.item.scopeId), "resources.detail");
        protectedTarget.keys.forEach(key => keys.add(key)); checks.push(...protectedTarget.checks);
      }
    }
    if (target?.managed) check(() => this.records().find(record => record.id === target.managed!.id) ?? null);
    const roots = [target?.path, target?.managed?.directory, ...(target?.skillPaths ?? [])].filter((path): path is string => !!path);
    for (const path of roots) pathKey(path);
    for (const path of this.files.keys()) if (roots.some(root => path === root || inside(root, path))) check(() => fileIdentity(path));
    return { replacements, job: { id: randomUUID(), running: true, label, message: "正在准备资源操作…", scopeId: scope.id, operation: op, targetId: target?.item.id, resource }, controller: new AbortController(), keys: [...keys], checks };
  }
  async command(c: Command) {
    if (c.op === "resources.get") return this.refresh();
    if (c.op === "resources.detail") return this.detail(object(c.params ?? {}));
    if (!["resources.install", "resources.update", "resources.remove", "resources.rename", "resources.save", "resources.move", "resources.copy"].includes(c.op)) throw new AppError("UNKNOWN_OPERATION", "不支持的资源操作。");
    if (this.closed) throw new AppError("RESOURCE_BUSY", "后台正在关闭，未开始新的资源操作。");
    const p = object(c.params ?? {});
    if (c.op === "resources.install" && p.id !== undefined) throw new AppError("INVALID_INPUT", "新增资源不能指定已有资源标识；替换已有资源请使用更新操作。");
    const previous = this.state.revision;
    if (typeof p.id === "string" && [...this.operations.values()].some(operation => operation.job.targetId === p.id))
      throw new AppError("RESOURCE_BUSY", "此资源正在维护，请等待对应任务完成；其他资源可以继续操作。");
    await this.refresh();
    if (this.closed) throw new AppError("RESOURCE_BUSY", "后台正在关闭，未开始新的资源操作。");
    if (p.revision !== previous || p.revision !== this.state.revision) throw new AppError("REVISION_CONFLICT", "资源目录已变化，请刷新后重试。");
    let target = p.id ? this.targets.get(text(p.id, "资源标识")) : undefined;
    if (c.op !== "resources.install" && !target) throw new AppError("RESOURCE_MISSING", "资源不存在，请刷新。");
    const scope = this.scope(target?.item.scopeId ?? p.scopeId);
    const kind = target?.item.kind ?? p.kind, source = target?.managed?.source ?? p.source;
    const packageName = typeof source === "string" && (kind === "mcp" || source.startsWith("npm:")) ? npmSpec(source).name : undefined;
    const name = target?.item.name ?? p.name;
    const pendingNpm = this.npmPending().find(record => !this.operations.has(record.jobId) &&
      (target && record.targetId === target.item.id || record.scopeId === scope.id && record.kind === kind &&
        (kind === "mcp" ? typeof name === "string" && name.replace(/-/g, "_") === record.name?.replace(/-/g, "_") : record.packageName === packageName)));
    if (pendingNpm) {
      if (this.npmLive(pendingNpm)) throw new AppError("RESOURCE_BUSY", "另一个宿主仍在维护此资源或提交配置，请等待对应任务完成；其他资源可以继续操作。");
      throw new MaintenanceError("stop-unconfirmed", "此资源的上次安装进程或配置提交尚未确认，已保留目录与记录；未重复安装或删除文件。");
    }
    if (target?.builtin) throw new AppError("BUILTIN_RESOURCE", "此资源由内置工具管理，请到内置工具设置更新或重新安装。");
    if (target?.sharedOwned && !(c.op === "resources.remove" && p.force === true && target.item.deletable || c.op === "resources.rename" && target.item.renamable)) throw new AppError("RESOURCE_SHARED", "其他作用范围仍引用此资源，请先移除这些引用再编辑、更新或卸载。");
    if (target?.item.removalPending && c.op !== "resources.remove") throw new AppError("RESOURCE_REMOVAL_PENDING", "此资源包卸载尚未完成，请先清理残留文件。");
    if (c.op === "resources.move" || c.op === "resources.copy") {
      const destination = this.scope(p.destinationScopeId);
      if (p.overwrite !== undefined && typeof p.overwrite !== "boolean") throw new AppError("INVALID_INPUT", "覆盖选项必须为布尔值。");
      if (!(c.op === "resources.copy" ? target!.item.copyable : target!.item.movable) || destination.id === scope.id || (destination.kind !== "global" && scope.kind !== "global"))
        throw new AppError("INVALID_INPUT", (c.op === "resources.copy" ? target!.item.copyBlockedReason : target!.item.moveBlockedReason) ?? "请选择可独立管理的技能或 MCP，在项目与全局之间复制或移动。");
      if (p.overwrite === true) for (const other of this.transferReplacements(target!, destination)) this.assertReplaceable(other, target!);
    }
    if (c.op === "resources.rename" && !target!.item.renamable) throw new AppError("INVALID_INPUT", target!.item.renameBlockedReason ?? "此资源不支持改名。");
    if (c.op === "resources.remove" && (!(p.force === true ? target!.item.deletable : target!.item.removable) || p.confirm !== true)) throw new AppError("INVALID_INPUT", "请确认此资源的清理范围。");
    if (target?.item.kind === "skill" && !target.managed && (c.op === "resources.rename" || c.op === "resources.remove" && p.force === true)) {
      const selected = target;
      const owner = [...this.targets.values()].find(other => other.managed?.kind === "skill" && other.skillPaths?.some(path => selected.skillPaths?.some(guide => canonical(guide) === canonical(path))));
      if (owner) target = { ...target, managed: owner.managed, skillPaths: owner.skillPaths };
    }
    const context = this.prepare(p, target, scope, c.op), job = context.job;
    if (this.conflicting(context.keys)) throw new AppError("RESOURCE_BUSY", "此资源或共享安装目录正在维护，请等待对应任务完成；其他资源可以继续操作。");
    for (const key of context.keys) this.reserved.set(key, job.id);
    this.operations.set(job.id, context);
    this.state.jobs = [...(this.state.jobs ?? []).filter(old => old.running || old.error), ...(this.state.jobs ?? []).filter(old => !old.running && !old.error).slice(-30), job];
    this.state.job = job;
    try { this.notify(); }
    catch {
      this.operations.delete(job.id); for (const key of context.keys) this.reserved.delete(key);
      job.running = false; job.error = "无法保存资源作业记录，尚未修改资源。请检查文件权限后重试。";
      this.publish(); throw new AppError("RESOURCE_STATE_FAILED", job.error);
    }
    let refreshed = false;
    context.pending = Promise.resolve().then(() => runMaintenance(this.store.root, { id: job.id, resource: job.resource!, label: job.label!, action: c.op.slice(10), scope: scope.id === "global" ? "应用级" : "项目：" + scope.name + " (" + scope.id + ")", params: p, cancel: true, controllable: true, steps: c.op === "resources.remove" ? ["checking", "removing", "validating"] : ["checking", "installing", "validating"] }, context.controller, async () => {
      await this.beforeChange(); this.scope(scope.id); this.assertFiles(context);
      maintenancePhase(c.op === "resources.remove" ? "removing" : "installing");
      if (c.op === "resources.move" || c.op === "resources.copy") {
        const destination = this.scope(p.destinationScopeId), copy = c.op === "resources.copy", overwrite = p.overwrite === true;
        job.resourceId = target!.item.kind === "mcp" ? await this.moveMcp(context, target!, destination, copy, overwrite) : await this.moveSkill(context, target!, destination, copy, overwrite);
      }
      else if (c.op === "resources.rename") job.resourceId = await this.rename(context, target!, text(p.name, "新名称", 200));
      else if (c.op === "resources.save") await this.saveContent(context, p, target!);
      else if (c.op === "resources.remove") await this.remove(context, target!, p.clearCredentials === true, p.force === true);
      else if (target?.package) await this.updatePackage(context, target);
      else if ((target?.item.kind ?? p.kind) === "skill") await this.installSkill(context, { ...p, scopeId: scope.id }, target);
      else if ((target?.item.kind ?? p.kind) === "mcp") await this.installMcp(context, { ...p, scopeId: scope.id }, target);
      else if (p.kind === "package") await this.installPackage(context, { ...p, scopeId: scope.id });
      else throw new AppError("INVALID_INPUT", "请选择技能或 MCP。");
      this.commitEpoch++;
      context.controller.signal.throwIfAborted();
      maintenancePhase("validating");
      try { await this.refresh(true); refreshed = true; }
      catch { throw new AppError("RESOURCE_VERIFY_FAILED", "资源文件已处理，但目录刷新失败，无法确认最终结果。请刷新核实，不要直接重复操作。"); }
      if (c.op === "resources.remove" && this.targets.has(target!.item.id))
        throw new AppError("RESOURCE_VERIFY_FAILED", "卸载后仍发现此资源，操作未完成。请刷新核实来源和引用配置。");
      job.message = (job.commit ? "已核实 Git 提交 " + job.commit + "。" : job.version ? "已核实版本 " + job.version + "。" : "已完成。") + "新会话使用更新后的资源；已有会话可重载资源，卸载的锁定能力需新建会话后重新选择。";
    })).catch(error => {
      job.message = "操作未完成";
      job.error = error instanceof AppError || error instanceof MaintenanceError ? error.message : "资源操作失败，请检查来源、文件权限和网络后刷新核实。已完成的清理不会自动回滚。";
    }).finally(async () => {
      this.commitEpoch++;
      if (!refreshed) try { await this.refresh(true); } catch {
        this.state.warnings = ["资源目录刷新失败，请修复配置后重试。"];
        job.error ??= "资源目录刷新失败，无法确认最终结果，请刷新核实。";
      }
      job.running = false;
      let persisted = false;
      try { this.notify(); persisted = true; }
      catch {
        job.error = "资源操作结果未能保存，请刷新核实实际资源；不要自动重复操作。";
        try { this.publish(); } catch { /* Retain the in-memory result. */ }
      }
      finally {
        try { if (persisted && context.npmSettled) context.npm?.finish(); }
        catch {
          job.error = "资源结果已处理，但维护记录未能清理；请刷新核实，未自动重复安装。";
          try { this.notify(); } catch { /* Keep the durable gate for recovery. */ }
        } finally { context.npm?.close(); this.operations.delete(job.id); for (const key of context.keys) this.reserved.delete(key); }
      }
    });
    return { ...this.snapshot(), acceptedJobId: job.id };
  }
  private guides(target: Target) {
    return [...new Set((target.skillPaths ?? []).flatMap(path => {
      try { return lstatSync(path).isDirectory() ? loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [path], includeDefaults: false }).skills.map(s => s.filePath) : [path]; }
      catch { return []; }
    }))];
  }
  private describe(target: Target): ResourceDetail {
    const projection = configProjection(target.mcp?.[0]?.raw);
    const detail: ResourceDetail = { id: target.item.id, revision: this.state.revision, location: target.mcp?.[0]?.path ?? target.path ?? target.managed?.directory ?? target.item.source,
      source: target.managed?.source ?? target.package?.source, bin: target.managed?.bin,
      config: target.mcp?.length ? JSON.stringify(projection.value, null, 2) : undefined, masked: projection.masked, documents: [], warnings: [] };
    let bytes = 0;
    for (const path of this.guides(target).slice(0, 20)) {
      try {
        const size = statSync(path).size; bytes += size;
        if (bytes > 256 * 1024) { detail.warnings.push("技能内容超过 256 KiB，未加载剩余文件；请在本机编辑器查看。"); break; }
        const content = readFileSync(path, "utf8");
        detail.documents.push({ path, name: basename(dirname(path)), content,
          editable: !target.referenceOnly && target.item.removable && !target.package && !target.managed?.source.startsWith("npm:") && !lstatSync(path).isSymbolicLink() && (!target.path || !lstatSync(target.path).isSymbolicLink()) });
      } catch { detail.warnings.push("部分技能文件无法读取，请刷新或检查文件权限。"); }
    }
    if (target.package) detail.warnings.push("包内技能只读；请通过更新整个资源包管理，避免修改在下次更新时被覆盖。");
    if (target.mcp?.length && typeof target.mcp[0].raw?.url === "string") detail.warnings.push("同名且 URL 相同的 MCP 沿用 pi 的共享 OAuth 登录状态；配置范围独立，登录账户不会按项目隔离。");
    if (target.mcp?.length && target.item.scopeId !== "global" && !target.mcp[0].raw?.command && !target.mcp[0].raw?.url) detail.warnings.push("此项目只保存局部覆盖字段，其余连接设置继承全局同名服务。");
    return detail;
  }
  private async detail(p: Record<string, unknown>) {
    await this.refresh();
    const target = this.targets.get(text(p.id, "资源标识"));
    if (!target) throw new AppError("RESOURCE_MISSING", "资源不存在，请刷新。");
    const context = this.prepare({}, target, this.scope(target.item.scopeId), "resources.detail");
    if (this.conflicting(context.keys)) throw new AppError("RESOURCE_BUSY", "此资源正在维护，请完成后读取配置；其他资源可以继续浏览。");
    return this.describe(target);
  }
  private async rename(context: Operation, target: Target, value: string) {
    const name = target.item.kind === "skill" ? importSkillName(value) : value.trim();
    if (target.item.kind === "mcp" && (!/^[A-Za-z0-9_-]{1,128}$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)))
      throw new AppError("INVALID_INPUT", "MCP 名称仅支持字母、数字、下划线和短横线（最多 128 字符）。");
    if (name === target.item.name) return target.item.id;
    const auth = target.mcp ? new (await authStorage).FileAuthStorageBackend(join(this.sharedPiDir, "mcp-auth.json")) : undefined;
    const guide = target.item.kind === "skill" ? this.guides(target)[0] : undefined;
    const oldPath = guide ? target.path ?? dirname(guide) : undefined;
    const directory = oldPath ? lstatSync(oldPath).isDirectory() : false;
    const newPath = oldPath ? join(dirname(oldPath), directory ? name : `${name}.md`) : undefined;
    const newGuide = guide ? directory ? join(newPath!, relative(oldPath!, guide)) : newPath! : undefined;
    const pathChanged = !!newPath && resolve(newPath) !== resolve(oldPath!);
    const release = lockResourcePaths(pathChanged ? [newPath!] : []);
    try { return this.commitFiles(context, target, () => {
      const undo: (() => void)[] = [], changes: ResourceReferenceChange[] = [];
      let moved = false, contentWritten = false;
      const content = guide ? readFileSync(guide) : undefined;
      const writeJson = (path: string, config: unknown) => {
        const before = existsSync(path) ? readFileSync(path) : undefined;
        atomic(path, config);
        undo.push(() => { if (before) writePiSettingsBytes(path, before); else rmSync(path, { force: true }); });
      };
      const rebase = (path: string) => oldPath && (resolve(path) === resolve(oldPath) || inside(oldPath, path))
        ? join(newPath!, relative(oldPath, path)) : path;
      this.store.db.exec("BEGIN IMMEDIATE");
      try {
        if (guide) {
          for (const scopeId of new Set([target.item.scopeId, ...[...this.targets.values()].filter(other => other.skillPaths?.some(path => canonical(path) === canonical(guide))).map(other => other.item.scopeId)])) this.reserveSkillNames(context, scopeId, [name]);
          if (pathChanged) {
            try { lstatSync(newPath!); throw new AppError("RESOURCE_CONFLICT", "目标名称的文件或目录已存在，请使用其他名称。"); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          }
          const stat = lstatSync(guide);
          if (stat.isSymbolicLink() || stat.nlink !== 1 || !stat.isFile()) throw new AppError("RESOURCE_SHARED", "技能文件通过链接共享，请先解除链接再改名。");
          const nextContent = nameImportedSkill(content!.toString("utf8"), name);
          const beforeKeys = [...new Set([skillId(guide), skillId(realpathSync(guide))])];
          if (pathChanged) { renameSync(oldPath!, newPath!); moved = true; }
          writePiSettingsBytes(newGuide!, Buffer.from(nextContent)); contentWritten = true;
          for (const path of this.resourceFiles().filter(path => basename(path) === "settings.json")) {
            const entries = json(path).skills;
            if (!Array.isArray(entries)) continue;
            const rewrite = (entry: unknown) => {
              if (typeof entry !== "string") return entry;
              const prefix = /^[+!-]/.test(entry) ? entry[0] : "", raw = entry.slice(prefix.length);
              const absolute = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : resolve(dirname(path), raw);
              const next = rebase(absolute);
              return next === absolute ? entry : prefix + next;
            };
            if (entries.some(entry => rewrite(entry) !== entry)) undo.push(this.patchArray(path, "skills", entries => entries.map(rewrite)));
          }
          if (target.managed) undo.push(this.patchArray(this.recordsPath, "items", entries => entries.map(record => record.id === target.managed!.id
            ? { ...record, name, directory: rebase(record.directory), paths: record.paths?.map(rebase) } : record), record => record.id));
          changes.push({ kind: "skills", name: target.item.name, source: guide, preferenceKeys: beforeKeys,
            next: { name, source: newGuide!, preferenceKey: skillId(realpathSync(newGuide!)) } });
        } else {
          const entries = [...target.mcp!];
          // Partial project overrides belong to the global connection's identity.
          if (target.item.scopeId === "global") for (const path of this.resourceFiles().filter(path => basename(path) === "mcp.json")) {
            const raw = json(path).mcpServers?.[target.item.name];
            if (raw && mcpOverride(raw) && !entries.some(entry => entry.path === path)) entries.push({ path, raw });
          }
          for (const path of this.resourceFiles().filter(path => basename(path) === "mcp.json")) {
            const servers = json(path).mcpServers ?? {};
            const changedScope = entries.some(entry => entry.path === path);
            if (Object.keys(servers).some(other => other.replace(/-/g, "_") === name.replace(/-/g, "_") && !(other === target.item.name && changedScope) && (other !== name || changedScope)))
              throw new AppError("RESOURCE_CONFLICT", "已有同名 MCP 或工具名称空间冲突，请使用其他名称。");
          }
          const key = "mcp-name:" + name.replace(/-/g, "_");
          if (this.conflicting([key], context.job.id)) throw new AppError("RESOURCE_BUSY", "目标 MCP 名称正在维护，请稍后重试。");
          context.keys.push(key); this.reserved.set(key, context.job.id);
          for (const entry of entries) {
            const config = json(entry.path), raw = config.mcpServers[target.item.name];
            delete config.mcpServers[target.item.name]; config.mcpServers = { ...config.mcpServers, [name]: raw };
            writeJson(entry.path, config);
            changes.push({ kind: "mcp", name: target.item.name, source: entry.path, preferenceKeys: [digest([resolve(entry.path), target.item.name])],
              next: { name, source: entry.path, preferenceKey: digest([resolve(entry.path), name]) } });
          }
          if (target.managed) undo.push(this.patchArray(this.recordsPath, "items", entries => entries.map(record => record.id === target.managed!.id ? { ...record, name } : record), record => record.id));
          if (existsSync(join(this.sharedPiDir, "mcp-auth.json"))) auth!.withLock(raw => {
            const before = raw, data = raw ? JSON.parse(raw) : {}, prefix = `mcp__${target.item.name.replace(/-/g, "_")}|`;
            const normalizedUrl = (value: unknown) => { try { return typeof value === "string" ? String(new URL(value)) : undefined; } catch { return undefined; } };
            const urls = new Set(entries.map(entry => normalizedUrl(entry.raw?.url)).filter((url): url is string => !!url));
            const retainedUrls = new Set(this.resourceFiles().filter(path => basename(path) === "mcp.json").map(path => normalizedUrl(json(path).mcpServers?.[target.item.name]?.url)));
            for (const key of Object.keys(data).filter(key => key.startsWith(prefix) && urls.has(normalizedUrl(key.slice(prefix.length)) ?? ""))) {
              const next = `mcp__${name.replace(/-/g, "_")}|${key.slice(prefix.length)}`;
              if (next === key) continue;
              if (Object.hasOwn(data, next)) throw new AppError("RESOURCE_CONFLICT", "新名称已有登录凭据，请使用其他名称。");
              data[next] = data[key]; if (!retainedUrls.has(normalizedUrl(key.slice(prefix.length)))) delete data[key];
            }
            undo.push(() => auth!.withLock(() => ({ result: undefined, next: before ?? "{}" })));
            return { result: undefined, next: JSON.stringify(data, null, 2) };
          });
        }
        changeResourceReferences(this.store, changes);
        this.store.db.exec("COMMIT");
      } catch (error) {
        if (this.store.db.isTransaction) this.store.db.exec("ROLLBACK");
        let failed = false;
        for (const revert of undo.reverse()) try { revert(); } catch { failed = true; }
        if (contentWritten) try { writePiSettingsBytes(newGuide!, content!); } catch { failed = true; }
        if (moved) try { renameSync(newPath!, oldPath!); } catch { failed = true; }
        if (failed) throw new AppError("RESOURCE_ROLLBACK_FAILED", "改名失败且部分状态未能恢复，请检查文件权限后刷新核实。");
        throw error;
      }
      return guide ? this.targets.get(target.item.id)?.managed ? target.item.id : target.item.scopeId === "global" ? `skill:${skillId(newGuide!)}` : `skill:${target.item.scopeId}:${skillId(newGuide!)}`
        : this.mcpId(target.mcp![0].path, name);
    }); } finally { release(); }
  }
  private async saveContent(context: Operation, p: Record<string, unknown>, target: Target) {
    if (target.mcp?.length) {
      let config: unknown;
      try { config = restoreConfig(JSON.parse(text(p.config, "MCP 配置", 256 * 1024)), target.mcp[0].raw); }
      catch { throw new AppError("INVALID_INPUT", "配置 JSON 或已保存值的占位符无效，请重新加载配置后编辑。"); }
      return this.installMcp(context, { config: JSON.stringify(config), configOnly: true }, target);
    }
    const document = this.describe(target).documents.find(d => d.path === p.path);
    if (!document?.editable) throw new AppError("INVALID_INPUT", "此技能由外部来源或资源包管理，不能在这里直接改写。");
    if (typeof p.content !== "string" || Buffer.byteLength(p.content) > 256 * 1024) throw new AppError("INVALID_INPUT", "技能内容不能为空且不能超过 256 KiB。");
    const stage = join(dirname(document.path), `.axiom-${randomUUID()}.md`);
    try {
      writeFileSync(stage, p.content, { flag: "wx", mode: statSync(document.path).mode });
      const loaded = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [stage], includeDefaults: false });
      if (!loaded.skills.length || loaded.diagnostics.some(d => d.type === "error")) throw new AppError("INVALID_INPUT", "技能内容缺少有效名称或说明，请检查 YAML frontmatter。");
      this.commitFiles(context, target, () => {
        this.reserveSkillNames(context, target.item.scopeId, loaded.skills.map(skill => skill.name));
        renameSync(stage, document.path);
      });
    } finally { rmSync(stage, { force: true }); }
  }
  private async installPackage(context: Operation, p: Record<string, unknown>) {
    const source = text(p.source, "pi 包来源", 1000);
    if (!source.startsWith("npm:") && !source.startsWith("git:")) throw new AppError("INVALID_INPUT", "pi 包来源应以 npm: 或 git: 开头。");
    const scope = this.scope(p.scopeId);
    await this.packageOperation(context, "install", source, scope.path ?? this.store.root, scope.kind === "project");
  }
  private async packageOperation(context: Operation, action: "install" | "remove", source: string, cwd: string, local: boolean, fromSettings = false) {
    const plan = piPackagePlan({ action, source, cwd, local, fromSettings, agentDir: join(this.store.root, "pi") });
    context.job.resourceId = digest([plan.settingsPath, plan.storedSource]);
    const result = await runPiPackage({ action, source, cwd, local, fromSettings, agentDir: join(this.store.root, "pi") }, context.controller.signal);
    Object.assign(context.job, { version: result.version, commit: result.commit });
  }
  private async updatePackage(context: Operation, target: Target) {
    const pkg = target.package!;
    // Operate on this scope only and resolve local references against its settings.
    await this.packageOperation(context, "install", pkg.source, pkg.cwd, pkg.local, true);
  }
  private async npm(context: Operation, directory: string, source: string, kind: "skill" | "mcp", displayName?: string, previousDirectory?: string) {
    const { spec, name } = npmSpec(source);
    const pending: NpmPending = { jobId: context.job.id, directory, scopeId: context.job.scopeId!, kind, name: displayName, packageName: name, targetId: context.job.targetId };
    const operation = context.npm = beginNpmOperation(join(this.store.root, "resources"), pending, this.npmDomain(pending), previousDirectory);
    let launched = false, unconfirmed = false;
    try {
      atomic(join(directory, "package.json"), { private: true });
      const cli = findNpmCli(); launched = true;
      await this.execute([cli, "install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", ...(name.startsWith("@") ? [`--${name.split("/")[0]}:registry=https://registry.npmjs.org`] : []), spec],
        { cwd: directory, env: { ...process.env, npm_config_cache: join(directory, "cache"), npm_config_fetch_timeout: "86400000" }, signal: context.controller.signal, timeout: 600000, onStopped: proof => operation.readyWith(proof) });
    } catch (error) {
      unconfirmed = error instanceof MaintenanceError && error.code === "stop-unconfirmed";
      throw error;
    } finally {
      if (!launched && !operation.ready) operation.readyWith("not-started");
      try { assertToolProcessesStopped(directory); } catch { unconfirmed = true; }
      if (unconfirmed || !operation.ready) {
        operation.retainUnknown();
        throw new MaintenanceError("stop-unconfirmed", `安装进程退出尚未确认，已保留文件与记录。位置：${directory}`);
      }
    }
    const root = join(directory, "node_modules", ...name.split("/")), pkg = json(join(root, "package.json"));
    if (pkg.name !== name) throw Error("npm 包校验失败。");
    if (typeof pkg.version === "string") context.job.version = pkg.version;
    return { root, pkg };
  }
  private withSettingsLock<T>(path: string, write: () => T): T {
    if (basename(path) !== "settings.json") return write();
    try { return withPiSettingsLock(path, write); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ELOCKED") throw new AppError("RESOURCE_BUSY", "此配置正在被其他进程修改，尚未覆盖其内容，请稍后刷新重试。");
      if (code === "SETTINGS_PATH_ALIAS") throw new AppError("RESOURCE_SHARED", (error as Error).message);
      throw error;
    }
  }
  private editSettings(path: string, update: (settings: Record<string, any>) => void) {
    this.withSettingsLock(path, () => { const settings = json(path); update(settings); atomic(path, settings); });
  }
  /** Undo only this operation's array entries; unrelated concurrent commits survive. */
  private patchArray(path: string, field: string, update: (entries: any[]) => any[], key: (entry: any) => string = entry => JSON.stringify(entry)) {
    return this.withSettingsLock(path, () => {
    const existed = existsSync(path), original = existed ? readFileSync(path) : undefined, config = json(path), present = field in config;
    const before = config[field] ?? [];
    if (!Array.isArray(before)) throw new AppError("RESOURCE_FILE_INVALID", "资源路径配置格式无效，未覆盖原文件。");
    const after = update(before), initial = new Map(before.map(entry => [key(entry), entry])), written = new Map(after.map(entry => [key(entry), entry]));
    const changed = new Set([...initial.keys(), ...written.keys()].filter(id => digest(initial.get(id) ?? null) !== digest(written.get(id) ?? null)));
    config[field] = after; atomic(path, config);
    return () => this.withSettingsLock(path, () => {
      const current = json(path), entries = current[field] ?? [];
      if (!Array.isArray(entries)) throw Error("资源恢复时发现配置格式已改变。");
      const actual = new Map(entries.map(entry => [key(entry), entry]));
      for (const id of changed) if (digest(actual.get(id) ?? null) !== digest(written.get(id) ?? null)) throw Error("此资源的配置已被其他程序修改，未覆盖新内容。");
      if (digest(current) === digest(config)) {
        if (original === undefined) rmSync(path, { force: true }); else writePiSettingsBytes(path, original);
        return;
      }
      const restored = entries.flatMap(entry => !changed.has(key(entry)) ? [entry] : initial.has(key(entry)) ? [initial.get(key(entry))] : []);
      for (let index = 0; index < before.length; index++) {
        const entry = before[index], id = key(entry);
        if (!changed.has(id) || actual.has(id)) continue;
        const next = before.slice(index + 1).map(key).find(id => restored.some(entry => key(entry) === id));
        if (next !== undefined) restored.splice(restored.findIndex(entry => key(entry) === next), 0, entry);
        else restored.push(entry);
      }
      if (!present && !restored.length) delete current[field]; else current[field] = restored;
      if (!existed && !Object.keys(current).length) rmSync(path, { force: true }); else atomic(path, current);
    });
    });
  }
  private replacePaths(remove: string[], add: string[], scopeId = "global") {
    this.editSettings(this.settings(scopeId), settings => {
      if (settings.skills !== undefined && !Array.isArray(settings.skills)) throw Error("技能路径格式无效。");
      settings.skills = [...(settings.skills ?? []).filter((v: unknown) => typeof v !== "string" || !remove.some(r => v === r)), ...add];
    });
  }
  private transferReplacements(target: Target, destination: ResourceScope) {
    const names = target.item.kind === "mcp" ? [target.item.name] : this.skillNames(target);
    return [...this.targets.values()].filter(other => other.item.id !== target.item.id && other.item.scopeId === destination.id &&
      (target.item.kind === "mcp" ? other.item.kind === "mcp" && other.item.name === target.item.name : this.skillNames(other).some(name => names.includes(name))));
  }
  private skillNames(target: Target) {
    return loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: target.skillPaths ?? [], includeDefaults: false }).skills.map(skill => skill.name);
  }
  private matchesSkillPath(entry: unknown, settings: string, paths: string[]) {
    if (typeof entry !== "string") return false;
    const value = entry.replace(/^[+!-]/, ""), absolute = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settings), value);
    return paths.some(path => absolute === resolve(path));
  }
  private assertReplaceable(other: Target, source: Target) {
    if (other.builtin || other.sharedOwned || other.referenceOnly || !other.item.removable || other.package || other.item.removalPending ||
      other.item.kind === "skill" && (!other.item.movable || this.skillNames(other).some(name => !this.skillNames(source).includes(name))))
      throw new AppError("RESOURCE_SHARED", "目标同名资源由内置工具、资源包或共享路径管理，不能直接覆盖；请先处理其来源。");
    const sourcePaths = this.physicalFiles(source), otherPaths = this.physicalFiles(other);
    if (sourcePaths.some(a => otherPaths.some(b => canonical(a) === canonical(b) || inside(canonical(a), canonical(b)) || inside(canonical(b), canonical(a)))))
      throw new AppError("RESOURCE_SHARED", "源资源和目标资源共享文件，不能覆盖。");
    if (other.managed) this.assertDirectoryRemoval(other.managed.directory, undefined, other.managed.id, (path, config) => {
      if (other.mcp?.some(entry => entry.path === path)) delete config.mcpServers?.[other.item.name];
      if (path === this.settings(other.item.scopeId) && Array.isArray(config.skills))
        config.skills = config.skills.filter((entry: unknown) => !this.matchesSkillPath(entry, path, [...(other.managed?.paths ?? []), ...this.guides(other)]));
      return config;
    });
  }
  private async copyTree(context: Operation, source: string, destination: string, managed = false) {
    let count = 0, bytes = 0;
    const root = realpathSync(source);
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false, dereference: managed, filter: path => {
      context.controller.signal.throwIfAborted();
      const link = lstatSync(path), actual = realpathSync(path), stat = statSync(path);
      count++; bytes += stat.size;
      if ((!managed && link.isSymbolicLink()) || actual !== root && !inside(root, actual) || !stat.isFile() && !stat.isDirectory() || count > (managed ? 100000 : 10000) || bytes > (managed ? 512 : 50) * 1024 * 1024)
        throw new AppError("INVALID_INPUT", "资源目录包含外部链接、特殊文件或超过复制大小限制。");
      return true;
    } });
  }
  private async moveMcp(context: Operation, target: Target, destination: ResourceScope, copy = false, overwrite = false) {
    const entry = target.mcp![0], name = target.item.name, destinationPath = this.mcpPath(destination);
    const validate = (await validation).validateMcpServerConfig;
    const parsed = validate(name, entry.raw);
    if (typeof parsed === "string") throw new AppError("INVALID_INPUT", "MCP 配置无效，请修复连接配置后再移动。");
    if (destination.kind === "project" && "auth" in parsed && parsed.auth)
      throw new AppError("INVALID_INPUT", "此 MCP 使用仅限全局的认证供应商，不能移入项目。");
    const replacements = overwrite ? context.replacements ?? [] : [];
    const copiedId = copy && target.managed ? randomUUID() : undefined;
    const copiedDirectory = copiedId ? join(this.store.root, "resources", copiedId) : undefined;
    const release = lockResourcePaths([...this.physicalFiles(target), ...replacements.flatMap(other => this.physicalFiles(other))]);
    let committed = false;
    try {
    if (copiedDirectory) await this.copyTree(context, target.managed!.directory, copiedDirectory, true);
    // Only relocate values that are paths (including --option=/path arguments).
    const relocate = (value: any): any => typeof value === "string" ? (() => {
      const old = target.managed!.directory, index = value.indexOf(old);
      return index >= 0 && (index === 0 || value[index - 1] === "=") && (value.length === index + old.length || /[\\/]/.test(value[index + old.length]))
        ? value.slice(0, index) + copiedDirectory + value.slice(index + old.length) : value;
    })() : Array.isArray(value) ? value.map(relocate) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, relocate(entry)])) : value;
    const raw = copiedDirectory ? relocate(entry.raw) : entry.raw;
    const result = withResourceFiles(this.resourceFiles(undefined, [destinationPath]), () => {
    this.scope(target.item.scopeId); this.scope(destination.id); this.assertFiles(context);
    replacements.forEach(other => this.assertReplaceable(other, target));
    const sourceConfig = json(entry.path), destinationConfig = json(destinationPath);
    const names = Object.keys(destinationConfig.mcpServers ?? {});
    if (names.some(other => other.replace(/-/g, "_") === name.replace(/-/g, "_") && !(overwrite && other === name)) || [...this.targets.values()].some(other => other.item.id !== target.item.id && other.item.kind === "mcp" && (other.item.scopeId === destination.id || other.item.name !== name) && other.item.name.replace(/-/g, "_") === name.replace(/-/g, "_") && !(overwrite && other.item.scopeId === destination.id && other.item.name === name)))
      throw new AppError("RESOURCE_CONFLICT", "目标范围已有同名 MCP 或工具名称空间冲突；如需替换同名连接，请勾选覆盖同名资源。");
    for (const path of this.resourceFiles().filter(path => basename(path) === "mcp.json")) {
      for (const [other, raw] of Object.entries(json(path).mcpServers ?? {})) {
        if (path === entry.path && other === name) continue;
        if (other !== name && other.replace(/-/g, "_") === name.replace(/-/g, "_") || !copy && target.item.scopeId === "global" && other === name && mcpOverride(raw))
          throw new AppError("RESOURCE_CONFLICT", "其他范围新增了同名 MCP 覆盖或名称冲突，请刷新后再移动。");
      }
    }
    // A linked configuration may still be used by a different scope.
    for (const path of [entry.path, destinationPath]) {
      if (!existsSync(path)) continue;
      const actual = realpathSync(path);
      if (statSync(path).nlink > 1 || lstatSync(path).isSymbolicLink() || [...this.files.keys()].some(other => other !== path && basename(other) === "mcp.json" && existsSync(other) && realpathSync(other) === actual))
        throw new AppError("RESOURCE_SHARED", "此 MCP 配置文件通过链接共享，请先解除文件链接再移动。");
    }
    if (!copy) delete sourceConfig.mcpServers[name];
    destinationConfig.mcpServers = { ...destinationConfig.mcpServers, [name]: raw };
    const removedIds = new Set(replacements.flatMap(other => other.managed ? [other.managed.id] : []));
    const records = target.managed || removedIds.size ? this.records().filter(record => !removedIds.has(record.id)).flatMap(record => record.id !== target.managed?.id ? [record] : copy
      ? [record, { ...record, id: copiedId!, directory: copiedDirectory!, scopeId: destination.id }]
      : [{ ...record, scopeId: destination.id }]) : undefined;
    const snapshots = [entry.path, destinationPath, ...(records ? [this.recordsPath] : [])].map(path => ({ path, content: existsSync(path) ? readFileSync(path) : undefined }));
    const written: typeof snapshots = [];
    this.store.db.exec("BEGIN");
    try {
      const writes = [[snapshots[1], destinationConfig], ...(!copy ? [[snapshots[0], sourceConfig]] : [])] as [typeof snapshots[number], Record<string, any>][];
      for (const [saved, config] of writes) { atomic(saved.path, config); written.push(saved); }
      if (records) { this.save(records); written.push(snapshots[2]); }
      const row = this.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get();
      if (row) {
        const body = JSON.parse(String(row.body)), before = digest([resolve(entry.path), name]), after = digest([resolve(destinationPath), name]);
        delete body.mcp[after];
        if (before in body.mcp) { body.mcp[after] = body.mcp[before]; if (!copy) delete body.mcp[before]; }
        this.store.db.prepare("UPDATE capability_preferences SET revision=revision+1,body=? WHERE id=1").run(JSON.stringify(body));
      }
      this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL").run();
      this.store.db.exec("COMMIT");
    } catch {
      let failed = false;
      try { if (this.store.db.isTransaction) this.store.db.exec("ROLLBACK"); }
      catch { failed = true; }
      for (const saved of written.reverse()) {
        try {
          if (saved.content === undefined) rmSync(saved.path, { force: true });
          else writeFileSync(saved.path, saved.content);
        } catch { failed = true; }
      }
      if (failed) throw new AppError("RESOURCE_ROLLBACK_FAILED", "MCP 移动失败且部分状态未能恢复，请检查配置文件及数据库权限后刷新核实。");
      throw new AppError("RESOURCE_MOVE_FAILED", "MCP 移动失败，已恢复原配置；请检查文件及数据库权限后重试。");
    }
    committed = true;
    for (const other of replacements) if (other.managed) this.removeDirectory(other.managed.directory, undefined, true);
    return this.mcpId(destinationPath, name);
    });
    return result;
    } finally {
      try { if (copiedDirectory && !committed) this.removeDirectory(copiedDirectory); }
      finally { release(); }
    }
  }
  private async moveSkill(context: Operation, target: Target, destination: ResourceScope, copy = false, overwrite = false) {
    const guides = this.guides(target), names = new Set(loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: guides, includeDefaults: false }).skills.map(s => s.name));
    if (!names.size) throw new AppError("INVALID_INPUT", "技能内容无法读取，请修复后再移动。");
    const replacements = overwrite ? context.replacements ?? [] : [];
    replacements.forEach(other => this.assertReplaceable(other, target));
    const replacedGuides = new Set(replacements.flatMap(other => this.guides(other)).map(path => canonical(path)));
    const { manager } = this.manager(destination.path ?? this.store.root);
    const resolved = await manager.resolve(async () => "skip");
    const candidates = resolved.skills.filter(entry => entry.metadata.scope === (destination.kind === "project" ? "project" : "user")).map(entry => entry.path);
    // Include explicitly scoped resources and shared global guides, even when a
    // same-name guide was hidden by discovery precedence.
    candidates.push(...[...this.targets.values()].filter(t => t.item.id !== target.item.id && t.item.scopeId === destination.id).flatMap(t => t.skillPaths ?? []));
    if (destination.kind === "global") candidates.push(join(this.sharedPiDir, "skills"));
    for (const path of candidates) {
      const loaded = loadSkills({ cwd: destination.path ?? this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [path], includeDefaults: false });
      if (loaded.skills.some(s => names.has(s.name) && !replacedGuides.has(canonical(s.filePath)) && !guides.some(g => realpathSync(g) === realpathSync(s.filePath))))
        throw new AppError("RESOURCE_CONFLICT", "目标范围已有同名技能，请先处理重名后再移动；未覆盖任何文件。");
    }
    const sourceSettings = this.settings(target.item.scopeId), destinationSettings = this.settings(destination.id);
    const sourceConfig = json(sourceSettings), destinationConfig = json(destinationSettings);
    for (const config of [sourceConfig, destinationConfig]) if (config.skills !== undefined && !Array.isArray(config.skills)) throw new AppError("INVALID_INPUT", "技能路径配置无效，请修复后再移动。");
    for (const scope of this.scopes().filter(s => s.id !== target.item.scopeId)) {
      const settingsPath = this.settings(scope.id);
      const entries = json(settingsPath).skills;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry !== "string" || /^[!-]/.test(entry)) continue;
        const value = entry.replace(/^\+/, "");
        const path = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settingsPath), value);
        if (!existsSync(path)) continue;
        const actual = realpathSync(path);
        if (guides.some(guide => { const own = realpathSync(guide); return own === actual || inside(actual, own); }))
          throw new AppError("RESOURCE_SHARED", "其他作用范围仍声明了此技能路径，请先移除共享引用再移动。");
      }
    }
    const copiedId = copy && target.managed ? randomUUID() : undefined;
    const copiedDirectory = copiedId ? join(this.store.root, "resources", copiedId) : undefined;
    const relocate = (path: string) => copiedDirectory ? join(copiedDirectory, relative(target.managed!.directory, path)) : path;
    const oldPaths = target.managed?.paths ?? [target.path!];
    const destinationPath = target.path ? join(dirname(destinationSettings), "skills", basename(target.path)) : undefined;
    const newPaths = target.managed?.paths?.map(relocate) ?? [destinationPath!];
    const matches = (entry: unknown, settings: string, paths: string[]) => {
      if (typeof entry !== "string") return false;
      const value = entry.replace(/^[+!-]/, ""), absolute = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settings), value);
      return paths.some(path => absolute === resolve(path));
    };
    const updateSource = (entries: unknown[]) => entries.filter(entry => !matches(entry, sourceSettings, [...oldPaths, ...guides]));
    const replacedPaths = replacements.flatMap(other => [...(other.managed?.paths ?? []), ...(other.path ? [other.path] : []), ...this.guides(other)]);
    const updateDestination = (entries: unknown[]) => [...entries.filter(entry => typeof entry === "string" && /^[!-]/.test(entry) || !matches(entry, destinationSettings, [...newPaths, ...replacedPaths])), ...newPaths];
    const undo: (() => void)[] = [];
    const replacedBackups = replacements.map(other => {
      const path = other.managed?.directory ?? other.path!;
      return { path, backup: join(dirname(dirname(path)), `.axiom-replace-${randomUUID()}.backup`), placed: false };
    });
    const stage = destinationPath ? join(dirname(dirname(destinationPath)), `.axiom-move-${randomUUID()}.staging`) : undefined;
    const backup = target.path && !copy ? join(dirname(dirname(target.path)), `.axiom-move-${randomUUID()}.backup`) : undefined;
    let backedUp = false, placed = false, committed = false;
    let release: (() => void) | undefined;
    const assertDestination = () => {
      if (!destinationPath) return;
      try { lstatSync(destinationPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (replacedBackups.some(saved => !saved.placed && canonical(saved.path) === canonical(destinationPath))) return;
      throw new AppError("RESOURCE_CONFLICT", "目标位置已存在同名文件或目录，请先处理后再移动；未覆盖任何文件。");
    };
    try {
      release = lockResourcePaths([...this.physicalFiles(target), ...replacements.flatMap(other => this.physicalFiles(other)), ...(destinationPath ? [destinationPath] : [])]);
      assertDestination();
      if (stage) await this.copyTree(context, target.path!, stage);
      if (copiedDirectory) await this.copyTree(context, target.managed!.directory, copiedDirectory, true);
      const configFiles = this.resourceFiles(undefined, [sourceSettings, destinationSettings]);
      let committedIdentity: string;
      const ownSettings = () => [
        (json(sourceSettings).skills ?? []).filter((entry: unknown) => matches(entry, sourceSettings, [...oldPaths, ...guides])),
        (json(destinationSettings).skills ?? []).filter((entry: unknown) => matches(entry, destinationSettings, [...newPaths, ...replacedPaths])),
      ];
      withResourceFiles(configFiles, () => {
      this.scope(target.item.scopeId); this.scope(destination.id); this.assertFiles(context); assertDestination();
      replacements.forEach(other => this.assertReplaceable(other, target));
      for (const saved of replacedBackups) { renameSync(saved.path, saved.backup); saved.placed = true; }
      this.reserveSkillNames(context, destination.id, [...names]);
      if (backup) { renameSync(target.path!, backup); backedUp = true; }
      if (stage) { mkdirSync(dirname(destinationPath!), { recursive: true }); renameSync(stage, destinationPath!); placed = true; }
      if (!copy) undo.push(this.patchArray(sourceSettings, "skills", updateSource));
      undo.push(this.patchArray(destinationSettings, "skills", updateDestination));
      const removedIds = new Set(replacements.flatMap(other => other.managed ? [other.managed.id] : []));
      if (target.managed || removedIds.size) undo.push(this.patchArray(this.recordsPath, "items", entries => entries.filter(record => !removedIds.has(record.id)).flatMap(record => record.id !== target.managed?.id ? [record] : copy
        ? [record, { ...record, id: copiedId!, directory: copiedDirectory!, paths: newPaths, scopeId: destination.id }]
        : [{ ...record, scopeId: destination.id }]), record => record.id));
      committedIdentity = digest(ownSettings());
      });
      const catalog = await discoverCapabilities(this.store.root, destination.path ?? this.store.root, this.sharedPiDir);
      const movedGuides = target.path ? guides.map(guide => guide === target.path ? destinationPath! : join(destinationPath!, relative(target.path!, guide))) : guides.map(relocate);
      const scoped = await this.manager(destination.path ?? this.store.root).manager.resolve(async () => "skip");
      const scopedPaths = scoped.skills.filter(entry => entry.enabled && entry.metadata.scope === (destination.kind === "global" ? "user" : "project")).map(entry => entry.path);
      const scopedGuides = loadSkills({ cwd: destination.path ?? this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: scopedPaths, includeDefaults: false }).skills;
      if (movedGuides.some(guide => !catalog.skills.some(s => resolve(s.source) === resolve(guide)) && !scopedGuides.some(s => resolve(s.filePath) === resolve(guide))))
        throw new AppError("RESOURCE_CONFLICT", "目标范围的排除规则或同名技能阻止加载，已撤销操作；请调整配置后重试。");
      if (target.managed && !copy) {
        const sourceScope = this.scope(target.item.scopeId);
        const sourceResources = await this.manager(sourceScope.path ?? this.store.root).manager.resolve(async () => "skip");
        const retained = sourceResources.skills.filter(entry => entry.enabled && entry.metadata.scope === (sourceScope.kind === "project" ? "project" : "user"));
        if (retained.some(entry => loadSkills({ cwd: sourceScope.path ?? this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [entry.path], includeDefaults: false }).skills.some(s => guides.some(g => realpathSync(g) === realpathSync(s.filePath)))))
          throw new AppError("RESOURCE_CONFLICT", "原范围仍通过父目录或其他声明加载此技能，已撤销移动；请先整理技能路径引用。");
      }
      // The file identity changes only for local files. Keep the user's default
      // selection while invalidating unlocked session catalogs for both scopes.
      withResourceFiles(configFiles, () => {
      if (digest(ownSettings()) !== committedIdentity) throw new AppError("REVISION_CONFLICT", "移动期间此技能的路径声明已改变，请刷新核实；未覆盖新配置。");
      this.store.db.exec("BEGIN");
      try {
        const row = this.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get();
        if (row && (target.path || copy || replacements.length)) {
          const body = JSON.parse(String(row.body));
          for (const guide of replacedGuides) delete body.skills[skillId(guide)];
          for (const [index, guide] of guides.entries()) {
            const before = skillId(guide), after = skillId(movedGuides[index]);
            if (before !== after) delete body.skills[after];
            if (before in body.skills) { body.skills[after] = body.skills[before]; if (!copy && before !== after) delete body.skills[before]; }
          }
          this.store.db.prepare("UPDATE capability_preferences SET revision=revision+1,body=? WHERE id=1").run(JSON.stringify(body));
        }
        this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL").run();
        this.store.db.exec("COMMIT");
      } catch (error) { if (this.store.db.isTransaction) this.store.db.exec("ROLLBACK"); throw error; }
      committed = true;
      });
    } catch (error) {
      const failures: unknown[] = [];
      const restore = (run: () => void) => { try { run(); } catch (failure) { failures.push(failure); } };
      restore(() => withResourceFiles(this.resourceFiles(), () => {
        for (const revert of undo.reverse()) restore(revert);
        if (!failures.length) {
          if (placed) restore(() => rmSync(destinationPath!, { recursive: true, force: true }));
          if (backedUp) restore(() => renameSync(backup!, target.path!));
          for (const saved of replacedBackups) if (saved.placed) restore(() => renameSync(saved.backup, saved.path));
          if (copiedDirectory) restore(() => this.removeDirectory(copiedDirectory, undefined, true));
        }
      }));
      if (failures.length) throw new AppError("RESOURCE_ROLLBACK_FAILED", `范围操作失败且部分配置未能恢复，请检查文件权限并刷新核实。保留的备份：${[...(backedUp ? [backup] : []), ...replacedBackups.filter(saved => saved.placed).map(saved => saved.backup)].join("、") || "原安装目录"}`);
      throw error;
    } finally {
      try {
        if (stage) rmSync(stage, { recursive: true, force: true });
        if (committed && backup) rmSync(backup, { recursive: true, force: true });
        if (committed) for (const saved of replacedBackups) rmSync(saved.backup, { recursive: true, force: true });
      } finally { release?.(); }
    }
    if (target.managed) return copiedId ?? target.item.id;
    const guide = guides[0] === target.path ? destinationPath! : join(destinationPath!, relative(target.path!, guides[0]));
    return destination.id === "global" ? `skill:${skillId(guide)}` : `skill:${destination.id}:${skillId(guide)}`;
  }
  private async installSkill(context: Operation, p: Record<string, unknown>, target?: Target) {
    if (target && !target.managed) return this.updateLocalSkill(context, p, target);
    const source = text(p.source ?? target?.managed?.source, "技能来源", 2000), id = randomUUID();
    const directory = join(this.store.root, "resources", id);
    let committed = false, settled = false;
    try {
      let paths: string[], version: string | undefined;
      if (source.startsWith("npm:")) {
        const installed = await this.npm(context, directory, source, "skill", undefined, target?.managed?.directory); version = installed.pkg.version;
        const declared = installed.pkg.pi?.skills ?? ["skills"];
        if (!Array.isArray(declared) || declared.some((v: unknown) => typeof v !== "string" || v.includes("*") || !inside(installed.root, resolve(installed.root, v)))) throw new AppError("INVALID_INPUT", "此 npm 包的技能目录声明不受支持，请使用 pi 资源包方式安装。");
        paths = declared.map((v: string) => resolve(installed.root, v));
      } else {
        if (!isAbsolute(source) || !existsSync(source)) throw new AppError("INVALID_INPUT", "请选择包含 SKILL.md 的本机文件夹或技能 Markdown 文件，也可填写 npm:包名。");
        const sourceStat = lstatSync(source), folder = sourceStat.isDirectory();
        if (sourceStat.isSymbolicLink() || !folder && (!sourceStat.isFile() || !/\.md$/i.test(source)) || folder && !existsSync(join(source, "SKILL.md")))
          throw new AppError("INVALID_INPUT", "请选择包含 SKILL.md 的普通文件夹或 .md 技能文件，不能导入符号链接。");
        if (inside(realpathSync(source), join(realpathSync(dirname(directory)), basename(directory)))) throw new AppError("INVALID_INPUT", "不能把包含安装目录的父目录导入为技能。");
        const name = importSkillName(typeof p.name === "string" && p.name.trim() ? p.name : target?.item.name ?? skillImportName(source, folder ? "folder" : "file"));
        const skillDirectory = join(directory, name);
        mkdirSync(skillDirectory, { recursive: true, mode: 0o700 });
        let count = 0, bytes = 0;
        await cp(source, folder ? skillDirectory : join(skillDirectory, "SKILL.md"), { recursive: folder, filter: path => {
          const stat = lstatSync(path); count++; bytes += stat.size;
          if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || count > 10000 || bytes > 50 * 1024 * 1024) throw new AppError("INVALID_INPUT", "技能来源包含链接、特殊文件或超过导入大小限制（50 MB / 10000 项）。");
          return true;
        } });
        const guide = join(skillDirectory, "SKILL.md");
        if (!lstatSync(guide).isFile()) throw new AppError("INVALID_INPUT", "SKILL.md 必须是普通 Markdown 文件。");
        writeFileSync(guide, nameImportedSkill(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(guide)), name));
        paths = [skillDirectory];
      }
      const loaded = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: paths, includeDefaults: false });
      if (!loaded.skills.length || loaded.diagnostics.some(d => d.type === "error")) throw new AppError("INVALID_INPUT", "来源中没有有效技能，请检查 SKILL.md。");
      this.commitFiles(context, target, () => {
      this.reserveSkillNames(context, this.scope(target?.item.scopeId ?? p.scopeId).id, loaded.skills.map(skill => skill.name));
      this.assertFiles(context);
      const record: Managed = { scopeId: this.scope(target?.item.scopeId ?? p.scopeId).id, id: target?.managed?.id ?? id, kind: "skill", name: loaded.skills.map(s => s.name).join("、"), source, directory, paths, version };
      for (const other of this.targets.values()) {
        if (other.item.id === target?.item.id || other.item.scopeId !== record.scopeId) continue;
        const names = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: other.skillPaths ?? [], includeDefaults: false }).skills.map(s => s.name);
        if (loaded.skills.some(s => names.includes(s.name))) throw new AppError("RESOURCE_CONFLICT", "此作用范围已有同名技能，请修改安装名称或更新已有技能；未覆盖任何文件。");
      }
      for (const other of this.records()) {
        if (other.id === record.id || (other.scopeId ?? "global") !== record.scopeId || other.kind !== "skill") continue;
        const names = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: other.paths ?? [], includeDefaults: false }).skills.map(skill => skill.name);
        if (loaded.skills.some(skill => names.includes(skill.name))) throw new AppError("RESOURCE_CONFLICT", "此作用范围已有同名技能，请修改安装名称或更新已有技能；未覆盖任何文件。");
      }
      // Persist ownership before publishing load paths so interrupted operations remain removable.
      const previous = this.records();
      this.save([...previous.filter(r => r.id !== record.id), record]);
      try { this.replacePaths(target?.managed?.paths ?? [], paths, record.scopeId); }
      catch (error) { this.save(previous); throw error; }
      context.job.resourceId = record.id;
      committed = true;
      if (target?.managed) this.removeDirectory(target.managed.directory, context, true);
      });
      settled = true;
    } finally { if (!committed) this.removeDirectory(directory, context); context.npmSettled = settled || !committed; }
  }
  private async updateLocalSkill(context: Operation, p: Record<string, unknown>, target: Target) {
    const source = text(p.source, "新版技能目录", 2000), path = target.path;
    if (target.referenceOnly || !target.item.removable || !path || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink() || !isAbsolute(source) || !existsSync(join(source, "SKILL.md")) || resolve(source) === resolve(path) || inside(path, source) || inside(source, path))
      throw new AppError("INVALID_INPUT", "请选择另一份包含 SKILL.md 的新版技能目录；共享包或符号链接请通过原安装器更新。");
    const stage = join(dirname(dirname(path)), `.axiom-update-${randomUUID()}.staging`), backup = join(dirname(dirname(path)), `.axiom-update-${randomUUID()}.backup`);
    let count = 0, bytes = 0;
    try {
      await cp(source, stage, { recursive: true, filter: file => { const stat = lstatSync(file); count++; bytes += stat.size; if (stat.isSymbolicLink() || count > 10000 || bytes > 50 * 1024 * 1024) throw new AppError("INVALID_INPUT", "新版目录包含符号链接或超过导入大小限制。"); return true; } });
      const loaded = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [stage], includeDefaults: false });
      if (!loaded.skills.length) throw new AppError("INVALID_INPUT", "新版目录中没有有效技能。");
      this.commitFiles(context, target, () => {
        this.reserveSkillNames(context, target.item.scopeId, loaded.skills.map(skill => skill.name));
        renameSync(path, backup);
        try { renameSync(stage, path); } catch (error) { renameSync(backup, path); throw error; }
        rmSync(backup, { recursive: true, force: true });
      });
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  private async installMcp(context: Operation, p: Record<string, unknown>, target?: Target) {
    const name = target?.item.name ?? text(p.name, "MCP 名称", 128);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new AppError("INVALID_INPUT", "MCP 名称仅支持字母、数字、下划线和短横线。");
    const scope = this.scope(target?.item.scopeId ?? p.scopeId);
    if (!target && [...this.targets.values()].some(t => t.item.kind === "mcp" && t.item.name === name && t.item.scopeId === scope.id)) throw new AppError("INVALID_INPUT", "同名 MCP 已存在，请使用更新。");
    if ([...this.targets.values()].some(t => t.item.kind === "mcp" && t.item.name !== name && t.item.name.replace(/-/g, "_") === name.replace(/-/g, "_"))) throw new AppError("INVALID_INPUT", "MCP 名称与现有工具名称空间冲突。");
    const source = typeof p.source === "string" ? p.source.trim() : target?.managed?.source;
    const id = randomUUID(), directory = join(this.store.root, "resources", id);
    let record: Managed | undefined, committed = false, settled = false;
    try {
      let raw: unknown;
      if (typeof p.config === "string" && p.config.trim()) { try { raw = JSON.parse(p.config); } catch { throw new AppError("INVALID_INPUT", "MCP 配置必须是有效 JSON 对象。"); } }
      else raw = target?.mcp?.[0]?.raw;
      if (source && !p.configOnly) {
        const installed = await this.npm(context, directory, source, "mcp", name, target?.managed?.directory), bins = installed.pkg.bin;
        const binName = typeof p.bin === "string" && p.bin ? p.bin : target?.managed?.bin;
        const bin = typeof bins === "string" ? bins : bins && (binName ? bins[binName] : Object.keys(bins).length === 1 ? Object.values(bins)[0] : undefined);
        if (typeof bin !== "string" || !inside(installed.root, resolve(installed.root, bin)) || !existsSync(resolve(installed.root, bin))) throw new AppError("INVALID_INPUT", "npm 包没有唯一可执行入口，请填写 bin 名称。");
        const args = raw && typeof raw === "object" && "args" in raw && Array.isArray(raw.args) ? raw.args : [];
        raw = { ...(raw && typeof raw === "object" ? raw : {}), command: process.execPath, args: [resolve(installed.root, bin), ...(target?.managed && args[0] === target.mcp?.[0]?.raw?.args?.[0] ? args.slice(1) : args)] };
        record = { scopeId: scope.id, id: target?.managed?.id ?? id, kind: "mcp", name, source, directory, version: installed.pkg.version, bin: binName };
      }
      const validate = (await validation).validateMcpServerConfig;
      this.commitFiles(context, target, () => {
      const destinationPath = this.mcpPath(scope);
      for (const path of new Set(this.resourceFiles().filter(path => basename(path) === "mcp.json"))) {
        for (const other of Object.keys(json(path).mcpServers ?? {})) {
          if (other.replace(/-/g, "_") === name.replace(/-/g, "_") && (other !== name || !target && path === destinationPath))
            throw new AppError("RESOURCE_CONFLICT", "此作用范围已有同名 MCP 或工具名称空间冲突，请刷新后重试；未覆盖任何配置。");
        }
      }
      const override = scope.kind === "project" && mcpOverride(raw) ? raw as Record<string, unknown> : undefined;
      let parsed: McpConfig | string;
      if (override) {
        const base = validate(name, json(join(this.sharedPiDir, "mcp.json")).mcpServers?.[name]);
        if (typeof base === "string" || Object.keys(override).some(key => !["enabled", "exposure", "toolExposure"].includes(key))) throw new AppError("INVALID_INPUT", "项目覆盖需要有效的全局同名服务，且只能设置 enabled、exposure、toolExposure。");
        parsed = validate(name, { ...base, ...override });
      } else parsed = validate(name, raw);
      if (typeof parsed === "string") throw new AppError("INVALID_INPUT", "MCP 配置不符合 pi 格式，请检查 command / args 或 url 等字段。");
      const entries = target?.mcp?.length ? target.mcp : [{ path: scope.path ? join(scope.path, ".pi", "mcp.json") : join(this.sharedPiDir, "mcp.json"), raw: {} }];
      if (entries.length > 1) throw new AppError("MULTIPLE_SOURCES", "同名 MCP 在多处配置，请先统一源文件后更新；卸载会显示全部清理位置。");
      if (!override && entries[0].path !== join(this.sharedPiDir, "mcp.json") && "auth" in parsed && parsed.auth) throw new AppError("INVALID_INPUT", "项目 MCP 不允许使用全局认证供应商。");
      this.assertFiles(context);
      const previous = this.records();
      if (record) this.save([...previous.filter(r => r.id !== record!.id), record]);
      const path = entries[0].path, config = json(path); config.mcpServers ??= {}; config.mcpServers[name] = override ?? parsed;
      try { atomic(path, config); }
      catch (error) { if (record) this.save(previous); throw error; }
      context.job.resourceId = this.mcpId(path, name);
      committed = !!record;
      if (record && target?.managed) this.removeDirectory(target.managed.directory, context, true);
      });
      settled = true;
    } finally { if (!committed) this.removeDirectory(directory, context); context.npmSettled = settled || !committed; }
  }
  private async credentials(name: string, entries: { path: string; raw: any }[]) {
    const urls = [...new Set(entries.flatMap(e => typeof e.raw?.url === "string" ? [e.raw.url] : []))];
    const { McpOAuthCredentialStore } = await oauth;
    const { FileAuthStorageBackend } = await authStorage;
    for (const dir of new Set([getAgentDir(), this.sharedPiDir])) {
      const file = join(dir, "mcp-auth.json"); if (!existsSync(file)) continue;
      const backend = new FileAuthStorageBackend(file), store = new McpOAuthCredentialStore(backend, dir);
      for (const value of urls) {
        let url: string; try { url = String(new URL(value)); } catch { continue; }
        const key = `mcp__${name.replace(/-/g, "_")}|${url}`;
        const sameUrl = (e: { raw: any }) => { try { return String(new URL(e.raw.url)) === url; } catch { return false; } };
        await store.forServer(name, url).withRefreshLock(async () => {
          withResourceFiles(this.resourceFiles(), () => {
          const otherEntries = [...new Set(this.resourceFiles().filter(path => basename(path) === "mcp.json"))].flatMap(path =>
            Object.entries(json(path).mcpServers ?? {}).map(([other, raw]) => ({ name: other, raw })));
          const sharedLegacy = otherEntries.some(sameUrl), sharedNamed = otherEntries.some(e => e.name === name && sameUrl(e));
          backend.withLock(raw => {
            const data = raw ? JSON.parse(raw) : {}; if (!sharedNamed) delete data[key];
            if (!sharedLegacy) delete data[url];
            return { result: undefined, next: JSON.stringify(data, null, 2) };
          });
          });
        });
      }
    }
  }
  private prune(target: Target) {
    const row = this.store.db.prepare("SELECT revision,body FROM capability_preferences WHERE id=1").get();
    if (!row) return;
    const body = JSON.parse(String(row.body));
    if (target.mcp) for (const entry of target.mcp) delete body.mcp[digest([resolve(entry.path), target.item.name])];
    const skillPaths = (target.skillPaths ?? []).flatMap(path => {
      try { if (lstatSync(path).isDirectory()) return loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [path], includeDefaults: false }).skills.map(skill => skill.filePath); } catch { /* Missing files still have a path reference. */ }
      return [path];
    });
    for (const path of skillPaths) {
      if (target.referenceOnly && [...this.targets.values()].some(t => t.item.id !== target.item.id && t.skillPaths?.some(other => { try { return realpathSync(other) === realpathSync(path); } catch { return other === path; } }))) continue;
      delete body.skills[skillId(path)]; try { delete body.skills[skillId(realpathSync(path))]; } catch { /* Already removed. */ }
    }
    this.store.db.prepare("UPDATE capability_preferences SET revision=revision+1,body=? WHERE id=1").run(JSON.stringify(body));
    if (target.item.scopeId === "global") this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL").run();
    else this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL AND sessionId IN (SELECT id FROM sessions WHERE workspaceId=?)").run(target.item.scopeId);
  }
  private async remove(context: Operation, target: Target, clearCredentials = false, force = false) {
    if (force && target.referenceOnly) target = { ...target, referenceOnly: false };
    const references: ResourceReferenceChange[] = target.mcp ? target.mcp.map(entry => ({ kind: "mcp", name: target.item.name, source: entry.path, preferenceKeys: [digest([resolve(entry.path), target.item.name])] }))
      : loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: target.skillPaths ?? [], includeDefaults: false }).skills.map(skill => ({ kind: "skills", name: skill.name, source: skill.filePath, preferenceKeys: [skillId(skill.filePath), skillId(realpathSync(skill.filePath))] }));
    if (target.package) {
      this.prune(target);
      const pkg = target.package;
      await this.packageOperation(context, "remove", pkg.source, pkg.cwd, pkg.local, true);
      return;
    }
    const matches = (entry: unknown, settingsPath: string, paths: string[]) => {
      if (typeof entry !== "string") return false;
      const value = entry.replace(/^[+!-]/, "");
      const absolute = value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(dirname(settingsPath), value);
      return paths.some(path => relative(resolve(path), absolute) === "");
    };
    this.commitFiles(context, target, () => {
    // Check the post-removal references before pruning preferences or changing
    // any config. A refused cleanup must leave the original resource usable.
    if (target.managed) this.assertDirectoryRemoval(target.managed.directory, undefined, target.managed.id, (path, config) => {
      if (basename(path) === "mcp.json" && target.mcp?.some(entry => canonical(entry.path) === canonical(path))) delete config.mcpServers?.[target.item.name];
      if (basename(path) === "settings.json" && target.managed!.kind === "skill" && Array.isArray(config.skills)) {
        // Mirror the two writes below exactly: scanned settings lose target
        // paths; only the owner's settings lose the managed record's raw paths.
        // A scope added since scanning must keep its references in this preview.
        if (!target.referenceOnly && this.files.has(path))
          config.skills = config.skills.filter((entry: unknown) => !matches(entry, path, [target.managed!.directory, ...(target.managed!.paths ?? []), ...(target.path ? [target.path] : []), ...(target.skillPaths ?? [])]));
        if (path === this.settings(target.managed!.scopeId))
          config.skills = config.skills.filter((entry: unknown) => typeof entry !== "string" || !(target.managed!.paths ?? []).includes(entry));
      }
      return config;
    });
    this.prune(target);
    if (target.mcp) {
      this.assertFiles(context);
      for (const entry of target.mcp) { const config = json(entry.path); delete config.mcpServers?.[target.item.name]; atomic(entry.path, config); }
    } else if (target.item.kind === "skill") {
      if (target.referenceOnly) {
        const path = this.settings(target.item.scopeId), guides = target.skillPaths ?? [];
        this.editSettings(path, settings => { settings.skills = [...(settings.skills ?? []).filter((p: unknown) => !matches(p, path, [target.path!, ...guides])), ...guides.map(guide => `-${guide}`)]; });
        return;
      }
      const paths = [...(target.path ? [target.path] : []), ...(target.managed ? [target.managed.directory, ...(target.managed.paths ?? [])] : []), ...(target.skillPaths ?? [])];
      for (const path of this.files.keys()) if (basename(path) === "settings.json") {
        this.withSettingsLock(path, () => {
          const settings = json(path);
          if (Array.isArray(settings.skills)) { const before = settings.skills; settings.skills = before.filter((p: unknown) => !matches(p, path, paths)); if (settings.skills.length !== before.length) atomic(path, settings); }
        });
      }
      if (!target.managed && target.path) rmSync(target.path, { recursive: true, force: true });
    }
    if (target.managed) {
      if (target.managed.kind === "skill") this.replacePaths(target.managed.paths ?? [], [], target.managed.scopeId);
      this.removeDirectory(target.managed.directory, undefined, true, target.managed.id);
      this.save(this.records().filter(r => r.id !== target.managed!.id));
    }
    changeResourceReferences(this.store, references);
    });
    if (target.mcp && clearCredentials) await this.credentials(target.item.name, target.mcp);
  }
  async close() { this.closed = true; const active = [...this.operations.values()]; for (const operation of active) operation.controller.abort(); await Promise.allSettled(active.map(operation => operation.pending)); await this.refreshPending; }
}
