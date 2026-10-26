import assert from "node:assert/strict";
import type { Page } from "playwright";
import { join } from "node:path";

/** Runs inside the isolated composer runner, after its first selected image. */
export async function checkImageComposer(page: Page, png: Buffer, artifacts: string) {
  const input = page.locator("#prompt");
  async function paste(names: string[], type = "image/png", data = png.toString("base64")) {
    await input.evaluate((node: HTMLTextAreaElement, args) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(args.data), (c) => c.charCodeAt(0));
      for (const name of args.names) transfer.items.add(new File([bytes], name, { type: args.type }));
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, { names, type, data });
  }
  assert.equal(await page.locator(".image-chip .image-label").textContent(), "imag1");
  assert.equal(await page.locator(".image-chip img").count(), 0);
  await input.fill("前文后文");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 2));
  await paste(["paste-two.png", "paste-three.png"]);
  await page.getByRole("button", { name: "移除图片：paste-three.png", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "前文[imag2] [imag3]后文");
  assert.deepEqual(await page.locator(".image-label").allTextContents(), ["imag1", "imag2", "imag3"]);
  const beforePreview = await input.inputValue();
  const trigger = page.getByRole("button", { name: "预览图片：imag2", exact: true });
  const preview = page.getByRole("dialog", { name: "图片预览 · imag2", exact: true });
  await trigger.click();
  await preview.waitFor();
  assert.equal(await preview.getByRole("img").getAttribute("src"), `data:image/png;base64,${png.toString("base64")}`);
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".image-preview img");
    return img?.complete && img.naturalWidth > 0;
  });
  await preview.getByRole("img").click();
  assert.equal(await preview.isVisible(), true, "clicking image does not dismiss");
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await preview.waitFor();
  await preview.getByRole("button", { name: "关闭图片预览" }).click();
  await preview.waitFor({ state: "detached" });
  await trigger.click();
  await preview.waitFor();
  await page.mouse.click(2, 2);
  await preview.waitFor({ state: "detached" });
  assert.equal(await input.inputValue(), beforePreview, "preview never changes draft text");
  const chipBox = await page.locator(".image-chip").first().boundingBox(), inputBox = await input.boundingBox();
  assert.ok(chipBox && inputBox && chipBox.y + chipBox.height <= inputBox.y, "labels above input");
  await page.getByRole("button", { name: "移除图片：paste-two.png", exact: true }).click();
  assert.equal(await input.inputValue(), "前文 [imag3]后文");
  assert.deepEqual(await page.locator(".image-label").allTextContents(), ["imag1", "imag3"]);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "slow.png") await new Promise((r) => setTimeout(r, 500));
      return original.call(this);
    };
  });
  await input.fill("开始结束");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 2));
  await paste(["slow.png"]);
  await page.waitForTimeout(50);
  await input.pressSequentially("继续输入");
  await page.getByRole("button", { name: "移除图片：slow.png", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "开始[imag4]继续输入结束");
  await paste(["over-one.png", "over-two.png"]);
  await page.getByRole("status").filter({ hasText: "图片最多 4 张" }).waitFor();
  assert.equal(await input.inputValue(), "开始[imag4]继续输入结束");
  await paste(["unsupported.svg"], "image/svg+xml", Buffer.from("<svg/>").toString("base64"));
  await page.getByRole("status").filter({ hasText: "不是有效的" }).waitFor();
  assert.equal(await input.inputValue(), "开始[imag4]继续输入结束");
  // Keep the same page: reload loss is checked after explicit send in the parent runner.
  await page.getByRole("button", { name: "移除图片：slow.png", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "开始[imag4]继续输入结束");
  assert.equal(await page.locator(".image-chip").count(), 3);
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.screenshot({ path: join(artifacts, `image-paste-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "预览图片：imag4", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "图片预览 · imag4" });
    await modal.waitFor();
    const box = await modal.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    await page.screenshot({ path: join(artifacts, `image-preview-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "detached" });
  }
  // Ordinary text paste must remain native rather than becoming an image attachment.
  const prevented = await input.evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "plain text");
    return !node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.equal(prevented, false);
  // Failed image replacement restores the original selection when no later editing occurred.
  await input.fill("保留选中文字");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 4));
  await paste(["bad.svg"], "image/svg+xml", Buffer.from("<svg/>").toString("base64"));
  await page.getByRole("status").filter({ hasText: "不是有效的" }).waitFor();
  assert.equal(await input.inputValue(), "保留选中文字");
}
