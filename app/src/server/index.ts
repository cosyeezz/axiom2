import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Store } from "./storage.js";
import { configuration } from "./models.js";
import { ModelService } from "./model-service.js";
import { Logins } from "./auth.js";
import { Agents } from "./agents.js";
import { Tasks } from "./tasks.js";
import { Preferences } from "./preferences.js";
import { Previews } from "./preview/service.js";
import {
  AppError,
  object,
  text,
  type Command,
  type Configuration,
  type Snapshot,
} from "../shared/protocol.js";

export function dataRoot() {
  if (process.env.AXIOM_DATA_DIR) return resolve(process.env.AXIOM_DATA_DIR);
  return process.platform === "win32"
    ? join(
        process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
        "Axiom2",
      )
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Axiom2")
      : join(
          process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
          "Axiom2",
        );
}
const same = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startServer(
  options: { root?: string; port?: number; dev?: boolean } = {},
) {
  const store = new Store(options.root ?? dataRoot());
  const bootstrap = randomBytes(32).toString("hex"),
    cookie = randomBytes(32).toString("hex");
  const streamId = randomUUID();
  let seq = 0,
    origin = "";
  const models = new ModelService(store.root);
  const preferences = new Preferences(store);
  let config: Configuration = await configuration(store.root);
  let configurationRead = 0,
    shuttingDown = false;
  const inFlight = new Set<Promise<void>>();
  const refreshConfiguration = async () => {
    const reading = ++configurationRead;
    const next = await configuration(store.root);
    if (reading === configurationRead) {
      config = next;
      if (!config.error) preferences.prune(await models.read());
      publish("configuration");
      publish("favorites");
    }
  };
  const authenticated = (req: IncomingMessage) =>
    (req.headers.cookie ?? "")
      .split(";")
      .some((s) => same(s.trim(), `axiom=${cookie}`));
  const local = (req: IncomingMessage) =>
    req.headers.host === new URL(origin).host &&
    (!req.headers.origin || req.headers.origin === origin) &&
    req.headers["sec-fetch-site"] !== "cross-site";
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 200_000 });
  const subscriptions = new Map<WebSocket, Set<string>>();
  const snapshots = (scope: string): unknown => {
    if (scope === "workspaces") return store.workspaces();
    if (scope === "favorites") return preferences.favorites();
    if (scope === "configuration") return config;
    if (scope === "authentication") return null;
    const parts = scope.split(":");
    if (parts.length === 2 && parts[0] === "sessions")
      return store.sessions(parts[1]);
    if (parts.length === 3 && parts[0] === "session")
      return store.session(parts[1], parts[2]);
    const target = { workspaceId: parts[1], sessionId: parts[2] };
    if (parts.length === 3 && parts[0] === "tasks") return tasks.list(target);
    if (parts.length === 3 && parts[0] === "agent") return agents.info(target);
    if (parts.length === 3 && parts[0] === "thread")
      return agents.thread(target);
    if (parts.length === 4 && parts[0] === "message")
      return agents.message(target, parts[3]);
    throw new AppError("INVALID_SCOPE", "订阅范围无效");
  };
  const send = (ws: WebSocket, value: unknown) => {
    // No final events are silently discarded; a slow viewer reconnects to a fresh snapshot.
    if (ws.bufferedAmount > 1_000_000) {
      ws.close(1013, "请重连读取快照");
      return;
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  };
  const publish = (scope: string, data: unknown = snapshots(scope)) => {
    const event: Snapshot = {
      type: "snapshot",
      scope,
      streamId,
      seq: ++seq,
      data,
    };
    for (const [ws, scopes] of subscriptions)
      if (scopes.has(scope)) send(ws, event);
  };
  const agents = new Agents(store, models, publish);
  const tasks = new Tasks(agents);
  const previews = new Previews(store, tasks, () => origin);
  models.beforeLogout = (providers, confirmed) =>
    tasks.stopProviders(providers, confirmed);
  const logins = new Logins(
    models,
    (owner, state) =>
      send(owner as WebSocket, {
        type: "snapshot",
        scope: "authentication",
        streamId,
        seq: ++seq,
        data: state,
      }),
    refreshConfiguration,
  );
  sockets.on("connection", (ws) => {
    subscriptions.set(ws, new Set());
    send(ws, { type: "hello", streamId });
    ws.on("close", () => {
      subscriptions.delete(ws);
      logins.disconnect(ws);
    });
    ws.on("error", () => ws.close());
    const handle = async (raw: RawData) => {
      let requestId = "";
      try {
        const value = object(JSON.parse(raw.toString()));
        requestId = text(value.requestId, "请求标识");
        const c: Command = {
          requestId,
          op: text(value.op, "操作类型"),
          params: object(value.params ?? {}),
        };
        if (value.workspaceId !== undefined)
          c.workspaceId = text(value.workspaceId, "工作空间标识");
        if (value.sessionId !== undefined)
          c.sessionId = text(value.sessionId, "会话标识");
        if (c.op === "subscribe") {
          const scope = text(c.params!.scope, "订阅范围", 300),
            data = snapshots(scope);
          const scopes = subscriptions.get(ws)!;
          if (scopes.size >= 500 && !scopes.has(scope))
            throw new AppError("LIMIT", "订阅数量超限");
          scopes.add(scope);
          // JS run-to-completion puts this snapshot and following mutations on one cursor boundary.
          send(ws, { type: "snapshot", scope, streamId, seq, data });
          send(ws, {
            type: "receipt",
            requestId,
            ok: true,
            data: { subscribed: scope },
          });
          return;
        }
        if (c.op === "unsubscribe") {
          subscriptions.get(ws)!.delete(text(c.params!.scope, "订阅范围", 300));
          send(ws, { type: "receipt", requestId, ok: true, data: {} });
          return;
        }
        let data: unknown;
        if (c.op === "configuration.get") {
          await refreshConfiguration();
          data = await models.read();
        } else if (c.op === "auth.start")
          data = await store.external(c, () =>
            logins.start(
              ws,
              c.params!.providerId,
              c.params!.type,
              c.params!.revision,
            ),
          );
        else if (c.op === "auth.answer")
          data = logins.answer(
            ws,
            text(c.params!.id, "认证流程"),
            c.params!.promptId,
            c.params!.answer,
          );
        else if (c.op === "auth.cancel")
          data = await logins.cancel(ws, text(c.params!.id, "认证流程"));
        else if (c.op === "configuration.save") {
          try {
            data = await store.external(c, () => models.save(c.params));
          } finally {
            await refreshConfiguration();
          }
        } else if (
          c.op.startsWith("preview.") ||
          c.op.startsWith("annotation.")
        ) {
          data = await previews.command(c);
        } else if (c.op.startsWith("favorites.")) {
          data = await preferences.command(c, config);
          publish("favorites");
        } else if (
          c.op === "prompt" ||
          c.op.startsWith("agent.") ||
          c.op.startsWith("task.") ||
          c.op === "thread.history" ||
          c.op === "message.get"
        )
          data = await tasks.command(c);
        else if (c.op === "session.delete") data = await previews.remove(c);
        else if (c.op === "draft.list")
          data = store.drafts(c.workspaceId, c.sessionId);
        else if (c.op === "draft.get")
          data = store.draft(c.workspaceId, c.sessionId, c.params!.viewId);
        else if (c.op === "request.get")
          data = store.receipt(c.params!.requestId, c);
        else data = store.execute(c);
        if (c.op === "workspace.open") publish("workspaces");
        if (c.op.startsWith("session.")) {
          publish(`sessions:${c.workspaceId}`);
          if (c.op === "session.delete")
            publish(`session:${c.workspaceId}:${c.sessionId}`, null);
          else if (c.op !== "session.create")
            publish(`session:${c.workspaceId}:${c.sessionId}`);
        }
        send(ws, { type: "receipt", requestId, ok: true, data });
      } catch (error) {
        send(ws, {
          type: "receipt",
          requestId,
          ok: false,
          error:
            error instanceof AppError
              ? { code: error.code, message: error.message }
              : {
                  code: "STORAGE_OR_REQUEST_ERROR",
                  message: "请求未完成，数据未确认保存；请检查服务或请求格式。",
                },
        });
      }
    };
    ws.on("message", (raw) => {
      if (shuttingDown) return;
      const operation = handle(raw);
      inFlight.add(operation);
      void operation.finally(() => inFlight.delete(operation));
    });
  });
  const server = createServer();
  const vite = options.dev
    ? await (
        await import("vite")
      ).createServer({
        server: { middlewareMode: true, ws: { server } },
        appType: "spa",
      })
    : null;
  server.on("request", async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cache-Control", "no-store");
      const landingNavigation =
        req.headers.host === new URL(origin).host &&
        req.method === "GET" &&
        req.headers["sec-fetch-mode"] === "navigate" &&
        req.headers["sec-fetch-dest"] === "document" &&
        req.url === "/";
      if (!local(req) && !landingNavigation) {
        res.writeHead(403);
        res.end("来源校验失败");
        return;
      }
      const url = new URL(req.url!, origin);
      if (url.pathname === "/api/access" && req.method === "POST") {
        const token = req.headers["x-axiom-access"];
        if (
          typeof token !== "string" ||
          !same(token, bootstrap) ||
          req.headers.origin !== origin
        ) {
          res.writeHead(403);
          res.end("访问校验失败");
          return;
        }
        res.setHeader(
          "Set-Cookie",
          `axiom=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
        );
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (
          !authenticated(req) ||
          (req.headers.origin && req.headers.origin !== origin)
        ) {
          res.writeHead(401);
          res.end("请使用服务启动时的访问链接");
          return;
        }
        if (url.pathname === "/api/status" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ connected: true, stage: 1 }));
          return;
        }
        if (
          url.pathname === "/api/workspace/reveal" &&
          req.method === "POST" &&
          req.headers.origin === origin
        ) {
          const w = store.workspace(url.searchParams.get("id"));
          const child =
            process.platform === "win32"
              ? spawn("explorer.exe", [w.path], { shell: false })
              : spawn(
                  process.platform === "darwin" ? "open" : "xdg-open",
                  [w.path],
                  { shell: false },
                );
          child.once("error", () => {
            if (!res.headersSent) {
              res.writeHead(500);
              res.end("无法打开系统文件管理器");
            }
          });
          child.once("spawn", () => {
            res.writeHead(204);
            res.end();
          });
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (vite) {
        vite.middlewares(req, res);
        return;
      }
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      const client = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../dist/client",
      );
      const route = url.pathname === "/" || url.pathname.endsWith(".html");
      const file = route
        ? join(client, "index.html")
        : resolve(client, "." + decodeURIComponent(url.pathname));
      if (!file.startsWith(client + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.setHeader(
        "Content-Type",
        mime[extname(file)] || "application/octet-stream",
      );
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (!res.headersSent)
        res.writeHead(
          (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400,
        );
      res.end("请求无法完成");
    }
  });
  server.on("upgrade", (req, socket, head) => {
    if (shuttingDown) {
      socket.destroy();
      return;
    }
    if (req.url !== "/ws") {
      if (!vite) socket.destroy();
      return;
    }
    if (!local(req) || !authenticated(req) || req.headers.origin !== origin) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit("connection", ws, req),
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4317, "127.0.0.1", resolve);
    });
  } catch (error) {
    sockets.close();
    await vite?.close();
    store.close();
    throw error;
  }
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    accessUrl: `${origin}/#access=${bootstrap}`,
    store,
    refreshConfiguration,
    agents,
    tasks,
    previews,
    close: async () => {
      shuttingDown = true;
      for (const ws of sockets.clients) {
        logins.disconnect(ws);
        ws.terminate();
      }
      sockets.close();
      await Promise.allSettled(inFlight);
      await logins.close();
      await previews.close();
      await tasks.close();
      await vite?.close();
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.AXIOM_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error("AXIOM_PORT 无效");
  const app = await startServer({ port, dev: process.argv.includes("--dev") });
  console.log(
    `Axiom2 本地访问链接（仅限本机，请勿分享）：\n${app.accessUrl}\n数据目录：${app.store.root}`,
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      if (!closing) {
        closing = true;
        void app.close().then(() => process.exit(0));
      }
    });
}
