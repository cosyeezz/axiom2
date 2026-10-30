import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Workbench from "../../src/client/pages/Workbench.js";
import { command, connect, scopeAuthority, scopeOrder, scopeSnapshot } from "../../src/client/transport.js";
import "../../src/client/styles/tokens.css";

// Real Workbench, History, Composer and transport under StrictMode. Only the
// synthetic server and explicit external actions are controlled by the runner.
Object.assign(window, { sessionSelection: { command, scopeAuthority, scopeOrder, scopeSnapshot } });
void connect();
createRoot(document.getElementById("root")!).render(<StrictMode><Workbench /></StrictMode>);
