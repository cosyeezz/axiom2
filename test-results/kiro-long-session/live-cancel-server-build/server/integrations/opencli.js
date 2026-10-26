import { loadSkills } from "@earendil-works/pi-coding-agent";
import { managedNode } from "./managed-node.js";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";
import { writeNodeLauncher } from "./node-launcher.js";
import { openCliShimProbe } from "./opencli-shim.js";
import { currentMaintenance, maintenanceCancelled, maintenancePhase, runMaintenance } from "../maintenance.js";
import { beginBuiltinOperation, builtinPendingOperation, builtinPendingRemovals, builtinRemovalDirectories, markBuiltinRemovals, reconcileBuiltinOperation, bindBuiltinTask, runBuiltinTool, trackBuiltinDirectory, assertBuiltinDirectoryOwned, assertBuiltinFilesSafe, forgetBuiltinDirectory, withBuiltinConfiguration } from "./builtin-operation.js";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { AppError } from "../../shared/protocol.js";
import { defaultOpenCliSettings } from "../../shared/builtin-tools.js";
import { openExtensionPage } from "./opencli-browser.js";
import { errorMessage } from "../error-message.js";
import { openCliConfigPath, openCliEnvironment, openCliNode, openCliPrefix, openCliSkillNames, openCliSkillPaths, openCliVersionPaths, openCliVersionPattern, readOpenCliConfig, validateOpenCliPackage } from "./opencli-runtime.js";
import { cleanupScope, assertCleanupScope } from "./cleanup-scope.js";
import { openCliRemovalPlan } from "./opencli-removal.js";
import { managedDirectory, removeManagedDirectory } from "./managed-removal.js";
const packageName = "@jackwener/opencli";
const registry = "--registry=https://registry.npmjs.org";
const versionPattern = /^\d+\.\d+\.\d+$/;
export function newerOpenCli(latest, current) {
    if (!versionPattern.test(latest) || !versionPattern.test(current))
        return false;
    const a = latest.split(".").map(Number), b = current.split(".").map(Number);
    for (let i = 0; i < 3; i++)
        if (a[i] !== b[i])
            return a[i] > b[i];
    return false;
}
function atomicJson(path, value, onPublished) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        const fd = openSync(temporary, "wx", 0o600);
        try {
            writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(temporary, path);
        // Publication may succeed even when the following durability check fails.
        onPublished?.();
        if (process.platform !== "win32") {
            const directory = openSync(dirname(path), "r");
            try {
                fsyncSync(directory);
            }
            finally {
                closeSync(directory);
            }
        }
    }
    finally {
        rmSync(temporary, { force: true });
    }
}
export function findNpmCli(env = process.env, node = process.execPath) {
    const directories = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
    const candidates = [join(dirname(node), "node_modules/npm/bin/npm-cli.js"), join(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js")];
    for (const directory of directories) {
        candidates.push(join(directory, "node_modules/npm/bin/npm-cli.js"));
        if (process.platform !== "win32") {
            try {
                const target = realpathSync(join(directory, "npm"));
                if (target.endsWith("npm-cli.js"))
                    candidates.push(target);
            }
            catch { /* Try the next PATH entry. */ }
        }
    }
    const found = candidates.find((path) => existsSync(path));
    if (!found)
        throw Error("未找到 npm。请安装包含 npm 的 Node.js 22.19.0+，然后重启 Axiom 后台服务。");
    return resolve(found);
}
import { toolProcessSupported, toolProcessSupportError } from "./tool-process.js";
export const executeOpenCli = async (args, options) => {
    options.signal.throwIfAborted();
    const execution = currentMaintenance(), installing = args.includes("install") || args.includes("uninstall");
    const npmNetwork = /npm-cli\.js$/i.test(args[0] ?? "") && ["install", "uninstall", "view"].includes(args[1]);
    if (execution && npmNetwork)
        args = [...args.filter(arg => !/^--fetch-(timeout|retries)=/.test(arg)), "--fetch-timeout=86400000", "--fetch-retries=2"];
    if (installing)
        maintenancePhase("installing");
    const result = await runBuiltinTool(options.tool ?? "opencli", options.nodeExecutable ?? process.execPath, args, { ...options, limit: 128_000, errorLimit: 128_000, output: installing ? "tail" : "structured" });
    if (result.code !== 0)
        throw Error(errorMessage(result.stderr.toString("utf8") || result.stdout.toString("utf8"), "命令未完成，请检查网络和 npm 目录权限。", true, result.stderr.length > 0 ? result.stderrTruncated : result.stdoutTruncated));
    return result.stdout.toString("utf8").trim();
};
export class OpenCliService {
    root;
    changed;
    execute;
    locateNpm;
    openExtension;
    removal;
    runtime;
    state = { ready: false, nodeVersion: process.version, configured: false, revision: "", settings: { ...defaultOpenCliSettings } };
    config;
    npm;
    binDirectory;
    entry;
    pending;
    controller;
    closed = false;
    jobFile;
    constructor(root, changed, execute = executeOpenCli, locateNpm = findNpmCli, openExtension = openExtensionPage, removal = async (work) => work(), runtime = managedNode) {
        this.root = root;
        this.changed = changed;
        this.execute = execute;
        this.locateNpm = locateNpm;
        this.openExtension = openExtension;
        this.removal = removal;
        this.runtime = runtime;
        this.jobFile = join(root, "integrations", "opencli-job.json");
        this.loadConfig();
        try {
            const job = JSON.parse(readFileSync(this.jobFile, "utf8"));
            if (job.running)
                Object.assign(job, { running: false, queued: false, error: "上次操作被服务退出中断，请重新检查当前安装；不会自动重复安装。", message: "操作已中断" });
            this.state.job = job;
        }
        catch (error) {
            if (error.code !== "ENOENT")
                this.state.error = "无法读取上次 OpenCLI 操作记录，请检查 integrations/opencli-job.json。";
        }
    }
    snapshot() {
        const value = structuredClone(this.state);
        if (!toolProcessSupported()) {
            value.ready = false;
            value.supportError = toolProcessSupportError;
        }
        try {
            value.pendingOperation = builtinPendingOperation(this.root, "opencli");
            const pending = builtinPendingRemovals(this.root, "opencli");
            value.removalPending ||= pending.length > 0;
            value.cleanup = cleanupScope(openCliRemovalPlan(this.root, readOpenCliConfig(this.root), pending).paths);
        }
        catch (error) {
            value.error = errorMessage(error, "维护归属记录不可读取，已保留文件。");
        }
        return value;
    }
    get installing() { return this.state.job?.running === true && this.state.job.kind === "install"; }
    loadConfig() {
        this.state.nodeVersion = "";
        this.state.runtimeManaged = false;
        delete this.state.npmVersion;
        try {
            this.config = readOpenCliConfig(this.root);
            this.state.revision = this.config?.revision ?? "";
            this.state.configured = !!this.config && !this.config.detached;
            this.state.managed = !!this.config?.directory;
            this.state.runtimeManaged = !!this.config?.runtime;
            this.state.nodeVersion = this.config?.runtime ? `v${this.config.runtime.nodeVersion}` : process.version;
            if (this.config?.runtime)
                this.state.npmVersion = this.config.runtime.npmVersion;
            this.state.removalPending = !!this.config?.removalPending?.length;
            this.state.settings = this.config ? { enabled: this.config.enabled, profile: this.config.profile, window: this.config.window } : { ...defaultOpenCliSettings };
            delete this.state.error;
        }
        catch (error) {
            this.config = undefined;
            this.state.configured = false;
            this.state.error = errorMessage(error, "无法读取 OpenCLI 配置。");
        }
    }
    notify(message) {
        if (message && this.state.job)
            this.state.job.message = message;
        if (this.state.job)
            atomicJson(this.jobFile, this.state.job);
        this.changed();
    }
    async run(args, timeout = 30_000, config = this.config) {
        const nodeExecutable = config && !config.detached ? openCliNode(config) : process.execPath;
        const source = config ? openCliEnvironment(config) : process.env;
        const state = join(config?.directory ? openCliPrefix(config) : join(this.root, "integrations", "opencli"), "environment");
        prepareComponentEnvironment(state);
        const env = componentEnvironment(state, source, dirname(nodeExecutable));
        return this.execute(args, { cwd: this.root, env, signal: this.controller.signal, timeout, nodeExecutable });
    }
    async npmCli() {
        this.npm = this.locateNpm();
        this.state.npmVersion = await this.run([this.npm, "--version"]);
        return this.npm;
    }
    select(config) {
        const { entry, version } = validateOpenCliPackage(config);
        this.entry = entry;
        this.binDirectory = config.binDirectory;
        this.state.version = version;
        this.state.packageRoot = config.packageRoot;
        this.state.managed = !!config.directory;
        this.state.nodeVersion = config.runtime ? `v${config.runtime.nodeVersion}` : process.version;
        this.state.npmVersion = config.runtime?.npmVersion;
        this.state.runtimeManaged = !!config.runtime;
    }
    async inspect() {
        this.loadConfig();
        this.state.ready = false;
        delete this.state.version;
        delete this.state.packageRoot;
        delete this.state.installationError;
        this.entry = undefined;
        this.binDirectory = undefined;
        if (this.state.error)
            throw Error(this.state.error);
        // Once configured, never silently replace a broken or detached choice with a global package.
        if (this.config) {
            if (!this.config.detached)
                try {
                    this.select(this.config);
                }
                catch (error) {
                    this.state.installationError = errorMessage(error, "OpenCLI 安装不完整，请重新安装。");
                }
        }
        else {
            let npm;
            try {
                npm = await this.npmCli();
            }
            catch {
                this.state.ready = true;
                return;
            }
            const modules = await this.run([npm, "root", "--global"]);
            const prefix = await this.run([npm, "prefix", "--global"]);
            if (!isAbsolute(modules) || !isAbsolute(prefix) || /[\r\n]/.test(modules + prefix))
                throw Error("npm 返回了无效的全局安装目录。");
            const packageRoot = join(modules, "@jackwener", "opencli");
            if (existsSync(join(packageRoot, "package.json")))
                try {
                    this.select({ format: 1, revision: "inspect", packageRoot, binDirectory: process.platform === "win32" ? prefix : join(prefix, "bin"), ...defaultOpenCliSettings });
                }
                catch (error) {
                    this.state.installationError = errorMessage(error, "OpenCLI 外部安装不完整，请重新安装。");
                }
        }
        this.state.ready = true;
    }
    saveConfig(settings, revision) {
        withBuiltinConfiguration(this.root, "opencli", () => {
            const current = readOpenCliConfig(this.root);
            if (revision !== (current?.revision ?? ""))
                throw new AppError("CONFIGURATION_CONFLICT", "OpenCLI 配置已变化，请重新读取后保存；当前输入已保留。");
            if (!this.state.packageRoot || !this.binDirectory)
                throw new AppError("NOT_INSTALLED", "请先检查环境并安装 OpenCLI。");
            const next = { ...current, format: 1, revision: randomUUID(), packageRoot: this.state.packageRoot, binDirectory: this.binDirectory, ...settings };
            validateOpenCliPackage(next);
            atomicJson(openCliConfigPath(this.root), next);
            this.loadConfig();
            delete this.state.diagnostic;
        });
    }
    async install(version, revision, onPublished) {
        if (this.state.revision !== revision)
            throw Error("接入配置已变化，请重新检查后安装。");
        if (this.state.version && this.state.version !== version && !newerOpenCli(version, this.state.version))
            throw Error("当前安装版本高于已检查的版本，未执行降级。");
        const directory = `v${version}-${randomUUID()}`;
        const paths = openCliVersionPaths(this.root, directory);
        managedDirectory(this.root, ["integrations", "opencli", "versions"], directory, openCliVersionPattern);
        mkdirSync(paths.prefix, { recursive: true });
        trackBuiltinDirectory(paths.prefix);
        const candidate = { ...this.config, format: 1, revision: randomUUID(), ...this.state.settings, packageRoot: paths.packageRoot, binDirectory: paths.binDirectory, directory, detached: false };
        if (this.state.packageRoot && !this.config?.directory)
            candidate.migration = { packageRoot: this.state.packageRoot, version: this.state.version, at: Date.now(), externalFilesRetained: true };
        let published = false;
        try {
            const runtime = await this.runtime.prepare("opencli", paths.prefix, packageName, version, this.controller.signal, text => this.notify(text));
            candidate.runtime = runtime.binding;
            this.notify(`正在安装 OpenCLI ${version} 到独立目录…`);
            await this.run([runtime.npm, "install", "--prefix", paths.prefix, "--global=false", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--engine-strict", registry, `${packageName}@${version}`], 600_000, candidate);
            maintenancePhase("validating");
            managedDirectory(this.root, ["integrations", "opencli", "versions"], directory, openCliVersionPattern);
            const program = validateOpenCliPackage({ ...candidate, runtime: undefined }, version);
            writeNodeLauncher(paths.prefix, openCliNode(candidate), program.entry);
            const validated = validateOpenCliPackage(candidate, version);
            const skills = loadSkills({ cwd: this.root, agentDir: join(this.root, "pi"), includeDefaults: false, skillPaths: openCliSkillPaths({ ...candidate, enabled: true }) });
            if (openCliSkillNames.some(name => skills.skills.filter(skill => skill.name === name).length !== 1))
                throw Error("OpenCLI 官方常用技能未通过解析校验，原接入保持不变。");
            const actual = await this.run([validated.entry, "--version"], 30_000, candidate);
            const matchesVersion = (value) => typeof value === "string" && value.trim().replace(/^(?:opencli\s+)?v?/i, "") === version;
            if (!matchesVersion(actual))
                throw Error("安装后的命令版本未通过校验。");
            const shims = JSON.parse(await this.run(openCliShimProbe(candidate), 30_000, candidate));
            if (!Array.isArray(shims) || shims.length !== (process.platform === "win32" ? 2 : 1) || !shims.every(matchesVersion))
                throw Error("OpenCLI 实际命令入口的版本未通过校验，原接入保持不变。");
            this.controller.signal.throwIfAborted();
            if ((readOpenCliConfig(this.root)?.revision ?? "") !== revision)
                throw Error("接入配置已变化，未切换新版本；请重新读取后重试。");
            assertBuiltinFilesSafe();
            atomicJson(openCliConfigPath(this.root), candidate, () => { published = true; onPublished(); });
            this.loadConfig();
            this.select(candidate);
            delete this.state.installationError;
            delete this.state.diagnostic;
        }
        finally {
            // Published versions remain immutable while existing workers can still reference them.
            if (!published) {
                assertBuiltinFilesSafe();
                removeManagedDirectory(this.root, ["integrations", "opencli", "versions"], directory, openCliVersionPattern);
                forgetBuiltinDirectory(paths.prefix);
            }
        }
    }
    async uninstall(revision, scopeRevision) {
        assertCleanupScope(scopeRevision, cleanupScope(openCliRemovalPlan(this.root, readOpenCliConfig(this.root), builtinRemovalDirectories()).paths));
        await this.removal(() => {
            assertBuiltinFilesSafe();
            const current = readOpenCliConfig(this.root);
            if ((current?.revision ?? "") !== revision)
                throw new AppError("CONFIGURATION_CONFLICT", "接入配置已变化，请重新确认卸载。");
            const plan = openCliRemovalPlan(this.root, current, builtinRemovalDirectories()), { names } = plan;
            assertCleanupScope(scopeRevision, cleanupScope(plan.paths));
            for (const name of names) {
                const path = managedDirectory(this.root, ["integrations", "opencli", "versions"], name, openCliVersionPattern);
                if (path)
                    assertBuiltinDirectoryOwned(path, name === current?.directory || !!current?.removalPending?.includes(name));
            }
            markBuiltinRemovals(names.map(name => openCliVersionPaths(this.root, name).prefix));
            const next = { ...current, format: 1, ...this.state.settings, revision: randomUUID(), packageRoot: "", binDirectory: "", detached: true, removalPending: names };
            delete next.directory;
            delete next.runtime;
            atomicJson(openCliConfigPath(this.root), next);
            this.loadConfig();
            delete this.state.version;
            delete this.state.packageRoot;
            delete this.state.diagnostic;
            delete this.state.installationError;
            this.entry = undefined;
            this.binDirectory = undefined;
            maintenancePhase("removing", "正在清理托管程序，保留接入设置与外部安装…");
            try {
                for (const name of names) {
                    assertBuiltinFilesSafe();
                    removeManagedDirectory(this.root, ["integrations", "opencli", "versions"], name, openCliVersionPattern);
                    // Retain the original identity until every pending reference is committed.
                }
            }
            catch {
                throw Error("接入已停用，部分文件未能删除；解除占用后可重试清理。外部安装和接入设置保留。");
            }
            delete next.removalPending;
            next.revision = randomUUID();
            atomicJson(openCliConfigPath(this.root), next);
            for (const name of names)
                forgetBuiltinDirectory(openCliVersionPaths(this.root, name).prefix);
            this.loadConfig();
            maintenancePhase("validating");
        });
    }
    async command(c) {
        if (c.workspaceId || c.sessionId)
            throw new AppError("INVALID_SCOPE", "内置工具属于本机应用配置。");
        if (this.closed)
            throw new AppError("CLOSING", "服务正在退出。");
        if (c.op === "opencli.get")
            return this.snapshot();
        if (c.op === "opencli.cancel") {
            if (!this.state.job?.running || this.state.job.cancellable === false || c.params?.jobId !== this.state.job.id)
                throw new AppError("NOT_CANCELLABLE", "此任务已结束或正在卸载，请读取最新状态。");
            this.controller.abort();
            await this.pending;
            return this.snapshot();
        }
        if (c.op === "opencli.reconcile") {
            if (this.pending)
                throw new AppError("BUSY", "请等待当前操作完成。");
            reconcileBuiltinOperation(this.root, "opencli", c.params?.operationId);
            this.loadConfig();
            this.changed();
            return this.snapshot();
        }
        if (c.op === "opencli.openExtension") {
            const params = c.params ?? {}, target = params.target ?? "store";
            if (Object.keys(params).some(key => key !== "target") || (target !== "store" && target !== "download"))
                throw new AppError("INVALID_PARAMS", "请选择 Chrome 应用商店或官方压缩包下载页，不接受自定义地址。");
            await this.openExtension(target);
            return this.snapshot();
        }
        if (c.op === "opencli.save") {
            if (this.pending)
                throw new AppError("BUSY", "请等待当前 OpenCLI 操作完成。");
            const p = c.params ?? {};
            if (typeof p.enabled !== "boolean" || typeof p.profile !== "string" || p.profile.length > 128 || /[\x00-\x1f\x7f]/.test(p.profile) || (p.window !== "foreground" && p.window !== "background"))
                throw new AppError("INVALID_SETTINGS", "请检查常用技能、浏览器配置档案和窗口模式。");
            this.saveConfig({ enabled: p.enabled, profile: p.profile.trim(), window: p.window }, p.revision);
            this.changed();
            return this.snapshot();
        }
        const kind = c.op.slice("opencli.".length);
        if (!c.op.startsWith("opencli.") || !["refresh", "check", "install", "doctor", "uninstall"].includes(kind))
            throw new AppError("UNKNOWN_OPERATION", "不支持此内置工具操作。");
        if (!["uninstall", "refresh"].includes(kind) && !toolProcessSupported())
            throw new AppError("UNSUPPORTED_PLATFORM", toolProcessSupportError);
        if (this.pending) {
            if (kind === "refresh")
                return this.snapshot();
            throw new AppError("BUSY", "已有 OpenCLI 操作正在进行，请等待完成。");
        }
        if (kind === "install" && (!this.state.latest || c.params?.version !== this.state.latest || !versionPattern.test(this.state.latest)))
            throw new AppError("CHECK_REQUIRED", "请先检查更新，再安装已确认的版本。");
        if (kind === "uninstall" && (c.params?.confirm !== true || c.params.revision !== this.state.revision))
            throw new AppError("CONFIRM_REQUIRED", "请读取当前配置并确认卸载。");
        const version = this.state.latest, revision = this.state.revision;
        let installationPublished = false;
        const operation = beginBuiltinOperation(this.root, "opencli");
        this.controller = new AbortController();
        this.state.job = { id: randomUUID(), kind, running: true, cancellable: kind !== "uninstall", version, message: "正在检查本机环境…" };
        if (kind === "doctor")
            delete this.state.diagnostic;
        try {
            this.notify();
        }
        catch {
            this.state.job.running = false;
            this.state.job.error = "无法保存操作记录，请检查数据目录权限与剩余空间；尚未开始操作。";
            this.controller = undefined;
            this.changed();
            try {
                operation.finish();
            }
            finally {
                operation.close();
            }
            throw new AppError("STORAGE_ERROR", this.state.job.error);
        }
        this.pending = operation.run(() => Promise.resolve().then(() => runMaintenance(this.root, { id: this.state.job.id, resource: "opencli", label: "OpenCLI", action: kind, params: c.params, cancel: kind !== "uninstall", steps: kind === "install" ? ["checking", "installing", "validating"] : kind === "uninstall" ? ["checking", "removing", "validating"] : ["checking"] }, this.controller, async () => {
            bindBuiltinTask();
            if (kind === "uninstall")
                await this.uninstall(revision, c.params?.cleanupRevision);
            else {
                await this.inspect();
                if (kind === "check") {
                    delete this.state.latest;
                    this.notify("正在检查 OpenCLI 最新版本…");
                    const latest = await this.runtime.latest(packageName, this.controller.signal);
                    if (typeof latest !== "string" || !versionPattern.test(latest))
                        throw Error("官方 npm 仓库未返回有效的稳定版本。");
                    this.state.latest = latest;
                }
                else if (kind === "install")
                    await this.install(version, revision, () => { installationPublished = true; });
                else if (kind === "doctor") {
                    if (!this.entry)
                        throw Error("请先安装 OpenCLI。");
                    this.notify("正在运行官方连接诊断，请保持 Chrome 打开…");
                    const output = await this.run([this.entry, "doctor"], 45_000);
                    this.state.diagnostic = { text: errorMessage(output, "诊断未返回内容。"), checkedAt: Date.now() };
                }
            }
            this.state.job.message = kind === "install" ? "安装与技能接入已完成；请继续安装扩展并检测连接。" : kind === "uninstall" ? "托管程序与接入已移除；外部安装和接入设置保留。" : kind === "doctor" ? "诊断已完成，请查看下方官方报告。" : "检查已完成。";
        })).catch(error => {
            const cancelled = maintenanceCancelled(error, this.controller.signal);
            if (installationPublished) {
                this.state.job.error = `OpenCLI 已切换至 ${version}，但后续确认未完成：${errorMessage(error, "请刷新检查安装与持久化状态。")}`;
                this.state.job.message = "新版本已生效，后续确认未完成；已保留安装文件。";
            }
            else {
                if (!cancelled)
                    this.state.job.error = errorMessage(error, "OpenCLI 操作未完成，请重新检查。");
                this.state.job.message = cancelled ? "操作已取消，当前接入未切换。" : "操作未完成";
            }
        }).finally(() => {
            // A configuration rename can publish a new revision before a later
            // durability/cleanup failure; retries must use the on-disk revision.
            this.loadConfig();
            this.state.job.running = false;
            this.state.job.queued = false;
            try {
                this.notify();
                operation.finish();
            }
            catch (error) {
                try {
                    operation.retain();
                }
                catch { }
                this.state.error = "操作记录或进程退出未能确认，已保留归属记录。";
                this.state.job.error = errorMessage(error, this.state.error);
                this.changed();
            }
            finally {
                operation.close();
                this.pending = undefined;
                this.changed();
            }
        }));
        return this.snapshot();
    }
    async close() { this.closed = true; if (this.state.job?.cancellable !== false)
        this.controller?.abort(); await this.pending; }
}
//# sourceMappingURL=opencli.js.map