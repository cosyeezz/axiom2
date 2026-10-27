// Whole-message window coverage with real native scrolling. No backend/model calls.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const temporary = mkdtempSync(join(tmpdir(), "axiom-window-performance-"));
const server = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "vite"),
  server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const reports: unknown[] = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  for (const [estimate, actual] of [[80, 80], [680, 40]]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/__timeline_performance?*", route => route.fulfill({ contentType: "text/html",
      body: '<div id="root"></div><script type="module" src="/tests/fixtures/timeline-performance.tsx"></script>' }));
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__timeline_performance?estimate=${estimate}&actual=${actual}`);
    await page.waitForFunction(() => !!(window as any).timelineProbe);
    await page.waitForTimeout(250);
    const thread = page.locator(".thread");
    const jumped = await thread.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      node.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 1, clientX: bounds.right - 2, bubbles: true }));
      node.scrollTop = 60000; node.dispatchEvent(new Event("scroll"));
      return (window as any).timelineProbe.snapshot();
    });
    assert.ok(jumped.body > .99 && jumped.spacer < .01, `a large scroll must synchronously mount its viewport: ${JSON.stringify({ estimate, actual, jumped })}`);
    await thread.dispatchEvent("pointerup", { pointerId: 1, bubbles: true });
    await page.evaluate(() => {
      (window as any).coverageSamples = []; (window as any).collectCoverage = true;
      const sample = () => {
        (window as any).coverageSamples.push((window as any).timelineProbe.snapshot());
        if ((window as any).collectCoverage) requestAnimationFrame(() => setTimeout(sample, 0));
      };
      requestAnimationFrame(sample);
    });
    const bounds = (await thread.boundingBox())!;
    await page.mouse.move(bounds.x + 300, bounds.y + 250);
    for (const delta of [2400, 2400, -2400, 2400, -2400, -2400]) { await page.mouse.wheel(0, delta); await page.waitForTimeout(30); }
    await thread.focus();
    for (let i = 0; i < 8; i++) { await page.keyboard.press("PageDown"); await page.waitForTimeout(20); }
    await page.waitForTimeout(250);
    const samples: { top: number; mounted: number; body: number; spacer: number }[] = await page.evaluate(() => {
      (window as any).collectCoverage = false; return (window as any).coverageSamples;
    });
    reports.push({ estimate, actual, jumped, samples, errors });
    assert.ok(samples.length > 10);
    assert.ok(samples.every(sample => sample.spacer < .05), `painted viewport must not be spacer: ${JSON.stringify({ estimate, actual, bad: samples.filter(sample => sample.spacer >= .05) })}`);
    assert.ok(samples.every(sample => sample.mounted < 120), "coverage must not come from unbounded rendering");
    assert.deepEqual(errors, []);
    console.log(`PASS estimate=${estimate}/actual=${actual}: ${samples.length} post-paint coverage samples, maxSpacer=${Math.max(...samples.map(sample => sample.spacer))}, maxMounted=${Math.max(...samples.map(sample => sample.mounted))}`);

    // rAF DOM coverage alone misses compositor-only blank frames during native
    // smooth scrolling. Inspect pixels of every emitted painted frame as well.
    const cdp = await page.context().newCDPSession(page), images: string[] = [];
    cdp.on("Page.screencastFrame", event => {
      images.push(event.data); void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await page.evaluate(() => {
      (window as any).smoothSamples = [];
      (window as any).timelineProbe.edge("bottom", "smooth");
      const sample = () => {
        const state = (window as any).timelineProbe.snapshot();
        (window as any).smoothSamples.push(state);
        if (state.edgeActive) requestAnimationFrame(sample);
      };
      sample();
    });
    await page.waitForFunction(() => !(window as any).timelineProbe.snapshot().edgeActive);
    await page.waitForTimeout(100);
    await cdp.send("Page.stopScreencast"); await cdp.detach();
    const painted = await page.evaluate(async ({ images, x, y, height }) => {
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
      const coverage: number[] = [];
      for (const source of images) {
        const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
        canvas.width = image.width; canvas.height = image.height; context.drawImage(image, 0, 0);
        const pixels = context.getImageData(x, y, 1, height).data;
        let body = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 136 && pixels[i + 1] === 204 && pixels[i + 2] === 136) body++;
        coverage.push(body / height);
      }
      return coverage;
    }, { images, x: Math.round(bounds.x + 400), y: Math.round(bounds.y + 2), height: Math.floor(bounds.height - 4) });
    const smooth: { top: number; spacer: number; mounted: number }[] = await page.evaluate(() => (window as any).smoothSamples);
    reports.push({ estimate, actual, painted, smooth });
    assert.ok(painted.length > 5 && painted.every(coverage => coverage > .99), `smooth jump must paint bodies, not blank spacer: ${JSON.stringify(painted)}`);
    assert.ok(smooth.some(sample => sample.top > smooth[0].top + 50 && sample.top < smooth.at(-1)!.top - 50), "smooth edge must retain intermediate positions");
    assert.ok(smooth.every(sample => sample.spacer < .05 && sample.mounted < 120));
    assert.deepEqual(errors, []);
    console.log(`PASS smooth edge: ${painted.length} painted frames, min body pixels=${Math.min(...painted)}`);
    await page.close();
  }
} finally {
  if (process.env.AXIOM_WINDOW_REPORT) writeFileSync(process.env.AXIOM_WINDOW_REPORT, JSON.stringify(reports, null, 2));
  await browser?.close(); await server.close(); rmSync(temporary, { recursive: true, force: true });
}
