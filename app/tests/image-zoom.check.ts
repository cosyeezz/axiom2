// AXIOM_TEST_ENGINE=webkit or AXIOM_TEST_BROWSER=/path/to/chrome npx tsx tests/image-zoom.check.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const root = await mkdtemp(join(tmpdir(), "axiom-image-zoom-"));
const appRoot = resolve("."), engine = process.env.AXIOM_TEST_ENGINE === "webkit" ? "webkit" : "chromium";
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || `test-results/image-zoom-${engine}`);
await mkdir(artifacts, { recursive: true });
await writeFile(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/image-zoom.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER }));
  const page = await browser.newPage({ viewport: { width: 980, height: 780 } });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__name = (value: unknown) => value;
    const pending = new Set<number>(), request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    (window as any).zoomPendingFrames = pending;
    window.requestAnimationFrame = callback => { const id = request(time => { pending.delete(id); callback(time); }); pending.add(id); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  });
  await page.goto(server.resolvedUrls!.local[0]);
  const img = page.locator(".file-image-stage img"), scroll = page.locator(".file-image-scroll");
  const geometry = () => img.evaluate((node: HTMLImageElement) => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: r.width / node.naturalWidth };
  });
  const settle = async () => {
    const samples = await page.evaluate(async () => {
    const sizes: number[] = []; let previous = -1, stable = 0;
    for (let i = 0; i < 240; i++) {
      await new Promise<void>(done => requestAnimationFrame(() => done()));
      const width = document.querySelector(".file-image-stage img")!.getBoundingClientRect().width;
      sizes.push(width); stable = Math.abs(width - previous) < .001 ? stable + 1 : 0; previous = width;
      if (stable >= 12) return sizes;
    }
    throw new Error("image zoom animation did not settle");
    });
    assert.equal(await page.evaluate(() => (window as any).zoomPendingFrames.size), 0, "settled zoom must not leak animation frames");
    return samples;
  };
  const loaded = async () => {
    await img.evaluate((node: HTMLImageElement) => node.decode());
    await page.waitForFunction(() => document.querySelector(".file-image-stage img")!.getBoundingClientRect().width > 0);
    await settle();
  };
  const fit = async () => { await page.getByRole("button", { name: "图片适应窗口", exact: true }).click(); await settle(); assert.equal(await page.locator(".file-zoom").innerText(), "适应"); };
  const wheelAt = async (delta: number, point: { x: number; y: number }, modifiers = false) => {
    const before = await geometry();
    await page.mouse.move(point.x, point.y);
    if (modifiers) await page.keyboard.down("Control");
    await page.mouse.wheel(0, delta);
    if (modifiers) await page.keyboard.up("Control");
    await page.waitForFunction(width => Math.abs(document.querySelector(".file-image-stage img")!.getBoundingClientRect().width - width) > .01, before.width);
    const samples = await settle(), after = await geometry();
    const u = (point.x - before.x) / before.width, v = (point.y - before.y) / before.height;
    assert.ok(Math.abs(after.x + u * after.width - point.x) < 1.5, `pointer x stays anchored: ${JSON.stringify({ before, after, point })}`);
    assert.ok(Math.abs(after.y + v * after.height - point.y) < 1.5, "pointer y stays anchored");
    return { before, after, samples };
  };
  const burst = async (delta: number, count: number) => {
    await scroll.evaluate((node, { delta, count }) => {
      const box = node.getBoundingClientRect();
      for (let i = 0; i < count; i++) node.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: box.x + box.width * .6, clientY: box.y + box.height * .4, bubbles: true, cancelable: true }));
    }, { delta, count });
    await settle();
  };
  await loaded();
  const initial = await geometry();
  const point = { x: initial.x + initial.width * .76, y: initial.y + initial.height * .3 };
  const first = await wheelAt(-100, point);
  assert.ok(Math.abs(first.after.scale / first.before.scale - Math.exp(.05)) < .0002, "one notch is about 5% relative, not 25 percentage points");
  assert.ok(new Set(first.samples.map(value => value.toFixed(2))).size > 2, "default motion interpolates through multiple frames");
  const reverse = await wheelAt(100, point);
  assert.ok(Math.abs(reverse.after.scale - initial.scale) < .0002, "reverse wheel returns to original scale");
  await wheelAt(-2, point);
  assert.equal(await page.evaluate(() => scrollY), 0, "image wheel never scrolls the page");
  await fit();
  const buttonBefore = await geometry();
  await page.getByRole("button", { name: "放大图片", exact: true }).click(); await settle();
  assert.ok(Math.abs((await geometry()).scale - buttonBefore.scale - .05) < .0001, "toolbar increments five percentage points from actual fit");
  await page.getByRole("button", { name: "缩小图片", exact: true }).click(); await settle();
  assert.ok(Math.abs((await geometry()).scale - buttonBefore.scale) < .0001);
  await fit();
  await burst(-100, 100);
  assert.equal(await page.locator(".file-zoom").innerText(), "300%");
  assert.ok(await page.getByRole("button", { name: "放大图片", exact: true }).isDisabled());
  // Real native scrollbar pan must be included in subsequent focal calculations.
  await scroll.evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2; node.scrollTop = (node.scrollHeight - node.clientHeight) / 2; });
  const panBeforeResize = await geometry(), scrollBeforeResize = await scroll.evaluate(node => [node.scrollLeft, node.scrollTop]);
  await page.setViewportSize({ width: 1040, height: 780 }); await settle();
  const panAfterResize = await geometry();
  assert.ok(Math.abs(panAfterResize.x - panBeforeResize.x) < 1 && Math.abs(panAfterResize.y - panBeforeResize.y) < 1, "manual panning survives viewport resize");
  assert.deepEqual(await scroll.evaluate(node => [node.scrollLeft, node.scrollTop]), scrollBeforeResize);
  const box = (await scroll.boundingBox())!;
  await wheelAt(100, { x: box.x + box.width * .65, y: box.y + box.height * .35 }, true);
  assert.equal(await page.evaluate(() => visualViewport!.scale), 1, "Ctrl-wheel is local, not browser zoom");
  await burst(100, 150);
  assert.equal(await page.locator(".file-zoom").innerText(), "5%");
  assert.ok(await page.getByRole("button", { name: "缩小图片", exact: true }).isDisabled());
  await fit();
  assert.deepEqual(await scroll.evaluate(node => [node.scrollLeft, node.scrollTop]), [0, 0]);
  await page.screenshot({ path: join(artifacts, "fit.png") });
  // Small images remain pointer-anchored even with zero initial scroll range.
  await page.evaluate(() => (window as any).imageFixture.setPicture("small")); await loaded();
  const small = await geometry(); assert.equal(small.scale, 1);
  await wheelAt(-100, { x: small.x + small.width * .8, y: small.y + small.height * .2 });
  await page.getByRole("button", { name: "图片适应窗口", exact: true }).click(); await settle();
  await page.setViewportSize({ width: 390, height: 780 }); await settle();
  assert.equal(await page.locator(".file-zoom").innerText(), "适应");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, "small-mobile.png") });
  await page.evaluate(() => (window as any).imageFixture.setPicture("huge")); await loaded();
  const huge = await geometry(); assert.ok(huge.scale < .01);
  const hugeBox = (await scroll.boundingBox())!;
  const hugeWheel = await wheelAt(-30, { x: hugeBox.x + hugeBox.width * .7, y: hugeBox.y + hugeBox.height * .4 });
  assert.ok(hugeWheel.after.scale < huge.scale * 1.02, "fit below minimum has no jump");
  await fit();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (window as any).imageFixture.setPicture("normal")); await loaded();
  const reduced = await geometry();
  await wheelAt(-100, { x: reduced.x + reduced.width * .7, y: reduced.y + reduced.height * .4 });
  await fit();
  // Reset during an in-flight animation must cancel its pending target.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await burst(-100, 10); await page.getByRole("button", { name: "放大图片", exact: true }).click(); await fit();
  assert.equal(await page.locator(".file-zoom").innerText(), "适应");
  await page.evaluate(() => (window as any).imageFixture.setPicture("broken"));
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "放大图片", exact: true }).click();
  await page.evaluate(() => (window as any).imageFixture.setPicture("normal")); await loaded();
  await page.getByRole("button", { name: "放大图片", exact: true }).click();
  await page.evaluate(() => (window as any).imageFixture.setMounted(false));
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: smooth pointer zoom from fit/small/huge, reverse/fine wheel, 5-point buttons, scroll pan, Ctrl-wheel, burst limits, fit reset, resize/mobile, reduced motion, decode failure and unmount. ${artifacts}`);
} finally {
  await browser?.close(); await server.close(); await rm(root, { recursive: true, force: true });
}
