// Browser presentation fixture with real scoped image reads; no model execution.
// Run: npm exec tsx tests/message-images.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { chatMessage } from "../src/server/transcript.js";
import { Files } from "../src/server/files.js";
import { messageScope, threadScope, type ChatMessage } from "../src/shared/agent.js";
import { attachmentPrompt, type Attachment, type Session, type Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-message-images-"));
const artifacts = resolve("test-results/message-images");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace"));
mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
  const photo = await new Files(app.store).command({ requestId: crypto.randomUUID(), op: "files.upload", ...scope,
    params: { id: "imag1", kind: "image", name: "截图.png", data } }) as Attachment;
  const many = [photo, { ...photo, id: "imag3", name: "页面设计稿-很长的文件名-".repeat(12) + ".png" },
    { ...photo, id: "imag4", name: '<img src=x onerror=alert(1)>.png' }, { ...photo, id: "imag8", name: "移动端.png" }];
  const messages: ChatMessage[] = [
    chatMessage({ role: "user", content: attachmentPrompt("[imag1]", [photo]) }, "single")!,
    chatMessage({ role: "user", content: attachmentPrompt("请对照 [imag1] 和 [imag3] 调整页面。", many) }, "multi")!,
    chatMessage({ role: "user", content: attachmentPrompt("", [photo]) }, "only")!,
    chatMessage({ role: "custom", customType: "axiom-append", display: true, content: attachmentPrompt("子任务补充 [imag1]", [photo]) }, "child")!,
    { id: "plain", role: "user", text: "**普通消息**保持原样" },
    chatMessage({ role: "custom", customType: "axiom-append", display: true, content: "运行中追加的 Steering 消息" }, "steer")!,
    chatMessage({ role: "custom", customType: "axiom-result", display: true, content: "子任务完成通知" }, "notice")!,
  ];
  assert.ok(!JSON.stringify(messages).includes(data));
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [], previews: Record<string, unknown>[] = [];
  let delayPreview = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((raw) => {
      const command = JSON.parse(raw.toString());
      if (command.op === "files.preview") previews.push(command);
      const message = messages.find((m) => messageScope(scope, m.id) === command.params?.scope);
      if (message && command.op === "subscribe") {
        route.send(JSON.stringify({ type: "snapshot", scope: command.params.scope, streamId: "fixture", seq: 1, data: message }));
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: null }));
      } else server.send(raw);
    });
    server.onMessage((raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "snapshot") {
        if (event.scope === threadScope(scope)) event.data = { ids: messages.map((m) => m.id), before: null };
        const message = messages.find((m) => messageScope(scope, m.id) === event.scope);
        if (message) event.data = message;
      }
      if (delayPreview && event.type === "receipt" && previews.some((p) => p.requestId === event.requestId))
        setTimeout(() => route.send(JSON.stringify(event)), 300);
      else route.send(JSON.stringify(event));
    });
  });
  await page.goto(app.origin);
  const icons = page.locator(".message-image-icon"), modal = page.locator(".image-preview");
  await icons.first().waitFor();
  assert.equal(await icons.count(), 7);
  assert.equal(await page.locator(".message-images").count(), 4);
  assert.equal(await page.locator(".message-images img, .message-image-card").count(), 0);
  assert.equal(previews.length, 0, "no eager image reads");
  assert.ok(!(await page.locator("#messages").innerText()).includes("附件路径映射"));
  assert.equal(await page.locator(".user-text strong").last().textContent(), "普通消息");
  assert.equal(await icons.nth(2).getAttribute("data-tooltip"), `imag3 · ${many[1].name}`);
  assert.deepEqual(await icons.allTextContents(), ["imag1", "imag1", "imag3", "imag4", "imag8", "imag1", "imag1"]);
  assert.equal(await page.locator(".user-text").count(), 6, "ordinary and Steering messages share user bubbles");
  assert.equal(await page.locator(".user-text").filter({ hasText: "子任务完成通知" }).count(), 0);
  const bubbleColors = await page.locator(".user-text").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  assert.equal(new Set(bubbleColors).size, 1, "same bubble color for regular and appended input");
  assert.notEqual(await icons.first().evaluate((node) => getComputedStyle(node).backgroundColor), bubbleColors[0]);
  await icons.first().click();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>(".image-preview img")?.naturalWidth === 1);
  assert.equal(previews[0].sessionId, session.id);
  assert.equal(previews[0].workspaceId, workspace.id);
  await page.keyboard.press("Escape"); await modal.waitFor({ state: "detached" });
  assert.ok(await icons.first().evaluate((node) => node === document.activeElement));
  await icons.nth(2).focus(); await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "图片预览 · imag3" }).waitFor();
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  await modal.waitFor({ state: "detached" });
  assert.ok(await icons.nth(2).evaluate((node) => node === document.activeElement));
  await icons.first().click(); await modal.waitFor();
  await page.mouse.click(2, 2); await modal.waitFor({ state: "detached" });
  delayPreview = true;
  await icons.first().click(); await modal.waitFor();
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  assert.equal(await modal.count(), 0, "late responses do not reopen preview");
  delayPreview = false;
  for (const [width, height] of [[360, 800], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const sizes = await icons.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { right: box.right, left: box.left, width: box.width, height: box.height };
    }));
    assert.ok(sizes.every((box) => box.left >= 0 && box.right <= width && box.width >= 44 && box.width <= 140 && box.height === 44), `icon bounds ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${width}`);
    await page.locator(".log-row").nth(1).screenshot({ path: join(artifacts, `attachments-${width}.png`) });
  }
  await page.reload(); await icons.first().waitFor();
  assert.equal(await icons.count(), 7);
  assert.equal(await page.locator(".user-text").count(), 6, "Steering stays styled after reload");
  await icons.first().click();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>(".image-preview img")?.naturalWidth === 1);
  await page.keyboard.press("Escape");
  rmSync(photo.path!);
  await icons.first().click(); await modal.getByRole("alert").waitFor();
  assert.equal(await modal.locator("img").count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: compact image icons; scoped real preview; keyboard/Escape/close/backdrop/focus; late responses; missing file; reload; 9 responsive widths. Screenshots: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
