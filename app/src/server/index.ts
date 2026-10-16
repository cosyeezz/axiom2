import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Store } from "./storage.js";
import { SessionDrafts } from "./session-drafts.js";
import type { DraftStamp } from "../shared/drafts.js";
import { SessionAttention } from "./session-attention.js";
import { Files } from "./files.js";
import { FolderPicker, FolderPickerError, type PickFolder } from "./folder-picker.js";
import { OpenDialog } from "./open-dialog.js";
import { FileManager, FileManagerError } from "./file-manager.js";
import { AttachmentPicker, AttachmentPickerError, type PickAttachments } from "./attachment-picker.js";
import { imagePayloadLimit } from "./images.js";
import { configuration } from "./models.js";
import { ModelService } from "./model-service.js";
import { Logins } from "./auth.js";
import { Agents } from "./agents.js";
import { Costs } from "./costs.js";
import { Tasks } from "./tasks.js";
import { Preferences } from "./preferences.js";
import { OpenCliService, type OpenCliExecute } from "./integrations/opencli.js";
import { compressionPreferencesScope } from "../shared/compression.js";
import { taskPreferencesScope } from "../shared/tasks.js";
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

export async function startServer(
  options: { root?: string; port?: number; dev?: boolean; pickFolder?: PickFolder; pickAttachments?: PickAttachments; openCli?: { execute?: OpenCliExecute; locateNpm?: () => string; openExtension?: (target: "store" | "download") => Promise<void> } } = {},
) {
  const store = new Store(options.root ?? dataRoot());
  const costs = new Costs(store);
  const drafts = new SessionDrafts(store);
  const files = new Files(store, (scope, id) => agents.message(scope, id, true),
    (path, directory, signal) => fileManager.open(directory ? path : dirname(path), signal));
  const openDialog = new OpenDialog();
  const fileManager = new FileManager();
  const folderPicker = new FolderPicker(options.pickFolder, undefined, openDialog);
  const attachmentPicker = new AttachmentPicker(options.pickAttachments, undefined, openDialog);
  const streamId = randomUUID();
  let seq = 0,
    origin = "";
  const models = new ModelService(store.root);
  const preferences = new Preferences(store);
  let config: Configuration = await configuration(store.root);
  let configurationRead = 0,
    shuttingDown = false;
  const inFlight = new Set<Promise<void>>();
  const workspaceOperations = new Map<string, number>();
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
  const local = (req: IncomingMessage) =>
    req.headers.host === new URL(origin).host &&
    (!req.headers.origin || req.headers.origin === origin) &&
    req.headers["sec-fetch-site"] !== "cross-site";
  const sockets = new WebSocketServer({ noServer: true, maxPayload: imagePayloadLimit });
  const subscriptions = new Map<WebSocket, Set<string>>();
  const snapshots = (scope: string): unknown => {
    if (scope === "workspaces") return store.workspaces();
    if (scope === "workspace-preferences") return { ...store.workspacePreferences(), view: store.lastSession() };
    if (scope === "session-preferences") return { view: store.lastSession() };
    if (scope === compressionPreferencesScope) return store.compressionPreferences();
    if (scope === taskPreferencesScope) return tasks.settings();
    if (scope === "pinned-sessions") return store.pinnedSessions();
    if (scope === "favorites") return preferences.favorites();
    if (scope === "configuration") return config;
    if (scope === "builtin-tools:opencli") return opencli.snapshot();
    if (scope === "authentication") return null;
    const parts = scope.split(":");
    if (parts.length === 2 && parts[0] === "sessions")
      return store.sessions(parts[1]);
    if (parts.length === 3 && parts[0] === "session")
      return store.session(parts[1], parts[2]);
    const target = { workspaceId: parts[1], sessionId: parts[2] };
    if (parts.length === 3 && parts[0] === "costs") {
      costs.owner(target);
      return { revision: seq };
    }
    if (parts.length === 3 && parts[0] === "tasks") return tasks.list(target);
    if (parts.length === 3 && parts[0] === "agent") return agents.info(target);
    if (parts.length === 3 && parts[0] === "compression")
      return agents.compressions.info(target);
    if (parts.length === 3 && parts[0] === "messages")
      return agents.messages(target);
    if (parts.length === 3 && parts[0] === "thread")
      return agents.thread(target);
    if (parts.length === 4 && parts[0] === "message")
      return agents.message(target, parts[3]);
    throw new AppError("INVALID_SCOPE", "订阅范围无效");
  };
  const outgoing = new WeakMap<WebSocket, { queue: { payload: string; cost: number }[]; bytes: number; sending: boolean }>();
  const send = (ws: WebSocket, value: unknown, history = false) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const state = outgoing.get(ws) ?? { queue: [], bytes: 0, sending: false };
    outgoing.set(ws, state);
    const payload = JSON.stringify(value);
    // A complete history snapshot may exceed 1 MiB. Serialize writes so its
    // following receipt does not disconnect an otherwise healthy viewer.
    // Additional queued deltas remain bounded; never silently drop final events.
    const snapshot = value as Partial<Snapshot>;
    const cost = history || snapshot.type === "snapshot" && snapshot.scope?.startsWith("messages:")
      ? Math.min(Buffer.byteLength(payload), 200_000) : Buffer.byteLength(payload);
    if (state.sending && state.bytes + cost > 1_000_000) {
      ws.close(1013, "请重连读取快照"); return;
    }
    state.queue.push({ payload, cost }); state.bytes += cost;
    const drain = () => {
      if (state.sending || ws.readyState !== WebSocket.OPEN) return;
      const next = state.queue.shift();
      if (!next) return;
      state.bytes -= next.cost; state.sending = true;
      ws.send(next.payload, (error) => {
        state.sending = false;
        if (error) { ws.close(); return; }
        drain();
      });
    };
    drain();
  };
  let attention: SessionAttention | undefined;
  const publish = (scope: string, data?: unknown) => {
    if (scope.startsWith("sessions:")) attention?.observe(scope.slice("sessions:".length));
    const event: Snapshot = {
      type: "snapshot",
      scope,
      streamId,
      seq: ++seq,
      data: data === undefined ? snapshots(scope) : data,
    };
    const collection = scope.startsWith("message:") ? scope.split(":").slice(0, 3).join(":").replace(/^message:/, "messages:") : null;
    for (const [ws, scopes] of subscriptions) {
      if (scopes.has(scope) || (collection && scopes.has(collection))) send(ws, event);
    }
    // All session summary changes (including background runs/tasks) refresh pins.
    if (scope.startsWith("sessions:")) publish("pinned-sessions");
    // Only the independent accounting view is invalidated. No transcript reads
    // occur when it is closed, and no chat/input subscription is refreshed.
    if (/^(agent|compression|tasks|sessions|session):/.test(scope)) {
      const workspaceId = scope.split(":")[1];
      const watching = new Set([...subscriptions.values()].flatMap((scopes) => [...scopes])
        .filter((key) => key.startsWith(`costs:${workspaceId}:`)));
      for (const key of watching) publish(key, { revision: seq });
    }
  };
  const opencli = new OpenCliService(store.root, () => publish("builtin-tools:opencli"), options.openCli?.execute, options.openCli?.locateNpm, options.openCli?.openExtension);
  const agents = new Agents(store, models, publish);
  const tasks = new Tasks(agents);
  attention = new SessionAttention(store, publish);
  store.beforeArchiveWorkspace = (workspaceId) => {
    if (workspaceOperations.get(workspaceId))
      throw new AppError("WORKSPACE_BUSY", "工作空间仍有操作处理中；请等待完成或先停止，再移除。");
    // Include active child sessions as well as their parent.
    for (const row of store.db.prepare("SELECT id FROM sessions WHERE workspaceId=?").all(workspaceId)) {
      const scope = { workspaceId, sessionId: String(row.id) };
      if (agents.active(scope))
        throw new AppError("WORKSPACE_BUSY", "工作空间仍有活动执行；请先停止后再移除。");
    }
  };
  const publishWorkspace = (c: Command, data: unknown) => {
    if (c.op === "workspace.select") {
      // A persisted startup preference, never a command to navigate other viewers.
      publish("workspace-preferences");
      return;
    }
    publish("workspaces");
    if (c.op !== "workspace.delete" && c.op !== "workspace.open") return;
    publish("workspace-preferences");
    publish("pinned-sessions");
    const id = c.op === "workspace.open" ? (data as { id: string }).id : c.workspaceId;
    const visible = store.workspaces().some((w) => w.id === id);
    const affected = new Set([...subscriptions.values()].flatMap((scopes) => [...scopes]).filter((scope) => scope.split(":")[1] === id));
    for (const scope of affected) {
      if (!visible) publish(scope, scope.startsWith("sessions:") ? [] : null);
      else {
        // A previously removed session can have been deleted before the workspace reopened.
        try { publish(scope); } catch (error) {
          if (!(error instanceof AppError)) throw error;
          publish(scope, scope.startsWith("sessions:") ? [] : null);
        }
      }
    }
  };
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
      attention?.disconnect(ws);
      logins.disconnect(ws);
    });
    ws.on("error", () => ws.close());
    const handle = async (raw: RawData) => {
      let requestId = "";
      let operationWorkspace: string | undefined;
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
        if (c.op === "ping") {
          // A read-only round trip on this exact socket; no stored receipt or model work.
          send(ws, { type: "receipt", requestId, ok: true, data: { streamId } });
          return;
        }
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
        if (c.op === "session.view") {
          attention!.view(ws, { workspaceId: text(c.workspaceId, "工作空间标识"), sessionId: text(c.sessionId, "会话标识") }, c.params!.active);
          send(ws, { type: "receipt", requestId, ok: true, data: {} });
          return;
        }
        // Register before an async service queues admission through model locks.
        // A workspace deletion is synchronous and must not overtake an admitted operation.
        if (c.workspaceId && c.op !== "workspace.delete") {
          operationWorkspace = c.workspaceId;
          workspaceOperations.set(operationWorkspace, (workspaceOperations.get(operationWorkspace) ?? 0) + 1);
        }
        let data: unknown;
        if (opencli.installing && ["prompt", "agent.resume", "task.append"].includes(c.op))
          throw new AppError("TOOL_INSTALLING", "OpenCLI 正在安装或更新，请完成后再开始执行。");
        if (c.op.startsWith("opencli.")) {
          if (c.op === "opencli.install") {
            // Includes prompts admitted before their async model preparation registers a run.
            if (workspaceOperations.size) throw new AppError("AGENT_BUSY", "工作空间仍有操作处理中，请完成后再安装或更新 OpenCLI。");
            for (const row of store.db.prepare("SELECT id,workspaceId FROM sessions").all()) {
              if (agents.active({ workspaceId: String(row.workspaceId), sessionId: String(row.id) }))
                throw new AppError("AGENT_BUSY", "请等待本机 Agent 任务结束后再安装或更新 OpenCLI。");
            }
          }
          data = c.op === "opencli.get" ? await opencli.command(c) : await store.external(c, () => opencli.command(c));
        } else if (c.op === "costs.get") {
          data = costs.get({ workspaceId: text(c.workspaceId, "工作空间"), sessionId: text(c.sessionId, "会话") });
        } else if (c.op.startsWith("files.")) {
          const controller = new AbortController();
          const abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await files.command(c, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op === "configuration.get") {
          await refreshConfiguration();
          data = await models.read();
        } else if (c.op === "configuration.catalog") {
          data = await models.catalog(c.params!.providerId, c.params!.revision);
        } else if (c.op === "auth.start")
          data = await store.external(c, () =>
            logins.start(
              ws,
              c.params!.providerId,
              c.params!.type,
              c.params!.revision,
            ),
          );
        else if (c.op === "auth.open")
          data = await logins.open(ws, text(c.params!.id, "认证流程"));
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
        } else if (c.op.startsWith("compression.")) {
          data = await agents.compressions.command(c);
        } else if (c.op.startsWith("favorites.")) {
          data = await preferences.command(c, config);
          publish("favorites");
        } else if (
          c.op === "prompt" ||
          c.op.startsWith("agent.") ||
          c.op.startsWith("task.") ||
          c.op === "message.get" ||
          c.op === "message.image"
        ) {
          if (c.op === "prompt" && c.params?.draftStamp !== undefined) {
            const stamp = object(c.params.draftStamp);
            if (typeof stamp.writer !== "string" || !Number.isSafeInteger(stamp.sequence) || Number(stamp.sequence) < 1)
              throw new AppError("INVALID_INPUT", "草稿发送标识无效");
          }
          data = await tasks.command(c);
        } else if (c.op === "session.delete")
          data = await models.serial(() => tasks.remove(c));
        else if (c.op === "request.get")
          data = store.receipt(c.params!.requestId, c);
        else data = store.execute(c);
        if (c.op === "prompt" && c.params?.draftStamp) {
          const stamp = object(c.params.draftStamp);
          if (typeof stamp.writer === "string" && Number.isSafeInteger(stamp.sequence)) {
            // Prompt admission is already committed; optional draft cleanup cannot reject it.
            try { drafts.consume({ workspaceId: c.workspaceId!, sessionId: c.sessionId! }, stamp as unknown as DraftStamp, c.requestId); }
            catch { /* A later draft read reconciles the committed request receipt. */ }
          }
        }
        if (c.op.startsWith("workspace.")) publishWorkspace(c, data);
        if (c.op.startsWith("session.")) {
          if (c.op === "session.read")
            publish(`thread:${c.workspaceId}:${c.sessionId}`);
          if (c.op === "session.rename") {
            const scope = { workspaceId: c.workspaceId!, sessionId: c.sessionId! };
            const run = agents.info(scope).run;
            if (run) agents.signal(scope, run.id, { type: "title-settled" });
          }
          publish(`sessions:${c.workspaceId}`);
          if (c.op === "session.delete")
            publish(`session:${c.workspaceId}:${c.sessionId}`, null);
          else if (c.op !== "session.create")
            publish(`session:${c.workspaceId}:${c.sessionId}`);
        }
        send(ws, { type: "receipt", requestId, ok: true, data }, c.op === "agent.original" || c.op === "files.document");
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
      } finally {
        if (operationWorkspace) {
          const remaining = (workspaceOperations.get(operationWorkspace) ?? 1) - 1;
          if (remaining) workspaceOperations.set(operationWorkspace, remaining);
          else workspaceOperations.delete(operationWorkspace);
        }
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
      const url = new URL(req.url!, origin);
      if (!local(req) && !landingNavigation) {
        if (url.pathname === "/api/workspace/pick-folder" || url.pathname === "/api/attachments/pick") {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "来源校验失败" }));
        } else {
          res.writeHead(403);
          res.end("来源校验失败");
        }
        return;
      }
      if (url.pathname === "/api/draft") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.method !== "GET" && req.method !== "POST") {
          res.writeHead(405, { Allow: "GET, POST" }); res.end(JSON.stringify({ error: "请使用 GET 或 POST" })); return;
        }
        if (req.method === "POST" && req.headers.origin !== origin) {
          res.writeHead(403); res.end(JSON.stringify({ error: "来源校验失败" })); return;
        }
        try {
          const scope = { workspaceId: text(url.searchParams.get("workspaceId"), "工作空间标识"), sessionId: text(url.searchParams.get("sessionId"), "会话标识") };
          store.session(scope.workspaceId, scope.sessionId);
          if (req.method === "GET") res.end(JSON.stringify(drafts.read(scope)));
          else {
            const chunks: Buffer[] = [];
            let bytes = 0;
            for await (const chunk of req) {
              bytes += chunk.length;
              if (bytes > imagePayloadLimit) throw new AppError("PAYLOAD_TOO_LARGE", "草稿内容超过大小限制");
              chunks.push(Buffer.from(chunk));
            }
            res.end(JSON.stringify(drafts.save(scope, JSON.parse(Buffer.concat(chunks).toString("utf8")))));
          }
        } catch (error) {
          res.writeHead(error instanceof AppError && error.code === "DRAFT_CONFLICT" ? 409 : 400);
          res.end(JSON.stringify({ code: error instanceof AppError ? error.code : "DRAFT_SAVE_FAILED", error: error instanceof AppError ? error.message : "草稿未确认保存，请重试。" }));
        }
        return;
      }
      if (url.pathname === "/api/workspace/pick-folder") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.headers.origin !== origin) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "来源校验失败" }));
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end(JSON.stringify({ error: "请使用 POST 请求选择文件夹" }));
          return;
        }
        const controller = new AbortController();
        const disconnect = () => controller.abort();
        req.once("aborted", disconnect);
        res.once("close", disconnect);
        try {
          if (shuttingDown) throw new FolderPickerError("服务正在退出", 503);
          const path = await folderPicker.select(controller.signal);
          if (!res.destroyed) res.end(JSON.stringify({ path }));
        } catch (error) {
          if (!res.destroyed) {
            res.writeHead(error instanceof FolderPickerError ? error.status : 500);
            res.end(JSON.stringify({ error: error instanceof FolderPickerError ? error.message : "无法打开系统文件夹选择器" }));
          }
        } finally {
          req.removeListener("aborted", disconnect);
          res.removeListener("close", disconnect);
        }
        return;
      }
      if (url.pathname === "/api/attachments/pick") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.headers.origin !== origin) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "来源校验失败" }));
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end(JSON.stringify({ error: "请使用 POST 请求选择附件" }));
          return;
        }
        const controller = new AbortController();
        const disconnect = () => controller.abort();
        req.once("aborted", disconnect);
        res.once("close", disconnect);
        try {
          if (shuttingDown) throw new AttachmentPickerError("服务正在退出", 503);
          const workspaceId = text(url.searchParams.get("workspaceId"), "工作空间标识");
          const sessionId = text(url.searchParams.get("sessionId"), "会话标识");
          const validate = () => {
            store.session(workspaceId, sessionId);
            const workspace = store.workspace(workspaceId);
            if (!workspace.authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
            return workspace;
          };
          const workspace = validate();
          const kind = url.searchParams.get("kind") ?? "mixed";
          const multiple = url.searchParams.get("multiple") ?? "true";
          if ((kind !== "file" && kind !== "folder" && kind !== "mixed") || (multiple !== "true" && multiple !== "false"))
            throw new AttachmentPickerError("打开窗口的选择模式无效", 400);
          const items = await attachmentPicker.select(workspace.path, controller.signal, kind, multiple === "true");
          if (shuttingDown) throw new AttachmentPickerError("服务正在退出", 503);
          controller.signal.throwIfAborted();
          if (validate().path !== workspace.path) throw new AttachmentPickerError("工作空间路径已改变，请重新选择附件", 409);
          if (!res.destroyed) {
            files.registerPicked({ workspaceId, sessionId }, items);
            res.end(JSON.stringify({ items }));
          }
        } catch (error) {
          if (!res.destroyed) {
            res.writeHead(error instanceof AttachmentPickerError ? error.status : error instanceof AppError ? error.code === "AUTHORIZATION_REQUIRED" ? 403 : error.code === "NOT_FOUND" ? 404 : 400 : 500);
            res.end(JSON.stringify({ error: error instanceof AttachmentPickerError || error instanceof AppError ? error.message : "无法打开系统附件选择器" }));
          }
        } finally {
          req.removeListener("aborted", disconnect);
          res.removeListener("close", disconnect);
        }
        return;
      }
      if (url.pathname === "/api/access" && req.method === "POST") {
        if (req.headers.origin !== origin) {
          res.writeHead(403);
          res.end("访问校验失败");
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (
          req.headers.origin && req.headers.origin !== origin
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
          const controller = new AbortController();
          const disconnect = () => { if (!res.writableEnded) controller.abort(); };
          req.once("aborted", disconnect);
          res.once("close", disconnect);
          try {
            await fileManager.open(w.path, controller.signal);
            if (!res.destroyed) { res.writeHead(204); res.end(); }
          } catch (error) {
            if (!res.destroyed) {
              res.writeHead(error instanceof FileManagerError ? error.status : 500);
              res.end(error instanceof FileManagerError ? error.message : "无法打开系统文件管理器");
            }
          } finally {
            req.removeListener("aborted", disconnect);
            res.removeListener("close", disconnect);
          }
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
    if (!local(req) || req.headers.origin !== origin) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit("connection", ws, req),
    );
  });
  try {
    // Preparation never opens a window; keep compilation/CLR/COM startup out of the first click.
    // A missing desktop component must not prevent the rest of the service from starting.
    await Promise.all([openDialog.prepare().catch(() => {}), fileManager.prepare().catch(() => {})]);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4317, "127.0.0.1", resolve);
    });
  } catch (error) {
    await Promise.all([openDialog.close(), fileManager.close()]);
    sockets.close();
    await vite?.close();
    attention.close();
    store.close();
    throw error;
  }
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    accessUrl: `${origin}/`,
    store,
    refreshConfiguration,
    agents,
    tasks,
    close: async () => {
      shuttingDown = true;
      attention.close();
      await opencli.close();
      await Promise.all([openDialog.close(), fileManager.close()]);
      for (const ws of sockets.clients) {
        logins.disconnect(ws);
        ws.terminate();
      }
      sockets.close();
      await Promise.allSettled(inFlight);
      await logins.close();
      await tasks.close();
      await vite?.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        // Tasks and owned operations have settled. Slow/incomplete HTTP clients
        // must not keep the service and its storage lock alive indefinitely.
        server.closeAllConnections();
      });
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.env.AXIOM_PI_DIR ||= getAgentDir();
  const port = Number(process.env.AXIOM_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
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
