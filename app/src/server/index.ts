import { BackendUpdates, runningBackendVersion, type BackendUpdateOptions } from "./backend-updates.js";
import { backendUpdatesScope } from "../shared/backend-updates.js";
import { latencyFor } from "./latency.js";
import { assetCacheControl } from "./asset-cache.js";
import type { DeliveryTiming } from "../shared/latency.js";
import { PathActions } from "./path-actions.js";
import { WorkspaceGit } from "./workspace-git.js";
import { MaintenanceService } from "./maintenance.js";
import { stopMaintenanceProcesses } from "./maintenance-process.js";
import { Resources } from "./resources.js";
import { SkillFiles } from "./skill-files.js";
import { OutgoingQueue } from "./outgoing.js";
import { assertReadRequestAvailable, claimReadRequest, releaseReadRequest } from "./read-request-owner.js";
import { validRequestId as validWindowRequestId, windowFieldErrorReceipt } from "../shared/window-frame-budget.js";
import { remoteDirectory, remoteSelection } from "./remote-files.js";
import { RemoteAccess } from "./remote-access.js";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { dataRoot } from "./data-root.js";
export { dataRoot } from "./data-root.js";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Store } from "./storage.js";
import { SessionDrafts } from "./session-drafts.js";
import { SessionLists } from "./session-list.js";
import { sessionListScope, type SessionListCount, type SessionListCounts, type SessionListPage } from "../shared/session-list.js";
import type { DraftStamp } from "../shared/drafts.js";
import { SessionAttention } from "./session-attention.js";
import { Files } from "./files.js";
import { PreviewRuntimes } from "./preview-runtimes.js";
import { hasFileLink, type FilePreview } from "../shared/file-preview.js";
import { FolderPicker, FolderPickerError, type PickFolder } from "./folder-picker.js";
import { OpenDialog, OpenDialogError, type PickPaths } from "./open-dialog.js";
import { FileManager, FileManagerError } from "./file-manager.js";
import { Terminal } from "./terminal.js";
import { AttachmentPicker, AttachmentPickerError, type PickAttachments } from "./attachment-picker.js";
import { imagePayloadLimit } from "./images.js";
import { configuration } from "./models.js";
import { ModelService } from "./model-service.js";
import { Logins } from "./auth.js";
import { Agents } from "./agents.js";
import type { OpenMemoryFile } from "./memory-open.js";
import { Costs } from "./costs.js";
import { UsageSidecar } from "./usage-sidecar.js";
import type { UsageSidecarOptions } from "./usage-sidecar-engine.js";
import { usageModelPricing } from "./model-metadata.js";
import { usageProvidersScope } from "../shared/model-usage.js";
import { ModelAccountService } from "./model-accounts.js";
import { Tasks } from "./tasks.js";
import { taskWindowInvalidations } from "./task-windows.js";
import { ServiceRecoveryCoordinator } from "./service-recovery.js";
import { Preferences } from "./preferences.js";
import { ModelProxyService } from "./integrations/model-proxy.js";
import { closeModelNetworks } from "./model-network.js";
import { ReaService, type ReaDependencies } from "./integrations/rea.js";
import { RtkService, type RtkDependencies } from "./integrations/rtk.js";
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
  type Scope,
} from "../shared/protocol.js";

