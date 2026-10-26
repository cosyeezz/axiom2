import { clearRtkData, rtkDataScope } from "./rtk-data.js";
import { withCommandAdmission } from "../command-admission.js";
import { toolProcessSupported, toolProcessSupportError } from "./tool-process.js";
import { runMaintenance, maintenanceCancelled, maintenanceFailure, maintenancePhase } from "../maintenance.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AppError, type Command } from "../../shared/protocol.js";
import { defaultRtkSettings, type RtkJob, type RtkState } from "../../shared/rtk.js";
import type { IntegrationRemoval } from "./managed-removal.js";
import { cleanupScope, assertCleanupScope } from "./cleanup-scope.js";
import { removeRtk, rtkRemovalDirectories } from "./rtk-removal.js";
import { atomicRtkJson, newerRtk, readRtkConfig, rtkConfigPath, rtkDirectory, rtkExecutable, validRtkSettings } from "./rtk-config.js";
import { diagnoseRtk, installRtk, latestRtk, rtkTarget, type RtkDownload, type RtkRelease } from "./rtk-install.js";
import { assertToolProcessesStopped, type RtkRun } from "./rtk-process.js";
import { cleanRtkOriginals, cleanRtkStats, clearRtkStats, rtkStats } from "./rtk-stats.js";
import { cleanRtkVersions } from "./rtk-versions.js";
import { errorMessage } from "../error-message.js";

