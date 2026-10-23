import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProviderAddMenu } from "../../src/client/models/AddProvider.js";
import { Icons } from "../../src/client/components.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/model-interactions.css";

function Fixture() {
  const [selection, setSelection] = useState(""), [count, setCount] = useState(0);
  const select = (value: string) => { setSelection(value); setCount(n => n + 1); };
  return <><Icons /><ProviderAddMenu disabled={false} oauth={() => select("oauth")} custom={() => select("custom")} />
    <output id="selection" data-count={count}>{selection}</output>
    <button id="outside" style={{ position: "fixed", right: 20, bottom: 20 }}>Outside</button></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

// Match macOS button clicks: mousedown can blur the focused item without
// focusing the clicked button. The click still needs its original DOM target.
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 40));
async function runChecks() {
  const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  // WKNavigationDelegate can finish before React commits the first render.
  for (let attempt = 0; attempt < 50 && !document.querySelector("#add-supplier"); attempt++) await pause();
  const trigger = document.querySelector<HTMLButtonElement>("#add-supplier");
  check(trigger, "Fixture did not mount");
  for (const [index, value] of ["oauth", "custom"].entries()) {
    trigger!.click(); await pause();
    const item = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index];
    check(item, "Menu must open");
    item.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    (document.activeElement as HTMLElement).blur(); await pause();
    check(item.isConnected, `${value}: focus loss removed the menu before click`);
    item.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }));
    item.click(); await pause();
    check(document.querySelector("#selection")?.textContent === value, `${value}: action did not run`);
    check(!document.querySelector('[role="menu"]'), "Selection must close the menu");
  }
  check(document.querySelector("#selection")?.getAttribute("data-count") === "2", "Each action must run exactly once");
  return { passed: true, nullRelatedTargetClicks: 2 };
}
Object.assign(window, { runPopoverChecks: runChecks });
