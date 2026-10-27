// WebKit (macOS WKWebView engine) clamps scrollTop to transiently short content
// while React swaps the virtual window's rows/spacers. Chrome does not, so this
// check must run in WebKit. No backend/model calls.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright";
import { createServer } from "vite";

const temporary = mkdtempSync(join(tmpdir(), "axiom-webkit-window-"));
const server = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "vite"),
  server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" } });
let browser: Awaited<ReturnType<typeof webkit.launch>> | undefined;
try {
  await server.listen();
  browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  const address = server.httpServer!.address() as { port: number };
  await page.route("**/__webkit_window*", route => route.fulfill({ contentType: "text/html",
    body: '<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/fixtures/webkit-window.tsx"></script></body></html>' }));
  await page.goto(`http://127.0.0.1:${address.port}/__webkit_window${process.env.AXIOM_WINDOW_NATIVE ? "?native=1" : ""}`);
  await page.getByText("Content 0", { exact: true }).waitFor({ timeout: 15000 });
  const settle = async () => {
    await page.waitForFunction(() => !(window as any).windowProbe.snapshot().active, undefined, { timeout: 5000 });
    return page.evaluate(() => (window as any).windowProbe.snapshot());
  };
  const results = [];
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => (window as any).windowProbe.edge("bottom"));
    const bottom = await settle();
    assert.ok(bottom.max > 4000, `fixture must be tall after measurement: ${JSON.stringify(bottom)}`);
    assert.ok(Math.abs(bottom.max - bottom.top) <= 1, `bottom edge must reach the real end, round ${round}: ${JSON.stringify(bottom)}`);
    await page.evaluate(() => (window as any).windowProbe.edge("top"));
    const top = await settle();
    assert.equal(Math.round(top.top), 0, `top edge round ${round}: ${JSON.stringify(top)}`);
    results.push({ bottom: Math.round(bottom.top), max: Math.round(bottom.max) });
  }
  // A finished delivery reveal must release the viewport. A reveal that never
  // settles keeps rewriting scrollTop each frame and reverts any later scroll.
  await page.evaluate(() => (window as any).windowProbe.edge("bottom")); await settle();
  assert.equal(await page.evaluate(() => (window as any).windowProbe.step("up")), true, "a delivery above the bottom");
  await page.waitForTimeout(1500);
  const revealed = await page.evaluate(() => {
    const node = document.querySelector(".thread")!, marks = [...node.querySelectorAll("[data-delivery-start]")];
    return marks.map(mark => mark.getBoundingClientRect().top - node.getBoundingClientRect().top).find(top => top > 0 && top < 100);
  });
  assert.ok(revealed !== undefined && Math.abs(revealed - 24) <= 1, `delivery must sit on the reading line: ${revealed}`);
  const jump = await page.evaluate(() => (window as any).windowProbe.jump()) as number[];
  const max = (await page.evaluate(() => (window as any).windowProbe.snapshot())).max;
  assert.ok(jump.every(top => Math.abs(top - max) <= 1), `settled reveal must not pull a later scroll back: ${JSON.stringify(jump)} max=${max}`);
  results.push({ revealed: Math.round(revealed * 10) / 10, jump: jump.map(Math.round) });
  // Home/End from the middle of a long, under-estimated history must reach the
  // real edges. WebKit's native animation is cancelled by anchor corrections.
  const keys = [];
  for (const [key, edge] of [["Home", "top"], ["End", "bottom"], ["Home", "top"]] as const) {
    await page.evaluate(() => { const node = document.querySelector<HTMLElement>(".thread")!; node.focus({ preventScroll: true }); });
    await page.mouse.move(350, 300);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, edge === "top" ? -700 : 700); await page.waitForTimeout(60); }
    await page.waitForTimeout(400);
    await page.keyboard.press(key);
    await page.waitForTimeout(1800);
    const at = await page.evaluate(() => (window as any).windowProbe.snapshot());
    keys.push({ key, top: Math.round(at.top), max: Math.round(at.max) });
    assert.ok(edge === "top" ? at.top <= 1 : Math.abs(at.max - at.top) <= 1, `${key} must reach the ${edge} edge: ${JSON.stringify(at)}`);
  }
  results.push({ keys });
  assert.deepEqual(errors, []);
  console.log("PASS webkit-window", JSON.stringify(results));
} finally {
  await browser?.close(); await server.close(); rmSync(temporary, { recursive: true, force: true });
}
