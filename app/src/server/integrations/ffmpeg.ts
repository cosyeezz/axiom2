// Integrated component standard: latest install, one clean retry, direct uninstall, no persisted jobs.
import { randomUUID } from "node:crypto";
import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AppError, type Command } from "../../shared/protocol.js";
import type { FfmpegState } from "../../shared/ffmpeg.js";
import { errorMessage } from "../error-message.js";
import { maintenanceCancelled, maintenanceFailure, maintenancePhase, runMaintenance } from "../maintenance.js";
import { abortComponentOperation, forceRemoveComponentPaths, installWithFallback, withComponentAdmission } from "./component-maintenance.js";
import { captureFfmpegPaths, ffmpegDirectory, ffmpegGuardDirectory, inspectFfmpeg, readFfmpegConfig, saveFfmpegConfig } from "./ffmpeg-config.js";
import { diagnoseFfmpeg, ffmpegTarget, installFfmpeg, latestFfmpeg, type FfmpegDownload, type FfmpegRelease, type FfmpegRun } from "./ffmpeg-install.js";
import { toolProcessSupported } from "./tool-process.js";

export type FfmpegDependencies = { download?: FfmpegDownload; run?: FfmpegRun };
export function removeFfmpeg(root: string) {
  // Remove the whole dedicated component, including configuration and environment. Never user videos or skills.
  for (const path of [join(root, "integrations"), join(root, "cache")]) {
    try { const info = lstatSync(path); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("组件父目录无效，拒绝删除外部文件。"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  forceRemoveComponentPaths(join(root, "integrations"), [ffmpegDirectory(root)]);
  forceRemoveComponentPaths(join(root, "cache"), [ffmpegGuardDirectory(root)]);
}
export class FfmpegService {
  private state: FfmpegState = { revision: "", platform: `${process.platform}/${process.arch}`, supported: toolProcessSupported() && !!ffmpegTarget() };
  private release?: FfmpegRelease;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private closed = false;
  constructor(readonly root: string, private changed: () => void, private dependencies: FfmpegDependencies = {}) { this.load(); }
  private load() {
    delete this.state.error; delete this.state.version; delete this.state.directory;
    this.state.revision = "missing";
    this.state.managedFiles = [ffmpegDirectory(this.root), ffmpegGuardDirectory(this.root)].some(path => {
      try { lstatSync(path); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; }
    });
    try {
      const config = readFfmpegConfig(this.root);
      this.state.revision = config.revision || "missing";
      if (config.installation) {
        this.state.version = config.installation.version;
        this.state.directory = inspectFfmpeg(this.root, config.installation);
      }
    } catch (error) { this.state.error = errorMessage(error, "FFmpeg 安装不可用，请重新安装。"); }
  }
  snapshot() { return structuredClone(this.state); }
  private notify(text?: string) { if (text && this.state.job) this.state.job.message = text; this.changed(); }
  async command(command: Command): Promise<FfmpegState> {
    if (command.workspaceId || command.sessionId) throw new AppError("INVALID_SCOPE", "FFmpeg 使用应用级配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    if (command.op === "ffmpeg.get") { this.load(); return this.snapshot(); }
    if (command.op === "ffmpeg.cancel") {
      if (!this.state.job?.running || command.params?.jobId !== this.state.job.id) throw new AppError("NOT_RUNNING", "任务已结束，请读取最新状态。");
      if (this.state.job.kind === "uninstall") throw new AppError("NOT_CANCELLABLE", "正在移除组件，请等待结束。");
      this.controller?.abort(); await this.pending; return this.snapshot();
    }
    const kind = command.op.slice(7) as NonNullable<FfmpegState["job"]>["kind"];
    if (!command.op.startsWith("ffmpeg.") || !["check", "install", "doctor", "uninstall"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此 FFmpeg 操作。");
    if (this.pending && ["install", "uninstall"].includes(kind)) await abortComponentOperation(this.controller, this.pending);
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    if (this.pending) throw new AppError("BUSY", "请等待当前 FFmpeg 操作停止。");
    if (kind !== "uninstall" && !this.state.supported) throw new AppError("UNSUPPORTED_PLATFORM", "当前平台没有已适配的 FFmpeg 静态程序包或进程监督支持。");
    const controller = this.controller = new AbortController(), signal = controller.signal;
    const job: NonNullable<FfmpegState["job"]> = { id: randomUUID(), kind, running: true, message: "准备操作…" };
    this.state.job = job;
    if (kind === "check") { this.release = undefined; delete this.state.latest; }
    if (kind === "doctor") delete this.state.diagnostic;
    this.notify();
    this.pending = Promise.resolve().then(() => runMaintenance(this.root, {
      id: job.id, resource: "ffmpeg", label: "FFmpeg", action: kind, params: command.params, cancel: kind !== "uninstall",
      steps: kind === "uninstall" ? ["checking", "removing", "validating"] : kind === "install" ? undefined : ["checking"],
    }, controller, async () => {
      if (kind === "check") {
        this.release = await latestFfmpeg(signal, this.dependencies.download); this.state.latest = this.release.version;
      } else if (kind === "install") {
        await installWithFallback(async () => {
          try { this.release = await latestFfmpeg(signal, this.dependencies.download); }
          catch (error) { if (!this.release || signal.aborted) throw error; }
          this.state.latest = this.release.version;
          const prepared = await installFfmpeg(this.root, this.release, signal, text => this.notify(text), this.dependencies.download, this.dependencies.run);
          // No asynchronous work between the last cancellation check and atomic publication.
          const directory = inspectFfmpeg(this.root, prepared);
          const check = captureFfmpegPaths([this.root, join(this.root, "integrations"), ffmpegDirectory(this.root), join(ffmpegDirectory(this.root), "versions"), directory]);
          try { check(); signal.throwIfAborted(); saveFfmpegConfig(this.root, prepared); }
          catch (error) {
            try { check(); rmSync(directory, { recursive: true, force: true }); } catch { /* Never delete a replacement. */ }
            throw error;
          }
        }, () => withComponentAdmission(this.root, () => removeFfmpeg(this.root)), signal, text => this.notify(text));
        delete this.state.diagnostic;
      } else if (kind === "uninstall") {
        maintenancePhase("removing");
        await withComponentAdmission(this.root, () => removeFfmpeg(this.root));
        maintenancePhase("validating"); delete this.state.diagnostic;
      } else {
        const item = readFfmpegConfig(this.root).installation;
        if (!item) throw Error("请先安装 FFmpeg。");
        this.state.diagnostic = { text: await diagnoseFfmpeg(this.root, inspectFfmpeg(this.root, item), signal, this.dependencies.run), at: Date.now() };
      }
      job.message = kind === "uninstall" ? "已移除托管程序、配置与专属环境；未删除视频、帧图或技能。" : kind === "install" ? "双程序安装和自检完成，后续 Agent 命令可用。" : "检查完成。";
    })).catch(error => {
      maintenanceFailure(error);
      job.message = maintenanceCancelled(error, signal) ? "操作已取消；请刷新核对当前安装。" : "操作未完成";
      if (!maintenanceCancelled(error, signal)) job.error = errorMessage(error, "FFmpeg 操作失败，请重试。");
    }).finally(() => { job.running = false; this.pending = undefined; this.load(); this.notify(); });
    return this.snapshot();
  }
  async close() { this.closed = true; this.controller?.abort(); await this.pending; }
}
