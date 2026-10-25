import { clearReaDownloads, reaDownloadPlan, type DownloadId } from "./rea-download-cleanup.js";
import { toolProcessSupported, toolProcessSupportError } from "./tool-process.js";
import { loadReaSkill } from "./rea-resources.js";
import { compareEngineVersions, isReaEngineId, reaEngineIds, reaEngineLabels, type ReaEngineId } from "../../shared/rea-engines.js";
import { withResourceFiles } from "../resource-file-lock.js";
import { checkEngines, engineHost, engineValidationRevision, listEngines, validEnginePath } from "./rea-engines.js";
import { engineRelease, prepareEngine, type EngineRelease } from "./rea-engine-install.js";
import { openHopperInstaller, prepareEngineDownload, reuseEngineDownload, storedEngineDownload } from "./rea-engine-download.js";
import { engineContractVersion, engineContractSupported, reaEngineProfiles } from "./rea-engine-policy.js";
import { managedNode, type ManagedNodeProvider } from "./managed-node.js";
import { supervisorEnvironment } from "./component-environment.js";
import { fileURLToPath } from "node:url";
import { beginBuiltinOperation, builtinPendingOperation, builtinPendingRemovals, reconcileBuiltinOperation, bindBuiltinTask, runBuiltinTool, trackBuiltinDirectory, assertBuiltinFilesSafe, forgetBuiltinDirectory, withBuiltinConfiguration, builtinRemovalDirectories, inspectBuiltinDirectoryOwnership } from "./builtin-operation.js";
import { randomUUID } from "node:crypto";
import { runMaintenance, maintenanceCancelled, maintenanceFailure, maintenancePhase } from "../maintenance.js";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { managedChildren, managedDirectory, type IntegrationRemoval } from "./managed-removal.js";
import { cleanupScope, assertCleanupScope } from "./cleanup-scope.js";
import { insideReaDirectory, reaRemovalPlan, removeRea } from "./rea-removal.js";
import { AppError, type Command } from "../../shared/protocol.js";
import { emptyReaState, reaVersion, type ReaJob, type ReaState } from "../../shared/rea.js";
import { errorMessage } from "../error-message.js";
import { executeOpenCli, findNpmCli, newerOpenCli, type OpenCliExecute } from "./opencli.js";
import { atomicReaJson, inspectReaPackage, inspectReaProgram, reaConfigPath, reaDirectory, reaPackageRoot, reaSupportedNode, reaNode, reaProcessEnvironment, readReaConfig, reaEngineDirectoryPattern, reaDownloadDirectoryPattern, reaProgramDirectoryPattern, reaEngineRevision, validReaVersion, type ReaConfig } from "./rea-runtime.js";

