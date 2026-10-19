import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { rewriteFixture } from "./rewrite-fixture.js";

const f = await rewriteFixture(!process.env.AXIOM_TEST_PRODUCTION);
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  await f.call("prompt", { text: "最初的问题 [file1]", attachments: [{ id: "file1", name: "notes.txt", kind: "file", path: join(f.project, "notes.txt"), text: "" }] }); await f.idle();
  await f.call("prompt", { text: "之后的问题" }); await f.idle();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), f.scope);
  await page.goto(f.app.origin);
  const history = page.getByRole("region", { name: "消息记录", exact: true });
  await history.getByText("之后的问题", { exact: true }).waitFor();
  await page.locator("#prompt").fill("独立草稿保持不变");
  await history.getByText("最初的问题 [file1]", { exact: true }).click();
  const editor = page.getByRole("textbox", { name: "修改消息", exact: true });
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "最初的问题 [file1]");
  assert.match(await page.getByLabel("保留的附件").innerText(), /notes.txt/);
  await editor.fill("取消的修改"); await editor.press("Escape");
  assert.equal(await editor.count(), 0);
  assert.equal(await page.locator("#prompt").inputValue(), "独立草稿保持不变");
  assert.equal(f.requests.length, 2);
  assert.equal(await history.getByText("之后的问题", { exact: true }).count(), 1);
  const edit = page.getByRole("button", { name: "修改并重新发送", exact: true }).first();
  await edit.focus(); await page.keyboard.press("Enter"); await editor.waitFor();
  await editor.fill("新的问题 [file1]");
  await editor.press("Shift+Enter"); assert.match(await editor.inputValue(), /\n$/);
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(f.requests.length, 2, "IME Enter never submits");
  const artifacts = resolve("test-results/session-rewrite"); mkdirSync(artifacts, { recursive: true });
  for (const [width, height] of [[1440, 900], [820, 900], [390, 844], [390, 480]]) {
    await page.setViewportSize({ width, height });
    await editor.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: no horizontal overflow`);
    const box = await editor.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    await page.screenshot({ path: join(artifacts, `${width}-${height}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await editor.fill("新的问题 [file1]"); await editor.press("Enter");
  await page.getByText("REWRITE_ANSWER_3", { exact: true }).waitFor(); await f.idle();
  assert.equal(await history.getByText("之后的问题", { exact: true }).count(), 0);
  assert.equal(await history.getByText("最初的问题 [file1]", { exact: true }).count(), 0);
  assert.equal(await page.getByText("REWRITE_ANSWER_1", { exact: true }).count(), 0);
  assert.equal(await page.getByText("REWRITE_ANSWER_2", { exact: true }).count(), 0);
  assert.equal(await page.locator("#prompt").inputValue(), "独立草稿保持不变");
  assert.doesNotMatch(JSON.stringify(f.requests.at(-1).messages), /之后的问题|最初的问题|REWRITE_ANSWER_1|REWRITE_ANSWER_2/);
  assert.match(JSON.stringify(f.requests.at(-1).messages), /notes.txt/);
  await page.reload(); await history.getByText("新的问题 [file1]", { exact: true }).waitFor();
  assert.equal(await history.getByText("之后的问题", { exact: true }).count(), 0);
  assert.equal(await page.locator("#prompt").inputValue(), "独立草稿保持不变");
  await page.screenshot({ path: join(artifacts, "rewritten.png") });
  assert.deepEqual(errors, []);
  console.log("PASS: click and keyboard edit, original attachment, cancel and draft isolation, Shift+Enter/IME, real Enter rewrite, model context, reload, 1440/820/390 responsive screenshots");
} finally { await browser.close(); await f.close(); }
