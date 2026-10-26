// Run: AXIOM_TEST_BROWSER=/path/to/chrome node --import tsx tests/tool-icons.check.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Locator } from "playwright";
import { createServer } from "vite";

const root = await mkdtemp(join(tmpdir(), "axiom-tool-icons-")), appRoot = resolve(".");
const output = process.env.AXIOM_ICON_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
await writeFile(join(root, "index.html"), `<!doctype html><html data-theme="light"><head><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:var(--bg);color:var(--fg)}main{max-width:900px;margin:auto}section{margin:10px 0}.existing-icons{display:flex;flex-wrap:wrap;gap:12px;font-size:13px}.existing-icons>span{display:inline-flex;align-items:center;gap:6px}</style></head><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/tool-icons.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
const expected = ["memory", "code", "discovery", "tool", "resources", "templates", "resource-read", "search", "web", "tool", "memory", "search", "search", "search", "search", "web", "read", "edit", "write", "bash"];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let checks = 0;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } }), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.locator('[data-case="19"] .activity-ticker .process-icon').waitFor();
  async function checkIcon(icon: Locator, kind: string, sprite: boolean) {
    assert.ok(await icon.isVisible(), `${kind}: icon visible`);
    const metrics = await icon.evaluate(node => {
      const svg = node.querySelector("svg")!, style = getComputedStyle(svg), bounds = node.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, svgWidth: parseFloat(style.width), svgHeight: parseFloat(style.height), color: style.color, stroke: style.strokeWidth,
        cap: style.strokeLinecap, join: style.strokeLinejoin, fill: style.fill, variable: style.getPropertyValue("--icon-stroke").trim() };
    });
    assert.equal(metrics.width, 13); assert.equal(metrics.height, 13);
    assert.equal(metrics.svgWidth, 13); assert.equal(metrics.svgHeight, 13);
    assert.equal(metrics.color, await page.locator(".existing-icons .process-icon-read").evaluate(node => getComputedStyle(node).color));
    assert.equal(metrics.cap, "round"); assert.equal(metrics.join, "round"); assert.equal(metrics.fill, "none");
    assert.ok(Math.abs(parseFloat(metrics.stroke) - 1.3) < 0.01); assert.equal(metrics.variable, ".1em");
    if (sprite) {
      assert.equal(await icon.locator("use").getAttribute("href"), `#i-tool-${kind}`);
      const symbol = page.locator(`#i-tool-${kind}`);
      assert.equal(await symbol.count(), 1);
      assert.ok(await symbol.locator("path").count() > 0);
      assert.equal(await symbol.locator("path").first().evaluate(node => getComputedStyle(node).vectorEffect), "non-scaling-stroke");
    }
    checks++;
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (let i = 0; i < expected.length; i++) {
        const section = page.locator(`[data-case="${i}"]`);
        await checkIcon(section.locator(".activity-ticker .process-icon"), expected[i], i < 16);
        const label = await section.getAttribute("data-label");
        assert.equal(await section.locator(".activity-ticker .tool-name").innerText(), label);
        assert.match(await section.locator(".activity-ticker").innerText(), /保留的完整摘要.*完整详情/s);
      }
      if (output) await page.screenshot({ path: join(output, `${theme}-${width}-collapsed.png`), fullPage: true, animations: "disabled" });
      await page.locator(".tool-activity > summary").evaluateAll(nodes => nodes.forEach(node => (node as HTMLElement).click()));
      await page.locator('[data-case="19"] .tool-heading').waitFor();
      for (let i = 0; i < expected.length; i++) {
        const section = page.locator(`[data-case="${i}"]`);
        await checkIcon(section.locator(".tool-heading .process-icon"), expected[i], i < 16);
        assert.equal(await section.locator(".tool-heading .tool-name").innerText(), await section.getAttribute("data-label"));
        assert.match(await section.locator(".tool-heading").innerText(), /保留的完整摘要.*完整详情/s);
        assert.ok(await section.locator(".tool-heading .process-icon").evaluate(node => node.classList.contains("is-active")));
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}/${width}: no horizontal overflow`);
      if (output) await page.screenshot({ path: join(output, `${theme}-${width}-expanded.png`), fullPage: true, animations: "disabled" });
      await page.locator(".tool-activity > summary").evaluateAll(nodes => nodes.forEach(node => (node as HTMLElement).click()));
      await page.locator('[data-case="19"] .activity-ticker').waitFor();
    }
  }
  assert.deepEqual(errors, []);
  const report = { passed: checks, failed: 0, themes: ["light", "dark"], widths: [1440, 390], cases: expected.length, errors };
  if (output) await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`PASS ${checks} icon checks: real tool rows and folded summaries; all selected categories, aliases, unknown/MCP, cached summaries, existing glyphs, 13px geometry, rounded 1.3px strokes, both themes/widths; no browser errors.`);
} finally { await browser?.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
