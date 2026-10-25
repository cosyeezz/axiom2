// Isolated theme checks: real React menus/dialogs, no backend or user data.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build, createServer as createViteServer } from "vite";
import { chromium, type Page } from "playwright";
import { displayTypography } from "../scripts/display-typography.js";

const output = resolve(process.env.AXIOM_THEME_ARTIFACTS || "test-results/theme");
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "axiom-theme-"));
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' },
  css: { postcss: { plugins: [displayTypography()] } }, build: { outDir: root, target: "safari15", lib: { entry: resolve("tests/fixtures/theme.tsx"), name: "ThemeFixture", formats: ["iife"], fileName: "fixture" } } });
const files = await readdir(root);
await writeFile(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${files.find(f => f.endsWith(".css"))}"></head><body><div id="root"></div><script src="/${files.find(f => f.endsWith(".js"))}"></script></body></html>`);
const server = createServer(async (req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(join(root, file)));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const desktop = await createViteServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: join(root, "desktop-cache"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await desktop.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [], results: unknown[] = [];
const context = await browser.newContext();
await context.addInitScript({ content: "window.__name = (value) => value;" });
async function waitTheme(page: Page, theme: "light" | "dark") {
  await page.waitForFunction(value => document.documentElement.dataset.theme === value && !document.querySelector<HTMLButtonElement>('.theme-toggle')?.disabled, theme);
  await page.evaluate(async () => {
    // Capture the settled palette, including controller buttons' color/background transitions.
    document.documentElement.getBoundingClientRect();
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
  });
}
async function checkContrast(page: Page, selector: string) {
  const values = await page.locator(selector).first().evaluate(node => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgba = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    let parent: Element | null = node;
    const layers: number[][] = [];
    while (parent) { layers.unshift(rgba(getComputedStyle(parent).backgroundColor)); parent = parent.parentElement; }
    const background = layers.reduce((base, layer) => base.map((v, i) => layer[i] * layer[3] / 255 + v * (1 - layer[3] / 255)), [255, 255, 255]);
    const foreground = getComputedStyle(node).color, fg = luminance(rgba(foreground)), bg = luminance(background);
    return { foreground, background, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
  });
  assert.ok(values.ratio >= 4.5, `${selector} text contrast ${JSON.stringify(values)}`);
  return values;
}
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(value => (window as any).setFixtureTheme(value), theme);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    const regression = await page.evaluate(() => (window as any).runPopoverChecks());
    await page.getByRole("button", { name: "打开确认弹窗" }).click();
    await checkContrast(page, ".confirm-description");
    await checkContrast(page, ".confirm-danger");
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.locator(".confirm-error").waitFor();
    await checkContrast(page, ".confirm-error");
    await page.screenshot({ path: join(output, `${theme}-dialog.png`) });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await checkContrast(page, ".thinking-body");
    assert.equal(await page.locator('.process-icon-think').evaluate(el => getComputedStyle(el).color), theme === "light" ? "rgb(128, 97, 32)" : "rgb(230, 216, 163)");
    const failedColors = await page.locator('.activity-current[data-status="failed"]').evaluate(el => [getComputedStyle(el).color, getComputedStyle(el.querySelector('.process-icon')!).color]);
    assert.equal(failedColors[0], failedColors[1], "failed icon retains semantic color");
    await checkContrast(page, ".skill-card-copy > span");
    await page.getByRole("combobox", { name: "测试选项", exact: true }).click();
    await checkContrast(page, '.select-option[aria-selected="true"]');
    // An open, portaled menu must recolor without being remounted.
    await page.evaluate(value => (window as any).setFixtureTheme(value), theme === "light" ? "dark" : "light");
    assert.equal(await page.locator(".select-menu").isVisible(), true);
    await checkContrast(page, '.select-option[aria-selected="true"]');
    await page.evaluate(value => (window as any).setFixtureTheme(value), theme);
    await page.screenshot({ path: join(output, `${theme}-select.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "复制代码", exact: true }).hover();
    await page.getByRole("tooltip").waitFor();
    await checkContrast(page, ".axiom-tooltip");
    await page.screenshot({ path: join(output, `${theme}-tooltip.png`) });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-od-id="cache-tokens"]').click();
    await page.locator(".cache-detail").waitFor();
    await page.screenshot({ path: join(output, `${theme}-mobile-panel.png`) });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    results.push({ theme, regression });
  }
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "choice persists after reload");

  // Two origins mimic the controller/workbench boundary; run the actual native delivery script.
  const nativeScript = await readFile(resolve("desktop/axiom_theme.js"), "utf8");
  let state = { theme: "dark", revision: 0 };
  const controller = await context.newPage();
  await controller.setViewportSize({ width: 1440, height: 48 });
  controller.on("pageerror", error => errors.push(error.message));
  await controller.exposeFunction("themeBridge", async (theme: string) => {
    state = { theme, revision: state.revision + 1 };
    await page.evaluate(nativeScript);
    await page.evaluate(value => (window as any).__axiomApplyTheme(value), state);
    return state;
  });
  await controller.addInitScript(() => {
    let view = "workbench";
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any) => {
      if (name === "axiom_theme") return (window as any).themeBridge(args.theme);
      if (name === "axiom_connection") return "connected";
      if (name === "axiom_service") return { desktopView: view, state: "running", active: [], url: "http://127.0.0.1:4317/" };
      if (name === "axiom_update") return { managed: true, clientSupported: true, clientVersion: "0.4.11", release: null, job: null };
      if (name === "axiom_controls") { view = "control"; window.dispatchEvent(new CustomEvent("axiom-desktop-view", { detail: "control" })); return; }
      if (name === "axiom_peers") return { peers: [] };
      if (name === "axiom_cleanup" && args.request?.op.endsWith(".get")) return { requestId: args.request.requestId, data: { revision: "empty-fixture", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
      if (name === "axiom_setup") return args.action === "check" ? { nodeReady: true, npmReady: true, writable: true, tailscale: true, platform: "darwin", nodeVersion: "24.0.0", npmVersion: "11.0.0" } : { job: null };
      throw Error(`Unexpected IPC ${name}`);
    } };
  });
  await controller.goto(desktop.resolvedUrls!.local[0]);
  await controller.locator(".desktop-workbench-bar").waitFor();
  for (const width of [320, 360, 390, 820, 1440]) {
    await controller.setViewportSize({ width, height: 48 });
    assert.equal(await controller.evaluate(() => {
      const theme = document.querySelector('.desktop-workbench-actions .theme-toggle')!.getBoundingClientRect();
      const service = document.querySelector('.desktop-workbench-actions button:last-child')!.getBoundingClientRect();
      const status = document.querySelector('.desktop-workbench-status')!.getBoundingClientRect();
      return theme.right <= service.left && status.right <= theme.left && service.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    }), true, `header fits ${width}`);
  }
  for (const theme of ["light", "dark"] as const) {
    await controller.locator('.desktop-workbench-actions .theme-toggle').click();
    await waitTheme(controller, theme);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme, "workbench follows controller across origins");
    await controller.screenshot({ path: join(output, `${theme}-header.png`) });
  }
  await controller.locator('.desktop-workbench-actions .theme-toggle').click();
  await waitTheme(controller, "light");
  await controller.reload();
  await controller.locator(".desktop-workbench-bar").waitFor();
  await waitTheme(controller, "light");
  assert.equal(await controller.locator("html").getAttribute("data-theme"), "light");
  await controller.setViewportSize({ width: 1100, height: 900 });
  await controller.getByRole("button", { name: /^服务与更新/ }).click();
  await controller.locator(".connect-page").waitFor();
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await controller.locator('.connect-header .theme-toggle').click();
    await waitTheme(controller, theme);
    await controller.screenshot({ path: join(output, `${theme}-connect.png`) });
    await controller.locator('.device-trigger').click();
    await controller.locator('.device-menu').waitFor();
    await checkContrast(controller, '.device-option[aria-selected="true"]');
    await controller.screenshot({ path: join(output, `${theme}-device-menu.png`) });
    await controller.keyboard.press("Escape");
    await controller.getByRole("button", { name: "关闭后台服务", exact: true }).click();
    await controller.getByRole('dialog', { name: '关闭后台服务？' }).waitFor();
    await checkContrast(controller, '.confirm-dialog .confirm-description');
    await controller.screenshot({ path: join(output, `${theme}-service-dialog.png`) });
    await controller.getByRole("button", { name: "继续运行", exact: true }).click();
  }
  await controller.locator('.connect-header .theme-toggle').click();
  await waitTheme(controller, "light");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  // Old replies must never revert a newer native theme.
  await page.evaluate(() => (window as any).__axiomApplyTheme({ theme: "dark", revision: 0 }));
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  assert.deepEqual(errors, []);
  await writeFile(join(output, "results.json"), JSON.stringify({ passed: true, results, crossOrigin: true, widths: [320, 360, 390, 820, 1440], errors }, null, 2));
  console.log(`Theme checks passed: palettes, eight real panels, select, tooltip, modal, contrast, persistence, cross-origin delivery. Artifacts: ${output}`);
} catch (error) {
  console.error("Theme fixture page errors:", errors);
  for (const [index, page] of context.pages().entries()) { await page.screenshot({ path: join(output, `failure-${index}.png`), fullPage: true }).catch(() => {}); await writeFile(join(output, `failure-${index}.txt`), await page.locator("body").innerText().catch(() => "unavailable")).catch(() => {}); }
  throw error;
} finally {
  await browser.close(); await desktop.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
