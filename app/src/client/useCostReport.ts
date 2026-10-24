import { useCallback, useEffect, useRef, useState } from "react";
import { Lru } from "../shared/lru.js";
import { costsScope, type CostReport } from "../shared/costs.js";
import { AppError, type Scope } from "../shared/protocol.js";
import { command, useConnectionState, useScope } from "./transport.js";

const emptyRevision = { revision: 0 };
const recentReports = new Lru<string, CostReport>(5);
export interface CostReportState {
  report: CostReport | null;
  error: string;
  loading: boolean;
  connected: boolean;
  refresh: () => void;
}

/** One live ledger for the toolbar and its popover; the timer never triggers reads. */
export function useCostReport(scope?: Scope): CostReportState {
  const revision = useScope(scope ? costsScope(scope) : null, emptyRevision);
  const connection = useConnectionState();
  const scopeKey = JSON.stringify([scope?.workspaceId, scope?.sessionId]);
  const cacheKey = JSON.stringify([connection.generation, scope?.workspaceId, scope?.sessionId]);
  const [state, setState] = useState(() => ({ scopeKey, report: recentReports.get(cacheKey) ?? null, error: "", loading: !!scope }));
  const refresh = useRef<((visible?: boolean, delay?: number) => void) | null>(null);
  // A late response from the previous session must never color the new session.
  const current = state.scopeKey === scopeKey ? state
    : { report: recentReports.get(cacheKey) ?? null, error: "", loading: !!scope };

  useEffect(() => {
    let active = true, inFlight = false, dirty = false, visiblePending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(previous => ({ scopeKey,
      // Keep the same session's last report visible across a reconnect.
      report: previous.scopeKey === scopeKey ? previous.report : recentReports.get(cacheKey) ?? null,
      error: "", loading: !!scope,
    }));
    if (!scope || !connection.connected) return () => { active = false; };
    const update = (changes: Partial<Pick<CostReportState, "report" | "error" | "loading">>) => {
      if (active) setState(previous => active ? { ...previous, ...changes, scopeKey } : previous);
    };
    // Preserve the first deadline during a burst. Serialize reads and remember
    // invalidations received while a query is in flight instead of dropping them.
    const schedule = (visible = false, delay = 150) => {
      dirty = true;
      visiblePending ||= visible;
      if (visible) update({ loading: true });
      if (!active || inFlight || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        dirty = false;
        inFlight = true;
        const showLoading = visiblePending;
        visiblePending = false;
        void command<CostReport>("costs.get", {}, scope).then(value => {
          if (active) {
            recentReports.set(cacheKey, value);
            update({ report: value, error: "" });
          }
        }).catch((reason: Error) => {
          update({ error: reason instanceof AppError && reason.code === "UNKNOWN_OPERATION"
            ? "当前后台尚未支持费用明细，请在任务结束后重启后台服务。" : reason.message });
        }).finally(() => {
          inFlight = false;
          if (!active) return;
          if (showLoading && !visiblePending) update({ loading: false });
          if (dirty) schedule();
        });
      }, delay);
    };
    refresh.current = schedule;
    schedule(true, 0);
    return () => { active = false; clearTimeout(timer); refresh.current = null; };
  }, [scope?.workspaceId, scope?.sessionId, connection.connected, connection.generation]);
  useEffect(() => { if (revision.revision > 0) refresh.current?.(); }, [revision.revision]);
  const reload = useCallback(() => refresh.current?.(true, 0), []);
  return { ...current, connected: connection.connected, refresh: reload };
}
