import { fork, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { ProxyInstallation, ProxyNode } from "../../shared/model-proxy.js";
import { atomicProxyJson, proxyDirectory, proxyExecutable } from "./model-proxy-config.js";
import { toolEnvironment } from "./model-proxy-env.js";
import { coreConfiguration, reserveProxyPort } from "./model-proxy-process.js";

function providerNodes(port: number, token: string, signal: AbortSignal): Promise<ProxyNode[]> {
  return new Promise((resolve, reject) => {
    // node:http connects directly to this loopback controller, regardless of host proxy settings.
    const req = request({ host: "127.0.0.1", port, path: "/providers/proxies/source", signal,
      headers: { Authorization: `Bearer ${token}` } }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) response.destroy(Error("节点列表过大。")); else chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) throw Error("节点尚未就绪。");
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(data.proxies)) throw Error("节点列表无效。");
          const nodes: ProxyNode[] = [];
          for (const proxy of data.proxies) {
            if (typeof proxy.name !== "string" || !proxy.name.trim() || proxy.name.length > 300 ||
              typeof proxy.type !== "string" || /^(direct|compatible|pass)$/i.test(proxy.type)) continue;
            if (!nodes.some(node => node.name === proxy.name)) nodes.push({ name: proxy.name, type: proxy.type });
          }
          if (nodes.length > 2000) throw Error("节点列表过大。");
          resolve(nodes);
        } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.setTimeout(1000, () => req.destroy(Error("读取节点超时。")));
    req.end();
  });
}

/** Let the installed core parse its own formats; never translate URI protocols in Axiom. */
export async function inspectProxySource(root: string, installation: ProxyInstallation, source: string, signal: AbortSignal): Promise<ProxyNode[]> {
  const directory = join(proxyDirectory(root), "imports", randomUUID());
  let child: ChildProcess | undefined, closed: Promise<void> | undefined, exited = false;
  try {
    signal.throwIfAborted();
    const port = await reserveProxyPort(), token = randomBytes(32).toString("hex");
    signal.throwIfAborted();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const sourcePath = join(directory, "provider.yaml"), config = join(directory, "config.json");
    const value = coreConfiguration({ id: "import", name: "import", kernel: "mihomo", node: "unselected", source }, 0, token, sourcePath);
    if (!/^https?:\/\//.test(source)) writeFileSync(sourcePath, source, { mode: 0o600 });
    atomicProxyJson(config, { ...value, "external-controller": `127.0.0.1:${port}`, secret: token });
    const ts = import.meta.url.endsWith(".ts");
    child = fork(fileURLToPath(new URL(`./model-proxy-supervisor.${ts ? "ts" : "js"}`, import.meta.url)), [],
      { execArgv: ts ? ["--import", import.meta.resolve("tsx")] : [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
    closed = new Promise(resolve => {
      const done = () => { exited = true; resolve(); };
      child!.once("exit", done); child!.once("error", () => { if (!child!.pid) done(); });
    });
    child.send({ type: "start", executable: proxyExecutable(root, "mihomo", installation),
      args: ["-d", directory, "-f", config], cwd: directory, env: toolEnvironment(process.env) }, error => {
      if (error) child?.kill("SIGTERM");
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !exited) {
      signal.throwIfAborted();
      const nodes = await providerNodes(port, token, signal).catch(() => []);
      signal.throwIfAborted();
      if (nodes.length) return nodes;
      await delay(150, undefined, { signal });
    }
    throw Error("无法识别节点。请检查链接或订阅内容、网络连接及 mihomo 版本。");
  } catch {
    // Neither core logs nor JSON parse errors may expose credentials or subscription tokens.
    throw Error(signal.aborted ? "节点识别已取消。" : "无法识别节点。请检查链接或订阅内容、网络连接及 mihomo 版本。");
  } finally {
    if (child && !exited) {
      if (child.connected) child.send({ type: "stop" }, error => { if (error) child?.kill("SIGTERM"); });
      else child.kill("SIGTERM");
      const force = setTimeout(() => child?.kill("SIGKILL"), 5000);
      try { await closed; } finally { clearTimeout(force); }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
