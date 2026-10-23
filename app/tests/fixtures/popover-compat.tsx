import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Usage } from "../../src/client/chat/Usage.js";
import { ModelPicker } from "../../src/client/chat/ModelPicker.js";
import { MemoryToolbar } from "../../src/client/memory/MemoryToolbar.js";
import { Select } from "../../src/client/Select.js";
import { TooltipLayer } from "../../src/client/TooltipLayer.js";
import { PageBoundary } from "../../src/client/PageBoundary.js";
import { Icons } from "../../src/client/components.js";
import { useDraft, updateDraft } from "../../src/client/drafts.js";
import { acceptSnapshot } from "../../src/client/transport.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";
import "../../src/client/styles/mobile.css";
import "../../src/client/styles/action-icons.css";

const scope = { workspaceId: "popover-fixture", sessionId: "popover-session" };
const errors: string[] = [];
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
function Fixture() {
  const draft = useDraft(scope), [value, setValue] = useState("a"), [crash, setCrash] = useState<"render" | "layout" | null>(null);
  useLayoutEffect(() => { if (crash === "layout") throw new Error("Popover regression: deliberate layout failure"); }, [crash]);
  if (crash === "render") throw new Error("Popover regression: deliberate render failure");
  return <><Icons /><main className="app" style={{ height: "100dvh", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
    <button id="outside" style={{ position: "fixed", top: 16, left: 16 }}>Outside</button>
    <button id="crash" onClick={() => setCrash("render")}>Test render failure</button>
    <button id="crash-layout" onClick={() => setCrash("layout")}>Test layout failure</button>
    <section className="composer-area"><div className="container">
      <textarea id="prompt" value={draft.text} onChange={event => updateDraft(scope, { text: event.target.value })} />
      <ModelPicker scope={scope} />
      <Select label="测试选项" value={value} onChange={setValue} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />
      <MemoryToolbar scope={scope} workspaces={[{ id: scope.workspaceId, name: "Fixture", path: "/fixture", authorized: true, pinned: false }]}>{tools => <Usage scope={scope} tools={tools} />}</MemoryToolbar>
    </div></section>
  </main><TooltipLayer /></>;
}
acceptSnapshot({ type: "snapshot", scope: "configuration", streamId: "fixture", seq: 1, data: { revision: "fixture", available: [{ provider: "fixture", id: "fixture", name: "Fixture Model", levels: ["off"], input: ["text"] }], providerCount: 1, modelCount: 1, dataRoot: "/fixture" } });
updateDraft(scope, { text: "保留未发送草稿" });
createRoot(document.getElementById("root")!).render(<PageBoundary><Fixture /></PageBoundary>);

// Reset timer nesting so hidden WKWebViews do not clamp repeated waits to 1s.
const pause = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
    setTimeout(resolve, 40);
  };
  channel.port2.postMessage(null);
});
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const find = (selector: string) => { const node = document.querySelector<HTMLElement>(selector); check(node, `Missing ${selector}`); return node!; };
async function click(selector: string) {
  const node = find(selector);
  node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
  node.focus();
  node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }));
  node.click(); await pause();
}
const panels = [
  ['[data-od-id="context-capacity"]', ".memory-todo-body", '[aria-label="关闭统计详情"]'],
  ['[data-od-id="cache-tokens"]', ".cache-detail", '[aria-label="关闭统计详情"]'],
  ['[data-od-id="estimated-cost"]', ".cost-popover", '[aria-label="关闭费用明细"]'],
  ['[aria-label="重新加载会话配置"]', ".session-reload", '[aria-label="关闭重载详情"]'],
  ['[aria-label="技能与 MCP"]', ".capability-settings", '[aria-label="关闭技能与 MCP"]'],
  ['[aria-label="子代理设置"]', ".subagent-settings", '[aria-label="关闭子代理设置"]'],
  ['[data-od-id="background-compression-trigger"]', '[data-od-id="background-compression-page"]', '[aria-label="关闭压缩详情，返回会话"]'],
  ['[aria-label="全局记忆"]', ".memory-dialog", '[aria-label="关闭记忆"]'],
];
async function runChecks() {
  await pause();
  let usedFallback = false;
  // Merely hovering used to crash WebViews whose selector parser rejects :popover-open.
  for (const trigger of ['[data-od-id="cache-tokens"]', '[aria-label="重新加载会话配置"]', '[aria-label="技能与 MCP"]']) {
    find(trigger).dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise(resolve => setTimeout(resolve, 550));
    check(find('[role="tooltip"]').getBoundingClientRect().width > 10, "Hover tooltip hidden");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await pause(); check(!document.querySelector('[role="tooltip"]'), "Tooltip Escape did not dismiss");
    check(!!document.querySelector(".app"), "Page lost without a click");
  }
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [trigger, panel, close] of panels) {
      await click(trigger);
      const node = find(panel), box = node.getBoundingClientRect();
      usedFallback = node.hasAttribute("data-popover-fallback");
      check(node.hasAttribute("data-popover-open") && getComputedStyle(node).display === "flex" && box.height > 40 && box.width > 100, `Panel not visible: ${panel}`);
      check(box.top >= -1 && box.bottom <= innerHeight + 1, `Panel outside viewport: ${panel}`);
      await click(`${panel} ${close}`);
      check(!document.querySelector(panel), `Panel did not close: ${panel}`);
      check(document.activeElement === find(trigger), `Focus not restored: ${panel}`);
      check((find("#prompt") as HTMLTextAreaElement).value === "保留未发送草稿", "Draft lost");
    }
  }
  if (usedFallback) {
    for (const [trigger, panel, close] of panels.slice(0, -1)) {
      await click(trigger);
      find(`${panel} ${close}`).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await pause(); check(!document.querySelector(panel), `Escape did not dismiss ${panel}`);
    }
  }
  // A second auto panel must dismiss the first, including when opened programmatically.
  await click('[data-od-id="cache-tokens"]');
  find('[aria-label="子代理设置"]').click(); await pause();
  check(!document.querySelector(".cache-detail") && !!document.querySelector(".subagent-settings"), "Auto panels did not switch");
  await click('[aria-label="关闭子代理设置"]');
  await click('[data-od-id="cache-tokens"]');
  if (usedFallback) {
    await click("#outside");
    check(!document.querySelector(".cache-detail"), "Outside click did not dismiss");
  } else await click('[aria-label="关闭统计详情"]'); // Native light-dismiss needs trusted events; covered by Playwright.
  // Nested menus and tooltips must remain owned by the actual modal dialog.
  const root = find("#root"), modal = document.createElement("dialog");
  modal.id = "child-fixture"; document.body.append(modal); modal.append(root); modal.showModal();
  await click('[data-od-id="cache-tokens"]');
  check(find(".cache-detail").parentElement === modal, "Child panel escaped its modal");
  await click('[aria-label="关闭统计详情"]');
  await click('[aria-label="测试选项"]');
  check(find(".select-menu").parentElement === modal, "Select escaped its modal");
  await click('.select-menu [data-value="b"]');
  check(find('[aria-label="测试选项"]').textContent?.includes("Beta"), "Option did not apply");
  await click("#model-picker > summary");
  const modelMenu = find(".model-popover"), modelBox = modelMenu.getBoundingClientRect();
  check(modelBox.height > 40 && modelMenu.closest("dialog") === modal, "Model list hidden or escaped modal");
  check(modelMenu.contains(document.elementFromPoint(modelBox.left + modelBox.width / 2, modelBox.top + 20)), "Model list clipped or covered");
  await click('[aria-label="取消模型设置"]');
  // Unsupported-selector failures used to occur during tooltip portal rendering.
  find('[data-od-id="cache-tokens"]').dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  await new Promise(resolve => setTimeout(resolve, 550));
  check(find('[role="tooltip"]').parentElement === modal, "Tooltip escaped its modal");
  await click("#outside");
  check(modal.open, "Nested control closed the parent modal");
  modal.close(); document.body.append(root); modal.remove();
  check(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  for (const trigger of ["#crash", "#crash-layout"]) {
    await click('[data-od-id="cache-tokens"]');
    find(trigger).click(); await pause();
    check(!!document.querySelector(".app.page-error"), `Failure not caught or recovery not ready: ${trigger}`);
    await click(".page-error button");
    check((find("#prompt") as HTMLTextAreaElement).value === "保留未发送草稿", "Recovery lost draft");
  }
  return { passed: true, panels: panels.length, repetitions: 3, errors, usedFallback, hoverWithoutClick: true, renderAndLayoutRecovery: true, nativePopover: typeof HTMLElement.prototype.showPopover === "function" };
}
Object.assign(window, { runPopoverChecks: runChecks });
