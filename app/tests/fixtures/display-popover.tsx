import "./popover-compat.js";
import "../../src/client/styles/display-settings.css";
import { initializeDisplaySettings, setDisplaySettings } from "../../src/client/display-settings.js";
import { openPopover } from "../../src/client/popover.js";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Dialog } from "../../src/client/components.js";

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

initializeDisplaySettings();
setDisplaySettings({ brightness: 80, contrast: 110 });
const original = (window as any).runPopoverChecks;
(window as any).runPopoverChecks = async () => {
  const result = await original();
  const modal = document.createElement("dialog");
  modal.style.cssText = "position:fixed;inset:100px auto auto 150px;margin:0;width:500px;height:400px;padding:20px;border:2px solid white;overflow:visible";
  document.body.append(modal); modal.showModal();
  if ([document.documentElement, modal].some(node => getComputedStyle(node).filter !== "none")) throw Error("Display adjustment must not filter text");
  const boxes: unknown[] = [];
  for (const kind of ["plain", "anchored", "drawer"]) {
    const node = document.createElement(kind === "plain" ? "div" : "dialog");
    node.setAttribute("popover", "manual");
    if (kind === "plain") node.style.cssText = "position:fixed;left:30px;top:40px;width:100px;height:60px;margin:0;padding:0;border:0";
    else {
      node.className = `toolbar-detail-panel${kind === "drawer" ? " toolbar-detail-drawer" : ""}`;
      node.style.setProperty("--settings-bottom", "60px");
      node.style.setProperty("--toolbar-panel-left", "30px");
      node.style.setProperty("--toolbar-panel-width", "240px");
      node.innerHTML = "<header>显示调节定位检查</header><div style='height:100px'>内容</div>";
    }
    // Hidden WKWebViews freeze animation at its first frame; measure settled geometry,
    // matching the reduced-motion Chrome runner.
    node.style.animation = "none";
    modal.append(node);
    const close = openPopover(node);
    await settle();
    const box = node.getBoundingClientRect();
    if (kind === "plain" && (Math.abs(box.x - 30) > 1 || Math.abs(box.y - 40) > 1)) throw Error(`filtered plain shifted: ${JSON.stringify(box)}`);
    if (kind === "anchored" && (Math.abs(box.x - 30) > 1 || Math.abs(box.bottom - (innerHeight - 60)) > 1)) throw Error(`filtered anchored shifted: ${JSON.stringify(box)}`);
    if (kind === "drawer" && (Math.abs(box.top) > 1 || Math.abs(box.right - innerWidth) > 1 || Math.abs(box.bottom - (innerHeight - 60)) > 1)) throw Error(`filtered drawer shifted: ${JSON.stringify(box)}`);
    boxes.push({ kind, x:box.x, y:box.y, width:box.width, height:box.height, filter:getComputedStyle(node).filter });
    close(); node.remove();
  }
  modal.close(); modal.remove();
  // Real shared dialog: long content keeps its scroll while sibling menus escape
  // its bounds. A nested modal must not change its outer modal's scrolling.
  const outer = document.createElement("dialog");
  outer.style.cssText = "width:600px;height:300px;overflow:auto";
  outer.innerHTML = "<div style='height:1200px'></div>";
  const mount = document.createElement("div");
  outer.append(mount); document.body.append(outer); outer.showModal(); outer.scrollTop = 120;
  const root = createRoot(mount);
  flushSync(() => root.render(<Dialog title="长内容滚动检查" onClose={() => {}}><div style={{ height: 1800 }}>正文</div></Dialog>));
  const inner = mount.querySelector("dialog")!;
  const content = inner.querySelector<HTMLElement>(".dialog-content")!;
  content.scrollTop = 120;
  if (content.scrollTop !== 120) throw Error("Dialog content cannot scroll before opening menu");
  const closers: (() => void)[] = [];
  for (let i = 0; i < 2; i++) {
    const menu = document.createElement("div");
    menu.setAttribute("popover", "manual");
    menu.style.cssText = `position:fixed;left:${30 + i * 120}px;top:40px;width:100px;height:60px;margin:0;padding:0;border:0`;
    const wrapper = document.createElement("div"); wrapper.style.display = "contents";
    wrapper.append(menu); inner.append(wrapper);
    const close = openPopover(menu);
    closers.push(() => { close(); wrapper.remove(); });
    await settle();
    if (content.scrollTop !== 120 || outer.scrollTop !== 120) throw Error("Opening menu changed modal scroll");
    const box = menu.getBoundingClientRect();
    if (!menu.contains(document.elementFromPoint(box.x + 10, box.y + 10))) throw Error("Long dialog menu clipped");
  }
  content.scrollTop = 160;
  if (content.scrollTop !== 160) throw Error("Dialog stopped scrolling with menus open");
  closers[0]();
  if (getComputedStyle(inner).filter !== "none") throw Error("Modal text was filtered");
  closers[1]();
  if (content.scrollTop !== 160 || outer.scrollTop !== 120) throw Error("Closing menus changed scroll position");
  flushSync(() => root.unmount()); outer.close(); outer.remove();
  return { ...result, filteredLayers: boxes, scrollableModal: true };
};
