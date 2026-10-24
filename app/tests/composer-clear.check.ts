// Standalone, isolated data/port; never executes a model request.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Draft, Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-composer-clear-")));
const artifacts = process.env.AXIOM_CLEAR_ARTIFACTS ?? resolve("test-results/composer-clear");
for (const dir of [join(root, "pi"), join(root, "project"), artifacts]) mkdirSync(dir, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [];
const empty: Draft = { text: "", attachment: null, attachments: [], images: [], skills: [] };
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  await page.goto(app.accessUrl);
  await page.waitForFunction(() => document.querySelector(".connection-status")?.getAttribute("data-connected") === "true");
  const input = page.locator("#prompt"), clear = page.getByRole("button", { name: "清空输入", exact: true });
  await input.waitFor();
  async function seed(draft: Draft) {
    await page.evaluate(async ({ scope, draft }) => {
      const path = "/chat/composer-edit.ts";
      (await import(/* @vite-ignore */ path)).updateComposerDraft(scope, draft);
    }, { scope, draft });
  }
  async function readDraft() {
    return page.evaluate(async (scope) => {
      const path = "/chat/composer-edit.ts";
      return (await import(/* @vite-ignore */ path)).getComposerDraft(scope) as Draft;
    }, scope);
  }
  async function assertCleared() {
    await clear.click();
    await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement).value === "");
    assert.deepEqual(await readDraft(), empty);
    assert.equal(await clear.count(), 0, "clear only exists while draft has content");
    assert.equal(await input.evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator(".attachment-chip, .skill-card").count(), 0);
  }
  assert.equal(await clear.count(), 0);
  for (const draft of [
    { ...empty, text: " \n  " },
    { ...empty, text: "文字和占位符 [file1] [img1]", attachment: { name: "legacy.txt", text: "legacy" },
      attachments: [{ id: "file1", name: "file.txt", text: "file" }],
      images: [{ id: "img1", name: "image.png", mimeType: "image/png", data: "AA==" }],
      skills: [{ id: "fixture", name: "fixture", description: "test skill" }] },
    { ...empty, attachment: { name: "only-legacy.txt", text: "legacy" } },
    { ...empty, attachments: [{ id: "file1", name: "only-file.txt", text: "file" }] },
    { ...empty, images: [{ id: "img1", name: "only-image.png", mimeType: "image/png", data: "AA==" }] },
    { ...empty, skills: [{ id: "fixture", name: "fixture", description: "test skill" }] },
  ]) {
    await seed(draft);
    await clear.waitFor();
    await assertCleared();
  }
  // Clearing an edited message must not clear the separate ordinary draft or another scope.
  const otherScope = { ...scope, sessionId: "independent-scope" };
  await page.evaluate(async ({ scope, otherScope }) => {
    const drafts = "/drafts.ts", edit = "/chat/composer-edit.ts";
    const ordinary = await import(/* @vite-ignore */ drafts), editor = await import(/* @vite-ignore */ edit);
    ordinary.updateDraft(scope, { text: "保留普通草稿" });
    ordinary.updateDraft(otherScope, { text: "保留其他会话" });
    editor.startComposerEdit(scope, { messageId: "test-message", revision: "test-revision" }, { text: "修改中的消息", attachment: null });
  }, { scope, otherScope });
  await assertCleared();
  const preserved = await page.evaluate(async ({ scope, otherScope }) => {
    const path = "/drafts.ts", edit = "/chat/composer-edit.ts";
    const ordinary = await import(/* @vite-ignore */ path), editor = await import(/* @vite-ignore */ edit);
    const result = { ordinary: ordinary.getDraft(scope).text, other: ordinary.getDraft(otherScope).text, editing: !!editor.getComposerEdit(scope) };
    editor.cancelComposerEdit(scope);
    return result;
  }, { scope, otherScope });
  assert.deepEqual(preserved, { ordinary: "保留普通草稿", other: "保留其他会话", editing: true });
  await assertCleared();

  async function geometry(page: Page) {
    return page.locator("#prompt").evaluate((node) => ({ height: node.getBoundingClientRect().height, width: node.clientWidth, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, maxHeight: parseFloat(getComputedStyle(node).maxHeight) }));
  }
  for (const [width, height] of [[320, 800], [360, 800], [390, 844], [430, 932], [390, 320], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await input.fill("短");
    await page.waitForTimeout(100);
    const short = await geometry(page);
    await input.fill("这是需要真正自动换行的长文本。".repeat(12));
    await page.waitForTimeout(100);
    const long = await geometry(page);
    assert.ok(long.height > short.height, `input grows at ${width}x${height}: ${JSON.stringify({ short, long })}`);
    assert.ok(long.scrollWidth <= long.width + 1, "wrapped prose never scrolls horizontally");
    assert.ok(long.height <= long.maxHeight + 1, "growth is capped");
    await input.fill("https://example.com/" + "unbroken".repeat(60));
    const token = await geometry(page);
    assert.ok(token.scrollWidth <= token.width + 1, "unbroken text wraps too");
    await input.fill("第一行\n第二行\n第三行");
    await page.waitForTimeout(60);
    assert.ok((await geometry(page)).height > short.height, "explicit newline grows input too");
    const button = await clear.boundingBox(), form = await page.locator(".composer").boundingBox();
    assert.ok(button && form && button.y + button.height <= form.y + 1, "clear lives above input, not inside its text column");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `${width}x${height}.png`) });
    await assertCleared();
    await page.waitForTimeout(60);
    assert.equal((await geometry(page)).height, short.height, "clearing collapses input");
  }
  await page.reload();
  await input.waitFor();
  await page.waitForTimeout(200);
  assert.equal(await input.inputValue(), "", "cleared draft stays empty after reload");
  assert.equal(await clear.count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ["conditional clear", "whitespace", "all draft resources", "resource-only drafts", "edit and scope isolation", "focus restoration", "six viewport wrapping/growth/collapse", "unbroken text", "explicit newlines", "reload"], artifacts }));
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
