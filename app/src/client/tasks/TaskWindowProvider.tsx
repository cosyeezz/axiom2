import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppError, type Scope } from "../../shared/protocol.js";
import { taskWindowScope, type TaskWindowData } from "../../shared/task-window.js";
import { command, observeConnection, scopeAuthority, scopeOrder, subscribeScope, useConnectionState } from "../transport.js";
import { TaskWindowStore, taskWindowActive, type AnchorFrame, type TaskInspection, type TaskWindowStatus } from "./task-window-store.js";

const Context = createContext<{ key: string; model: TaskWindowStore | null } | null>(null);
const empty: AnchorFrame = { page: null, rows: [], previous: null, loading: false, error: "", current: false };
const idle: TaskWindowStatus = { page: null, loading: false, error: "" };
const keyOf = (scope: Scope | null) => scope ? JSON.stringify([scope.workspaceId, scope.sessionId]) : "";

/** Effect-owned connection lease. One parent scope shares a cut across cards;
 * StrictMode cleanup cannot leave a disposed memoized reader installed. */
export function TaskWindowProvider({ scope, children }: { scope: Scope | null; children: ReactNode }) {
  const parent = useContext(Context);
  // Reserve the scope even before the effect creates its reader. Nested providers
  // (main thread under TaskViews) must not race to open separate cuts.
  if (parent?.key === keyOf(scope)) return <>{children}</>;
  return <OwnedTaskWindowProvider scope={scope}>{children}</OwnedTaskWindowProvider>;
}
function OwnedTaskWindowProvider({ scope, children }: { scope: Scope | null; children: ReactNode }) {
  const connection = useConnectionState(), key = keyOf(scope);
  const live = useRef({ key, connection }); live.current = { key, connection };
  const [view, setView] = useState<{ key: string; generation: number; model: TaskWindowStore } | null>(null);
  const displayed = useRef(view); displayed.current = view;
  useEffect(() => {
    if (!scope || !connection.connected) return;
    const generation = connection.generation, target = { ...scope };
    const valid = () => live.current.key === key && live.current.connection.connected && live.current.connection.generation === generation;
    const old = displayed.current;
    const model = new TaskWindowStore(async (query, signal) => {
      if (!valid()) throw new AppError("CANCELLED", "任务读取已取消");
      const result = await command<TaskWindowData>("task.window", { query }, target, undefined, signal);
      if (!valid()) throw new AppError("CANCELLED", "任务读取已取消");
      return result;
    }, old?.key === key ? old.model.cached() : undefined);
    setView({ key, generation, model });
    const stopConnection = observeConnection(state => {
      if (!state.connected || state.generation !== generation) model.dispose();
    });
    const name = taskWindowScope(target); let order = scopeOrder(name);
    const delivered = () => {
      if (!valid()) return;
      const next = scopeOrder(name), hint = scopeAuthority<{ revision: number }>(name);
      if (next <= order || !hint || !Number.isSafeInteger(hint.revision)) return;
      order = next; model.invalidate();
    };
    const stopScope = subscribeScope(name, delivered); delivered();
    return () => { stopConnection(); stopScope(); model.dispose(); };
  }, [key, connection.connected, connection.generation]);
  const shown = view?.key === key ? view : null;
  return <Context.Provider value={{ key, model: shown?.model ?? null }}>{children}</Context.Provider>;
}

export function useTaskWindowModel(scope: Scope | null) {
  const context = useContext(Context);
  return context?.key === keyOf(scope) ? context.model : null;
}
export function useTaskWindowStatus(model: TaskWindowStore | null) {
  const subscribe = useCallback((fn: () => void) => model?.subscribe(fn) ?? (() => {}), [model]);
  const snapshot = useCallback(() => model?.status() ?? idle, [model]);
  const root = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => model?.acquireReader(), [model]);
  return root;
}
export function useTaskActivity(scope: Scope | null) {
  const model = useTaskWindowModel(scope), root = useTaskWindowStatus(model);
  return { active: taskWindowActive(root), error: root.error, retry: () => model?.refresh() };
}
export function useTaskAnchorWindow(scope: Scope, anchor: string) {
  const context = useContext(Context), model = context?.key === keyOf(scope) ? context.model : null;
  const subscribe = useCallback((fn: () => void) => model?.subscribe(fn) ?? (() => {}), [model]);
  const snapshot = useCallback(() => model?.snapshot(anchor) ?? empty, [model, anchor]);
  const frame = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => model?.acquire(anchor), [model, anchor]);
  return { ...frame, more: () => model?.more(anchor), retry: () => model?.refresh(),
    target: (taskKey: string) => model ? model.target(taskKey) : Promise.reject(new AppError("UNAVAILABLE", "任务窗口尚未连接")) };
}

