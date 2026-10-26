import { chooseSelect, assertSelectPosition } from "./select-helpers.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-settings-layout-"));
const artifacts = resolve("test-results/settings-layout");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const sizes = [[320, 640], [360, 800], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080], [1024, 400]];
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Browser | undefined;
const errors: string[] = [];
async function fits(page: Page, label: string) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document fits`);
  for (const selector of [".supplier-detail", ".scope-list", ".inline-model-editor", ".override-editor"]) {
    for (const element of await page.locator(selector).all()) {
      if (await element.isVisible()) assert.ok(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${label}: ${selector} fits`);
    }
  }
}
try {
  app = await startServer({ root: join(root, "data"), port: 0 });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/settings.html");
  await page.locator("#model-config-summary").filter({ hasText: "个供应商" }).waitFor();
  assert.match(await page.locator(".overview-footnote").innerText(), /重新打开可恢复已保存草稿/);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await fits(page, `overview ${width}x${height}`);
    const footnote = page.locator(".overview-footnote");
    await footnote.scrollIntoViewIfNeeded();
    assert.ok(await footnote.evaluate(el => { const r = el.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; }), "overview bottom reachable");
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector(".container")?.scrollTo(0, 0); });
    await page.screenshot({ path: join(artifacts, `overview-${width}x${height}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("layout-fixture-with-a-long-provider-id");
  await page.locator("#provider-name").fill("用于检查换行和字段边界的模型服务供应商");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  const headers = page.getByRole("region", { name: "供应商请求头覆盖", exact: true });
  const body = page.getByRole("region", { name: "请求体覆盖", exact: true });
  await headers.getByRole("button", { name: "＋ 添加一项" }).click();
  await headers.getByRole("textbox", { name: "第 1 项 key", exact: true }).fill("x-layout-fixture");
  await headers.getByRole("textbox", { name: "第 1 项 value", exact: true }).fill("layout-value");
  await body.getByRole("button", { name: "＋ 添加一项" }).click();
  await chooseSelect(page, body.getByRole("combobox"), "max_completion_tokens");
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await fits(page, `connection ${width}x${height}`);
    const key = body.getByRole("combobox");
    const value = body.locator(".override-value");
    await key.scrollIntoViewIfNeeded();
    const keyRect = await key.boundingBox(), valueRect = await value.boundingBox();
    assert.ok(keyRect && valueRect);
    assert.ok(valueRect.y >= keyRect.y + keyRect.height - 1 || valueRect.x >= keyRect.x + keyRect.width - 1, "override fields do not overlap");
    assert.ok(keyRect.width >= 200, `long request-body field remains readable at ${width}`);
    await key.click(); await assertSelectPosition(page, key);
    await page.screenshot({ path: join(artifacts, `body-field-open-${width}x${height}.png`) });
    await page.keyboard.press("Escape");
    const protocol = page.getByRole("combobox", { name: "接口协议", exact: true });
    await protocol.click(); await assertSelectPosition(page, protocol);
    await page.keyboard.press("Escape");
    await value.fill("2048");
    await page.locator("#save-provider").scrollIntoViewIfNeeded();
    assert.ok(await page.locator("#save-provider").evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `save reachable and not covered at ${width}x${height}`);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector(".supplier-detail")?.scrollTo(0, 0); document.querySelector("#suppliers-screen")?.scrollTo(0, 0); });
    await page.screenshot({ path: join(artifacts, `connection-${width}x${height}.png`), fullPage: true });
  }
  // A short window must still permit real editing and publishing, not just display a footer.
  await body.getByRole("button", { name: "删除第 1 项请求体覆盖" }).click();
  await headers.getByRole("button", { name: "删除第 1 项" }).click();
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("layout-model");
  for (const [width, height] of [[360, 800], [820, 1180], [1024, 400], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await fits(page, `model editor ${width}`);
    await page.getByRole("button", { name: "完成编辑", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `editor-${width}x${height}.png`), fullPage: true });
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touchPage = await touch.newPage();
  await touchPage.goto(app.origin + "/model-config.html");
  await touchPage.locator("#provider-id").waitFor();
  for (const input of await touchPage.locator(".input:visible").all()) {
    assert.ok(await input.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize) >= 16), "touch input avoids small-font focus zoom");
  }
  await touchPage.locator("#provider-key").tap();
  await fits(touchPage, "touch focused input");
  await touchPage.screenshot({ path: join(artifacts, "touch-390.png"), fullPage: true });
  await touch.close();
  assert.deepEqual(errors, []);
  console.log("PASS: settings overview and connection at 11 viewport sizes, long override fields, short-window editing/save reachability, model editor and touch input sizing. Screenshots: " + artifacts);
} finally {
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
