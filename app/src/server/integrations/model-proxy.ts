import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { proxySourceLimit, type ModelProxyState, type ProxyKernel } from "../../shared/model-proxy.js";
import { AppError, text, type Command } from "../../shared/protocol.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, proxyRuntimePath, readProxyConfig, type ProxyConfig, type StoredProxyProfile } from "./model-proxy-config.js";
import { installProxyKernel, latestProxyRelease, proxyAsset, type ProxyRelease } from "./model-proxy-install.js";
import { coreConfiguration, ProxyProcess } from "./model-proxy-process.js";
import { inspectProxySource } from "./model-proxy-import.js";
import { inspectXraySource } from "./model-proxy-xray-import.js";

type Profile = StoredProxyProfile & { enabled?: boolean };
export class ModelProxyService {
  private config: ProxyConfig;
  private processes = new Map<string, ProxyProcess>();
  private releases = new Map<ProxyKernel, ProxyRelease>();
  private job?: ModelProxyState["job"];
  private inspection?: ModelProxyState["inspection"];
  private xrayInspection?: { id: string; source: string; outbounds: Map<string, string> };
  private inspectionTimer?: ReturnType<typeof setTimeout>;
  private clearInspection() {
    clearTimeout(this.inspectionTimer); this.inspectionTimer = undefined;
    this.inspection = undefined; this.xrayInspection = undefined;
  }
  private error?: string;
  private pending?: Promise<void>;
  private mutation?: Promise<ModelProxyState>;
  private controller?: AbortController;
  private closed = false;
  constructor(readonly root: string, private changed: () => void) {
    try { this.config = readProxyConfig(root); }
    catch { this.config = { revision: "", profiles: [], installations: {}, bindings: {} }; this.error = "模型代理配置无法读取；原文件未覆盖。"; }
    this.publishRuntime();
  }
  async initialize() {
    if (this.closed || this.error) return;
    if (this.pending || this.mutation) throw new AppError("BUSY", "模型代理正在准备。");
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.pending = Promise.resolve().then(async () => {
      for (const profile of this.config.profiles as Profile[]) {
        if (signal.aborted || this.closed) break;
        if (profile.enabled) try { await this.start(profile, signal); } catch { /* The failed entry stays unavailable. */ }
      }
    }).finally(() => { this.pending = undefined; this.changed(); });
    await this.pending;
  }
  snapshot(): ModelProxyState {
    return { revision: this.config.revision, platform: `${process.platform}/${process.arch}`, supported: !!proxyAsset("xray", "0.0.0"),
      installations: structuredClone(this.config.installations), latest: Object.fromEntries([...this.releases].map(([kernel, release]) => [kernel, release.version])),
      profiles: this.config.profiles.map(({ id, name, kernel, node }) => { const endpoint = this.processes.get(id)?.endpoint; return { id, name, kernel, node, status: endpoint?.status ?? "stopped", message: endpoint?.message }; }),
      bindings: { ...this.config.bindings }, job: this.job && { ...this.job }, inspection: this.inspection && structuredClone(this.inspection), error: this.error };
  }
  private publishRuntime() {
    atomicProxyJson(proxyRuntimePath(this.root), Object.fromEntries([...this.processes].map(([id, process]) => [id, process.endpoint])));
  }
  private notify = () => { this.publishRuntime(); this.changed(); };
  private save(next: ProxyConfig) {
    const value = { ...next, revision: randomUUID() };
    atomicProxyJson(proxyConfigPath(this.root), value);
    this.config = value; this.changed();
  }
  private async start(profile: Profile, signal: AbortSignal) {
    const install = this.config.installations[profile.kernel];
    if (!install) throw new AppError("NOT_INSTALLED", "请先安装此线路需要的内核。");
    await this.processes.get(profile.id)?.stop();
    signal.throwIfAborted();
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    const process = new ProxyProcess(this.root, profile, this.notify);
    this.processes.set(profile.id, process); this.notify();
    await process.start(install, signal);
  }
  async command(c: Command): Promise<ModelProxyState> {
    if (c.workspaceId || c.sessionId) throw new AppError("INVALID_SCOPE", "模型代理使用应用级配置。");
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    if (c.op === "modelProxy.get") return this.snapshot();
    if (c.op === "modelProxy.cancel") {
      if (c.params?.jobId && c.params.jobId !== this.job?.id) throw new AppError("REVISION_CONFLICT", "当前操作已改变。");
      this.controller?.abort(); await this.pending; return this.snapshot();
    }
    if (this.pending || this.mutation) throw new AppError("BUSY", "请等待当前模型代理操作完成。");
    const operation = Promise.resolve().then(() => this.execute(c));
    this.mutation = operation;
    try { return await operation; } finally { if (this.mutation === operation) this.mutation = undefined; }
  }
  private async execute(c: Command): Promise<ModelProxyState> {
    if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
    const p = c.params ?? {};
    if (c.op === "modelProxy.get") return this.snapshot();
    if (c.op === "modelProxy.cancel") { this.controller?.abort(); await this.pending; return this.snapshot(); }
    if (this.pending) throw new AppError("BUSY", "请等待当前模型代理操作完成。");
    if (this.error) throw new AppError("CONFIG_READ_FAILED", this.error);
    if (["modelProxy.save", "modelProxy.remove", "modelProxy.start", "modelProxy.stop"].includes(c.op) && p.revision !== this.config.revision)
      throw new AppError("REVISION_CONFLICT", "代理配置已改变，请重新读取后操作。");
    if (c.op === "modelProxy.save") {
      const existing = this.config.profiles.find(item => item.id === p.id);
      if (p.id && !existing) throw new AppError("NOT_FOUND", "线路已不存在。");
      if (p.kernel !== "xray" && p.kernel !== "mihomo") throw new AppError("INVALID_INPUT", "请选择内核。");
      const supplied = typeof p.source === "string" ? p.source.trim() : "";
      if (!supplied && existing && existing.kernel !== p.kernel) throw new AppError("INVALID_INPUT", "切换运行内核后，请重新填写并识别线路配置。");
      let source = supplied || existing?.source;
      if (!source || Buffer.byteLength(source, "utf8") > proxySourceLimit) throw new AppError("INVALID_INPUT", "请填写线路配置，最多 2 MB（UTF-8）。");
      let node = typeof p.node === "string" ? p.node.slice(0, 300) : "";
      if (p.kernel === "xray") {
        if (p.inspectionId !== undefined) {
          const inspected = this.xrayInspection;
          if (!inspected || inspected.id !== p.inspectionId || inspected.source !== supplied || !inspected.outbounds.has(node))
            throw new AppError("INSPECTION_REQUIRED", "识别结果已失效或输入已改变，请重新识别并选择节点。");
          source = inspected.outbounds.get(node)!;
        } else node = supplied ? "" : existing?.node ?? "";
      }
      const profile: Profile = { id: existing?.id ?? randomUUID(), name: text(p.name, "线路名称", 80), kernel: p.kernel,
        node, source, enabled: false };
      try { coreConfiguration(profile, 12345, "validation", "/provider.yaml"); }
      catch { throw new AppError("INVALID_INPUT", profile.kernel === "mihomo"
        ? "请填写节点名称和有效的分享链接、订阅地址或 Clash 配置。"
        : "分享链接请先识别并选择节点；高级配置需填写可独立使用的 Xray outbound JSON，不支持直连、拒绝或回环出口。"); }
      await this.processes.get(profile.id)?.stop();
      this.processes.delete(profile.id);
      if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
      this.save({ ...this.config, profiles: [...this.config.profiles.filter(item => item.id !== profile.id), profile] });
      this.clearInspection(); this.notify(); return this.snapshot();
    }
    if (c.op === "modelProxy.remove" || c.op === "modelProxy.stop") {
      const profile = this.config.profiles.find(item => item.id === p.id) as Profile | undefined;
      if (!profile) throw new AppError("NOT_FOUND", "线路已不存在。");
      await this.processes.get(profile.id)?.stop();
      if (this.closed) throw new AppError("CLOSING", "服务正在退出。");
      const removing = c.op === "modelProxy.remove";
      if (removing) this.processes.delete(profile.id);
      this.save({ ...this.config,
        profiles: removing ? this.config.profiles.filter(item => item.id !== profile.id) : this.config.profiles.map(item => item.id === profile.id ? { ...item, enabled: false } : item),
        bindings: removing ? Object.fromEntries(Object.entries(this.config.bindings).filter(([, id]) => id !== profile.id)) : this.config.bindings });
      this.notify(); return this.snapshot();
    }
    if (!["modelProxy.start", "modelProxy.check", "modelProxy.install", "modelProxy.inspect"].includes(c.op)) throw new AppError("UNKNOWN_OPERATION", "不支持此代理操作。");
    const inspecting = c.op === "modelProxy.inspect";
    const kernel = (inspecting ? p.kernel ?? "mihomo" : p.kernel) as ProxyKernel;
    const source = inspecting && typeof p.source === "string" ? p.source.trim() : "";
    if (inspecting) {
      if (kernel !== "xray" && kernel !== "mihomo") throw new AppError("INVALID_INPUT", "请选择内核。");
      if (!source || Buffer.byteLength(source, "utf8") > proxySourceLimit) throw new AppError("INVALID_INPUT", "请粘贴分享链接、订阅地址或配置内容，最多 2 MB（UTF-8）。");
      if (kernel === "mihomo") {
        if (!this.config.installations.mihomo) throw new AppError("NOT_INSTALLED", "请先安装 mihomo，再识别分享链接或订阅中的节点。");
        try { coreConfiguration({ id: "import", name: "import", node: "unselected", kernel, source }, 0, "validation", "/provider.yaml"); }
        catch { throw new AppError("INVALID_INPUT", "请检查订阅地址；不支持在地址中内嵌账号密码。"); }
      }
      this.clearInspection();
    }
    const profile = this.config.profiles.find(item => item.id === p.id) as Profile | undefined;
    if (c.op === "modelProxy.start" && !profile) throw new AppError("NOT_FOUND", "线路已不存在。");
    if (c.op !== "modelProxy.start" && kernel !== "xray" && kernel !== "mihomo") throw new AppError("INVALID_INPUT", "请选择内核。");
    const release = this.releases.get(kernel);
    if (c.op === "modelProxy.install" && (!release || release.version !== p.version)) throw new AppError("CHECK_REQUIRED", "请先检查更新，再安装已确认版本。");
    if (c.op === "modelProxy.install" && this.config.installations[kernel]?.version === release!.version) return this.snapshot();
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.job = { id: c.requestId, running: true, message: inspecting ? "正在识别节点…" : c.op === "modelProxy.start" ? "正在启动线路…" : c.op === "modelProxy.check" ? "正在检查官方版本…" : "正在下载并校验内核…" };
    this.changed();
    this.pending = Promise.resolve().then(async () => {
      let prepared: { directory: string; version: string } | undefined, skipped = 0;
      try {
        if (inspecting) {
          if (kernel === "xray") {
            const result = await inspectXraySource(this.root, source, signal, message => { this.job!.message = message; this.changed(); });
            signal.throwIfAborted();
            this.inspection = { id: this.job!.id, kernel, nodes: result.nodes }; skipped = result.skipped;
            this.xrayInspection = { id: this.job!.id, source, outbounds: result.outbounds };
            this.inspectionTimer = setTimeout(() => { this.clearInspection(); this.changed(); }, 10 * 60_000);
            this.inspectionTimer.unref();
          } else {
            const nodes = await inspectProxySource(this.root, this.config.installations.mihomo!, source, signal);
            signal.throwIfAborted(); this.inspection = { id: this.job!.id, ...(p.kernel ? { kernel } : {}), nodes };
          }
        } else if (c.op === "modelProxy.check") this.releases.set(kernel, await latestProxyRelease(kernel, signal));
        else if (c.op === "modelProxy.install") {
          prepared = await installProxyKernel(this.root, release!, signal); signal.throwIfAborted();
          this.save({ ...this.config, installations: { ...this.config.installations, [kernel]: prepared } }); prepared = undefined;
        } else {
          await this.start(profile!, signal); signal.throwIfAborted();
          this.save({ ...this.config, profiles: this.config.profiles.map(item => item.id === profile!.id ? { ...item, enabled: true } : item) });
        }
        this.job!.message = inspecting ? `已识别 ${this.inspection!.nodes.length} 个节点，请选择并保存线路。${skipped ? `已跳过 ${skipped} 项无效、重复或不支持的内容。` : ""}`
          : c.op === "modelProxy.start" ? "本地代理入口已启动；远端连接以实际模型请求为准。" : c.op === "modelProxy.install" ? "内核安装与自检完成；重新启动线路后使用新版本。" : "官方版本检查完成。";
      } catch (error) {
        this.job!.message = signal.aborted ? "操作已取消。" : "操作未完成。";
        if (!signal.aborted) this.job!.error = error instanceof Error ? error.message : "模型代理操作失败。";
      } finally {
        if (prepared) rmSync(join(proxyDirectory(this.root), "versions", prepared.directory), { recursive: true, force: true });
        this.job!.running = false; this.pending = undefined; this.changed();
      }
    });
    return this.snapshot();
  }
  async close() {
    this.closed = true; this.controller?.abort(); this.clearInspection();
    await this.mutation?.catch(() => {}); await this.pending;
    await Promise.allSettled([...this.processes.values()].map(process => process.stop())); this.processes.clear(); this.publishRuntime();
  }
}