export function useTaskInspection(scope: Scope, reference: string, inputReference: string | undefined, withError: boolean) {
  const context = useContext(Context), model = context?.key === keyOf(scope) ? context.model : null;
  const subscribe = useCallback((fn: () => void) => model?.subscribe(fn) ?? (() => {}), [model]);
  const snapshot = useCallback(() => model?.status() ?? idle, [model]);
  const root = useSyncExternalStore(subscribe, snapshot);
  const key = JSON.stringify([keyOf(scope), reference, inputReference]);
  type View = { key: string; model: TaskWindowStore; revision: string; data: TaskInspection | null; loading: boolean; error: string };
  const [view, setView] = useState<View | null>(null), latest = useRef(view); latest.current = view;
  const owner = useRef<{ model: TaskWindowStore; revision: string; controller: AbortController } | null>(null);
  const morePending = useRef(false);
  useEffect(() => reference ? model?.acquireReader() : undefined, [model, reference]);
  useEffect(() => {
    if (!model || !root.page || !reference) return;
    const revision = root.page.revision, controller = new AbortController(), lease = { model, revision, controller };
    owner.current = lease;
    const old = latest.current;
    const ready = old?.key === key && old.model === model && old.revision === revision && old.data?.revision === revision && !old.loading && !old.error;
    const cached = ready && (!withError || !old.data?.input?.hasError || old.data.inputError);
    if (!cached) {
      setView({ key, model, revision, data: old?.key === key ? old.data : null, loading: true, error: "" });
      void model.inspect(reference, inputReference, withError, controller.signal).then(data => {
        if (!controller.signal.aborted && owner.current === lease) setView({ key, model, revision, data, loading: false, error: "" });
      }, error => {
        if (!controller.signal.aborted && owner.current === lease) setView(previous => ({ key, model, revision,
          data: previous?.key === key ? previous.data : null, loading: false, error: (error as Error).message }));
      });
    }
    return () => { controller.abort(); if (owner.current === lease) owner.current = null; morePending.current = false; };
  }, [model, root.page, key, reference, inputReference, withError]);
  const shown = view?.key === key ? view : null;
  const current = !!shown?.data && shown.model === model && shown.data.revision === root.page?.revision && !shown.loading && !shown.error;
  const moreError = async () => {
    const lease = owner.current, previous = latest.current, field = previous?.data?.inputError;
    if (!lease || !field || field.next === null || morePending.current || field.revision !== lease.revision) return;
    morePending.current = true;
    setView(value => value && value === previous ? { ...value, loading: true, error: "" } : value);
    try {
      const next = await lease.model.errorChunk(field, lease.controller.signal);
      if (!lease.controller.signal.aborted && owner.current === lease)
        setView(value => value?.data?.inputError === field ? { ...value, data: { ...value.data, inputError: next }, loading: false } : value);
    } catch (error) {
      if (!lease.controller.signal.aborted && owner.current === lease)
        setView(value => value?.data?.inputError === field ? { ...value, loading: false, error: (error as Error).message } : value);
    } finally { if (owner.current === lease) morePending.current = false; }
  };
  return { revision: shown?.data?.revision ?? null, task: shown?.data?.task ?? null, receipt: shown?.data?.input ?? null, inputError: shown?.data?.inputError ?? null,
    current, loading: root.loading || !!shown?.loading && shown.revision === root.page?.revision, error: shown?.error || root.error,
    moreError, retry: () => model?.refresh(),
    target: (taskKey: string) => model ? model.target(taskKey) : Promise.reject(new AppError("UNAVAILABLE", "任务窗口尚未连接")) };
}
