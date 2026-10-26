import { useEffect, type RefObject } from "react";
import { command, renderedContextReady, useConnectionState, useScope } from "../transport.js";
import { running, type AgentInfo, type ThreadIndex } from "../../shared/agent.js";
import { emptyTasks, tasksScope } from "../../shared/tasks.js";
import type { Scope } from "../../shared/protocol.js";

/** Confirm viewing the current session tail, not the agent's consumption of task results. */
export function useReadReceipt(scope: Scope | null, index: ThreadIndex, info: AgentInfo, atBottom: boolean, scroller: RefObject<HTMLElement | null>) {
  const connection = useConnectionState();
  const tasks = useScope(scope ? tasksScope(scope) : null, emptyTasks);
  useEffect(() => {
    const version = index.resultVersion ?? 0;
    if (!scope?.sessionId || !connection.connected || index.error || !atBottom || version <= (index.readVersion ?? 0)) return;
    let disposed = false, sending = false, acknowledged = false;
    const confirm = () => {
      if (disposed || sending || acknowledged || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const view = scroller.current;
      if (!view || view.scrollHeight - view.scrollTop - view.clientHeight > 3) return;
      const bounds = view.getBoundingClientRect();
      const visible = document.elementFromPoint(bounds.left + bounds.width / 2, Math.min(bounds.bottom - 4, innerHeight - 1));
      if (!visible || !view.contains(visible)) return; // Modal/overlay or a hidden conversation is not reading.
      if (index.runId !== info.run?.id || index.runStatus !== info.run?.status ||
          !renderedContextReady(scope, index.ids, !running(info.run))) return;
      // Wait for matching immutable task results to synchronize. Their cards may
      // be folded, archived or virtualized; DOM presence is not read evidence.
      if (index.resultTasks?.some((ref) => !tasks.tasks.some((task) => task.id === ref.taskId &&
          task.results.some((result) => result.id === ref.resultId)))) return;
      sending = true;
      void command("session.read", { throughVersion: version }, scope).then(() => {
        acknowledged = true;
      }).catch(() => { /* Retry only this monotonic acknowledgement, never an agent operation. */ })
        .finally(() => { sending = false; });
    };
    // Effects run after React commits; a frame lets the visible results paint.
    const frame = requestAnimationFrame(confirm);
    const timer = setInterval(confirm, 1000);
    window.addEventListener("focus", confirm);
    document.addEventListener("visibilitychange", confirm);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("focus", confirm);
      document.removeEventListener("visibilitychange", confirm);
    };
  }, [scope?.workspaceId, scope?.sessionId, connection, index, info.run?.id, info.run?.status, tasks, atBottom, scroller]);
}
