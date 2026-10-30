import type { SessionListItem } from "../../shared/session-list.js";
import { projectVisualAction, type VisualAction } from "../optimistic-actions.js";

type Patch = { title?: string; pinned?: boolean; removed?: true };
export interface SessionListBridge {
  /** One React activation, not merely equal workspace/query strings. */
  context: object;
  /** null means that no post-receipt reader could be started (e.g. offline). */
  afterEpoch: number | null;
  patches: ReadonlyMap<string, Patch>;
}
const key = (row: Pick<SessionListItem, "workspaceId" | "id">) => JSON.stringify([row.workspaceId, row.id]);

export function isSessionListAction(action: VisualAction) {
  return action.op === "session.rename" || action.op === "session.pin" || action.op === "session.delete" || action.op === "workspace.delete";
}

/** Only fields of existing rows: no insertion, family inference, sort or filter. */
export function applySessionListAction<T extends SessionListItem>(row: T, action: VisualAction): T | null {
  if (action.op === "workspace.delete") return row.workspaceId === action.target.workspaceId ? null : row;
  if (!isSessionListAction(action)) return row;
  return projectVisualAction(`session:${row.workspaceId}:${row.id}`, row, action) as T | null;
}

/** Capture an acknowledged write, never an entire captured session or action log.
 * A caller fences every completed list mutation, even with no rows yet: a
 * pre-receipt initial/page may otherwise introduce a stale row after completion.
 * Each completion replaces the fence: an earlier accepted read cannot release a
 * later write, and a null fence must not be satisfied by old accepted evidence. */
export function bridgeSessionListAction(
  previous: SessionListBridge | null,
  context: object,
  rows: readonly SessionListItem[],
  action: VisualAction,
  afterEpoch: number | null,
): SessionListBridge {
  const current = new Set(rows.map(key));
  const patches = new Map<string, Patch>(previous?.context === context
    ? [...previous.patches].filter(([id]) => current.has(id)) : []);
  for (const row of rows) {
    if (applySessionListAction(row, action) === row) continue;
    const id = key(row), patch = patches.get(id) ?? {};
    if (action.op === "session.delete" || action.op === "workspace.delete") patches.set(id, { removed: true });
    else if (action.op === "session.rename") patches.set(id, { ...patch, title: action.params.title as string });
    else if (action.op === "session.pin") patches.set(id, { ...patch, pinned: action.params.pinned as boolean });
  }
  return { context, afterEpoch, patches };
}

/** Evaluate in the render that accepts the new pair, not a later cleanup effect:
 * fresh server C must win confirmed B atomically, without a one-frame overwrite. */
export function activeSessionListBridge(bridge: SessionListBridge | null, context: object, acceptedEpoch: number) {
  return bridge?.context === context && (bridge.afterEpoch === null || acceptedEpoch < bridge.afterEpoch) ? bridge : null;
}

/** A bridge is transitional display only; pending/uncertain intents retain the
 * existing VisualActions insertion order above it. Neither is server authority.
 * This is also usable to materialize only completed fields into finite held rows. */
export function projectSessionListRows<T extends SessionListItem>(
  rows: readonly T[],
  actions: readonly VisualAction[],
  bridge: SessionListBridge | null = null,
): readonly T[] {
  let changed = false;
  const result: T[] = [];
  for (const source of rows) {
    const patch = bridge?.patches.get(key(source));
    let row: T | null = source;
    if (patch?.removed) row = null;
    else if (patch) row = { ...source,
      ...("title" in patch ? { title: patch.title! } : {}),
      ...("pinned" in patch ? { pinned: patch.pinned! } : {}) };
    for (const action of actions) {
      if (!row) break;
      row = applySessionListAction(row, action);
    }
    if (row) result.push(row);
    if (row !== source) changed = true;
  }
  return changed ? result : rows;
}

/** Refresh only existing held summaries; absence is not authoritative deletion.
 * Use whole raw server rows so missing optional fields (runId, count, etc.) are
 * cleared too. Group/anchor/hold-token metadata belongs to the caller, outside
 * these summaries. Persist this result before a server row can leave the page. */
export function refreshSessionListHeld(
  held: readonly SessionListItem[],
  server: readonly SessionListItem[],
): readonly SessionListItem[] {
  const current = new Map(server.map(row => [key(row), row]));
  const result = held.map(row => current.get(key(row)) ?? row);
  return result.some((row, i) => row !== held[i]) ? result : held;
}
