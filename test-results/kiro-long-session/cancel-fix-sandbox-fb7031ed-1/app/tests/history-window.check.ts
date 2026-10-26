import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = mkdtempSync(join(tmpdir(), "axiom-window-check-"));
const server = await createServer({ root: resolve("."), configFile: false, server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage();
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/__window_fixture", route => route.fulfill({ contentType: "text/html", body: '<html><body style="background:#111;color:white"><div id="root"></div><script type="module" src="/tests/fixtures/history-window.tsx"></script></body></html>' }));
  await page.goto(`http://127.0.0.1:${address.port}/__window_fixture`);
  await page.getByText("Only visible message", { exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const emptyHeight = await page.locator(".thread").evaluate(n => n.scrollHeight);
  assert.ok(emptyHeight <= 401, `zero-height rows must not create black spacers: ${emptyHeight}`);
  await page.evaluate(() => (window as any).historyWindow.setMode("long"));
  await page.getByText("Message 0 — selection and scrolling regression", { exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.locator(".thread").evaluate(n => { n.scrollTop = 3200; }); await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const thread = document.querySelector(".thread")!;
    const row = [...document.querySelectorAll<HTMLElement>("[data-timeline-key]")].find(n => n.getBoundingClientRect().bottom > thread.getBoundingClientRect().top + 5)!;
    (window as any).savedRow = row;
    return { renders: (window as any).historyWindow.renders(), key: row.dataset.timelineKey, top: row.getBoundingClientRect().top, scroll: thread.scrollTop };
  });
  await page.locator("#prompt").pressSequentially("typing should not redraw history", { delay: 15 });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ renders: (window as any).historyWindow.renders(), top: (window as any).savedRow.getBoundingClientRect().top, connected: (window as any).savedRow.isConnected, scroll: document.querySelector(".thread")!.scrollTop }));
  assert.equal(after.renders, before.renders, "unrelated textarea selectionchange must not render timeline rows");
  assert.equal(after.connected, true); assert.ok(Math.abs(after.top - before.top) <= 1); assert.equal(after.scroll, before.scroll);
  const selected = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-timeline-key]")].filter(n => n.getBoundingClientRect().top >= 8).slice(0, 3);
    const range = document.createRange(); range.selectNodeContents(rows[2]); range.setStart(rows[0], 0);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    return rows.map(n => n.dataset.timelineKey);
  });
  await page.waitForTimeout(100);
  await page.locator(".thread").evaluate(n => { n.scrollTop += 3200; }); await page.waitForTimeout(200);
  for (const key of selected) assert.equal(await page.locator(`[data-timeline-key="${key}"]`).count(), 1);
  await page.evaluate(() => getSelection()!.removeAllRanges()); await page.locator("#prompt").focus(); await page.waitForTimeout(200);
  for (const key of selected) assert.equal(await page.locator(`[data-timeline-key="${key}"]`).count(), 0, "leaving a selection releases offscreen rows");
  const snapshot = () => page.evaluate(() => {
    const thread = document.querySelector<HTMLElement>('.thread')!, bounds = thread.getBoundingClientRect();
    const mounted = [...document.querySelectorAll<HTMLElement>('[data-timeline-key]')];
    const row = mounted.find(n => n.getBoundingClientRect().bottom > bounds.top + 5)!;
    const visibleSpacer = [...document.querySelectorAll('.timeline-spacer')].some(n => {
      const rect = n.getBoundingClientRect(); return Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top) > 1;
    });
    return { key: row.dataset.timelineKey, top: row.getBoundingClientRect().top - bounds.top, mounted: mounted.length, renders: (window as any).historyWindow.renders(), visibleSpacer };
  });
  const recovery = [];
  for (const [width, actualHeight] of [[700, 80], [420, 80], [700, 120]]) {
    if (actualHeight === 120) { await page.addStyleTag({ content: '.timeline-row > div { height: 120px !important; }' }); await page.waitForTimeout(250); }
    const saved = await snapshot();
    await page.locator('#root').evaluate(n => { n.style.display = 'none'; });
    await page.locator('.thread').evaluate((n, value) => { n.style.width = `${value}px`; }, width);
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(() => ({ mounted: document.querySelectorAll('[data-timeline-key]').length, renders: (window as any).historyWindow.renders() }));
    assert.equal(hidden.mounted, saved.mounted, 'hidden zero-height observations must not mount the full history');
    assert.equal(hidden.renders, saved.renders, 'hidden panes do not rewrite row measurements');
    await page.locator('#root').evaluate(n => { n.style.display = ''; }); await page.waitForTimeout(350);
    const restored = await snapshot();
    assert.equal(restored.key, saved.key); assert.ok(Math.abs(restored.top - saved.top) <= 1, 'restoring a pane preserves the logical anchor');
    assert.equal(restored.visibleSpacer, false); assert.ok(restored.mounted < 40);
    recovery.push({ width, actualHeight, hiddenMounted: hidden.mounted, restoredMounted: restored.mounted, anchorDrift: restored.top - saved.top });
  }
  assert.deepEqual(errors, []);
  const report = { emptyHeight, typingRowRenders: after.renders - before.renders, anchorDrift: after.top - before.top, selectionRows: selected.length, recovery };
  console.log("PASS history-window", JSON.stringify(report));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: join(root, "failure.png") }); writeFileSync(join(root, "failure.html"), await page.content()); }
  console.error(`Artifacts: ${root}`); throw error;
} finally {
  await browser?.close(); await server.close();
  if (process.env.AXIOM_HISTORY_KEEP_ROOT !== "1") rmSync(root, { recursive: true, force: true });
}
