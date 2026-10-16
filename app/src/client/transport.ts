import { useCallback, useSyncExternalStore } from "react";
import { clearOptimistic, reconcileOptimistic } from "./chat/optimistic.js";
import type { ChatMessage } from "../shared/agent.js";
import {
  AppError,
  type Command,
  type Reply,
  type Snapshot,
} from "../shared/protocol.js";

const cache = new Map<
  string,
  { streamId: string; seq: number; data: unknown; generation?: number; received?: number }
>();
let received = 0;
const listeners = new Map<string, Set<() => void>>();
const sessionLru = new Map<string, true>();
const remote = new Map<string, number>();
const wireScope = (scope: string) => scope.startsWith("message:")
  ? scope.split(":").slice(0, 3).join(":").replace(/^message:/, "messages:") : scope;
const pinned = (key: string) => [...listeners.keys()].some((scope) => sessionKey(scope) === key);
function sessionKey(scope: string) {
  const parts = scope.split(":");
  return ["agent", "thread", "message", "messages", "session", "compression", "tasks", "costs"].includes(parts[0]) && parts.length >= 3
    ? `${parts[1]}:${parts[2]}` : null;
}
function touchSession(scope: string) {
  const key = sessionKey(scope);
  if (!key) return;
  sessionLru.delete(key); sessionLru.set(key, true);
  while (sessionLru.size > 5) {
    const oldest = [...sessionLru.keys()].find((candidate) => candidate !== key && !pinned(candidate));
    if (!oldest) break;
    sessionLru.delete(oldest);
    for (const name of cache.keys()) if (sessionKey(name) === oldest) cache.delete(name);
  }
}
const pending = new Map<
  string,
  {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let socket: WebSocket | undefined;
let status = "正在连接本地服务…";
let connection = { connected: false, generation: 0 };
export type ConnectionHealth = "checking" | "connected" | "disconnected";
let phase: ConnectionHealth = "checking";
let lastResponse = 0;
let connecting = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let probing: WebSocket | undefined;
/** A diagnostic error is not a disconnect. Only current-socket input renews this evidence. */
export function connectionHealth(now = Date.now()): ConnectionHealth {
  if (phase === "disconnected") return "disconnected";
  return connection.connected && lastResponse > 0 && now >= lastResponse && now - lastResponse < 15_000
    ? "connected" : "checking";
}
function probeConnection() {
  const current = socket;
  if (!current || current.readyState !== WebSocket.OPEN || probing === current) return;
  probing = current;
  void command("ping").catch(() => {}).finally(() => { if (probing === current) probing = undefined; });
}
if (typeof window !== "undefined") {
  window.addEventListener("axiom-connection-request", (event) => {
    const probe: unknown = (event as CustomEvent).detail;
    const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (name: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
    if (!bridge || !Number.isSafeInteger(probe) || (probe as number) < 1) return;
    void bridge.invoke("axiom_connection_report", { probe, state: connectionHealth() }).catch(() => {});
  });
  const resume = () => { if (document.visibilityState === "visible") probeConnection(); };
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
}
const statusListeners = new Set<() => void>();
function setStatus(value: string) {
  status = value;
  statusListeners.forEach((fn) => fn());
}
const subscribeConnection = (fn: () => void) => {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
};
/** Observe lifecycle without tying durable background saves to a mounted composer. */
export function observeConnection(fn: (state: Readonly<typeof connection>) => void) {
  return subscribeConnection(() => fn(connection));
}
/** Socket lifecycle is independent of diagnostic text such as subscription errors. */
export function useConnectionState() {
  return useSyncExternalStore(subscribeConnection, () => connection);
}
export function useConnection() {
  return useSyncExternalStore(
    (fn) => {
      statusListeners.add(fn);
      return () => {
        statusListeners.delete(fn);
      };
    },
    () => status,
  );
}

export function command<T>(
  op: string,
  params: Record<string, unknown> = {},
  target: { workspaceId?: string; sessionId?: string } = {},
  requestId: string = crypto.randomUUID(),
): Promise<T> {
  if (socket?.readyState !== WebSocket.OPEN)
    return Promise.reject(new AppError("DISCONNECTED", "尚未连接，操作未发送"));
  const value: Command = { requestId, op, ...target, params };
  const payload = JSON.stringify(value);
  // Attachment-bearing commands match the bounded server frame budget; configuration stays small.
  const attachmentCommand = ["prompt", "files.upload"].includes(op);
  const limit = attachmentCommand ? 22 * 1024 * 1024 : 200_000;
  if (new TextEncoder().encode(payload).byteLength > limit)
    return Promise.reject(
      new AppError(
        "PAYLOAD_TOO_LARGE",
        `请求超过 ${attachmentCommand ? "22 MiB" : "200 KB"}；操作未发送，请减少条目或附件。`,
      ),
    );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(
        new AppError(
          "UNCERTAIN",
          "请求超时，未收到服务端响应；操作可能已执行，不会自动重发。",
        ),
      );
    }, 15000);
    pending.set(requestId, {
      resolve: (data) => {
        if (op === "session.delete" && target.workspaceId && target.sessionId) {
          clearOptimistic({ workspaceId: target.workspaceId, sessionId: target.sessionId });
          void import("./chat/reconcile-inputs.js").then(({ clearInputRecovery }) => clearInputRecovery({ workspaceId: target.workspaceId!, sessionId: target.sessionId! }));
        }
        resolve(data as T);
      },
      reject,
      timer,
    });
    try {
      socket!.send(payload);
    } catch (error) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(error);
    }
  });
}
export function acceptSnapshot(event: Snapshot) {
  if (sessionKey(event.scope) && !remote.has(wireScope(event.scope))) return;
  if (event.scope.startsWith("messages:")) {
    const previous = cache.get(event.scope);
    if (previous?.streamId === event.streamId && previous.seq >= event.seq) return;
    const [, workspaceId, sessionId] = event.scope.split(":");
    const messages = (event.data ?? []) as ChatMessage[];
    reconcileOptimistic({ workspaceId, sessionId }, messages);
    const prefix = `message:${workspaceId}:${sessionId}:`;
    const ids = new Set(messages.map((message) => prefix + message.id));
    for (const name of cache.keys()) if (name.startsWith(prefix) && !ids.has(name)) {
      cache.delete(name); listeners.get(name)?.forEach((fn) => fn());
    }
    for (const message of messages) acceptSnapshot({ ...event, scope: prefix + message.id, data: message });
    cache.set(event.scope, { ...event, data: null, generation: connection.generation, received: ++received });
    listeners.get(event.scope)?.forEach((fn) => fn());
    return;
  }
  if (event.scope.startsWith("message:") && event.data) {
    const [, workspaceId, sessionId] = event.scope.split(":");
    reconcileOptimistic({ workspaceId, sessionId }, [event.data as ChatMessage]);
  }
  const previous = cache.get(event.scope);
  if (previous?.streamId === event.streamId && previous.seq >= event.seq)
    return;
  if (event.scope.startsWith("session:") && event.data === null) {
    const [, workspaceId, sessionId] = event.scope.split(":");
    clearOptimistic({ workspaceId, sessionId });
  }
  touchSession(event.scope);
  cache.set(event.scope, { ...event, generation: connection.generation, received: ++received });
  listeners.get(event.scope)?.forEach((fn) => fn());
}
export function subscribeScope(scope: string, fn: () => void) {
  const key = sessionKey(scope);
  if (key && !pinned(key) && new Set([...listeners.keys()].map(sessionKey).filter(Boolean)).size >= 5) {
    setStatus("同时展示的会话不能超过 5 个；请关闭其他会话后重新打开。");
    return () => {};
  }
  touchSession(scope);
  let group = listeners.get(scope);
  if (!group) {
    group = new Set();
    listeners.set(scope, group);
    const wire = wireScope(scope), count = remote.get(wire) ?? 0;
    remote.set(wire, count + 1);
    const current = socket;
    if (!count) void command("subscribe", { scope: wire }).catch((error) => {
      if (socket === current && current?.readyState === WebSocket.OPEN && remote.has(wire)) setStatus(`订阅读取失败：${error.message}；请重新连接或打开会话。`);
    });
  }
  group.add(fn);
  return () => {
    group!.delete(fn);
    if (!group!.size) {
      listeners.delete(scope);
      const wire = wireScope(scope), count = (remote.get(wire) ?? 1) - 1;
      if (count) remote.set(wire, count);
      else { remote.delete(wire); void command("unsubscribe", { scope: wire }).catch(() => {}); }
    }
  };
}
export function scopeOrder(scope: string) { return cache.get(scope)?.received ?? 0; }
/** A reconnect must deliver fresh context before old cached content can confirm reading. */
export function renderedContextReady(scope: { workspaceId: string; sessionId: string }, ids: string[], terminal: boolean) {
  const suffix = `${scope.workspaceId}:${scope.sessionId}`;
  if (cache.get(`messages:${suffix}`)?.generation !== connection.generation ||
      cache.get(`thread:${suffix}`)?.generation !== connection.generation ||
      cache.get(`agent:${suffix}`)?.generation !== connection.generation) return false;
  return ids.every((id) => {
    const message = cache.get(`message:${suffix}:${id}`)?.data as ChatMessage | undefined;
    return !!message && (!terminal || !message.streaming);
  });
}
export function scopeSnapshot<T>(scope: string): T | undefined { return cache.get(scope)?.data as T | undefined; }
export function useScope<T>(scope: string | null, fallback: T): T {
  const listen = useCallback(
    (fn: () => void) => (scope ? subscribeScope(scope, fn) : () => {}),
    [scope],
  );
  return useSyncExternalStore(
    listen,
    () =>
      (scope ? (cache.get(scope)?.data as T | undefined) : undefined) ??
      fallback,
  );
}
export async function connect() {
  // One fetch/socket/retry at a time; repeated callers cannot replace a healthy connection.
  if (connecting || socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  connecting = true;
  clearTimeout(retry);
  const reconnect = () => { clearTimeout(retry); retry = setTimeout(() => void connect(), 1500); };
  try {
    const response = await fetch("/api/status", { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!response.ok) throw Error("本地服务尚未就绪");
    const current = new WebSocket(location.origin.replace(/^http/, "ws") + "/ws");
    socket = current;
    lastResponse = 0;
    const owns = () => socket === current;
    current.onopen = () => {
      if (!owns()) return;
      phase = "checking";
      connection = { connected: true, generation: connection.generation + 1 };
      setStatus("已连接本地服务");
      // The server's hello (or a valid receipt) confirms actual response evidence.
      for (const scope of remote.keys())
        void command("subscribe", { scope }).catch((error) => {
          if (owns() && current.readyState === WebSocket.OPEN && remote.has(scope)) setStatus(`订阅读取失败：${error.message}；请重新打开会话。`);
        });
      if (typeof window !== "undefined") {
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (owns() && Date.now() - lastResponse >= 5000) probeConnection();
        }, 3000);
      }
    };
    current.onmessage = (e) => {
      if (!owns() || current.readyState !== WebSocket.OPEN) return;
      let value: Snapshot | Reply | { type: "hello"; streamId: string };
      try { value = JSON.parse(e.data); } catch { return; }
      if (!value || typeof value !== "object") return;
      if (value.type === "hello" && typeof value.streamId === "string" ||
          value.type === "snapshot" && typeof value.scope === "string" && typeof value.streamId === "string" && Number.isFinite(value.seq) ||
          value.type === "receipt" && typeof value.requestId === "string" && typeof value.ok === "boolean") {
        lastResponse = Date.now(); phase = "connected";
      } else return;
      if (value.type === "snapshot") acceptSnapshot(value);
      if (value.type === "receipt") {
        const waiting = pending.get(value.requestId);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        pending.delete(value.requestId);
        if (value.ok) waiting.resolve(value.data);
        else waiting.reject(new AppError(value.error.code, value.error.message));
      }
    };
    current.onclose = () => {
      if (!owns()) return;
      clearInterval(heartbeat);
      probing = undefined;
      lastResponse = 0; phase = "disconnected";
      connection = { ...connection, connected: false };
      setStatus("连接已断开，正在重连；不会自动重发操作。");
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new AppError("UNCERTAIN", "连接中断，未收到服务端响应；操作可能已执行，不会自动重发。"));
      }
      pending.clear();
      reconnect();
    };
  } catch {
    phase = "disconnected";
    setStatus("无法连接本地服务，正在重试；不会自动重发操作。");
    reconnect();
  } finally { connecting = false; }
}
