import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-deleted-ui-"));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, workspaceId?: string, sessionId?: string, params = {}) => app.store.execute({ op, workspaceId, sessionId, params, requestId: crypto.randomUUID() });
  const path = join(root, "原工作空间"); mkdirSync(path);
  const w = run("workspace.open", undefined, undefined, { path, authorized: true }) as Workspace;
  const create = (title: string, time: number) => {
    const s = run("session.create", w.id) as Session;
    run("session.rename", w.id, s.id, { title });
    app.store.db.prepare("UPDATE sessions SET updatedAt=? WHERE id=?").run(time, s.id);
    return s;
  };
  const first = create("当前会话", 300), target = create("恢复到中间", 200), last = create("较早会话", 100);
  const deletedIds = [];
  for (let i = 0; i < 65; i++) {
    const s = create(i === 0 ? "末尾检索目标" : `已删除标题 ${i}`, i);
    deletedIds.push(s.id);
    run("session.delete", w.id, s.id, { confirmed: true });
    app.store.db.prepare("UPDATE sessions SET deletedAt=? WHERE id=?").run(1000 + i, s.id);
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [], sent: any[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => sent.push(JSON.parse(payload.toString()))));
  await page.addInitScript((scope) => { sessionStorage.setItem("view", JSON.stringify(scope)); }, { workspaceId: w.id, sessionId: first.id });
  await page.goto(app.origin);
  await page.locator(`[data-session-id="${target.id}"]`).waitFor();
  const toggle = page.getByRole("button", { name: "已删除会话", exact: true });
  const queue = page.getByRole("region", { name: "已删除会话", exact: true });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.locator("svg").count(), 1, "heading keeps the trash icon without an expansion arrow");
  assert.equal(sent.filter((message) => message.op === "deleted-sessions.list").length, 0, "collapsed queue performs no page reads");
  const order = () => page.locator('[aria-label="当前空间对话"] .history-row').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-session-id")));
  assert.deepEqual(await order(), [first.id, target.id, last.id]);
  const targetRow = page.locator(`[data-session-id="${target.id}"]`);
  await targetRow.hover();
  await targetRow.getByRole("button", { name: "删除会话：恢复到中间", exact: true }).click();
  await page.getByRole("dialog", { name: "删除会话", exact: true }).getByRole("button", { name: "删除会话", exact: true }).click();
  await targetRow.waitFor({ state: "detached" });
  await toggle.click();
  const rows = queue.locator(".deleted-session-row");
  await queue.getByText("恢复到中间", { exact: true }).waitFor();
  assert.equal(await rows.count(), 30);
  assert.equal(await queue.locator("a").count(), 0);
  assert.equal(await queue.locator(".history-item").count(), 0);
  const before = sent.length;
  await queue.getByText("恢复到中间", { exact: true }).click();
  assert.equal(await page.locator("#chat-title").textContent(), "当前会话");
  assert.equal(sent.slice(before).some((message) => message.op === "subscribe" && /^(session|messages|thread):/.test(message.params?.scope ?? "")), false, "clicking display text never opens content");
  await queue.getByRole("button", { name: "恢复会话：恢复到中间", exact: true }).click();
  await page.locator(`[data-session-id="${target.id}"]`).waitFor();
  assert.deepEqual(await order(), [first.id, target.id, last.id]);
  assert.equal(await page.locator("#chat-title").textContent(), "当前会话", "restore does not navigate away");
  await page.waitForFunction(() => document.querySelectorAll(".deleted-session-row").length === 30);
  await queue.locator(".deleted-session-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll(".deleted-session-row").length === 60);
  await queue.locator(".deleted-session-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll(".deleted-session-row").length === 65);
  assert.ok(sent.some((message) => message.op === "deleted-sessions.list" && message.params.cursor), "scroll fetches the next server page");
  assert.equal(await rows.evaluateAll((elements) => new Set(elements.map((element) => element.getAttribute("data-deleted-session-id"))).size), 65);
  const search = queue.getByRole("searchbox", { name: "搜索已删除会话" });
  await search.fill("末尾检索");
  await page.waitForFunction(() => document.querySelectorAll(".deleted-session-row").length === 1);
  assert.equal(await rows.locator("strong").textContent(), "末尾检索目标");
  await search.fill("完全没有匹配的文字");
  await queue.getByText("没有匹配的已删除会话", { exact: true }).waitFor();
  await search.fill("");
  await page.waitForFunction(() => document.querySelectorAll(".deleted-session-row").length === 30);
  const queueBox = await queue.boundingBox(), configBox = await page.locator(".config-entry").boundingBox();
  assert.ok(queueBox && configBox && queueBox.y + queueBox.height <= configBox.y + 1, "queue sits immediately above configuration");
  assert.ok(await queue.locator(".deleted-session-scroll").evaluate((element) => element.scrollHeight > element.clientHeight), "queue has its own bounded scroll area");
  assert.doesNotMatch(await queue.innerText(), /共\s*\d|第\s*\d+\s*页|下一页|上一页|加载更多/);
  await search.focus();
  const focusRing = await search.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
  });
  assert.ok(focusRing.width > 0 && focusRing.offset + focusRing.width <= 0, "search focus ring stays inside the clipped panel");
  await queue.screenshot({ path: "/tmp/axiom-deleted-ui-focus.png" });
  await page.screenshot({ path: "/tmp/axiom-deleted-ui-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggle-history").click();
  await queue.waitFor({ state: "visible" });
  assert.equal(await queue.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, "mobile queue has no horizontal overflow");
  const mobileQueue = await queue.boundingBox(), mobileConfig = await page.locator(".config-entry").boundingBox();
  assert.ok(mobileQueue && mobileConfig && mobileQueue.y + mobileQueue.height <= mobileConfig.y + 1 && mobileConfig.y + mobileConfig.height <= 844);
  await page.screenshot({ path: "/tmp/axiom-deleted-ui-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-expanded"), "false", "queue starts collapsed on reload");
  // A failed notification subscription must not strand the initial read in loading.
  const fallbackPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  fallbackPage.on("pageerror", (error) => errors.push(error.message));
  let failRead = true, dropRead = false, failedSubscriptions = 0, directReads = 0, connections = 0;
  let disconnect: () => Promise<void> = () => { throw new Error("socket has not connected"); };
  await fallbackPage.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    connections++;
    disconnect = () => socket.close({ code: 1012, reason: "reconnect regression" });
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.op === "subscribe" && message.params.scope === "deleted-sessions") {
        failedSubscriptions++;
        socket.send(JSON.stringify({ type: "receipt", requestId: message.requestId, ok: false,
          error: { code: "INVALID_SCOPE", message: "订阅范围无效" } }));
        return;
      }
      if (message.op === "deleted-sessions.list") {
        directReads++;
        if (dropRead) return;
        if (failRead) {
          socket.send(JSON.stringify({ type: "receipt", requestId: message.requestId, ok: false,
            error: { code: "UNKNOWN_OPERATION", message: "不支持的操作" } }));
          return;
        }
      }
      server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  await fallbackPage.goto(app.origin);
  const fallbackToggle = fallbackPage.getByRole("button", { name: "已删除会话", exact: true });
  const fallbackQueue = fallbackPage.getByRole("region", { name: "已删除会话", exact: true });
  await fallbackPage.locator(`[data-session-id="${first.id}"]`).waitFor();
  await fallbackToggle.click();
  await fallbackQueue.getByRole("alert").filter({ hasText: "当前后台尚未支持已删除会话" }).waitFor();
  assert.ok(failedSubscriptions > 0 && directReads > 0, "initial read runs even when subscription is rejected");
  assert.equal(await fallbackQueue.getByRole("status").count(), 0, "unsupported backend ends loading with an actionable error");
  failRead = false;
  await fallbackQueue.getByRole("button", { name: "重试", exact: true }).click();
  await fallbackPage.waitForFunction(() => document.querySelectorAll(".deleted-session-row").length === 30);
  assert.equal(await fallbackQueue.getByRole("alert").count(), 0, "retry works without a revision snapshot");
  const afterDisconnect = create("重连后重新读取", 400);
  run("session.delete", w.id, afterDisconnect.id, { confirmed: true });
  const beforeReconnect = connections;
  await disconnect();
  await fallbackQueue.getByRole("alert").filter({ hasText: "连接恢复后将自动加载" }).waitFor();
  assert.equal(await fallbackQueue.getByRole("status").count(), 0, "disconnection does not leave a loading indicator");
  await fallbackQueue.getByText("重连后重新读取", { exact: true }).waitFor();
  assert.ok(connections > beforeReconnect, "reconnection re-reads the queue without notifications");
  const fallbackSearch = fallbackQueue.getByRole("searchbox", { name: "搜索已删除会话" });
  dropRead = true;
  await fallbackSearch.fill("请求超时测试");
  await fallbackQueue.getByRole("status").waitFor();
  await fallbackQueue.getByRole("alert").filter({ hasText: "请求超时" }).waitFor({ timeout: 20_000 });
  assert.equal(await fallbackQueue.getByRole("status").count(), 0, "a silent server also exits loading after the request deadline");
  dropRead = false;
  await fallbackQueue.getByRole("button", { name: "重试", exact: true }).click();
  await fallbackQueue.getByText("没有匹配的已删除会话", { exact: true }).waitFor();
  await fallbackPage.close();
  assert.deepEqual(errors, []);
  console.log("PASS: default collapse, unchanged delete confirmation, read-only titles, original position restoration, server scroll pagination, full search, empty state, desktop/mobile layout, no expansion arrow, unclipped focus, rejected subscription, old backend error, retry, reconnection and request timeout; screenshots /tmp/axiom-deleted-ui-{desktop,mobile,focus}.png");
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
}
