import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
import { displayTypography } from "../scripts/display-typography.js";

const root = mkdtempSync(join(tmpdir(), "axiom-confirm-design-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/confirmation-design");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", css: { postcss: { plugins: [displayTypography()] } }, define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root, emptyOutDir: true, target: "es2022", minify: false, lib: { entry: resolve("tests/fixtures/confirmation-dialogs.tsx"), name: "ConfirmationFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), js = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(readFileSync(join(root, file)));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  const dialog = page.getByRole("dialog"), counts = page.getByTestId("counts");
  const open = async (kind: string) => { await page.locator(`[data-trigger=${kind}]`).click(); await dialog.waitFor(); };
  const cancel = () => dialog.getByRole("button", { name: "取消", exact: true });
  const bounds = async () => {
    const box = await dialog.boundingBox(), viewport = page.viewportSize()!;
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, "dialog fits viewport");
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "no horizontal overflow");
    const footer = await dialog.locator(".confirm-actions").boundingBox();
    assert.ok(footer && box && footer.y >= box.y && footer.y + footer.height <= box.y + box.height + 1, "footer stays inside dialog");
  };
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await open("delete"); await bounds();
      assert.equal(await dialog.evaluate(el => el.matches(":modal")), true);
      assert.equal(await cancel().evaluate(el => el === document.activeElement), true, "cancel is initially focused");
      const confirm = dialog.getByRole("button", { name: "删除草稿", exact: true });
      const cancelBox = (await cancel().boundingBox())!, confirmBox = (await confirm.boundingBox())!;
      assert.ok(cancelBox.x < confirmBox.x, "safe action precedes destructive action");
      assert.ok(await dialog.getAttribute("aria-describedby"));
      assert.match(await dialog.locator(".confirm-warning").innerText(), /移除前请核对模型名称与 ID/);
      assert.equal(await dialog.locator(".confirm-danger").evaluate(el => getComputedStyle(el).color), "rgb(255, 255, 255)");
      const [symbolColor, dangerColor] = await dialog.evaluate(el => { const sample = document.createElement("span"); sample.style.color = "var(--danger-text)"; el.append(sample); const expected = getComputedStyle(sample).color; sample.remove(); return [getComputedStyle(el.querySelector(".confirm-symbol")!).color, expected]; });
      assert.equal(symbolColor, dangerColor, "destructive title glyph uses the danger semantic color");
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).padding), "0px", "mobile styles do not reintroduce padding");
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).overflow), "hidden", "generic scrollable-dialog styles must not break rounded clipping");
      assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), "none", "reduced motion is respected");
      await page.screenshot({ path: join(artifacts, `delete-${theme}-${width}.png`) });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      assert.equal(await page.locator("[data-trigger=delete]").evaluate(el => el === document.activeElement), true);
    }
    await page.setViewportSize({ width: 390, height: 360 });
    await open("long"); await bounds();
    assert.equal(await dialog.getByRole("button", { name: "卸载资源" }).isDisabled(), true);
    const body = dialog.locator(".confirm-body");
    assert.equal(await body.evaluate(el => el.scrollHeight > el.clientHeight), true, "long body scrolls");
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; }); await bounds();
    await dialog.getByRole("checkbox").check();
    assert.equal(await dialog.getByRole("button", { name: "卸载资源" }).isEnabled(), true);
    await page.screenshot({ path: join(artifacts, `long-${theme}-390.png`) });
    await cancel().click(); await dialog.waitFor({ state: "detached" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await open("normal");
    assert.equal(await dialog.locator(".confirm-danger").count(), 0, "ordinary confirmations use the primary action");
    const [symbolColor, accentColor] = await dialog.evaluate(el => { const sample = document.createElement("span"); sample.style.color = "var(--accent)"; el.append(sample); const expected = getComputedStyle(sample).color; sample.remove(); return [getComputedStyle(el.querySelector(".confirm-symbol")!).color, expected]; });
    assert.equal(symbolColor, accentColor, "ordinary title glyph keeps the accent semantic color");
    await page.screenshot({ path: join(artifacts, `normal-${theme}.png`) });
    await page.mouse.click(5, 5); await dialog.waitFor({ state: "detached" });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => document.documentElement.style.setProperty("--display-font-scale", "1.35"));
  await open("delete"); await bounds();
  await page.screenshot({ path: join(artifacts, "scaled-light-320.png") }); await cancel().click();
  await page.evaluate(() => document.documentElement.style.removeProperty("--display-font-scale")); await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await counts.getAttribute("data-commits"), "0", "Escape, cancel and backdrop never confirm");
  await open("delete");
  await page.keyboard.press("Tab");
  assert.equal(await dialog.getByRole("button", { name: "删除草稿", exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await cancel().evaluate(el => el === document.activeElement), true);
  const start = (await dialog.locator(".confirm-description").boundingBox())!;
  await page.mouse.move(start.x + 10, start.y + 10); await page.mouse.down(); await page.mouse.move(5, 5); await page.mouse.up();
  assert.equal(await dialog.isVisible(), true, "dragging out from dialog content does not dismiss it");
  await cancel().click();
  await open("async");
  await dialog.getByRole("button", { name: "删除草稿", exact: true }).click();
  const pending = dialog.getByRole("button", { name: "处理中…", exact: true }); await pending.waitFor();
  await pending.dispatchEvent("click"); await cancel().dispatchEvent("click"); await page.keyboard.press("Escape"); await page.mouse.click(5, 5);
  assert.equal(await dialog.isVisible(), true, "pending action cannot be dismissed");
  assert.equal(await counts.getAttribute("data-attempts"), "1", "pending action deduplicates submissions");
  await page.evaluate(() => window.confirmationTest.reject!());
  await dialog.getByRole("alert").waitFor(); assert.match(await dialog.getByRole("alert").innerText(), /删除失败/);
  await page.screenshot({ path: join(artifacts, "failure-light.png") });
  await dialog.getByRole("button", { name: "删除草稿", exact: true }).click(); await pending.waitFor();
  await page.evaluate(() => window.confirmationTest.resolve!()); await dialog.waitFor({ state: "detached" });
  assert.equal(await counts.getAttribute("data-attempts"), "2"); assert.equal(await counts.getAttribute("data-commits"), "1");
  await open("secondary"); await dialog.getByRole("button", { name: "仅创建", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  assert.equal(await counts.getAttribute("data-secondary"), "1"); assert.equal(await counts.getAttribute("data-commits"), "1");
  await open("chain"); await dialog.getByRole("button", { name: "停止并继续", exact: true }).click();
  await page.getByRole("dialog", { name: "删除供应商？" }).waitFor();
  assert.equal(await cancel().evaluate(el => el === document.activeElement), true, "next confirmation resets safe focus");
  await dialog.getByRole("button", { name: "删除供应商", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  assert.equal(await counts.getAttribute("data-commits"), "2", "old close callback never clears a chained confirmation");
  assert.deepEqual(errors, []);
  console.log("PASS: unified confirmations in dark/light at 320/390/1440px, safe focus/Escape/backdrop, drag protection, long-body sticky actions, consent, reduced motion, pending deduplication, failure retry, secondary and chained confirmations");
} finally {
  await browser.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); rmSync(root, { recursive: true, force: true });
}
