import { StrictMode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SessionListItem } from "../../src/shared/session-list.js";
import type { VisualAction } from "../../src/client/optimistic-actions.js";
import { command, connect, useConnectionState, useVisualActions, verifyVisualActions } from "../../src/client/transport.js";
import { useSessionListPages } from "../../src/client/workspaces/useSessionListPages.js";
import { useSessionListProjection } from "../../src/client/workspaces/useSessionListProjection.js";
import { projectSessionListRows, refreshSessionListHeld } from "../../src/client/workspaces/session-list-projection.js";

function Rows({ workspaceId, query }: { workspaceId: string; query: string }) {
  const pages = useSessionListPages(workspaceId, query);
  const [held, setHeld] = useState<readonly SessionListItem[]>([]);
  const completed = useCallback((action: VisualAction) => setHeld(previous => projectSessionListRows(previous, [action])), []);
  const acceptServer = useCallback((rows: readonly SessionListItem[]) => setHeld(previous => refreshSessionListHeld(previous, rows)), []);
  const projected = useSessionListProjection(pages, { rows: held, completed, acceptServer });
  const actions = useVisualActions();
  const [title, setTitle] = useState("B"), [failure, setFailure] = useState<string | null>(null);
  const invoke = (op: string, params: Record<string, unknown>) => {
    setFailure(null);
    void command(op, params, { workspaceId, sessionId: `${workspaceId}-top-0` }).catch((error: Error) => setFailure(error.message));
  };
  const snapshot = { context: pages.context, epoch: pages.epoch, acceptedEpoch: pages.acceptedEpoch, enabled: pages.enabled,
    state: pages.state, top: projected.top, workspace: projected.workspace, held: projected.held, heldBase: held,
    pending: actions.map(action => ({ id: action.id, op: action.op, state: action.state, params: action.params })),
    error: pages.state.error?.message ?? null, failure };
  useLayoutEffect(() => {
    const frames = (window as any).projectionFrames as unknown[];
    frames.push({ context: pages.context, epoch: pages.epoch, acceptedEpoch: pages.acceptedEpoch,
      top: projected.top.map(row => ({ id: row.id, title: row.title, pinned: row.pinned })),
      held: projected.held.map(row => ({ id: row.id, title: row.title })), pending: actions.length });
    if (frames.length > 500) frames.shift();
  }, [pages.context, pages.epoch, pages.acceptedEpoch, projected.top, projected.held, actions]);
  const canPage = pages.enabled && pages.epoch === pages.acceptedEpoch && !pages.state.loading;
  return <>
    <pre id="snapshot" style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(snapshot)}</pre>
    <label>标题值<input value={title} onChange={event => setTitle(event.target.value)} /></label>
    <button onClick={() => invoke("session.rename", { title })}>改名</button>
    <button onClick={() => invoke("session.pin", { pinned: false })}>取消置顶</button>
    <button onClick={() => invoke("session.delete", { confirmed: true })}>删除目标</button>
    <button onClick={() => void verifyVisualActions().catch((error: Error) => setFailure(error.message))}>核实结果</button>
    <button onClick={() => void pages.refresh()} disabled={!pages.enabled}>刷新</button>
    <button onClick={() => setHeld(previous => {
      const raw = pages.state.top.page?.items.find(row => row.id === `${workspaceId}-top-0`);
      return raw && !previous.some(row => row.id === raw.id && row.workspaceId === raw.workspaceId) ? [...previous, raw] : previous;
    })}>持有目标</button>
    <button onClick={() => setHeld([])}>释放目标</button>
    <div style={{ display: "flex", gap: 20 }}>
      {(["top", "workspace"] as const).map(group => <section key={group} aria-label={group}>
        <button aria-label={`${group} 下一页`} disabled={!canPage || pages.state[group].loading || !pages.state[group].page?.next}
          onClick={() => void pages.next(group)}>下一页</button>
        <ol>{projected[group].map(row => <li key={`${row.workspaceId}:${row.id}`} data-session-id={row.id}>{row.title} {String(row.pinned)}</li>)}</ol>
      </section>)}
      <section aria-label="held"><ol>{projected.held.map(row => <li key={`${row.workspaceId}:${row.id}`}>{row.title}</li>)}</ol></section>
    </div>
  </>;
}
function Fixture() {
  const connection = useConnectionState(), started = useRef(false);
  started.current ||= connection.connected;
  const [workspaceId, setWorkspace] = useState("w"), [query, setQuery] = useState("");
  return <>
    <pre id="connection">{JSON.stringify(connection)}</pre>
    <label>空间<input value={workspaceId} onChange={event => setWorkspace(event.target.value)} /></label>
    <label>原始搜索<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    {started.current && <Rows workspaceId={workspaceId} query={query} />}
  </>;
}
(window as any).projectionFrames = [];
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
void connect();
