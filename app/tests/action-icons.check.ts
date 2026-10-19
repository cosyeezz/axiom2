import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-action-icons-"));
const artifacts = resolve("test-results/action-icons");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
const gray = "rgb(138, 143, 152)", bright = "rgb(247, 248, 248)";
const color = (node: Locator) => node.evaluate(el => getComputedStyle(el).color);
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/model-config.html");
  const add = page.locator("#add-supplier");
  assert.equal(await color(add), gray);
  await add.hover(); assert.equal(await color(add), bright);
  await add.click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("icons-ui");
  await page.locator("#provider-name").fill("图标交互验收");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("icon-model");
  await page.locator("#new-model-name").fill("操作图标示例");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  const row = page.locator("#configured-model-table tbody tr").first();
  const copy = row.getByRole("button", { name: "复制模型名称：操作图标示例", exact: true });
  const edit = row.getByRole("button", { name: "编辑模型：操作图标示例", exact: true });
  const remove = row.getByRole("button", { name: "删除模型：操作图标示例", exact: true });
  await page.locator("#add-model").focus();
  await page.mouse.move(0, 0);
  assert.equal(await copy.evaluate(el => getComputedStyle(el).opacity), "0");
  assert.equal(await copy.evaluate(el => getComputedStyle(el).pointerEvents), "none");
  const before = await row.boundingBox();
  await row.hover({ position: { x: 4, y: 4 } });
  for (const button of [copy, edit, remove]) {
    assert.equal(await button.evaluate(el => getComputedStyle(el).opacity), "1");
    assert.equal(await color(button.locator("svg")), gray);
  }
  assert.deepEqual(await row.boundingBox(), before, "revealing actions never moves the row");
  await page.screenshot({ path: join(artifacts, "model-row-gray.png") });
  for (const button of [copy, edit, remove]) {
    await button.hover();
    assert.equal(await color(button.locator("svg")), button === remove ? "rgb(217, 149, 149)" : bright);
    assert.equal(await color((button === copy ? edit : copy).locator("svg")), gray, "only the targeted action highlights");
  }
  await copy.hover();
  await page.screenshot({ path: join(artifacts, "model-copy-hover.png") });
  await copy.click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "操作图标示例");
  await page.mouse.move(0, 0);
  await page.locator("#add-model").focus();
  await page.keyboard.press("Tab");
  assert.ok(await copy.evaluate(el => el === document.activeElement), "Tab reaches hidden row actions");
  assert.equal(await color(copy), bright);
  assert.equal(await copy.evaluate(el => getComputedStyle(el).outlineStyle), "solid");
  await edit.focus(); await page.keyboard.press("Enter");
  await page.locator("#model-editor").waitFor();
  assert.equal(await row.getAttribute("data-editing"), "true");
  await page.locator("#new-model-name").focus();
  assert.equal(await color(edit), gray);
  assert.equal(await edit.evaluate(el => getComputedStyle(el).opacity), "1");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  for (const [width, height] of [[360,800], [390,844], [430,932], [600,960], [820,1180], [1024,768], [1366,768], [1440,900], [1920,1080]]) {
    await page.setViewportSize({ width, height }); await copy.focus();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}`);
    assert.ok(await row.evaluate(el => [...el.querySelectorAll("button")].filter(button => button.getBoundingClientRect().width).every(button => {
      const b = button.getBoundingClientRect(), r = el.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1;
    })), `actions stay inside the row at ${width}`);
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const phone = await touch.newPage(); await phone.goto(app.origin + "/model-config.html");
  await phone.locator("#models-tab").tap();
  const phoneRow = phone.locator("#configured-model-table tbody tr").first();
  await phoneRow.waitFor();
  const phoneEdit = phoneRow.getByRole("button", { name: "编辑模型：操作图标示例", exact: true });
  await phoneEdit.waitFor();
  const touchButtons = await phoneRow.locator("button:visible").all();
  assert.equal(touchButtons.length, 4, "touch row contains name/ID copy, edit and delete actions");
  for (const button of touchButtons) {
    assert.equal(await color(button.locator("svg")), gray);
    assert.equal(await button.evaluate(el => getComputedStyle(el).opacity), "1");
    const bounds = (await button.boundingBox())!;
    assert.ok(bounds.width >= 44 && bounds.height >= 44);
  }
  // Full-page Chrome capture temporarily clears touch emulation; use the real viewport.
  await phone.screenshot({ path: join(artifacts, "model-touch.png") });
  await phoneEdit.tap();
  await phone.locator("#model-editor").waitFor();
  await phone.getByRole("button", { name: "完成编辑", exact: true }).tap();
  await phoneRow.getByRole("button", { name: "删除模型：操作图标示例", exact: true }).tap();
  const confirm = phone.getByRole("dialog", { name: "删除模型草稿？", exact: true });
  await confirm.waitFor();
  await confirm.getByRole("button", { name: "取消", exact: true }).tap();
  await touch.close();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app.origin);
  // Verify shared idle/hover/focus/disabled states on real toolbar controls.
  const sidebar = page.locator("#collapse-history");
  await sidebar.waitFor(); await page.mouse.move(0, 0);
  assert.equal(await color(sidebar), gray);
  await sidebar.hover(); assert.equal(await color(sidebar), bright);
  await page.mouse.move(0, 0); await sidebar.focus();
  assert.equal(await color(sidebar), bright);
  const navigation = page.locator(".thread-navigation button:disabled").first();
  await navigation.waitFor();
  await navigation.hover({ force: true }); assert.equal(await color(navigation), gray);
  assert.equal(await navigation.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  assert.deepEqual(errors, []);
  console.log("PASS: model row reveal/no reflow, gray/hover/delete/focus, keyboard, clipboard, editing row, nine widths, touch targets, shared toolbar and disabled states");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
