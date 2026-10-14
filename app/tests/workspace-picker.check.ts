import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";

// The native dialog is mocked at HTTP; workspace creation uses the real service.
const root = mkdtempSync(join(tmpdir(), "axiom-folder-ui-"));
const first = join(root, "中文项目 空格"), second = join(root, "另一个项目");
mkdirSync(first);
mkdirSync(second);
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let selected: string | null = null, failure = false, calls = 0;
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  await page.route("**/api/workspace/pick-folder", async (route) => {
    calls++;
    assert.equal(route.request().method(), "POST");
    await hold;
    await route.fulfill({
      status: failure ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(failure ? { error: "无法打开系统文件夹选择器" } : { path: selected }),
    });
  });
  await page.goto(app.origin);
  const add = page.locator("#add-workspace");
  const open = async () => {
    await page.locator("#workspace-picker > summary").click();
    await add.click();
  };
  const dialog = page.getByRole("dialog", { name: "打开工作空间" });
  const settled = () => page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#add-workspace")?.disabled === false);
  const opened = async (path: string) => {
    await settled();
    await page.waitForFunction((value) => document.querySelector("#title-path")?.textContent === value, path);
    assert.equal(await dialog.count(), 0, "selecting a folder opens it without an authorization dialog");
    const workspace = app.store.workspaces().find((w) => w.path === path)!;
    assert.ok(workspace);
    assert.equal(workspace.authorized, true);
    assert.ok(app.store.sessions(workspace.id).length > 0);
    return workspace;
  };

  // Cancellation leaves the application empty.
  await Promise.all([page.waitForResponse("**/api/workspace/pick-folder"), open()]);
  await settled();
  assert.equal(await dialog.count(), 0);
  assert.equal(app.store.workspaces().length, 0);

  selected = first;
  hold = new Promise<void>((resolve) => { release = resolve; });
  await open();
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#add-workspace")?.disabled);
  assert.equal(await dialog.count(), 0);
  assert.equal(app.store.workspaces().length, 0, "pending selection must not create a workspace");
  assert.equal(calls, 2);
  release!();
  hold = undefined;
  const workspace = await opened(first);
  assert.equal(app.store.workspaces().length, 1);
  assert.equal(app.store.sessions(workspace.id).length, 1);

  // Cancelling from an existing workspace preserves its session.
  const previousView = await page.evaluate(() => sessionStorage.getItem("view"));
  selected = null;
  await Promise.all([page.waitForResponse("**/api/workspace/pick-folder"), open()]);
  await settled();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("view")), previousView);
  assert.equal(app.store.sessions(workspace.id).length, 1);

  // Picker and open-command failures remain visible and allow another attempt.
  failure = true;
  await open();
  await page.locator(".execution-alert").filter({ hasText: "无法打开系统文件夹选择器" }).waitFor();
  await settled();
  assert.equal(await dialog.count(), 0);
  failure = false;
  selected = join(root, "missing");
  await open();
  await page.locator(".execution-alert").filter({ hasText: "目录不存在或无法访问" }).waitFor();
  await settled();
  assert.equal(app.store.workspaces().length, 1);

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.locator("#toggle-history").click();
    selected = width === 390 ? second : first;
    await Promise.all([page.waitForResponse("**/api/workspace/pick-folder"), open()]);
    await opened(selected);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(app.store.workspaces().length, 2, "reopening preserves workspace identity");
  }
  assert.deepEqual(errors, []);
  console.log("workspace picker UI: automatic authorization, cancellation, busy state, open errors, retry and responsive layout passed");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
