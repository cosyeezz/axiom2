import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-tooltip-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, workspaceId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId });
  const workspace = run("workspace.open", { path: root, authorized: true }) as Workspace;
  const session = run("session.create", {}, workspace.id) as Session;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), { workspaceId: workspace.id, sessionId: session.id });
  await page.goto(app.origin);
  const trigger = page.getByRole("button", { name: "子代理设置", exact: true });
  const tip = page.getByRole("tooltip");
  await trigger.hover();
  await page.waitForTimeout(150);
  assert.equal(await tip.count(), 0, "passing the control does not flash a tooltip");
  await tip.waitFor();
  assert.equal(await tip.innerText(), "子代理设置");
  assert.equal(await trigger.getAttribute("title"), null, "no second native tooltip");
  const style = await tip.evaluate(el => {
    const css = getComputedStyle(el);
    return { background: css.backgroundColor, border: css.borderWidth, radius: css.borderRadius, font: css.fontSize, popover: el.matches(":popover-open") };
  });
  assert.deepEqual(style, { background: "rgb(35, 37, 39)", border: "1px", radius: "8px", font: "12px", popover: true });
  mkdirSync("test-results/tooltips", { recursive: true });
  await page.screenshot({ path: "test-results/tooltips/workbench.png" });
  const triggerBox = (await trigger.boundingBox())!;
  const tipBox = (await tip.boundingBox())!;
  await page.mouse.move(triggerBox.x + triggerBox.width / 2, (triggerBox.y + tipBox.y + tipBox.height) / 2);
  await page.waitForTimeout(40);
  assert.equal(await tip.isVisible(), true, "crossing the gap does not dismiss the hint");
  await tip.hover();
  await page.waitForTimeout(200);
  assert.equal(await tip.isVisible(), true, "the hint remains available while hovered");
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "detached" });
  assert.equal(await trigger.getAttribute("aria-describedby"), null);

  await trigger.click();
  await page.waitForTimeout(550);
  assert.equal(await tip.count(), 0, "clicking does not reopen the hint");
  const close = page.getByRole("button", { name: "关闭子代理设置", exact: true });
  await close.waitFor();
  await page.keyboard.press("Tab");
  await close.focus();
  await tip.waitFor();
  assert.equal(await tip.innerText(), "返回会话（Esc）");
  assert.equal(await close.getAttribute("aria-describedby"), await tip.getAttribute("id"));
  await page.mouse.move(700, 400);
  await page.waitForTimeout(200);
  assert.equal(await tip.isVisible(), true, "unrelated pointer movement preserves a keyboard-focused hint");
  assert.equal(await close.evaluate(el => el === document.activeElement), true);
  await tip.hover();
  await page.waitForTimeout(200);
  assert.equal(await tip.isVisible(), true, "hints inside settings popovers stay hoverable");
  await tip.dblclick();
  assert.equal(await tip.isVisible(), true, "selecting hint text does not dismiss it");
  const selectedHint = await page.evaluate(() => getSelection()?.toString());
  assert.ok(selectedHint?.length, "hint text remains selectable");
  await page.keyboard.press("Control+c");
  assert.equal(await tip.isVisible(), true, "copying hint text preserves the selection");
  assert.equal(await page.evaluate(() => getSelection()?.toString()), selectedHint);
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "detached" });
  assert.equal(await close.isVisible(), true, "Escape dismisses the hint before its enclosing panel");
  await close.click();
  await page.locator("#prompt").fill("提示不能影响输入");
  await page.waitForTimeout(500);
  assert.equal(await tip.count(), 0);
  assert.equal(await page.locator("#prompt").inputValue(), "提示不能影响输入");

  // Shared-layer edge cases use a small DOM fixture, retaining the real app and CSS.
  await page.evaluate(() => {
    const fixture = document.createElement("button");
    fixture.id = "tooltip-fixture";
    fixture.textContent = "边缘提示";
    fixture.dataset.tooltip = "F:/工作空间/" + "很长的目录名/".repeat(30) + "文件.ts\n第二行说明";
    fixture.setAttribute("aria-describedby", "existing-description");
    fixture.style.cssText = "position:fixed;right:0;top:0;z-index:999;width:80px;height:40px";
    document.body.append(fixture);
  });
  const fixture = page.locator("#tooltip-fixture");
  await fixture.hover();
  await page.waitForTimeout(100);
  await page.mouse.move(700, 240);
  await fixture.hover();
  await tip.waitFor();
  await page.keyboard.press("Escape");
  await tip.waitFor({ state: "detached" });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 480 });
    await page.mouse.move(width / 2, 240);
    await fixture.hover();
    await tip.waitFor();
    const box = await tip.boundingBox();
    assert.ok(box && box.x >= 9 && box.y >= 9 && box.x + box.width <= width - 9 && box.y + box.height <= 471, "long hints fit the viewport");
    assert.match(await fixture.getAttribute("aria-describedby") ?? "", /existing-description/);
    await page.screenshot({ path: `test-results/tooltips/edge-${width}.png` });
    await page.keyboard.press("Escape");
    await tip.waitFor({ state: "detached" });
    assert.equal(await fixture.getAttribute("aria-describedby"), "existing-description");
  }
  await page.mouse.move(180, 240);
  await fixture.hover();
  await tip.waitFor();
  await fixture.evaluate(el => { (el as HTMLElement).dataset.tooltip = "更新后的说明"; });
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent === "更新后的说明");
  await fixture.evaluate(el => el.remove());
  await tip.waitFor({ state: "detached" });

  // Modal top-layer content must not cover the tooltip or make it inert.
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "tooltip-dialog";
    const button = document.createElement("button");
    button.textContent = "弹窗按钮";
    button.dataset.tooltip = "弹窗中的说明";
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.locator("#tooltip-dialog button").hover();
  await tip.waitFor();
  assert.equal(await tip.evaluate(el => el.matches(":popover-open")), true);
  await tip.hover();
  await page.waitForTimeout(200);
  assert.equal(await tip.isVisible(), true);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await tip.waitFor({ state: "detached" });
  await page.evaluate(() => document.querySelector("#tooltip-dialog")?.remove());

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.move(700, 400);
  await trigger.hover();
  await tip.waitFor();
  await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
  await tip.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("tooltip checks passed: theme, delay, hover, keyboard, dismissal, dynamic content, viewport edges, modal and draft preservation");
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
