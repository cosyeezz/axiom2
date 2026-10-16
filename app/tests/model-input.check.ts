import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-input-ui-"));
const artifacts = resolve("test-results/model-input");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("vision-ui");
  await page.locator("#provider-name").fill("多模态模型服务");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  assert.equal(await page.locator(".save-state").getAttribute("data-dirty"), "false", "empty editor is not a changed draft");
  await page.locator("#new-model-id").fill("vision-reasoning-model");
  await page.locator("#new-model-name").fill("视觉推理模型");
  const image = page.getByRole("checkbox", { name: "图片" });
  assert.equal(await image.isChecked(), false);
  await image.focus();
  await page.keyboard.press("Space");
  assert.ok(await image.isChecked());
  assert.equal(await image.locator("..").evaluate(el => getComputedStyle(el).outlineStyle), "solid");
  for (const level of ["low", "medium", "high"])
    await page.locator(`input[name=model-reasoning-level][value=${level}]`).check();
  for (const [width, height] of [[360, 800], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.locator("#model-editor").scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits at ${width}`);
    assert.ok(await page.locator("#model-editor").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `editor fits at ${width}`);
    const cards = await page.locator(".model-input-option").evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
    assert.ok(cards[1].x >= cards[0].right || cards[1].y >= cards[0].bottom, `cards do not overlap at ${width}`);
    const bounds = await image.boundingBox();
    assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44);
    if (width <= 800) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, `editor-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  const table = page.locator("#configured-model-table");
  assert.match(await table.innerText(), /文本 \+ 图片/);
  assert.match(await table.locator("td.reasoning-col").innerText(), /none, low, medium, high/);
  assert.doesNotMatch(await table.innerText(), /low \/ medium/);
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  const disk = () => JSON.parse(readFileSync(join(root, "pi", "models.json"), "utf8")).providers["vision-ui"].models[0];
  assert.deepEqual(disk().input, ["text", "image"]);
  await page.reload();
  await page.locator("#models-tab").click();
  await page.locator("#configured-model-table tbody tr").first().hover();
  await page.getByRole("button", { name: "编辑模型：视觉推理模型", exact: true }).click();
  assert.ok(await image.isChecked(), "image capability survives reload");
  await image.uncheck();
  // Unified save must include the editor even when another tab hides it.
  await page.locator("#suppliers-tab").click();
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.deepEqual(disk().input, ["text"]);
  await page.locator("#models-tab").click();
  assert.match(await table.innerText(), /仅文本/);
  for (const width of [360, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(artifacts, `list-${width}.png`), fullPage: true });
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const touchPage = await touch.newPage();
  await touchPage.goto(app.origin + "/model-config.html");
  await touchPage.locator("#models-tab").tap();
  await touchPage.getByRole("button", { name: "编辑模型：视觉推理模型", exact: true }).tap();
  const touchImage = touchPage.getByRole("checkbox", { name: "图片" });
  await touchImage.tap();
  assert.ok(await touchImage.isChecked());
  await touchPage.getByRole("button", { name: "完成编辑", exact: true }).tap();
  await touchPage.locator("#save-provider").tap();
  await touchPage.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.deepEqual(disk().input, ["text", "image"]);
  await touch.close();
  assert.deepEqual(errors, []);
  console.log("Model input UI passed: keyboard focus/toggle, nine viewport layouts, comma summaries, save/reload, hidden-editor save, and touch. Screenshots: " + artifacts);
} finally {
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
