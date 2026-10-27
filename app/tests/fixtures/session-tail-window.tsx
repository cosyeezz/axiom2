import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentThread } from "../../src/client/chat/AgentThread.js";
import { Composer } from "../../src/client/chat/Composer.js";
import { OriginalConversationProvider } from "../../src/client/chat/OriginalConversation.js";
import { connect, scopeOrder, scopeSnapshot } from "../../src/client/transport.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";

function Fixture() {
  const [sessionId, select] = useState("a");
  (window as any).tailWindow = { select, sessionId, snapshot: scopeSnapshot, order: scopeOrder };
  const scope = { workspaceId: "w", sessionId };
  return <div className="workspace" style={{ height: "100vh" }}>
    <OriginalConversationProvider key={sessionId} scope={scope}><AgentThread scope={scope} /></OriginalConversationProvider>
    <Composer key={`composer:${sessionId}`} scope={scope} />
  </div>;
}
connect();
createRoot(document.getElementById("root")!).render(<Fixture />);