export async function startServer(
  options: { usageSidecar?: UsageSidecarOptions; backendUpdates?: BackendUpdateOptions; rea?: ReaDependencies; rtk?: RtkDependencies; root?: string; port?: number; dev?: boolean; openMemoryFile?: OpenMemoryFile; pickFolder?: PickFolder; pickPaths?: PickPaths; pickResources?: PickPaths; pickAttachments?: PickAttachments; openCli?: { execute?: OpenCliExecute; locateNpm?: () => string; openExtension?: (target: "store" | "download") => Promise<void>; runtime?: import("./integrations/managed-node.js").ManagedNodeProvider } } = {},
) {
  let remoteAccess: RemoteAccess | undefined;
  const store = new Store(options.root ?? dataRoot());
  const latency = latencyFor(store);
  const deliverySamples = new Map<string, number>();
  const updates = new BackendUpdates(store.db, options.backendUpdates?.version !== undefined ? options.backendUpdates.version : await runningBackendVersion(), () => publish(backendUpdatesScope), options.backendUpdates);
  const costs = new Costs(store);
  const drafts = new SessionDrafts(store);
  const files = new Files(store, (scope, id) => agents.message(scope, id, true),
    (path, directory, signal) => fileManager.open(directory ? path : dirname(path), signal, directory ? undefined : path),
    async (scope, id) => {
      const catalog = await agents.capabilities.get(scope);
      const skill = catalog.skills.find(item => item.id === id && item.available);
      if (!skill) throw new AppError("CAPABILITY_UNAVAILABLE", "技能已不存在或不可读取，请刷新技能列表。");
      return skill.source;
    });
  const previews = new PreviewRuntimes(async (c, signal) => await files.command(c, signal) as FilePreview, c => {
    const scope = { workspaceId: text(c.workspaceId, "工作空间标识"), sessionId: text(c.sessionId, "会话标识") };
    store.session(scope.workspaceId, scope.sessionId);
    if (!store.workspace(scope.workspaceId).authorized) throw new AppError("AUTHORIZATION_REQUIRED", "请先授权工作空间文件访问");
    const message = agents.message(scope, text(c.params?.messageId, "消息标识"), true);
    if (message?.role !== "assistant" || !hasFileLink(message.text, text(c.params?.href, "文件链接"))) throw new AppError("FILE_PREVIEW_FORBIDDEN", "原始文件链接已不可访问");
  });
  const openDialog = new OpenDialog();
  const fileManager = new FileManager();
  const terminal = new Terminal();
  const pathActions = new PathActions(store, fileManager, terminal);
  const workspaceGit = new WorkspaceGit(store);
  const folderPicker = new FolderPicker(options.pickFolder, undefined, openDialog);
  const attachmentPicker = new AttachmentPicker(options.pickAttachments, undefined, openDialog);
  const streamId = randomUUID();
  const sessionLists = new SessionLists(store, streamId);
  let seq = 0,
    origin = "";
  const models = new ModelService(store.root);
  const usageLedger = new UsageSidecar(store, models.dir, options.usageSidecar);
  const usageStatistics = { read: (workspaceId?: string) => usageLedger.statistics(workspaceId) };
  const preferences = new Preferences(store);
  let config: Configuration = { revision: "", providerCount: 0, modelCount: 0, available: [], dataRoot: store.root };
  let configurationRead = 0,
    shuttingDown = false;
  const inFlight = new Set<Promise<void>>();
  const workspaceOperations = new Map<string, number>();
  const refreshConfiguration = async () => {
    const reading = ++configurationRead;
    const next = await configuration(store.root);
    const editable = !next.error ? await models.read({ normalizeCredentials: false }) : undefined;
    if (reading === configurationRead) {
      config = next;
      if (editable) preferences.prune(editable);
      publish("configuration");
      publish(usageProvidersScope);
      publish("model-accounts");
      publish("favorites");
    }
  };
  const local = (req: IncomingMessage) =>
    req.headers.host === new URL(origin).host &&
    (!req.headers.origin || req.headers.origin === origin) &&
    req.headers["sec-fetch-site"] !== "cross-site";
  const sockets = new WebSocketServer({ noServer: true, maxPayload: imagePayloadLimit });
  const subscriptions = new Map<WebSocket, Set<string>>();
  const subscriptionLifetimes = new WeakMap<WebSocket, Map<string, object>>();
  const sessionCounts = <T extends import("../shared/protocol.js").Session>(sessions: T[]) => sessions.map(session => ({
    ...session, messageCount: agents.messageCount({ workspaceId: session.workspaceId, sessionId: session.id }, { cachedOnly: true }),
  }));
  const countedSummary = (session: import("../shared/protocol.js").Session | null) => session ? sessionCounts([session])[0] : null;
  const countedPage = (page: SessionListPage): SessionListPage => ({ ...page, items: sessionCounts(page.items) });
  const snapshots = (scope: string): unknown => {
    if (scope === backendUpdatesScope) return updates.snapshot();
    if (scope === "workspaces") return store.workspaces();
    if (scope === "workspace-preferences") return { ...store.workspacePreferences(), view: store.lastSession() };
    if (scope === "session-preferences") return { view: store.lastSession() };
    if (scope === compressionPreferencesScope) return store.compressionPreferences();
    if (scope === taskPreferencesScope) return tasks.settings();
    if (scope === "pinned-sessions") return sessionCounts(store.pinnedSessions());
    if (scope === sessionListScope) return { revision: sessionLists.revision() };
    // Invalidation only: deleted summaries are fetched in bounded, searchable pages.
    if (scope === "deleted-sessions") return { revision: seq };
    if (scope === "favorites") return preferences.favorites();
    if (scope === "configuration") return config;
    if (scope === "maintenance") return maintenance.snapshot();
    if (scope === "resources") return resources.snapshot();
    if (scope === "builtin-tools:opencli") return opencli.snapshot();
    if (scope === "builtin-tools:rea") return rea.snapshot();
    if (scope === "builtin-tools:rtk") return rtk.snapshot();
    if (scope === "builtin-tools:model-proxy") return modelProxy.snapshot();
    if (scope === "capability-preferences") return { revision: agents.capabilities.preferences().revision };
    if (scope === "authentication") return null;
    if (scope === usageProvidersScope || scope === "model-accounts") return { revision: seq };
    const parts = scope.split(":");
    if (parts.length === 2 && parts[0] === "processing") return agents.memories.records.invalidation(parts[1]);
    if (parts.length === 2 && parts[0] === "memory-tree") return agents.memories.tree(parts[1]);
    if (parts.length === 2 && parts[0] === "memory-catalog") return agents.memories.catalog(parts[1]);
    if (parts.length === 2 && parts[0] === "sessions")
      return sessionCounts(store.sessions(parts[1]));
    if (parts.length === 3 && parts[0] === "session")
      return countedSummary(sessionLists.summary(parts[1], parts[2]));
    const target = { workspaceId: parts[1], sessionId: parts[2] };
    if (parts.length === 3 && parts[0] === "reload") return agents.reloads.state(target);
    if (parts.length === 3 && parts[0] === "capabilities") return agents.capabilities.state(target);
    if (parts.length === 3 && parts[0] === "memory") return agents.memories.snapshot(target);
    if (parts.length === 3 && parts[0] === "costs") {
      costs.owner(target);
      // Subscription establishment is not an accounting invalidation. The client
      // already performs an authoritative read on mount and reconnect.
      return { revision: 0 };
    }
    if (parts.length === 3 && parts[0] === "task-window") return tasks.windowInvalidation(target, seq);
    if (parts.length === 3 && parts[0] === "tasks") return tasks.list(target);
    if (parts.length === 3 && parts[0] === "agent") return agents.info(target);
    if (parts.length === 3 && parts[0] === "compression")
      return agents.compressions.info(target);
    if (parts.length === 3 && parts[0] === "messages")
      return agents.messages(target);
    if (parts.length === 3 && parts[0] === "thread")
      return agents.thread(target);
    if (parts.length === 3 && parts[0] === "thread-meta")
      return agents.threadMetadata(target);
    if (parts.length === 4 && parts[0] === "message")
      return agents.message(target, parts[3]);
    throw new AppError("INVALID_SCOPE", "订阅范围无效");
  };
  const outgoing = new WeakMap<WebSocket, OutgoingQueue>();
  const connectionIds = new WeakMap<WebSocket, string>();
  const channel = (ws: WebSocket) => {
    let queue = outgoing.get(ws);
    if (!queue) {
      queue = new OutgoingQueue((payload, done) => {
        if (ws.readyState !== WebSocket.OPEN) { done(new Error("连接已关闭")); return; }
        ws.send(payload, (error) => done(error ?? undefined));
      }, () => ws.close(1013, "请重连读取快照"));
      outgoing.set(ws, queue);
    }
    return queue;
  };
  const send = (ws: WebSocket, value: unknown, admittedRead = false, done?: () => void) => {
    if (ws.readyState !== WebSocket.OPEN) { done?.(); return; }
    const event = value as Partial<Snapshot>;
    const data = event.data as { streaming?: boolean } | undefined;
    const trace = event.latency;
    let connectionId: string | undefined;
    if (trace) {
      connectionId = connectionIds.get(ws) ?? randomUUID();
      connectionIds.set(ws, connectionId);
      // Only sampled frames need a per-connection envelope; ordinary frames still share encoding.
      value = { ...event, latency: { ...trace, connectionId } };
    }
    const correlation = trace ? { runId: trace.runId, requestId: trace.requestId, updateId: trace.updateId, streamId: event.streamId, seq: event.seq, connectionId } : undefined;
    if (correlation) latency.add({ ...correlation, stage: "ws.enqueue", at: Date.now() });
    channel(ws).send(value, event.type === "snapshot" && event.scope?.startsWith("message:") && data?.streaming ? event.scope : undefined, done, admittedRead,
      correlation ? timing => latency.add({ ...correlation, stage: `ws.${timing.stage}`, at: Date.now(),
        durationMs: timing.stage === "start" ? timing.queuedMs : timing.writeMs, bytes: timing.bytes }) : undefined);
  };
  const receivers = (scope: string) => {
    const collection = scope.startsWith("message:") ? scope.split(":").slice(0, 3).join(":").replace(/^message:/, "messages:") : null;
    return [...subscriptions].filter(([ws, scopes]) => ws.readyState === WebSocket.OPEN &&
      (scopes.has(scope) || !!collection && scopes.has(collection))).map(([ws]) => ws);
  };
  let attention: SessionAttention | undefined;
  const costWorkspaces = new Set<string>();
  let costTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleCosts = (workspaceId: string) => {
    if (shuttingDown) return;
    costWorkspaces.add(workspaceId);
    if (costTimer) return;
    costTimer = setTimeout(() => {
      costTimer = undefined;
      const workspaces = new Set(costWorkspaces); costWorkspaces.clear();
      const watching = new Set([...subscriptions.values()].flatMap((scopes) => [...scopes])
        .filter((key) => key.startsWith("costs:") && workspaces.has(key.split(":")[1])));
      const families = new Map<string, { scope: Scope; keys: string[] }>();
      for (const key of watching) {
        const [, workspaceId, sessionId] = key.split(":");
        try {
          const owner = costs.owner({ workspaceId, sessionId }), familyKey = JSON.stringify(owner);
          const family = families.get(familyKey) ?? { scope: owner, keys: [] };
          family.keys.push(key); families.set(familyKey, family);
        } catch { publish(key, { revision: ++seq }, true); }
      }
      for (const family of families.values()) {
        let changed = true;
        try { changed = costs.changed(family.scope); } catch { /* Let the read expose unavailable accounting data. */ }
        if (changed) for (const key of family.keys) publish(key, { revision: ++seq }, true);
      }
    }, 100);
  };
  let invalidateTaskWindows: ((changed: string) => void) | undefined;
  const publish = (scope: string, data?: unknown, accountingUpdate = false) => {
    invalidateTaskWindows?.(scope);
    for (const key of taskWindowInvalidations(scope, () => [...subscriptions.values()].flatMap(scopes => [...scopes])))
      publish(key, { revision: seq + 1 });
    // Explicit memory charges use the same owner routing as transcript and task changes.
    if (scope.startsWith("costs:") && !accountingUpdate) { scheduleCosts(scope.split(":")[1]); return; }
    if (scope.startsWith("sessions:")) attention?.observe(scope.slice("sessions:".length));
    const targets = receivers(scope);
    const version = ++seq;
    if (targets.length && scope.startsWith("messages:") && data === undefined) {
      for (const ws of targets) {
        const lifetime = subscriptionLifetimes.get(ws)?.get(scope);
        channel(ws).lazy(() => {
          const scopes = subscriptions.get(ws);
          if (!scopes?.has(scope) || subscriptionLifetimes.get(ws)?.get(scope) !== lifetime) return;
          const current = snapshots(scope), threadKey = scope.replace(/^messages:/, "thread:");
          const thread = scopes.has(threadKey) ? snapshots(threadKey) : undefined;
          // Capture body and layout synchronously at delivery, not at descriptor enqueue time.
          return { type: "snapshot", scope, streamId, seq: ++seq, data: current, ...(thread === undefined ? {} : { thread }) };
        });
      }
    } else if (targets.length) {
      let timing: DeliveryTiming | undefined;
      if (scope.startsWith("message:") && data && typeof data === "object" && "deliveryTiming" in data) {
        const { deliveryTiming, ...body } = data as { deliveryTiming?: DeliveryTiming; streaming?: boolean };
        data = body;
        const now = Date.now();
        if (deliveryTiming && (!body.streaming || now - (deliverySamples.get(deliveryTiming.requestId) ?? 0) >= 1000)) {
          timing = deliveryTiming;
          deliverySamples.delete(timing.requestId); deliverySamples.set(timing.requestId, now);
          if (deliverySamples.size > 256) deliverySamples.delete(deliverySamples.keys().next().value!);
          const correlation = { runId: timing.runId, requestId: timing.requestId, updateId: timing.updateId, streamId, seq: version };
          latency.add({ ...correlation, stage: "ipc.receive", at: timing.receivedAt ?? now, durationMs: timing.receivedAt === undefined ? undefined : timing.receivedAt - timing.workerAt });
          latency.add({ ...correlation, stage: "view.publish", at: now, durationMs: timing.receivedAt === undefined ? undefined : now - timing.receivedAt });
        }
      }
      const event: Snapshot = { type: "snapshot", scope, streamId, seq: version, data: data === undefined ? snapshots(scope) : data, ...(timing ? { latency: timing } : {}) };
      for (const ws of targets) send(ws, event);
    }
    // Refresh only individually observed summaries, not the workspace collection.
    // This also carries count-only changes to a selected session outside its page.
    if (scope.startsWith("sessions:")) {
      const prefix = `session:${scope.slice("sessions:".length)}:`;
      const selected = new Set([...subscriptions.values()].flatMap(scopes => [...scopes]).filter(key => key.startsWith(prefix)));
      for (const key of selected) {
        try { publish(key); } catch { /* An unavailable summary is not absence; keep other summaries and invalidations flowing. */ }
      }
      // Keep full attention observation above and the legacy pins route intact.
      publish("pinned-sessions");
    }
    // Count changes intentionally retain the metadata revision; seq still advances.
    if (scope === "pinned-sessions" || scope === "workspaces") publish(sessionListScope);
    // Only changed accounting sources invalidate an open report. Progress alone
    // neither queries costs nor scans transcripts; siblings share one source check.
    if (/^(agent|compression|tasks|sessions|session):/.test(scope)) scheduleCosts(scope.split(":")[1]);
  };
  // RTK installs into immutable private directories; it does not mutate global tools or active workers.
  let proxyReady = false, proxyRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const maintenance = new MaintenanceService(store.root, () => publish("maintenance"));
  let agents: Agents;
  const modelProxy = new ModelProxyService(store.root, () => {
    publish("builtin-tools:model-proxy");
    if (!proxyReady || shuttingDown) return;
    clearTimeout(proxyRefreshTimer);
    proxyRefreshTimer = setTimeout(() => {
      proxyRefreshTimer = undefined;
      if (shuttingDown) return;
      const update = refreshConfiguration().catch(() => {}).finally(() => inFlight.delete(update));
      inFlight.add(update);
    }, 150);
  });
  // Component mutations never reserve session admission or retire Agent workers.
  const rea = new ReaService(store.root, () => publish("builtin-tools:rea"), options.rea);
  const rtk = new RtkService(store.root, () => publish("builtin-tools:rtk"), options.rtk);
  const opencli = new OpenCliService(store.root, () => publish("builtin-tools:opencli"), options.openCli?.execute, options.openCli?.locateNpm, options.openCli?.openExtension, undefined, options.openCli?.runtime);
  agents = new Agents(store, models, publish, options.openMemoryFile, (scope) => receivers(scope).length > 0);
  const resources = new Resources(store, models.dir, () => { publish("resources"); publish("capability-preferences"); }, async () => {});
  const skillFiles = new SkillFiles(agents.capabilities, (directory, signal) => fileManager.open(directory, signal), options.openMemoryFile);
  const tasks = new Tasks(agents);
  invalidateTaskWindows = changed => tasks.invalidateWindows(changed);
  const recovery = new ServiceRecoveryCoordinator(agents, tasks);
  attention = new SessionAttention(store, publish);
  store.beforeArchiveWorkspace = (workspaceId) => {
    if (workspaceOperations.get(workspaceId))
      throw new AppError("WORKSPACE_BUSY", "工作空间仍有操作处理中；请等待完成或先停止，再移除。");
    // Include active child sessions as well as their parent.
    for (const row of store.db.prepare("SELECT id FROM sessions WHERE workspaceId=? AND deletedAt IS NULL").all(workspaceId)) {
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
    publish("deleted-sessions");
    if (c.op !== "workspace.delete" && c.op !== "workspace.open") return;
    publish("workspace-preferences");
    publish("pinned-sessions");
    const id = c.op === "workspace.open" ? (data as { id: string }).id : c.workspaceId;
    const visible = store.workspaces().some((w) => w.id === id);
    const affected = new Set([...subscriptions.values()].flatMap((scopes) => [...scopes]).filter((scope) => scope.split(":")[1] === id));
    for (const scope of affected) {
      // Partial task data is never erased by a workspace visibility hint.
      if (scope.startsWith("task-window:")) { publish(scope, { revision: seq + 1 }); continue; }
      if (!visible) publish(scope, scope.startsWith("sessions:") ? [] : null);
      else {
        // A previously removed session can have been deleted before the workspace reopened.
        try { publish(scope); } catch (error) {
          // Only a successful summary query can establish absence. Do not turn a
          // read failure into null or fail an already committed workspace change.
          if (scope.startsWith("session:")) continue;
          if (!(error instanceof AppError)) throw error;
          publish(scope, scope.startsWith("sessions:") ? [] : null);
        }
      }
    }
  };
  models.beforeLogout = async (providers, confirmed) => {
    await agents.memories.runner?.stopProviders?.(providers, confirmed);
    await tasks.stopProviders(providers, confirmed);
  };
  const modelAccounts = new ModelAccountService(models);
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
    // Pending attempts must not invalidate deliveries for an already active subscription.
    const intents = new Map<string, object>(), lifetimes = new Map<string, object>();
    subscriptionLifetimes.set(ws, lifetimes);
    const subscriptionReads = new Map<string, AbortController>();
    send(ws, { type: "hello", streamId });
    const reads = new Map<string, AbortController>();
    ws.on("close", () => {
      for (const controller of reads.values()) controller.abort();
      reads.clear(); subscriptionReads.clear(); intents.clear(); lifetimes.clear(); outgoing.get(ws)?.close();
      subscriptions.delete(ws);
      attention?.disconnect(ws);
      logins.disconnect(ws);
    });
    ws.on("error", () => ws.close());
    const handle = async (raw: RawData) => {
      let requestId = "";
      let operationWorkspace: string | undefined;
      let releaseRead: (() => void) | undefined;
      let readController: AbortController | undefined;
      let windowRead = false;
      let subscribing: string | undefined, subscriptionIntent: object | undefined;
      try {
        const value = object(JSON.parse(raw.toString()));
        windowRead = typeof value.op === "string" && ["agent.window", "task.window"].includes(value.op.trim());
        if (windowRead && !validWindowRequestId(value.requestId)) {
          send(ws, windowFieldErrorReceipt(value.requestId, "INVALID_REQUEST_ID").frame);
          return;
        }
        requestId = text(value.requestId, "请求标识");
        assertReadRequestAvailable(reads, requestId);
        const c: Command = {
          requestId,
          op: text(value.op, "操作类型"),
          params: object(value.params ?? {}),
        };
        if (value.workspaceId !== undefined)
          c.workspaceId = text(value.workspaceId, "工作空间标识");
        if (value.sessionId !== undefined)
          c.sessionId = text(value.sessionId, "会话标识");
        if (c.op === "diagnostics.latency") {
          const runId = c.params!.runId === undefined ? undefined : text(c.params!.runId, "运行标识");
          send(ws, { type: "receipt", requestId, ok: true, data: { records: latency.snapshot(runId), capacity: latency.capacity } });
          return;
        }
        if (c.op === "ping") {
          // A read-only round trip on this exact socket; no stored receipt or model work.
          send(ws, { type: "receipt", requestId, ok: true, data: { streamId } });
          return;
        }
        if (c.op.startsWith("backendUpdates.")) {
          const data = await updates.command(c.op.slice("backendUpdates.".length), c.params!.version);
          send(ws, { type: "receipt", requestId, ok: true, data });
          return;
        }
        if (c.op === "read.cancel") {
          reads.get(text(c.params!.requestId, "读取请求标识"))?.abort();
          send(ws, { type: "receipt", requestId, ok: true, data: {} });
          return;
        }
        if (c.op === "unsubscribe") {
          const key = text(c.params!.scope, "订阅范围", 300);
          intents.delete(key); lifetimes.delete(key); subscriptionReads.get(key)?.abort(); subscriptionReads.delete(key);
          subscriptions.get(ws)?.delete(key);
          send(ws, { type: "receipt", requestId, ok: true, data: {} }); return;
        }
        if (c.op === "subscribe") {
          subscribing = text(c.params!.scope, "订阅范围", 300);
          if (intents.size >= 500 && !intents.has(subscribing)) throw new AppError("LIMIT", "订阅数量超限");
          subscriptionReads.get(subscribing)?.abort();
          subscriptionIntent = {}; intents.set(subscribing, subscriptionIntent);
        }
        const historyRead = ["agent.window", "task.window", "agent.history.index", "agent.history.read", "agent.original", "agent.editable", "message.get", "message.part", "files.document", "message.image",
          "session-list.page", "session-list.initial", "session-list.first", "session-list.counts"].includes(c.op) ||
          c.op === "subscribe" && /^(messages|thread|thread-meta|session):/.test(String(c.params!.scope));
        if (historyRead) {
          const controller = readController = claimReadRequest(reads, requestId);
          if (subscribing) subscriptionReads.set(subscribing, controller);
          releaseRead = await channel(ws).reserveRead(controller.signal);
          if (controller.signal.aborted) throw new AppError("CANCELLED", "读取已取消");
          if (ws.readyState !== WebSocket.OPEN) return;
        }
        if (c.op === "subscribe") {
          if (intents.get(subscribing!) !== subscriptionIntent) {
            send(ws, { type: "receipt", requestId, ok: true, data: { superseded: true } }, true, releaseRead);
            releaseRead = undefined; return;
          }
          const scope = subscribing!, scopes = subscriptions.get(ws)!;
          const data = snapshots(scope);
          const threadKey = scope.replace(/^messages:/, "thread:");
          const thread = scope.startsWith("messages:") && scopes.has(threadKey) ? snapshots(threadKey) : undefined;
          scopes.add(scope);
          if (!lifetimes.has(scope)) lifetimes.set(scope, subscriptionIntent!);
          // JS run-to-completion puts this snapshot and following mutations on one cursor boundary.
          send(ws, { type: "snapshot", scope, streamId, seq, data, ...(thread === undefined ? {} : { thread }) }, historyRead);
          send(ws, {
            type: "receipt",
            requestId,
            ok: true,
            data: { subscribed: scope },
          }, historyRead, releaseRead);
          releaseRead = undefined;
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
        if (c.op.startsWith("session-list.")) {
          const workspaceId = text(c.workspaceId, "工作空间标识");
          if (c.op === "session-list.page") data = countedPage(sessionLists.page(workspaceId, c.params!.group, c.params!.query, c.params!.cursor));
          else if (c.op === "session-list.initial") {
            const initial = sessionLists.initial(workspaceId, c.params!.query);
            data = { ...initial, top: countedPage(initial.top), workspace: countedPage(initial.workspace) };
          } else if (c.op === "session-list.first") data = countedSummary(sessionLists.first(workspaceId));
          else if (c.op === "session-list.counts") {
            const scopes = sessionLists.countScopes(workspaceId, c.params!.sessionIds);
            const signal = reads.get(requestId)!.signal, items: SessionListCount[] = [];
            for (const scope of scopes) {
              // Yield between files so queued cancellation/other UI reads can run.
              // A currently executing synchronous transcript scan is NOT interruptible.
              await new Promise<void>(resolve => setImmediate(resolve));
              if (signal.aborted) throw new AppError("CANCELLED", "读取已取消");
              store.session(scope.workspaceId, scope.sessionId); // revalidate after yielding
              items.push({ sessionId: scope.sessionId, messageCount: agents.messageCount(scope) });
            }
            if (signal.aborted) throw new AppError("CANCELLED", "读取已取消");
            data = { workspaceId, items } satisfies SessionListCounts;
          } else throw new AppError("UNKNOWN_OPERATION", "未知的会话列表读取操作");
        } else if (c.op.startsWith("maintenance.")) {
          data = c.op === "maintenance.get" ? maintenance.command(c) : await store.external(c, async () => maintenance.command(c));
        } else if (c.op.startsWith("resources.")) {
          if (c.workspaceId || c.sessionId) throw new AppError("INVALID_INPUT", "资源管理使用应用级范围。");
          data = c.op === "resources.get" || c.op === "resources.detail" ? await resources.command(c) : await store.external(c, () => resources.command(c));
        } else if (c.op.startsWith("rea.")) {
          data = ["rea.get", "rea.refresh"].includes(c.op) ? await rea.command(c) : await store.external(c, () => rea.command(c));
        } else if (c.op.startsWith("rtk.")) {
          data = ["rtk.get", "rtk.stats", "rtk.refresh"].includes(c.op) ? await rtk.command(c) : await store.external(c, () => rtk.command(c));
        } else if (c.op.startsWith("modelProxy.")) {
          data = c.op === "modelProxy.get" ? await modelProxy.command(c) : await store.external(c, () => modelProxy.command(c));
        } else if (c.op.startsWith("opencli.")) {
          data = c.op === "opencli.get" ? await opencli.command(c) : await store.external(c, () => opencli.command(c));
        } else if (c.op.startsWith("capabilities.skill.")) {
          const controller = new AbortController(), abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await skillFiles.command(c, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op.startsWith("capabilities.")) {
          data = await agents.capabilities.command(c);
        } else if (c.op.startsWith("processing.")) {
          data = agents.memories.records.command(c);
        } else if (c.op.startsWith("memory.")) {
          const controller = new AbortController();
          const abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await agents.memories.command(c, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op === "git.branch") {
          const controller = readController = claimReadRequest(reads, requestId), abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await workspaceGit.command(c, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op === "costs.get") {
          data = costs.get({ workspaceId: text(c.workspaceId, "工作空间"), sessionId: text(c.sessionId, "会话") });
        } else if (c.op.startsWith("paths.")) {
          const controller = new AbortController(), abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await pathActions.command(c, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op.startsWith("preview.")) {
          const controller = readController = claimReadRequest(reads, requestId), abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await previews.command(c, AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])); }
          finally { ws.off("close", abort); }
        } else if (c.op.startsWith("files.")) {
          const controller = new AbortController();
          const abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await files.command(c, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op === "agent.accountUsage.cached") {
          // Synchronous, scope-owned cache projection: no network, refresh, index import or credential mutation.
          if (Object.keys(c.params ?? {}).length) throw new AppError("INVALID_INPUT", "会话额度缓存只接受会话范围，不接受账号或刷新参数。");
          const scope = { workspaceId: text(c.workspaceId, "工作空间"), sessionId: text(c.sessionId, "会话") };
          const target = agents.accountUsageTarget(scope);
          data = target ? modelAccounts.cachedBinding(target) : null;
        } else if (c.op.startsWith("usage.")) {
          if (c.workspaceId || c.sessionId) throw new AppError("INVALID_INPUT", "模型用量与统计使用应用级范围。");
          if (c.op === "usage.statistics") {
            const report = await usageStatistics.read(c.params!.workspaceId === undefined ? undefined : text(c.params!.workspaceId, "工作空间"));
            data = report;
          } else if (c.op === "usage.ledger") data = await usageLedger.read(c.params);
          else if (c.op === "usage.requests") data = agents.pool.requests.snapshot();
          else if (c.op === "usage.workspaces") data = usageLedger.workspaces();
          else if (c.op === "usage.sessions") data = await usageLedger.sessions(c.params);
          else if (c.op === "usage.pricing") data = usageModelPricing(models.dir, text(c.params!.providerId, "供应商 ID"));
          else if (c.op === "usage.providers") data = await models.usageProviders();
          else if (c.op === "usage.provider") {
            const providerId = text(c.params!.providerId, "供应商 ID");
            const controller = new AbortController(), abort = () => controller.abort();
            ws.once("close", abort);
            try {
              // The selected model connection owns both auth and routing. Never
              // query a second account or consult the retired model-usage store.
              data = await models.usage(providerId, c.params!.refresh === true, controller.signal);
            } finally { ws.off("close", abort); }
          } else throw new AppError("UNKNOWN_OPERATION", "未知的用量统计操作。");
        } else if (c.op.startsWith("accounts.")) {
          if (c.workspaceId || c.sessionId) throw new AppError("INVALID_INPUT", "模型账号使用应用级范围。");
          if (c.op === "accounts.list") data = await modelAccounts.list();
          else if (c.op === "accounts.activate") {
            data = await store.external(c, () => modelAccounts.activate(c.params!.accountId, c.params!.revision));
            await refreshConfiguration();
          } else if (c.op === "accounts.usage") {
            // The connection already aborts all registered reads on close; avoid one
            // extra socket listener per visible card and honor explicit read.cancel.
            const controller = readController = claimReadRequest(reads, requestId);
            data = await modelAccounts.usage(c.params!.accountId, c.params!.refresh === true, controller.signal, c.params!.cache === true);
          } else throw new AppError("UNKNOWN_OPERATION", "未知的账号管理操作。");
        } else if (c.op === "configuration.get") {
          // The editor needs local configuration, not a second global availability
          // pass. Save/login already publish their own configuration invalidations.
          data = await models.read();
        } else if (c.op === "configuration.catalog") {
          const controller = new AbortController(), abort = () => controller.abort();
          ws.once("close", abort);
          try { data = await models.catalog(c.params!.providerId, c.params!.revision, controller.signal); }
          finally { ws.off("close", abort); }
        } else if (c.op === "auth.start")
          data = await store.external(c, () =>
            logins.start(
              ws,
              c.params!.providerId,
              c.params!.type,
              c.params!.revision,
              c.params!.proxy,
              c.params!.account,
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
        } else if (c.op === "agent.window" || c.op === "task.window") {
          const signal = reads.get(requestId)!.signal;
          const frame = c.op === "agent.window" ? await agents.window(c, signal) : tasks.window(c, signal);
          // The producer already budgeted the ACTUAL receipt. Never wrap it in data.
          send(ws, frame, true, releaseRead);
          releaseRead = undefined; return;
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
          c.op === "message.part" ||
          c.op === "message.image"
        ) {
          if (c.op === "prompt" && c.params?.draftStamp !== undefined) {
            const stamp = object(c.params.draftStamp);
            if (typeof stamp.writer !== "string" || !Number.isSafeInteger(stamp.sequence) || Number(stamp.sequence) < 1)
              throw new AppError("INVALID_INPUT", "草稿发送标识无效");
          }
          data = await tasks.command(c);
        } else if (c.op === "deleted-sessions.list")
          data = store.deletedSessions(object(c.params ?? {}));
        else if (c.op === "session.delete")
          data = await tasks.remove(c);
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
          const scope = c.sessionId ? { workspaceId: c.workspaceId!, sessionId: c.sessionId } : undefined;
          // 已读和置顶只影响会话列表。删除需投影 retained memory，改名只改 catalog 标题。
          if ((c.op === "session.delete" || c.op === "session.restore") && scope) {
            agents.memories.refresh(scope);
            publish("deleted-sessions");
            if (c.op === "session.restore") publish("workspaces");
          }
          if (c.op === "session.rename" && scope) agents.memories.rename(scope);
          if (c.op === "session.read")
            publish(`thread:${c.workspaceId}:${c.sessionId}`);
          if ((c.op === "session.rename" || c.op === "session.delete") && scope) agents.titles.cancel(scope);
          // The sessions route also refreshes each observed single-session scope.
          publish(`sessions:${c.workspaceId}`);
        }
        send(ws, { type: "receipt", requestId, ok: true, data }, historyRead, releaseRead);
        releaseRead = undefined;
      } catch (error) {
        if (windowRead) {
          const code = error instanceof AppError && error.code === "CANCELLED" ? "STALE"
            : error instanceof AppError && error.code === "DUPLICATE_REQUEST" ? "INVALID_REQUEST_ID" : "UNAVAILABLE";
          send(ws, windowFieldErrorReceipt(requestId, code).frame, !!releaseRead, releaseRead);
          releaseRead = undefined; return;
        }
        if (subscribing && (reads.get(requestId)?.signal.aborted || intents.get(subscribing) !== subscriptionIntent)) {
          send(ws, { type: "receipt", requestId, ok: true, data: { superseded: true } }, !!releaseRead, releaseRead);
          releaseRead = undefined; return;
        }
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
        }, !!releaseRead, releaseRead);
        releaseRead = undefined;
      } finally {
        if (subscribing && subscriptionIntent && intents.get(subscribing) === subscriptionIntent) {
          const lifetime = lifetimes.get(subscribing);
          if (lifetime) intents.set(subscribing, lifetime);
          else intents.delete(subscribing);
        }
        if (subscribing && subscriptionReads.get(subscribing) === reads.get(requestId)) subscriptionReads.delete(subscribing);
        releaseRead?.(); releaseReadRequest(reads, requestId, readController);
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
        if (url.pathname === "/api/workspace/pick-folder" || url.pathname === "/api/attachments/pick" || url.pathname === "/api/resources/pick" || url.pathname === "/api/files/pick") {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "来源校验失败" }));
        } else {
          res.writeHead(403);
          res.end("来源校验失败");
        }
        return;
      }
      if (url.pathname === "/api/files/browse") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          if (req.method === "GET") {
            const offset = Number(url.searchParams.get("offset") ?? 0);
            if (!Number.isSafeInteger(offset) || offset < 0) throw Error("目录页码无效");
            res.end(JSON.stringify(await remoteDirectory(url.searchParams.get("path") || undefined, offset))); return;
          }
          if (req.method !== "POST" || req.headers.origin !== origin) { res.writeHead(403); res.end(JSON.stringify({ error: "来源校验失败" })); return; }
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 220000) throw Error("选择内容过大"); chunks.push(Buffer.from(chunk)); }
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > 50 || value.paths.some((path: unknown) => typeof path !== "string" || path.length > 4096)) throw Error("请选择 1–50 个文件或文件夹");
          const kind = value.kind ?? "mixed", multiple = value.multiple ?? true;
          if (!["file", "folder", "mixed"].includes(kind) || typeof multiple !== "boolean") throw Error("打开窗口的选择模式无效");
          if (!multiple && value.paths.length > 1) throw Error("只能选择一项，请重新选择");
          const items = await remoteSelection(value.paths);
          if (items.some(item => kind === "file" && item.kind === "folder" || kind === "folder" && item.kind !== "folder")) throw Error("所选项目不符合文件或文件夹选择要求");
          if (value.scope) files.registerPicked(value.scope, items);
          res.end(JSON.stringify({ items }));
        } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: (error as Error).message })); }
        return;
      }
      if (url.pathname === "/api/remote") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }); res.end(JSON.stringify({ error: "请使用 GET" })); return; }
        if (!remoteAccess) { res.writeHead(503); res.end(JSON.stringify({ error: "服务正在准备" })); return; }
        res.end(JSON.stringify(remoteAccess.status()));
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
      if (url.pathname === "/api/resources/pick" || url.pathname === "/api/files/pick") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.headers.origin !== origin) { res.writeHead(403); res.end(JSON.stringify({ error: "来源校验失败" })); return; }
        if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(JSON.stringify({ error: "请使用 POST 请求选择路径" })); return; }
        const controller = new AbortController(), disconnect = () => controller.abort();
        req.once("aborted", disconnect); res.once("close", disconnect);
        try {
          if (shuttingDown) throw new OpenDialogError("服务正在退出", 503);
          const resource = url.pathname === "/api/resources/pick";
          const kind = resource ? "mixed" : url.searchParams.get("kind") ?? "mixed";
          if (kind !== "file" && kind !== "folder" && kind !== "mixed") throw new OpenDialogError("打开窗口的选择模式无效", 400);
          const title = resource ? "打开技能文件夹或 Markdown 文件" : kind === "folder" ? "打开文件夹" : kind === "file" ? "打开文件" : "打开文件或文件夹";
          const paths = await openDialog.select({ kind, multiple: false, title }, controller.signal, resource ? options.pickResources : options.pickPaths);
          const items = await remoteSelection(paths);
          controller.signal.throwIfAborted();
          if (!res.destroyed) res.end(JSON.stringify({ items }));
        } catch (error) {
          if (!res.destroyed) { res.writeHead(error instanceof OpenDialogError ? error.status : 500); res.end(JSON.stringify({ error: error instanceof OpenDialogError ? error.message : "无法打开路径选择窗口" })); }
        } finally { req.removeListener("aborted", disconnect); res.removeListener("close", disconnect); }
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
      // Set only after a successful read: missing old chunks must never cache a 404.
      // HTML remains no-store so every navigation discovers the current asset hashes.
      res.setHeader("Cache-Control", route ? "no-store" : assetCacheControl(url.pathname));
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".webmanifest": "application/manifest+json",
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
    await modelProxy.initialize();
    config = await configuration(store.root);
    proxyReady = true;
    // Preparation never opens a window; keep compilation/CLR/COM startup out of the first click.
    // A missing desktop component must not prevent the rest of the service from starting.
    await Promise.all([openDialog.prepare().catch(() => {}), fileManager.prepare().catch(() => {})]);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4317, "127.0.0.1", resolve);
    });
  } catch (error) {
    await Promise.all([previews.close(), openDialog.close(), fileManager.close(), terminal.close(), modelProxy.close(), closeModelNetworks(store.root)]);
    sockets.close();
    await vite?.close();
    attention.close();
    store.close();
    throw error;
  }
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  remoteAccess = new RemoteAccess(origin);
  await remoteAccess.initialize();
  recovery.start();
  updates.start();
  usageLedger.start();
  return {
    origin,
    accessUrl: `${origin}/`,
    store,
    refreshConfiguration,
    agents,
    tasks,
    usageStatistics,
    usageLedger,
    close: async () => {
      shuttingDown = true;
      const usageClosed = usageLedger.close();
      updates.close();
      recovery.pause();
      clearTimeout(proxyRefreshTimer);
      clearTimeout(costTimer); costWorkspaces.clear();
      await previews.close();
      await remoteAccess?.close();
      attention.close();
      await resources.close();
      await opencli.close();
      await rea.close();
      await rtk.close();
      await Promise.all([openDialog.close(), fileManager.close(), terminal.close()]);
      for (const ws of sockets.clients) {
        logins.disconnect(ws);
        ws.terminate();
      }
      sockets.close();
      await Promise.allSettled(inFlight);
      await logins.close();
      store.db.exec("BEGIN IMMEDIATE");
      try { store.recoveries.capture(); store.db.exec("COMMIT"); }
      catch (error) { store.db.exec("ROLLBACK"); throw error; }
      await tasks.close();
      await recovery.close();
      await closeModelNetworks(store.root);
      await modelProxy.close();
      await stopMaintenanceProcesses(store.root);
      maintenance.close();
      await vite?.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        // Tasks and owned operations have settled. Slow/incomplete HTTP clients
        // must not keep the service and its storage lock alive indefinitely.
        server.closeAllConnections();
      });
      await usageClosed;
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
