import { loadReaSkill } from "./rea-resources.js";
import { McpClient, StdioTransport } from "@earendil-works/pi-mcp";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { AppError, type Command } from "../../shared/protocol.js";
import { emptyReaState, reaVersion, type ReaJob, type ReaState } from "../../shared/rea.js";
import { errorMessage } from "../error-message.js";
import { executeOpenCli, findNpmCli, newerOpenCli, type OpenCliExecute } from "./opencli.js";
import { atomicReaJson, inspectReaPackage, inspectReaProgram, reaConfigPath, reaDirectory, reaPackageRoot, reaSupportedNode, readReaConfig, validReaVersion } from "./rea-runtime.js";

export async function diagnoseRea(root: string, packageRoot: string, version: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { entry } = inspectReaProgram(packageRoot, version);
  const client = new McpClient({ name: "axiom-rea-check", version: "1.0.0", requestTimeoutMs: 45_000 });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= client.close();
  const abort = () => { void close().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await client.connect(new StdioTransport({ command: process.execPath, args: [entry, "mcp"], cwd: root }));
    signal.throwIfAborted();
    if (result.serverInfo.name !== "rea" || result.serverInfo.version !== version) throw Error("REA MCP 服务版本不匹配。");
    const tools = await client.listTools({ signal });
    if (!tools.some(tool => tool.name === "binary_session")) throw Error("REA 未提供会话检查工具。");
    const session = await client.callTool("binary_session", { expected_package_version: version }, { signal });
    if (session.isError) throw Error("REA 会话检查失败，请检查安装依赖。");
    return { text: `REA ${version} 连接成功，发现 ${tools.length} 个工具；binary_session 调用通过。原生反编译引擎需单独配置。`, toolCount: tools.length, at: Date.now() };
  } finally { signal.removeEventListener("abort", abort); await close(); }
}
export type ReaDependencies = { execute?: OpenCliExecute; locateNpm?: () => string; diagnose?: typeof diagnoseRea };
export class ReaService {
  private state: ReaState = { ...emptyReaState, nodeVersion: process.version, supported: reaSupportedNode() };
  private pending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  constructor(readonly root: string, private readonly changed: () => void, private readonly dependencies: ReaDependencies = {}) {
    this.load();
    try {
      const job: ReaJob = JSON.parse(readFileSync(this.jobPath, "utf8"));
      if (job && typeof job.id === "string" && ["check", "install", "doctor"].includes(job.kind)) {
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
      this.state.revision = config.revision; this.state.enabled = config.enabled;
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
  snapshot() { return structuredClone(this.state); }
  private notify(message?: string) {
    if (message && this.state.job) this.state.job.message = message;
    if (this.state.job) atomicReaJson(this.jobPath, this.state.job);
    this.changed();
  }
  private run(args: string[], timeout = 30_000) {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
    const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
    const previous = env[pathKey];
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    env.PATH = [dirname(process.execPath), previous].filter(Boolean).join(delimiter);
    return (this.dependencies.execute ?? executeOpenCli)(args, { cwd: this.root, env, signal: this.controller!.signal, timeout });
  }
  async command(c: Command): Promise<ReaState> {
    if (c.workspaceId || c.sessionId) throw new AppError("INVALID_SCOPE", "REA 使用应用级配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    const p = c.params ?? {};
    if (c.op === "rea.get" || c.op === "rea.refresh") { this.load(); this.changed(); return this.snapshot(); }
    if (c.op === "rea.cancel") {
      if (!this.state.job?.running || p.jobId !== this.state.job.id) throw new AppError("NOT_RUNNING", "操作已结束，请读取最新状态。");
      this.controller!.abort(); await this.pending; return this.snapshot();
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
      atomicReaJson(reaConfigPath(this.root), { ...current, [skill ? "skillInstalled" : "mcpInstalled"]: installed, revision: randomUUID() });
      this.load(); this.changed(); return this.snapshot();
    }
    if (c.op === "rea.save") {
      if (typeof p.enabled !== "boolean") throw new AppError("INVALID_SETTINGS", "请选择是否默认启用 REA。");
      if (p.revision !== current.revision) { this.load(); this.changed(); throw new AppError("CONFIGURATION_CONFLICT", "REA 配置已变化，请重新读取后保存。"); }
      if (!current.installation) throw new AppError("NOT_INSTALLED", "请先安装 REA。");
      atomicReaJson(reaConfigPath(this.root), { ...current, enabled: p.enabled, revision: randomUUID() });
      this.load(); this.changed(); return this.snapshot();
    }
    const kind = c.op.slice(4) as ReaJob["kind"];
    if (!c.op.startsWith("rea.") || !["check", "install", "doctor"].includes(kind)) throw new AppError("UNKNOWN_OPERATION", "不支持此 REA 操作。");
    if (!this.state.supported) throw new AppError("NODE_VERSION", "REA 需要 Node.js 22.19+（22.x）、24.11+（24.x）或 26+。");
    const version = this.state.latest ?? reaVersion;
    if (kind === "install" && (p.version !== version || !validReaVersion(version))) throw new AppError("CHECK_REQUIRED", "请安装推荐版本，或先检查更新再安装已确认的版本。");
    if (kind === "install" && current.installation && version !== current.installation.version && !newerOpenCli(version, current.installation.version)) throw new AppError("DOWNGRADE", "当前版本较新，未执行降级。");
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.state.job = { id: randomUUID(), kind, running: true, message: kind === "install" ? `正在安装 REA ${version}…` : "正在检查 REA…" };
    if (kind === "check") delete this.state.latest;
    if (kind === "doctor" || kind === "install") delete this.state.diagnostic;
    try { this.notify(); } catch { this.state.job.running = false; this.changed(); throw new AppError("STORAGE_ERROR", "无法保存操作记录；尚未开始执行。"); }
    this.pending = Promise.resolve().then(async () => {
      let prepared: string | undefined;
      try {
        if (kind === "check") {
          const npm = (this.dependencies.locateNpm ?? findNpmCli)();
          const latest = JSON.parse(await this.run([npm, "view", "rea-agents", "dist-tags.latest", "--json", "--registry=https://registry.npmjs.org", "--fetch-retries=0", "--fetch-timeout=20000"]));
          if (!validReaVersion(latest)) throw Error("npm 未返回有效的 REA 稳定版本。");
          this.state.latest = latest;
        } else if (kind === "install") {
          const npm = (this.dependencies.locateNpm ?? findNpmCli)();
          const directory = `v${version}-${randomUUID()}`;
          prepared = join(reaDirectory(this.root), "versions", directory);
          mkdirSync(prepared, { recursive: true });
          // Keep the complete package and npm lock, including native optional dependencies.
          // Each install uses a new prefix; active workers retain their previous version.
          await this.run([npm, "install", "--prefix", prepared, "--no-audit", "--no-fund", "--omit=dev", "--engine-strict", "--registry=https://registry.npmjs.org", `rea-agents@${version}`], 600_000);
          signal.throwIfAborted();
          this.notify("正在检查 REA 技能与 MCP 连接…");
          const packageRoot = join(prepared, "node_modules", "rea-agents");
          inspectReaPackage(packageRoot, version);
          loadReaSkill(this.root, this.root, packageRoot);
          const diagnostic = await (this.dependencies.diagnose ?? diagnoseRea)(this.root, packageRoot, version, signal);
          signal.throwIfAborted();
          if (readReaConfig(this.root).revision !== current.revision) throw Error("安装期间配置已变化，未切换当前版本，请重新检查。");
          atomicReaJson(reaConfigPath(this.root), { ...current, revision: randomUUID(), installation: { directory, version } });
          prepared = undefined;
          this.state.diagnostic = diagnostic;
        } else {
          const packageRoot = reaPackageRoot(this.root, current);
          if (!packageRoot) throw Error("请先安装 REA。");
          this.state.diagnostic = await (this.dependencies.diagnose ?? diagnoseRea)(this.root, packageRoot, current.installation!.version, signal);
        }
        this.state.job!.message = kind === "install" ? current.skillInstalled === false || current.mcpInstalled === false
          ? "REA 已安装；保留技能与 MCP 原有的安装选择。"
          : "REA 与技能已接入；已有会话请重新加载技能与 MCP。" : "检查完成。";
      } catch (error) {
        this.state.job!.message = signal.aborted ? "操作已取消；当前版本保持不变。" : "操作未完成";
        if (!signal.aborted) this.state.job!.error = errorMessage(error, "REA 操作失败，请重新检查。");
      } finally {
        if (prepared) try { rmSync(prepared, { recursive: true, force: true }); } catch { /* Unreferenced installation cannot become active. */ }
        this.load(); this.state.job!.running = false; this.pending = undefined;
        try { this.notify(); } catch { this.state.error = "REA 操作记录未能保存，请重新检查当前状态。"; this.changed(); }
      }
    });
    return this.snapshot();
  }
  async close() { this.closed = true; this.controller?.abort(); await this.pending; }
}
