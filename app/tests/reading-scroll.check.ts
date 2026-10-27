// Deterministic gesture/layout races plus native wheel scrolling. No model/backend calls.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ root: resolve("."), configFile: false,
  server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name = value => value;");
  await page.addInitScript(() => {
    // Hold only row measurements to exercise new DOM rows before their estimates
    // are corrected. Viewport observers still run normally.
    const control = (window as any).readingMeasurements = { hold: false, pending: [] as (() => void)[],
      flush() { this.hold = false; for (const run of this.pending.splice(0)) run(); } };
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const run = () => callback(entries, observer);
          if (control.hold && entries.some(entry => (entry.target as HTMLElement).dataset.timelineKey)) control.pending.push(run);
          else run();
        });
      }
    };
  });
  await page.route("**/__reading_fixture", route => route.fulfill({ contentType: "text/html",
    body: '<html><body><div id="root"></div><script type="module" src="/tests/fixtures/reading-scroll.tsx"></script></body></html>' }));
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__reading_fixture`);
  await page.getByText("Reading row 0", { exact: true }).waitFor();
  const thread = page.locator(".thread");
  const snapshot = () => page.evaluate(() => (window as any).readingScroll.snapshot());
  const cases = [
    { location: "below", height: 240, delta: 120, gesture: "wheel" },
    { location: "above", height: 240, delta: 160, gesture: "wheel" },
    { location: "above", height: 40, delta: -120, gesture: "wheel" },
    { location: "inside", height: 160, delta: 120, gesture: "touch" },
    { location: "below", height: 40, delta: -120, gesture: "touch" },
    { location: "above", height: 200, delta: 160, gesture: "keyboard" },
    { location: "below", height: 200, delta: -120, gesture: "keyboard" },
    { location: "below", height: 160, delta: 120, gesture: "scrollbar" },
  ];
  for (const test of cases) {
    await thread.evaluate(node => { node.scrollTop = 4000; });
    await page.waitForTimeout(120);
    const expected = await thread.evaluate((node, test) => {
      const rows = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")], bounds = node.getBoundingClientRect();
      const resized = test.location === "above" ? rows[0] : test.location === "below" ? rows.at(-1)!
        : rows.find(row => row.getBoundingClientRect().top >= bounds.top)!;
      (window as any).readingScroll.resize(Number(resized.dataset.timelineKey!.slice(4)), test.height);
      if (test.gesture === "wheel") node.dispatchEvent(new WheelEvent("wheel", { deltaY: test.delta, bubbles: true }));
      if (test.gesture === "touch") node.dispatchEvent(new Event("touchmove", { bubbles: true }));
      if (test.gesture === "keyboard") node.dispatchEvent(new KeyboardEvent("keydown", { key: test.delta > 0 ? "PageDown" : "PageUp", bubbles: true }));
      if (test.gesture === "scrollbar") node.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 1, clientX: bounds.right - 2, bubbles: true }));
      node.scrollTop += test.delta;
      // Force scroll-before-RO ordering without relying on machine timing.
      node.dispatchEvent(new Event("scroll"));
      return (window as any).readingScroll.snapshot();
    }, test);
    await page.waitForTimeout(120);
    const actual = await snapshot();
    assert.equal(actual.key, expected.key, `${JSON.stringify(test)}: new reading row wins over stale anchor`);
    assert.ok(Math.abs(actual.offset - expected.offset) <= 1, `${JSON.stringify(test)}: reading offset drift ${actual.offset - expected.offset}`);
    assert.equal(actual.visibleSpacer, false); assert.ok(actual.mounted < 45);
    await thread.dispatchEvent("pointerup", { pointerId: 1, bubbles: true });
  }
  // The reverse ordering also occurs: native scrollTop changes, then a pending
  // row measurement is delivered before the scroll event records that movement.
  for (const [location, height, delta] of [["below", 320, 120], ["above", 180, -120]] as const) {
    await thread.evaluate((node, { location, height }) => {
      const control = (window as any).readingMeasurements;
      control.hold = true;
      const rows = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")];
      const resized = location === "above" ? rows[0] : rows.at(-1)!;
      (window as any).readingScroll.resize(Number(resized.dataset.timelineKey!.slice(4)), height);
    }, { location, height });
    await page.waitForFunction(() => (window as any).readingMeasurements.pending.length > 0);
    const expected = await thread.evaluate((node, delta) => {
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
      node.scrollTop += delta;
      const expected = (window as any).readingScroll.snapshot();
      (window as any).readingMeasurements.flush();
      return expected;
    }, delta);
    await page.waitForTimeout(120);
    const actual = await snapshot();
    assert.equal(actual.key, expected.key, `RO-before-scroll ${location}: preserves the new row`);
    assert.ok(Math.abs(actual.offset - expected.offset) <= 1, `RO-before-scroll ${location}: preserves the new offset`);
  }

  // Retain the existing protection against layout-only clamps: without a new
  // gesture, a pending size change must not replace the saved reading anchor.
  const beforeLayout = await snapshot();
  await thread.evaluate(node => {
    const last = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")].at(-1)!;
    (window as any).readingScroll.resize(Number(last.dataset.timelineKey!.slice(4)), 360);
    node.scrollTop -= 120; node.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(120);
  const afterLayout = await snapshot();
  assert.equal(afterLayout.key, beforeLayout.key, "layout-only clamp retains the prior row");
  assert.ok(Math.abs(afterLayout.offset - beforeLayout.offset) <= 1, "layout-only clamp retains the prior offset");

  // Newly mounted variable-height rows must use DOM, not estimated offsets, when
  // a second gesture arrives before their first measurement.
  await page.evaluate(() => { (window as any).readingMeasurements.hold = true; (window as any).readingScroll.vary(); });
  await thread.evaluate(node => { node.scrollTop = 10000; });
  await page.waitForTimeout(100);
  const unmeasured = await thread.evaluate(node => {
    node.dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true }));
    node.scrollTop += 240; node.dispatchEvent(new Event("scroll"));
    return (window as any).readingScroll.snapshot();
  });
  await page.evaluate(() => (window as any).readingMeasurements.flush());
  await page.waitForTimeout(200);
  const measured = await snapshot();
  assert.equal(measured.key, unmeasured.key, "measuring new rows preserves the DOM reading row");
  assert.ok(Math.abs(measured.offset - unmeasured.offset) <= 1, "measuring new rows preserves the DOM reading offset");
  assert.equal(measured.visibleSpacer, false); assert.ok(measured.mounted < 45);

  // Native browser wheel input must also remain responsive across window recycling.
  const bounds = (await thread.boundingBox())!;
  await page.mouse.move(bounds.x + 300, bounds.y + 200);
  for (const delta of [120, 240, 120, -120, -240, -120]) {
    const before = await thread.evaluate(node => node.scrollTop);
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(({ before, delta }) => {
      const node = document.querySelector(".thread")!;
      return delta > 0 ? node.scrollTop > before + 50 : node.scrollTop < before - 50;
    }, { before, delta });
    await page.waitForTimeout(100);
    const state = await snapshot();
    assert.equal(state.visibleSpacer, false); assert.ok(state.mounted < 45);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS reading-scroll: ${cases.length} scroll-before-RO and 2 RO-before-scroll races, layout clamp, unmeasured DOM rows, native wheel; errors=[]`);
} finally {
  await browser?.close(); await server.close();
}
