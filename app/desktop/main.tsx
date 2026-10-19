import { createRoot } from "react-dom/client";
import Connect from "../src/client/pages/Connect.js";
import "../src/client/styles/tokens.css";
import "../src/client/styles/scrollbars.css";
import { Icons } from "../src/client/components.js";
import "../src/client/styles/icon-geometry.css";
import StartupBoundary from "./StartupBoundary.js";
createRoot(document.getElementById("root")!).render(<StartupBoundary><Icons /><Connect /></StartupBoundary>);
