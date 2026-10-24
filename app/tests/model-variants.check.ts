import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-variants-ui-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const path = join(process.env.AXIOM_PI_DIR, "models.json");
writeFileSync(path, JSON.stringify({ providers: { variants: { api: "openai-responses", baseUrl: "http://127.0.0.1:1/v1", name: "Variants",
  models: [{ id: "upstream", name: "Standard", reasoning: false, samplingParams: { service_tier: "default" } }] } } }));
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const disk = () => JSON.parse(readFileSync(path, "utf8")).providers.variants.models as { id: string; name: string; axiomRequestModelId?: string; samplingParams: { service_tier: string } }[];
  const save = async () => { await page.locator("#save-provider").click(); await page.locator(".configuration-feedback[data-saved=true]").waitFor(); };
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#models-tab").click();
  for (const tier of ["fast", "ultrafast"]) {
    await page.locator("#add-model").click();
    await page.locator("#new-model-id").fill("upstream");
    await page.locator("#new-model-name").fill(tier);
    assert.equal(await page.locator("#new-model-id").getAttribute("aria-invalid"), "false", "upstream ID may repeat");
    const body = page.getByRole("region", { name: "请求体覆盖", exact: true });
    await body.getByRole("button", { name: "添加一项" }).click();
    await body.getByRole("combobox", { name: "第 1 项请求体字段", exact: true }).fill("service_tier");
    await body.getByRole("combobox", { name: "第 1 项请求体值", exact: true }).fill(tier);
    if (tier === "fast") await page.getByRole("button", { name: "完成编辑", exact: true }).click();
    await save(); // Also covers Save while the editor remains open.
  }
  const identities = new Map(disk().map(m => [m.name, m.id]));
  assert.equal(identities.size, 3);
  assert.equal(new Set(identities.values()).size, 3);
  assert.equal(identities.get("Standard"), "upstream");
  assert.ok(disk().every(m => (m.axiomRequestModelId ?? m.id) === "upstream"));
  await page.reload();
  await page.locator("#models-tab").click();
  const rows = page.locator("#configured-model-table tbody tr");
  assert.equal(await rows.count(), 3);
  assert.equal(new Set(await page.locator("#configured-model-table .model-id").allTextContents()).size, 1);
  const fast = rows.filter({ has: page.getByRole("button", { name: "编辑模型：fast", exact: true }) });
  await fast.hover();
  await fast.getByRole("button", { name: "编辑模型：fast", exact: true }).click();
  assert.equal(await page.locator("#new-model-id").inputValue(), "upstream");
  const body = page.getByRole("region", { name: "请求体覆盖", exact: true });
  assert.equal(await body.getByRole("combobox", { name: "第 1 项请求体值", exact: true }).inputValue(), "fast");
  await page.locator("#new-model-name").fill("Fast renamed");
  await body.getByRole("combobox", { name: "第 1 项请求体值", exact: true }).fill("priority");
  await save();
  assert.equal(disk().find(m => m.name === "Fast renamed")!.id, identities.get("fast"));
  assert.equal(disk().find(m => m.name === "Fast renamed")!.samplingParams.service_tier, "priority");
  assert.equal(disk().find(m => m.name === "Standard")!.samplingParams.service_tier, "default");
  assert.equal(disk().find(m => m.name === "ultrafast")!.samplingParams.service_tier, "ultrafast");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: "/tmp/axiom-model-variants-ui.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS manual same-ID variants: Finish/Save, reload, stable identities, independent editing, 390px layout; screenshot /tmp/axiom-model-variants-ui.png");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
