import "./platform.js";
import { createRoot } from "react-dom/client";
import { Icons } from "./components.js";
import { connect } from "./transport.js";
import { TooltipLayer } from "./TooltipLayer.js";
import { PageBoundary } from "./PageBoundary.js";
import { initializeTheme } from "./theme.js";
import { initializeDisplaySettings } from "./display-settings.js";
import { FontScaleFeedback } from "./settings/DisplaySettings.js";
import "./styles/tokens.css";
import "./styles/scrollbars.css";

initializeTheme();
// Full-page navigation keeps page styles isolated.
const Page = (
  await (location.pathname === "/connect.html"
    ? import("./pages/Connect.js")
    : location.pathname === "/display.html"
    ? import("./pages/Display.js")
    : location.pathname === "/settings.html"
    ? import("./pages/Settings.js")
    : location.pathname === "/resources.html"
      ? import("./pages/Resources.js")
    : location.pathname === "/tools.html"
      ? import("./pages/BuiltinTools.js")
    : location.pathname === "/costs.html"
      ? import("./pages/Costs.js")
    : location.pathname === "/model-config.html"
      ? import("./pages/Models.js")
      : import("./pages/Workbench.js"))
).default;
// Apply shared control states after the selected page's styles.
await import("./styles/action-icons.css");
await import("./styles/icon-geometry.css");
await import("./styles/mobile.css");
initializeDisplaySettings();
await import("./styles/theme.css");
createRoot(document.getElementById("root")!).render(
  <PageBoundary>
    <Icons />
    <Page />
    <TooltipLayer />
    <FontScaleFeedback />
  </PageBoundary>,
);
if (location.pathname !== "/connect.html") void connect();
