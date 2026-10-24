import { toolProcessSupported, toolProcessSupportError } from "./tool-process.js";
import { loadReaSkill } from "./rea-resources.js";
import { isReaEngineId } from "../../shared/rea-engines.js";
import { checkEngines, discoverEnginePaths, engineEnvironment, engineHost, listEngines, validEnginePath } from "./rea-engines.js";
import { prepareEngine } from "./rea-engine-install.js";
import { fileURLToPath } from "node:url";
import { beginBuiltinOperation, builtinPendingOperation, builtinPendingRemovals, reconcileBuiltinOperation, bindBuiltinTask, runBuiltinTool, trackBuiltinDirectory, assertBuiltinFilesSafe, forgetBuiltinDirectory, withBuiltinConfiguration } from "./builtin-operation.js";
import { randomUUID } from "node:crypto";
import { runMaintenance, maintenanceCancelled, maintenanceFailure, maintenancePhase } from "../maintenance.js";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { managedDirectory, type IntegrationRemoval } from "./managed-removal.js";
import { insideReaDirectory, removeRea } from "./rea-removal.js";
import { AppError, type Command } from "../../shared/protocol.js";
import { emptyReaState, reaVersion, type ReaJob, type ReaState } from "../../shared/rea.js";
import { errorMessage } from "../error-message.js";
import { executeOpenCli, findNpmCli, newerOpenCli, type OpenCliExecute } from "./opencli.js";
import { atomicReaJson, inspectReaPackage, inspectReaProgram, reaConfigPath, reaDirectory, reaPackageRoot, reaSupportedNode, readReaConfig, reaEngineDirectoryPattern, reaProgramDirectoryPattern, validReaVersion, type ReaConfig } from "./rea-runtime.js";

