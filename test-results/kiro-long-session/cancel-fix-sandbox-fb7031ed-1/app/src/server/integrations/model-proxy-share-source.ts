import { maintainedFetch } from "../maintenance.js";
import { MaintenanceError } from "../../shared/maintenance.js";
import { Agent, fetch } from "undici";
import { proxySourceLimit } from "../../shared/model-proxy.js";

/** Fetch only the subscription the user submitted; never send it to a conversion service. */
export async function readProxyShareSource(source: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!/^https?:\/\//i.test(source)) return source;
  const direct = new Agent();
  try {
    let url = new URL(source);
    const timed = signal;
    for (let hop = 0; hop < 6; hop++) {
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw Error("订阅地址只支持 HTTP/HTTPS，且不能内嵌账号密码。");
      const response = await maintainedFetch(url.href, { signal: timed, redirect: "manual", headers: { "User-Agent": "Axiom-Xray" } }, ((input: string, init: RequestInit) => fetch(input, { ...init, dispatcher: direct } as Parameters<typeof fetch>[1])) as unknown as typeof globalThis.fetch);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel(); url = new URL(location, url); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new MaintenanceError("http", `订阅下载失败（HTTP ${response.status}）。`); }
      if (Number(response.headers.get("content-length")) > proxySourceLimit) {
        await response.body?.cancel(); throw Error("订阅内容超过 2 MB 限制。");
      }
      const chunks: Buffer[] = []; let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw Error("订阅下载未返回内容。");
      try { while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > proxySourceLimit) throw Error("订阅内容超过 2 MB 限制。");
        chunks.push(Buffer.from(value));
      } } finally { void reader.cancel().catch(() => {}); }
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).trim();
    }
    throw Error("订阅重定向次数过多。");
  } catch (error) {
    if (error instanceof MaintenanceError) {
      if (error.code === "network") throw new MaintenanceError("network", "订阅连接失败，请检查地址和网络后重试。");
      throw error;
    }
    // URL, fetch and decoder errors can include subscription credentials. Keep only our own fixed messages.
    const message = error instanceof Error ? error.message : "";
    if (/^(订阅地址只支持|订阅下载失败（HTTP \d+）|订阅内容超过|订阅重定向次数过多)/.test(message)) throw Error(message);
    throw Error(signal.aborted ? "节点识别已取消。" : "订阅下载失败或超时，请检查地址和网络连接。");
  } finally { await direct.destroy(); }
}
