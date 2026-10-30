import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionListItem } from "../../shared/session-list.js";
import type { VisualAction } from "../optimistic-actions.js";
import { observeVisualActions, useVisualActions } from "../transport.js";
import type { useSessionListPages } from "./useSessionListPages.js";
import { activeSessionListBridge, bridgeSessionListAction, isSessionListAction,
  projectSessionListRows, refreshSessionListHeld, type SessionListBridge } from "./session-list-projection.js";

type Pages = ReturnType<typeof useSessionListPages>;
/** The DOM owner keeps group/anchor/hold-token metadata. It must materialize only
 * completed fields, invalidate deleted holds, and persist accepted raw summaries.
 * It must not capture pending-projected rows as a new authoritative held base. */
export interface SessionListHeld {
  rows: readonly SessionListItem[];
  completed(action: VisualAction): void;
  acceptServer(rows: readonly SessionListItem[]): void;
}
const emptyRows: readonly SessionListItem[] = [];

/** Finite display projection only: selected/first continue using raw authority. */
export function useSessionListProjection(pages: Pages, held?: SessionListHeld) {
  const { context } = pages;
  const actions = useVisualActions();
  const live = useRef({ pages, held });
  live.current = { pages, held };
  // The ref makes multiple completions in one turn see each other's compact
  // patches; state publishes the completed snapshot even after intents disappear.
  const latest = useRef<SessionListBridge | null>(null);
  const [bridge, setBridge] = useState<SessionListBridge | null>(null);

  useLayoutEffect(() => {
    if (latest.current?.context !== context) latest.current = null;
    setBridge(previous => previous?.context === context ? previous : null);
    // Layout subscription precedes the page owner's passive bootstrap, so even
    // a completion before the first initial can fence its stale future response.
    return observeVisualActions(event => {
      const current = live.current;
      if (current.pages.context !== context || !context.workspaceId || event.phase !== "completed" || !isSessionListAction(event.action)) return;
      const rows = [...(current.pages.state.top.page?.items ?? emptyRows),
        ...(current.pages.state.workspace.page?.items ?? emptyRows), ...(current.held?.rows ?? emptyRows)];
      const waiting = bridgeSessionListAction(latest.current, context, rows, event.action, null);
      latest.current = waiting;
      current.held?.completed(event.action); // target fields only; never a pending-projected whole row
      const afterEpoch = current.pages.restart(); // synchronous dispose/epoch fence, not refresh().then
      const bound = { ...waiting, afterEpoch };
      latest.current = bound;
      setBridge(bound);
    });
  }, [context]);

  const active = activeSessionListBridge(bridge, context, pages.acceptedEpoch);
  useLayoutEffect(() => {
    if (bridge && !active) {
      if (latest.current === bridge) latest.current = null;
      setBridge(previous => previous === bridge ? null : previous);
    } else if (active?.afterEpoch === null && pages.enabled) {
      // A receipt may arrive offline or before the passive page owner exists.
      // Never bind old accepted evidence, and never busy-loop on a null restart.
      const afterEpoch = pages.restart();
      if (afterEpoch === null || latest.current !== active) return;
      const bound = { ...active, afterEpoch };
      latest.current = bound;
      setBridge(previous => previous === active ? bound : previous);
    }
  }, [bridge, active, context, pages.acceptedEpoch, pages.enabled, pages.restart]);

  const top = pages.state.top.page?.items ?? emptyRows;
  const workspace = pages.state.workspace.page?.items ?? emptyRows;
  const serverRows = useMemo(() => [...top, ...workspace], [top, workspace]);
  const accepted = !active && pages.state.revision !== null && pages.epoch === pages.acceptedEpoch;
  useLayoutEffect(() => {
    if (accepted) live.current.held?.acceptServer(serverRows);
  }, [context, serverRows, accepted]);
  // The same render that accepts C both stops applying B and refreshes the held
  // fallback. The owner persists that raw C before it can leave a later page.
  const heldRows = accepted ? refreshSessionListHeld(held?.rows ?? emptyRows, serverRows) : held?.rows ?? emptyRows;
  return useMemo(() => ({
    top: projectSessionListRows(top, actions, active),
    workspace: projectSessionListRows(workspace, actions, active),
    held: projectSessionListRows(heldRows, actions, active),
  }), [top, workspace, heldRows, actions, active]);
}
