import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-copy-ui-"));
const artifacts = resolve("test-results/model-copy");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const path = join(process.env.AXIOM_PI_DIR, "models.json");
writeFileSync(path, JSON.stringify({ providers: { "copy-ui": {
  api: "openai-responses", baseUrl: "http://127.0.0.1:1/v1", name: "复制测试供应商",
  models: [{ id: "upstream-model", name: "视觉推理模型", reasoning: false, input: ["text", "image"], headers: { "X-Test": "PRIVATE-TEST-HEADER" }, samplingParams: { service_tier: "fast" }, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 } }],
} } }));
writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), JSON.stringify({ "copy-ui": { type: "api_key", key: "TEST-ONLY" } }));
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#models-tab").click();
  const table = page.locator("#configured-model-table"), rows = table.locator("tbody tr");
  await rows.first().hover();
  await rows.first().getByRole("button", { name: "复制模型名称：视觉推理模型", exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "视觉推理模型");
  await rows.first().getByRole("button", { name: "复制模型配置：视觉推理模型", exact: true }).click();
  assert.equal(await rows.count(), 2);
  assert.match(await rows.nth(1).innerText(), /视觉推理模型（复制）/);
  await rows.first().hover();
  await rows.first().getByRole("button", { name: "复制模型配置：视觉推理模型", exact: true }).click();
  assert.equal(await rows.count(), 3);
  assert.match(await rows.nth(1).innerText(), /视觉推理模型（复制 2）/);
  await rows.nth(2).hover();
  await rows.nth(2).getByRole("button", { name: "复制模型配置：视觉推理模型（复制）", exact: true }).click();
  assert.equal(await rows.count(), 4);
  assert.equal(await page.locator(".save-state").getAttribute("data-dirty"), "true");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  const saved = JSON.parse(readFileSync(path, "utf8")).providers["copy-ui"].models;
  assert.equal(saved.length, 4);
  assert.ok(saved.every((m: { id: string; axiomRequestModelId?: string; headers: Record<string, string> }) => (m.axiomRequestModelId ?? m.id) === "upstream-model" && m.headers["X-Test"] === "PRIVATE-TEST-HEADER"));
  await page.reload();
  await page.locator("#models-tab").click();
  assert.equal(await rows.count(), 4);
  assert.equal(await table.locator(".model-id").allTextContents().then(ids => new Set(ids).size), 1);
  await rows.nth(1).hover();
  await rows.nth(1).getByRole("button", { name: "编辑模型：视觉推理模型（复制 2）", exact: true }).click();
  assert.equal(await page.locator("#new-model-id").inputValue(), "upstream-model");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  assert.equal(await page.locator("#model-editor").count(), 0, "unchanged upstream ID is valid for a copy");
  for (const width of [360, 600, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await rows.first().scrollIntoViewIfNeeded();
    await rows.first().hover();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page fits ${width}`);
    const buttons = await rows.first().locator(".copyable-value .copy-model-value:visible").evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(), text = node.previousElementSibling!.getBoundingClientRect(), icon = node.querySelector("svg")!.getBoundingClientRect();
      return { top: box.top, left: box.left, right: text.right, width: box.width, icon: icon.width };
    }));
    for (const b of buttons) {
      assert.equal(b.width, 24);
      assert.equal(b.icon, 13);
      assert.ok(b.left - b.right >= 3 && b.left - b.right <= 5, `copy stays beside text ${width}`);
    }
    if (buttons.length === 2) assert.ok(Math.abs(buttons[0].top - buttons[1].top) <= 1, `name/id copy buttons align ${width}`);
    await page.screenshot({ path: join(artifacts, `list-${width}.png`), fullPage: true });
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const mobile = await touch.newPage();
  await mobile.goto(app.origin + "/model-config.html");
  await mobile.locator("#models-tab").tap();
  const first = mobile.locator("#configured-model-table tbody tr").first();
  for (const button of await first.locator("button:visible").all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, "touch buttons retain 44px targets");
  }
  await first.getByRole("button", { name: "复制模型配置：视觉推理模型", exact: true }).tap();
  assert.equal(await mobile.locator("#configured-model-table tbody tr").count(), 5);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobile.screenshot({ path: join(artifacts, "touch-390.png"), fullPage: true });
  await touch.close();
  assert.deepEqual(errors, []);
  console.log("Model copy UI passed: clipboard, repeated/nested copy, save/reload, copy editing, five desktop widths and touch. Artifacts: " + artifacts);
} finally {
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
