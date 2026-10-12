import { createRoot } from "react-dom/client";
import { Icons } from "./components.js";
import { connect } from "./transport.js";
import "./styles/tokens.css";

// Full-page navigation keeps the three supplied global stylesheets isolated.
const Page = (
  await (location.pathname === "/settings.html"
    ? import("./pages/Settings.js")
    : location.pathname === "/model-config.html"
      ? import("./pages/Models.js")
      : import("./pages/Workbench.js"))
).default;
createRoot(document.getElementById("root")!).render(
  <>
    <Icons />
    <Page />
  </>,
);
void connect();
