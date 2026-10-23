// Run from app: TMPDIR=/private/tmp AXIOM_TEST_BROWSER=/path/to/chrome node --import tsx tests/latency.check.ts
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { LatencyRecord } from "../src/shared/latency.js";

const root = await mkdtemp(join(tmpdir(), "axiom-latency-browser-")), appRoot = resolve(".");
await writeFile(join(root, "index.html"), `<!doctype html><html><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/latency.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen(); browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.resolvedUrls!.local[0]);
  await page.waitForFunction(() => !!(window as any).latencyFixture);
  const push = (id: string, seq: number) => page.evaluate(({ id, seq }) => (window as any).latencyFixture.push(id, seq), { id, seq });
  const records = () => page.evaluate<LatencyRecord[]>(() => (window as any).latencyFixture.records());
  await push("visible", 1);
  await page.locator("#visible").getByText("Visible visible 1", { exact: true }).waitFor();
  let trace = await records();
  assert.deepEqual(trace.map(r => r.stage), ["browser.receive", "browser.commit"]);
  assert.ok(trace[1].durationMs! >= 0);
  await push("visible", 1); await push("visible", 0);
  assert.equal((await records()).length, 2, "duplicate/stale snapshots must not create delivery records");
  await push("visible", 2);
  await page.locator("#visible").getByText("Visible visible 2", { exact: true }).waitFor();
  assert.equal((await records()).filter(r => r.stage === "browser.commit").length, 2);
  await push("folded", 3);
  assert.equal(await page.locator("#folded").innerText(), "");
  trace = await records();
  assert.deepEqual(trace.filter(r => r.seq === 3).map(r => r.stage), ["browser.receive"]);
  await page.evaluate(() => (window as any).latencyFixture.setOpen(true));
  await page.locator("#folded").getByText("Visible folded 3", { exact: true }).waitFor();
  assert.deepEqual((await records()).filter(r => r.seq === 3).map(r => r.stage), ["browser.receive", "browser.commit"]);
  await page.evaluate(() => (window as any).latencyFixture.setOpen(false));
  await page.evaluate(() => (window as any).latencyFixture.setOpen(true));
  assert.equal((await records()).filter(r => r.seq === 3 && r.stage === "browser.commit").length, 1);
  assert.deepEqual(errors, []);
  console.log("PASS: accepted snapshots reach real Message DOM commits; stale/duplicate rejection; folded content waits for expansion; no repeated commit on reopen.");
} finally { await browser?.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
