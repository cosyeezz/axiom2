import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DefaultPackageManager, SettingsManager, getAgentDir, loadSkills, type McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import { AppError, object, text, type Command } from "../shared/protocol.js";
import { skillImportName } from "../shared/skill-import.js";
import { importSkillName, nameImportedSkill } from "./skill-import.js";
import { configProjection, restoreConfig } from "./resource-config.js";
import type { ResourceDetail, ResourceItem, ResourceScope, ResourceState } from "../shared/resources.js";
import type { Store } from "./storage.js";
import { capabilityFileDigest, discoverCapabilities, skillId } from "./capability-resources.js";
import { executeOpenCli, findNpmCli, type OpenCliExecute } from "./integrations/opencli.js";
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
type Managed = { scopeId?: string; id: string; kind: "skill" | "mcp"; name: string; source: string; directory: string; paths?: string[]; version?: string; bin?: string };
type Target = { builtin?: boolean; sharedOwned?: boolean; referenceOnly?: boolean; item: ResourceItem; skillPaths?: string[]; path?: string; managed?: Managed; package?: { source: string; cwd: string; local: boolean }; mcp?: { path: string; raw: any }[] };
export class Resources {
  private state: ResourceState = { revision: "", items: [], scopes: [], warnings: [] };
  private targets = new Map<string, Target>();
  private files = new Map<string, string>();
  private pending?: Promise<void>;
  private controller = new AbortController();
  private closed = false;
  private readonly recordsPath: string;
  private readonly jobPath: string;
  constructor(readonly store: Store, readonly sharedPiDir: string, private readonly publish: () => void,
    private readonly idle: () => Promise<void>, private readonly execute: OpenCliExecute = executeOpenCli) {
    this.recordsPath = join(store.root, "resources", "installed.json");
    this.jobPath = join(store.root, "resources", "job.json");
    const saved = json(this.jobPath).job as ResourceState["job"];
    if (saved) this.state.job = { ...saved, running: false, ...(saved.running ? { message: "上次操作被中断", error: "请刷新检查实际资源；未自动重复操作。" } : {}) };
  }
  get busy() { return !!this.pending; }
  snapshot() { return structuredClone(this.state); }
  private records(): Managed[] { const records = json(this.recordsPath).items ?? []; if (!Array.isArray(records)) throw Error("资源安装记录无效。"); return records; }
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
  async refresh(finishing = false) {
    const targets = new Map<string, Target>(), files = new Map<string, string>(), warnings = new Set<string>();
    const records = this.records();
    const track = (path: string) => files.set(path, fileIdentity(path));
    track(this.recordsPath); track(this.settings());
    const scopes = this.scopes();
    const add = (target: Omit<Target, "item"> & { item: Omit<ResourceItem, "scopeId"> & { scopeId?: string } }) => { if (!targets.has(target.item.id)) targets.set(target.item.id, { ...target, item: { scopeId: "global", ...target.item } }); };
    const packages: { root: string; id: string }[] = [];
    const skillScopes = new Map<string, Map<string, string>>();
    const identity = (path: string) => { try { return skillId(realpathSync(path)); } catch { return skillId(path); } };
    for (const cwd of this.contexts()) {
      const { manager } = this.manager(cwd);
      const resolved = await manager.resolve(async () => "skip"), map = new Map<string, string>();
      for (const entry of resolved.skills.filter(e => e.enabled)) {
        const scopeId = entry.metadata.scope === "project" ? scopes.find(s => s.path === cwd)?.id : "global";
        const loaded = loadSkills({ cwd, agentDir: join(this.store.root, "pi"), skillPaths: [entry.path], includeDefaults: false });
        for (const guide of loaded.skills) if (!map.has(identity(guide.filePath))) map.set(identity(guide.filePath), scopeId ?? "unregistered");
      }
      skillScopes.set(cwd, map);
      for (const pkg of manager.listConfiguredPackages()) {
        const local = pkg.scope === "project", settingsPath = local ? join(cwd, ".pi", "settings.json") : this.settings();
        track(settingsPath);
        const id = digest([settingsPath, pkg.source]);
        const owned = !!pkg.installedPath && (inside(join(this.store.root, "pi", "npm"), pkg.installedPath) || inside(join(this.store.root, "pi", "git"), pkg.installedPath) || local && (inside(join(cwd, ".pi", "npm"), pkg.installedPath) || inside(join(cwd, ".pi", "git"), pkg.installedPath)));
        if (pkg.installedPath) packages.push({ root: pkg.installedPath, id });
        add({ item: { id, scopeId: local ? scopes.find(s => s.path === cwd)?.id ?? "global" : "global", kind: "package", name: pkg.source, description: "pi 资源包 · 包含的技能与其他资源一起管理", source: pkg.installedPath ?? settingsPath, managed: owned, removable: true,
          cleanup: ["移除 pi 包声明", ...(owned ? [`删除托管包及其依赖：${pkg.installedPath}`] : ["外部共享源文件保留（本应用不拥有）"])], note: local ? `工作空间：${cwd}` : "应用级资源包" }, package: { source: pkg.source, cwd, local } });
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
      catalog.files.forEach(file => track(file.path));
      for (const server of catalog.config.servers.filter(server => server.source === reaConfigPath(this.store.root))) {
        add({ builtin: true, item: { id: "builtin:rea:mcp", kind: "mcp", name: server.name, description: "REA 内置 MCP 服务", source: server.source, builtin: "rea",
          managed: true, removable: false, cleanup: [], note: "由内置工具 REA 管理；安装、卸载、更新和默认启用请到内置工具设置。" } });
      }
      for (const skill of catalog.skills) {
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
        add({ item: { scopeId, id: scopeId === "global" ? `skill:${skillId(skill.source)}` : `skill:${scopeId}:${skillId(skill.source)}`, kind: "skill", name: skill.name, description: skill.description, source: skill.source, managed: false, removable,
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
      target.item.movable = !!(!protectedRoot && target.item.removable && !target.referenceOnly && !target.sharedOwned && (target.managed || target.path && !lstatSync(target.path).isSymbolicLink()));
      if (!target.item.movable) target.item.moveBlockedReason = "此技能由其他范围、链接或外部安装器共享，请先在原来源解除共享后移动。";
    }
    for (const target of targets.values()) if (target.item.kind === "mcp") {
      const entry = target.mcp?.[0], scope = scopes.find(s => s.id === target.item.scopeId)!;
      const reason = target.builtin ? "此 MCP 由内置工具管理，作用范围固定为全局，无需移动。"
        : !entry ? "连接配置已不存在，请先恢复配置或清理遗留安装。"
        : target.mcp!.length !== 1 || entry.path !== this.mcpPath(scope) ? "此配置不属于独立的全局或项目来源，请先整理配置文件。"
        : mcpOverride(entry.raw) ? "此项目配置继承全局连接，请先保存完整连接配置后再移动。"
        : scope.kind === "global" && entry.raw?.auth ? "此 MCP 使用仅限全局的认证供应商，不能移入项目。"
        : scope.kind === "global" && [...targets.values()].some(other => other !== target && other.item.name === target.item.name && other.mcp?.some(e => mcpOverride(e.raw))) ? "其他项目仍通过局部覆盖继承此全局连接，请先处理这些覆盖配置再移动。" : undefined;
      target.item.movable = !reason;
      target.item.moveBlockedReason = reason;
    }
    // A refresh begun while idle must not replace the admitted operation's snapshot.
    if (this.busy && !finishing) return this.snapshot();
    this.targets = targets; this.files = files;
    this.state = { ...this.state, scopes, items: [...targets.values()].map(t => t.item), warnings: [...warnings], revision: digest([scopes, [...files]]) };
    this.publish(); return this.snapshot();
  }
  private assertFiles() { for (const [path, hash] of this.files) if (fileIdentity(path) !== hash) throw new AppError("REVISION_CONFLICT", "资源文件已改变，请刷新后重试。"); }
  private notify() { atomic(this.jobPath, { job: this.state.job }); this.publish(); }
  async command(c: Command) {
    if (c.op === "resources.get") return this.busy ? this.snapshot() : this.refresh();
    if (c.op === "resources.detail") return this.detail(object(c.params ?? {}));
    if (!["resources.install", "resources.update", "resources.remove", "resources.save", "resources.move"].includes(c.op)) throw new AppError("UNKNOWN_OPERATION", "不支持的资源操作。");
    if (this.closed || this.busy) throw new AppError("RESOURCE_BUSY", "资源操作进行中，请等待完成。");
    const p = object(c.params ?? {});
    const previous = this.state.revision;
    await this.refresh();
    if (this.busy) throw new AppError("RESOURCE_BUSY", "另一资源操作已开始。");
    if (p.revision !== previous || p.revision !== this.state.revision) throw new AppError("REVISION_CONFLICT", "资源目录已变化，请刷新后重试。");
    const target = p.id ? this.targets.get(text(p.id, "资源标识")) : undefined;
    if (c.op !== "resources.install" && !target) throw new AppError("RESOURCE_MISSING", "资源不存在，请刷新。");
    const scope = this.scope(target?.item.scopeId ?? p.scopeId);
    if (target?.builtin) throw new AppError("BUILTIN_RESOURCE", "此资源由内置工具管理，请到内置工具设置更新或重新安装。");
    if (target?.sharedOwned) throw new AppError("RESOURCE_SHARED", "其他作用范围仍引用此资源，请先移除这些引用再编辑、更新或卸载。");
    if (c.op === "resources.move") {
      const destination = this.scope(p.destinationScopeId);
      if (!target!.item.movable || destination.id === scope.id || (destination.kind !== "global" && scope.kind !== "global"))
        throw new AppError("INVALID_INPUT", target!.item.moveBlockedReason ?? "请选择可独立管理的技能或 MCP，在项目与全局之间移动。");
    }
    if (c.op === "resources.remove" && (!target!.item.removable || p.confirm !== true)) throw new AppError("INVALID_INPUT", "请确认此资源的清理范围。");
    this.state.job = { id: randomUUID(), running: true, message: "正在准备资源操作…" };
    try { this.notify(); }
    catch {
      this.state.job.running = false; this.state.job.error = "无法保存资源作业记录，尚未修改资源。请检查文件权限后重试。";
      this.publish(); throw new AppError("RESOURCE_STATE_FAILED", this.state.job.error);
    }
    // Persist admission before queuing any side effect; reserve before yielding.
    this.pending = Promise.resolve().then(async () => {
      await this.idle(); this.scope(scope.id); this.assertFiles();
      if (c.op === "resources.move") {
        const destination = this.scope(p.destinationScopeId);
        this.state.job!.resourceId = target!.item.kind === "mcp" ? await this.moveMcp(target!, destination) : await this.moveSkill(target!, destination);
      }
      else if (c.op === "resources.save") await this.saveContent(p, target!);
      else if (c.op === "resources.remove") await this.remove(target!);
      else if (target?.package) await this.updatePackage(target);
      else if ((target?.item.kind ?? p.kind) === "skill") await this.installSkill({ ...p, scopeId: scope.id }, target);
      else if ((target?.item.kind ?? p.kind) === "mcp") await this.installMcp({ ...p, scopeId: scope.id }, target);
      else if (p.kind === "package") await this.installPackage({ ...p, scopeId: scope.id });
      else throw new AppError("INVALID_INPUT", "请选择技能或 MCP。");
      this.state.job!.message = "已完成。新会话使用更新后的资源；已有会话可重载资源，卸载的锁定能力需新建会话后重新选择。";
    }).catch(error => {
      this.state.job!.message = "操作未完成";
      // npm/MCP errors may contain secrets or command arguments.
      this.state.job!.error = error instanceof AppError ? error.message : "资源操作失败，请检查来源、文件权限和网络后刷新核实。已完成的清理不会自动回滚。";
    }).finally(async () => {
      this.state.job!.running = false;
      try { await this.refresh(true); } catch { this.state.warnings = ["资源目录刷新失败，请修复配置后重试。"]; }
      this.pending = undefined;
      try { this.notify(); }
      catch {
        this.state.job!.error = "资源操作结果未能保存，请刷新核实实际资源；不要自动重复操作。";
        try { this.publish(); } catch { /* The in-memory result remains available on reconnect. */ }
      }
    });
    return this.snapshot();
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
    if (this.busy) throw new AppError("RESOURCE_BUSY", "资源操作进行中，请完成后读取配置。");
    await this.refresh();
    if (this.busy) throw new AppError("RESOURCE_BUSY", "资源操作进行中，请完成后读取配置。");
    const target = this.targets.get(text(p.id, "资源标识"));
    if (!target) throw new AppError("RESOURCE_MISSING", "资源不存在，请刷新。");
    return this.describe(target);
  }
  private async saveContent(p: Record<string, unknown>, target: Target) {
    if (target.mcp?.length) {
      let config: unknown;
      try { config = restoreConfig(JSON.parse(text(p.config, "MCP 配置", 256 * 1024)), target.mcp[0].raw); }
      catch { throw new AppError("INVALID_INPUT", "配置 JSON 或已保存值的占位符无效，请重新加载配置后编辑。"); }
      return this.installMcp({ config: JSON.stringify(config), configOnly: true }, target);
    }
    const document = this.describe(target).documents.find(d => d.path === p.path);
    if (!document?.editable) throw new AppError("INVALID_INPUT", "此技能由外部来源或资源包管理，不能在这里直接改写。");
    if (typeof p.content !== "string" || Buffer.byteLength(p.content) > 256 * 1024) throw new AppError("INVALID_INPUT", "技能内容不能为空且不能超过 256 KiB。");
    const stage = join(dirname(document.path), `.axiom-${randomUUID()}.md`);
    try {
      writeFileSync(stage, p.content, { flag: "wx", mode: statSync(document.path).mode });
      const loaded = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [stage], includeDefaults: false });
      if (!loaded.skills.length || loaded.diagnostics.some(d => d.type === "error")) throw new AppError("INVALID_INPUT", "技能内容缺少有效名称或说明，请检查 YAML frontmatter。");
      this.assertFiles(); renameSync(stage, document.path);
    } finally { rmSync(stage, { force: true }); }
  }
  private async installPackage(p: Record<string, unknown>) {
    const source = text(p.source, "pi 包来源", 1000);
    if (!source.startsWith("npm:") && !source.startsWith("git:")) throw new AppError("INVALID_INPUT", "pi 包来源应以 npm: 或 git: 开头。");
    const scope = this.scope(p.scopeId), { manager, settingsManager } = this.manager(scope.path ?? this.store.root);
    await manager.installAndPersist(source, { local: scope.kind === "project" }); await settingsManager.flush();
    if (settingsManager.drainErrors().length) throw Error("包配置写入失败。");
  }
  private async updatePackage(target: Target) {
    const pkg = target.package!, { manager, settingsManager } = this.manager(pkg.cwd);
    // installAndPersist is scope-specific; update(source) can update both scopes.
    await manager.installAndPersist(pkg.source, { local: pkg.local }); await settingsManager.flush();
    if (settingsManager.drainErrors().length) throw Error("包配置写入失败。");
  }
  private async npm(directory: string, source: string) {
    const { spec, name } = npmSpec(source);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    atomic(join(directory, "package.json"), { private: true });
    await this.execute([findNpmCli(), "install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", ...(name.startsWith("@") ? [`--${name.split("/")[0]}:registry=https://registry.npmjs.org`] : []), spec],
      { cwd: directory, env: { ...process.env, npm_config_cache: join(directory, "cache") }, signal: this.controller.signal, timeout: 600000 });
    const root = join(directory, "node_modules", ...name.split("/")), pkg = json(join(root, "package.json"));
    if (pkg.name !== name) throw Error("npm 包校验失败。");
    return { root, pkg };
  }
  private replacePaths(remove: string[], add: string[], scopeId = "global") {
    const path = this.settings(scopeId), settings = json(path);
    if (settings.skills !== undefined && !Array.isArray(settings.skills)) throw Error("技能路径格式无效。");
    settings.skills = [...(settings.skills ?? []).filter((v: unknown) => typeof v !== "string" || !remove.some(r => v === r)), ...add];
    atomic(path, settings);
  }
  private async moveMcp(target: Target, destination: ResourceScope) {
    const entry = target.mcp![0], name = target.item.name, destinationPath = this.mcpPath(destination);
    const validate = (await validation).validateMcpServerConfig;
    const parsed = validate(name, entry.raw);
    if (typeof parsed === "string") throw new AppError("INVALID_INPUT", "MCP 配置无效，请修复连接配置后再移动。");
    if (destination.kind === "project" && "auth" in parsed && parsed.auth)
      throw new AppError("INVALID_INPUT", "此 MCP 使用仅限全局的认证供应商，不能移入项目。");
    this.scope(target.item.scopeId); this.scope(destination.id); this.assertFiles();
    const sourceConfig = json(entry.path), destinationConfig = json(destinationPath);
    const names = Object.keys(destinationConfig.mcpServers ?? {});
    if (names.some(other => other.replace(/-/g, "_") === name.replace(/-/g, "_")) || [...this.targets.values()].some(other => other !== target && other.item.kind === "mcp" && (other.item.scopeId === destination.id || other.item.name !== name) && other.item.name.replace(/-/g, "_") === name.replace(/-/g, "_")))
      throw new AppError("RESOURCE_CONFLICT", "目标范围已有同名 MCP 或工具名称空间冲突，请先处理后再移动；未覆盖任何配置。");
    // A linked configuration may still be used by a different scope.
    for (const path of [entry.path, destinationPath]) {
      if (!existsSync(path)) continue;
      const actual = realpathSync(path);
      if (statSync(path).nlink > 1 || lstatSync(path).isSymbolicLink() || [...this.files.keys()].some(other => other !== path && basename(other) === "mcp.json" && existsSync(other) && realpathSync(other) === actual))
        throw new AppError("RESOURCE_SHARED", "此 MCP 配置文件通过链接共享，请先解除文件链接再移动。");
    }
    delete sourceConfig.mcpServers[name];
    destinationConfig.mcpServers = { ...destinationConfig.mcpServers, [name]: entry.raw };
    const records = target.managed ? this.records().map(record => record.id === target.managed!.id ? { ...record, scopeId: destination.id } : record) : undefined;
    const snapshots = [entry.path, destinationPath, ...(records ? [this.recordsPath] : [])].map(path => ({ path, content: existsSync(path) ? readFileSync(path) : undefined }));
    const written: typeof snapshots = [];
    this.store.db.exec("BEGIN");
    try {
      for (const [saved, config] of [[snapshots[1], destinationConfig], [snapshots[0], sourceConfig]] as const) {
        atomic(saved.path, config); written.push(saved);
      }
      if (records) { this.save(records); written.push(snapshots[2]); }
      const row = this.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get();
      if (row) {
        const body = JSON.parse(String(row.body)), before = digest([resolve(entry.path), name]), after = digest([resolve(destinationPath), name]);
        delete body.mcp[after];
        if (before in body.mcp) { body.mcp[after] = body.mcp[before]; delete body.mcp[before]; }
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
    return this.mcpId(destinationPath, name);
  }
  private async moveSkill(target: Target, destination: ResourceScope) {
    const guides = this.guides(target), names = new Set(loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: guides, includeDefaults: false }).skills.map(s => s.name));
    if (!names.size) throw new AppError("INVALID_INPUT", "技能内容无法读取，请修复后再移动。");
    const { manager } = this.manager(destination.path ?? this.store.root);
    const resolved = await manager.resolve(async () => "skip");
    const candidates = resolved.skills.filter(entry => entry.metadata.scope === (destination.kind === "project" ? "project" : "user")).map(entry => entry.path);
    // Include explicitly scoped resources and shared global guides, even when a
    // same-name guide was hidden by discovery precedence.
    candidates.push(...[...this.targets.values()].filter(t => t !== target && t.item.scopeId === destination.id).flatMap(t => t.skillPaths ?? []));
    if (destination.kind === "global") candidates.push(join(this.sharedPiDir, "skills"));
    for (const path of candidates) {
      const loaded = loadSkills({ cwd: destination.path ?? this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [path], includeDefaults: false });
      if (loaded.skills.some(s => names.has(s.name) && !guides.some(g => realpathSync(g) === realpathSync(s.filePath))))
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
    const oldPaths = target.managed?.paths ?? [target.path!];
    const destinationPath = target.path ? join(dirname(destinationSettings), "skills", basename(target.path)) : undefined;
    const newPaths = target.managed?.paths ?? [destinationPath!];
    const matches = (entry: unknown, settings: string, paths: string[]) => {
      if (typeof entry !== "string") return false;
      const value = entry.replace(/^[+!-]/, ""), absolute = value.startsWith("~/") ? join(homedir(), value.slice(2)) : resolve(dirname(settings), value);
      return paths.some(path => absolute === resolve(path));
    };
    sourceConfig.skills = (sourceConfig.skills ?? []).filter((entry: unknown) => !matches(entry, sourceSettings, [...oldPaths, ...guides]));
    destinationConfig.skills = [...(destinationConfig.skills ?? []).filter((entry: unknown) => typeof entry === "string" && /^[!-]/.test(entry) || !matches(entry, destinationSettings, newPaths)), ...newPaths];
    const records = target.managed ? this.records().map(record => record.id === target.managed!.id ? { ...record, scopeId: destination.id } : record) : undefined;
    const snapshots = [sourceSettings, destinationSettings, ...(records ? [this.recordsPath] : [])].map(path => ({ path, content: existsSync(path) ? readFileSync(path) : undefined }));
    const stage = destinationPath ? `${destinationPath}.${randomUUID()}.staging` : undefined;
    const backup = target.path ? `${target.path}.${randomUUID()}.backup` : undefined;
    let backedUp = false, placed = false, writing = false, committed = false;
    const assertDestination = () => {
      if (!destinationPath) return;
      try { lstatSync(destinationPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      throw new AppError("RESOURCE_CONFLICT", "目标位置已存在同名文件或目录，请先处理后再移动；未覆盖任何文件。");
    };
    try {
      assertDestination();
      if (stage) {
        let count = 0, bytes = 0;
        await cp(target.path!, stage, { recursive: true, errorOnExist: true, force: false, filter: path => {
          const stat = lstatSync(path); count++; bytes += stat.size;
          if (stat.isSymbolicLink() || count > 10000 || bytes > 50 * 1024 * 1024) throw new AppError("INVALID_INPUT", "技能目录包含符号链接或超过移动大小限制（50 MB / 10000 项）。");
          return true;
        } });
      }
      this.scope(target.item.scopeId); this.scope(destination.id); this.assertFiles(); assertDestination();
      if (backup) { renameSync(target.path!, backup); backedUp = true; renameSync(stage!, destinationPath!); placed = true; }
      writing = true;
      atomic(sourceSettings, sourceConfig); atomic(destinationSettings, destinationConfig);
      if (records) this.save(records);
      const catalog = await discoverCapabilities(this.store.root, destination.path ?? this.store.root, this.sharedPiDir);
      const movedGuides = target.path ? guides.map(guide => guide === target.path ? destinationPath! : join(destinationPath!, relative(target.path!, guide))) : guides;
      if (movedGuides.some(guide => !catalog.skills.some(s => resolve(s.source) === resolve(guide))))
        throw new AppError("RESOURCE_CONFLICT", "目标范围的排除规则或同名技能阻止加载，已撤销移动；请调整配置后重试。");
      if (target.managed) {
        const sourceScope = this.scope(target.item.scopeId);
        const sourceResources = await this.manager(sourceScope.path ?? this.store.root).manager.resolve(async () => "skip");
        const retained = sourceResources.skills.filter(entry => entry.enabled && entry.metadata.scope === (sourceScope.kind === "project" ? "project" : "user"));
        if (retained.some(entry => loadSkills({ cwd: sourceScope.path ?? this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [entry.path], includeDefaults: false }).skills.some(s => guides.some(g => realpathSync(g) === realpathSync(s.filePath)))))
          throw new AppError("RESOURCE_CONFLICT", "原范围仍通过父目录或其他声明加载此技能，已撤销移动；请先整理技能路径引用。");
      }
      // The file identity changes only for local files. Keep the user's default
      // selection while invalidating unlocked session catalogs for both scopes.
      this.store.db.exec("BEGIN");
      try {
        const row = this.store.db.prepare("SELECT body FROM capability_preferences WHERE id=1").get();
        if (row && target.path) {
          const body = JSON.parse(String(row.body));
          for (const guide of guides) {
            const before = skillId(guide), after = skillId(guide === target.path ? destinationPath! : join(destinationPath!, relative(target.path, guide)));
            if (before in body.skills) { body.skills[after] = body.skills[before]; delete body.skills[before]; }
          }
          this.store.db.prepare("UPDATE capability_preferences SET revision=revision+1,body=? WHERE id=1").run(JSON.stringify(body));
        }
        this.store.db.prepare("UPDATE session_capabilities SET selection=NULL,revision=revision+1 WHERE lockedAt IS NULL").run();
        this.store.db.exec("COMMIT");
      } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
      committed = true;
    } catch (error) {
      const failures: unknown[] = [];
      const restore = (run: () => void) => { try { run(); } catch (failure) { failures.push(failure); } };
      if (writing) for (const saved of snapshots.reverse()) restore(() => {
        if (saved.content === undefined) rmSync(saved.path, { force: true });
        else writeFileSync(saved.path, saved.content);
      });
      if (placed) restore(() => rmSync(destinationPath!, { recursive: true, force: true }));
      if (backedUp) restore(() => renameSync(backup!, target.path!));
      if (failures.length) throw new AppError("RESOURCE_ROLLBACK_FAILED", `移动失败且部分配置未能恢复，请检查文件权限并刷新核实。${backedUp ? `原技能备份位置：${backup}` : "技能文件仍保留在原安装目录。"}`);
      throw error;
    } finally {
      if (stage) rmSync(stage, { recursive: true, force: true });
      if (committed && backup) rmSync(backup, { recursive: true, force: true });
    }
    if (target.managed) return target.item.id;
    const guide = guides[0] === target.path ? destinationPath! : join(destinationPath!, relative(target.path!, guides[0]));
    return destination.id === "global" ? `skill:${skillId(guide)}` : `skill:${destination.id}:${skillId(guide)}`;
  }
  private async installSkill(p: Record<string, unknown>, target?: Target) {
    if (target && !target.managed) return this.updateLocalSkill(p, target);
    const source = text(p.source ?? target?.managed?.source, "技能来源", 2000), id = randomUUID();
    const directory = join(this.store.root, "resources", id);
    let committed = false;
    try {
      let paths: string[], version: string | undefined;
      if (source.startsWith("npm:")) {
        const installed = await this.npm(directory, source); version = installed.pkg.version;
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
      this.assertFiles();
      const record: Managed = { scopeId: this.scope(target?.item.scopeId ?? p.scopeId).id, id: target?.managed?.id ?? id, kind: "skill", name: loaded.skills.map(s => s.name).join("、"), source, directory, paths, version };
      for (const other of this.targets.values()) {
        if (other === target || other.item.scopeId !== record.scopeId) continue;
        const names = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: other.skillPaths ?? [], includeDefaults: false }).skills.map(s => s.name);
        if (loaded.skills.some(s => names.includes(s.name))) throw new AppError("RESOURCE_CONFLICT", "此作用范围已有同名技能，请修改安装名称或更新已有技能；未覆盖任何文件。");
      }
      // Persist ownership before publishing load paths so interrupted operations remain removable.
      const previous = this.records();
      this.save([...previous.filter(r => r.id !== record.id), record]);
      try { this.replacePaths(target?.managed?.paths ?? [], paths, record.scopeId); }
      catch (error) { this.save(previous); throw error; }
      committed = true;
      if (target?.managed) rmSync(target.managed.directory, { recursive: true, force: true });
    } finally { if (!committed) rmSync(directory, { recursive: true, force: true }); }
  }
  private async updateLocalSkill(p: Record<string, unknown>, target: Target) {
    const source = text(p.source, "新版技能目录", 2000), path = target.path;
    if (target.referenceOnly || !target.item.removable || !path || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink() || !isAbsolute(source) || !existsSync(join(source, "SKILL.md")) || resolve(source) === resolve(path) || inside(path, source) || inside(source, path))
      throw new AppError("INVALID_INPUT", "请选择另一份包含 SKILL.md 的新版技能目录；共享包或符号链接请通过原安装器更新。");
    const stage = `${path}.${randomUUID()}.staging`, backup = `${path}.${randomUUID()}.backup`;
    let count = 0, bytes = 0;
    try {
      await cp(source, stage, { recursive: true, filter: file => { const stat = lstatSync(file); count++; bytes += stat.size; if (stat.isSymbolicLink() || count > 10000 || bytes > 50 * 1024 * 1024) throw new AppError("INVALID_INPUT", "新版目录包含符号链接或超过导入大小限制。"); return true; } });
      const loaded = loadSkills({ cwd: this.store.root, agentDir: join(this.store.root, "pi"), skillPaths: [stage], includeDefaults: false });
      if (!loaded.skills.length) throw new AppError("INVALID_INPUT", "新版目录中没有有效技能。");
      this.assertFiles(); renameSync(path, backup);
      try { renameSync(stage, path); } catch (error) { renameSync(backup, path); throw error; }
      rmSync(backup, { recursive: true, force: true });
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  private async installMcp(p: Record<string, unknown>, target?: Target) {
    const name = target?.item.name ?? text(p.name, "MCP 名称", 128);
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new AppError("INVALID_INPUT", "MCP 名称仅支持字母、数字、下划线和短横线。");
    const scope = this.scope(target?.item.scopeId ?? p.scopeId);
    if (!target && [...this.targets.values()].some(t => t.item.kind === "mcp" && t.item.name === name && t.item.scopeId === scope.id)) throw new AppError("INVALID_INPUT", "同名 MCP 已存在，请使用更新。");
    if ([...this.targets.values()].some(t => t.item.kind === "mcp" && t.item.name !== name && t.item.name.replace(/-/g, "_") === name.replace(/-/g, "_"))) throw new AppError("INVALID_INPUT", "MCP 名称与现有工具名称空间冲突。");
    const source = typeof p.source === "string" ? p.source.trim() : target?.managed?.source;
    const id = randomUUID(), directory = join(this.store.root, "resources", id);
    let record: Managed | undefined, committed = false;
    try {
      let raw: unknown;
      if (typeof p.config === "string" && p.config.trim()) { try { raw = JSON.parse(p.config); } catch { throw new AppError("INVALID_INPUT", "MCP 配置必须是有效 JSON 对象。"); } }
      else raw = target?.mcp?.[0]?.raw;
      if (source && !p.configOnly) {
        const installed = await this.npm(directory, source), bins = installed.pkg.bin;
        const binName = typeof p.bin === "string" && p.bin ? p.bin : target?.managed?.bin;
        const bin = typeof bins === "string" ? bins : bins && (binName ? bins[binName] : Object.keys(bins).length === 1 ? Object.values(bins)[0] : undefined);
        if (typeof bin !== "string" || !inside(installed.root, resolve(installed.root, bin)) || !existsSync(resolve(installed.root, bin))) throw new AppError("INVALID_INPUT", "npm 包没有唯一可执行入口，请填写 bin 名称。");
        const args = raw && typeof raw === "object" && "args" in raw && Array.isArray(raw.args) ? raw.args : [];
        raw = { ...(raw && typeof raw === "object" ? raw : {}), command: process.execPath, args: [resolve(installed.root, bin), ...(target?.managed && args[0] === target.mcp?.[0]?.raw?.args?.[0] ? args.slice(1) : args)] };
        record = { scopeId: scope.id, id: target?.managed?.id ?? id, kind: "mcp", name, source, directory, version: installed.pkg.version, bin: binName };
      }
      const validate = (await validation).validateMcpServerConfig;
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
      this.assertFiles();
      const previous = this.records();
      if (record) this.save([...previous.filter(r => r.id !== record!.id), record]);
      const path = entries[0].path, config = json(path); config.mcpServers ??= {}; config.mcpServers[name] = override ?? parsed;
      try { atomic(path, config); }
      catch (error) { if (record) this.save(previous); throw error; }
      committed = !!record;
      if (record && target?.managed) rmSync(target.managed.directory, { recursive: true, force: true });
    } finally { if (!committed) rmSync(directory, { recursive: true, force: true }); }
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
        const otherEntries = [...this.targets.values()].flatMap(t => (t.mcp ?? []).filter(e => !entries.some(removed => removed.path === e.path && t.item.name === name)).map(e => ({ name: t.item.name, raw: e.raw })));
        const sameUrl = (e: { raw: any }) => { try { return String(new URL(e.raw.url)) === url; } catch { return false; } };
        const sharedLegacy = otherEntries.some(sameUrl), sharedNamed = otherEntries.some(e => e.name === name && sameUrl(e));
        await store.forServer(name, url).withRefreshLock(async () => {
          backend.withLock(raw => {
            const data = raw ? JSON.parse(raw) : {}; if (!sharedNamed) delete data[key];
            if (!sharedLegacy) delete data[url];
            return { result: undefined, next: JSON.stringify(data, null, 2) };
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
  private async remove(target: Target) {
    this.prune(target);
    if (target.package) {
      const pkg = target.package, { manager, settingsManager } = this.manager(pkg.cwd);
      await manager.removeAndPersist(pkg.source, { local: pkg.local }); await settingsManager.flush();
      if (settingsManager.drainErrors().length) throw Error("包声明清理失败。");
    } else if (target.mcp) {
      await this.credentials(target.item.name, target.mcp);
      this.assertFiles();
      for (const entry of target.mcp) { const config = json(entry.path); delete config.mcpServers?.[target.item.name]; atomic(entry.path, config); }
    } else if (target.path) {
      if (target.referenceOnly) {
        const path = this.settings(target.item.scopeId), settings = json(path), guides = target.skillPaths ?? [];
        settings.skills = [...(settings.skills ?? []).filter((p: unknown) => typeof p !== "string" || ![target.path!, ...guides].some(value => resolve(dirname(path), p) === resolve(value))), ...guides.map(guide => `!${guide}`)];
        atomic(path, settings); return;
      }
      const paths = [target.path, ...(target.skillPaths ?? [])];
      for (const path of this.files.keys()) if (basename(path) === "settings.json") {
        const settings = json(path);
        if (Array.isArray(settings.skills)) { const before = settings.skills; settings.skills = before.filter((p: unknown) => typeof p !== "string" || !paths.some(value => p === value || resolve(dirname(path), p) === resolve(value))); if (settings.skills.length !== before.length) atomic(path, settings); }
      }
      rmSync(target.path, { recursive: true, force: true });
    }
    if (target.managed) {
      if (target.managed.kind === "skill") this.replacePaths(target.managed.paths ?? [], [], target.managed.scopeId);
      rmSync(target.managed.directory, { recursive: true, force: true });
      this.save(this.records().filter(r => r.id !== target.managed!.id));
    }
  }
  async close() { this.closed = true; this.controller.abort(); await this.pending; }
}
