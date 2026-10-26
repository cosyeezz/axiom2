import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Message } from "../../src/client/chat/Message.js";
import { ActivityExpanded } from "../../src/client/chat/ToolActivity.js";
import { acceptSnapshot } from "../../src/client/transport.js";
import { browserLatency } from "../../src/client/latency.js";

const scope = { workspaceId: "fixture", sessionId: "fixture" };
function Fixture() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    Object.assign(window, { latencyFixture: {
      push: (id: string, seq: number) => acceptSnapshot({ type: "snapshot", streamId: "fixture-stream", seq,
        scope: `message:fixture:fixture:${id}`, data: { id, role: "assistant", text: `Visible ${id} ${seq}`, streaming: true },
        latency: { runId: "fixture-run", requestId: "fixture-request", updateId: seq, workerAt: Date.now() } }),
      records: () => browserLatency.snapshot("fixture-run"), setOpen,
    } });
  }, []);
  return <main><section id="visible"><Message scope={scope} id="visible" /></section>
    <section id="folded"><ActivityExpanded.Provider value={open}><Message scope={scope} id="folded" inActivity /></ActivityExpanded.Provider></section></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