export async function diagnoseRea(root: string, packageRoot: string, version: string, signal: AbortSignal, config = readReaConfig(root)) {
  signal.throwIfAborted(); inspectReaProgram(packageRoot, version);
  const source = import.meta.url.endsWith(".ts");
  const entry = fileURLToPath(new URL(`./rea-diagnostic-worker.${source ? "ts" : "js"}`, import.meta.url));
  const args = [...(source ? ["--import", import.meta.resolve("tsx")] : []), entry, root, packageRoot, version, JSON.stringify(config)];
  const result = await runBuiltinTool("rea", process.execPath, args, { cwd: root, env: supervisorEnvironment(), signal, timeout: 45_000, limit: 65536, errorLimit: 65536 });
  if (result.code !== 0) throw Error(errorMessage(result.stderr.toString("utf8"), "REA MCP 检查未完成，请检查安装依赖。", true));
  const value = JSON.parse(result.stdout.toString("utf8"));
  if (typeof value?.text !== "string" || !Number.isSafeInteger(value.toolCount) || value.toolCount < 1 || !Number.isFinite(value.at)) throw Error("REA MCP 检查未返回有效结果。");
  return value as { text: string; toolCount: number; at: number };
}
export type ReaDependencies = { execute?: OpenCliExecute; locateNpm?: () => string; diagnose?: typeof diagnoseRea; checkEngines?: typeof checkEngines; prepareEngine?: typeof prepareEngine; engineRelease?: typeof engineRelease; prepareEngineDownload?: typeof prepareEngineDownload; openHopperInstaller?: typeof openHopperInstaller; removal?: IntegrationRemoval; runtime?: ManagedNodeProvider };
export class ReaService {
  private state: ReaState = { ...emptyReaState, nodeVersion: process.version, supported: reaSupportedNode() };
  private operations = new Map<string, { job: ReaJob; controller: AbortController; pending?: Promise<void> }>();
  private closed = false;
  private engineReleases = new Map<ReaEngineId, { token: string; revision: string; checkedAt: number; release: EngineRelease }>();
  constructor(readonly root: string, private readonly changed: () => void, private readonly dependencies: ReaDependencies = {}) {
    this.load();
    const jobs = new Map<string, ReaJob>();
    for (const engine of [undefined, ...reaEngineIds]) try {
      const job: ReaJob = JSON.parse(readFileSync(this.jobPath(engine), "utf8"));
      if (job && typeof job.id === "string" && (!job.engine || isReaEngineId(job.engine)) && (!engine || job.engine === engine) && ["check", "install", "doctor", "engines-check", "engine-check", "engine-install", "engine-download", "engine-open-installer", "uninstall", "engine-uninstall", "clearDownloads"].includes(job.kind)) {
        if (job.running) Object.assign(job, { running: false, message: "上次操作被中断", error: "请重新检查当前安装；不会自动重复安装。" });
        jobs.set(job.engine ?? "rea", job);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.error = "无法读取 REA 操作记录。"; }
    this.state.jobs = [...jobs.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    this.load();
  }
  private jobPath(engine?: ReaEngineId) { return join(reaDirectory(this.root), ...(engine ? ["jobs", `${engine}.json`] : ["job.json"])); }
  private assertAvailable(engine?: ReaEngineId) {
    if (this.operations.has("rea") || (engine ? this.operations.has(engine) : this.operations.size > 0))
      throw new AppError("BUSY", engine ? "请等待此组件或 REA 主程序维护完成。" : "请等待 REA 与配套组件维护完成。");
  }
  private engineMatches(config: ReaConfig, engine: ReaEngineId, revision: unknown) {
    return revision === reaEngineRevision(config, engine) || revision === config.revision;
  }
  private commitEngine(engine: ReaEngineId, revision: string, update: (fresh: ReaConfig) => ReaConfig, onPublished?: () => void) {
    return withResourceFiles([reaConfigPath(this.root)], () => {
      const fresh = readReaConfig(this.root);
      if (reaEngineRevision(fresh, engine) !== revision) throw new AppError("CONFIGURATION_CONFLICT", "此组件或 REA 版本已变化，请重新检查后操作。");
      const next = { ...update(fresh), revision: randomUUID() };
      atomicReaJson(reaConfigPath(this.root), next, onPublished);
      return next;
    });
  }
  private load() {
    this.state.nodeVersion = ""; this.state.runtimeManaged = false; delete this.state.npmVersion;
    delete this.state.version; delete this.state.packageRoot; delete this.state.skillError; delete this.state.mcpError;
    this.state.skillInstalled = false; this.state.mcpInstalled = false;
    try {
      const config = readReaConfig(this.root);
      this.state.engines = listEngines(config, this.state.engines);
      for (const engine of this.state.engines) {
        const candidate = this.engineReleases.get(engine.id);
        if (candidate?.revision !== engine.revision) this.engineReleases.delete(engine.id);
        if (candidate && candidate.revision === engine.revision) engine.available = { token: candidate.token, version: candidate.release.version, url: candidate.release.url, checkedAt: candidate.checkedAt, mode: engine.installable ? "install" : "download", minimumSystem: candidate.release.minimumSystem };
        else delete engine.available;
        const recommendation = this.state.jobs?.find(job => job.engine === engine.id)?.recommendation;
        const host = engineHost();
        if (recommendation?.reaVersion === config.installation?.version && recommendation?.platform === host.platform && recommendation.arch === host.arch && typeof recommendation.version === "string" && compareEngineVersions(recommendation.version, recommendation.version) === 0) engine.recommendedVersion = recommendation.version;
        delete engine.download;
        try {
          const download = storedEngineDownload(this.root, engine.id, config.downloads?.[engine.id]);
          if (download) engine.download = { version: download.version, path: download.path };
        } catch (error) {
          engine.status = "error"; engine.detail = errorMessage(error, "安装包无法读取，请检查此组件。");
        }
      }
      this.state.engineHost = engineHost();
      this.state.revision = config.revision; this.state.enabled = config.enabled;
      this.state.removalPending = !!config.removalPending?.some(name => reaProgramDirectoryPattern.test(name));
      this.state.version = config.installation?.version; this.state.packageRoot = reaPackageRoot(this.root, config);
      this.state.nodeVersion = config.installation?.runtime ? `v${config.installation.runtime.nodeVersion}` : process.version;
      this.state.runtimeManaged = !!config.installation?.runtime;
      this.state.npmVersion = config.installation?.runtime?.npmVersion;
      this.state.supported = true; // Installation support, not legacy runtime compatibility.
      if (config.installation?.runtime) try { reaNode(this.root, config); }
      catch (error) { this.state.mcpError = errorMessage(error, "REA 私有运行时不完整，请重新安装。"); }
      else if (config.installation && engineContractSupported(config.installation.version) && !reaSupportedNode(process.versions.node, reaEngineProfiles[config.installation.version].node)) {
        this.state.mcpError = `现有共享 Node ${process.version} 不满足 REA ${config.installation.version} 的运行要求；请重新安装或更新以准备兼容的专用环境，无需升级后台 Node。`;
      }
      this.state.skillInstalled = !!config.installation && config.skillInstalled !== false;
      this.state.mcpInstalled = !!config.installation && config.mcpInstalled !== false;
      if (this.state.skillInstalled && this.state.packageRoot) try { loadReaSkill(this.root, this.root, this.state.packageRoot); }
      catch (error) { this.state.skillError = errorMessage(error, "REA 技能文件不完整，请重新安装 REA 恢复官方文件。"); }
      if (this.state.mcpInstalled && this.state.packageRoot) try { inspectReaProgram(this.state.packageRoot, this.state.version!); }
      catch { this.state.mcpError = "REA 程序文件不完整，请重新安装 REA 恢复 MCP。"; }
      delete this.state.error;
    } catch (error) { this.state.error = errorMessage(error, "REA 安装不完整，请重新安装。"); }
  }
  snapshot() {
    const value = structuredClone(this.state);
    // Legacy clients receive one representative job; current clients use jobs.
    value.job = value.jobs?.findLast(job => job.running) ?? value.jobs?.at(-1);
    if (!toolProcessSupported()) { value.supported = false; value.supportError = toolProcessSupportError; }
    try {
      value.pendingOperation = builtinPendingOperation(this.root, "rea");
      const config = readReaConfig(this.root), pendingPaths = builtinPendingRemovals(this.root, "rea");
      const removals = pendingPaths.filter(path => ["versions", "engines"].some(container => dirname(path) === join(reaDirectory(this.root), container))).map(path => basename(path));
      value.cleanup = cleanupScope(reaRemovalPlan(this.root, config, pendingPaths).paths);
      value.removalPending ||= removals.some(name => reaProgramDirectoryPattern.test(name));
      const engineDirectories = managedChildren(this.root, ["integrations", "rea"], "engines", reaEngineDirectoryPattern);
      for (const engine of value.engines ?? []) {
        engine.pendingOperation = builtinPendingOperation(this.root, "rea", engine.id);
        const scopedPaths = builtinPendingRemovals(this.root, "rea", engine.id);
        const scopedRemovals = scopedPaths.filter(path => dirname(path) === join(reaDirectory(this.root), "engines")).map(path => basename(path));
        engine.cleanup = cleanupScope(reaRemovalPlan(this.root, config, [...pendingPaths, ...scopedPaths], engine.id).paths);
        engine.cleanupUnverified = engineDirectories.filter(name => name.startsWith(`${engine.id}-`)).map(name => join(reaDirectory(this.root), "engines", name)).filter(path => !engine.cleanup!.paths.includes(path));
        engine.removalPending ||= [...removals, ...scopedRemovals].some(name => name.startsWith(`${engine.id}-`));
      }
    }
    catch (error) { value.error = errorMessage(error, "维护归属记录不可读取，已保留文件。"); }
    value.downloadCleanup = {}; value.downloadCleanupErrors = {};
    for (const id of ["ghidra", "hopper"] as const) {
      try {
        const plan = reaDownloadPlan(this.root, readReaConfig(this.root), id, builtinPendingRemovals(this.root, "rea"));
        for (const path of plan.files.keys()) inspectBuiltinDirectoryOwnership(this.root, "rea", path);
        value.downloadCleanup[id] = plan.scope;
      }
      catch (error) { value.downloadCleanupErrors[id] = errorMessage(error, "无法核实登记下载包。"); }
    }
    return value;
  }
  private notify(job: ReaJob, message?: string) {
    if (message) job.message = message;
    atomicReaJson(this.jobPath(job.engine), job);
    this.changed();
  }
  private saveConfiguration(next: ReaConfig, revision: string) {
    withBuiltinConfiguration(this.root, "rea", () => withResourceFiles([reaConfigPath(this.root)], () => {
      if (readReaConfig(this.root).revision !== revision) throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后保存。");
      atomicReaJson(reaConfigPath(this.root), next);
    }));
  }
  private run(args: string[], signal: AbortSignal, timeout = 30_000, config = readReaConfig(this.root)) {
    const env = reaProcessEnvironment(this.root, config);
    return (this.dependencies.execute ?? executeOpenCli)(args, { cwd: this.root, env, signal, timeout, tool: "rea", nodeExecutable: reaNode(this.root, config) });
  }
  async command(c: Command): Promise<ReaState> {
    if (c.workspaceId || c.sessionId) throw new AppError("INVALID_SCOPE", "REA 使用应用级配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    const p = c.params ?? {};
    if (c.op === "rea.get" || c.op === "rea.refresh") { this.load(); this.changed(); return this.snapshot(); }
    if (c.op === "rea.cancel") {
      const active = [...this.operations.values()].find(item => item.job.id === p.jobId);
      if (!active?.job.running) throw new AppError("NOT_RUNNING", "操作已结束，请读取最新状态。");
      if (["uninstall", "engine-uninstall", "clearDownloads"].includes(active.job.kind)) throw new AppError("NOT_CANCELLABLE", "卸载已开始，正在等待程序退出并清理文件。");
      active.controller.abort(); await active.pending; return this.snapshot();
    }
    const engine = isReaEngineId(p.engine) ? p.engine : undefined;
    const componentOperation = ["rea.engineSave", "rea.engine-check", "rea.engine-install", "rea.engine-download", "rea.engine-open-installer", "rea.engine-uninstall", "rea.clearDownloads"].includes(c.op);
    if (componentOperation && !engine || c.op === "rea.reconcile" && p.engine !== undefined && !engine) throw new AppError("INVALID_SETTINGS", "请选择有效的 REA 组件。");
    const scope = componentOperation || c.op === "rea.reconcile" ? engine : undefined;
    if (c.op === "rea.clearDownloads" && !["ghidra", "hopper"].includes(engine!)) throw new AppError("INVALID_SETTINGS", "请选择 Ghidra 或 Hopper 登记下载包。");
    this.assertAvailable(["rea.engine-uninstall", "rea.clearDownloads"].includes(c.op) ? undefined : scope);
    if (c.op === "rea.reconcile") {
      reconcileBuiltinOperation(this.root, "rea", p.operationId, scope);
      this.load(); this.changed(); return this.snapshot();
    }
    const current = readReaConfig(this.root);
    const engineRevision = engine ? reaEngineRevision(current, engine) : undefined;
    if (["rea.installSkill", "rea.uninstallSkill", "rea.installMcp", "rea.uninstallMcp"].includes(c.op)) {
      if (p.revision !== current.revision) { this.load(); this.changed(); throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后操作。"); }
      const packageRoot = reaPackageRoot(this.root, current);
      if (!packageRoot) throw new AppError("NOT_INSTALLED", "请先安装 REA，再管理技能与 MCP。");
      const skill = c.op.endsWith("Skill"), installed = c.op.startsWith("rea.install");
      if (installed) {
        try {
          if (skill) loadReaSkill(this.root, this.root, packageRoot);
          else inspectReaProgram(packageRoot, current.installation!.version);
        } catch { throw new AppError("COMPONENT_INVALID", `REA ${skill ? "技能" : "程序"}文件不完整，请重新安装 REA 恢复官方文件，再安装${skill ? "技能" : " MCP"}。`); }
      }
      this.saveConfiguration({ ...current, [skill ? "skillInstalled" : "mcpInstalled"]: installed, revision: randomUUID() }, current.revision);
      this.load(); this.changed(); return this.snapshot();
    }
    if (c.op === "rea.engineSave") {
      if (!validEnginePath(p.path)) throw new AppError("INVALID_SETTINGS", "请输入后台电脑上的绝对路径，不支持变量或控制字符；留空恢复自动发现。");
      if (!this.engineMatches(current, engine!, p.revision)) { this.load(); this.changed(); throw new AppError("CONFIGURATION_CONFLICT", "此组件配置已变化，请重新读取后保存。"); }
      withBuiltinConfiguration(this.root, "rea", () => this.commitEngine(engine!, engineRevision!, fresh => {
        const engines = { ...fresh.engines };
        if (p.path) engines[engine!] = p.path as string; else delete engines[engine!];
        return { ...fresh, engines };
      }), engine);
      this.load(); this.changed(); return this.snapshot();
    }
    if (c.op === "rea.save") {
      if (typeof p.enabled !== "boolean") throw new AppError("INVALID_SETTINGS", "请选择是否默认启用 REA。");
      if (p.revision !== current.revision) { this.load(); this.changed(); throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后保存。"); }
      if (!current.installation) throw new AppError("NOT_INSTALLED", "请先安装 REA。");
      this.saveConfiguration({ ...current, enabled: p.enabled, revision: randomUUID() }, current.revision);
      this.load(); this.changed(); return this.snapshot();
    }
    const kind = c.op.slice(4) as ReaJob["kind"];
    if (!c.op.startsWith("rea.") || !["check", "install", "doctor", "engines-check", "engine-check", "engine-install", "engine-download", "engine-open-installer", "uninstall", "engine-uninstall", "clearDownloads"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此 REA 操作。");
    const removing = kind === "uninstall" || kind === "engine-uninstall" || kind === "clearDownloads";
    if (kind === "clearDownloads" && (typeof p.cleanupRevision !== "string" || !/^[a-f0-9]{64}$/.test(p.cleanupRevision))) throw new AppError("CONFIRM_REQUIRED", "请读取并确认登记下载包范围。");
    if (!removing && !toolProcessSupported()) throw new AppError("UNSUPPORTED_PLATFORM", toolProcessSupportError);
    const host = engineHost();
    const downloadable = !!engine && (listEngines(current).find(item => item.id === engine)?.installable || engine === "ghidra" && ["darwin", "linux"].includes(host.platform) || engine === "hopper" && host.platform === "darwin");
    if (removing && (p.confirm !== true || (scope ? !this.engineMatches(current, scope, p.revision) : p.revision !== current.revision))) throw new AppError("CONFIRM_REQUIRED", "请读取最新配置并确认卸载；设置和外部组件将保留。");
    if (kind === "engine-uninstall" && (!engine || engine === "hopper")) throw new AppError("EXTERNAL_INSTALLATION", "此组件由外部管理，请通过原安装方式卸载。");
    const candidate = engine ? this.engineReleases.get(engine) : undefined;
    if (kind === "engine-check") {
      if (!engine || listEngines(current).find(item => item.id === engine)?.status === "unsupported") throw new AppError("UNSUPPORTED_ENGINE", "当前后台平台不支持此组件。");
      if (!engineContractSupported(current.installation?.version)) throw new AppError("UNSUPPORTED_ENGINE", `组件版本策略验证于 REA ${engineContractVersion}/6.8.0，当前 REA 尚未适配。`);
    }
    const cachedInstall = kind === "engine-install" && p.downloaded === true;
    if (kind === "engine-open-installer") {
      if (!engineContractSupported(current.installation?.version)) throw new AppError("UNSUPPORTED_ENGINE", `组件版本策略验证于 REA ${engineContractVersion}，当前 REA 尚未适配。`);
      if (engine !== "hopper" || host.platform !== "darwin" || !["x64", "arm64"].includes(host.arch)) throw new AppError("UNSUPPORTED_ENGINE", "此平台不支持 Hopper 安装入口。");
      if (!this.engineMatches(current, engine, p.revision)) throw new AppError("CONFIGURATION_CONFLICT", "此组件已变化，请刷新后重新确认安装。");
      if (p.confirm !== true || !current.downloads?.hopper || p.version !== current.downloads.hopper.version) throw new AppError("CONFIRM_REQUIRED", "请确认已下载的 Hopper 安装包版本。");
    }
    if (kind === "engine-install" || kind === "engine-download") {
      if (!this.engineMatches(current, engine!, p.revision)) throw new AppError("CONFIGURATION_CONFLICT", "此组件或 REA 版本已变化，请刷新后操作。");
      if (cachedInstall) {
        if (engine !== "ghidra" || p.confirm !== true || !current.downloads?.ghidra || p.version !== current.downloads.ghidra.version) throw new AppError("CONFIRM_REQUIRED", "请确认已下载的 Ghidra 安装包版本。");
      } else if (!candidate || candidate.revision !== engineRevision || candidate.token !== p.token || candidate.release.version !== p.version) throw new AppError("CHECK_REQUIRED", "请先检查此组件更新，再确认已匹配的版本。");
      const installable = listEngines(current).find(item => item.id === engine)?.installable;
      if (kind === "engine-install" && !installable || kind === "engine-download" && (!downloadable || !["ghidra", "hopper"].includes(engine!))) throw new AppError("UNSUPPORTED_ENGINE", "此平台的组件维护方式已变化，请重新检查更新。");
    }
    const version = this.state.latest ?? reaVersion;
    if (kind === "install" && (p.version !== version || !validReaVersion(version))) throw new AppError("CHECK_REQUIRED", "请安装推荐版本，或先检查更新再安装已确认的版本。");
    if (kind === "install" && current.installation && version !== current.installation.version && !newerOpenCli(version, current.installation.version)) throw new AppError("DOWNGRADE", "当前版本较新，未执行降级。");
    const exclusive = !scope || kind === "engine-uninstall" || kind === "clearDownloads";
    const operation = beginBuiltinOperation(this.root, "rea", undefined, exclusive ? undefined : scope);
    const controller = new AbortController(), signal = controller.signal;
    const job: ReaJob = { id: randomUUID(), kind, engine: scope, startedAt: Date.now(), running: true, message: kind === "install" ? `正在安装 REA ${version}…` : "正在检查 REA…", recommendation: candidate ? { version: candidate.release.version, reaVersion: current.installation!.version, ...host } : this.state.jobs?.find(job => job.engine === scope)?.recommendation };
    const active: { job: ReaJob; controller: AbortController; pending?: Promise<void> } = { job, controller };
    const resource = exclusive ? "rea" : scope!;
    this.operations.set(resource, active);
    this.state.jobs = [...(this.state.jobs ?? []).filter(item => item.engine !== scope), job];
    if (kind === "engine-check") { this.engineReleases.delete(engine!); const item = this.state.engines?.find(item => item.id === engine); if (item) delete item.available; }
    if (kind === "check") delete this.state.latest;
    if (kind === "doctor" || kind === "install") delete this.state.diagnostic;
    try { this.notify(job); } catch { job.running = false; this.operations.delete(resource); this.changed(); try { operation.finish(); } finally { operation.close(); } throw new AppError("STORAGE_ERROR", "无法保存操作记录；尚未开始执行。"); }
    active.pending = operation.run(() => Promise.resolve().then(() => runMaintenance(this.root, { id: job.id, resource: scope ? `rea:${scope}` : "rea", label: scope ? `REA ${reaEngineLabels[scope]}` : "REA", action: kind, params: p, cancel: !removing, steps: removing ? ["checking", "removing", "validating"] : kind === "install" ? ["checking", "installing", "validating"] : kind === "engine-install" ? undefined : kind === "engine-download" ? ["checking", "downloading", "verifying", "validating"] : ["checking"] }, controller, async () => {
      bindBuiltinTask();
      let prepared: string | undefined, reused = false, installationPublished = false;
      try {
        if (kind === "clearDownloads") {
          const cleanup = () => withResourceFiles([reaConfigPath(this.root)], () => {
            signal.throwIfAborted(); assertBuiltinFilesSafe();
            const fresh = readReaConfig(this.root);
            if (reaEngineRevision(fresh, engine!) !== engineRevision) throw new AppError("CONFIGURATION_CONFLICT", "下载包登记已变化，请重新确认。");
            maintenancePhase("removing");
            clearReaDownloads(this.root, engine as DownloadId, fresh.revision, p.cleanupRevision);
            maintenancePhase("validating");
          });
          if (this.dependencies.removal) await this.dependencies.removal(cleanup); else cleanup();
        } else if (removing) {
          assertCleanupScope(p.cleanupRevision, cleanupScope(reaRemovalPlan(this.root, readReaConfig(this.root), builtinRemovalDirectories(), scope).paths));
          const operation = () => withResourceFiles([reaConfigPath(this.root)], () => {
            signal.throwIfAborted(); assertBuiltinFilesSafe();
            const fresh = readReaConfig(this.root);
            if (scope ? reaEngineRevision(fresh, scope) !== engineRevision : fresh.revision !== current.revision) throw new AppError("CONFIGURATION_CONFLICT", "配置已变化，请重新读取后卸载。");
            removeRea(this.root, fresh.revision, scope, p.cleanupRevision);
          });
          if (this.dependencies.removal) await this.dependencies.removal(operation); else operation();
          delete this.state.diagnostic;
        } else if (kind === "engines-check") {
          this.state.engines = await (this.dependencies.checkEngines ?? checkEngines)(this.root, current, reaPackageRoot(this.root, current), signal);
        } else if (kind === "engine-check") {
          const checks = await (this.dependencies.checkEngines ?? checkEngines)(this.root, current, reaPackageRoot(this.root, current), signal, undefined, engine);
          const item = checks.find(item => item.id === engine)!;
          this.state.engines = this.state.engines?.map(previous => previous.id === engine ? item : previous);
          if (downloadable) {
            const release = await (this.dependencies.engineRelease ?? engineRelease)(engine!, signal, host, undefined, current.installation!.version);
            signal.throwIfAborted();
            let checkedConfig = readReaConfig(this.root);
            if (reaEngineRevision(checkedConfig, engine!) !== engineRevision) throw Error("检查期间此组件配置已变化，请重新检查组件更新。");
            if (checkedConfig.downloads?.[engine!]?.version === release.version && !await reuseEngineDownload(this.root, engine!, checkedConfig.downloads[engine!], release, signal)) {
              // Stale packages stay on disk, but must not suppress the download action.
              checkedConfig = this.commitEngine(engine!, engineRevision!, fresh => { const downloads = { ...fresh.downloads }; delete downloads[engine!]; return { ...fresh, downloads }; });
            }
            this.engineReleases.set(engine!, { token: randomUUID(), revision: reaEngineRevision(checkedConfig, engine!), checkedAt: Date.now(), release });
            job.recommendation = { version: release.version, reaVersion: current.installation!.version, ...host };
          }
        } else if (kind === "engine-download") {
          const cached = await reuseEngineDownload(this.root, engine!, current.downloads?.[engine!], candidate!.release, signal);
          if (cached) {
            assertBuiltinFilesSafe();
            if (reaEngineRevision(readReaConfig(this.root), engine!) !== engineRevision) throw Error("此组件配置已变化，请重新检查。");
            reused = true;
          } else {
            const download = await (this.dependencies.prepareEngineDownload ?? prepareEngineDownload)(this.root, engine!, candidate!.release, signal, message => this.notify(job, message));
            const directory = basename(download.directory);
            const owned = managedDirectory(this.root, ["integrations", "rea", "downloads"], directory, reaDownloadDirectoryPattern);
            if (!owned || resolve(download.directory) !== resolve(owned) || !directory.startsWith(`${engine}-`) || download.filename !== (engine === "ghidra" ? "package.zip" : "package.dmg") || resolve(download.path) !== join(owned, download.filename)) throw Error("组件下载未返回有效的托管目录。");
            prepared = owned; trackBuiltinDirectory(prepared);
            signal.throwIfAborted(); assertBuiltinFilesSafe();
            this.commitEngine(engine!, engineRevision!, fresh => ({ ...fresh, downloads: { ...fresh.downloads, [engine!]: { directory, filename: download.filename, version: candidate!.release.version } } }), () => { prepared = undefined; });
          }
        } else if (kind === "engine-open-installer") {
          this.notify(job, "正在校验并打开 Hopper 安装映像…");
          await (this.dependencies.openHopperInstaller ?? openHopperInstaller)(this.root, current.downloads!.hopper!, signal);
        } else if (kind === "engine-install") {
          const release = cachedInstall ? await (this.dependencies.engineRelease ?? engineRelease)(engine!, signal, host, undefined, current.installation!.version) : candidate!.release;
          if (release.version !== p.version) throw Error("已下载的版本与当前推荐版本不同，请检查更新后重新确认。原安装包已保留。");
          job.recommendation = { version: release.version, reaVersion: current.installation!.version, ...host };
          // A checked equivalent version is a no-op, including external installs.
          // Revalidate it here so deleted files or a concurrent Java switch cannot be reused.
          for (let attempt = 0; ; attempt++) {
            const fresh = readReaConfig(this.root), item = listEngines(fresh, this.state.engines).find(item => item.id === engine)!;
            if (!item.version || compareEngineVersions(item.version, release.version) !== 0) break;
            const validationRevision = engineValidationRevision(fresh, engine!);
            const checks = await (this.dependencies.checkEngines ?? checkEngines)(this.root, fresh, reaPackageRoot(this.root, fresh), signal, undefined, engine);
            signal.throwIfAborted();
            const latest = readReaConfig(this.root);
            if (reaEngineRevision(latest, engine!) !== engineRevision) throw Error("此组件配置已变化，请重新检查。");
            if (engineValidationRevision(latest, engine!) !== validationRevision) {
              if (attempt < 2) continue;
              throw Error("Java 路径在验证期间多次变化，请重新检查组件。");
            }
            const result = checks.find(item => item.id === engine);
            reused = result?.status === "ready" && !!result.version && compareEngineVersions(result.version, release.version) === 0;
            if (reused) this.state.engines = this.state.engines?.map(item => item.id === engine ? result! : item);
            break;
          }
          if (!reused) {
          const installation = await (this.dependencies.prepareEngine ?? prepareEngine)(this.root, engine!, signal, message => this.notify(job, message), undefined, release, { cachedOnly: cachedInstall });
          const directory = basename(installation.directory);
          const ownedDirectory = managedDirectory(this.root, ["integrations", "rea", "engines"], directory, reaEngineDirectoryPattern);
          if (!ownedDirectory || resolve(installation.directory) !== resolve(ownedDirectory) || !directory.startsWith(`${engine}-`) || !insideReaDirectory(ownedDirectory, installation.path)) throw Error("组件安装未返回有效的托管目录。");
          prepared = ownedDirectory; trackBuiltinDirectory(prepared);
          maintenancePhase("validating");
          this.notify(job, "正在验证新组件，验证通过后才切换路径…");
          // Downloads remain parallel. Validate with the latest Java binding;
          // if another install switches it mid-probe, repeat against that JDK.
          for (let attempt = 0; ; attempt++) {
            const fresh = readReaConfig(this.root);
            const next = { ...fresh, engines: { ...fresh.engines, [engine!]: installation.path }, managedEngines: { ...fresh.managedEngines, [engine!]: [...(fresh.managedEngines?.[engine!] ?? []), { directory, path: installation.path, version: release.version }] } };
            const validationRevision = engineValidationRevision(next, engine!);
            const checks = await (this.dependencies.checkEngines ?? checkEngines)(this.root, next, reaPackageRoot(this.root, current), signal, undefined, engine);
            signal.throwIfAborted();
            const latest = readReaConfig(this.root);
            const latestCandidate = { ...next, engines: { ...next.engines, java: engine === "java" ? installation.path : latest.engines?.java } };
            if (engineValidationRevision(latestCandidate, engine!) !== validationRevision) {
              if (attempt < 2) continue;
              throw Error("Java 路径在验证期间多次变化，请重新检查组件后安装。");
            }
            const result = checks.find(item => item.id === engine);
            if (result?.status !== "ready") throw Error(`组件安装后检测未通过：${result?.detail ?? "未返回检测结果"}。当前路径保持不变。`);
            assertBuiltinFilesSafe();
            this.commitEngine(engine!, engineRevision!, fresh => ({ ...fresh, engines: { ...fresh.engines, [engine!]: installation.path }, managedEngines: { ...fresh.managedEngines, [engine!]: next.managedEngines[engine!] } }), () => { prepared = undefined; });
            this.state.engines = this.state.engines?.map(item => item.id === engine ? result : item);
            break;
          }
          }
        } else if (kind === "check") {
          const latest = await (this.dependencies.runtime ?? managedNode).latest("rea-agents", signal);
          if (!validReaVersion(latest)) throw Error("npm 未返回有效的 REA 稳定版本。");
          this.state.latest = latest;
        } else if (kind === "install") {
          if (!engineContractSupported(version)) throw Error(`REA ${version} 的配套依赖契约尚未验证，当前版本保持不变。`);
          const directory = `v${version}-${randomUUID()}`;
          prepared = join(reaDirectory(this.root), "versions", directory);
          mkdirSync(prepared, { recursive: true }); trackBuiltinDirectory(prepared);
          // Keep the complete package and npm lock, including native optional dependencies.
          // Each install uses a new prefix; active workers retain their previous version.
          const runtime = await (this.dependencies.runtime ?? managedNode).prepare("rea", prepared, "rea-agents", version, signal, text => this.notify(job, text));
          const next: ReaConfig = { ...current, revision: randomUUID(), installation: { directory, version, runtime: runtime.binding } };
          await this.run([runtime.npm, "install", "--prefix", prepared, "--global=false", "--no-audit", "--no-fund", "--omit=dev", "--engine-strict", "--registry=https://registry.npmjs.org", `rea-agents@${version}`], signal, 600_000, next);
          signal.throwIfAborted();
          maintenancePhase("validating");
          this.notify(job, "正在检查 REA 技能与 MCP 连接…");
          const packageRoot = join(prepared, "node_modules", "rea-agents");
          inspectReaPackage(packageRoot, version);
          loadReaSkill(this.root, this.root, packageRoot);
          const diagnostic = await (this.dependencies.diagnose ?? diagnoseRea)(this.root, packageRoot, version, signal, next);
          signal.throwIfAborted();
          if (readReaConfig(this.root).revision !== current.revision) throw Error("安装期间配置已变化，未切换当前版本，请重新检查。");
          assertBuiltinFilesSafe();
          atomicReaJson(reaConfigPath(this.root), next, () => { prepared = undefined; installationPublished = true; });
          this.state.diagnostic = diagnostic;
        } else {
          const packageRoot = reaPackageRoot(this.root, current);
          if (!packageRoot) throw Error("请先安装 REA。");
          this.state.diagnostic = await (this.dependencies.diagnose ?? diagnoseRea)(this.root, packageRoot, current.installation!.version, signal);
        }
        job.message = kind === "engine-open-installer" ? "已打开 Hopper 安装映像，请在后台 Mac 完成安装后检查更新。" : kind === "engine-download" ? reused ? "已复用推荐版本安装包，待安装。" : "安装包已下载，待安装。" : kind === "engine-check" ? "版本检查完成。" : kind === "clearDownloads" ? "已清理选定登记下载包；程序、引擎和未登记文件已保留。" : removing ? "托管程序已卸载；设置和外部组件已保留。" : kind === "engine-install" ? reused ? "已是推荐版本。" : "组件已安装。" : kind === "engines-check" ? "组件检查完成。" : kind === "install" ? current.skillInstalled === false || current.mcpInstalled === false
          ? "REA 已安装；保留技能与 MCP 原有的安装选择。"
          : "REA 与技能已接入；已有会话请重新加载技能与 MCP。" : "检查完成。";
      } catch (error) {
        maintenanceFailure(error);
        if (installationPublished) {
          job.message = "新版本已生效，后续确认未完成；已保留安装文件。";
          job.error = `REA 已切换至 ${version}，但后续确认未完成：${errorMessage(error, "请刷新检查安装与持久化状态。")}`;
        } else {
          job.message = maintenanceCancelled(error, signal) ? kind === "engine-open-installer" ? "操作已取消；安装窗口可能已打开，请在后台 Mac 核实。" : "操作已取消；当前版本保持不变。" : "操作未完成";
          if (!maintenanceCancelled(error, signal)) job.error = errorMessage(error, "REA 操作失败，请重新检查。");
        }
      } finally {
        try { if (prepared) { assertBuiltinFilesSafe(); rmSync(prepared, { recursive: true, force: true }); forgetBuiltinDirectory(prepared); } }
        finally { this.load(); job.running = false; }
      }
    })).catch(error => { job.running = false; if (!maintenanceCancelled(error)) job.error = errorMessage(error, "任务未能启动。"); this.changed(); }).finally(() => {
      try { this.notify(job); operation.finish(); }
      catch (error) { try { operation.retain(); } catch {} job.error = errorMessage(error, "REA 操作记录或进程退出尚未确认，已保留归属记录。"); this.changed(); }
      finally { operation.close(); this.operations.delete(resource); this.changed(); }
    }));
    return this.snapshot();
  }
  async close() {
    this.closed = true;
    const active = [...this.operations.values()];
    for (const item of active) item.controller.abort();
    await Promise.allSettled(active.map(item => item.pending));
  }
}
