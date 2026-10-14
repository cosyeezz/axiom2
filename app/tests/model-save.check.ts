import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-save-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "shared-pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.locator("#provider-id").fill("save-feedback-test");
  await page.locator("#provider-name").fill("密钥保存测试");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#provider-key").fill("TEST-ONLY-FIRST-KEY");
  assert.match(await page.locator("#provider-key-status").innerText(), /尚未保存/);
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.match(await page.locator(".configuration-feedback").innerText(), /API 密钥已写入本地文件/);
  assert.equal(await page.locator("#save-provider").innerText(), "已保存");
  assert.equal(await page.locator("#provider-key").inputValue(), "");
  assert.match(await page.locator("#provider-key").getAttribute("placeholder") || "", /已保存/);
  assert.match(await page.locator("#provider-key-status").innerText(), /已保存到本地/);
  assert.ok(await page.getByText(join(root, "shared-pi", "auth.json"), { exact: true }).isVisible());
  const keyOnDisk = () => JSON.parse(readFileSync(join(root, "shared-pi", "auth.json"), "utf8"))["save-feedback-test"]?.key;
  assert.ok(keyOnDisk() === "TEST-ONLY-FIRST-KEY", "initial key must reach disk");
  const banner = await page.locator(".configuration-feedback").boundingBox();
  assert.ok(banner && banner.y >= 0 && banner.y + banner.height < 900);

  await page.reload();
  await page.locator("#provider-key-status").filter({ hasText: "已保存到本地" }).waitFor();
  await page.locator("#provider-key").fill("TEST-ONLY-REPLACEMENT");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.ok(keyOnDisk() === "TEST-ONLY-REPLACEMENT", "replacement must reach disk");
  await page.locator("#provider-name").fill("保留旧密钥");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.ok(keyOnDisk() === "TEST-ONLY-REPLACEMENT", "empty key must preserve stored credential");

  await page.locator("#provider-url").fill("invalid-url");
  await page.locator("#provider-key").fill("TEST-ONLY-UNSAVED");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback").filter({ hasText: "接口地址无效" }).waitFor();
  assert.equal(await page.locator("#provider-key").inputValue(), "TEST-ONLY-UNSAVED");
  assert.ok(keyOnDisk() === "TEST-ONLY-REPLACEMENT", "failed save must preserve disk credential");
  assert.equal(await page.locator(".configuration-feedback").getAttribute("data-saved"), "false");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  assert.deepEqual(errors, []);
  console.log("Model save UI: disk persistence, replacement, reload, blank retention, visible feedback, failure preservation and mobile layout passed.");
} finally {
  await browser.close();
  await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
