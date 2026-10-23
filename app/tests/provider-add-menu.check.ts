// Isolated regression: no server data, credentials or OAuth requests.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";

const root = mkdtempSync(join(tmpdir(), "axiom-provider-menu-"));
await build({ configFile: false, logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' },
  build: { outDir: root, emptyOutDir: true, target: "safari15", lib: {
    entry: resolve("tests/fixtures/provider-add-menu.tsx"), name: "ProviderMenuFixture", formats: ["iife"], fileName: "fixture",
  } } });
const files = readdirSync(root), script = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><head><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${script}"></script></body></html>`);
    return;
  }
  const file = basename(new URL(req.url!, "http://fixture").pathname);
  if (!files.includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "text/css");
  res.end(readFileSync(join(root, file)));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  for (const mode of ["native", "fallback"]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    if (mode === "fallback") await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: undefined });
      Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: undefined });
    });
    await page.goto(url);
    const trigger = page.locator("#add-supplier"), menu = page.getByRole("menu");
    await trigger.waitFor();
    assert.equal((await page.evaluate(() => (window as any).runPopoverChecks())).passed, true);
    for (const [index, value] of ["oauth", "custom"].entries()) {
      await trigger.click();
      await menu.getByRole("menuitem").nth(index).click();
      assert.equal(await page.locator("#selection").innerText(), value);
      await menu.waitFor({ state: "detached" });
    }
    await trigger.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#selection").innerText(), "custom");
    assert.equal(await page.locator("#selection").getAttribute("data-count"), "5");
    await trigger.click();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate(node => node === document.activeElement));
    await trigger.click();
    await page.keyboard.press("Tab");
    await menu.waitFor({ state: "detached" });
    await trigger.click();
    await page.locator("#outside").click();
    await menu.waitFor({ state: "detached" });
    await trigger.click();
    await page.locator("#outside").focus();
    await menu.waitFor({ state: "detached" });
    await trigger.click();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await menu.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${mode}: null-relatedTarget clicks, real pointer clicks, keyboard selection, dismissal and focus`);
  }
  if (process.platform === "darwin") {
    const result = await promisify(execFile)("swift", [resolve("tests/webkit-popover-probe.swift"), url], { timeout: 60_000 });
    assert.equal(JSON.parse(result.stdout.trim()).passed, true);
    console.log(`PASS system WKWebView: ${result.stdout.trim()}`);
  }
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
