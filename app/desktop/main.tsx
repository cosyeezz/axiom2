import { createRoot } from "react-dom/client";
import Connect from "../src/client/pages/Connect.js";
import "../src/client/styles/tokens.css";
import "../src/client/styles/scrollbars.css";
createRoot(document.getElementById("root")!).render(<Connect />);
