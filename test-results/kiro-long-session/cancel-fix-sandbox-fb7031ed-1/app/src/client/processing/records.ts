import { useCallback, useEffect, useSyncExternalStore } from "react";
import { command, scopeCurrent, scopeOrder, scopeSnapshot, useConnectionState, useScopeOrder } from "../transport.js";
import { processingScope, type ProcessingList, type ProcessingRecord } from "../../shared/processing.js";

type Snapshot = { data?: unknown; error: string; loading: boolean };
type Entry = { workspaceId: string; op: string; params: Record<string, unknown>; snapshot: Snapshot; listeners: Set<() => void>; stamp?: string; wanted?: string; busy: boolean; serial: number };
const entries = new Map<string, Entry>();
function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    const [workspaceId, op, params] = JSON.parse(key) as [string, string, Record<string, unknown>];
    entry = { workspaceId, op, params, snapshot: { error: "", loading: false }, listeners: new Set(), busy: false, serial: 0 };
    entries.set(key, entry);
  }
  // Bound retained, unmounted details (which can contain large payloads).
  entries.delete(key); entries.set(key, entry);
  const unused = [...entries].filter(([, value]) => !value.listeners.size && !value.busy);
  for (const [oldest] of unused.slice(0, Math.max(0, unused.length - 12))) entries.delete(oldest);
  return entry;
}
function update(entry: Entry, snapshot: Snapshot) { entry.snapshot = snapshot; entry.listeners.forEach(listener => listener()); }
function clearWorkspace(workspaceId: string) {
  for (const entry of entries.values()) if (entry.workspaceId === workspaceId && (entry.snapshot.data !== undefined || entry.snapshot.error !== "处理记录暂不可用，请检查工作空间授权")) {
    entry.serial++; entry.stamp = undefined; entry.wanted = undefined;
    update(entry, { error: "处理记录暂不可用，请检查工作空间授权", loading: false });
  }
}
function available(workspaceId: string) {
  const scope = processingScope(workspaceId);
  return scopeCurrent(scope) && scopeSnapshot(scope) != null;
}
function load(entry: Entry, stamp: string, force = false) {
  if (!available(entry.workspaceId) || !force && entry.stamp === stamp) return;
  entry.wanted = stamp;
  if (entry.busy) return;
  entry.busy = true;
  const serial = ++entry.serial, requestedOrder = scopeOrder(processingScope(entry.workspaceId));
  const stillCurrent = () => serial === entry.serial && entry.wanted === stamp && available(entry.workspaceId)
    && scopeOrder(processingScope(entry.workspaceId)) === requestedOrder;
  update(entry, { ...entry.snapshot, loading: true });
  void command(entry.op, entry.params, { workspaceId: entry.workspaceId }).then(data => {
    if (stillCurrent()) {
      entry.stamp = stamp; update(entry, { data, error: "", loading: false });
    }
  }).catch(error => {
    if (!stillCurrent()) return;
    if (error.code === "AUTHORIZATION_REQUIRED") clearWorkspace(entry.workspaceId);
    else if (error.code === "SCOPE_MISMATCH" || error.code === "NOT_FOUND") {
      // In particular, do not keep a removed/migrated source's old detail visible.
      update(entry, { error: error.message, loading: false });
    } else update(entry, { ...entry.snapshot, error: error.message, loading: false });
  }).finally(() => {
    entry.busy = false;
    if (serial === entry.serial && entry.snapshot.loading) update(entry, { ...entry.snapshot, loading: false });
    const next = entry.wanted;
    if (next && next !== stamp && entry.listeners.size && available(entry.workspaceId)) load(entry, next);
  });
}
function useRecordRead<T>(workspaceId: string | null, op: string, params: Record<string, unknown>) {
  const serialized = JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))));
  const key = JSON.stringify([workspaceId ?? "", op, JSON.parse(serialized)]), entry = entryFor(key);
  const order = useScopeOrder(workspaceId ? processingScope(workspaceId) : null), connection = useConnectionState();
  const listen = useCallback((listener: () => void) => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; }, [entry]);
  const snapshot = useSyncExternalStore(listen, () => entry.snapshot);
  const scope = workspaceId ? processingScope(workspaceId) : "", current = !!workspaceId && available(workspaceId);
  const unavailable = !!workspaceId && scopeCurrent(scope) && scopeSnapshot(scope) === null;
  const stamp = `${connection.generation}:${order}`;
  useEffect(() => {
    if (unavailable) clearWorkspace(workspaceId!);
    else if (current) load(entry, stamp);
  }, [entry, workspaceId, stamp, current, unavailable]);
  return { data: (unavailable ? undefined : snapshot.data) as T | undefined, error: unavailable ? "处理记录暂不可用，请检查工作空间授权" : snapshot.error,
    loading: snapshot.loading || !!workspaceId && !snapshot.data && !snapshot.error && !unavailable,
    stale: !connection.connected || !current || entry.stamp !== stamp, refresh: () => { if (current) load(entry, stamp, true); } };
}
/** One shared read per workspace/filter/revision; no timer and never a model command. */
export function useProcessingList(workspaceId: string | null, filters: Record<string, unknown> = {}) {
  return useRecordRead<ProcessingList>(workspaceId, "processing.list", filters);
}
export function useProcessingRecord(workspaceId: string | null, id: string | null) {
  return useRecordRead<ProcessingRecord>(id ? workspaceId : null, "processing.get", { id });
}
