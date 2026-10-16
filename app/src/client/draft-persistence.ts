import { useEffect, useSyncExternalStore } from "react";
import { AppError, scopeKey, type Draft, type Scope } from "../shared/protocol.js";
import type { DraftRecord, DraftStamp, DraftWrite } from "../shared/drafts.js";
import { draftContent, getDraft, onDraftChange, restoreDraft } from "./drafts.js";
import { observeConnection, useConnectionState } from "./transport.js";
import { optimisticStart, optimisticState, pendingMessages } from "./chat/optimistic.js";
import { reconcileInputs } from "./chat/reconcile-inputs.js";

type Status = { ready: boolean; saving: boolean; error: string; conflict: boolean };
type Entry = {
  scope: Scope; revision: number; sequence: number; latest?: DraftWrite;
  status: Status; listeners: Set<() => void>; loading?: Promise<void>;
};
const entries = new Map<string, Entry>();
const writer = crypto.randomUUID();
const endpoint = (scope: Scope) => `/api/draft?${new URLSearchParams({ workspaceId: scope.workspaceId, sessionId: scope.sessionId })}`;
function entry(scope: Scope): Entry {
  const key = scopeKey(scope);
  let value = entries.get(key);
  if (!value) {
    value = { scope, revision: 0, sequence: 0, status: { ready: false, saving: false, error: "", conflict: false }, listeners: new Set() };
    entries.set(key, value);
  }
  return value;
}
function status(e: Entry, patch: Partial<Status>) {
  e.status = { ...e.status, ...patch };
  e.listeners.forEach(fn => fn());
}
async function response<T>(result: Response): Promise<T> {
  const value = await result.json();
  if (!result.ok) throw new AppError(value.code ?? "DRAFT_UNAVAILABLE", value.error ?? "草稿未确认保存，请重试。");
  return value as T;
}
async function read(e: Entry) {
  return response<DraftRecord>(await fetch(endpoint(e.scope), { cache: "no-store", signal: AbortSignal.timeout(10_000) }));
}
async function send(e: Entry, write: DraftWrite): Promise<DraftStamp> {
  try {
    const saved = await response<DraftStamp>(await fetch(endpoint(e.scope), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(write), signal: AbortSignal.timeout(10_000),
    }));
    e.revision = Math.max(e.revision, saved.revision);
    if (e.latest === write) status(e, { saving: false, error: "", conflict: false });
    return { revision: saved.revision, writer, sequence: write.sequence };
  } catch (error) {
    if (e.latest === write) status(e, { saving: false,
      error: error instanceof AppError ? error.message : "草稿尚未保存；连接恢复后会重试。",
      conflict: error instanceof AppError && error.code === "DRAFT_CONFLICT" });
    throw error;
  }
}
function write(e: Entry, draft: Draft, submissionId?: string) {
  const value: DraftWrite = { revision: e.revision, writer, sequence: ++e.sequence, draft: draftContent(draft), ...(submissionId ? { submissionId } : {}) };
  e.latest = value;
  status(e, { saving: true, error: "" });
  return value;
}
function restoreRemote(e: Entry, saved: DraftRecord) {
  if (saved.submissionId && saved.submissionStatus !== "failed") {
    if (!pendingMessages(e.scope).some(item => item.id === saved.submissionId)) {
      optimisticStart(e.scope, saved.submissionId, saved.draft);
      optimisticState(e.scope, saved.submissionId, "uncertain");
    }
    restoreDraft(e.scope, { text: "", attachment: null, attachments: [], images: [] });
    void reconcileInputs(e.scope).catch(() => {});
  } else restoreDraft(e.scope, saved.draft);
}
function load(e: Entry) {
  if (e.loading) return e.loading;
  e.loading = (async () => {
    try {
      const saved = await read(e);
      e.revision = saved.revision;
      if (!e.status.ready && !e.latest) restoreRemote(e, saved);
      else if (e.latest && (saved.draft.text || saved.draft.attachments?.length || saved.draft.images?.length)) {
        status(e, { ready: true, saving: false, conflict: true, error: "已保存的草稿与当前输入不同，请选择要保留的内容。" });
        return;
      }
      status(e, { ready: true, error: "", conflict: false });
      if (e.latest) {
        e.latest = { ...e.latest, revision: e.revision };
        await send(e, e.latest);
      }
    } catch (error) {
      status(e, { error: error instanceof AppError ? error.message : "无法读取草稿，请连接服务后重试。" });
    } finally { e.loading = undefined; }
  })();
  return e.loading;
}
onDraftChange((scope, draft) => {
  const e = entry(scope);
  const value = write(e, draft);
  if (!e.status.ready || e.status.conflict) { status(e, { saving: false }); return; }
  // No trailing debounce: normal typing starts a write immediately. Sequence guards
  // make concurrent HTTP completion and the close-time fallback harmless.
  void send(e, value).catch(() => {});
});
let connectionGeneration = -1;
observeConnection(connection => {
  if (!connection.connected || connection.generation === connectionGeneration) return;
  connectionGeneration = connection.generation;
  for (const e of entries.values()) {
    if (!e.status.ready) void load(e);
    else if (e.latest && !e.status.conflict && (e.status.saving || e.status.error)) void send(e, e.latest).catch(() => {});
  }
});
export function usePersistentDraft(scope: Scope) {
  const e = entry(scope);
  const connection = useConnectionState();
  const current = useSyncExternalStore(fn => { e.listeners.add(fn); return () => { e.listeners.delete(fn); }; }, () => e.status);
  useEffect(() => {
    if (connection.connected) {
      if (!e.status.ready) void load(e);
      else if (e.latest && !e.status.conflict && (e.status.saving || e.status.error)) void send(e, e.latest).catch(() => {});
    }
  }, [e, connection.connected, connection.generation]);
  return current;
}
export async function resolveDraftConflict(scope: Scope, keepLocal: boolean) {
  const e = entry(scope), sequence = e.sequence;
  try {
    const remote = await read(e);
    // A user can continue typing while the read is in flight. Never replace that input.
    if (!keepLocal && e.sequence !== sequence) return;
    e.revision = remote.revision;
    if (keepLocal) {
      status(e, { conflict: false });
      await send(e, write(e, getDraft(scope)));
    } else {
      e.latest = undefined;
      restoreRemote(e, remote);
      status(e, { ready: true, saving: false, error: "", conflict: false });
    }
  } catch (error) { status(e, { error: (error as Error).message }); }
}
export function prepareDraftSubmission(scope: Scope, draft: Draft, submissionId: string): DraftStamp {
  const e = entry(scope), value = write(e, draft, submissionId);
  // Draft persistence is best-effort. The prompt must never wait for its HTTP request.
  // A late save carries the request ID so the server can reconcile its durable receipt.
  if (e.status.ready && !e.status.conflict) void send(e, value).catch(() => {});
  else if (!e.status.ready) void load(e);
  return { revision: value.revision, writer, sequence: value.sequence };
}
export function completeDraftSubmission(scope: Scope, stamp: DraftStamp) {
  const e = entry(scope);
  if (e.latest?.sequence === stamp.sequence && e.status.ready && !e.status.conflict && !e.status.saving && !e.status.error) {
    e.latest = undefined;
    status(e, { saving: false, error: "", conflict: false });
  }
}
if (typeof window !== "undefined") {
  const flush = () => {
    for (const e of entries.values()) {
      if (!e.latest || e.status.conflict || !e.status.ready || (!e.status.saving && !e.status.error)) continue;
      const body = JSON.stringify(e.latest);
      // Browser keepalive has a shared 64 KiB budget. Large attachments are saved
      // during editing; never pretend an oversized unload request was durable.
      if (new TextEncoder().encode(body).length > 60_000) continue;
      void fetch(endpoint(e.scope), { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}
