import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { randomUUID } from "node:crypto";
import type { Workspace, Session } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-subagent-ui-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: {
  "subagent-ui-fixture": { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Subagent fixture", reasoning: true }] },
} }));
writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), JSON.stringify({ "subagent-ui-fixture": { type: "api_key", key: "fixture" } }));
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root, port: 0, dev: true });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript((view) => { sessionStorage.setItem("view", JSON.stringify(view)); }, { workspaceId: workspace.id, sessionId: session.id });
  const page = await context.newPage(), other = await context.newPage();
  const errors: string[] = [];
  for (const p of [page, other]) {
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(app.accessUrl);
  }
  const trigger = page.getByRole("button", { name: "子代理设置", exact: true });
  assert.equal(await page.locator('.composer-area > .container > details.model-picker').count(), 0);
  const layout = () => page.locator(".usage").evaluate((el) => {
    const metrics = el.querySelector(".usage-row")!.getBoundingClientRect();
    const group = el.querySelector(".usage-settings")!.getBoundingClientRect();
    const sub = el.querySelector(".subagent-trigger")!.getBoundingClientRect();
    const compression = el.querySelector('[data-od-id="background-compression-trigger"]')!.getBoundingClientRect();
    const outer = el.getBoundingClientRect();
    return { metrics: metrics.toJSON(), group: group.toJSON(), outer: outer.toJSON(), sub: sub.toJSON(), compression: compression.toJSON() };
  });
  await trigger.waitFor();
  let box = await layout();
  assert.equal(box.metrics.y, box.group.y, "wide: all icons on one row");
  assert.ok(Math.abs(box.group.right - (box.outer.right - 12)) < 2, "wide: settings at far right");
  assert.equal(box.sub.y, box.compression.y);
  await page.locator("#prompt").fill("保留草稿");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "子代理设置", exact: true });
  await dialog.waitFor();
  const concurrency = dialog.getByRole("spinbutton", { name: "同时运行的子任务", exact: true });
  await concurrency.fill("3"); await concurrency.press("Enter");
  await page.waitForFunction(() => document.querySelector(".subagent-settings")?.textContent?.includes("已全局保存并生效"));
  assert.equal(app.tasks.settings().budgets.concurrency, 3);
  const work = dialog.getByRole("spinbutton", { name: "工作时限（秒）", exact: true });
  await work.fill("125"); await work.press("Tab");
  await page.waitForFunction(() => [...document.querySelectorAll('.subagent-budget-field [role="status"]')].every((el) => el.textContent === "已全局保存并生效"));
  assert.equal(app.tasks.settings().budgets.workMs, 125000);
  await concurrency.fill("0"); await concurrency.press("Enter");
  await dialog.getByText(/请输入 1–16/).waitFor();
  assert.equal(app.tasks.settings().budgets.concurrency, 3);
  await concurrency.fill("3"); await concurrency.press("Enter");
  await dialog.locator(".model-picker > summary").click();
  await dialog.getByRole("button", { name: /^Subagent fixture\s*subagent-ui-fixture$/ }).click();
  const high = dialog.getByRole("radio", { name: "high", exact: true });
  await high.check();
  await page.waitForFunction(() => document.querySelector('.subagent-settings .model-picker > summary')?.textContent?.includes("high"));
  assert.deepEqual(app.tasks.settings().selection, { provider: "subagent-ui-fixture", id: "fixture", thinking: "high" });
  assert.equal(await dialog.getByRole("button", { name: "确认模型设置" }).count(), 0, "subagent model is autosaved");
  await high.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  assert.equal(await page.locator("#prompt").inputValue(), "保留草稿");
  await trigger.click();
  await other.getByRole("button", { name: "子代理设置", exact: true }).click();
  const otherDialog = other.getByRole("dialog", { name: "子代理设置", exact: true });
  await otherDialog.getByRole("spinbutton", { name: "同时运行的子任务", exact: true }).fill("6");
  await otherDialog.getByRole("spinbutton", { name: "同时运行的子任务", exact: true }).press("Enter");
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.subagent-budget-field input')?.value === "6");
  await page.reload(); await trigger.click();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.subagent-budget-field input')?.value === "6");
  assert.equal(await dialog.getByRole("spinbutton", { name: "同时运行的子任务", exact: true }).inputValue(), "6");
  for (const width of [375, 390, 640, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const d = await dialog.boundingBox();
    assert.ok(d && d.x >= 0 && d.x + d.width <= width + 1);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await dialog.getByRole("button", { name: "关闭子代理设置" }).click();
    box = await layout();
    assert.equal(box.sub.y, box.compression.y, `settings must stay together at ${width}`);
    if (box.group.y > box.metrics.y + 2) assert.ok(Math.abs(box.group.x - box.metrics.x) < 2, `wrapped settings left-align at ${width}`);
    else assert.ok(Math.abs(box.group.right - (box.outer.right - 12)) < 2, `one-row settings right-align at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (width === 375 || width === 1440) {
      mkdirSync("test-results/subagent-settings", { recursive: true });
      await page.screenshot({ path: `test-results/subagent-settings/toolbar-${width}.png` });
    }
    await trigger.click();
    await dialog.locator(".model-picker > summary").click();
    assert.ok(await dialog.locator(".model-popover").evaluate((el) => {
      const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1;
    }));
    await page.screenshot({ path: `test-results/subagent-settings/dialog-${width}.png` });
    await dialog.getByRole("searchbox").press("Escape");
  }
  await dialog.getByRole("button", { name: "关闭子代理设置" }).click();
  await page.getByRole("button", { name: "打开后台压缩", exact: true }).click();
  await page.getByRole("dialog", { name: "后台压缩", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Subagent settings UI passed: grouped responsive toolbar, autosave, cross-window sync, reload, validation, focus, draft preservation, compression entry.");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
