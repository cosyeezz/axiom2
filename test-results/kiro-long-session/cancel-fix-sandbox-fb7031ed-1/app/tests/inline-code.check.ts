// Run: AXIOM_TEST_BROWSER=/path/to/chrome ./node_modules/.bin/tsx tests/inline-code.check.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";

const root = await mkdtemp(join(tmpdir(), "axiom-inline-code-"));
const appRoot = resolve("."), artifacts = resolve(process.env.AXIOM_INLINE_CODE_ARTIFACTS || "test-results/inline-code");
await mkdir(artifacts, { recursive: true });
await writeFile(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/inline-code.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [];
async function checkLayout(page: Page, label: string) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits ${label}`);
  const failures = await page.locator(".inline-code").evaluateAll(elements => elements.flatMap(element => {
    const code = element.querySelector("code")!, button = element.querySelector("button")!;
    const range = document.createRange(); range.selectNodeContents(element.querySelector(".inline-code-tail")!.firstChild!);
    const last = range.getBoundingClientRect(), target = button.getBoundingClientRect();
    const bounds = element.closest("td,section")!.getBoundingClientRect();
    const gap = getComputedStyle(button).direction === "rtl" ? last.left - target.right : target.left - last.right;
    return gap < 1 || gap > 3 || target.top >= last.bottom || target.bottom <= last.top || target.right > bounds.right + 1 || target.left < bounds.left - 1
      ? [{ text: code.textContent, last: last.toJSON(), target: target.toJSON(), bounds: bounds.toJSON() }] : [];
  }));
  assert.deepEqual(failures, [], `buttons follow the final code fragment without overlap at ${label}`);
}
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.resolvedUrls!.local[0]);
  const first = page.locator("#table .inline-code").first(), button = first.getByRole("button");
  await button.waitFor();
  assert.equal(await page.locator("#table .inline-code").count(), 3);
  assert.equal(await page.locator("#compact button, #compact a, #nested a button, #nested button button").count(), 0);
  assert.equal(await page.locator("#nested .path-actions").count(), 1, "paths retain their existing actions without a duplicate copy button");
  const before = await page.locator("main").textContent();
  const geometry = await page.locator("#table").boundingBox();
  await page.keyboard.press("Tab");
  assert.ok(await button.evaluate(element => element.matches(":focus-visible")));
  await page.getByRole("tooltip").filter({ hasText: "复制代码" }).waitFor();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#table .inline-code")?.getAttribute("data-copy-state") === "copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "hffp@qhhfdb.com");
  assert.equal(await page.locator("main").textContent(), before, "feedback does not become source text or move annotations");
  assert.deepEqual(await page.locator("#table").boundingBox(), geometry, "focus and feedback do not reflow table");
  assert.equal(await page.locator("#events").textContent(), "0", "copy does not activate its containing row");
  await page.waitForFunction(() => !document.querySelector("#table .inline-code")?.hasAttribute("data-copy-state"));
  await button.hover();
  assert.deepEqual(await page.locator("#table").boundingBox(), geometry);

  for (const code of await page.locator("#table .inline-code, #prose .inline-code, #unicode .inline-code").all()) {
    const value = await code.locator("code").textContent();
    await code.getByRole("button").click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), value, "copies only exact code text, including spaces and symbols");
  }
  const selection = await page.locator("#prose p").evaluate(element => {
    const root = element as HTMLElement, text = root.textContent!, start = text.indexOf("后续文字");
    const fixture = (window as any).inlineFixture;
    const range = fixture.textRange(root, start, text.length) as Range;
    const selected = getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    return { quote: selected.toString(), offsets: fixture.rangeOffsets(root, range), start, end: text.length };
  });
  assert.deepEqual(selection, { quote: "后续文字保持准确。", offsets: [selection.start, selection.end], start: selection.start, end: selection.end });
  await page.evaluate(() => getSelection()?.removeAllRanges());

  await page.evaluate(() => {
    (window as any).restoreClipboard = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async () => { throw Error("denied"); };
  });
  await button.click();
  await page.waitForFunction(() => document.querySelector("#table .inline-code")?.getAttribute("data-copy-state") === "failed");
  assert.equal(await button.getAttribute("aria-label"), "复制失败，点击重试");
  assert.equal(await page.locator("main").textContent(), before);
  await page.evaluate(() => { navigator.clipboard.writeText = (window as any).restoreClipboard; });
  await button.press("Space");
  await page.waitForFunction(() => document.querySelector("#table .inline-code")?.getAttribute("data-copy-state") === "copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "hffp@qhhfdb.com");

  await page.evaluate(() => {
    (window as any).copyCalls = 0;
    navigator.clipboard.writeText = () => { (window as any).copyCalls++; return new Promise<void>(resolve => { (window as any).finishCopy = resolve; }); };
  });
  const stream = page.locator("#stream .inline-code");
  await stream.getByRole("button").click();
  await stream.getByRole("button").evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  assert.equal(await page.evaluate(() => (window as any).copyCalls), 1, "pending writes cannot be duplicated");
  await page.evaluate(() => (window as any).inlineFixture.setSource("streaming-new"));
  await page.waitForFunction(() => document.querySelector("#stream code")?.textContent === "streaming-new");
  await page.evaluate(async () => { (window as any).finishCopy(); await new Promise(requestAnimationFrame); });
  assert.equal(await stream.getAttribute("data-copy-state"), null, "old result cannot mark a new value as copied");
  await stream.getByRole("button").click();
  await page.evaluate(() => (window as any).inlineFixture.setShown(false));
  await page.waitForFunction(() => !document.querySelector("#stream code"));
  await page.evaluate(async () => { (window as any).finishCopy(); await new Promise(requestAnimationFrame); navigator.clipboard.writeText = (window as any).restoreClipboard; });
  await page.evaluate(() => (window as any).inlineFixture.setShown(true));
  await stream.waitFor();
  await page.locator("#block").getByRole("button", { name: "复制代码" }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), "first line\nsecond line");

  for (const direction of ["ltr", "rtl"]) {
    for (const width of [108, 155, 170]) {
      await page.locator("#wrapping").evaluate((element, { direction, width }) => {
        (element as HTMLElement).style.direction = direction; (element as HTMLElement).style.maxWidth = `${width}px`;
      }, { direction, width });
      await checkLayout(page, `narrow-${direction}-${width}`);
    }
  }
  await page.locator("#wrapping").evaluate(element => { (element as HTMLElement).style.direction = "ltr"; });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => (window as any).inlineFixture.setTheme(theme), theme);
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await checkLayout(page, `${theme}-${width}`);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`), fullPage: true });
    }
  }
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
  touch.on("pageerror", error => errors.push(error.message));
  await touch.goto(server.resolvedUrls!.local[0]);
  const touchButton = touch.locator("#table .inline-code button").first();
  await touchButton.waitFor();
  const target = (await touchButton.boundingBox())!;
  assert.ok(target.width >= 24 && target.height >= 24 && target.width < 30, "compact touch target");
  await checkLayout(touch, "touch-390");
  await touchButton.tap();
  assert.equal(await touch.evaluate(() => navigator.clipboard.readText()), "hffp@qhhfdb.com");
  await touch.screenshot({ path: join(artifacts, "touch-390.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`PASS: table/body exact copy, keyboard and touch, no layout shift, failure/retry, pending guard, stale/unmounted results, annotation offsets, nested controls, block copy, 4 widths and 2 themes. Artifacts: ${artifacts}`);
} finally { await browser.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
