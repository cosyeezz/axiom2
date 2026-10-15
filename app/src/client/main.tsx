import { createRoot } from "react-dom/client";
import { Icons } from "./components.js";
import { connect } from "./transport.js";
import { TooltipLayer } from "./TooltipLayer.js";
import "./styles/tokens.css";
import "./styles/scrollbars.css";

// Full-page navigation keeps the three supplied global stylesheets isolated.
const Page = (
  await (location.pathname === "/connect.html"
    ? import("./pages/Connect.js")
    : location.pathname === "/settings.html"
    ? import("./pages/Settings.js")
    : location.pathname === "/costs.html"
      ? import("./pages/Costs.js")
    : location.pathname === "/model-config.html"
      ? import("./pages/Models.js")
      : import("./pages/Workbench.js"))
).default;
createRoot(document.getElementById("root")!).render(
  <>
    <Icons />
    <Page />
    <TooltipLayer />
  </>,
);
if (location.pathname !== "/connect.html") void connect();
