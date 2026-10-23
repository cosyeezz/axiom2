import { fork, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { ProxyInstallation } from "../../shared/model-proxy.js";
import { atomicProxyJson, proxyDirectory, proxyExecutable, type ProxyEndpoint, type StoredProxyProfile } from "./model-proxy-config.js";
import { runRtk } from "./rtk-process.js";
import { toolEnvironment } from "./model-proxy-env.js";

const privateIps = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10"];
export function coreConfiguration(profile: StoredProxyProfile, port: number, token: string, sourcePath: string) {
  if (profile.kernel === "xray") {
    let outbound: any;
    try { outbound = JSON.parse(profile.source); } catch { throw Error("Xray 线路需要一个原生 outbound JSON 对象。"); }
    if (!outbound || typeof outbound !== "object" || Array.isArray(outbound) || typeof outbound.protocol !== "string" || ["freedom", "blackhole", "loopback"].includes(outbound.protocol.toLowerCase()) || outbound.proxySettings || outbound.streamSettings?.sockopt?.dialerProxy)
      throw Error("请提供独立的 Xray 代理 outbound，不要包含 DIRECT、阻断或其他出站引用。");
    return { log: { loglevel: "none" },
      inbounds: [{ listen: "127.0.0.1", port, protocol: "http", settings: { accounts: [{ user: "axiom", pass: token }] }, tag: "models" }],
      outbounds: [{ ...outbound, tag: "selected" }, { protocol: "freedom", tag: "direct" }],
      routing: { domainStrategy: "IPOnDemand", rules: [
        { type: "field", domain: ["full:localhost", "domain:localhost", "domain:local"], outboundTag: "direct" },
        { type: "field", ip: privateIps, outboundTag: "direct" },
        { type: "field", inboundTag: ["models"], outboundTag: "selected" },
      ] } };
  }
  if (!profile.node.trim()) throw Error("请填写 mihomo 配置中的节点名称。");
  const remote = /^https?:\/\//.test(profile.source.trim());
  if (remote) { const url = new URL(profile.source.trim()); if (url.username || url.password) throw Error("订阅地址不支持内嵌账号密码。"); }
  return { "mixed-port": port, "bind-address": "127.0.0.1", "allow-lan": false, authentication: [`axiom:${token}`], "skip-auth-prefixes": [],
    mode: "rule", "log-level": "silent", ipv6: true, "external-controller": "", "external-controller-unix": "", "external-controller-pipe": "",
    tun: { enable: false }, dns: { enable: false }, profile: { "store-selected": false, "store-fake-ip": false },
    "proxy-providers": { source: { "exclude-type": "direct|compatible|pass", "health-check": { enable: false },
      override: { "proxy-name": [{ pattern: "^$", target: "未命名节点" }] },
      ...(remote ? { type: "http", url: profile.source.trim(), path: sourcePath, interval: 3600, proxy: "DIRECT" }
      : { type: "file", path: sourcePath }) } },
    "proxy-groups": [{ name: "selected", type: "select", use: ["source"], filter: `^${profile.node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "empty-fallback": "REJECT" }],
    rules: ["DOMAIN,localhost,DIRECT", "DOMAIN-SUFFIX,localhost,DIRECT", "DOMAIN-SUFFIX,local,DIRECT",
      ...privateIps.map(ip => `${ip.includes(":") ? "IP-CIDR6" : "IP-CIDR"},${ip},DIRECT`), "MATCH,selected"] };
}
export async function reserveProxyPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function listening(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (ready: boolean) => { socket.destroy(); resolve(ready); };
    socket.setTimeout(150, () => done(false)); socket.once("error", () => done(false)); socket.once("connect", () => done(true));
  });
}
export class ProxyProcess {
  readonly endpoint: ProxyEndpoint = { status: "starting", generation: randomUUID() };
  private child?: ChildProcess;
  private stopping = false;
  private stopped?: Promise<void>;
  private closed?: Promise<void>;
  private directory: string;
  constructor(readonly root: string, readonly profile: StoredProxyProfile, private changed: () => void) {
    this.directory = join(proxyDirectory(root), "runs", this.endpoint.generation);
  }
  async start(installation: ProxyInstallation, signal: AbortSignal) {
    try {
      const port = await reserveProxyPort(), token = randomBytes(32).toString("hex");
      signal.throwIfAborted();
      if (this.stopping) throw Error("线路启动已取消。");
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const source = join(this.directory, "provider.yaml"), config = join(this.directory, "config.json");
      const value = coreConfiguration(this.profile, port, token, source);
      if (this.profile.kernel === "mihomo" && !/^https?:\/\//.test(this.profile.source.trim())) writeFileSync(source, this.profile.source, { mode: 0o600 });
      atomicProxyJson(config, value);
      const executable = proxyExecutable(this.root, this.profile.kernel, installation);
      const args = this.profile.kernel === "xray" ? ["run", "-config", config] : ["-d", this.directory, "-f", config];
      // Never publish raw core diagnostics: they may echo the supplied node credentials.
      try { await runRtk(executable, this.profile.kernel === "xray" ? ["run", "-test", "-config", config] : ["-t", ...args], { root: this.root, signal, timeout: 10_000 }); }
      catch { throw Error("内核配置校验失败，请检查原生线路格式和节点参数。"); }
      signal.throwIfAborted();
      if (this.stopping) throw Error("线路启动已取消。");
      const ts = import.meta.url.endsWith(".ts");
      const child = this.child = fork(fileURLToPath(new URL(`./model-proxy-supervisor.${ts ? "ts" : "js"}`, import.meta.url)), [],
        { execArgv: ts ? ["--import", import.meta.resolve("tsx")] : [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
      this.closed = new Promise(resolve => {
        const exited = () => {
          if (!this.stopping) {
            this.endpoint.status = "error"; delete this.endpoint.port; delete this.endpoint.token;
            this.endpoint.message = "代理内核已退出，请检查线路后重新启动。";
            this.changed();
          }
          resolve();
        };
        child.once("exit", exited);
        child.once("error", () => { if (!child.pid) exited(); });
      });
      child.send({ type: "start", executable, args, cwd: this.directory, env: toolEnvironment(process.env) }, error => {
        if (error) child.kill("SIGTERM");
      });
      const abort = () => { void this.stop(); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline && this.endpoint.status === "starting") {
          signal.throwIfAborted();
          if (await listening(port)) {
            signal.throwIfAborted();
            if (this.stopping || this.endpoint.status !== "starting") throw Error("线路启动已取消。");
            // Provider cache files inherit the private directory; tighten existing ones too.
            try { if (process.platform !== "win32") chmodSync(source, 0o600); } catch { /* Remote subscription may not yet be downloaded. */ }
            Object.assign(this.endpoint, { port, token, status: "running" }); this.changed(); return;
          }
          await delay(100, undefined, { signal });
        }
        throw Error("代理入口未能就绪，请检查内核和线路配置。");
      } finally { signal.removeEventListener("abort", abort); }
    } catch (error) {
      await this.stop();
      rmSync(this.directory, { recursive: true, force: true });
      this.endpoint.status = "error"; this.endpoint.message = error instanceof Error ? error.message : "启动失败。";
      this.changed(); throw error;
    }
  }
  stop(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.stopping = true;
    this.endpoint.status = "stopped"; delete this.endpoint.port; delete this.endpoint.token;
    this.changed();
    this.stopped = (async () => {
      const child = this.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        // The supervisor owns core cleanup. Keep IPC open until it exits.
        if (child.connected) child.send({ type: "stop" }, error => { if (error) child.kill("SIGTERM"); });
        else child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 5000);
        try { await this.closed; } finally { clearTimeout(force); }
      }
      rmSync(this.directory, { recursive: true, force: true });
    })();
    return this.stopped;
  }
}
