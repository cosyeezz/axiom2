import { useCallback, useSyncExternalStore } from 'react';
import { AppError, type Command, type Reply, type Snapshot } from '../shared/protocol.js';

const cache = new Map<string, { streamId: string; seq: number; data: unknown }>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let socket: WebSocket | undefined;
let status = '正在连接本地服务…';
const statusListeners = new Set<() => void>();
function setStatus(value: string) { status = value; statusListeners.forEach(fn => fn()); }
export function useConnection() { return useSyncExternalStore(fn => { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; }, () => status); }

export function command<T>(op: string, params: Record<string, unknown> = {}, target: { workspaceId?: string; sessionId?: string } = {}, requestId = crypto.randomUUID()): Promise<T> {
  if (socket?.readyState !== WebSocket.OPEN) return Promise.reject(new AppError('DISCONNECTED', '尚未连接，操作未发送'));
  const value: Command = { requestId, op, ...target, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new AppError('UNCERTAIN', `请求状态待核实（${requestId}）；请重新读取，勿重复提交。`)); }, 15000);
    pending.set(requestId, { resolve: data => resolve(data as T), reject, timer });
    socket!.send(JSON.stringify(value));
  });
}
export function acceptSnapshot(event: Snapshot) {
  const previous = cache.get(event.scope);
  if (previous?.streamId === event.streamId && previous.seq >= event.seq) return;
  cache.set(event.scope, event);
  listeners.get(event.scope)?.forEach(fn => fn());
}
function subscribe(scope: string, fn: () => void) {
  let group = listeners.get(scope);
  if (!group) { group = new Set(); listeners.set(scope, group); void command('subscribe', { scope }).catch(() => {}); }
  group.add(fn);
  return () => { group!.delete(fn); if (!group!.size) { listeners.delete(scope); void command('unsubscribe', { scope }).catch(() => {}); } };
}
export function useScope<T>(scope: string | null, fallback: T): T {
  const listen = useCallback((fn: () => void) => scope ? subscribe(scope, fn) : () => {}, [scope]);
  return useSyncExternalStore(listen, () => (scope ? cache.get(scope)?.data as T | undefined : undefined) ?? fallback);
}
export async function connect() {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) {
      history.replaceState(null, '', location.pathname + location.search);
      const response = await fetch('/api/access', { method: 'POST', headers: { 'X-Axiom-Access': token } });
      if (!response.ok) throw Error();
    }
    const response = await fetch('/api/status');
    if (!response.ok) { setStatus('需要本地访问授权：请打开服务启动时显示的访问链接。'); return; }
  } catch { setStatus('无法连接本地服务，请检查服务是否启动。'); return; }
  socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws');
  socket.onopen = () => {
    setStatus('已连接本地服务');
    for (const scope of listeners.keys()) void command('subscribe', { scope }).catch(error => setStatus(error.message));
  };
  socket.onmessage = e => {
    const value = JSON.parse(e.data) as Snapshot | Reply;
    if (value.type === 'snapshot') acceptSnapshot(value);
    if (value.type === 'receipt') {
      const waiting = pending.get(value.requestId); if (!waiting) return;
      clearTimeout(waiting.timer); pending.delete(value.requestId);
      if (value.ok) waiting.resolve(value.data); else waiting.reject(new AppError(value.error.code, value.error.message));
    }
  };
  socket.onclose = () => {
    setStatus('连接已断开，正在重连；不会自动重发操作。');
    for (const [id, waiting] of pending) { clearTimeout(waiting.timer); waiting.reject(new AppError('UNCERTAIN', `连接中断，请求 ${id} 状态待核实，请重新读取后确认。`)); }
    pending.clear();
    setTimeout(() => void connect(), 1500);
  };
}
