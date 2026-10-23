import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { Agent, EnvHttpProxyAgent, install, setGlobalDispatcher } from "undici";
import { AppError } from "../../shared/protocol.js";
import type { ProviderProxy } from "../../shared/models.js";
import { proxyRuntimePath, readProxyConfig } from "./model-proxy-config.js";

const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
const originalProxyEnvironment = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
// This module is loaded before a worker configures its model network.
export function toolEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of proxyKeys) { delete clean[key]; if (originalProxyEnvironment[key] !== undefined) clean[key] = originalProxyEnvironment[key]; }
  return clean;
}
export function parseProviderProxy(value: unknown, previous?: ProviderProxy): ProviderProxy {
  if (value === undefined) return previous ?? { mode: "direct" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("INVALID_CONFIG", "模型代理设置无效。");
  const p = value as Record<string, unknown>;
  if (p.mode === "direct") return { mode: "direct" };
  if (p.mode === "builtin" && typeof p.profileId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.profileId)) return { mode: "builtin", profileId: p.profileId };
  if (p.mode === "external") {
    if (p.keepUrl === true && previous?.mode === "external") return previous;
    try {
      if (typeof p.url !== "string" || p.url.length > 2048 || /[\s\0]/.test(p.url)) throw Error();
      const url = new URL(p.url);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.pathname !== "/" || url.search || url.hash) throw Error();
      return { mode: "external", url: url.href };
    } catch { throw new AppError("INVALID_CONFIG", "请填写 HTTP/HTTPS 代理入口，例如 http://127.0.0.1:7890；不支持路径或查询参数。"); }
  }
  throw new AppError("INVALID_CONFIG", "请选择直连、代理地址或内置代理线路。");
}
export function providerProxyView(value: unknown): ProviderProxy {
  const p = parseProviderProxy(value);
  if (p.mode === "external") {
    const url = new URL(p.url);
    if (url.username || url.password) return { mode: "external", url: "", keepUrl: true };
  }
  return p;
}
export function providerProxyUrl(root: string, value: unknown): string | undefined {
  const p = parseProviderProxy(value);
  if (p.mode === "direct") return;
  if (p.mode === "external") return p.url;
  if (!readProxyConfig(root).profiles.some(profile => profile.id === p.profileId)) throw new AppError("PROXY_UNAVAILABLE", "所选内置代理线路已不存在，请重新选择。");
  let endpoint: any;
  try { endpoint = JSON.parse(readFileSync(proxyRuntimePath(root), "utf8"))[p.profileId]; } catch { /* Fail closed below. */ }
  if (endpoint?.status !== "running" || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== "string" || !endpoint.token)
    throw new AppError("PROXY_UNAVAILABLE", "所选内置代理尚未运行，请在内置工具中启动线路。请求未改为直连。");
  return `http://axiom:${encodeURIComponent(endpoint.token)}@127.0.0.1:${endpoint.port}`;
}
export function readProviderProxy(modelsFile: string, provider: string): ProviderProxy {
  try { const config = JSON.parse(readFileSync(modelsFile, "utf8")); return parseProviderProxy(config.providers?.[provider]?.axiomProxy); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: "direct" };
    if (error instanceof AppError) throw error;
    throw new AppError("CONFIG_READ_FAILED", "模型代理配置无法读取，请检查供应商配置文件；原文件未覆盖。");
  }
}
export function modelProxyRevision(root: string): string {
  try { return readFileSync(proxyRuntimePath(root), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}
function localModelHosts(modelsFile: string, provider: string): string[] {
  let definition: any;
  try { definition = JSON.parse(readFileSync(modelsFile, "utf8")).providers?.[provider]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const urls = [definition?.baseUrl, ...Object.values(definition?.modelOverrides ?? {}).map((m: any) => m?.baseUrl), ...(definition?.models ?? []).map((m: any) => m?.baseUrl)];
  return urls.flatMap(value => {
    try {
      const host = new URL(value).hostname, ip = host.replace(/^\[|\]$/g, "");
      const parts = ip.split(".").map(Number);
      const local = isIP(ip) === 4 ? parts[0] === 127 || parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 169 && parts[1] === 254
        : isIP(ip) === 6 && (ip === "::1" || /^(fc|fd|fe[89ab])/i.test(ip));
      return local ? [host] : [];
    } catch { return []; }
  });
}
let configured: string | undefined;
/** A worker owns a single provider network for its entire lifetime. */
export function configureModelNetwork(root: string, modelsFile: string, provider: string) {
  const url = providerProxyUrl(root, readProviderProxy(modelsFile, provider));
  const noProxy = ["localhost", ".localhost", ".local", "127.0.0.1", "[::1]", "::1", ...localModelHosts(modelsFile, provider)].join(",");
  const key = JSON.stringify([url ?? "direct", noProxy]);
  if (configured === key) return;
  if (configured !== undefined) throw Error("模型代理环境已改变，需要重新创建执行进程。");
  for (const name of proxyKeys) delete process.env[name];
  if (url) {
    process.env.HTTP_PROXY = process.env.http_proxy = url;
    process.env.HTTPS_PROXY = process.env.https_proxy = url;
    // EnvHttpProxyAgent accepts exact hosts and domain suffixes, not CIDRs.
    // Private configured model endpoints bypass the entry; the built-in core also routes private addresses directly.
    process.env.NO_PROXY = process.env.no_proxy = noProxy;
  }
  setGlobalDispatcher(url ? new EnvHttpProxyAgent() : new Agent());
  install();
  configured = key;
}
export const defaultModelsPath = (root: string) => join(process.env.AXIOM_PI_DIR || join(root, "pi"), "models.json");
