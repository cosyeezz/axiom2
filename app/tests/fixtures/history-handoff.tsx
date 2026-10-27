import { createRoot } from "react-dom/client";
import { AgentThread } from "../../src/client/chat/AgentThread.js";
import { Composer } from "../../src/client/chat/Composer.js";
import { connect } from "../../src/client/transport.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";

connect();
createRoot(document.getElementById("root")!).render(<div className="workspace" style={{ height: "100vh" }}>
  <AgentThread scope={{ workspaceId: "w", sessionId: "s" }} />
  <Composer scope={{ workspaceId: "w", sessionId: "s" }} />
</div>);
