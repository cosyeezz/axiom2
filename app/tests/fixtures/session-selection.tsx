import { createRoot } from "react-dom/client";
import Workbench from "../../src/client/pages/Workbench.js";
import { command, connect, scopeAuthority, scopeOrder, scopeSnapshot } from "../../src/client/transport.js";
import { registerFileEditor } from "../../src/client/file-edit-guard.js";
import "../../src/client/styles/tokens.css";

// Real Workbench and hooks. Only synthetic external events use this test handle;
// selection, creation, drafts and rollback still run through production code.
let fileDirty = false;
registerFileEditor(() => fileDirty);
Object.assign(window, { sessionSelection: { command, scopeAuthority, scopeOrder, scopeSnapshot,
  setFileDirty: (value: boolean) => { fileDirty = value; } } });
void connect();
createRoot(document.getElementById("root")!).render(<Workbench />);
