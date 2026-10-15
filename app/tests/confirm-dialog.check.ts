import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-confirm-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const project = join(root, "project");
  mkdirSync(project);
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: {} }) as Session;
  const title = "待删除的会话 · 保留项目文件";
  app.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [], nativeDialogs: string[] = [], requests: Command[] = [];
  let release: (() => void) | undefined;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => {
      const command = JSON.parse(message.toString()) as Command;
      if (command.op !== "session.delete") { server.send(message); return; }
      requests.push(command);
      if (requests.length === 1) {
        release = () => route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
          error: { code: "TEST_FAILURE", message: "测试删除失败，请重试" } }));
      } else server.send(message);
    });
    server.onMessage((message) => route.send(message));
  });
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), { workspaceId: workspace.id, sessionId: session.id });
  await page.goto(app.origin);
  const row = page.locator(".history-row").filter({ has: page.getByRole("button", { name: `删除会话：${title}`, exact: true }) });
  const trigger = row.getByRole("button", { name: `删除会话：${title}`, exact: true });
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true });
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  const accept = dialog.getByRole("button", { name: "删除会话", exact: true });
  await row.hover();
  await trigger.click();
  await dialog.waitFor();
  assert.equal(await cancel.evaluate((el) => el === document.activeElement), true);
  assert.ok((await dialog.innerText()).includes(title), "confirmation identifies the session being deleted");
  assert.match(await dialog.innerText(), /停止所属任务，不删除项目文件/);
  assert.equal(await dialog.evaluate((el) => el.matches(":modal")), true);
  assert.ok(await dialog.getAttribute("aria-describedby"));
  await page.keyboard.press("Tab");
  assert.equal(await accept.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  // Some engines cycle through the document focus sentinel before returning.
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  assert.equal(requests.length, 0);
  await trigger.click();
  await cancel.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requests.length, 0);

  await trigger.click();
  await dialog.waitFor();
  for (const [width, height] of [[360, 800], [390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "no horizontal dialog overflow");
    assert.equal(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(25, 26, 27)");
  }
  mkdirSync(resolve("test-results"), { recursive: true });
  await page.screenshot({ path: resolve("test-results/confirm-dialog.png") });
  await accept.click();
  await dialog.getByRole("button", { name: "处理中…" }).waitFor();
  await dialog.getByRole("button", { name: "处理中…" }).dispatchEvent("click");
  await page.keyboard.press("Escape");
  await cancel.dispatchEvent("click");
  assert.equal(await dialog.isVisible(), true, "pending confirmation stays modal");
  assert.equal(requests.length, 1, "double click sends only one request");
  assert.equal(app.store.session(workspace.id, session.id).title, title, "pending confirmation has not deleted the session");
  assert.ok(release);
  release();
  await dialog.getByRole("alert").waitFor();
  assert.match(await dialog.getByRole("alert").innerText(), /测试删除失败/);
  assert.equal(app.store.session(workspace.id, session.id).title, title, "failed deletion retains the session for retry");
  await accept.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(requests.length, 2);
  assert.equal(app.store.sessions(workspace.id).length, 0, "retry deletes the target session");
  assert.ok(requests.every((c) => c.workspaceId === workspace.id && c.sessionId === session.id && c.params?.confirmed === true));
  assert.deepEqual(errors, []);
  assert.deepEqual(nativeDialogs, []);
  console.log("PASS: styled confirmation, safe initial focus, keyboard/cancel, responsive bounds, pending deduplication, inline failure/retry, owner-scoped session deletion");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
