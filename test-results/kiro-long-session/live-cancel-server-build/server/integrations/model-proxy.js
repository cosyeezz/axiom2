import { proxyLaunchSupported, toolProcessSupported, toolProcessSupportError } from "./tool-process.js";
import { prepareXrayImporter } from "./model-proxy-xray-installer.js";
import { cleanupScope, assertCleanupScope } from "./cleanup-scope.js";
import { assertProxyStopped, proxyRemovalPlan } from "./model-proxy-removal.js";
import { readProxyShareSource } from "./model-proxy-share-source.js";
import { runMaintenance, maintenanceCancelled, maintenanceFailure, maintenancePhase } from "../maintenance.js";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { proxySourceLimit } from "../../shared/model-proxy.js";
import { AppError, text } from "../../shared/protocol.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, proxyRuntimePath, readProxyConfig } from "./model-proxy-config.js";
import { installProxyKernel, latestProxyRelease } from "./model-proxy-install.js";
import { coreConfiguration, ProxyProcess } from "./model-proxy-process.js";
import { inspectProxySource } from "./model-proxy-import.js";
import { inspectXraySource } from "./model-proxy-xray-import.js";
export class ModelProxyService {
    root;
    changed;
    dependencies;
    config;
    processes = new Map();
    releases = new Map();
    job;
    inspection;
    xrayInspection;
    inspectionTimer;
    clearInspection() {
        clearTimeout(this.inspectionTimer);
        this.inspectionTimer = undefined;
        this.inspection = undefined;
        this.xrayInspection = undefined;
    }
    error;
    pending;
    mutation;
    controller;
    refreshTimer;
    refreshing = false;
    closed = false;
    constructor(root, changed, dependencies = {}) {
        this.root = root;
        this.changed = changed;
        this.dependencies = dependencies;
        try {
            this.config = readProxyConfig(root);
        }
        catch {
            this.config = { revision: "", profiles: [], installations: {}, bindings: {} };
            this.error = "模型代理配置无法读取；原文件未覆盖。";
        }
        this.publishRuntime();
    }
    async initialize() {
        if (this.closed || this.error || !proxyLaunchSupported())
            return;
        if (this.pending || this.mutation)
            throw new AppError("BUSY", "模型代理正在准备。");
        this.controller = new AbortController();
        const signal = this.controller.signal;
        this.pending = Promise.resolve().then(async () => {
            for (const profile of this.config.profiles) {
                if (signal.aborted || this.closed)
                    break;
                if (profile.enabled)
                    try {
                        await runMaintenance(this.root, { id: randomUUID(), resource: `proxy:${profile.kernel}`, label: "代理线路启动", action: "start", cancel: true, steps: ["checking", "downloading", "validating"] }, this.controller, () => this.start(profile, signal));
                    }
                    catch { /* The failed entry stays unavailable. */ }
            }
        }).finally(() => { this.pending = undefined; this.changed(); });
        await this.pending;
        this.scheduleRefresh();
    }
    scheduleRefresh(delay = 3_600_000) {
        clearTimeout(this.refreshTimer);
        if (this.closed || !proxyLaunchSupported())
            return;
        this.refreshTimer = setTimeout(() => this.refreshSubscriptions(), delay);
        this.refreshTimer.unref();
    }
    refreshSubscriptions() {
        if (this.closed)
            return;
        if (this.pending || this.mutation) {
            this.scheduleRefresh(60_000);
            return;
        }
        const profiles = this.config.profiles.filter(profile => profile.enabled && profile.kernel === "mihomo" && /^https?:\/\//i.test(profile.source.trim()));
        if (!profiles.length) {
            this.scheduleRefresh();
            return;
        }
        this.refreshing = true;
        const controller = this.controller = new AbortController();
        this.pending = Promise.resolve().then(async () => {
            for (const profile of profiles) {
                if (controller.signal.aborted || this.closed)
                    break;
                const id = randomUUID();
                this.job = { id, running: true, profileId: profile.id, message: "正在刷新订阅；验证失败时保留当前线路。" };
                this.changed();
                try {
                    await runMaintenance(this.root, { id, resource: "proxy:mihomo", label: "mihomo 订阅刷新", action: "refresh", cancel: true, steps: ["checking", "downloading", "validating"] }, controller, () => this.start(profile, controller.signal, true));
                    this.job.message = "订阅刷新完成；验证通过后已应用。";
                }
                catch (error) {
                    const cancelled = maintenanceCancelled(error, controller.signal);
                    if (!cancelled)
                        this.job.error = error instanceof Error ? error.message : "订阅刷新失败，当前线路保持不变。";
                    this.job.message = cancelled ? "订阅刷新已取消，保留当前线路。" : "订阅刷新未完成，保留当前线路。";
                }
                finally {
                    this.job.running = false;
                    this.changed();
                }
            }
        }).finally(() => { this.pending = undefined; this.refreshing = false; this.scheduleRefresh(); });
    }
    snapshot() {
        const cleanup = {};
        let cleanupError;
        try {
            for (const kernel of ["xray", "mihomo"])
                cleanup[kernel] = cleanupScope(proxyRemovalPlan(this.root, kernel, this.config).paths);
        }
        catch {
            cleanupError = "无法核实内核卸载目录，请检查安装路径。";
        }
        // 线路启停只需记录 PID，任何平台都可用；内核安装、检查与订阅导入仍需进程监督能力，用 managed 单独表达。
        const managed = toolProcessSupported();
        const launchable = proxyLaunchSupported() && (!!this.config.installations.xray || !!this.config.installations.mihomo);
        return { revision: this.config.revision, platform: `${process.platform}/${process.arch}`, supported: launchable, managed,
            supportError: launchable ? undefined : managed ? "请先安装此线路需要的内核。" : toolProcessSupportError,
            installations: structuredClone(this.config.installations), latest: Object.fromEntries([...this.releases].map(([kernel, release]) => [kernel, release.version])),
            cleanup, cleanupError,
            removalPending: Object.fromEntries(["xray", "mihomo"].map(kernel => [kernel, !!this.config.removalPending?.some(name => kernel === "xray" ? name.startsWith("xray-") : name.startsWith("mihomo-"))])),
            profiles: this.config.profiles.map(({ id, name, kernel, node }) => { const endpoint = this.processes.get(id)?.endpoint; return { id, name, kernel, node, status: endpoint?.status ?? "stopped", message: endpoint?.message }; }),
            bindings: { ...this.config.bindings }, job: this.job && { ...this.job }, inspection: this.inspection && structuredClone(this.inspection), error: this.error };
    }
    publishRuntime() {
        atomicProxyJson(proxyRuntimePath(this.root), Object.fromEntries([...this.processes].map(([id, process]) => [id, process.endpoint])));
    }
    notify = () => { this.publishRuntime(); this.changed(); };
    save(next) {
        const value = { ...next, revision: randomUUID() };
        atomicProxyJson(proxyConfigPath(this.root), value);
        this.config = value;
        this.changed();
    }
    async start(profile, signal, refresh = false) {
        if (!proxyLaunchSupported())
            throw new AppError("UNSUPPORTED_PLATFORM", "此平台尚不能启动代理线路。");
        const install = this.config.installations[profile.kernel];
        if (!install)
            throw new AppError("NOT_INSTALLED", "请先安装此线路需要的内核。");
        let source = profile.source;
        const previous = this.processes.get(profile.id);
        if (profile.kernel === "mihomo" && /^https?:\/\//i.test(source.trim())) {
            source = await (this.dependencies.readSource ?? readProxyShareSource)(source.trim(), signal);
            if (refresh && previous?.endpoint.status === "running" && previous.profile.source === source)
                return;
            const nodes = await (this.dependencies.inspectSource ?? inspectProxySource)(this.root, install, source, signal);
            if (!nodes.some(node => node.name === profile.node))
                throw Error("订阅中未找到已选择的节点，保留当前线路；请重新识别并选择节点。");
        }
        signal.throwIfAborted();
        if (this.closed)
            throw new AppError("CLOSING", "服务正在退出。");
        maintenancePhase("validating", "正在验证代理入口；就绪后切换线路。");
        // 同服务内其他线路的 PID：它们的存活不应被本线路的启动/停止兜底清理影响。
        const siblings = () => [...this.processes.entries()].filter(([id]) => id !== profile.id)
            .flatMap(([, process]) => process.processId ? [process.processId] : []);
        const candidate = new ProxyProcess(this.root, { ...profile, source }, this.notify, siblings);
        try {
            await candidate.start(install, signal);
            signal.throwIfAborted();
            if (this.closed || this.processes.get(profile.id) !== previous)
                throw Error("线路状态已变化，未应用订阅刷新。");
            this.processes.set(profile.id, candidate);
            this.notify();
        }
        catch (error) {
            if (this.processes.get(profile.id) === candidate) {
                if (previous)
                    this.processes.set(profile.id, previous);
                else
                    this.processes.delete(profile.id);
            }
            await candidate.stop();
            throw error;
        }
        await previous?.stop();
        this.scheduleRefresh();
    }
    async command(c) {
        if (c.workspaceId || c.sessionId)
            throw new AppError("INVALID_SCOPE", "模型代理使用应用级配置。");
        if (this.closed)
            throw new AppError("CLOSING", "服务正在退出。");
        if (c.op === "modelProxy.get")
            return this.snapshot();
        if (c.op === "modelProxy.cancel") {
            if (this.job?.running && this.job.cancellable === false)
                throw new AppError("NOT_CANCELLABLE", "卸载已开始，正在停止线路并清理文件。");
            if (c.params?.jobId && c.params.jobId !== this.job?.id)
                throw new AppError("REVISION_CONFLICT", "当前操作已改变。");
            this.controller?.abort();
            await this.pending;
            return this.snapshot();
        }
        if (this.refreshing) {
            this.controller?.abort();
            await this.pending;
        }
        if (this.pending || this.mutation)
            throw new AppError("BUSY", "请等待当前模型代理操作完成。");
        const operation = Promise.resolve().then(() => this.execute(c));
        this.mutation = operation;
        try {
            return await operation;
        }
        finally {
            if (this.mutation === operation)
                this.mutation = undefined;
        }
    }
    async execute(c) {
        if (this.closed)
            throw new AppError("CLOSING", "服务正在退出。");
        const p = c.params ?? {};
        if (c.op === "modelProxy.get")
            return this.snapshot();
        if (c.op === "modelProxy.cancel") {
            this.controller?.abort();
            await this.pending;
            return this.snapshot();
        }
        if (this.pending)
            throw new AppError("BUSY", "请等待当前模型代理操作完成。");
        if (this.error)
            throw new AppError("CONFIG_READ_FAILED", this.error);
        if (["modelProxy.save", "modelProxy.remove", "modelProxy.start", "modelProxy.stop", "modelProxy.uninstall"].includes(c.op) && p.revision !== this.config.revision)
            throw new AppError("REVISION_CONFLICT", "代理配置已改变，请重新读取后操作。");
        if (c.op === "modelProxy.save") {
            const existing = this.config.profiles.find(item => item.id === p.id);
            if (p.id && !existing)
                throw new AppError("NOT_FOUND", "线路已不存在。");
            if (p.kernel !== "xray" && p.kernel !== "mihomo")
                throw new AppError("INVALID_INPUT", "请选择内核。");
            const supplied = typeof p.source === "string" ? p.source.trim() : "";
            if (!supplied && existing && existing.kernel !== p.kernel)
                throw new AppError("INVALID_INPUT", "切换运行内核后，请重新填写并识别线路配置。");
            let source = supplied || existing?.source;
            if (!source || Buffer.byteLength(source, "utf8") > proxySourceLimit)
                throw new AppError("INVALID_INPUT", "请填写线路配置，最多 2 MB（UTF-8）。");
            let node = typeof p.node === "string" ? p.node.slice(0, 300) : "";
            if (p.kernel === "xray") {
                if (p.inspectionId !== undefined) {
                    const inspected = this.xrayInspection;
                    if (!inspected || inspected.id !== p.inspectionId || inspected.source !== supplied || !inspected.outbounds.has(node))
                        throw new AppError("INSPECTION_REQUIRED", "识别结果已失效或输入已改变，请重新识别并选择节点。");
                    source = inspected.outbounds.get(node);
                }
                else
                    node = supplied ? "" : existing?.node ?? "";
            }
            const profile = { id: existing?.id ?? randomUUID(), name: text(p.name, "线路名称", 80), kernel: p.kernel,
                node, source, enabled: false };
            try {
                coreConfiguration(profile, 12345, "validation", "/provider.yaml");
            }
            catch {
                throw new AppError("INVALID_INPUT", profile.kernel === "mihomo"
                    ? "请填写节点名称和有效的分享链接、订阅地址或 Clash 配置。"
                    : "分享链接请先识别并选择节点；高级配置需填写可独立使用的 Xray outbound JSON，不支持直连、拒绝或回环出口。");
            }
            await this.processes.get(profile.id)?.stop();
            this.processes.delete(profile.id);
            if (this.closed)
                throw new AppError("CLOSING", "服务正在退出。");
            this.save({ ...this.config, profiles: [...this.config.profiles.filter(item => item.id !== profile.id), profile] });
            this.clearInspection();
            this.notify();
            return this.snapshot();
        }
        if (c.op === "modelProxy.remove" || c.op === "modelProxy.stop") {
            const profile = this.config.profiles.find(item => item.id === p.id);
            if (!profile)
                throw new AppError("NOT_FOUND", "线路已不存在。");
            await this.processes.get(profile.id)?.stop();
            if (this.closed)
                throw new AppError("CLOSING", "服务正在退出。");
            const removing = c.op === "modelProxy.remove";
            if (removing)
                this.processes.delete(profile.id);
            this.save({ ...this.config,
                profiles: removing ? this.config.profiles.filter(item => item.id !== profile.id) : this.config.profiles.map(item => item.id === profile.id ? { ...item, enabled: false } : item),
                bindings: removing ? Object.fromEntries(Object.entries(this.config.bindings).filter(([, id]) => id !== profile.id)) : this.config.bindings });
            this.notify();
            return this.snapshot();
        }
        if (!["modelProxy.start", "modelProxy.check", "modelProxy.install", "modelProxy.inspect", "modelProxy.uninstall"].includes(c.op))
            throw new AppError("UNKNOWN_OPERATION", "不支持此代理操作。");
        if (c.op !== "modelProxy.uninstall" && !["modelProxy.start", "modelProxy.stop"].includes(c.op) && !toolProcessSupported())
            throw new AppError("UNSUPPORTED_PLATFORM", toolProcessSupportError);
        const inspecting = c.op === "modelProxy.inspect";
        const kernel = (inspecting ? p.kernel ?? "mihomo" : p.kernel);
        const source = inspecting && typeof p.source === "string" ? p.source.trim() : "";
        if (inspecting) {
            if (kernel !== "xray" && kernel !== "mihomo")
                throw new AppError("INVALID_INPUT", "请选择内核。");
            if (!source || Buffer.byteLength(source, "utf8") > proxySourceLimit)
                throw new AppError("INVALID_INPUT", "请粘贴分享链接、订阅地址或配置内容，最多 2 MB（UTF-8）。");
            if (!this.config.installations[kernel])
                throw new AppError("NOT_INSTALLED", `请先安装 ${kernel === "xray" ? "Xray-core" : "mihomo"}，再识别分享链接或订阅中的节点。`);
            if (this.config.removalPending?.some(name => name.startsWith(`${kernel}-`)))
                throw new AppError("REMOVAL_PENDING", "此内核有待清理文件，请先完成清理后重新安装。");
            if (kernel === "mihomo") {
                try {
                    coreConfiguration({ id: "import", name: "import", node: "unselected", kernel, source }, 0, "validation", "/provider.yaml");
                }
                catch {
                    throw new AppError("INVALID_INPUT", "请检查订阅地址；不支持在地址中内嵌账号密码。");
                }
            }
            this.clearInspection();
        }
        const profile = this.config.profiles.find(item => item.id === p.id);
        if (c.op === "modelProxy.start" && !profile)
            throw new AppError("NOT_FOUND", "线路已不存在。");
        if (c.op !== "modelProxy.start" && kernel !== "xray" && kernel !== "mihomo")
            throw new AppError("INVALID_INPUT", "请选择内核。");
        const release = this.releases.get(kernel);
        if (c.op === "modelProxy.install" && (!release || release.version !== p.version))
            throw new AppError("CHECK_REQUIRED", "请先检查更新，再安装已确认版本。");
        if (c.op === "modelProxy.install" && kernel === "mihomo" && this.config.installations[kernel]?.version === release.version)
            return this.snapshot();
        if (c.op === "modelProxy.install" && this.config.removalPending?.some(name => name.startsWith(`${kernel}-`)))
            throw new AppError("REMOVAL_PENDING", "此内核有待清理文件，请先完成清理后重新安装。");
        const removing = c.op === "modelProxy.uninstall";
        if (removing && p.confirm !== true)
            throw new AppError("CONFIRM_REQUIRED", "请确认卸载内核并停止使用它的线路；订阅和供应商绑定会保留。");
        this.controller = new AbortController();
        const signal = this.controller.signal;
        // profileId 让界面把「启动中」显示在对应线路卡片上，而不是只留一条全局提示。
        this.job = { id: c.requestId, running: true, cancellable: !removing, ...(profile ? { profileId: profile.id } : {}), message: removing ? "正在准备卸载内核…" : inspecting ? "正在识别节点…" : c.op === "modelProxy.start" ? "正在启动线路…" : c.op === "modelProxy.check" ? "正在检查官方版本…" : "正在下载并校验内核…" };
        this.changed();
        this.pending = Promise.resolve().then(() => runMaintenance(this.root, { id: this.job.id, resource: `proxy:${kernel ?? profile?.kernel}`, label: `代理 ${kernel ?? profile?.kernel}`, action: c.op.slice("modelProxy.".length), params: p, cancel: !removing, steps: removing ? ["checking", "removing", "validating"] : c.op === "modelProxy.install" || inspecting ? undefined : c.op === "modelProxy.start" ? ["checking", "downloading", "validating"] : ["checking"] }, this.controller, async () => {
            let prepared, skipped = 0;
            try {
                if (removing) {
                    if (readProxyConfig(this.root).revision !== this.config.revision)
                        throw new AppError("REVISION_CONFLICT", "代理配置已变化，请重新读取后卸载。");
                    const plan = proxyRemovalPlan(this.root, kernel, this.config);
                    assertCleanupScope(p.cleanupRevision, cleanupScope(plan.paths));
                    await Promise.all([...this.processes.values()].filter(process => process.profile.kernel === kernel).map(process => process.stop()));
                    assertProxyStopped(this.root, kernel, plan.paths);
                    signal.throwIfAborted();
                    if (readProxyConfig(this.root).revision !== this.config.revision)
                        throw new AppError("REVISION_CONFLICT", "代理配置已变化，线路已停止，请重新读取后卸载。");
                    assertCleanupScope(p.cleanupRevision, cleanupScope(proxyRemovalPlan(this.root, kernel, this.config).paths));
                    const installations = { ...this.config.installations };
                    delete installations[kernel];
                    maintenancePhase("removing");
                    this.save({ ...this.config, installations, profiles: this.config.profiles.map(item => item.kernel === kernel ? { ...item, enabled: false } : item), removalPending: [...new Set([...(this.config.removalPending ?? []), ...plan.names])] });
                    try {
                        plan.remove();
                    }
                    catch {
                        throw Error("内核已停用，部分文件未能删除；解除占用后可重试清理。订阅和供应商绑定已保留。");
                    }
                    maintenancePhase("validating");
                    const remaining = this.config.removalPending.filter(name => !plan.names.includes(name));
                    this.save({ ...this.config, removalPending: remaining.length ? remaining : undefined });
                    this.clearInspection();
                }
                else if (inspecting) {
                    if (kernel === "xray") {
                        const result = await inspectXraySource(this.root, source, signal, message => { this.job.message = message; this.changed(); });
                        signal.throwIfAborted();
                        this.inspection = { id: this.job.id, kernel, nodes: result.nodes };
                        skipped = result.skipped;
                        this.xrayInspection = { id: this.job.id, source, outbounds: result.outbounds };
                        this.inspectionTimer = setTimeout(() => { this.clearInspection(); this.changed(); }, 10 * 60_000);
                        this.inspectionTimer.unref();
                    }
                    else {
                        const nodes = await inspectProxySource(this.root, this.config.installations.mihomo, source, signal);
                        signal.throwIfAborted();
                        this.inspection = { id: this.job.id, ...(p.kernel ? { kernel } : {}), nodes };
                    }
                }
                else if (c.op === "modelProxy.check")
                    this.releases.set(kernel, await (this.dependencies.latestRelease ?? latestProxyRelease)(kernel, signal));
                else if (c.op === "modelProxy.install") {
                    prepared = await (this.dependencies.installKernel ?? installProxyKernel)(this.root, release, signal);
                    if (kernel === "xray")
                        await (this.dependencies.prepareImporter ?? prepareXrayImporter)(this.root, signal, message => { this.job.message = message; this.changed(); });
                    signal.throwIfAborted();
                    this.save({ ...this.config, installations: { ...this.config.installations, [kernel]: prepared } });
                    prepared = undefined;
                }
                else {
                    await this.start(profile, signal);
                    signal.throwIfAborted();
                    this.save({ ...this.config, profiles: this.config.profiles.map(item => item.id === profile.id ? { ...item, enabled: true } : item) });
                }
                this.job.message = removing ? "内核已卸载；相关线路已停止，订阅和供应商绑定保留。" : inspecting ? `已识别 ${this.inspection.nodes.length} 个节点，请选择并保存线路。${skipped ? `已跳过 ${skipped} 项无效、重复或不支持的内容。` : ""}`
                    : c.op === "modelProxy.start" ? "本地代理入口已启动；远端连接以实际模型请求为准。" : c.op === "modelProxy.install" ? "内核安装与自检完成；重新启动线路后使用新版本。" : "官方版本检查完成。";
            }
            catch (error) {
                maintenanceFailure(error);
                this.job.message = maintenanceCancelled(error, signal) ? "操作已取消。" : "操作未完成。";
                if (!maintenanceCancelled(error, signal))
                    this.job.error = error instanceof Error ? error.message : "模型代理操作失败。";
            }
            finally {
                if (prepared)
                    rmSync(join(proxyDirectory(this.root), "versions", prepared.directory), { recursive: true, force: true });
                this.job.running = false;
                this.pending = undefined;
                this.changed();
            }
        })).catch(error => { this.job.running = false; if (!maintenanceCancelled(error))
            this.job.error = error instanceof Error ? error.message : "任务未能启动。"; this.pending = undefined; this.changed(); });
        return this.snapshot();
    }
    async close() {
        this.closed = true;
        clearTimeout(this.refreshTimer);
        this.controller?.abort();
        this.clearInspection();
        await this.mutation?.catch(() => { });
        await this.pending;
        await Promise.allSettled([...this.processes.values()].map(process => process.stop()));
        this.processes.clear();
        this.publishRuntime();
    }
}
//# sourceMappingURL=model-proxy.js.map