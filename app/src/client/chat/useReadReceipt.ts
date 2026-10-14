import { useEffect, type RefObject } from "react";
import { command, renderedContextReady, useConnectionState, useScope } from "../transport.js";
import { running, type AgentInfo, type ThreadIndex } from "../../shared/agent.js";
import { emptyTasks, tasksScope } from "../../shared/tasks.js";
import type { Scope } from "../../shared/protocol.js";

/** Presence does not imply reading. Confirm only the version rendered at the end of this view. */
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
      // A task completion can arrive before its parent transcript. Wait for the
      // matching immutable result to reach the task cards, not just the sidebar.
      if (index.resultTasks?.some((ref) => !tasks.tasks.some((task) => task.id === ref.taskId &&
          task.results.some((result) => result.id === ref.resultId)))) return;
      if (index.resultTasks?.some((ref) => {
        const notice = view.querySelector(`[data-result-id="${CSS.escape(ref.resultId)}"]`);
        const card = view.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(ref.taskId)}"]`);
        return !notice && (!card || !(JSON.parse(card.dataset.resultIds ?? "[]") as string[]).includes(ref.resultId));
      })) return;
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
