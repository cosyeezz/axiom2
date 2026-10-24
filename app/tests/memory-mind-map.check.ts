// Isolated real mind-map component: no backend, user data or model calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
const root = mkdtempSync(join(tmpdir(), "axiom-memory-map-"));
const output = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/memory-mind-map"); mkdirSync(output, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root, emptyOutDir: true, lib: { entry: resolve("tests/fixtures/memory-mind-map.tsx"), name: "MemoryMapFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), script = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${script}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(readFileSync(join(root, file)));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", hasTouch: true });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const canvas = page.getByLabel("记忆树画布"), stage = page.locator(".memory-tree-stage");
  const transform = () => stage.evaluate(node => { const m = new DOMMatrix(getComputedStyle(node).transform); return { x: m.e, y: m.f, scale: m.a }; });
  const settled = () => page.waitForTimeout(100);
  await page.locator(".memory-tree-node").first().waitFor(); await settled();
  assert.equal(await page.locator(".memory-tree-node").count(), 6);
  const product = page.getByRole("button", { name: /分类 产品与交互/ });
  await product.click(); assert.equal(await product.getAttribute("aria-expanded"), "true");
  const category = page.getByRole("button", { name: /分类 全局记忆画布/ }); await category.focus();
  await page.keyboard.press("ArrowRight"); await settled();
  assert.equal(await page.locator('[data-kind="Purpose"]').count(), 2);
  await page.keyboard.press("ArrowRight"); await settled();
  assert.match(await page.locator(":focus").getAttribute("aria-label") ?? "", /目的 思维导图/);
  await page.keyboard.press("Enter"); assert.equal(await page.locator(":focus").getAttribute("aria-pressed"), "true");
  await product.click(); assert.equal(await page.locator('[data-kind="Purpose"]').count(), 0);
  await page.getByLabel("搜索记忆").fill("必要的原文"); await settled();
  assert.equal(await page.locator(".memory-tree-node").count(), 3);
  await page.getByLabel("搜索记忆").fill(""); await settled();
  assert.equal(await page.locator(".memory-tree-node").count(), 6, "search does not change manual collapse");
  await page.getByLabel("搜索记忆").fill("not-a-memory"); await page.getByText("没有匹配的记忆").waitFor();
  await page.getByLabel("搜索记忆").fill(""); await settled();
  const bounds = (await canvas.boundingBox())!;
  const before = await transform();
  await page.mouse.move(bounds.x + 24, bounds.y + bounds.height - 100); await page.mouse.down(); await page.mouse.move(bounds.x + 104, bounds.y + bounds.height - 60, { steps: 5 }); await page.mouse.up(); await settled();
  const panned = await transform(); assert.ok(Math.abs(panned.x - before.x - 80) < 1); assert.ok(Math.abs(panned.y - before.y - 40) < 1);
  await page.getByRole("button", { name: "放大记忆树" }).click(); await settled();
  assert.ok((await transform()).scale > panned.scale);
  // Ctrl-wheel zoom preserves the world point underneath the pointer.
  const anchor = { x: bounds.width * .4, y: bounds.height * .4 }, old = await transform();
  await page.mouse.move(bounds.x + anchor.x, bounds.y + anchor.y); await page.keyboard.down("Control"); await page.mouse.wheel(0, -30); await page.keyboard.up("Control"); await settled();
  const zoomed = await transform(); assert.ok(zoomed.scale > old.scale);
  assert.ok(Math.abs((anchor.x - zoomed.x) / zoomed.scale - (anchor.x - old.x) / old.scale) < 1);
  assert.ok(Math.abs((anchor.y - zoomed.y) / zoomed.scale - (anchor.y - old.y) / old.scale) < 1);
  await page.getByRole("button", { name: "展开全部记忆" }).click(); await settled();
  assert.equal(await page.locator(".memory-tree-node").count(), 24);
  const visible = await page.locator(".memory-tree-node").evaluateAll(nodes => { const canvas = document.querySelector(".memory-tree-canvas")!.getBoundingClientRect(); return nodes.every(node => { const b = node.getBoundingClientRect(); return b.left >= canvas.left && b.right <= canvas.right && b.top >= canvas.top && b.bottom <= canvas.bottom; }); });
  assert.ok(visible, "fit includes every expanded branch");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.waitForTimeout(200);
    await page.screenshot({ path: join(output, `map-${theme}-1440.png`) });
  }
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await settled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}`);
    if (width < 700) assert.ok((await transform()).scale >= .9, "phone opens on readable labels");
    const controls = await page.locator(".memory-tree-zoom").boundingBox(), box = (await canvas.boundingBox())!;
    assert.ok(controls && controls.x >= box.x && controls.x + controls.width <= box.x + box.width, `controls accessible at ${width}`);
    await page.screenshot({ path: join(output, `map-light-${width}.png`) });
  }
  // Actual two-finger touch pan/pinch through Chrome's touch pipeline.
  const box = (await canvas.boundingBox())!, cdp = await page.context().newCDPSession(page);
  const touch = (id: number, x: number, y: number) => ({ id, x: box.x + x, y: box.y + y });
  await product.tap(); await settled(); assert.equal(await product.getAttribute("aria-expanded"), "false", "touch tap still toggles a node");
  await product.tap(); await settled(); assert.equal(await product.getAttribute("aria-expanded"), "true");
  const nodeBox = (await product.boundingBox())!, dragStart = await transform();
  const finger = { id: 3, x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + 20 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...finger, x: finger.x + 30, y: finger.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settled();
  assert.equal(await product.getAttribute("aria-expanded"), "true", "touch drag on a node never triggers collapse");
  assert.ok((await transform()).x > dragStart.x, "touch drag can start on node text");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(4, 60, 180)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await settled();
  assert.equal(await canvas.getAttribute("data-moving"), null, "cancelled touch clears gesture state");
  const pinchBefore = await transform();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(1, 80, 160), touch(2, 180, 160)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(1, 50, 160), touch(2, 210, 160)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settled();
  assert.ok((await transform()).scale > pinchBefore.scale, "two-finger pinch zooms");
  assert.equal(await canvas.getAttribute("data-moving"), null, "touch release clears gesture state");
  await page.getByRole("button", { name: "收起全部记忆" }).click(); await settled(); assert.equal(await page.locator(".memory-tree-node").count(), 6);
  assert.equal(await stage.evaluate(node => getComputedStyle(node).transitionDuration), "0s", "reduced motion disables camera animation");
  assert.deepEqual(errors, []);
  console.log(`PASS mind map: collapse/search/keyboard, pan, anchored wheel zoom, fit, 4 widths, 2 themes, touch pinch, reduced motion. ${output}`);
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
