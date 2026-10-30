import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, scopeOrder, subscribeScope, useConnection, useConnectionState } from "../../src/client/transport.js";
import { useSessionListPages } from "../../src/client/workspaces/useSessionListPages.js";

function Pages({ workspaceId, query }: { workspaceId: string; query: string }) {
  const pages = useSessionListPages(workspaceId, query);
  const state = pages.state;
  const canPage = pages.enabled && pages.epoch === pages.acceptedEpoch && !state.loading;
  return <>
    <pre id="snapshot">{JSON.stringify({ context: pages.context, epoch: pages.epoch, acceptedEpoch: pages.acceptedEpoch,
      enabled: pages.enabled, state, error: state.error?.message ?? null,
      errors: { top: state.top.error?.message ?? null, workspace: state.workspace.error?.message ?? null } })}</pre>
    <button onClick={() => void pages.refresh()} disabled={!pages.enabled}>刷新</button>
    <button onClick={() => pages.restart()} disabled={!pages.enabled}>重新读取</button>
    {["top", "workspace"].map(value => {
      const group = value as "top" | "workspace", frame = state[group];
      return <section key={group} aria-label={group}>
        <button aria-label={`${group} 上一页`} disabled={!canPage || frame.loading || !frame.previous.length} onClick={() => void pages.previous(group)}>上一页</button>
        <button aria-label={`${group} 下一页`} disabled={!canPage || frame.loading || !frame.page?.next} onClick={() => void pages.next(group)}>下一页</button>
        <ol>{frame.page?.items.map(item => <li key={item.id} data-session-id={item.id}>{item.title}</li>)}</ol>
      </section>;
    })}
  </>;
}
function Fixture() {
  const connection = useConnectionState(), status = useConnection();
  const started = useRef(false);
  started.current ||= connection.connected;
  const [mounted, setMounted] = useState(true), [workspaceId, setWorkspace] = useState("w"), [query, setQuery] = useState("");
  const diagnostic = useRef<(() => void) | null>(null);
  useEffect(() => () => diagnostic.current?.(), []);
  return <>
    <pre id="connection">{JSON.stringify(connection)}</pre><p id="connection-status">{status}</p>
    <label>空间<input value={workspaceId} onChange={event => setWorkspace(event.target.value)} /></label>
    <label>原始搜索<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    <button onClick={() => setMounted(value => !value)}>挂载切换</button>
    <button onClick={() => { diagnostic.current?.(); diagnostic.current = subscribeScope("connection-diagnostic", () => {}); }}>诊断提示</button>
    {started.current && mounted && <Pages workspaceId={workspaceId} query={query} />}
  </>;
}
(window as any).listConnection = { connect, scopeOrder, subscribeScope };
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
void connect();
