import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-markdown-images-ui-"));
const artifacts = resolve("test-results/markdown-images");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  const imagePath = join(root, "copy position.png"), href = imagePath.replace(/\\/g, "/");
  if (process.env.AXIOM_TEST_IMAGE) copyFileSync(process.env.AXIOM_TEST_IMAGE, imagePath);
  else writeFileSync(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64"));
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const publish = (text: string, streaming = false) => {
    views.messageChanged(scope, { id: "image-reply", role: "assistant", text, streaming }); views.flush(scope);
  };
  publish("图片示意正在生成…", true);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [], remoteRequests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => { if (req.url().includes("example.com")) remoteRequests.push(req.url()); });
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  await page.locator('[aria-label="助手回复"]').waitFor();
  const source = `这里是**每条回复自身的右上角**，靠近正文第一行。\n\n![复制按钮位置示意](<${href}>)\n\n鼠标移入这条回复时显示图标，移开后隐藏。\n\n![外部图](https://example.com/no-request.png)`;
  publish(source);
  const image = page.locator(".markdown-image-open img");
  await image.waitFor();
  await image.evaluate((node: HTMLImageElement) => node.decode());
  assert.ok(await image.evaluate((node: HTMLImageElement) => node.naturalWidth > 0));
  const trigger = page.getByRole("button", { name: "放大图片：复制按钮位置示意" });
  await trigger.focus(); await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate((node) => node === document.activeElement));
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).focus();
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), source);
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `inline-${width}.png`) });
  }
  await page.reload(); await image.waitFor(); await image.evaluate((node: HTMLImageElement) => node.decode());
  const missing = href + ".missing";
  publish(`![缺失图片](<${missing}>)`);
  await page.getByText(/图片文件不存在或已移动/).waitFor();
  copyFileSync(imagePath, missing);
  await page.getByRole("button", { name: "重试加载图片" }).click();
  await image.waitFor(); await image.evaluate((node: HTMLImageElement) => node.decode());
  // A changed source unmounts the old preview and cannot reopen it on a late response.
  await page.getByRole("button", { name: "放大图片：缺失图片" }).click();
  await page.getByRole("dialog").waitFor();
  publish("图片引用已更新。");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(remoteRequests, []); assert.deepEqual(errors, []);
  publish(Array.from({ length: 6 }, (_, index) => `[![图${index}](<${href}>)](https://example.com/linked)`).join(" "));
  await page.waitForFunction(() => document.querySelectorAll(".markdown-image-open img").length === 6);
  assert.equal(await page.locator("a .markdown-image-open").count(), 0);
  assert.equal(await page.locator(".markdown-image-error").count(), 0);
  assert.deepEqual(remoteRequests, []); assert.deepEqual(errors, []);
  console.log("PASS: inline local image, streaming, preview/keyboard/focus, unchanged copy, reload, missing/retry, changed source, no remote requests, 6 linked images and 3 widths");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
