import { useEffect, useRef, useState } from "react";
import { maintenanceActive, type MaintenanceTask } from "../../shared/maintenance.js";
import { desktopInvoke } from "../pages/desktop-bridge.js";
import { MaintenanceTaskView } from "./MaintenanceView.js";

type History = { tasks: MaintenanceTask[]; error?: string | null };
/** Read-only evidence. Reading old attempts never replays or acknowledges them. */
export function useDesktopMaintenanceHistory(kind: "setup" | "update") {
  const [history, setHistory] = useState<History>({ tasks: [] });
  const [error, setError] = useState("");
  const alive = useRef(false), pending = useRef(false);
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    try {
      const next = await desktopInvoke<History>(kind === "setup" ? "axiom_setup" : "axiom_update", kind === "setup" ? { action: "history" } : { action: "history", version: null });
      if (!next || !Array.isArray(next.tasks)) throw Error("此前维护记录未能读取，请重试；不要重复提交安装。");
      if (alive.current) { setHistory(next); setError(""); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; }
  }
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [kind]);
  return { tasks: history.tasks, error: error || history.error, refresh };
}

export function DesktopUnresolvedTasks({ tasks, currentId, matches, onRefresh }: {
  tasks: MaintenanceTask[]; currentId?: string; matches: (task: MaintenanceTask) => boolean; onRefresh: () => Promise<void>;
}) {
  const unresolved = tasks.filter(task => task.id !== currentId && matches(task) && (maintenanceActive(task) || task.status === "unknown" || task.status === "interrupted"));
  return <>
    {unresolved.length > 0 && <div className="component-unresolved">
      <div className="component-unresolved-toolbar"><button className="maintenance-text-button" onClick={() => void onRefresh()}>重新读取状态</button></div>
      {unresolved.map(task => <MaintenanceTaskView key={task.id} compact task={task} />)}
    </div>}
  </>;
}

export function desktopUpdateOwner(resource: string): "service" | "pi" | "client" {
  return resource.startsWith("pi") ? "pi" : resource === "client" || resource === "installer" ? "client" : "service";
}