export type RtkDependencies = { download?: RtkDownload; run?: RtkRun; removal?: IntegrationRemoval };
export class RtkService {
  private state: RtkState = { revision: "", settings: { ...defaultRtkSettings }, platform: `${process.platform}/${process.arch}`, supported: toolProcessSupported() && !!rtkTarget(), supportError: toolProcessSupported() ? undefined : toolProcessSupportError };
  private release?: RtkRelease;
  private pending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private maintenance: ReturnType<typeof setInterval>;
  constructor(readonly root: string, private readonly changed: () => void, private readonly dependencies: RtkDependencies = {}) {
    this.load();
    try {
      const job: RtkJob = JSON.parse(readFileSync(this.jobPath, "utf8"));
      if (job && typeof job.id === "string" && ["check", "install", "doctor", "uninstall", "cleanupStats", "cleanupOriginals"].includes(job.kind)) {
        this.state.job = job;
        if (job.running) { job.running = false; job.message = "上次操作被服务退出中断"; job.error = "请重新检查当前安装；不会自动重试。"; }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.error = "无法读取 RTK 操作记录。"; }
    const prune = () => {
      if (this.closed) return;
      for (const clean of [cleanRtkOriginals, cleanRtkStats]) try { clean(root); } catch { /* Explicit clearing surfaces storage errors. */ }
      if (this.pending) return;
      try { if (!cleanRtkVersions(root, true)) return; } catch { return; }
      const versions = () => withCommandAdmission(root, () => { if (!this.closed) { assertToolProcessesStopped(root); cleanRtkVersions(root); } });
      this.pending = runMaintenance(root, { id: randomUUID(), resource: "rtk", label: "RTK 旧版本清理", action: "cleanup", cancel: false, controllable: false, steps: ["removing"] }, new AbortController(), async () => {
        maintenancePhase("removing");
        if (dependencies.removal) await dependencies.removal(versions); else versions();
      }).catch(error => { this.state.error = errorMessage(error, "旧版本清理未完成，文件已保留。"); })
        .finally(() => { this.pending = undefined; this.changed(); });
    };
    // The application constructs the worker pool and resources after this service.
    if (dependencies.removal) queueMicrotask(prune); else prune();
    this.maintenance = setInterval(prune, 60 * 60 * 1000); this.maintenance.unref();
  }
  private get jobPath() { return join(rtkDirectory(this.root), "job.json"); }
  private load() {
    try {
      const config = readRtkConfig(this.root);
      this.state.revision = config.revision;
      this.state.settings = { enabled: config.enabled, level: config.level, subagents: config.subagents };
      this.state.version = config.installation?.version; this.state.executable = rtkExecutable(this.root, config);
      this.state.removalPending = !!config.removalPending?.length;
      delete this.state.error;
      if (this.state.executable && !existsSync(this.state.executable)) this.state.error = "托管的 RTK 程序缺失，运行时会保留原文；请重新安装。";
    } catch (error) { this.state.error = errorMessage(error, "无法读取 RTK 配置。"); }
  }
  private cleanup() { return cleanupScope(rtkRemovalDirectories(this.root, readRtkConfig(this.root)).map(name => join(rtkDirectory(this.root), "versions", name))); }
  snapshot(): RtkState {
    const value = structuredClone(this.state);
    try { value.cleanup = this.cleanup(); value.cleanupPaths = value.cleanup.paths; }
    catch (error) { value.error = errorMessage(error, "无法核实 RTK 卸载目录。"); }
    try {
      withCommandAdmission(this.root, () => {
        value.dataCleanup = {}; value.dataCleanupErrors = {};
        for (const kind of ["stats", "originals"] as const) {
          try { value.dataCleanup[kind] = rtkDataScope(this.root, kind); }
          catch (error) { value.dataCleanupErrors[kind] = errorMessage(error, "无法核实保留数据范围。"); }
        }
      });
    }
    catch (error) { value.dataCleanupError = errorMessage(error, "无法核实保留数据范围。"); }
    return value;
  }
  private notify(message?: string) {
    if (message && this.state.job) this.state.job.message = message;
    if (this.state.job) atomicRtkJson(this.jobPath, this.state.job);
    this.changed();
  }
  async command(c: Command): Promise<unknown> {
    if (c.workspaceId || c.sessionId) throw new AppError("INVALID_SCOPE", "RTK 使用应用级配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    const p = c.params ?? {};
    if (c.op === "rtk.get" || c.op === "rtk.refresh") { this.load(); this.changed(); return this.snapshot(); }
    if (c.op === "rtk.stats") {
      const days = p.days ?? 7; if (![1, 7, 30].includes(days as number)) throw new AppError("INVALID_PARAMS", "请选择 1、7 或 30 天。");
      return rtkStats(this.root, days as number);
    }
    if (c.op === "rtk.cancel") {
      if (!this.state.job?.running || p.jobId !== this.state.job.id) throw new AppError("NOT_RUNNING", "此任务已结束，请读取最新状态。");
      if (["uninstall", "cleanupStats", "cleanupOriginals"].includes(this.state.job!.kind)) throw new AppError("NOT_CANCELLABLE", "卸载已开始，正在等待程序退出并清理文件。");
      this.controller!.abort(); await this.pending; return this.snapshot();
    }
    if (this.pending) throw new AppError("BUSY", "请等待当前 RTK 操作完成。");
    if (c.op === "rtk.cleanupStats" || c.op === "rtk.cleanupOriginals") {
      const kind = c.op === "rtk.cleanupStats" ? "stats" : "originals";
      if (p.confirm !== true || typeof p.cleanupRevision !== "string" || !/^[a-f0-9]{64}$/.test(p.cleanupRevision) || p.revision !== readRtkConfig(this.root).revision) throw new AppError("CONFIRM_REQUIRED", "请读取当前保留数据范围并确认。");
      const before = withCommandAdmission(this.root, () => rtkDataScope(this.root, kind));
      if (before.revision !== p.cleanupRevision) throw new AppError("CONFIGURATION_CONFLICT", "数据清理范围已变化，请重新确认。");
      this.state.job = { id: randomUUID(), kind: kind === "stats" ? "cleanupStats" : "cleanupOriginals", running: true, message: "正在核实数据清理范围并等待任务退出…" };
      this.controller = new AbortController();
      try { this.notify(); } catch { this.state.job.running = false; throw new AppError("STORAGE_ERROR", "无法保存清理记录，尚未执行。"); }
      const work = () => withCommandAdmission(this.root, () => {
        assertToolProcessesStopped(this.root);
        clearRtkData(this.root, kind, p.cleanupRevision);
      });
      this.pending = Promise.resolve().then(() => runMaintenance(this.root, { id: this.state.job!.id, resource: "rtk", label: "RTK 保留数据", action: this.state.job!.kind, cancel: false, steps: ["checking", "removing", "validating"] }, this.controller!, async () => {
        maintenancePhase("removing");
        if (this.dependencies.removal) await this.dependencies.removal(work); else work();
        maintenancePhase("validating");
        this.state.job!.message = kind === "stats" ? "已清空选定效果记录；数据库文件保留，后续运行仍会产生记录。" : "已删除选定原文；旧回查路径将失效，未识别文件保留。";
      })).catch(error => { this.state.job!.error = errorMessage(error, "数据清理未完成。"); this.state.job!.message = "数据清理未完成"; })
        .finally(() => { this.state.job!.running = false; this.pending = undefined; this.load(); try { this.notify(); } catch { this.state.error = "清理结果保存失败，请重新核实。"; } });
      return this.snapshot();
    }
    if (c.op === "rtk.clearStats" || c.op === "rtk.clearOriginals") {
      if (p.confirm !== true) throw new AppError("CONFIRM_REQUIRED", "请确认清理范围。");
      try { if (c.op === "rtk.clearStats") clearRtkStats(this.root); else cleanRtkOriginals(this.root, true); }
      catch { throw new AppError("STORAGE_ERROR", "RTK 数据清理失败，请检查目录权限。"); }
      return this.snapshot();
    }
    if (c.op === "rtk.save") {
      if (!validRtkSettings(p)) throw new AppError("INVALID_SETTINGS", "请检查开关、过滤等级和子代理设置。");
      const current = readRtkConfig(this.root);
      if (c.params?.revision !== current.revision) { this.load(); this.changed(); throw new AppError("CONFIGURATION_CONFLICT", "RTK 配置已变化；当前输入已保留，请重新读取后保存。"); }
      const executable = rtkExecutable(this.root, current);
      if (p.enabled && (!executable || !existsSync(executable))) throw new AppError("NOT_INSTALLED", "请先安装 RTK，再启用过滤。");
      atomicRtkJson(rtkConfigPath(this.root), { ...current, enabled: p.enabled, level: p.level, subagents: p.subagents, revision: randomUUID() });
      this.load(); this.changed(); return this.snapshot();
    }
    const kind = c.op.slice(4) as RtkJob["kind"];
    if (!c.op.startsWith("rtk.") || !["check", "install", "doctor", "uninstall"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此 RTK 操作。");
    if (kind !== "uninstall" && !toolProcessSupported()) throw new AppError("UNSUPPORTED_PLATFORM", toolProcessSupportError);
    if (kind === "install" && (!this.release || p.version !== this.release.version)) throw new AppError("CHECK_REQUIRED", "请先检查更新，再安装已确认的版本。");
    const current = readRtkConfig(this.root), release = this.release;
    if (kind === "uninstall" && (p.confirm !== true || p.revision !== current.revision)) throw new AppError("CONFIRM_REQUIRED", "请读取最新版本并确认卸载；设置和效果记录将保留。");
    if (kind === "install" && current.installation && release!.version !== current.installation.version && !newerRtk(release!.version, current.installation.version)) throw new AppError("DOWNGRADE", "当前版本较新，未执行降级。");
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.state.job = { id: randomUUID(), kind, running: true, message: kind === "install" ? "准备安装 RTK OSS…" : "正在检查…" };
    if (kind === "check") { delete this.state.latest; this.release = undefined; }
    if (kind === "doctor") delete this.state.diagnostic;
    try { this.notify(); } catch { this.state.job.running = false; this.changed(); throw new AppError("STORAGE_ERROR", "无法保存 RTK 操作记录；尚未执行。"); }
    this.pending = Promise.resolve().then(() => runMaintenance(this.root, { id: this.state.job!.id, resource: "rtk", label: "RTK", action: kind, params: p, cancel: kind !== "uninstall", steps: kind === "install" ? undefined : kind === "uninstall" ? ["checking", "removing", "validating"] : ["checking"] }, this.controller!, async () => {
      let prepared: { directory: string; version: string } | undefined;
      try {
        if (kind === "check") {
          this.release = await latestRtk(signal, this.dependencies.download); this.state.latest = this.release.version;
        } else if (kind === "install") {
          prepared = await installRtk(this.root, release!, signal, text => this.notify(text), this.dependencies.download, this.dependencies.run);
          maintenancePhase("validating");
          signal.throwIfAborted();
          const fresh = readRtkConfig(this.root);
          if (fresh.revision !== current.revision) throw Error("安装期间配置已变化；未切换当前版本，请重新检查。");
          atomicRtkJson(rtkConfigPath(this.root), { ...fresh, revision: randomUUID(), installation: prepared });
          prepared = undefined;
        } else if (kind === "uninstall") {
          assertCleanupScope(p.cleanupRevision, this.cleanup());
          const remove = () => withCommandAdmission(this.root, () => {
            removeRtk(this.root, current.revision, () => { signal.throwIfAborted(); assertCleanupScope(p.cleanupRevision, this.cleanup()); assertToolProcessesStopped(this.root); }, maintenancePhase);
            delete this.state.diagnostic;
          });
          if (this.dependencies.removal) await this.dependencies.removal(remove); else remove();
        } else {
          const executable = rtkExecutable(this.root, current);
          if (!executable || !current.installation) throw Error("请先安装 RTK。");
          this.state.diagnostic = { text: await diagnoseRtk(this.root, executable, current.installation.version, signal, this.dependencies.run), at: Date.now() };
        }
        this.state.job!.message = kind === "uninstall" ? "RTK 程序已卸载；过滤设置、效果记录和保留原文未删除。" : kind === "install" ? "安装与自检完成；设置将用于后续工具结果。" : "检查完成。";
      } catch (error) {
        maintenanceFailure(error);
        this.state.job!.message = maintenanceCancelled(error, signal) ? "操作已取消；未切换当前版本。" : "操作未完成";
        if (!maintenanceCancelled(error, signal)) this.state.job!.error = errorMessage(error, "RTK 操作失败，请重新检查。");
      } finally {
        if (prepared) { try { rmSync(join(rtkDirectory(this.root), "versions", prepared.directory), { recursive: true, force: true }); } catch { /* An unused version never becomes active. */ } }
        this.load(); this.state.job!.running = false; this.pending = undefined;
        try { this.notify(); } catch { this.state.error = "RTK 操作记录未能保存，请重新检查当前状态。"; this.changed(); }
      }
    })).catch(error => { this.state.job!.running = false; if (!maintenanceCancelled(error)) this.state.job!.error = errorMessage(error, "任务未能启动。"); this.pending = undefined; this.changed(); });
    return this.snapshot();
  }
  async close() { this.closed = true; clearInterval(this.maintenance); this.controller?.abort(); await this.pending; }
}
