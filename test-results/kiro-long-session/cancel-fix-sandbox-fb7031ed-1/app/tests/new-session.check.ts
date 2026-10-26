import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { startServer as startSourceServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-new-session-ui-"));
mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const buildRoot = process.env.AXIOM_TEST_BUILD_ROOT;
const startServer: typeof startSourceServer = buildRoot
  ? (await import(pathToFileURL(resolve(buildRoot, "server/index.js")).href)).startServer
  : startSourceServer;
const app = await startServer({ root, port: 0, dev: !buildRoot });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const old = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  app.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: old.id, params: { title: "已有会话" } });
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const errors: string[] = [];
  for (const page of pages) {
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), { workspaceId: workspace.id, sessionId: old.id });
    await page.goto(app.origin);
    await page.locator("#prompt").waitFor();
  }
  // Actual simultaneous clients and synchronous click bursts, before receipts render.
  await Promise.all(pages.map(page => page.evaluate(() => {
    for (let i = 0; i < 20; i++) document.querySelector<HTMLButtonElement>("#new-chat")!.click();
  })));
  for (const page of pages) await page.waitForFunction(oldId => JSON.parse(sessionStorage.getItem("view")!).sessionId !== oldId, old.id);
  const [first, second] = await Promise.all(pages.map(page => page.evaluate(() => JSON.parse(sessionStorage.getItem("view")!).sessionId)));
  assert.equal(first, second);
  assert.equal(app.store.sessions(workspace.id).length, 2);
  const page = pages[0];
  await page.locator("#prompt").fill("新会话草稿应当保留");
  await page.locator("#new-chat").click();
  await page.keyboard.press("Control+k");
  assert.equal(await page.locator("#prompt").inputValue(), "新会话草稿应当保留");
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("view")!).sessionId), first);
  await page.locator(`[data-session-id="${old.id}"] button.history-item`).click();
  await page.waitForFunction(oldId => JSON.parse(sessionStorage.getItem("view")!).sessionId === oldId, old.id);
  await page.locator("#new-chat").click();
  await page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view")!).sessionId === id, first);
  assert.equal(await page.locator("#prompt").inputValue(), "新会话草稿应当保留");
  await page.reload();
  await page.locator("#prompt").waitFor();
  await page.locator("#new-chat").click();
  await page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view")!).sessionId === id, first);
  assert.equal(app.store.sessions(workspace.id).length, 2);
  assert.equal(app.store.db.prepare("SELECT COUNT(*) AS count FROM runs").get()?.count, 0);
  // A real new session must open the first toolbar icon before any model call.
  const memoryToggle = page.getByRole("button", { name: "上下文与会话记忆", exact: true });
  assert.equal(await memoryToggle.isEnabled(), true);
  await memoryToggle.click();
  const memoryPanel = page.getByRole("dialog", { name: "上下文与会话记忆", exact: true });
  await memoryPanel.getByText("还没有任务记录", { exact: true }).waitFor();
  assert.equal(await memoryToggle.getAttribute("aria-expanded"), "true");
  const scope = { workspaceId: workspace.id, sessionId: first };
  writeFileSync(join(memoryDirectory(root, first), "MEMORY.md"), "# 新会话入口验证\n\n## [进行中] 新会话任务\n");
  await app.agents.memories.scanAsync(scope);
  await memoryPanel.locator(".memory-task-title").filter({ hasText: "新会话任务" }).waitFor();
  assert.ok(await memoryPanel.locator('svg.memory-state-icon[data-state="进行中"] animateTransform').count());
  await memoryPanel.getByRole("button", { name: "关闭统计详情", exact: true }).click();
  assert.equal(await memoryToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#prompt").inputValue(), "新会话草稿应当保留");
  assert.equal(app.store.db.prepare("SELECT COUNT(*) AS count FROM runs").get()?.count, 0);
  assert.deepEqual(errors, []);
  console.log(`PASS (${buildRoot ? "compiled production" : "source dev"}): rapid clicks and two viewers share one new session; button and shortcut reuse; navigation back, draft preservation and refresh; context-memory icon opens before first prompt, empty state and live chapter tree; no Agent run`);
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
