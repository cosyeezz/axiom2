import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-copy-reply-"));
const artifacts = resolve("test-results/copy-reply");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_BUILT !== "1" });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const source = "复制入口现在位于**这条回复的右上角**。\n\n鼠标移入回复即可看到图标，正文下方不再占用一整行。";
  const publish = (text = source, streaming = false, thinking?: string) => {
    views.messageChanged(scope, { id: "copy-answer", role: "assistant", text, streaming, thinking }); views.flush(scope);
  };
  views.messageChanged(scope, { id: "user", role: "user", text: "按照这个方案来改复制的 UI。" });
  publish(source, true);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const reply = page.locator('[aria-label="助手回复"]').last(), body = reply.locator(".reply-body");
  const copy = reply.getByRole("button", { name: "复制回复的 Markdown 原文" });
  await body.waitFor();
  assert.equal(await copy.count(), 0, "streaming replies keep existing no-copy behavior");
  const streamingWidth = (await reply.locator(".markdown").boundingBox())!.width;
  publish(); await copy.waitFor({ state: "attached" });
  assert.equal((await reply.locator(".markdown").boundingBox())!.width, streamingWidth);
  await page.mouse.move(0, 0);
  assert.equal(await copy.evaluate((node) => getComputedStyle(node).opacity), "0");
  assert.equal(await copy.evaluate((node) => getComputedStyle(node).pointerEvents), "none");
  const before = await body.boundingBox();
  await reply.hover();
  assert.equal(await copy.evaluate((node) => getComputedStyle(node).opacity), "1");
  assert.deepEqual(await body.boundingBox(), before, "revealing the control must not reflow prose");
  const buttonBox = (await copy.boundingBox())!, bodyBox = (await body.boundingBox())!;
  assert.equal(buttonBox.width, 44); assert.equal(buttonBox.height, 44);
  assert.ok(Math.abs(buttonBox.x + buttonBox.width - bodyBox.x - bodyBox.width) < 1);
  assert.ok(Math.abs(buttonBox.y - bodyBox.y) <= 8);
  assert.equal(await reply.locator("footer").count(), 0);
  assert.equal(await page.locator('[aria-label="用户消息"] .message-actions').count(), 0);
  const markdownBox = (await reply.locator(".markdown").boundingBox())!;
  assert.ok(markdownBox.x + markdownBox.width + 8 <= buttonBox.x + 1, "button gutter prevents content overlap");
  await page.screenshot({ path: join(artifacts, "desktop-hover.png") });
  await copy.click();
  await page.waitForFunction(() => document.querySelector('.message-actions')?.getAttribute('data-feedback') === 'copied');
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), source);
  assert.equal(await copy.locator('path[d="m5 12 4 4L19 6"]').count(), 1);
  assert.deepEqual(await body.boundingBox(), before);
  await page.waitForFunction(() => !document.querySelector('.message-actions')?.hasAttribute('data-feedback'));
  await page.mouse.move(0, 0);
  await page.locator("#prompt").focus();
  assert.equal(await copy.evaluate((node) => getComputedStyle(node).opacity), "0");
  // Starting at the reply, Tab reaches its first action even while transparent.
  await reply.evaluate((node) => { node.tabIndex = -1; node.focus(); });
  await page.keyboard.press("Tab");
  assert.ok(await copy.evaluate((node) => document.activeElement === node));
  assert.equal(await copy.evaluate((node) => getComputedStyle(node).opacity), "1");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('.message-actions')?.getAttribute('data-feedback') === 'copied');
  await page.waitForFunction(() => !document.querySelector('.message-actions')?.hasAttribute('data-feedback'));
  // A denied clipboard write must not report success and stays retryable.
  await page.evaluate(`
    window.originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => Promise.reject(new Error("denied")) });
  `);
  await copy.click();
  await reply.getByText("复制失败，点击重试", { exact: true }).last().waitFor();
  assert.equal(await reply.locator(".message-actions").getAttribute("data-feedback"), "failed");
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: (window as any).originalWriteText }));
  await copy.click();
  await page.waitForFunction(() => document.querySelector('.message-actions')?.getAttribute('data-feedback') === 'copied');
  // Copying a bounded snapshot still requests the complete server text.
  const long = "完整 Markdown 原文\n\n" + "长回复验证。".repeat(3000) + "\nEND-OF-FULL-REPLY";
  publish(long);
  await reply.getByRole("button", { name: "展开完整文本" }).waitFor();
  await copy.focus(); await copy.click();
  await page.waitForFunction(() => document.querySelector('.message-actions')?.getAttribute('data-feedback') === 'copied');
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), long);
  publish(source, false, "检查复制按钮是否避开思考块。");
  await reply.locator(".tool-activity > summary").click();
  await reply.locator(".thinking-block").waitFor();
  assert.ok((await copy.boundingBox())!.y > (await reply.locator(".thinking-block").boundingBox())!.y);
  publish();
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await copy.focus();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `copy-${width}.png`) });
  }
  await page.reload(); await copy.waitFor({ state: "attached" });
  assert.equal(await copy.getAttribute("data-tooltip"), "复制回复");
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await touch.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  const touchPage = await touch.newPage(); await touchPage.goto(app.origin);
  const touchCopy = touchPage.getByRole("button", { name: "复制回复的 Markdown 原文" });
  await touchCopy.waitFor();
  assert.equal(await touchCopy.evaluate((node) => getComputedStyle(node).opacity), "1");
  assert.equal(await touchCopy.evaluate((node) => getComputedStyle(node).pointerEvents), "auto");
  await touchPage.screenshot({ path: join(artifacts, "touch.png") }); await touch.close();
  assert.deepEqual(errors, []);
  console.log("PASS: hover/no-reflow/right gutter, keyboard, touch, clipboard success/reset/failure/retry, full truncated copy, thinking, streaming, reload and 3 widths");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
