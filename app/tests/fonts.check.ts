// Isolated browser regression: no backend, production data, or live font requests.
// Inter fixture: @fontsource/inter@5.2.5, SIL OFL 1.1 (fixtures/fonts/OFL.txt).
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium, type Page } from "playwright";
import { displayTypography } from "../scripts/display-typography.js";
import { formatFontCatalog } from "../src/client/format-font-catalog.js";

const root = mkdtempSync(join(tmpdir(), "axiom-fonts-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/fonts");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' },
  css: { postcss: { plugins: [displayTypography()] } },
  build: { outDir: root, emptyOutDir: true, target: "safari15", minify: false, lib: { entry: resolve("tests/fixtures/fonts.tsx"), name: "FontFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), script = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${script}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  res.end(readFileSync(join(root, file)));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const bytes = readFileSync(resolve("tests/fixtures/fonts/inter-latin.woff2"));
const errors: string[] = [];
const choice = (page: Page) => page.getByRole("combobox", { name: "字体", exact: true });
const selected = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("axiom.display.v1") ?? "{}").fontFamily ?? "default");
const waitReady = (page: Page) => page.waitForFunction(() => !(document.querySelector('input[type=file]') as HTMLInputElement)?.disabled);
const records = (page: Page) => page.evaluate(() => new Promise<number>((resolve, reject) => {
  const request = indexedDB.open("axiom.fonts.v1", 1);
  request.onsuccess = () => { const db = request.result; const count = db.transaction("fonts").objectStore("fonts").count(); count.onsuccess = () => { resolve(count.result); db.close(); }; count.onerror = reject; };
  request.onerror = reject;
}));
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  let requests = 0, mode: "ok" | "http" | "corrupt" | "offline" | "pending" | "oversized" | "missing" = "ok";
  const names = new Set(formatFontCatalog(JSON.parse(readFileSync("src/client/font-catalog.json", "utf8"))).map(font => font.name));
  const previewTexts: string[] = [];
  await context.route(/https:\/\/(cdn\.jsdelivr\.net|raw\.githubusercontent\.com)\//, async route => {
    requests++;
    if (mode === "pending") return;
    if (mode === "offline") return route.abort("internetdisconnected");
    await route.fulfill({ status: mode === "http" ? 503 : 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: mode === "corrupt" ? Buffer.from("not a font") : bytes });
  });
  let labelRequests = 0;
  await context.route('https://fonts.googleapis.com/**', route => {
    const text = new URL(route.request().url()).searchParams.get("text")!;
    assert.ok(text, "every preview request must restrict glyphs via text");
    const label = names.has(text);
    if (!label) {
      previewTexts.push(text);
      if (mode === "pending") return;
      if (mode === "offline") return route.abort("internetdisconnected");
    }
    return route.fulfill({ status: !label && mode === "http" ? 503 : 200, contentType: 'text/css', body: !label && mode === "missing" ? "/* unavailable */" : `@font-face { src: url(https://fonts.gstatic.com/axiom-${label ? "name" : "preview"}.woff2); }` });
  });
  await context.route('https://fonts.gstatic.com/**', route => {
    const label = route.request().url().includes("axiom-name");
    if (label) labelRequests++;
    return route.fulfill({ contentType: 'font/woff2', body: !label && mode === "corrupt" ? Buffer.from("not a font") : !label && mode === "oversized" ? Buffer.alloc(512 * 1024 + 1) : bytes });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url); await waitReady(page);
  assert.equal(requests, 0, "opening display does not download fonts");
  await page.screenshot({ path: join(artifacts, "default-dark-1200.png"), fullPage: true });
  const open = () => page.getByRole("button", { name: "浏览字体库", exact: true }).click();
  const close = () => page.getByRole("button", { name: "关闭字体库", exact: true }).click();
  const row = (name: string) => page.locator(".font-row").filter({ has: page.getByText(name, { exact: true }) });
  const choose = async (name: string) => {
    if (await page.getByRole("button", { name: "← 返回字体列表", exact: true }).isVisible()) await page.getByRole("button", { name: "← 返回字体列表", exact: true }).click();
    await page.getByRole("button", { name: "全部字体", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜索字体" }).fill(name);
    await row(name).click();
  };
  const previewReady = () => page.waitForFunction(() => {
    const specimen = document.querySelector<HTMLTextAreaElement>(".font-specimen");
    return specimen?.getAttribute("aria-busy") === "false" && getComputedStyle(specimen).fontFamily.includes("Axiom");
  });
  const download = () => page.getByRole("button", { name: /^下载字体/ }).click();
  const upload = async (name: string, buffer: Buffer) => page.locator('input[type=file]').setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  await upload("invalid.txt", bytes); await page.getByRole("alert").filter({ hasText: "请选择" }).waitFor();
  await upload("empty.woff2", Buffer.alloc(0)); await page.getByRole("alert").filter({ hasText: "大于 0" }).waitFor();
  await upload("corrupt.woff2", Buffer.from("wOF2invalid")); await page.getByRole("alert").filter({ hasText: "无法读取此字体" }).waitFor();
  assert.equal(await records(page), 0);
  await upload("本地测试字体.woff2", bytes); await page.getByRole("status").filter({ hasText: "已导入" }).waitFor();
  assert.equal(await records(page), 1); assert.equal(await selected(page), "default");
  assert.match(await page.locator(".font-specimen").evaluate(el => getComputedStyle(el).fontFamily), /AxiomFont/);
  await page.locator("#font-preview-text").fill("自定义预览 Abc 123");
  assert.equal(await page.locator("#font-preview-text").inputValue(), "自定义预览 Abc 123");
  await page.getByRole("button", { name: "使用字体", exact: true }).click();
  const localId = await selected(page); assert.match(localId, /^custom:/);
  await close(); await page.reload(); await waitReady(page);
  assert.equal(await selected(page), localId); assert.equal(await choice(page).innerText(), "本地测试字体");
  assert.ok(await page.evaluate(() => [...document.fonts].some(face => face.family.startsWith("AxiomFont-") && face.status === "loaded")));
  const sibling = await context.newPage(); await sibling.goto(url); await waitReady(sibling);
  await open(); await page.getByRole("button", { name: "已添加 (1)", exact: true }).click();
  await row("本地测试字体").click(); await waitReady(page);
  await page.getByRole("button", { name: "移除 本地测试字体", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已移除" }).waitFor();
  await sibling.waitForFunction(() => JSON.parse(localStorage.getItem("axiom.display.v1")!).fontFamily === "default");
  assert.equal(await selected(page), "default"); assert.equal(await records(page), 0);

  await page.getByRole("button", { name: "全部字体", exact: true }).click();
  const count = Number((await page.locator(".font-result-count").innerText()).split(" ")[0].replaceAll(",", ""));
  assert.ok(count > 1000, "catalog contains a broad font collection");
  assert.equal(await page.locator(".font-row").count(), 60, "large catalog is paginated");
  await page.getByRole("button", { name: /^显示更多/ }).click();
  assert.equal(await page.locator(".font-row").count(), 120);
  await page.getByRole("searchbox", { name: "搜索字体" }).fill("不存在的字体abcxyz");
  assert.equal(await page.locator(".font-row").count(), 0);
  await page.getByRole("button", { name: "查看全部字体", exact: true }).click();
  await page.getByRole("combobox", { name: "字体语言", exact: true }).click();
  await page.getByRole("option", { name: "中文", exact: true }).click();
  assert.ok(await page.locator(".font-row").count() >= 10, "Chinese filter offers multiple families");
  await page.screenshot({ path: join(artifacts, "chinese-catalog.png"), fullPage: true });
  await page.getByRole("combobox", { name: "字体风格", exact: true }).click();
  await page.getByRole("option", { name: "手写", exact: true }).click();
  assert.ok(await page.locator(".font-row").count() > 0);
  assert.equal(requests, 0, "browsing, searching and filtering load no complete fonts");
  await page.locator('.font-row[data-specimen=true]').first().waitFor();
  assert.ok(labelRequests > 0, "visible names have lightweight real-font specimens");
  await page.getByRole("combobox", { name: "字体语言", exact: true }).click();
  await page.getByRole("option", { name: "所有语言", exact: true }).click();
  await page.getByRole("combobox", { name: "字体风格", exact: true }).click();
  await page.getByRole("option", { name: "所有风格", exact: true }).click();
  await choose("Inter"); await previewReady();
  assert.equal(await selected(page), "default"); assert.equal(await records(page), 0); assert.equal(requests, 0, "detail preview never downloads the full font");
  assert.match(await page.locator(".font-specimen").evaluate(el => getComputedStyle(el).fontFamily), /AxiomPreview-inter/);
  const initialRequests = previewTexts.length;
  await page.locator("#font-preview-text").fill("子集试阅 Abc 123 😀😀"); await previewReady();
  assert.equal(previewTexts.length, initialRequests + 1);
  assert.equal(previewTexts.at(-1), [...new Set("子集试阅 Abc 123 😀😀")].sort().join(""));
  assert.equal(requests, 0);
  await page.locator("#font-preview-text").dispatchEvent("compositionstart");
  await page.locator("#font-preview-text").fill("输入法组字中");
  await page.waitForTimeout(400);
  assert.equal(previewTexts.length, initialRequests + 1, "IME composition does not request intermediate text");
  await page.locator("#font-preview-text").dispatchEvent("compositionend"); await previewReady();
  assert.equal(previewTexts.length, initialRequests + 2);
  await page.locator("#font-preview-text").fill("");
  await page.waitForTimeout(400);
  assert.equal(previewTexts.length, initialRequests + 2, "empty text never requests an unrestricted font");
  await page.locator("#font-preview-text").fill("让阅读更舒适，灵感从这里开始。\nThe quick brown fox jumps over the lazy dog.\n0123456789 · Aa Bb Cc"); await previewReady();
  await download(); await waitReady(page);
  assert.equal(await selected(page), "default", "download saves without applying");
  assert.equal(await records(page), 1); assert.equal(requests, 1, "explicit download fetches full bytes, never saves the preview subset");
  assert.match(await page.locator(".font-specimen").evaluate(el => getComputedStyle(el).fontFamily), /AxiomFont-inter/);
  assert.equal(await page.evaluate(() => [...document.fonts].some(face => face.family === "AxiomPreview-inter")), false);
  await page.getByRole("button", { name: "使用字体", exact: true }).click();
  assert.equal(await selected(page), "custom:inter");
  await sibling.waitForFunction(() => document.querySelector('#display-font-family')?.textContent === "Inter");
  await close(); mode = "offline"; await page.reload(); await waitReady(page);
  assert.equal(await selected(page), "custom:inter"); assert.equal(requests, 1, "offline restore uses saved bytes");
  await open();
  for (const failure of ["offline", "http", "corrupt", "oversized", "missing"] as const) {
    mode = failure;
    const beforePreview = previewTexts.length;
    // A stale alert can survive the retry click until React runs its effect.
    // Observe this attempt's request before accepting its error state.
    const requested = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.hostname === "fonts.googleapis.com" && !names.has(url.searchParams.get("text") ?? "");
    });
    if (failure === "offline") await choose("Lora");
    else await page.getByRole("button", { name: "重新加载预览", exact: true }).click();
    await requested;
    await page.getByRole("alert").waitFor();
    assert.equal(previewTexts.length, beforePreview + 1, `${failure} exercises a new preview request`);
    assert.equal(await page.locator(".font-specimen").getAttribute("aria-busy"), "false");
    assert.equal(await selected(page), "custom:inter"); assert.equal(await records(page), 1);
    assert.equal(requests, 1, "preview failures never fall back to full-font download");
  }
  mode = "pending"; await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "重新加载预览", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "已取消" }).waitFor();
  await page.getByRole("button", { name: "← 返回字体列表", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-pressed") === "true");
  assert.equal(await page.locator(".font-specimen").count(), 0, "mobile back releases the preview");
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.locator(".font-specimen").waitFor({ state: "visible" });
  await page.setViewportSize({ width: 320, height: 640 });
  await choose("Lora");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "已取消" }).waitFor();
  await page.setViewportSize({ width: 1200, height: 1000 });
  mode = "ok"; await page.getByRole("button", { name: "重新加载预览", exact: true }).click(); await previewReady();
  for (const failure of ["offline", "http", "corrupt"] as const) {
    mode = failure; await download(); await waitReady(page); await page.getByRole("alert").waitFor();
    assert.equal(await records(page), 1, "failed full download never persists the subset");
  }
  mode = "ok"; await download(); await waitReady(page);
  assert.equal(await selected(page), "custom:inter"); assert.equal(await records(page), 2);
  await page.getByRole("button", { name: "使用字体", exact: true }).click();
  assert.equal(await selected(page), "custom:lora");
  await close(); await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  assert.equal(await selected(page), "default"); assert.equal(await records(page), 2);
  await open(); await choose("Lora"); await waitReady(page);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => window.dispatchEvent(new CustomEvent("axiom-theme", { detail: theme })), theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator(".font-browser").evaluate(el => el.scrollWidth <= el.clientWidth), "modal does not overflow horizontally");
      const box = (await page.locator(".font-browser").boundingBox())!;
      assert.ok(box.y >= 0 && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 800, "dialog stays in viewport");
      await page.screenshot({ path: join(artifacts, theme + "-" + width + ".png"), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "← 返回字体列表", exact: true }).click();
  assert.equal(await page.getByRole("searchbox", { name: "搜索字体" }).inputValue(), "Lora");
  await page.getByRole("searchbox", { name: "搜索字体" }).fill("");
  await page.screenshot({ path: join(artifacts, "mobile-list.png"), fullPage: true });
  await choose("Inter"); await waitReady(page);
  assert.ok(await page.locator(".font-specimen").isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "浏览字体库", "Escape restores focus");
  await page.setViewportSize({ width: 1200, height: 1000 }); await open();
  await choose("Aclonica"); await previewReady();
  assert.ok(await page.evaluate(() => [...document.fonts].some(face => face.family === "AxiomPreview-aclonica")));
  await close();
  assert.equal(await page.evaluate(() => [...document.fonts].some(face => face.family === "AxiomPreview-aclonica")), false, "closing releases unsaved preview");
  assert.ok(await page.evaluate(() => [...document.fonts].some(face => face.family === "AxiomFont-inter")), "saved fonts remain available");
  await open();
  const delayNextFont = async (prefix = "AxiomFont-") => page.evaluate(prefix => {
    const original = FontFace.prototype.load; (window as any).releaseFont = undefined;
    FontFace.prototype.load = function() {
      if (!this.family.startsWith(prefix)) return original.call(this);
      FontFace.prototype.load = original;
      return original.call(this).then(face => new Promise<FontFace>(resolve => { (window as any).releaseFont = () => resolve(face); }));
    };
  }, prefix);
  await delayNextFont("AxiomPreview-"); await choose("思源黑体 · Noto Sans SC");
  await page.waitForFunction(() => !!(window as any).releaseFont);
  await page.getByRole("button", { name: "取消", exact: true }).click(); await page.evaluate(() => (window as any).releaseFont());
  await page.getByRole("alert").filter({ hasText: "已取消" }).waitFor(); await waitReady(page);
  assert.equal(await records(page), 2); assert.equal(await selected(page), "default");
  await choose("思源宋体 · Noto Serif SC"); await previewReady();
  assert.equal(await page.evaluate(() => [...document.fonts].some(face => face.family === "AxiomPreview-noto-sans-sc")), false, "canceled decode never registers a stale subset");
  // A later explicit selection in another window is retained when download saves.
  await sibling.getByRole("button", { name: "恢复默认", exact: true }).click();
  await download(); await waitReady(page);
  assert.equal(await selected(page), "default"); assert.equal(await records(page), 3);
  await delayNextFont();
  await sibling.locator('input[type=file]').setInputFiles({ name: "跨窗口A.woff2", mimeType: "font/woff2", buffer: bytes });
  await sibling.getByRole("status").filter({ hasText: "已导入" }).waitFor();
  await page.waitForFunction(() => !!(window as any).releaseFont);
  await upload("跨窗口B.woff2", bytes); await page.evaluate(() => (window as any).releaseFont());
  await page.getByRole("status").filter({ hasText: "已导入" }).waitFor(); await close();
  await choice(page).click();
  await page.getByRole("option", { name: "跨窗口A", exact: true }).waitFor();
  await page.getByRole("option", { name: "跨窗口B", exact: true }).waitFor(); await page.keyboard.press("Escape");
  assert.equal(await records(page), 5);
  await delayNextFont(); await upload("取消导入.woff2", bytes);
  await page.waitForFunction(() => !!(window as any).releaseFont);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => (window as any).releaseFont());
  await page.getByRole("alert").filter({ hasText: "已取消" }).waitFor(); await waitReady(page);
  assert.equal(await records(page), 5, "canceling import before decode finishes never persists it");
  assert.equal(await selected(page), "default");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("axiom.fonts.v1");
    request.onsuccess = () => { const db = request.result, transaction = db.transaction("fonts", "readwrite"); transaction.objectStore("fonts").put({ id: "custom:broken", name: "Broken", data: new ArrayBuffer(4) }); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = reject; }; request.onerror = reject;
  }));
  await page.evaluate(() => localStorage.setItem("axiom.display.v1", JSON.stringify({ fontFamily: "custom:missing" })));
  await page.reload(); await waitReady(page); assert.equal(await selected(page), "default");
  await sibling.close(); await context.close();
  const denied = await browser.newContext();
  await denied.addInitScript(() => { const original = IDBFactory.prototype.open; (window as any).restoreStorage = () => { IDBFactory.prototype.open = original; }; IDBFactory.prototype.open = () => { throw new DOMException("Storage denied", "SecurityError"); }; });
  const deniedPage = await denied.newPage(); await deniedPage.goto(url); await deniedPage.getByRole("alert").waitFor();
  assert.equal(await choice(deniedPage).innerText(), "默认字体");
  await deniedPage.evaluate(() => (window as any).restoreStorage());
  await deniedPage.getByRole("button", { name: "重新读取字体", exact: true }).click();
  await deniedPage.getByRole("alert").waitFor({ state: "detached" }); await waitReady(deniedPage); await denied.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, catalogCount: count, cases: ["search/filter/pagination", "modal keyboard and mobile navigation", "isolated editable preview", "download separate from apply", "file validation", "real FontFace decoding", "IndexedDB and offline restore", "cross-tab import/select/delete", "network errors/retry/cancel", "reset", "missing font fallback", "storage denied", "dark/light 320/390/1200"], artifacts }));
} finally {
  await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true });
}