export async function diagnoseRea(root: string, packageRoot: string, version: string, signal: AbortSignal) {
  signal.throwIfAborted(); inspectReaProgram(packageRoot, version);
  const source = import.meta.url.endsWith(".ts");
  const entry = fileURLToPath(new URL(`./rea-diagnostic-worker.${source ? "ts" : "js"}`, import.meta.url));
  const args = [...(source ? ["--import", import.meta.resolve("tsx")] : []), entry, root, packageRoot, version];
  const result = await runBuiltinTool("rea", process.execPath, args, { cwd: root, signal, timeout: 45_000, limit: 65536, errorLimit: 65536 });
  if (result.code !== 0) throw Error(errorMessage(result.stderr.toString("utf8"), "REA MCP 检查未完成，请检查安装依赖。", true));
  const value = JSON.parse(result.stdout.toString("utf8"));
  if (typeof value?.text !== "string" || !Number.isSafeInteger(value.toolCount) || value.toolCount < 1 || !Number.isFinite(value.at)) throw Error("REA MCP 检查未返回有效结果。");
  return value as { text: string; toolCount: number; at: number };
}
export type ReaDependencies = { execute?: OpenCliExecute; locateNpm?: () => string; diagnose?: typeof diagnoseRea; checkEngines?: typeof checkEngines; prepareEngine?: typeof prepareEngine; removal?: IntegrationRemoval };
export class ReaService {
  private state: ReaState = { ...emptyReaState, nodeVersion: process.version, supported: reaSupportedNode() };
  private pending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  constructor(readonly root: string, private readonly changed: () => void, private readonly dependencies: ReaDependencies = {}) {
    this.load();
    try {
      const job: ReaJob = JSON.parse(readFileSync(this.jobPath, "utf8"));
      if (job && typeof job.id === "string" && ["check", "install", "doctor", "engines-check", "engine-install", "uninstall", "engine-uninstall"].includes(job.kind)) {
        this.state.job = job;
        if (job.running) Object.assign(job, { running: false, message: "上次操作被中断", error: "请重新检查当前安装；不会自动重复安装。" });
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.error = "无法读取 REA 操作记录。"; }
  }
  private get jobPath() { return join(reaDirectory(this.root), "job.json"); }
  private load() {
    delete this.state.version; delete this.state.packageRoot; delete this.state.skillError; delete this.state.mcpError;
    this.state.skillInstalled = false; this.state.mcpInstalled = false;
    try {
      const config = readReaConfig(this.root);
      this.state.engines = listEngines(config, this.state.revision === config.revision ? this.state.engines : []);
      this.state.engineHost = engineHost();
      this.state.revision = config.revision; this.state.enabled = config.enabled;
      this.state.removalPending = !!config.removalPending?.some(name => reaProgramDirectoryPattern.test(name));
      this.state.version = config.installation?.version; this.state.packageRoot = reaPackageRoot(this.root, config);
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
    if (!toolProcessSupported()) { value.supported = false; value.supportError = toolProcessSupportError; }
    try {
      value.pendingOperation = builtinPendingOperation(this.root, "rea");
      const removals = builtinPendingRemovals(this.root, "rea").map(path => basename(path));
      value.removalPending ||= removals.some(name => reaProgramDirectoryPattern.test(name));
      for (const engine of value.engines ?? []) engine.removalPending ||= removals.some(name => name.startsWith(`${engine.id}-`));
    }
    catch (error) { value.error = errorMessage(error, "维护归属记录不可读取，已保留文件。"); }
    return value;
  }
  private notify(message?: string) {
    if (message && this.state.job) this.state.job.message = message;
    if (this.state.job) atomicReaJson(this.jobPath, this.state.job);
    this.changed();
  }
  private saveConfiguration(next: ReaConfig, revision: string) {
    withBuiltinConfiguration(this.root, "rea", () => {
      if (readReaConfig(this.root).revision !== revision) throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后保存。");
      atomicReaJson(reaConfigPath(this.root), next);
    });
  }
  private run(args: string[], timeout = 30_000) {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
    const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
    const previous = env[pathKey];
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    env.PATH = [dirname(process.execPath), previous].filter(Boolean).join(delimiter);
    return (this.dependencies.execute ?? executeOpenCli)(args, { cwd: this.root, env, signal: this.controller!.signal, timeout, tool: "rea" });
  }
  async command(c: Command): Promise<ReaState> {
    if (c.workspaceId || c.sessionId) throw new AppError("INVALID_SCOPE", "REA 使用应用级配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    const p = c.params ?? {};
    if (c.op === "rea.get" || c.op === "rea.refresh") { this.load(); this.changed(); return this.snapshot(); }
    if (c.op === "rea.cancel") {
      if (!this.state.job?.running || p.jobId !== this.state.job.id) throw new AppError("NOT_RUNNING", "操作已结束，请读取最新状态。");
      if (this.state.job.kind === "uninstall" || this.state.job.kind === "engine-uninstall") throw new AppError("NOT_CANCELLABLE", "卸载已开始，正在等待程序退出并清理文件。");
      this.controller!.abort(); await this.pending; return this.snapshot();
    }
    if (c.op === "rea.reconcile") {
      if (this.pending) throw new AppError("BUSY", "请等待当前操作完成。");
      reconcileBuiltinOperation(this.root, "rea", p.operationId);
      this.load(); this.changed(); return this.snapshot();
    }
    if (this.pending) throw new AppError("BUSY", "请等待当前 REA 操作完成。");
    const current = readReaConfig(this.root);
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
      if (!isReaEngineId(p.engine) || !validEnginePath(p.path)) throw new AppError("INVALID_SETTINGS", "请输入后台电脑上的绝对路径，不支持变量或控制字符；留空恢复自动发现。");
      if (p.revision !== current.revision) { this.load(); this.changed(); throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后保存。"); }
      const engines = { ...current.engines };
      if (p.path) engines[p.engine] = p.path; else delete engines[p.engine];
      this.saveConfiguration({ ...current, engines, revision: randomUUID() }, current.revision);
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
    if (!c.op.startsWith("rea.") || !["check", "install", "doctor", "engines-check", "engine-install", "uninstall", "engine-uninstall"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此 REA 操作。");
    const removing = kind === "uninstall" || kind === "engine-uninstall";
    if (!removing && !toolProcessSupported()) throw new AppError("UNSUPPORTED_PLATFORM", toolProcessSupportError);
    if (!removing && !this.state.supported) throw new AppError("NODE_VERSION", "REA 需要 Node.js 22.19+（22.x）、24.11+（24.x）或 26+。");
    const engine = isReaEngineId(p.engine) ? p.engine : undefined;
    if (removing && (p.confirm !== true || p.revision !== current.revision)) throw new AppError("CONFIRM_REQUIRED", "请读取最新配置并确认卸载；设置和外部组件将保留。");
    if (kind === "engine-uninstall" && (!engine || engine === "hopper")) throw new AppError("EXTERNAL_INSTALLATION", "此组件由外部管理，请通过原安装方式卸载。");
    if (kind === "engine-install") {
      if (p.revision !== current.revision) throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请刷新后操作。");
      if (!engine || !listEngines(current).find(item => item.id === engine)?.installable) throw new AppError("UNSUPPORTED_ENGINE", "当前 REA 版本或后台平台不支持此组件的托管安装，请接入已有安装。");
    }
    const version = this.state.latest ?? reaVersion;
    if (kind === "install" && (p.version !== version || !validReaVersion(version))) throw new AppError("CHECK_REQUIRED", "请安装推荐版本，或先检查更新再安装已确认的版本。");
    if (kind === "install" && current.installation && version !== current.installation.version && !newerOpenCli(version, current.installation.version)) throw new AppError("DOWNGRADE", "当前版本较新，未执行降级。");
    const operation = beginBuiltinOperation(this.root, "rea");
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.state.job = { id: randomUUID(), kind, engine, running: true, message: kind === "install" ? `正在安装 REA ${version}…` : "正在检查 REA…" };
    if (kind === "check") delete this.state.latest;
    if (kind === "doctor" || kind === "install") delete this.state.diagnostic;
    try { this.notify(); } catch { this.state.job.running = false; this.changed(); try { operation.finish(); } finally { operation.close(); } throw new AppError("STORAGE_ERROR", "无法保存操作记录；尚未开始执行。"); }
    this.pending = operation.run(() => Promise.resolve().then(() => runMaintenance(this.root, { id: this.state.job!.id, resource: engine ? `rea:${engine}` : "rea", label: engine ? `REA ${engine}` : "REA", action: kind, params: p, cancel: !removing, steps: removing ? ["checking", "removing", "validating"] : kind === "install" ? ["checking", "installing", "validating"] : kind === "engine-install" ? undefined : ["checking"] }, this.controller!, async () => {
      bindBuiltinTask();
      let prepared: string | undefined;
      try {
        if (removing) {
          const operation = () => { signal.throwIfAborted(); assertBuiltinFilesSafe(); if (readReaConfig(this.root).revision !== current.revision) throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后卸载。"); removeRea(this.root, current.revision, kind === "engine-uninstall" ? engine : undefined); };
          if (this.dependencies.removal) await this.dependencies.removal(operation); else operation();
          delete this.state.diagnostic;
        } else if (kind === "engines-check") {
          this.state.engines = await (this.dependencies.checkEngines ?? checkEngines)(this.root, current, reaPackageRoot(this.root, current), signal);
        } else if (kind === "engine-install") {
          const installation = await (this.dependencies.prepareEngine ?? prepareEngine)(this.root, engine!, signal, message => this.notify(message));
          const directory = basename(installation.directory);
          const ownedDirectory = managedDirectory(this.root, ["integrations", "rea", "engines"], directory, reaEngineDirectoryPattern);
          if (!ownedDirectory || resolve(installation.directory) !== resolve(ownedDirectory) || !directory.startsWith(`${engine}-`) || !insideReaDirectory(ownedDirectory, installation.path)) throw Error("组件安装未返回有效的托管目录。");
          prepared = ownedDirectory; trackBuiltinDirectory(prepared);
          const next = { ...current, engines: { ...current.engines, [engine!]: installation.path }, managedEngines: { ...current.managedEngines, [engine!]: [...(current.managedEngines?.[engine!] ?? []), { directory, path: installation.path }] }, revision: randomUUID() };
          maintenancePhase("validating");
          this.notify("正在验证新组件，验证通过后才切换路径…");
          const checks = await (this.dependencies.checkEngines ?? checkEngines)(this.root, next, reaPackageRoot(this.root, current), signal);
          const result = checks.find(item => item.id === engine);
          if (result?.status !== "ready") throw Error(`组件安装后检测未通过：${result?.detail ?? "未返回检测结果"}。当前路径保持不变。`);
          signal.throwIfAborted();
          if (readReaConfig(this.root).revision !== current.revision) throw Error("安装期间配置已变化，未切换组件路径。");
          assertBuiltinFilesSafe();
          atomicReaJson(reaConfigPath(this.root), next, () => { prepared = undefined; });
          this.state.revision = next.revision; this.state.engines = checks;
        } else if (kind === "check") {
          const npm = (this.dependencies.locateNpm ?? findNpmCli)();
          const latest = JSON.parse(await this.run([npm, "view", "rea-agents", "dist-tags.latest", "--json", "--registry=https://registry.npmjs.org", "--fetch-retries=0", "--fetch-timeout=20000"]));
          if (!validReaVersion(latest)) throw Error("npm 未返回有效的 REA 稳定版本。");
          this.state.latest = latest;
        } else if (kind === "install") {
          const npm = (this.dependencies.locateNpm ?? findNpmCli)();
          const directory = `v${version}-${randomUUID()}`;
          prepared = join(reaDirectory(this.root), "versions", directory);
          mkdirSync(prepared, { recursive: true }); trackBuiltinDirectory(prepared);
          // Keep the complete package and npm lock, including native optional dependencies.
          // Each install uses a new prefix; active workers retain their previous version.
          await this.run([npm, "install", "--prefix", prepared, "--no-audit", "--no-fund", "--omit=dev", "--engine-strict", "--registry=https://registry.npmjs.org", `rea-agents@${version}`], 600_000);
          signal.throwIfAborted();
          maintenancePhase("validating");
          this.notify("正在检查 REA 技能与 MCP 连接…");
          const packageRoot = join(prepared, "node_modules", "rea-agents");
          inspectReaPackage(packageRoot, version);
          loadReaSkill(this.root, this.root, packageRoot);
          const diagnostic = await (this.dependencies.diagnose ?? diagnoseRea)(this.root, packageRoot, version, signal);
          signal.throwIfAborted();
          if (readReaConfig(this.root).revision !== current.revision) throw Error("安装期间配置已变化，未切换当前版本，请重新检查。");
          assertBuiltinFilesSafe();
          atomicReaJson(reaConfigPath(this.root), { ...current, revision: randomUUID(), installation: { directory, version } }, () => { prepared = undefined; });
          this.state.diagnostic = diagnostic;
        } else {
          const packageRoot = reaPackageRoot(this.root, current);
          if (!packageRoot) throw Error("请先安装 REA。");
          this.state.diagnostic = await (this.dependencies.diagnose ?? diagnoseRea)(this.root, packageRoot, current.installation!.version, signal);
        }
        this.state.job!.message = removing ? "托管程序已卸载；设置和外部组件已保留。" : kind === "engine-install" ? "组件已安装并通过环境检查；已有会话请重新加载技能与 MCP。" : kind === "engines-check" ? "组件检查完成；请查看各项状态，未启动分析目标。" : kind === "install" ? current.skillInstalled === false || current.mcpInstalled === false
          ? "REA 已安装；保留技能与 MCP 原有的安装选择。"
          : "REA 与技能已接入；已有会话请重新加载技能与 MCP。" : "检查完成。";
      } catch (error) {
        maintenanceFailure(error);
        this.state.job!.message = maintenanceCancelled(error, signal) ? "操作已取消；当前版本保持不变。" : "操作未完成";
        if (!maintenanceCancelled(error, signal)) this.state.job!.error = errorMessage(error, "REA 操作失败，请重新检查。");
      } finally {
        if (prepared) { assertBuiltinFilesSafe(); rmSync(prepared, { recursive: true, force: true }); forgetBuiltinDirectory(prepared); }
        this.load(); this.state.job!.running = false;
      }
    })).catch(error => { this.state.job!.running = false; if (!maintenanceCancelled(error)) this.state.job!.error = errorMessage(error, "任务未能启动。"); this.changed(); }).finally(() => {
      try { this.notify(); operation.finish(); }
      catch (error) { try { operation.retain(); } catch {} this.state.error = "REA 操作记录或进程退出尚未确认，已保留归属记录。"; this.state.job!.error = errorMessage(error, this.state.error); this.changed(); }
      finally { operation.close(); this.pending = undefined; this.changed(); }
    }));
    return this.snapshot();
  }
  async close() { this.closed = true; this.controller?.abort(); await this.pending; }
}
