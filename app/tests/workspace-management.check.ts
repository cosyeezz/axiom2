import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-workspace-ui-"));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, workspaceId?: string) => app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId });
  const create = (name: string) => {
    const path = join(root, name); mkdirSync(path); writeFileSync(join(path, "keep.txt"), "preserve");
    const w = run("workspace.open", { path, authorized: true }) as Workspace;
    const s = run("session.create", {}, w.id) as Session;
    return { w, s };
  };
  const a = create("工作空间甲"), b = create("工作空间乙");
  run("workspace.select", {}, b.w.id);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  const browserDialogs: string[] = [];
  const watchPage = (p: Page) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", async (dialog) => {
      browserDialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });
  };
  const page = await context.newPage();
  watchPage(page);
  const deletionDialog = (p: Page) => p.getByRole("dialog", { name: "删除工作空间", exact: true });
  const checkDeletionDialog = async (p: Page, name: string) => {
    assert.deepEqual(browserDialogs, [], "workspace deletion must not use browser dialogs");
    const confirmation = deletionDialog(p);
    await confirmation.waitFor();
    assert.ok((await confirmation.innerText()).includes(name), "confirmation identifies the workspace");
    assert.match(await confirmation.innerText(), /仅从列表移出，保留项目文件和会话历史/);
    assert.match(await confirmation.innerText(), /正在运行的 Agent 或任务需先停止/);
    assert.match(await confirmation.innerText(), /再次打开同一目录可恢复/);
    const cancel = confirmation.getByRole("button", { name: "取消", exact: true });
    assert.equal(await cancel.evaluate((el) => el === document.activeElement), true, "cancel receives default focus");
    assert.equal(await confirmation.evaluate((el) => el.matches(":modal")), true, "confirmation uses native modal focus isolation");
    await p.keyboard.press("Tab");
    assert.equal(await confirmation.getByRole("button", { name: "删除工作空间", exact: true }).evaluate((el) => el === document.activeElement), true);
    await p.keyboard.press("Shift+Tab");
    assert.equal(await cancel.evaluate((el) => el === document.activeElement), true);
    return confirmation;
  };
  const expectWorkspace = async (p: Page, name: string) => p.waitForFunction((n) => document.querySelector("#workspace-picker summary strong")?.textContent === n, name);
  const menu = async (p: Page) => {
    if (!(await p.locator("#workspace-picker").evaluate((el) => (el as HTMLDetailsElement).open)))
      await p.locator("#workspace-picker summary").click();
  };
  await page.goto(app.origin);
  await expectWorkspace(page, b.w.name);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("view")!).workspaceId), b.w.id);
  await menu(page);
  const row = page.locator(".workspace-row").filter({ has: page.getByRole("button", { name: a.w.name, exact: true }) });
  await page.mouse.move(1000, 700);
  const geometry = () => row.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const actions = el.querySelector<HTMLElement>(".workspace-actions")!;
    const style = getComputedStyle(actions);
    return { x: box.x, y: box.y, width: box.width, height: box.height, opacity: style.opacity, pointerEvents: style.pointerEvents };
  });
  const hidden = await geometry();
  assert.equal(hidden.opacity, "0");
  assert.equal(hidden.pointerEvents, "none");
  await row.hover();
  const hovered = await geometry();
  assert.equal(hovered.opacity, "1");
  assert.deepEqual([hovered.x, hovered.y, hovered.width, hovered.height], [hidden.x, hidden.y, hidden.width, hidden.height]);
  assert.equal(await row.locator(".workspace-option .workspace-actions").count(), 0, "no nested action buttons");
  const input = page.getByRole("textbox", { name: "工作空间名称", exact: true });
  assert.equal(await page.locator(".workspace-rename").count(), 0, "no pencil rename button");
  assert.equal(await row.locator(".workspace-pin, .workspace-delete").count(), 2, "pin and delete alongside existing path actions");
  await row.getByRole("button", { name: a.w.name, exact: true }).locator("strong").dblclick();
  await input.fill("中文重命名");
  await input.dispatchEvent("compositionstart");
  await input.press("Enter");
  assert.equal(app.store.workspace(a.w.id).name, a.w.name, "IME Enter does not save");
  await input.dispatchEvent("compositionend");
  await input.press("Enter");
  await input.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector('.workspace-row[aria-busy="true"]') === null);
  assert.equal(app.store.workspace(a.w.id).name, "中文重命名");
  await expectWorkspace(page, b.w.name);

  const renamed = page.locator(".workspace-row").filter({ has: page.getByRole("button", { name: "中文重命名", exact: true }) });
  await renamed.hover();
  await renamed.getByRole("button", { name: "置顶工作空间：中文重命名", exact: true }).click();
  await renamed.getByRole("button", { name: "取消置顶工作空间：中文重命名", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.workspace-row[aria-busy="true"]') === null);
  assert.equal(await page.locator(".workspace-list .workspace-option strong").first().textContent(), "中文重命名");
  assert.equal(app.store.workspace(a.w.id).pinned, true);
  await expectWorkspace(page, b.w.name);
  const option = renamed.locator("button.workspace-option");
  await option.focus(); await option.press("F2");
  await input.fill("取消名字"); await input.press("Escape");
  assert.equal(app.store.workspace(a.w.id).name, "中文重命名");
  assert.equal(await page.locator("#workspace-picker").evaluate((el) => (el as HTMLDetailsElement).open), true, "Escape cancels edit, not menu");

  await option.locator("strong").click();
  await expectWorkspace(page, "中文重命名");
  await page.waitForTimeout(100);
  // Entirely new browser storage, like a new Pake webview, restores service preference.
  const fresh = await browser.newContext();
  const newWindow = await fresh.newPage();
  watchPage(newWindow);
  await newWindow.goto(app.origin);
  await expectWorkspace(newWindow, "中文重命名");
  await menu(newWindow);
  await newWindow.getByRole("button", { name: b.w.name, exact: true }).locator("strong").click();
  await expectWorkspace(newWindow, b.w.name);
  await expectWorkspace(page, "中文重命名"); // preference broadcast must not navigate open viewers
  await page.reload();
  await expectWorkspace(page, "中文重命名"); // same-window scope beats preference from another viewer

  await menu(page);
  const remove = renamed.getByRole("button", { name: "删除工作空间：中文重命名", exact: true });
  for (const action of ["escape", "cancel"]) {
    await renamed.hover();
    await remove.click();
    const confirmation = await checkDeletionDialog(page, "中文重命名");
    if (action === "escape") await page.keyboard.press("Escape");
    else await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(app.store.workspaces().length, 2);
    assert.equal(await remove.evaluate((el) => el === document.activeElement), true, "cancel restores focus to delete trigger");
    assert.equal(await page.locator("#workspace-picker").evaluate((el) => (el as HTMLDetailsElement).open), true, "cancelling confirmation does not close workspace menu");
    await expectWorkspace(page, "中文重命名");
  }
  // Confirmed removal closes immediately; rejection restores the workspace and
  // reports outside the closed dialog. A fresh confirmation is safe to retry.
  const busyRun = crypto.randomUUID();
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running','{}',1)").run(busyRun, a.s.id);
  await remove.click();
  const rejected = await checkDeletionDialog(page, "中文重命名");
  await rejected.getByRole("button", { name: "删除工作空间", exact: true }).click();
  await rejected.waitFor({ state: "hidden" });
  await page.getByRole("alert").filter({ hasText: "请先停止再移除" }).first().waitFor();
  assert.equal(app.store.workspaces().length, 2);
  await expectWorkspace(page, "中文重命名");
  await page.getByRole("button", { name: "关闭错误提示", exact: true }).click();
  app.store.db.prepare("UPDATE runs SET status='completed',endedAt=2 WHERE id=?").run(busyRun);
  await menu(page); await renamed.hover(); await remove.click();
  await checkDeletionDialog(page, "中文重命名");
  await deletionDialog(page).getByRole("button", { name: "删除工作空间", exact: true }).click();
  await deletionDialog(page).waitFor({ state: "hidden" });
  await expectWorkspace(page, b.w.name);
  assert.equal(app.store.workspaces().length, 1);
  assert.equal(existsSync(join(a.w.path, "keep.txt")), true);
  assert.ok(app.store.db.prepare("SELECT id FROM sessions WHERE id=?").get(a.s.id), "remove preserves history");

  // Reopen the same directory through actual WS open: recover original identity and history.
  await page.route("**/api/workspace/pick-folder", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ path: a.w.path }) }));
  await menu(page); await page.locator("#add-workspace").click();
  await expectWorkspace(page, "中文重命名");
  assert.equal(await page.getByRole("dialog", { name: "打开工作空间" }).count(), 0);
  assert.equal(app.store.workspace(a.w.id).authorized, true);
  assert.equal(app.store.workspace(a.w.id).pinned, true);
  assert.ok(app.store.sessions(a.w.id).some((s) => s.id === a.s.id));
  await page.unroute("**/api/workspace/pick-folder");
  await page.route("**/api/workspace/pick-folder", (route) => route.fulfill({ status: 404, body: "" }));
  await menu(page); await page.locator("#add-workspace").click();
  await page.getByRole("alert").filter({ hasText: "请重启 Axiom2 本地服务" }).waitFor();
  assert.equal(await page.getByText("Unexpected end of JSON input", { exact: false }).count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggle-history").click();
  await menu(page);
  await renamed.hover();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await remove.click();
  const mobileConfirmation = await checkDeletionDialog(page, "中文重命名");
  const mobileBox = await mobileConfirmation.boundingBox();
  assert.ok(mobileBox && mobileBox.x >= 0 && mobileBox.y >= 0 && mobileBox.x + mobileBox.width <= 391 && mobileBox.y + mobileBox.height <= 845, "mobile confirmation fits viewport");
  assert.equal(await mobileConfirmation.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "mobile confirmation has no horizontal overflow");
  await mobileConfirmation.getByRole("button", { name: "取消", exact: true }).click();
  await mobileConfirmation.waitFor({ state: "hidden" });
  assert.equal(await remove.evaluate((el) => el === document.activeElement), true);
  assert.equal(app.store.workspaces().length, 2, "mobile cancel preserves both workspaces");
  // Removing the final workspace leaves a stable empty state, not stale subscriptions.
  await menu(newWindow);
  const lastRow = newWindow.locator(".workspace-row").filter({ has: newWindow.getByRole("button", { name: b.w.name, exact: true }) });
  await lastRow.hover();
  await lastRow.getByRole("button", { name: `删除工作空间：${b.w.name}`, exact: true }).click();
  await checkDeletionDialog(newWindow, b.w.name);
  await deletionDialog(newWindow).getByRole("button", { name: "删除工作空间", exact: true }).click();
  await deletionDialog(newWindow).waitFor({ state: "hidden" });
  await expectWorkspace(newWindow, "中文重命名");
  await menu(newWindow);
  const finalRow = newWindow.locator(".workspace-row");
  await finalRow.hover();
  await finalRow.getByRole("button", { name: "删除工作空间：中文重命名", exact: true }).click();
  await checkDeletionDialog(newWindow, "中文重命名");
  await deletionDialog(newWindow).getByRole("button", { name: "删除工作空间", exact: true }).click();
  await deletionDialog(newWindow).waitFor({ state: "hidden" });
  await expectWorkspace(newWindow, "选择工作空间");
  await expectWorkspace(page, "选择工作空间");
  assert.equal(app.store.workspaces().length, 0);
  await fresh.close();
  await context.close();
  assert.deepEqual(browserDialogs, [], "no browser dialogs in either viewer");
  assert.deepEqual(errors, []);
  console.log("workspace management UI: rename/IME, pin, in-app Escape/cancel/delete/reopen, default/returned focus, keyboard navigation, busy rejection with immediate close/rollback/fresh retry, fresh-window restore, viewer isolation, old-service error and mobile confirmation without browser dialogs passed");
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
}
