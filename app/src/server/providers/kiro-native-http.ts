import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import { HttpsProxyAgent } from "https-proxy-agent";
import { KiroChatError } from "./kiro-native-protocol.js";

/** Scheme-specific proxy + NO_PROXY; only the caller's environment, never Pi or a global rebind. */
export function kiroNativeProxy(url: URL, env: NodeJS.ProcessEnv = process.env) {
  const host = url.hostname.toLowerCase(), port = url.port || (url.protocol === "https:" ? "443" : "80");
  const noProxy = (env.no_proxy || env.NO_PROXY || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  for (let entry of noProxy) {
    if (entry === "*") return undefined;
    const match = entry.match(/^(.+):(\d+)$/);
    if (match) { if (match[2] !== port) continue; entry = match[1]; }
    if (entry.startsWith("*")) entry = entry.slice(1);
    if (entry.startsWith(".") ? host.endsWith(entry) : host === entry) return undefined;
  }
  const proxy = (url.protocol === "https:" ? env.https_proxy || env.HTTPS_PROXY : env.http_proxy || env.HTTP_PROXY) || env.all_proxy || env.ALL_PROXY;
  if (!proxy) return undefined;
  try {
    const parsed = new URL(proxy);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname !== "/" || parsed.search || parsed.hash) throw Error();
    return parsed;
  } catch { throw new KiroChatError("Kiro 代理配置无效；未降级为直连。"); }
}

/** KAS Responses uses node:http(s). Avoid fetch's added Accept/language/encoding/sec-fetch headers. */
export function kiroNativeHttp(url: string, init: { headers: Headers; body: string }, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  signal.throwIfAborted();
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
    throw new KiroChatError("Kiro 原生 HTTP 地址无效。");
  const proxy = kiroNativeProxy(target, env);
  // A separate agent owns each proxied request; no global CA/proxy/dispatcher mutation.
  // CONNECT may authenticate only using the explicit proxy URL, not ambient OS credentials.
  const agent = proxy ? new HttpsProxyAgent(proxy, { negotiate: false }) : undefined;
  const headers = Object.fromEntries(init.headers);
  headers["content-length"] = String(Buffer.byteLength(init.body));
  return new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? https : http).request(target, { method: "POST", headers, agent, signal }, response => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 599) { response.destroy(); agent?.destroy(); reject(new KiroChatError("Kiro HTTP 响应状态无效。")); return; }
      const responseHeaders = new Headers();
      for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
      response.once("close", () => agent?.destroy());
      try {
        const empty = status === 204 || status === 205 || status === 304;
        const body = empty ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>;
        if (empty) response.resume();
        resolve(new Response(body, { status, headers: responseHeaders }));
      } catch { response.destroy(); agent?.destroy(); reject(new KiroChatError("Kiro HTTP 响应格式无效。")); }
    });
    request.once("error", error => { agent?.destroy(); reject(error); });
    // Deliberately no redirect or model-request retry.
    request.end(init.body);
  });
}
