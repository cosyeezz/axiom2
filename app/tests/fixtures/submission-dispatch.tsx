import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { connect, useConnectionState } from "../../src/client/transport.js";
import { getDraft, updateDraft, useDraft } from "../../src/client/drafts.js";
import { usePersistentDraft } from "../../src/client/draft-persistence.js";
import { useSubmission } from "../../src/client/chat/useSubmission.js";
import { pendingMessages, useOptimistic } from "../../src/client/chat/optimistic.js";

const scope = { workspaceId: "dispatch-workspace", sessionId: "dispatch-session" };
const active = new URLSearchParams(location.search).has("active");
const trace: { stage: string; at: number; ui?: { text: string; draft: string; state?: string } }[] = [];
const record = (stage: string) => trace.push({ stage, at: performance.now() });
const nativeSend = WebSocket.prototype.send;
WebSocket.prototype.send = function (payload) {
  if (typeof payload === "string" && JSON.parse(payload).op === "prompt") trace.push({ stage: "socket.send", at: performance.now(), ui: {
    text: document.querySelector("#pending")?.textContent ?? "",
    draft: (document.querySelector("#draft") as HTMLTextAreaElement).value,
    state: pendingMessages(scope)[0]?.state,
  } });
  return nativeSend.call(this, payload);
};
const rendered = new Set<string>();
function SlowPending() {
  const pending = useOptimistic(scope);
  for (const item of pending) if (!rendered.has(item.id)) {
    rendered.add(item.id);
    record("pending.render.start");
    // Stand in for costly Markdown, history mounts and synchronous layout. Local
    // feedback must commit before dispatch, without waiting for a backend receipt.
    const until = performance.now() + 150;
    while (performance.now() < until) { /* intentional deterministic render work */ }
    record("pending.render.end");
  }
  useLayoutEffect(() => {
    if (!pending.length) return;
    record("pending.commit");
    const frame = requestAnimationFrame(() => record("pending.frame"));
    return () => cancelAnimationFrame(frame);
  }, [pending]);
  return <output id="pending">{pending.map(item => item.draft.text).join("\n")}</output>;
}
function Fixture() {
  const connected = useConnectionState().connected;
  const persistence = usePersistentDraft(scope), draft = useDraft(scope);
  const { submit, busy } = useSubmission(scope, { connected, active, selected: true, nested: false });
  const send = () => {
    record("submit");
    void submit(active ? "append" : "prompt");
    // A second activation in the same turn must not dispatch another request,
    // even before React has committed the disabled button.
    void submit(active ? "append" : "prompt");
  };
  return <><form onSubmit={event => { event.preventDefault(); send(); }}>
    <textarea id="draft" value={draft.text} onChange={event => updateDraft(scope, { text: event.target.value })}
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} />
    <button id="send" disabled={!connected || !persistence.ready || busy}>Send</button>
  </form><SlowPending /></>;
}
Object.assign(window, { submissionDispatch: {
  trace,
  snapshot: () => ({ draft: getDraft(scope), pending: pendingMessages(scope) }),
} });
void connect();
createRoot(document.getElementById("root")!).render(<Fixture />);
