import { createRoot } from "react-dom/client";
import { Icons } from "../../src/client/components.js";
import { TooltipLayer } from "../../src/client/TooltipLayer.js";
import BuiltinTools from "../../src/client/pages/BuiltinTools.js";
import "./component-maintenance-transport.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/theme.css";

createRoot(document.getElementById("root")!).render(<><Icons /><BuiltinTools /><TooltipLayer /></>);
