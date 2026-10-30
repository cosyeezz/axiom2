// Independent real consumers: never mount AgentThread or another metadata producer.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChatMessage } from "../../src/shared/agent.js";
import type { Scope } from "../../src/shared/protocol.js";
import { Icons } from "../../src/client/components.js";
import { Compression } from "../../src/client/chat/Compression.js";
import { MessagePartBody } from "../../src/client/chat/MessagePartBody.js";
import { useFullMessage } from "../../src/client/chat/useFullMessage.js";
import { connect, useConnectionState } from "../../src/client/transport.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";

type Mode = "compression" | "full" | "automatic" | "thinking" | "input";
const requested = new URLSearchParams(location.search).get("mode");
const mode: Mode = requested === "full" || requested === "automatic" || requested === "thinking" || requested === "input" ? requested : "compression";
// Identical object, preview, IDs and length across every scope/revision change.
const source: ChatMessage = { id: "same-id", role: "assistant", text: "stable-preview", textLength: 200, truncated: true, detailsRevision: "stable" };
const hidden: ChatMessage = { id: "same-id", role: "assistant", text: "", thinking: "thinking-prefix", thinkingLength: 200,
  calls: [{ id: "fixture-call", name: "fixture", input: '{"message":"', inputLength: 200 }], truncated: true, detailsRevision: "stable" };
function Full({ scope, automatic }: { scope: Scope; automatic: boolean }) {
  const full = useFullMessage(scope, source, automatic);
  return <section id="full-consumer">
    <button type="button" onClick={() => void full.load()} disabled={!!full.loading}>读取全文</button>
    <output id="full-loading">{String(!!full.loading)}</output>
    <pre id="full-text">{full.message?.text ?? ""}</pre>
    <p id="full-error" role={full.error ? "alert" : undefined}>{full.error ?? ""}</p>
  </section>;
}
function Fixture() {
  const connection = useConnectionState(), started = useRef(false);
  started.current ||= connection.connected;
  const [sessionId, select] = useState("a"), [mounted, mount] = useState(true);
  const scope: Scope = { workspaceId: "w", sessionId };
  return <main style={{ padding: 16 }}>
    <Icons />
    <output id="connection">{JSON.stringify(connection)}</output>
    <output id="scope">{sessionId}</output>
    <button type="button" onClick={() => select(value => value === "a" ? "b" : "a")}>切换会话</button>
    <button type="button" onClick={() => mount(value => !value)}>挂载切换</button>
    {started.current && mounted && <div id="consumer-mounted" data-mode={mode}>
      {mode === "compression" ? <Compression key={sessionId} scope={scope} />
        : mode === "full" || mode === "automatic" ? <Full scope={scope} automatic={mode === "automatic"} />
        : <div id="part-text"><MessagePartBody scope={scope} message={hidden}
          field={mode === "thinking" ? "thinking" : "text"} callId={mode === "input" ? "fixture-call" : undefined} /></div>}
    </div>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
void connect();
