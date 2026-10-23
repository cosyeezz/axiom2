import { createRoot } from "react-dom/client";
import { DisplaySettings } from "../../src/client/settings/DisplaySettings.js";
import { initializeDisplaySettings } from "../../src/client/display-settings.js";
import { initializeTheme } from "../../src/client/theme.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/theme.css";

initializeTheme();
initializeDisplaySettings();
createRoot(document.getElementById("root")!).render(<main className="display-app display-page"><DisplaySettings /></main>);
