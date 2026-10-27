import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ProviderAuthInteraction } from "@earendil-works/pi-ai";

const ports = [3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153];
type Callback = { code: string; redirectUri: string };
class TerminalCallbackError extends Error {}

// Only a user-initiated social login owns this loopback listener. No callbacks
// are persisted; state and PKCE verifier remain in this worker until completion.
export async function kiroCallback(state: string, signal: AbortSignal, options: { ports?: readonly number[]; oidc?: boolean } = {}) {
  signal.throwIfAborted();
  const candidates = options.ports ?? (options.oidc ? [0] : ports);
  let origin = "", settled = false;
  let resolve!: (value: Callback) => void, reject!: (error: Error) => void;
  const result = new Promise<Callback>((yes, no) => { resolve = yes; reject = no; });
  // Cancellation can arrive before wait() is called.
  void result.catch(() => {});
  const parse = (value: string): Callback => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Kiro 回调 URL 无效。"); }
    if (value.length > 16000 || url.origin !== origin || url.username || url.password || url.hash ||
      !["/oauth/callback", "/signin/callback"].includes(url.pathname)) throw new Error("Kiro 回调地址不匹配。");
    for (const key of ["state", "code", "error", "login_option"]) {
      if (url.searchParams.getAll(key).length > 1) throw new Error("Kiro 回调包含重复参数。");
    }
    if (url.searchParams.get("state") !== state) throw new Error("Kiro 回调 state 不匹配。");
    if (url.searchParams.has("error")) throw new TerminalCallbackError("Kiro 身份提供商拒绝或未完成授权，请重新登录。");
    const code = url.searchParams.get("code");
    if (!code || code.length > 8192 || /[\r\n\0]/.test(code)) throw new Error("Kiro 回调缺少有效授权码。");
    const method = url.searchParams.get("login_option");
    if (options.oidc) {
      if (url.pathname !== "/oauth/callback" || method !== null) throw new Error("Kiro OIDC 回调地址不匹配。");
    } else if (!method || !["google", "github"].includes(method.toLowerCase())) {
      throw new TerminalCallbackError("此分支仅支持 Google / GitHub；Builder ID 或企业账号请重新选择对应登录方式。");
    }
    const redirect = new URL(url.pathname, origin);
    if (method !== null) redirect.searchParams.set("login_option", method);
    return { code, redirectUri: redirect.href };
  };
  const server = createServer({ maxHeaderSize: 20_000 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("Connection", "close");
    if (settled || request.method !== "GET" || request.headers.host !== new URL(origin).host) {
      response.writeHead(400).end("Invalid authentication callback."); return;
    }
    try {
      const value = parse(new URL(request.url ?? "", origin).href);
      settled = true;
      response.end("授权回调已收到，请返回 Axiom 查看登录结果。此页面不代表令牌交换已成功。");
      resolve(value);
    } catch (error) {
      // Only a response with validated origin/path/state can terminate the flow.
      // Foreign callbacks must not consume the legitimate login's state.
      if (error instanceof TerminalCallbackError) { settled = true; reject(error); }
      response.writeHead(400).end("回调无效，请返回 Axiom 检查登录方式，或取消后重试。");
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1;
  try {
    for (const port of candidates) {
      signal.throwIfAborted();
      try {
        await new Promise<void>((yes, no) => {
          const error = (err: Error) => { server.removeListener("listening", ready); no(err); };
          const ready = () => { server.removeListener("error", error); yes(); };
          server.once("error", error).once("listening", ready).listen(port, "127.0.0.1");
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    if (!origin) throw new Error("Kiro 登录回调端口均被占用，请释放端口后重试。");
    signal.throwIfAborted();
  } catch (error) {
    server.close();
    server.closeAllConnections();
    throw error;
  }
  const abort = () => { settled = true; reject(new DOMException("Kiro 登录已取消", "AbortError")); server.close(); server.closeAllConnections(); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return {
    origin,
    async wait(interaction: ProviderAuthInteraction) {
      const promptController = new AbortController();
      try {
        const promptSignal = AbortSignal.any([signal, promptController.signal]);
        const manual = (async () => {
          for (;;) {
            promptSignal.throwIfAborted();
            // Prompt cancellation/rejection must propagate, not become a retry.
            const value = await interaction.prompt({
              type: "manual_code", signal: promptSignal,
              message: `${options.oidc ? "请在浏览器完成 AWS 授权。" : "请在浏览器选择 Google / GitHub。"}若未自动完成，请粘贴最终 http://127.0.0.1 回调完整 URL；不要粘贴令牌。`,
            });
            promptSignal.throwIfAborted();
            try { return parse(value); }
            catch (error) {
              if (error instanceof TerminalCallbackError) throw error;
              interaction.notify({ type: "progress", message: "Kiro 回调 URL 无效或 state 不匹配，请检查并重新粘贴；也可继续等待浏览器回调。" });
            }
          }
        })();
        return await Promise.race([result, manual]);
      } finally { settled = true; promptController.abort(); }
    },
    async close() {
      settled = true;
      signal.removeEventListener("abort", abort);
      server.closeAllConnections();
      await new Promise<void>(yes => server.close(() => yes()));
    },
  };
}
