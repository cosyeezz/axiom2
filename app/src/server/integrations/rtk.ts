import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AppError, type Command } from "../../shared/protocol.js";
import { defaultRtkSettings, type RtkJob, type RtkState } from "../../shared/rtk.js";
import { atomicRtkJson, newerRtk, readRtkConfig, rtkConfigPath, rtkDirectory, rtkExecutable, validRtkSettings } from "./rtk-config.js";
import { diagnoseRtk, installRtk, latestRtk, rtkTarget, type RtkDownload, type RtkRelease } from "./rtk-install.js";
import type { RtkRun } from "./rtk-process.js";
import { cleanRtkOriginals, cleanRtkStats, clearRtkStats, rtkStats } from "./rtk-stats.js";
import { cleanRtkVersions } from "./rtk-versions.js";
import { errorMessage } from "../error-message.js";

export type RtkDependencies = { download?: RtkDownload; run?: RtkRun };
export class RtkService {
  private state: RtkState = { revision: "", settings: { ...defaultRtkSettings }, platform: `${process.platform}/${process.arch}`, supported: !!rtkTarget() };
  private release?: RtkRelease;
  private pending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private maintenance: ReturnType<typeof setInterval>;
  constructor(readonly root: string, private readonly changed: () => void, private readonly dependencies: RtkDependencies = {}) {
    this.load();
    try {
      const job: RtkJob = JSON.parse(readFileSync(this.jobPath, "utf8"));
      if (job && typeof job.id === "string" && ["check", "install", "doctor"].includes(job.kind)) {
        this.state.job = job;
        if (job.running) { job.running = false; job.message = "上次操作被服务退出中断"; job.error = "请重新检查当前安装；不会自动重试。"; }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.error = "无法读取 RTK 操作记录。"; }
    const prune = () => {
      for (const clean of [cleanRtkOriginals, cleanRtkStats, cleanRtkVersions]) try { clean(root); } catch { /* Explicit clearing surfaces storage errors. */ }
    };
    prune(); this.maintenance = setInterval(prune, 60 * 60 * 1000); this.maintenance.unref();
  }
  private get jobPath() { return join(rtkDirectory(this.root), "job.json"); }
  private load() {
    try {
      const config = readRtkConfig(this.root);
      this.state.revision = config.revision;
      this.state.settings = { enabled: config.enabled, level: config.level, subagents: config.subagents };
      this.state.version = config.installation?.version; this.state.executable = rtkExecutable(this.root, config);
      delete this.state.error;
      if (this.state.executable && !existsSync(this.state.executable)) this.state.error = "托管的 RTK 程序缺失，运行时会保留原文；请重新安装。";
    } catch (error) { this.state.error = errorMessage(error, "无法读取 RTK 配置。"); }
  }
  snapshot(): RtkState { return structuredClone(this.state); }
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
      this.controller!.abort(); await this.pending; return this.snapshot();
    }
    if (this.pending) throw new AppError("BUSY", "请等待当前 RTK 操作完成。");
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
    if (!c.op.startsWith("rtk.") || !["check", "install", "doctor"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此 RTK 操作。");
    if (kind === "install" && (!this.release || p.version !== this.release.version)) throw new AppError("CHECK_REQUIRED", "请先检查更新，再安装已确认的版本。");
    const current = readRtkConfig(this.root), release = this.release;
    if (kind === "install" && current.installation && release!.version !== current.installation.version && !newerRtk(release!.version, current.installation.version)) throw new AppError("DOWNGRADE", "当前版本较新，未执行降级。");
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.state.job = { id: randomUUID(), kind, running: true, message: kind === "install" ? "准备安装 RTK OSS…" : "正在检查…" };
    if (kind === "check") { delete this.state.latest; this.release = undefined; }
    if (kind === "doctor") delete this.state.diagnostic;
    try { this.notify(); } catch { this.state.job.running = false; this.changed(); throw new AppError("STORAGE_ERROR", "无法保存 RTK 操作记录；尚未执行。"); }
    this.pending = Promise.resolve().then(async () => {
      let prepared: { directory: string; version: string } | undefined;
      try {
        if (kind === "check") {
          this.release = await latestRtk(signal, this.dependencies.download); this.state.latest = this.release.version;
        } else if (kind === "install") {
          prepared = await installRtk(this.root, release!, signal, text => this.notify(text), this.dependencies.download, this.dependencies.run);
          signal.throwIfAborted();
          const fresh = readRtkConfig(this.root);
          if (fresh.revision !== current.revision) throw Error("安装期间配置已变化；未切换当前版本，请重新检查。");
          atomicRtkJson(rtkConfigPath(this.root), { ...fresh, revision: randomUUID(), installation: prepared });
          prepared = undefined;
        } else {
          const executable = rtkExecutable(this.root, current);
          if (!executable || !current.installation) throw Error("请先安装 RTK。");
          this.state.diagnostic = { text: await diagnoseRtk(this.root, executable, current.installation.version, signal, this.dependencies.run), at: Date.now() };
        }
        this.state.job!.message = kind === "install" ? "安装与自检完成；设置将用于后续工具结果。" : "检查完成。";
      } catch (error) {
        this.state.job!.message = signal.aborted ? "操作已取消；未切换当前版本。" : "操作未完成";
        if (!signal.aborted) this.state.job!.error = errorMessage(error, "RTK 操作失败，请重新检查。");
      } finally {
        if (prepared) { try { rmSync(join(rtkDirectory(this.root), "versions", prepared.directory), { recursive: true, force: true }); } catch { /* An unused version never becomes active. */ } }
        this.load(); this.state.job!.running = false; this.pending = undefined;
        try { this.notify(); } catch { this.state.error = "RTK 操作记录未能保存，请重新检查当前状态。"; this.changed(); }
      }
    });
    return this.snapshot();
  }
  async close() { this.closed = true; clearInterval(this.maintenance); this.controller?.abort(); await this.pending; }
}
