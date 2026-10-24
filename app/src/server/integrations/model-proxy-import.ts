import { MaintenanceError } from "../../shared/maintenance.js";
import { readProxyShareSource } from "./model-proxy-share-source.js";
import { currentMaintenance, maintenancePhase } from "../maintenance.js";
import { ProxyGuardian } from "./model-proxy-guardian.js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ProxyInstallation, ProxyNode } from "../../shared/model-proxy.js";
import { atomicProxyJson, proxyDirectory, proxyExecutable } from "./model-proxy-config.js";
import { toolEnvironment } from "./model-proxy-env.js";
import { coreConfiguration, reserveProxyPort } from "./model-proxy-process.js";
import { assertProxyCanStart } from "./model-proxy-removal.js";

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
  const execution = currentMaintenance();
  signal = execution ? AbortSignal.any([signal, execution.signal]) : signal;
  const directory = join(proxyDirectory(root), "runs", randomUUID());
  let guardian: ProxyGuardian | undefined, exited = false;
  try {
    signal.throwIfAborted();
    source = await readProxyShareSource(source.trim(), signal);
    maintenancePhase("validating", "正在使用本机内核验证订阅节点…");
    const port = await reserveProxyPort(), token = randomBytes(32).toString("hex");
    signal.throwIfAborted();
    await assertProxyCanStart(root, "mihomo");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const sourcePath = join(directory, "provider.yaml"), config = join(directory, "config.json");
    const value = coreConfiguration({ id: "import", name: "import", kernel: "mihomo", node: "unselected", source }, 0, token, sourcePath);
    writeFileSync(sourcePath, source, { mode: 0o600 });
    atomicProxyJson(config, { ...value, "external-controller": `127.0.0.1:${port}`, secret: token });
    const owner = join(directory, "owner.json");
    atomicProxyJson(owner, { kernel: "mihomo", directory: installation.directory });
    const started = Date.now();
    guardian = new ProxyGuardian(owner, () => execution?.remainingBudget() ?? { remainingMs: 30_000 - (Date.now() - started), code: "total-timeout" }, signal);
    void guardian.closed.then(() => { exited = true; });
    await guardian.start({ executable: proxyExecutable(root, "mihomo", installation),
      args: ["-d", directory, "-f", config], cwd: directory, env: toolEnvironment(process.env) });
    const deadline = execution ? Infinity : Date.now() + 30_000;
    while (Date.now() < deadline && !exited) {
      signal.throwIfAborted();
      const nodes = await providerNodes(port, token, signal).catch(() => []);
      signal.throwIfAborted();
      if (nodes.length) return nodes;
      await delay(150, undefined, { signal });
    }
    throw Error("无法识别节点。请检查链接或订阅内容、网络连接及 mihomo 版本。");
  } catch (error) {
    if (signal.aborted && signal.reason instanceof MaintenanceError) throw signal.reason;
    if (error instanceof MaintenanceError) throw error;
    // Neither core logs nor JSON parse errors may expose credentials or subscription tokens.
    throw Error(signal.aborted ? "节点识别已取消。" : "无法识别节点。请检查链接或订阅内容、网络连接及 mihomo 版本。");
  } finally {
    // Preserve owner/configuration if the real kernel close was not acknowledged.
    await guardian?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}
