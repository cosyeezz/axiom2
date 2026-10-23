import { Agent, fetch } from "undici";
import { proxySourceLimit } from "../../shared/model-proxy.js";

/** Fetch only the subscription the user submitted; never send it to a conversion service. */
export async function readProxyShareSource(source: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!/^https?:\/\//i.test(source)) return source;
  const direct = new Agent();
  try {
    let url = new URL(source);
    const timed = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    for (let hop = 0; hop < 6; hop++) {
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        throw Error("订阅地址只支持 HTTP/HTTPS，且不能内嵌账号密码。");
      const response = await fetch(url, { dispatcher: direct, signal: timed, redirect: "manual", headers: { "User-Agent": "Axiom-Xray" } });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel(); url = new URL(location, url); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw Error(`订阅下载失败（HTTP ${response.status}）。`); }
      if (Number(response.headers.get("content-length")) > proxySourceLimit) {
        await response.body?.cancel(); throw Error("订阅内容超过 2 MB 限制。");
      }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > proxySourceLimit) throw Error("订阅内容超过 2 MB 限制。");
        chunks.push(Buffer.from(chunk));
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).trim();
    }
    throw Error("订阅重定向次数过多。");
  } catch (error) {
    // URL, fetch and decoder errors can include subscription credentials. Keep only our own fixed messages.
    const message = error instanceof Error ? error.message : "";
    if (/^(订阅地址只支持|订阅下载失败（HTTP \d+）|订阅内容超过|订阅重定向次数过多)/.test(message)) throw Error(message);
    throw Error(signal.aborted ? "节点识别已取消。" : "订阅下载失败或超时，请检查地址和网络连接。");
  } finally { await direct.destroy(); }
}
