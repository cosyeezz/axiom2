// Exercise the actual desktop React controller with a bounded, controllable IPC fixture.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/desktop-header");
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER, channel: process.env.AXIOM_TEST_BROWSER ? undefined : "msedge", headless: true });
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 48 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript({ content: "window.__name = (value) => value; (" + (() => {
    const state = { health: "connected", update: false, held: [] as ((value: string) => void)[] };
    (window as any).__headerFixture = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string) => {
      if (name === "axiom_connection") return state.health === "hang" ? new Promise<string>((resolve) => state.held.push(resolve)) : state.health;
      if (name === "axiom_service") return { desktopView: "workbench", state: "running", active: [], url: "http://127.0.0.1:4317/" };
      if (name === "axiom_update") return { clientVersion: "1.0.0", serviceVersion: "1.0.0", managed: true, clientSupported: true, release: state.update ? { version: "1.0.1", assets: {}, checkedAt: Date.now() } : null, job: null, recovery: false, log: "" };
      if (name === "axiom_controls") { window.dispatchEvent(new CustomEvent("axiom-desktop-view", { detail: "control" })); return; }
      throw Error("Unexpected IPC: " + name);
    } };
  }).toString() + ")()" });
  await page.clock.install();
  await page.goto(server.resolvedUrls!.local[0]);
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  const status = page.locator('.desktop-workbench-status');
  await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
  const colors = { connected: "rgb(104, 191, 124)", disconnected: "rgb(224, 138, 138)", checking: "rgb(152, 159, 169)" };
  for (const [health, color] of Object.entries(colors)) {
    await page.evaluate((value) => { (window as any).__headerFixture.health = value; }, health);
    await page.clock.runFor(1100);
    assert.equal(await status.getAttribute("data-state"), health);
    assert.deepEqual(await status.evaluate((element) => [getComputedStyle(element).color, getComputedStyle(element.querySelector("svg")!).color]), ["rgb(174, 182, 176)", color]);
    await page.locator('.desktop-workbench-bar').screenshot({ path: `${output}/${health}.png` });
  }
  await page.evaluate(() => { (window as any).__headerFixture.health = "connected"; });
  await page.clock.runFor(1100);
  await page.evaluate(() => { (window as any).__headerFixture.health = "hang"; });
  await page.clock.runFor(1100);
  assert.equal(await status.getAttribute("data-state"), "connected", "last fresh state is briefly retained while querying");
  await page.clock.runFor(2100);
  assert.equal(await status.getAttribute("data-state"), "checking", "hung IPC must not leave a permanent green indicator");
  await page.evaluate(() => { (window as any).__headerFixture.held.shift()?.("connected"); });
  assert.equal(await status.getAttribute("data-state"), "checking", "late timed-out IPC responses cannot restore green");
  await page.evaluate(() => { (window as any).__headerFixture.health = "connected"; (window as any).__headerFixture.update = true; });
  await page.clock.runFor(3500);
  assert.equal(await status.getAttribute("data-state"), "connected");
  assert.equal(await page.locator('.desktop-update-dot').isVisible(), true);
  const widths = [360, 390, 430, 600, 820, 1024, 1366, 1440, 1920];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 48 });
    assert.equal(await page.evaluate(() => {
      const status = document.querySelector('.desktop-workbench-status')!.getBoundingClientRect();
      const button = document.querySelector('.desktop-workbench-bar button')!.getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth && status.right + 5 <= button.left && button.right <= innerWidth;
    }), true, `header fits at ${width}px with an actual update marker`);
    if (width === 390) await page.screenshot({ path: `${output}/narrow.png` });
  }
  await page.getByRole("button", { name: "服务与更新，有待查看的变化" }).click();
  await page.locator('.connect-page').waitFor();
  assert.equal(await page.locator('.desktop-workbench-bar').isVisible(), false);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ success: true, scope: "actual React UI with fixture IPC; native IPC is checked separately", widths, colors, labelColor: "#aeb6b0", timeoutAndLateReply: true, errors }, null, 2));
  console.log("Desktop header: fixed text color, three icon colors, bounded IPC, late responses, updates and nine widths passed.");
} finally { await browser.close(); await server.close(); }
