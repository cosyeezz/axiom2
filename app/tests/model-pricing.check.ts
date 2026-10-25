import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-pricing-ui-"));
const artifacts = resolve("test-results/model-pricing");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("pricing-ui");
  await page.locator("#provider-name").fill("计费测试服务");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("priced-model");
  await page.locator("#new-model-name").fill("计费模型");
  const prices = { input: 2.5, output: 10, cacheRead: .25, cacheWrite: 3.125 };
  for (const [key, value] of Object.entries(prices)) await page.locator(`#model-cost-${key}`).fill(String(value));
  for (const width of [360, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".model-pricing").scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits at ${width}`);
    assert.ok(await page.locator(".model-pricing").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `pricing fits at ${width}`);
    await page.screenshot({ path: join(artifacts, `pricing-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  assert.match(await page.locator("#configured-model-table").innerText(), /已设置计费单价/);
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  const disk = () => JSON.parse(readFileSync(join(root, "pi", "models.json"), "utf8")).providers["pricing-ui"].models[0].cost;
  assert.deepEqual(disk(), prices);
  await page.reload();
  await page.locator("#models-tab").click();
  await page.locator("#configured-model-table tbody tr").hover();
  await page.getByRole("button", { name: "编辑模型：计费模型", exact: true }).click();
  for (const [key, value] of Object.entries(prices)) assert.equal(await page.locator(`#model-cost-${key}`).inputValue(), String(value));
  // Unified Save bypasses native form validation; the staging path must validate a hidden editor too.
  for (const invalid of ["-1", ""]) {
    await page.locator("#model-cost-input").fill(invalid);
    await page.locator("#suppliers-tab").click();
    await page.locator("#save-provider").click();
    await page.getByRole("alert").filter({ hasText: "计费设置" }).waitFor();
    assert.deepEqual(disk(), prices, "invalid hidden price must not reach disk");
    assert.equal(await page.locator("#models-tab").getAttribute("aria-selected"), "true");
  }
  // Clearing all existing rates is still an invalid edit, not an instruction to retain old rates.
  for (const key of Object.keys(prices)) await page.locator(`#model-cost-${key}`).fill("");
  await page.locator("#suppliers-tab").click();
  await page.locator("#save-provider").click();
  await page.getByRole("alert").filter({ hasText: "计费设置" }).waitFor();
  assert.deepEqual(disk(), prices, "clearing all saved rates must not bypass price validation");
  for (const [key, value] of Object.entries(prices)) await page.locator(`#model-cost-${key}`).fill(String(value));
  await page.locator("#model-cost-input").fill("4");
  await page.locator("#suppliers-tab").click();
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.deepEqual(disk(), { ...prices, input: 4 });
  await page.locator("#models-tab").click();
  await page.locator("#configured-model-table tbody tr").hover();
  await page.getByRole("button", { name: "编辑模型：计费模型", exact: true }).click();
  for (const key of Object.keys(prices)) await page.locator(`#model-cost-${key}`).fill("0");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.match(await page.locator("#configured-model-table").innerText(), /计费价格未知/);
  assert.deepEqual(errors, []);
  console.log("Model pricing UI passed: save/reload, four decimal rates, hidden-editor save/validation, zero-price guidance, 360/820/1440 layouts. Screenshots: " + artifacts);
} finally {
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
