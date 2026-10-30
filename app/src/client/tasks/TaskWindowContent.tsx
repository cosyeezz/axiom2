import { useEffect, useRef, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import type { TaskWindowField, WindowTaskDescriptor, WindowTaskResultDescriptor } from "../../shared/task-window.js";
import { taskLabels } from "../../shared/tasks.js";
import { Markdown } from "../chat/Markdown.js";
import { useTaskWindowStatus } from "./TaskWindowProvider.js";
import { TaskWindowStore, type TaskFieldChunk } from "./task-window-store.js";

/** The reader is explicit: a parent brief is rendered inside the child's thread,
 * whose contextual provider intentionally belongs to a DIFFERENT task scope. */
export function useTaskField(reader: TaskWindowStore | null, entityKey: string, field: TaskWindowField) {
  const root = useTaskWindowStatus(reader), key = JSON.stringify([entityKey, field]);
  type View = { reader: TaskWindowStore; key: string; data: TaskFieldChunk | null; loading: boolean; error: string };
  const [view, setView] = useState<View | null>(null), latest = useRef(view); latest.current = view;
  const owner = useRef<AbortController | null>(null), pending = useRef(false);
  useEffect(() => {
    if (!reader || !root.page) return;
    const controller = new AbortController(); owner.current = controller;
    const old = latest.current?.key === key ? latest.current.data : null;
    setView({ reader, key, data: old, loading: true, error: "" });
    void reader.field(entityKey, field, controller.signal, old ?? undefined).then(data => {
      if (!controller.signal.aborted) setView({ reader, key, data, loading: false, error: "" });
    }, error => {
      if (!controller.signal.aborted) setView({ reader, key, data: old, loading: false, error: (error as Error).message });
    });
    return () => { controller.abort(); if (owner.current === controller) owner.current = null; pending.current = false; };
  }, [reader, root.page, key, entityKey, field]);
  const shown = view?.key === key ? view : null;
  const current = !!shown?.data && shown.reader === reader && shown.data.revision === root.page?.revision && !shown.error;
  const more = async () => {
    const controller = owner.current, old = latest.current;
    if (!current || !reader || !controller || !old?.data || old.data.next === null || pending.current) return;
    pending.current = true; setView({ ...old, loading: true, error: "" });
    try {
      const data = await reader.moreField(old.data, controller.signal);
      if (!controller.signal.aborted) setView({ ...old, data, loading: false });
    } catch (error) {
      if (!controller.signal.aborted) setView({ ...old, loading: false, error: (error as Error).message });
    } finally { if (owner.current === controller) pending.current = false; }
  };
  return { data: shown?.data ?? null, current, loading: root.loading || !!root.page && !!shown?.loading,
    error: shown?.error || root.error, more, retry: () => reader?.refresh() };
}
export function TaskFieldView({ reader, entityKey, field, label, scope, markdown = false, moreVisible = true }: {
  reader: TaskWindowStore | null; entityKey: string; field: TaskWindowField; label: string; scope?: Scope; markdown?: boolean; moreVisible?: boolean;
}) {
  const value = useTaskField(reader, entityKey, field);
  return <section data-task-field={field}>
    {value.data && (markdown ? <div className="markdown"><Markdown text={value.data.text} pathScope={scope} /></div> : <p style={{ whiteSpace: "pre-wrap" }}>{value.data.text}</p>)}
    {value.loading && <p role="status">正在读取{label}…</p>}
    {value.data && !value.current && <p className="task-call-meta">{label}待同步</p>}
    {value.data?.next != null && <p className="task-call-meta">仅显示部分{label}</p>}
    {value.data?.next != null && moreVisible && <button type="button" className="btn" disabled={!value.current || value.loading} onClick={() => void value.more()}>加载更多{label}</button>}
    {value.error && <p role="alert">{value.error} <button type="button" className="btn" onClick={() => void value.retry()}>重试</button></p>}
  </section>;
}
function TaskWindowReport({ reader, resultKey, scope }: { reader: TaskWindowStore | null; resultKey: string; scope: Scope }) {
  const metadata = useTaskField(reader, resultKey, "metadata");
  let kind: string | null = null;
  if (metadata.data?.next === null) {
    try { const value = JSON.parse(metadata.data.text); kind = value.reportKind === "final" ? "最终回复" : value.reportKind === "partial" ? "部分成果" : value.reportKind === "system" ? "系统执行记录" : null; } catch { /* No label is safer than guessing a result kind. */ }
  }
  return <div data-task-report={resultKey}>
    {kind && <p className="task-call-meta">{kind}</p>}
    <TaskFieldView reader={reader} entityKey={resultKey} field="text" label="报告" scope={scope} markdown />
    <TaskFieldView reader={reader} entityKey={resultKey} field="input" label="交付附注" />
    <TaskFieldView reader={reader} entityKey={resultKey} field="error" label="执行原因" />
    {metadata.error && <p role="alert">{metadata.error}</p>}
  </div>;
}
export function TaskResultPages({ reader, task, revision, current, scope }: {
  reader: TaskWindowStore | null; task: WindowTaskDescriptor; revision: string; current: boolean; scope: Scope;
}) {
  type Row = WindowTaskResultDescriptor & { loadedRevision: string };
  type View = { revision: string; rows: Row[]; previous: number | null; depth: number; loading: boolean; error: string };
  const [view, setView] = useState<View>({ revision: "", rows: [], previous: null, depth: 1, loading: false, error: "" });
  const latest = useRef(view); latest.current = view;
  const [selected, select] = useState("");
  const owner = useRef<AbortController | null>(null), pending = useRef(false);
  useEffect(() => {
    if (!reader || !current) { setView(old => ({ ...old, loading: false })); return; }
    const controller = new AbortController(); owner.current = controller;
    setView(old => ({ ...old, loading: true, error: "" }));
    void (async () => {
      const rows = new Map<string, Row>(latest.current.rows.map(row => [row.resultKey, row]));
      let previous: number | undefined, depth = 0, next: number | null;
      do {
        const page = await reader.results(task, revision, previous, controller.signal);
        for (const row of page.items) rows.set(row.resultKey, { ...row, loadedRevision: revision });
        next = page.previous; previous = next ?? undefined; depth++;
      } while (next !== null && depth < latest.current.depth);
      if (next === null) for (const [key, row] of rows) if (row.loadedRevision !== revision) rows.delete(key);
      if (!controller.signal.aborted) setView({ revision, rows: [...rows.values()].sort((a, b) => a.order - b.order), previous: next, depth, loading: false, error: "" });
    })().catch(error => { if (!controller.signal.aborted) setView(old => ({ ...old, loading: false, error: (error as Error).message })); });
    return () => { controller.abort(); if (owner.current === controller) owner.current = null; pending.current = false; };
  }, [reader, task, revision, current]);
  const more = async () => {
    const controller = owner.current, old = latest.current;
    if (!reader || !current || !controller || old.revision !== revision || old.previous === null || old.loading || pending.current) return;
    pending.current = true; setView({ ...old, loading: true });
    try {
      const page = await reader.results(task, revision, old.previous, controller.signal);
      if (!controller.signal.aborted) {
        const rows = new Map(old.rows.map(row => [row.resultKey, row]));
        for (const row of page.items) rows.set(row.resultKey, { ...row, loadedRevision: revision });
        if (page.previous === null) for (const [key, row] of rows) if (row.loadedRevision !== revision) rows.delete(key);
        setView({ revision, rows: [...rows.values()].sort((a, b) => a.order - b.order), previous: page.previous, depth: old.depth + 1, loading: false, error: "" });
      }
    } catch (error) { if (!controller.signal.aborted) setView({ ...old, loading: false, error: (error as Error).message }); }
    finally { if (owner.current === controller) pending.current = false; }
  };
  return <>
    {task.hasError && <TaskFieldView reader={reader} entityKey={task.taskKey} field="error" label="任务错误" />}
    {view.rows.map(result => <button type="button" className="btn" key={result.resultKey} data-task-result={result.resultKey} onClick={() => select(result.resultKey)}>
      第 {result.order + 1} 次 · {result.status ? taskLabels[result.status] : "状态待确认"}{!current || result.loadedRevision !== revision ? "（待同步）" : ""}
    </button>)}
    {view.loading && <p role="status">正在读取交付目录…</p>}
    {(!current || view.revision !== revision) && view.rows.length > 0 && <p className="task-call-meta">交付目录待同步</p>}
    {view.previous !== null && <button type="button" className="btn" disabled={!current || view.revision !== revision || view.loading} onClick={() => void more()}>加载更早的交付</button>}
    {view.error && <p role="alert">{view.error} <button type="button" className="btn" onClick={() => void reader?.refresh()}>重试</button></p>}
    {selected && <TaskWindowReport key={selected} reader={reader} resultKey={selected} scope={scope} />}
  </>;
}
