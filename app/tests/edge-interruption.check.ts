// Gesture takeover must hand off the controlled position before a late RO.
// No backend/model calls; ordered RO and native wheel are separate assertions.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const temporary = mkdtempSync(join(tmpdir(), "axiom-edge-interruption-"));
const server = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "vite"),
  server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const probe = window as any;
    probe.__name = (value: unknown) => value;
    probe.interruptionTrace = [];
    document.addEventListener("scroll", event => {
      if ((event.target as Element)?.classList?.contains("thread")) probe.interruptionTrace.push({ kind: "scroll" });
    }, true);
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
    Object.defineProperty(Element.prototype, "scrollTop", { ...descriptor, set(value: number) {
      if ((this as Element).classList.contains("thread")) probe.interruptionTrace.push({ kind: "set", value });
      descriptor.set!.call(this, value);
    } });
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          probe.interruptionTrace.push({ kind: "RO" });
          callback(entries, observer);
        });
      }
    };
  });
  await page.route("**/__edge_interruption", route => route.fulfill({ contentType: "text/html",
    body: '<div id="root"></div><script type="module" src="/tests/fixtures/edge-interruption.tsx"></script>' }));
  for (const mode of ["ordered", "native"] as const) for (let repeat = 0; repeat < (mode === "ordered" ? 5 : 1); repeat++) for (const start of [0, 205]) {
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__edge_interruption`);
    await page.waitForFunction(() => !!(window as any).edgeProbe);
    await page.locator(".thread").evaluate((node, start) => { node.scrollTop = start; node.dispatchEvent(new Event("scroll")); }, start);
    await page.waitForTimeout(120);
    await page.getByRole("button", { name: "Bottom", exact: true }).click();
    await page.waitForFunction(start => (window as any).edgeProbe.snapshot().top > start + 200, start);
    let before: number;
    if (mode === "ordered") {
      // Evaluating between frames lets scroll happen before RO and hides the
      // defect. Run after this frame's edge rAF write, before its scroll event.
      before = await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => {
        const probe = window as any;
        probe.interruptionTrace = [];
        probe.controlledAtInterrupt = probe.edgeProbe.snapshot().active;
        resolve(probe.edgeProbe.interruptAndGrow());
      })));
    } else {
      const bounds = (await page.locator(".thread").boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.evaluate(() => {
        const probe = window as any, node = document.querySelector(".thread")!;
        probe.interruptionTrace = [];
        node.addEventListener("wheel", () => {
          probe.nativeBefore = probe.edgeProbe.snapshot().top;
          probe.controlledAtInterrupt = probe.edgeProbe.snapshot().active;
          probe.edgeProbe.growBelowViewport();
        }, { once: true });
      });
      await page.mouse.wheel(0, -80);
      await page.waitForFunction(() => (window as any).nativeBefore !== undefined);
      before = await page.evaluate(() => (window as any).nativeBefore);
    }
    await page.waitForTimeout(200);
    const result: { after: { top: number; active: boolean }; controlled: boolean; trace: { kind: string; value?: number }[] } = await page.evaluate(() => ({
      after: (window as any).edgeProbe.snapshot(), controlled: (window as any).controlledAtInterrupt, trace: (window as any).interruptionTrace,
    }));
    assert.ok(result.controlled, "the gesture must interrupt an active edge, not an already settled viewport");
    if (mode === "ordered") {
      const ro = result.trace.findIndex(event => event.kind === "RO"), scroll = result.trace.findIndex(event => event.kind === "scroll");
      assert.ok(ro >= 0 && (scroll < 0 || ro < scroll), `the regression requires real RO before native scroll: ${JSON.stringify(result.trace)}`);
    }
    const limit = before - (mode === "native" ? 81 : 1);
    const restores = result.trace.filter(event => event.kind === "set").map(event => event.value!);
    assert.ok(result.after.top >= limit && restores.every(top => top >= limit), `upward gesture + RO must not restore the old ${start} anchor: ${JSON.stringify({ mode, before, ...result, restores })}`);
    assert.equal(result.after.active, false);
    console.log(`PASS ${mode} edge interruption ${repeat + 1} from ${start}: gesture=${before}, afterRO=${result.after.top}, writes=${JSON.stringify(restores)}`);
  }
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server.close(); rmSync(temporary, { recursive: true, force: true }); }
