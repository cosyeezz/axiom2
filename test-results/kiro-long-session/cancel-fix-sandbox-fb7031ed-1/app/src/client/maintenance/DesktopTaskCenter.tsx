import { useEffect, useRef, useState } from "react";
import type { MaintenanceBudgets, MaintenanceTask } from "../../shared/maintenance.js";
import { desktopInvoke } from "../pages/desktop-bridge.js";
import { Icon } from "../Icon.js";
import { TaskCenterContent } from "./TaskCenter.js";

type History = { tasks: MaintenanceTask[]; error?: string | null };
export function DesktopTaskCenter({ kind, current, onClose, onSource, onChanged }: {
  kind: "setup" | "update"; current?: MaintenanceTask; onClose: () => void; onSource: (task: MaintenanceTask) => void; onChanged: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null), [error, setError] = useState(""), [connected, setConnected] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  const callbacks = useRef({ onChanged }); callbacks.current = { onChanged };
  async function invoke(action: string, payload?: Record<string, unknown>) {
    return desktopInvoke<History>(kind === "setup" ? "axiom_setup" : "axiom_update", kind === "setup" ? { action, maintenance: payload } : { action, version: payload ? JSON.stringify(payload) : null });
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    try {
      const next = await invoke("history");
      if (!next || !Array.isArray(next.tasks)) throw Error("安装任务记录未能读取，请稍后重试。");
      if (mounted.current) { setHistory(next); setConnected(true); setError(""); }
    } catch (cause) {
      if (mounted.current) { setConnected(false); setError(cause instanceof Error ? cause.message : String(cause)); }
    } finally { pending.current = false; }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [kind]);
  async function control(action: string, task: MaintenanceTask, budgets?: MaintenanceBudgets) {
    await invoke(action, { id: task.id, ...(budgets ? { budgets } : {}) });
    callbacks.current.onChanged(); await refresh();
  }
  const tasks = history?.tasks ?? (current ? [current] : []);
  return <TaskCenterContent tasks={tasks} connected={connected} connectionLabel={connected ? "本机桌面 · 安装任务记录" : error ? "本机安装记录暂不可用" : "正在读取本机安装记录…"} onClose={onClose} onSource={onSource} onCancel={task => control("cancel", task)} onExtend={(task, budgets) => control("extend", task, budgets)} reconcileId={kind === "update" ? current?.id : undefined} onReconcile={kind === "update" ? task => control("reconcile", task) : undefined}>
    {(error || history?.error) && <p className="maintenance-error" role="alert"><Icon name="circle-alert" /><span>{error || history?.error}</span></p>}
    <div className="maintenance-center-footer"><p className="maintenance-note">待核实记录持续保留，读取记录不会重新执行安装。</p><button className="maintenance-text-button" onClick={() => void refresh()}><Icon name="refresh-cw" />重新读取</button></div>
  </TaskCenterContent>;
}
