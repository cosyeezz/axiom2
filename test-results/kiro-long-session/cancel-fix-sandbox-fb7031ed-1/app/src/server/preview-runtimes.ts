import { createServer, request, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, object, type Command } from "../shared/protocol.js";
import type { FilePreview } from "../shared/file-preview.js";
import type { WebPreviewDescription, WebPreviewState } from "../shared/web-preview.js";
import { readPreviewFile, previewMime } from "./preview-files.js";
import { previewPolicy, rewritePreview } from "./preview-rewrite.js";
import { tailscaleAddresses } from "./remote-access.js";
import { findNpmCli } from "./integrations/opencli.js";

type Instance = {
  id: string; owner: string; command: Command; root: string; prefix: string; entry: string; mode: "page" | "project"; network: boolean;
  servers: Server[]; urls: string[]; child?: ChildProcess; home?: string; upstream?: number; log: string; exited: boolean;
  expires: number; deadline: number; requests: number; waiting: number; bytes: number; period: number; stopping?: Promise<void>;
};
const endpoint = (host: string, port: number) => `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
const owner = (c: Command) => `${c.workspaceId}:${c.sessionId}`;
const reference = (c: Command): Command => ({ ...c, op: "files.document", params: { messageId: c.params?.messageId, href: c.params?.href } });

/** Separate HTTP origins are the renderer boundary. Child processes are NOT an OS sandbox. */
export class PreviewRuntimes {
  private instances = new Map<string, Instance>();
  private busy = new Set<string>();
  private closed = false;
  private closing = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  constructor(private read: (c: Command, signal: AbortSignal) => Promise<FilePreview>, private authorize: (c: Command) => void, private addresses = tailscaleAddresses) {
    this.timer = setInterval(() => {
      for (const instance of this.instances.values()) {
        try { this.authorize(instance.command); if (Date.now() >= instance.expires) throw Error("预览租约已过期"); }
        catch { void this.stop(instance); }
      }
    }, 5000);
    this.timer.unref();
  }
  private async describe(c: Command, signal: AbortSignal): Promise<WebPreviewDescription> {
    this.authorize(c);
    const file = await this.read(reference(c), signal);
    if (file.archiveMember || !file.directory && !/\.html?$/i.test(file.name) && file.name !== "package.json") throw new AppError("INVALID_INPUT", "运行预览需要 HTML、package.json 或项目目录链接");
    const root = file.directory ? file.path : dirname(file.path);
    let packageBytes: Buffer | undefined;
    try { packageBytes = await readPreviewFile(root, "package.json", signal, 256 * 1024); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let scripts: WebPreviewDescription["scripts"] = [];
    if (packageBytes) {
      const pkg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packageBytes));
      scripts = Object.entries(pkg.scripts ?? {}).filter(([name, command]) => /^[\w:.-]{1,80}$/.test(name) && typeof command === "string" && command.length < 4096).map(([name, command]) => ({ name, command: command as string })).slice(0, 100);
    }
    this.authorize(c); signal.throwIfAborted();
    return { root, entry: /\.html?$/i.test(file.name) ? basename(file.path) : undefined, scripts, revision: createHash("sha256").update(root).update(file.revision ?? file.modified).update(packageBytes ?? "").digest("hex") };
  }
  private state(instance: Instance): WebPreviewState {
    return { id: instance.id, urls: instance.urls, mode: instance.mode, network: instance.network, status: instance.exited ? "exited" : "running", log: instance.log, expires: instance.expires };
  }
  async command(c: Command, signal = AbortSignal.timeout(30000)): Promise<WebPreviewDescription | WebPreviewState | null> {
    signal = AbortSignal.any([signal, this.closing.signal]);
    const p = object(c.params ?? {});
    if (this.closed) throw new AppError("PREVIEW_CLOSED", "预览服务已关闭");
    if (c.op === "preview.status" || c.op === "preview.stop") {
      const instance = typeof p.id === "string" ? this.instances.get(p.id) : undefined;
      if (!instance || instance.owner !== owner(c)) {
        if (c.op === "preview.stop") return null;
        throw new AppError("PREVIEW_EXPIRED", "预览已停止或过期，请重新启动");
      }
      if (c.op === "preview.stop") { await this.stop(instance); return null; }
      this.authorize(instance.command);
      if (instance.expires <= Date.now()) { await this.stop(instance); throw new AppError("PREVIEW_EXPIRED", "预览租约已过期，请重新启动"); }
      instance.expires = Math.min(instance.deadline, Date.now() + 120000);
      return this.state(instance);
    }
    if (!["preview.describe", "preview.start"].includes(c.op)) throw new AppError("UNKNOWN_OPERATION", "未知预览操作");
    if (typeof p.messageId !== "string" || typeof p.href !== "string") throw new AppError("INVALID_INPUT", "预览需要本会话的原始文件链接");
    if (c.op === "preview.describe") return this.describe(c, signal);
    if (p.confirm !== true || !["page", "project"].includes(String(p.mode)) || typeof p.network !== "boolean" || typeof p.revision !== "string") throw new AppError("CONFIRMATION_REQUIRED", "请确认目录读取、脚本执行与联网风险后启动");
    const key = owner(c);
    if (this.busy.has(key) || this.instances.size + this.busy.size >= 3) throw new AppError("LIMIT", "预览启动中或已达到3个实例上限");
    this.busy.add(key);
    let instance: Instance | undefined;
    try {
      const description = await this.describe(c, signal);
      if (description.revision !== p.revision) throw new AppError("REVISION_CONFLICT", "文件或项目脚本已改变，请重新查看后确认");
      const mode = p.mode as "page" | "project";
      if (mode === "page" && !description.entry) throw new AppError("INVALID_INPUT", "普通网页运行需要 HTML 入口");
      const script = description.scripts.find(script => script.name === p.script);
      if (mode === "project" && !script) throw new AppError("INVALID_INPUT", "请选择 package.json 中的启动脚本");
      for (const previous of this.instances.values()) if (previous.owner === key) await this.stop(previous);
      const id = randomBytes(24).toString("hex"), now = Date.now();
      instance = { id, owner: key, command: reference(c), root: description.root, prefix: `/${id}/`, entry: description.entry ?? "", mode, network: p.network, servers: [], urls: [], log: "", exited: false, expires: now + 120000, deadline: now + 30 * 60000, requests: 0, waiting: 0, bytes: 0, period: now };
      this.instances.set(id, instance);
      await this.listen(instance);
      if (mode === "project") await this.launch(instance, script!, signal);
      this.authorize(c); signal.throwIfAborted();
      return this.state(instance);
    } catch (error) { if (instance) await this.stop(instance); throw error; }
    finally { this.busy.delete(key); }
  }
  private async listen(instance: Instance) {
    let port = 0;
    for (const host of ["127.0.0.1", ...this.addresses()]) {
      if (this.closed || !this.instances.has(instance.id)) throw Error("预览启动已取消");
      const server = createServer((req, res) => { void this.serve(instance, endpoint(host, port), req, res); });
      instance.servers.push(server);
      server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100;
      server.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
      try {
        await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.removeListener("error", reject); resolve(); }); });
        if (this.closed || !this.instances.has(instance.id)) { server.closeAllConnections(); server.close(); throw Error("预览启动已取消"); }
        server.on("error", error => { instance.log = (instance.log + "\n" + error.message).slice(-8000); });
        port = (server.address() as { port: number }).port;
        instance.urls.push(endpoint(host, port) + instance.prefix + (instance.mode === "page" ? encodeURIComponent(instance.entry) : ""));
      } catch (error) {
        if (host === "127.0.0.1") throw error;
        instance.log += `\n远程预览接口 ${host} 不可用`;
      }
    }
  }
  private async serve(instance: Instance, origin: string, req: IncomingMessage, res: ServerResponse) {
    let active = false;
    try {
      res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Security-Policy", previewPolicy(origin, instance.prefix, instance.network));
      if (req.headers.host !== new URL(origin).host || !req.url?.startsWith("/") || req.url.startsWith("//") || !this.instances.has(instance.id) || instance.expires <= Date.now()) throw Error("预览令牌或来源无效");
      this.authorize(instance.command);
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith(instance.prefix)) throw Error("预览令牌无效");
      const name = decodeURIComponent(url.pathname.slice(instance.prefix.length)) || "index.html";
      if (/[\x00-\x1f\x7f\\]/.test(name) || name.split("/").some(p => p === ".." || p.startsWith("."))) throw Error("资源路径不允许");
      if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.writeHead(204); res.end(); return; }
      const controller = new AbortController(), abort = () => controller.abort();
      req.once("aborted", abort); res.once("close", abort);
      const signal = AbortSignal.any([controller.signal, this.closing.signal, AbortSignal.timeout(15000)]);
      if (instance.waiting >= 64) throw Error("预览等待队列已满");
      instance.waiting++;
      try { while (instance.requests >= 8) { await delay(10, undefined, { signal }); if (!this.instances.has(instance.id)) throw Error("预览已停止"); } }
      finally { instance.waiting--; }
      signal.throwIfAborted(); this.authorize(instance.command);
      instance.requests++; active = true;
      if (Date.now() - instance.period > 60000) { instance.period = Date.now(); instance.bytes = 0; }
      if (instance.bytes >= 128 * 1024 * 1024) throw Error("预览每分钟128 MiB传输预算已用尽");
      let bytes: Buffer, mime: string, status = 200;
      if (instance.mode === "project") {
        if (!instance.upstream || instance.exited) throw Error("项目进程未运行，请查看日志");
        const response = await this.proxy(instance, "/" + url.pathname.slice(instance.prefix.length) + url.search, req, signal);
        bytes = response.bytes; mime = response.mime; status = response.status;
        if (response.location) {
          const target = new URL(response.location, `http://127.0.0.1:${instance.upstream}/${url.pathname.slice(instance.prefix.length)}${url.search}`);
          if (target.origin !== `http://127.0.0.1:${instance.upstream}`) throw Error("项目重定向超出本地服务");
          res.setHeader("Location", instance.prefix + target.pathname.slice(1) + target.search + target.hash);
        }
      } else {
        if (!["GET", "HEAD"].includes(req.method ?? "")) throw Error("静态预览只允许读取资源");
        mime = previewMime[extname(name).toLowerCase()];
        if (!mime) throw Error("资源类型不在预览白名单");
        bytes = await readPreviewFile(instance.root, name, signal);
      }
      this.authorize(instance.command); signal.throwIfAborted();
      if (!this.instances.has(instance.id)) throw Error("预览已停止");
      if (["text/html", "text/css", "text/javascript", "application/javascript"].includes(mime)) {
        const base = origin + instance.prefix + name.split("/").slice(0, -1).map(encodeURIComponent).join("/") + (name.includes("/") ? "/" : "");
        bytes = Buffer.from(rewritePreview(new TextDecoder("utf-8", { fatal: true }).decode(bytes), mime, instance.prefix, base));
      }
      if (instance.bytes + bytes.length > 128 * 1024 * 1024) throw Error("预览每分钟128 MiB传输预算已用尽");
      instance.bytes += bytes.length;
      res.setHeader("Content-Type", mime + (/^(?:text\/|application\/(?:javascript|json))/.test(mime) ? "; charset=utf-8" : ""));
      res.setHeader("Content-Length", bytes.length); res.writeHead(status); res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (!res.headersSent) { res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }); res.end((error as Error).message); } else res.destroy();
    } finally { if (active) instance.requests--; }
  }
  private async proxy(instance: Instance, path: string, req: IncomingMessage, signal: AbortSignal) {
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(req.method ?? "")) throw Error("项目请求方法不允许");
    const body: Buffer[] = []; let length = 0;
    for await (const chunk of req) { signal.throwIfAborted(); length += chunk.length; if (length > 2 * 1024 * 1024) throw Error("项目请求超过2 MiB"); body.push(chunk); }
    return new Promise<{ bytes: Buffer; mime: string; status: number; location?: string }>((resolve, reject) => {
      const upstream = request({ hostname: "127.0.0.1", port: instance.upstream, path, method: req.method, signal, headers: { "Content-Type": req.headers["content-type"] ?? "application/octet-stream", "Content-Length": length, "Accept-Encoding": "identity", Accept: req.headers.accept ?? "*/*" } }, reply => {
        const chunks: Buffer[] = []; let size = 0;
        reply.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 16 * 1024 * 1024) { upstream.destroy(Error("项目响应超过16 MiB")); return; } chunks.push(chunk); });
        reply.on("error", reject);
        reply.on("end", () => resolve({ bytes: Buffer.concat(chunks, size), mime: (reply.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim().toLowerCase(), status: reply.statusCode ?? 502, location: reply.headers.location }));
      });
      upstream.on("error", reject); upstream.end(Buffer.concat(body, length));
    });
  }
  private async launch(instance: Instance, script: { name: string; command: string }, signal: AbortSignal) {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    instance.upstream = port;
    const home = await mkdtemp(join(tmpdir(), "axiom-preview-process-"));
    if (signal.aborted || this.closed || !this.instances.has(instance.id)) { await rm(home, { recursive: true, force: true }); signal.throwIfAborted(); throw Error("预览启动已取消"); }
    instance.home = home;
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? process.env.Path, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT, HOME: instance.home, USERPROFILE: instance.home, TMPDIR: instance.home, TMP: instance.home, TEMP: instance.home, PORT: String(port), HOST: "127.0.0.1", BROWSER: "none", NO_COLOR: "1", npm_config_ignore_scripts: "true", npm_config_update_notifier: "false", npm_config_cache: join(instance.home, "npm-cache") };
    const args = [findNpmCli(), "--ignore-scripts", "run", script.name];
    if (/(?:^|\s)vite(?:\s|$)/.test(script.command)) args.push("--", "--host", "127.0.0.1", "--port", String(port), "--strictPort");
    else if (/(?:^|\s)next\s+dev(?:\s|$)/.test(script.command)) args.push("--", "--hostname", "127.0.0.1", "--port", String(port));
    signal.throwIfAborted(); this.authorize(instance.command);
    if (this.closed || !this.instances.has(instance.id)) throw Error("预览启动已取消");
    const child = spawn(process.execPath, args, { cwd: instance.root, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    instance.child = child;
    const collect = (chunk: Buffer) => { instance.log = (instance.log + chunk.toString()).slice(-8000); };
    child.stdout?.on("data", collect); child.stderr?.on("data", collect);
    child.on("error", error => { instance.exited = true; collect(Buffer.from(error.message)); });
    child.on("exit", (code, signal) => { instance.exited = true; collect(Buffer.from(`\n进程结束：${code ?? signal}`)); });
    for (let attempt = 0; attempt < 75; attempt++) {
      signal.throwIfAborted(); this.authorize(instance.command);
      if (this.closed || !this.instances.has(instance.id) || instance.exited) throw Error(`项目未启动：${instance.log}`);
      const ready = await new Promise<boolean>(resolve => {
        const check = request({ hostname: "127.0.0.1", port, path: "/", method: "HEAD", timeout: 200 }, response => { response.resume(); resolve(true); });
        check.on("timeout", () => check.destroy()); check.on("error", () => resolve(false)); check.end();
      });
      if (ready) return;
      await delay(200, undefined, { signal });
    }
    throw Error(`项目未在约30秒内监听分配的本地端口。通用脚本须使用 PORT/HOST 环境变量；未自动安装依赖。\n${instance.log}`);
  }
  private stop(instance: Instance): Promise<void> {
    if (instance.stopping) return instance.stopping;
    this.instances.delete(instance.id);
    instance.stopping = (async () => {
      await Promise.all(instance.servers.map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
      const child = instance.child;
      if (child?.pid) {
        if (process.platform === "win32") {
          await new Promise<void>(resolve => {
            const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
            const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 3000);
            const done = () => { clearTimeout(timer); resolve(); }; killer.once("error", done); killer.once("close", done);
          });
        } else {
          try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
          await delay(300);
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* Process group already gone. */ }
        }
      }
      if (instance.home) await rm(instance.home, { recursive: true, force: true }).catch(() => {});
    })();
    return instance.stopping;
  }
  async close() {
    this.closed = true; this.closing.abort(); clearInterval(this.timer);
    while (this.busy.size) await delay(10);
    await Promise.all([...this.instances.values()].map(instance => this.stop(instance)));
  }
}
