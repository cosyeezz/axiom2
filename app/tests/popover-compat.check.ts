// Standalone: AXIOM_TEST_BROWSER=/path/to/chrome npm exec tsx tests/popover-compat.check.ts
// Uses an isolated static fixture; no backend, credentials, model calls or user windows.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
import { displayTypography } from "../scripts/display-typography.js";

const root = mkdtempSync(join(tmpdir(), "axiom-popover-compat-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/popover-compat");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' },
  css: { postcss: { plugins: [displayTypography()] } },
  build: { outDir: root, emptyOutDir: true, target: "safari15", minify: false, lib: { entry: resolve(process.env.AXIOM_TEST_DISPLAY === "1" ? "tests/fixtures/display-popover.tsx" : "tests/fixtures/popover-compat.tsx"), name: "PopoverFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), script = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${script}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
  res.end(readFileSync(join(root, file)));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const results: unknown[] = [];
try {
  for (const mode of ["native", "missing", "throwing"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    if (mode !== "native") await page.addInitScript(mode => {
      if (mode === "throwing") {
        HTMLElement.prototype.showPopover = () => { throw new DOMException("Fixture native popover failure", "InvalidStateError"); };
      } else {
        Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: undefined });
        Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: undefined });
        // Also reproduce WebViews that reject the selector, including in tooltip.closest().
        for (const name of ["matches", "closest"] as const) {
          const original: (this: Element, selector: string) => boolean | Element | null = Element.prototype[name];
          (Element.prototype as any)[name] = function(this: Element, selector: string) {
            if (selector.includes(":popover-open")) throw new DOMException("Unsupported popover selector", "SyntaxError");
            return original.call(this, selector);
          };
        }
      }
    }, mode);
    try {
      await page.goto(url);
      await page.locator("#prompt").waitFor();
      const result = await page.evaluate(() => (window as any).runPopoverChecks());
      for (const [trigger, panel] of [["子代理设置", ".subagent-settings"], ["技能与 MCP", ".capability-settings"], ["重新加载会话配置", ".session-reload"]]) {
        await page.getByRole("button", { name: trigger, exact: true }).click();
        await page.keyboard.press("Escape");
        await page.locator(panel).waitFor({ state: "detached" });
      }
      await page.getByRole("button", { name: "子代理设置", exact: true }).click();
      const panel = page.locator(".subagent-settings");
      const box = (await panel.boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
      await page.mouse.move(30, 30); await page.mouse.up();
      assert.equal(await panel.isVisible(), true, "dragging out must not light-dismiss");
      await page.locator("#outside").click();
      await panel.waitFor({ state: "detached" });
      await page.locator('[data-od-id="cache-tokens"]').click();
      await page.screenshot({ path: join(artifacts, `${mode}-desktop.png`) });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-od-id="cache-tokens"]').click();
      assert.ok(await page.locator(".cache-detail").evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1; }));
      await page.screenshot({ path: join(artifacts, `${mode}-mobile.png`) });
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, [], "popover interaction must not throw");
      await page.locator("#crash").click();
      await page.getByRole("heading", { name: "页面显示遇到问题" }).waitFor();
      await page.getByRole("button", { name: "恢复页面", exact: true }).click();
      assert.equal(await page.locator("#prompt").inputValue(), "保留未发送草稿", "boundary recovery keeps draft store");
      await page.locator('[data-od-id="cache-tokens"]').click();
      await page.locator(".cache-detail").waitFor();
      results.push({ mode, ...result, boundaryRecovery: true });
    } catch (error) {
      await page.screenshot({ path: join(artifacts, `${mode}-failure.png`) });
      console.error({ mode, errors, body: await page.locator("body").innerText() });
      throw error;
    } finally { await page.close(); }
  }
  if (process.platform === "darwin" && process.env.AXIOM_TEST_SKIP_WEBKIT !== "1") {
    const native = await promisify(execFile)("swift", [resolve("tests/webkit-popover-probe.swift"), url], { timeout: 60_000 });
    writeFileSync(join(artifacts, "webkit.log"), native.stdout + native.stderr);
    results.push({ mode: "system-wkwebview", ...JSON.parse(native.stdout.trim()) });
  }
  writeFileSync(join(artifacts, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, artifacts, results }));
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
