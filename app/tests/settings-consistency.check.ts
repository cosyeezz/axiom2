// Cross-page geometry, not only per-page overflow. Run from app/ with tsx.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-settings-consistency-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: { fixture: {
  name: "Fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
  models: [{ id: "fixture-model", name: "Fixture model", input: ["text"] }],
} } }));
const output = resolve("test-results/settings-consistency"); mkdirSync(output, { recursive: true });
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [];
const pages: Page[] = [];
async function metrics(page: Page) {
  return page.evaluate(() => {
    const boxes = [".settings-sidebar", ".topnav", ".topnav>.row", ".back-link", ".settings-brand", ".settings-nav", ".supplier-panel", ".supplier-detail", ".detail-heading", ".supplier-detail .input", ".configuration-actions", "#suppliers-screen:not([hidden]),.model-registry:not([hidden]),.tools-content", ".section-heading"].map(selector => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node || getComputedStyle(node).display === "none") return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    return { sidebar: boxes[0], nav: boxes[1], crumb: boxes[2],
      back: boxes[3], brand: boxes[4], navItem: boxes[5],
      list: boxes[6], detail: boxes[7], heading: boxes[8],
      input: boxes[9], footer: boxes[10], content: boxes[11], section: boxes[12],
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}
const close = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);
try {
  for (const path of ["settings.html", "model-config.html", "tools.html"]) {
    const page = await browser.newPage(); pages.push(page);
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${app.origin}/${path}`);
  }
  const [overview, models, tools] = pages;
  await overview.locator("#model-config-summary").filter({ hasText: "个供应商" }).waitFor();
  await models.locator("#provider-id").waitFor();
  await tools.locator("#opencli-profile").waitFor();
  for (const [width, height] of [[320,640],[390,844],[640,900],[780,900],[800,900],[820,1180],[1100,800],[1200,800],[1440,900],[1920,1080],[1024,400]]) {
    for (const page of pages) { await page.setViewportSize({ width, height }); await page.evaluate(() => window.scrollTo(0, 0)); }
    const [a,b,c] = await Promise.all(pages.map(metrics));
    for (const [name,m] of [["overview",a],["models",b],["tools",c]] as const) {
      assert.equal(m.overflow, false, `${name} ${width}: no overflow`);
      assert.equal(!!m.sidebar, width > 800, `${name}: shared mobile breakpoint`);
      close(m.nav!.height, a.nav!.height, `${name}: header height`);
      close(m.nav!.x, a.nav!.x, `${name}: header left`);
      close(m.crumb!.x, a.crumb!.x, `${name}: breadcrumb left`);
      if (m.sidebar) {
        close(m.sidebar.width, a.sidebar!.width, `${name}: sidebar width`);
        for (const key of ["back", "brand", "navItem"] as const) {
          close(m[key]!.y, a[key]!.y, `${name}: sidebar ${key} vertical alignment`);
          close(m[key]!.height, a[key]!.height, `${name}: sidebar ${key} height`);
        }
      }
    }
    close(b.list!.x,c.list!.x,"list starts at same x");
    close(b.list!.y,c.list!.y,"list starts below same header");
    close(b.list!.width,c.list!.width,"secondary navigation width");
    close(b.heading!.x,c.heading!.x,"detail heading inset");
    close(b.heading!.width,c.heading!.width,"detail heading width");
    close(b.input!.height,c.input!.height,"form control height");
    close(b.content!.x,c.content!.x,"content left edge");
    close(b.content!.width,c.content!.width,"content width cap");
    if (width > 800) close(b.heading!.y,c.heading!.y,"desktop detail heading top");
    await models.locator("#models-tab").click();
    const registry = await metrics(models);
    close(registry.content!.x,b.content!.x,"connection/model tabs content left");
    close(registry.content!.width,b.content!.width,"connection/model tabs content width");
    close(registry.footer!.width,b.footer!.width,"connection/model tabs footer width");
    for (const [name,page] of [["overview",overview],["models",models],["tools",tools]] as const) {
      await page.screenshot({ path: join(output,`${name}-${width}x${height}.png`), fullPage:true });
    }
    await models.locator("#suppliers-tab").click();
    await models.screenshot({ path:join(output,`connection-${width}x${height}.png`),fullPage:true });
    for (const page of [models,tools]) {
      const save = page.locator(".configuration-actions .btn-primary");
      await save.scrollIntoViewIfNeeded();
      assert.ok(await save.evaluate(node => { const r=node.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight+1 && node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), "footer action reachable");
      await page.evaluate(() => { window.scrollTo(0,0); document.querySelector(".supplier-detail")?.scrollTo(0,0); });
    }
  }
  assert.deepEqual(errors,[]);
  console.log("PASS shared header/sidebar geometry, 800px breakpoint, list grid, content width and inset, control heights, tab alignment and save reachability at 11 viewport sizes. " + output);
} finally {
  await browser.close(); await app.close();
  if (previous===undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR=previous;
  rmSync(root,{recursive:true,force:true});
}
