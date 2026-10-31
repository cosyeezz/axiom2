import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import { HttpsProxyAgent } from "https-proxy-agent";
import { codeBuddyOrigin } from "./identity.js";

/** Explicit local transport policy; no global dispatcher/CA mutation or fallback after a bad proxy. */
export function codeBuddyProxy(url: URL, env: NodeJS.ProcessEnv = process.env): URL | undefined {
  const host = url.hostname.toLowerCase(), port = url.port || (url.protocol === "https:" ? "443" : "80");
  for (let entry of (env.no_proxy || env.NO_PROXY || "").toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (entry === "*") return undefined;
    const match = entry.match(/^(.+):(\d+)$/);
    if (match) { if (match[2] !== port) continue; entry = match[1]; }
    if (entry.startsWith("*")) entry = entry.slice(1);
    if (entry.startsWith(".") ? host.endsWith(entry) : host === entry) return undefined;
  }
  const value = (url.protocol === "https:" ? env.https_proxy || env.HTTPS_PROXY : env.http_proxy || env.HTTP_PROXY) || env.all_proxy || env.ALL_PROXY;
  if (!value) return undefined;
  try {
    const proxy = new URL(value);
    if (!["http:", "https:"].includes(proxy.protocol) || !proxy.hostname || proxy.pathname !== "/" || proxy.search || proxy.hash) throw Error();
    return proxy;
  } catch { throw new Error("CodeBuddy 代理配置无效；未降级为直连。"); }
}

/** Low-level node:http(s) sender, also usable with loopback fixtures; production entry validates CN below. */
export function codeBuddyNativeHttp(url: URL, headers: Headers, body: string, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  signal.throwIfAborted();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("CodeBuddy HTTP 目标无效。");
  const proxy = codeBuddyProxy(url, env);
  const agent = proxy ? new HttpsProxyAgent(proxy, { negotiate: false }) : undefined;
  const wire = Object.fromEntries(headers); wire["content-length"] = String(Buffer.byteLength(body));
  // No redirect, auto retry or shared pool. Official CLI pooling is unverified: this is a bounded local policy.
  return new Promise((resolve, reject) => {
    try {
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method: "POST", headers: wire, agent: agent ?? false, signal, maxHeaderSize: 16 * 1024,
      }, response => {
        response.once("close", () => agent?.destroy());
        try {
          const status = response.statusCode ?? 0;
          if (status < 200 || status > 599) throw Error();
          const resultHeaders = new Headers();
          for (let i = 0; i < response.rawHeaders.length; i += 2) resultHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          const empty = [204, 205, 304].includes(status);
          const stream = empty ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>;
          if (empty) response.resume();
          resolve(new Response(stream, { status, headers: resultHeaders }));
        } catch { response.destroy(); agent?.destroy(); reject(new Error("CodeBuddy HTTP 响应无效。")); }
      });
      request.once("error", () => { agent?.destroy(); reject(new Error("CodeBuddy HTTP 连接失败。")); });
      request.end(body);
    } catch { agent?.destroy(); reject(new Error("CodeBuddy HTTP 请求失败。")); }
  });
}

/** Production fetch-shaped transport. Kept stable for the SDK observer's native-sender identity binding. */
export const codeBuddyNativeFetch: typeof fetch = async (input, init) => {
  let target: URL;
  try { target = new URL(typeof input === "string" || input instanceof URL ? input : input.url); }
  catch { throw new Error("CodeBuddy 请求目标无效。"); }
  if (target.origin !== codeBuddyOrigin || target.pathname !== "/v2/chat/completions" || target.search || target.hash || target.username || target.password ||
      init?.method !== "POST" || typeof init.body !== "string" || Buffer.byteLength(init.body) > 10 * 1024 * 1024)
    throw new Error("CodeBuddy 请求目标或正文无效。");
  return codeBuddyNativeHttp(target, new Headers(init.headers), init.body, init.signal ?? new AbortController().signal);
};
