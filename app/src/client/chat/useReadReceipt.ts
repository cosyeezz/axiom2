import { useEffect, type RefObject } from "react";
import { command, renderedContextReady, useConnectionState } from "../transport.js";
import { running, type AgentInfo, type ThreadIndex } from "../../shared/agent.js";
import { useTaskWindowModel, useTaskWindowStatus } from "../tasks/TaskWindowProvider.js";
import type { Scope } from "../../shared/protocol.js";

/** Confirm viewing the current session tail, not the agent's consumption of task results. */
export function useReadReceipt(scope: Scope | null, index: ThreadIndex, info: AgentInfo, atBottom: boolean, scroller: RefObject<HTMLElement | null>) {
  const connection = useConnectionState();
  const model = useTaskWindowModel(scope), version = index.resultVersion ?? 0;
  const needed = !!scope?.sessionId && connection.connected && !index.error && atBottom && version > (index.readVersion ?? 0) && !!index.resultTasks?.length;
  const root = useTaskWindowStatus(needed ? model : null);
  useEffect(() => {
    if (!scope?.sessionId || !connection.connected || index.error || !atBottom || version <= (index.readVersion ?? 0)) return;
    let disposed = false, sending = false, checking = false, acknowledged = false;
    let membership: boolean | undefined;
    const controller = new AbortController();
    const confirm = () => {
      if (disposed || sending || checking || acknowledged || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const view = scroller.current;
      if (!view || view.scrollHeight - view.scrollTop - view.clientHeight > 3) return;
      const bounds = view.getBoundingClientRect();
      const visible = document.elementFromPoint(bounds.left + bounds.width / 2, Math.min(bounds.bottom - 4, innerHeight - 1));
      if (!visible || !view.contains(visible)) return; // Modal/overlay or a hidden conversation is not reading.
      if (index.runId !== info.run?.id || index.runStatus !== info.run?.status ||
          !renderedContextReady(scope, index.ids, !running(info.run))) return;
      // Prove ALL immutable pairs, not the loaded task tail or outstanding-only
      // resultRefs. Folded/virtualized cards need not be mounted. A missing list
      // is not a proven empty list, even if the version has advanced.
      const references = index.resultTasks;
      if (!references) return;
      if (references.length) {
        const live = model?.status();
        if (!model || !root.page || !live?.page || live.page.revision !== root.page.revision ||
            live.loading || live.error || live.page.state.resultVersion < version) return;
        if (membership === undefined) {
          checking = true;
          void model.hasResults(references, version, controller.signal).then(matched => {
            if (!disposed) membership = matched;
          }, () => { if (!disposed) membership = false; }).finally(() => {
            checking = false;
            // Async evidence cannot reuse earlier focus, geometry or readiness.
            if (!disposed && membership) confirm();
          });
          return;
        }
        if (!membership) return; // New cut/index/connection is required to retry proof.
      }
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
      controller.abort();
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("focus", confirm);
      document.removeEventListener("visibilitychange", confirm);
    };
  }, [scope?.workspaceId, scope?.sessionId, connection, index, info.run?.id, info.run?.status, version, model, root, atBottom, scroller]);
}
