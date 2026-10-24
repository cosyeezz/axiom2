import { currentMaintenance, maintenancePhase } from "../maintenance.js";
import { MaintenanceError } from "../../shared/maintenance.js";
import { proxySourceLimit, type ProxyNode } from "../../shared/model-proxy.js";
import { coreConfiguration } from "./model-proxy-process.js";
import { readProxyShareSource } from "./model-proxy-share-source.js";
import { prepareXrayImporter, xrayImporterDirectory } from "./model-proxy-xray-installer.js";
import { runRtk } from "./rtk-process.js";

export function shareSourceLines(source: string): string[] {
  let content = source.trim();
  // Decode only the subscription container; all protocol fields go untouched to the upstream CLI.
  if (!content.includes("://") && /^[A-Za-z0-9+/=_\s-]+$/.test(content)) {
    content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(content.replace(/\s/g, ""), "base64url")).trim();
  }
  if (Buffer.byteLength(content, "utf8") > proxySourceLimit) throw Error("订阅内容超过 2 MB 限制。");
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  if (!lines.length || lines.length > 2000) throw Error("每次可识别 1 至 2000 条分享链接。");
  return lines;
}
function displayName(link: string, index: number): string {
  // Display labels only. This never reconstructs a protocol, transport or security setting.
  let name = "";
  try {
    const fragment = link.indexOf("#");
    if (fragment >= 0) name = decodeURIComponent(link.slice(fragment + 1));
    else if (/^vmess:\/\//i.test(link)) {
      const value = JSON.parse(Buffer.from(link.slice(8), "base64url").toString("utf8"));
      if (typeof value.ps === "string") name = value.ps;
    }
  } catch { /* Missing or invalid display labels do not change the outbound. */ }
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 270) || `未命名节点 ${index + 1}`;
}
export type XrayImport = { nodes: ProxyNode[]; outbounds: Map<string, string>; skipped: number };
export async function inspectXraySource(root: string, source: string, signal: AbortSignal, progress: (message: string) => void): Promise<XrayImport> {
  const content = await readProxyShareSource(source, signal);
  let lines: string[];
  try { lines = shareSourceLines(content); }
  catch { throw Error("订阅内容无效、超过 2 MB 或超过 2000 条链接。请使用分享链接或 Base64 分享列表。"); }
  const seen = new Set<string>();
  const candidates = lines.filter(link => {
    if (!/^(vless|vmess|trojan|ss):\/\//i.test(link) || seen.has(link)) return false;
    seen.add(link); return true;
  });
  if (!candidates.length) throw Error("未找到支持的 Xray 分享链接。支持 VLESS、VMess、Trojan 和 Shadowsocks；Clash 配置请使用 mihomo。");
  const executable = await prepareXrayImporter(root, signal, progress);
  maintenancePhase("validating", "正在使用 Xray 转换器识别节点…");
  const timed = currentMaintenance() ? signal : AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const results = new Array<{ name: string; type: string; source: string } | undefined>(candidates.length);
  let next = 0, size = 0;
  async function worker() {
    while (next < candidates.length) {
      timed.throwIfAborted();
      const index = next++, link = candidates[index];
      let outbound: unknown;
      try {
        const result = JSON.parse((await runRtk(executable, ["parse", "-i", "--json"], {
          root: xrayImporterDirectory(root), input: `${link}\n`, signal: timed, timeout: 10_000, limit: proxySourceLimit,
        })).toString("utf8"));
        if (!Array.isArray(result.outbounds) || result.outbounds.length !== 1) continue;
        outbound = result.outbounds[0];
        const json = JSON.stringify(outbound);
        // Keep existing structural checks; the running Xray core still performs its full native -test.
        coreConfiguration({ id: "import", name: "import", kernel: "xray", node: "", source: json }, 0, "validation", "");
        if (Buffer.byteLength(json, "utf8") > proxySourceLimit) continue;
        results[index] = { name: displayName(link, index), type: String((outbound as { protocol: string }).protocol), source: json };
        size += Buffer.byteLength(json, "utf8");
      } catch (error) { if (error instanceof MaintenanceError) throw error; /* Upstream diagnostics may contain credentials; only report a skipped count. */ }
      timed.throwIfAborted();
      if (size > 4 * proxySourceLimit) throw Error("节点配置总量过大，请减少本次导入的链接。");
    }
  }
  // Wait for every subprocess to close, including on cancellation or a failed sibling worker.
  const settled = await Promise.allSettled([worker(), worker()]);
  const uncertain = settled.find(item => item.status === "rejected" && item.reason instanceof MaintenanceError && item.reason.code === "stop-unconfirmed");
  if (uncertain?.status === "rejected") throw uncertain.reason;
  if (timed.aborted) throw timed.reason;
  const failure = settled.find(item => item.status === "rejected");
  if (failure?.status === "rejected") {
    if (failure.reason instanceof MaintenanceError) throw failure.reason;
    throw Error("节点配置总量过大，请减少本次导入的链接。");
  }
  const nodes: ProxyNode[] = [], outbounds = new Map<string, string>();
  for (const result of results) {
    if (!result) continue;
    let name = result.name, suffix = 2;
    while (outbounds.has(name)) name = `${result.name} (${suffix++})`;
    nodes.push({ name, type: result.type }); outbounds.set(name, result.source);
  }
  if (!nodes.length) throw Error("无法识别 Xray 节点，请检查分享链接及其协议参数。");
  return { nodes, outbounds, skipped: lines.length - nodes.length };
}
