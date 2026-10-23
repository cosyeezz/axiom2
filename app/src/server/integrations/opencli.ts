import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { AppError, type Command } from "../../shared/protocol.js";
import { defaultOpenCliSettings, type OpenCliJob, type OpenCliState } from "../../shared/builtin-tools.js";
import { openExtensionPage, type OpenCliExtensionTarget } from "./opencli-browser.js";
import { errorMessage } from "../error-message.js";
import { openCliConfigPath, openCliEnvironment, openCliSkillPaths, readOpenCliConfig, type OpenCliConfig } from "./opencli-runtime.js";

const packageName = "@jackwener/opencli";
const registry = "--registry=https://registry.npmjs.org";
const versionPattern = /^\d+\.\d+\.\d+$/;
export function newerOpenCli(latest: string, current: string) {
  if (!versionPattern.test(latest) || !versionPattern.test(current)) return false;
  const a = latest.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function atomicJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
export function findNpmCli(env = process.env, node = process.execPath): string {
  const directories = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const candidates = [join(dirname(node), "node_modules/npm/bin/npm-cli.js"), join(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js")];
  for (const directory of directories) {
    candidates.push(join(directory, "node_modules/npm/bin/npm-cli.js"));
    if (process.platform !== "win32") {
      try { const target = realpathSync(join(directory, "npm")); if (target.endsWith("npm-cli.js")) candidates.push(target); } catch { /* Try the next PATH entry. */ }
    }
  }
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw Error("未找到 npm。请安装包含 npm 的 Node.js 22.19.0+，然后重启 Axiom 后台服务。");
  return resolve(found);
}
type ExecuteOptions = { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; timeout: number };
export type OpenCliExecute = (args: string[], options: ExecuteOptions) => Promise<string>;
export const executeOpenCli: OpenCliExecute = (args, options) => new Promise((resolveResult, reject) => {
  options.signal.throwIfAborted();
  const child = spawn(process.execPath, args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = "", stderr = "", stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (!child.pid) return;
    if (process.platform === "win32") {
      const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  };
  const collect = (chunk: Buffer, error: boolean) => {
    if (error) stderr = (stderr + chunk.toString()).slice(0, 128_000);
    else output += chunk.toString();
    if (output.length + stderr.length > 128_000) { output = output.slice(0, 128_000); stop(); }
  };
  child.stdout.on("data", (chunk: Buffer) => collect(chunk, false)); child.stderr.on("data", (chunk: Buffer) => collect(chunk, true));
  const timer = setTimeout(stop, options.timeout);
  options.signal.addEventListener("abort", stop, { once: true });
  if (options.signal.aborted) stop();
  const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener("abort", stop); };
  child.once("error", (error) => { cleanup(); reject(error); });
  child.once("close", (code) => {
    cleanup();
    if (stopped) reject(Error("操作已停止、超时或输出过大；请重新检查当前安装状态。"));
    else if (code !== 0) reject(Error(errorMessage(stderr || output, "命令未完成，请检查网络和 npm 全局目录权限。")));
    else resolveResult(output.trim());
  });
});

export class OpenCliService {
  private state: OpenCliState = { ready: false, nodeVersion: process.version, configured: false, revision: "", settings: { ...defaultOpenCliSettings } };
  private config?: OpenCliConfig;
  private npm?: string;
  private binDirectory?: string;
  private entry?: string;
  private pending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private readonly jobFile: string;
  constructor(readonly root: string, private readonly changed: () => void, private readonly execute: OpenCliExecute = executeOpenCli, private readonly locateNpm = findNpmCli, private readonly openExtension: (target: OpenCliExtensionTarget) => Promise<void> = openExtensionPage, private readonly installBlocked: () => string | undefined = () => undefined) {
    this.jobFile = join(root, "integrations", "opencli-job.json");
    this.loadConfig();
    try {
      const job: OpenCliJob = JSON.parse(readFileSync(this.jobFile, "utf8"));
      if (job.running) Object.assign(job, { running: false, queued: false, error: "上次操作被服务退出中断，请重新检查当前安装；不会自动重复安装。", message: "操作已中断" });
      this.state.job = job;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.error = "无法读取上次 OpenCLI 操作记录，请检查 integrations/opencli-job.json。";
    }
  }
  snapshot(): OpenCliState { return structuredClone(this.state); }
  get installing() { return this.state.job?.running === true && !this.state.job.queued && this.state.job.kind === "install"; }
  private async waitForInstall() {
    const signal = this.controller!.signal;
    while (true) {
      signal.throwIfAborted();
      const reason = this.installBlocked();
      if (!reason) {
        // Reserve installation synchronously with the idle check, before yielding.
        this.state.job!.queued = false;
        this.notify("正在检查本机环境…");
        return;
      }
      const message = `已加入安装队列；${reason}，空闲后自动安装 OpenCLI ${this.state.job!.version}。`;
      if (this.state.job!.message !== message) this.notify(message);
      await delay(1000, undefined, { signal });
    }
  }
  private loadConfig() {
    try {
      this.config = readOpenCliConfig(this.root);
      this.state.revision = this.config?.revision ?? "";
      this.state.configured = !!this.config;
      this.state.settings = this.config ? { enabled: this.config.enabled, profile: this.config.profile, window: this.config.window } : { ...defaultOpenCliSettings };
      delete this.state.error;
    } catch (error) { this.state.error = errorMessage(error, "无法读取 OpenCLI 配置。"); }
  }
  private notify(message?: string) {
    if (message && this.state.job) this.state.job.message = message;
    if (this.state.job) atomicJson(this.jobFile, this.state.job);
    this.changed();
  }
  private async run(args: string[], timeout = 30_000, config = this.config) {
    const env = config ? openCliEnvironment(config) : { ...process.env };
    env.NO_COLOR = "1";
    return this.execute(args, { cwd: this.root, env, signal: this.controller!.signal, timeout });
  }
  private async inspect() {
    this.loadConfig();
    this.state.ready = false;
    this.state.configured = false;
    delete this.state.npmVersion; delete this.state.version; delete this.state.packageRoot; delete this.state.installationError;
    this.entry = undefined;
    this.npm = this.locateNpm();
    const npmVersion = await this.run([this.npm, "--version"]);
    const modules = await this.run([this.npm, "root", "--global"]);
    const prefix = await this.run([this.npm, "prefix", "--global"]);
    if (!isAbsolute(modules) || !isAbsolute(prefix) || /[\r\n]/.test(modules + prefix)) throw Error("npm 返回了无效的全局安装目录。");
    this.state.npmVersion = npmVersion;
    const packageRoot = join(modules, "@jackwener", "opencli");
    this.binDirectory = process.platform === "win32" ? prefix : join(prefix, "bin");
    delete this.state.version; delete this.state.packageRoot; this.entry = undefined;
    if (existsSync(join(packageRoot, "package.json"))) try {
      const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      if (pkg.name !== packageName || typeof pkg.version !== "string" || !versionPattern.test(pkg.version) || typeof pkg.bin?.opencli !== "string") throw Error("OpenCLI 安装信息无效，请修复 npm 全局安装。");
      const entry = resolve(packageRoot, pkg.bin.opencli);
      if (!entry.startsWith(packageRoot + (process.platform === "win32" ? "\\" : "/")) || !existsSync(entry)) throw Error("OpenCLI 程序入口缺失，请重新安装。");
      openCliSkillPaths({ format: 1, revision: "inspect", packageRoot, binDirectory: this.binDirectory, ...defaultOpenCliSettings });
      this.state.version = pkg.version;
      this.state.packageRoot = packageRoot;
      this.entry = entry;
      this.state.configured = !!this.config && this.config.packageRoot === packageRoot && this.config.binDirectory === this.binDirectory;
    } catch (error) {
      this.state.installationError = errorMessage(error, "OpenCLI 安装不完整，请检查更新后重新安装。");
    }
    this.state.ready = true;
  }
  private saveConfig(settings: OpenCliState["settings"], revision: unknown) {
    const current = readOpenCliConfig(this.root);
    if (revision !== (current?.revision ?? "")) throw new AppError("CONFIGURATION_CONFLICT", "OpenCLI 配置已变化，请重新读取后保存；当前输入已保留。");
    if (!this.state.packageRoot || !this.binDirectory) throw new AppError("NOT_INSTALLED", "请先检查环境并安装 OpenCLI。");
    const next: OpenCliConfig = { format: 1, revision: randomUUID(), packageRoot: this.state.packageRoot, binDirectory: this.binDirectory, ...settings };
    atomicJson(openCliConfigPath(this.root), next);
    this.loadConfig();
    delete this.state.diagnostic;
  }
  async command(c: Command) {
    if (c.workspaceId || c.sessionId) throw new AppError("INVALID_SCOPE", "内置工具属于本机应用配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    if (c.op === "opencli.get") return this.snapshot();
    if (c.op === "opencli.cancel") {
      if (!this.state.job?.running || !this.state.job.queued || c.params?.jobId !== this.state.job.id)
        throw new AppError("NOT_QUEUED", "此排队任务已结束或开始安装，请读取最新状态。");
      this.controller!.abort();
      await this.pending;
      return this.snapshot();
    }
    if (c.op === "opencli.openExtension") {
      const params = c.params ?? {};
      const target = params.target ?? "store";
      if (Object.keys(params).some((key) => key !== "target") || (target !== "store" && target !== "download")) throw new AppError("INVALID_PARAMS", "请选择 Chrome 应用商店或官方压缩包下载页，不接受自定义地址。");
      await this.openExtension(target);
      return this.snapshot();
    }
    if (c.op === "opencli.save") {
      if (this.pending) throw new AppError("BUSY", "请等待当前 OpenCLI 操作完成。");
      const p = c.params ?? {};
      if (typeof p.enabled !== "boolean" || typeof p.profile !== "string" || p.profile.length > 128 || /[\x00-\x1f\x7f]/.test(p.profile) || (p.window !== "foreground" && p.window !== "background")) throw new AppError("INVALID_SETTINGS", "请检查常用技能、浏览器配置档案和窗口模式。");
      this.saveConfig({ enabled: p.enabled, profile: p.profile.trim(), window: p.window }, p.revision);
      this.changed();
      return this.snapshot();
    }
    const kind = c.op.slice("opencli.".length) as OpenCliJob["kind"];
    if (!c.op.startsWith("opencli.") || !["refresh", "check", "install", "doctor"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此内置工具操作。");
    if (this.pending) {
      if (kind === "refresh") return this.snapshot();
      throw new AppError("BUSY", "已有 OpenCLI 操作正在进行，请等待完成。");
    }
    if (kind === "install" && (!this.state.latest || c.params?.version !== this.state.latest || !versionPattern.test(this.state.latest))) throw new AppError("CHECK_REQUIRED", "请先检查更新，再安装已确认的版本。");
    const version = this.state.latest;
    const revision = this.state.revision;
    this.controller = new AbortController();
    this.state.job = { id: randomUUID(), kind, running: true, ...(kind === "install" ? { queued: true, version } : {}), message: kind === "install" ? "已加入安装队列，正在检查执行条件…" : "正在检查本机环境…" };
    if (kind === "doctor") delete this.state.diagnostic;
    try { this.notify(); } catch {
      this.state.job.running = false;
      this.state.job.queued = false;
      this.state.job.error = "无法保存操作记录，请检查数据目录权限与剩余空间；尚未开始操作。";
      this.controller = undefined;
      this.changed();
      throw new AppError("STORAGE_ERROR", this.state.job.error);
    }
    // A short receipt acknowledges the job; progress survives page navigation via its own scope.
    this.pending = Promise.resolve().then(async () => {
      try {
        if (kind === "install") await this.waitForInstall();
        await this.inspect();
        if (kind === "check") {
          delete this.state.latest;
          this.notify("正在检查 OpenCLI 最新版本…");
          const latest = JSON.parse(await this.run([this.npm!, "view", packageName, "dist-tags.latest", "--json", registry, "--fetch-retries=0", "--fetch-timeout=20000"]));
          if (typeof latest !== "string" || !versionPattern.test(latest)) throw Error("官方 npm 仓库未返回有效的稳定版本。");
          this.state.latest = latest;
        } else if (kind === "install") {
          if (this.state.error) throw Error(this.state.error);
          if (this.state.revision !== revision) throw Error("接入配置已变化，请重新检查后安装。");
          if (this.state.version && this.state.version !== version && !newerOpenCli(version!, this.state.version)) throw Error("当前安装版本高于已检查的版本，未执行降级。");
          this.notify(`正在安装 OpenCLI ${version}，请稍候…`);
          await this.run([this.npm!, "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", registry, `${packageName}@${version}`], 600_000);
          await this.inspect();
          if (this.state.version !== version) throw Error("安装后的版本未通过校验，请重新检查安装状态。");
          this.saveConfig(this.state.settings, revision);
        } else if (kind === "doctor") {
          if (!this.entry) throw Error("请先安装 OpenCLI。");
          this.notify("正在运行官方连接诊断，请保持 Chrome 打开…");
          // doctor currently prints text and may exit 0 for failed connectivity. Display its report, never infer success from exit code.
          const output = await this.run([this.entry, "doctor"], 45_000);
          this.state.diagnostic = { text: errorMessage(output, "诊断未返回内容。"), checkedAt: Date.now() };
        }
        this.state.job!.message = kind === "install" ? "安装与技能接入已完成；请继续安装扩展并检测连接。" : kind === "doctor" ? "诊断已完成，请查看下方官方报告。" : "检查已完成。";
      } catch (error) {
        if (this.state.job!.queued && this.controller!.signal.aborted) {
          this.state.job!.message = this.closed ? "服务已退出，排队安装已取消。" : "已取消排队安装。";
        } else {
          this.state.job!.error = errorMessage(error, "OpenCLI 操作未完成，请重新检查。");
          this.state.job!.message = "操作未完成";
        }
        if (kind === "install" && !this.state.job!.queued) {
          // npm global installation is not transactional. Re-read actual state; don't promise rollback.
          try { if (!this.controller!.signal.aborted) await this.inspect(); } catch { this.state.ready = false; delete this.state.version; }
        }
      } finally {
        this.state.job!.running = false;
        this.state.job!.queued = false;
        this.pending = undefined;
        try { this.notify(); } catch { this.state.error = "操作记录未能保存，请重新检查当前安装状态。"; this.changed(); }
      }
    });
    return this.snapshot();
  }
  async close() { this.closed = true; this.controller?.abort(); await this.pending; }
}
