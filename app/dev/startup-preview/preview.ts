import { installFixture, scenarios, type Scenario } from "./fixture.js";
import "./preview.css";

const tools = document.getElementById("preview-tools")!;
tools.innerHTML = `<div class="preview-bar"><strong>浏览器模拟测试</strong><span>不执行系统操作</span><label>场景 <select id="preview-scenario" aria-label="模拟场景"></select></label><button id="preview-reset">重置场景</button><details id="preview-log"><summary>说明与调用记录</summary><p>复用真实启动页。安装、更新、启停与连接仅改变内存；外链被拦截，组件清理未模拟。不能据此证明原生权限、网络下载或 MSI 安装通过。</p><pre id="preview-calls"></pre></details></div><div id="preview-notice" role="status" aria-live="polite"></div>`;
const select = document.getElementById("preview-scenario") as HTMLSelectElement;
for (const [value, text] of Object.entries(scenarios)) select.add(new Option(text, value));
const requested = new URL(location.href).searchParams.get("scenario") || "update";
const scenario: Scenario = Object.hasOwn(scenarios, requested) ? requested as Scenario : "update";
select.value = scenario;
function reset() { const url = new URL(location.href); url.searchParams.set("scenario", select.value); url.hash = ""; location.href = url.href; }
select.addEventListener("change", reset);
document.getElementById("preview-reset")!.addEventListener("click", reset);
function notify(message: string) { document.getElementById("preview-notice")!.textContent = message; }
const fixture = installFixture(scenario, notify);
// Disallow real external downloads/navigation even when testing the native platform's download link.
document.addEventListener("click", event => {
  const link = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
  if (link && new URL(link.href, location.href).origin !== location.origin) { event.preventDefault(); event.stopImmediatePropagation(); notify(`已拦截外部链接：${link.href}（模拟测试不下载）`); }
}, true);
window.open = () => { notify("已拦截新窗口；模拟测试不打开外部网站。"); return null; };
window.addEventListener("preview-call", () => {
  const records = fixture.calls.slice(-30).map(call => `${call.name} ${JSON.stringify(call.args)}`);
  document.getElementById("preview-calls")!.textContent = records.join("\n");
});
await import("../../desktop/main.tsx");
