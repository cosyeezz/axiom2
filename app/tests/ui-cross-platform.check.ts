// Isolated source fixture: no backend, credentials, model calls, deployment or real clipboard.
// AXIOM_TEST_BROWSER=/path/to/chrome npx --no-install tsx tests/ui-cross-platform.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, firefox, webkit, type Page } from "playwright";
import { createServer } from "vite";
import { displayTypography } from "../scripts/display-typography.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-ui-platform-"))), appRoot = resolve(".");
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/ui-cross-platform");
mkdirSync(artifacts, { recursive: true });
const html = (script: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">${script}</script></body></html>`;
writeFileSync(join(root, "index.html"), html(`import '/@fs/${appRoot}/tests/fixtures/ui-cross-platform.tsx';`));
// Configuration pages do not load workbench.css; test their own font normalization.
writeFileSync(join(root, "models.html"), html(`import '/@fs/${appRoot}/src/client/styles/tokens.css'; import '/@fs/${appRoot}/src/client/styles/models.css'; import '/@fs/${appRoot}/src/client/styles/display-settings.css'; document.getElementById('root').innerHTML='<div class="display-sample-editor"><textarea class="input">示例 editor</textarea></div><input class="input" value="示例 input">';`));
const server = await createServer({ configFile: false, root, logLevel: "warn", resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [displayTypography()] } }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
await server.listen();
const url = server.resolvedUrls!.local[0];
const results: unknown[] = [];
async function bounded(page: Page, selector: string, gutter: number) {
  await page.waitForFunction(({ selector, gutter }) => {
    const node = document.querySelector(selector); if (!node) return false;
    const box = node.getBoundingClientRect(), vv = window.visualViewport!;
    return box.width > 0 && box.height > 0 && box.left >= vv.offsetLeft + gutter - 1 && box.top >= vv.offsetTop + gutter - 1 && box.right <= vv.offsetLeft + vv.width - gutter + 1 && box.bottom <= vv.offsetTop + vv.height - gutter + 1;
  }, { selector, gutter });
}
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch(name === "chromium" ? { executablePath: process.env.AXIOM_TEST_BROWSER } : {});
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
      await context.addInitScript({ content: `
        const vv = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight, scale: 1 });
        Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
        window.setFixtureViewport = (next) => { Object.assign(vv, next); vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
        window.__TAURI_INTERNALS__ = { invoke: async () => ({ peers: Array.from({ length: 40 }, (_, i) => ({ name: 'Device ' + i, ip: '100.80.0.' + (i + 1) })) }) };
        // Reproduce Safari's lack of implicit button focus, even in Chromium.
        document.addEventListener("mousedown", event => { if (event.target.closest('button[role="combobox"]')) event.preventDefault(); }, true);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
        window.copies = [];
        document.execCommand = (command) => {
          if (command !== "copy") return false;
          const field = document.activeElement;
          window.copies.push({ text: field.value, modal: !!field.closest("dialog[open]"), selected: field.selectionEnd - field.selectionStart });
          return field.tagName === "TEXTAREA" && field.selectionEnd === field.value.length;
        };
      ` });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(url);
      await page.getByRole("combobox", { name: "共享选择", exact: true }).waitFor();
      assert.deepEqual(errors, [], `${name}: fixture initialization`);
      assert.equal(await page.evaluate(() => matchMedia("(pointer:coarse)").matches), true);
      for (const label of ["共享选择", "记忆筛选", "选择连接地址"]) {
        const trigger = page.getByRole("combobox", { name: label, exact: true });
        await trigger.scrollIntoViewIfNeeded();
        const before = await page.locator("#scroller").evaluate(node => node.scrollTop);
        await trigger.click();
        assert.ok(await trigger.evaluate(node => node === document.activeElement), `${name}/${label}: explicit focus`);
        await bounded(page, '[role="listbox"]', 12);
        await page.keyboard.press("End");
        await page.waitForFunction(() => {
          const trigger = document.activeElement!, option = document.getElementById(trigger.getAttribute("aria-activedescendant")!);
          const panel = document.querySelector('[role="listbox"]'); if (!option || !panel) return false;
          const a = option.getBoundingClientRect(), b = panel.getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom;
        });
        assert.equal(await page.locator("#scroller").evaluate(node => node.scrollTop), before, `${name}/${label}: reveal must not scroll parent`);
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("listbox").count(), 0);
      }
      const combo = page.getByRole("combobox", { name: "建议输入", exact: true });
      await combo.focus(); await page.keyboard.press("ArrowUp"); await bounded(page, '[role="listbox"]', 12);
      await page.keyboard.press("Enter"); assert.equal(await combo.inputValue(), "Option 49");
      for (const scale of [.75, 1, 1.5]) {
        await page.evaluate(scale => document.documentElement.style.setProperty("--display-font-scale", String(scale)), scale);
        for (const selector of [".processing-filters input", ".processing-filters select", ".auto-compression-field input"]) {
          assert.ok(await page.locator(selector).evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16), `${name}/${selector}/${scale}: iOS zoom guard`);
        }
        assert.ok(await page.locator("#long-memory").evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${name}: long title stays bounded at ${scale}`);
      }
      await page.evaluate(() => document.documentElement.style.setProperty("--display-font-scale", "1"));
      await page.getByRole("combobox", { name: "连接设备", exact: true }).click();
      await bounded(page, ".device-menu", 12);
      await page.keyboard.press("Tab");
      assert.ok(await page.getByRole("button", { name: "刷新设备", exact: true }).evaluate(node => node === document.activeElement), `${name}: device refresh is keyboard reachable`);
      assert.equal(await page.getByRole("button", { name: "刷新设备", exact: true }).evaluate(node => getComputedStyle(node, "::after").content), "none", `${name}: no duplicate CSS tooltip`);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter"); assert.equal(await page.locator("#device-value").innerText(), "manual");
      await page.getByRole("combobox", { name: "连接设备", exact: true }).click();
      await page.evaluate(() => (window as any).setFixtureViewport({ offsetLeft: 20, offsetTop: 30, width: 330, height: 400 }));
      await bounded(page, ".device-menu", 12);
      await page.keyboard.press("Escape");
      await page.evaluate(() => (window as any).setFixtureViewport({ offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight }));
      await page.getByRole("button", { name: "打开模态框", exact: true }).click();
      await page.getByRole("combobox", { name: "模态选择", exact: true }).click();
      assert.ok(await page.getByRole("listbox").evaluate(node => !!node.closest("dialog[open]")), `${name}: modal ownership`);
      await page.keyboard.press("Escape");
      // WebKit pointer clicks intentionally do not focus buttons. Activate from
      // the keyboard so there is a definite pre-copy focus owner to restore.
      await page.locator("#copy-modal").focus();
      await page.keyboard.press("Enter"); await page.locator("#copy-result").filter({ hasText: "copied" }).waitFor();
      assert.deepEqual(await page.evaluate(() => (window as any).copies), [{ text: "inside-modal", modal: true, selected: 12 }]);
      assert.ok(await page.locator("#copy-modal").evaluate(node => node === document.activeElement), `${name}: restore copy focus`);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "开启批注", exact: true }).click();
      await page.locator(".annotation-source p").click(); await page.locator(".annotation-popover").waitFor();
      await page.evaluate(() => (window as any).setFixtureViewport({ offsetLeft: 20, offsetTop: 40, width: 320, height: 360 }));
      await bounded(page, ".annotation-popover", 12);
      await page.screenshot({ path: join(artifacts, `${name}-annotation-keyboard.png`) });
      await page.getByRole("textbox", { name: "批注意见", exact: true }).press("Escape");
      await page.evaluate(() => (window as any).setFixtureViewport({ offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight }));
      // Pointer events rather than touch-only focus: tooltip must stay unique and viewport-bounded.
      await page.locator("#tip-anchor").dispatchEvent("pointerover", { pointerType: "mouse" });
      await page.getByRole("tooltip").waitFor();
      await page.evaluate(() => (window as any).setFixtureViewport({ offsetLeft: 20, offsetTop: 40, width: 300, height: 320 }));
      await bounded(page, ".axiom-tooltip", 10);
      assert.equal(await page.getByRole("tooltip").count(), 1);
      await page.screenshot({ path: join(artifacts, `${name}-tooltip-viewport.png`) });
      assert.deepEqual(errors, [], `${name}: no page errors`);
      // Exercise the same keyboard order without native Popover support.
      await page.evaluate(() => {
        Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: undefined });
        Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: undefined });
        (window as any).setFixtureViewport({ offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight });
      });
      await page.getByRole("combobox", { name: "连接设备", exact: true }).click();
      await bounded(page, ".device-menu", 12);
      await page.keyboard.press("Tab");
      assert.ok(await page.getByRole("button", { name: "刷新设备", exact: true }).evaluate(node => node === document.activeElement), `${name}: fallback device refresh is keyboard reachable`);
      await page.keyboard.press("Escape");
      const fonts = await context.newPage(); await fonts.goto(url + "models.html");
      await fonts.locator("textarea").waitFor();
      assert.equal(await fonts.locator("textarea").evaluate(node => getComputedStyle(node).fontFamily), await fonts.locator("input").evaluate(node => getComputedStyle(node).fontFamily), `${name}: configuration textarea inherits app font`);
      results.push({ engine: name, focusAndScroll: true, coarseInputs: true, longMemory: true, deviceViewport: true, modalCopy: true, annotationViewport: true, tooltipViewport: true, configFont: true });
      await context.close();
    } finally { await browser.close(); }
  }
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, artifacts, results }));
} finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
