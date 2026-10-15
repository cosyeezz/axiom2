import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { tasksScope } from "../src/shared/tasks.js";
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
  app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_BUILT !== "1" });
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
  const compressionTrigger = page.locator('[data-od-id="background-compression-trigger"]');
  const compressionDialog = page.getByRole("dialog", { name: "后台压缩", exact: true });
  const clearToolbar = async () => {
    await page.waitForFunction(() => {
      const panel = document.querySelector('.compression-page:popover-open');
      const toolbar = document.querySelector('.usage-settings');
      if (!panel || !toolbar) return false;
      const gap = toolbar.getBoundingClientRect().top - panel.getBoundingClientRect().bottom;
      return Math.abs(gap - 8) < 1;
    });
    for (const button of [trigger, compressionTrigger]) {
      assert.ok(await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), "settings icons stay visible and receive pointer input");
    }
  };
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
  await clearToolbar();
  await trigger.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  await compressionTrigger.click();
  await compressionDialog.waitFor();
  await dialog.waitFor({ state: "detached" });
  await clearToolbar();
  await trigger.click();
  await dialog.waitFor();
  await compressionDialog.waitFor({ state: "detached" });
  assert.ok(await dialog.getByRole("button", { name: "关闭子代理设置" }).evaluate((el) => el === document.activeElement));
  const initialBox = (await dialog.boundingBox())!;
  await page.mouse.move(initialBox.x + 10, 150);
  await page.mouse.down(); await page.mouse.move(initialBox.x - 20, 150); await page.mouse.up();
  assert.equal(await dialog.isVisible(), true, "dragging from the sheet onto the backdrop keeps it open");
  await page.mouse.click(initialBox.x - 20, 150);
  await dialog.waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  await trigger.click();
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
  for (const [width, height] of [[360, 800], [375, 900], [390, 844], [430, 932], [600, 960], [640, 900], [768, 900], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await clearToolbar();
    const d = await dialog.boundingBox();
    assert.ok(d && d.x >= 0 && d.x + d.width <= width + 1);
    assert.ok(d && Math.abs(d.x + d.width - width) < 1 && d.y === 0 && d.height < height, "right-hand sheet leaves the toolbar below it");
    assert.equal(d!.width, Math.min(520, width));
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
    await compressionTrigger.click();
    await compressionDialog.waitFor();
    await dialog.waitFor({ state: "detached" });
    await clearToolbar();
    assert.deepEqual(await compressionDialog.boundingBox(), d, `both panels clear the icons at ${width}`);
    await compressionTrigger.click();
    await compressionDialog.waitFor({ state: "detached" });
    assert.equal(await compressionTrigger.getAttribute("aria-expanded"), "false");
    await trigger.click();
    await dialog.locator(".model-picker > summary").click();
    assert.ok(await dialog.locator(".model-popover").evaluate((el) => {
      const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1;
    }));
    await page.screenshot({ path: `test-results/subagent-settings/dialog-${width}.png` });
    await dialog.getByRole("searchbox").press("Escape");
  }
  await page.setViewportSize({ width: 390, height: 480 });
  await clearToolbar();
  await dialog.locator(".model-picker > summary").click();
  const headerTop = (await dialog.locator("header").boundingBox())!.y;
  await dialog.locator(".compression-body").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  assert.equal((await dialog.locator("header").boundingBox())!.y, headerTop, "header stays visible while content scrolls");
  assert.ok(await dialog.locator(".compression-body").evaluate((el) => el.scrollTop > 0));
  await page.screenshot({ path: "test-results/subagent-settings/short-screen.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByRole("searchbox").press("Escape");
  const settingsBox = await dialog.boundingBox();
  await page.screenshot({ path: "test-results/subagent-settings/sheet-1440.png" });
  await dialog.getByRole("button", { name: "关闭子代理设置" }).click();
  await compressionTrigger.click();
  await compressionDialog.waitFor();
  await clearToolbar();
  assert.deepEqual(await compressionDialog.boundingBox(), settingsBox, "same sheet geometry as compression settings");
  await compressionTrigger.click();
  await compressionDialog.waitFor({ state: "detached" });
  await trigger.focus();
  await trigger.press("Enter");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));

  // Seed a completed child without launching a model; use the real child window and toolbar.
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const records = new TaskRecords(app.store);
  const { taskIds: [taskId] } = records.create(scope, "settings-child", "UI fixture", [{ task: "设置面板子会话", role: "" }], app.tasks.settings().selection!);
  app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(taskId);
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "settings-child-message", role: "assistant", text: "子会话设置验证", calls: [{ id: "settings-child", name: "delegate", input: "{}" }] });
  views.flush(scope);
  app.agents.publish(tasksScope(scope), app.tasks.list(scope));
  await page.locator(".tool-activity > summary").click();
  await page.getByRole("button", { name: "打开子会话：设置面板子会话", exact: true }).click();
  const child = page.getByRole("dialog", { name: "子代理会话", exact: true });
  const childSub = child.getByRole("button", { name: "子代理设置", exact: true });
  const childCompression = child.locator('[data-od-id="background-compression-trigger"]');
  await child.locator("textarea").fill("子会话草稿");
  for (const [width, height] of [[1440, 900], [390, 844], [390, 480]]) {
    await page.setViewportSize({ width, height });
    await childSub.click();
    const settings = child.getByRole("dialog", { name: "子代理设置", exact: true });
    await settings.waitFor();
    await childCompression.click();
    await settings.waitFor({ state: "detached" });
    const compression = child.getByRole("dialog", { name: "后台压缩", exact: true });
    await compression.waitFor();
    const panelBox = (await compression.boundingBox())!, iconBox = (await childCompression.boundingBox())!;
    assert.ok(panelBox.y + panelBox.height <= iconBox.y - 7, "child settings stay above the child toolbar");
    assert.ok(await childCompression.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), "child launcher remains clickable above the parent modal");
    await page.keyboard.press("Escape");
    await compression.waitFor({ state: "detached" });
    assert.ok(await child.isVisible(), "Escape closes only settings, preserving the child conversation");
    assert.ok(await childCompression.evaluate((el) => el === document.activeElement));
    assert.equal(await child.locator("textarea").inputValue(), "子会话草稿");
  }
  await child.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log("Subagent settings UI passed: toolbar clearance, one-click switching/toggling, 12 responsive sizes, child modal/short-screen scrolling, outside/drag handling, autosave, cross-window sync, reload, validation, keyboard/focus and draft preservation.");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
