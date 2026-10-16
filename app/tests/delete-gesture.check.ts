import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-delete-gesture-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, workspaceId?: string, sessionId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId, sessionId });
  const create = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    writeFileSync(join(path, "keep.txt"), "preserve");
    const w = run("workspace.open", { path, authorized: true }) as Workspace;
    const s = run("session.create", {}, w.id) as Session;
    run("session.rename", { title: name }, w.id, s.id);
    return { w, s };
  };
  const a = create("跨空间目标"), b = create("当前空间");
  const preserved = run("session.create", {}, a.w.id) as Session;
  run("session.pin", { pinned: true }, a.w.id, a.s.id);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [], nativeDialogs: string[] = [], requests: Command[] = [];
  let release: (() => void) | undefined, releaseRename: (() => void) | undefined;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => {
      const command = JSON.parse(message.toString()) as Command;
      if (command.op.endsWith(".delete") || command.op === "configuration.save") requests.push(command);
      if (command.op === "session.rename") {
        releaseRename = () => server.send(message);
        return;
      }
      if (command.op === "session.delete" && requests.filter((item) => item.op === "session.delete").length === 1) {
        release = () => route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
          error: { code: "TEST_FAILURE", message: "双击删除失败，请重试" } }));
      } else server.send(message);
    });
    server.onMessage((message) => route.send(message));
  });
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)),
    { workspaceId: b.w.id, sessionId: b.s.id });
  await page.goto(app.origin);
  const row = page.locator(`[data-session-id="${a.s.id}"]`);
  const trigger = row.getByRole("button", { name: `删除会话：${a.w.name}`, exact: true });
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true });
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  const prompt = page.locator("#prompt");
  await prompt.fill("保留当前空间的草稿");
  await row.hover();
  assert.match(await trigger.getAttribute("data-tooltip") || "", /双击直接删除/);
  await trigger.click();
  await dialog.waitFor();
  assert.equal(requests.length, 0, "single click only requests confirmation");
  assert.equal(await cancel.evaluate((el) => el === document.activeElement), true);
  await cancel.click();
  await dialog.waitFor({ state: "detached" });
  for (const key of ["Enter", "Space"]) {
    await trigger.focus();
    await trigger.press(key);
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  }
  await row.locator("button.history-item").press("Delete");
  await dialog.waitFor();
  await cancel.click();
  assert.equal(requests.length, 0, "keyboard deletion retains confirmation");

  // A subscription update cannot remove the trigger during the click window.
  await trigger.click();
  run("session.pin", { pinned: false }, a.w.id, a.s.id);
  app.agents.publish(`sessions:${a.w.id}`);
  await dialog.waitFor();
  assert.equal(await row.count(), 1, "the foreign row stays mounted through confirmation");
  await cancel.click();
  await row.waitFor({ state: "detached" });
  run("session.pin", { pinned: true }, a.w.id, a.s.id);
  app.agents.publish(`sessions:${a.w.id}`);
  await row.waitFor();

  // Leaving the trigger or unmounting its row cancels the pending single click.
  await row.hover();
  await trigger.click();
  await prompt.focus();
  await page.waitForTimeout(600);
  assert.equal(await dialog.count(), 0);
  await trigger.click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  assert.equal(await dialog.count(), 0);
  await trigger.click();
  await page.getByRole("searchbox", { name: "搜索置顶和当前空间的会话" }).fill("不存在的目标");
  await row.waitFor({ state: "detached" });
  await page.waitForTimeout(600);
  assert.equal(await dialog.count(), 0);
  await page.getByRole("searchbox", { name: "搜索置顶和当前空间的会话" }).fill("");

  // A window can blur while its button remains the document's activeElement.
  await row.hover();
  await trigger.click();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  run("session.pin", { pinned: false }, a.w.id, a.s.id);
  app.agents.publish(`sessions:${a.w.id}`);
  await row.waitFor({ state: "detached" });
  await page.waitForTimeout(600);
  assert.equal(await dialog.count(), 0, "window blur cancels the timer and releases the held row");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  run("session.pin", { pinned: true }, a.w.id, a.s.id);
  app.agents.publish(`sessions:${a.w.id}`);
  await row.hover();
  await trigger.click();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
  assert.equal(await dialog.count(), 0, "returning to the tab does not revive its cancelled confirmation");

  // A slow rename keeps editing controls mounted and deletion inaccessible.
  const localRow = page.locator(`[data-session-id="${b.s.id}"]`);
  await localRow.locator("button.history-item").press("F2");
  const editor = page.getByRole("textbox", { name: "会话标题", exact: true });
  await editor.fill("迟到改名");
  await prompt.focus();
  await page.locator('.session-title-input[aria-busy="true"]').waitFor();
  assert.equal(await editor.evaluate((el) => (el as HTMLInputElement).readOnly), true);
  assert.equal(await localRow.locator(".session-actions").isVisible(), false);
  run("session.pin", { pinned: true }, b.w.id, b.s.id);
  app.agents.publish(`sessions:${b.w.id}`);
  await localRow.getByRole("button", { name: /^取消置顶：/, includeHidden: true }).waitFor({ state: "attached" });
  assert.equal(await page.getByRole("region", { name: "当前空间对话", exact: true }).locator(`[data-session-id="${b.s.id}"]`).count(), 1);
  assert.equal(await localRow.locator(".session-delete").isVisible(), false, "saving cannot overlap a real delete gesture");
  assert.ok(releaseRename);
  releaseRename();
  await editor.waitFor({ state: "detached" });
  await page.getByRole("region", { name: "置顶会话", exact: true }).locator(`[data-session-id="${b.s.id}"]`).waitFor();
  assert.equal(await localRow.count(), 1);
  run("session.pin", { pinned: false }, b.w.id, b.s.id);
  app.agents.publish(`sessions:${b.w.id}`);
  await page.getByRole("region", { name: "当前空间对话", exact: true }).locator(`[data-session-id="${b.s.id}"]`).waitFor();
  assert.equal(requests.length, 0);

  await row.hover();
  await trigger.dblclick({ delay: 100 });
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>(".session-delete:disabled") !== null);
  assert.equal(requests.length, 1, "double click sends one deletion");
  await trigger.dispatchEvent("dblclick");
  await page.waitForTimeout(600);
  assert.equal(requests.length, 1, "pending deletion cannot be submitted twice");
  assert.equal(await dialog.count(), 0, "double click never opens the delayed confirmation");
  assert.ok(release);
  release();
  await page.getByRole("alert").filter({ hasText: "双击删除失败，请重试" }).waitFor();
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>(".session-delete:disabled"));
  assert.equal(app.store.session(a.w.id, a.s.id).id, a.s.id);
  await trigger.dblclick();
  await row.waitFor({ state: "detached" });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((c) => c.op === "session.delete" && c.workspaceId === a.w.id &&
    c.sessionId === a.s.id && c.params?.confirmed === true), "deletion uses the foreign session's owner");
  assert.equal(await page.locator("#workspace-picker summary strong").textContent(), b.w.name);
  assert.equal(await prompt.inputValue(), "保留当前空间的草稿");
  assert.equal(app.store.session(b.w.id, b.s.id).id, b.s.id);
  assert.equal(existsSync(join(a.w.path, "keep.txt")), true);

  // Workspaces retain server-side activity checks, files, and session history.
  const busyRun = crypto.randomUUID();
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running','{}',1)").run(busyRun, preserved.id);
  await page.locator("#workspace-picker summary").click();
  const workspaceRow = page.locator(".workspace-row").filter({ has: page.getByRole("button", { name: a.w.name, exact: true }) });
  const workspaceDelete = workspaceRow.getByRole("button", { name: `删除工作空间：${a.w.name}`, exact: true });
  await workspaceRow.hover();
  await workspaceDelete.dblclick();
  await page.getByRole("alert").filter({ hasText: "请先停止再移除" }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(app.store.workspaces().length, 2);
  app.store.db.prepare("UPDATE runs SET status='completed',endedAt=2 WHERE id=?").run(busyRun);
  await workspaceDelete.dblclick();
  await workspaceRow.waitFor({ state: "detached" });
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(app.store.workspaces().length, 1);
  assert.equal(existsSync(join(a.w.path, "keep.txt")), true);
  assert.ok(app.store.db.prepare("SELECT id FROM sessions WHERE id=?").get(preserved.id));
  const workspaceRequests = requests.filter((item) => item.op === "workspace.delete");
  assert.equal(workspaceRequests.length, 2);
  assert.ok(workspaceRequests.every((c) => c.workspaceId === a.w.id && c.params?.confirmed === true));
  assert.equal(await page.locator("#workspace-picker summary strong").textContent(), b.w.name);

  // The same gesture removes only the targeted model draft, without publishing.
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#models-tab").click();
  for (const id of ["gesture-one", "gesture-two"]) {
    await page.locator("#add-model").click();
    await page.locator("#new-model-id").fill(id);
    await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  }
  const firstModel = page.getByRole("button", { name: "删除模型：gesture-one", exact: true });
  await firstModel.locator("xpath=ancestor::tr").hover();
  await firstModel.click();
  const modelDialog = page.getByRole("dialog", { name: "删除模型草稿？", exact: true });
  await modelDialog.waitFor();
  await modelDialog.getByRole("button", { name: "取消", exact: true }).click();
  await firstModel.locator("xpath=ancestor::tr").hover();
  await page.getByRole("button", { name: "编辑模型：gesture-one", exact: true }).click();
  await page.locator("#model-editor").waitFor();
  await firstModel.dblclick();
  await firstModel.waitFor({ state: "detached" });
  await page.waitForTimeout(600);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator("#model-editor").count(), 0);
  assert.equal(await page.getByRole("button", { name: "删除模型：gesture-two", exact: true }).count(), 1);
  assert.equal(requests.filter((item) => item.op === "configuration.save").length, 0);
  assert.match(await page.locator(".save-state").innerText(), /有未保存修改/);
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(errors, []);
  console.log("PASS: single/keyboard confirmation, element/window blur/hidden/Escape/unmount cancellation, delayed rename isolation, direct double-click deletion, pending deduplication, failure/retry, cross-workspace ownership, activity rejection, file/history preservation, and model draft isolation");
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
