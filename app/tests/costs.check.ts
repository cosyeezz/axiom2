import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { WebSocket } from "ws";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { agentScope } from "../src/shared/agent.js";
import { tasksScope } from "../src/shared/tasks.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { usageCost } from "../src/server/usage-cost.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-cost-ui-"));
const project = join(root, "project"); mkdirSync(project); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
console.log("cost UI: starting isolated service");
const app = await startServer({ root, port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
console.log("cost UI: service ready");
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const usage = (amount: number) => ({ input: 1000, output: 200, cacheRead: 400, cacheWrite: 100, totalTokens: 1700,
  cost: { input: amount / 2, output: amount / 4, cacheRead: amount / 8, cacheWrite: amount / 8, total: amount } });
const reply = (amount: number) => ({ role: "assistant", content: [{ type: "text", text: "已完成的回复" }], stopReason: "stop", api: "openai-completions", provider: "fixture", model: "fixture-model", usage: usage(amount), timestamp: Date.now() }) as any;
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const parent = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: { title: "费用核算示例" } }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: parent.id };
  app.store.execute({ op: "session.rename", requestId: crypto.randomUUID(), ...scope, params: { title: "费用核算示例" } });
  const manager = SessionManager.create(project, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "计算主任务和子任务费用", timestamp: 1 });
  manager.appendMessage(reply(.1));
  manager.appendMessage({ role: "toolResult", toolName: "vision", toolCallId: "vision-1", content: [], usage: usage(.3), isError: false, timestamp: 2 });
  manager.appendUsage("tool:search", "tool-provider", "search-model", usage(.4));
  manager.appendCompaction("摘要", null, 5000, { axiomCompressionId: "compressed" }, true, usage(.2));
  manager.appendMessage(reply(.05));
  manager.appendMessage(reply(0)); // Unknown pricing must remain visible in the current-session summary too.
  const stored = { input: 1000, output: 200, cacheRead: 400, cacheWrite: 100, total: 1700, cost: .65, context: { tokens: 1000, window: 32000, percent: 3.125 } };
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file,usage) VALUES(?,?,?)").run(parent.id, manager.getSessionFile()!, JSON.stringify(stored));
  const records = new TaskRecords(app.store);
  const { taskIds } = records.create(scope, "fixture", "context", [{ title: "调查数据来源", task: "调查数据来源的完整任务正文，仅供执行使用" }, { title: "检查边界条件", task: "检查边界条件的完整任务正文，仅供执行使用" }], { provider: "fixture", id: "fixture-model", thinking: "off" });
  const childIds = taskIds.map((id) => String(app.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(id)!.sessionId));
  for (const [index, id] of childIds.entries()) {
    const child = SessionManager.create(project, join(root, "children"));
    child.appendMessage({ role: "user", content: "子任务", timestamp: 1 }); child.appendMessage(reply(index ? 0 : .5));
    app.store.db.prepare("UPDATE agent_sessions SET file=? WHERE sessionId=?").run(child.getSessionFile()!, id);
  }
  app.store.db.prepare("UPDATE tasks SET status='completed'").run();
  const job = { id: "compressed", requestId: "compression-request", state: "completed", phase: "done", appliedAt: Date.now(), startedAt: Date.now(), endedAt: Date.now(),
    messageCount: 3, before: 5000, after: 200, summary: "摘要", error: null, selection: { provider: "summary-provider", id: "summary-model" }, usage: { input: 1000, output: 200, total: 1700, cost: .2 }, billing: usageCost(usage(.2)) };
  app.store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(job.id, parent.id, JSON.stringify(job));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors: string[] = [], operations: string[] = [];
  page.setDefaultTimeout(12_000);
  context.on("page", (p) => { p.on("pageerror", (error) => errors.push(error.message)); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => operations.push(JSON.parse(String(payload)).op)));
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    const state = window as any;
    state.__sockets = [];
    state.__costReads = 0; state.__costInFlight = 0; state.__costMaxInFlight = 0; state.__costDelay = 0; state.__costHeld = 0;
    window.WebSocket = class extends Native {
      private costIds = new Set<string>();
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols); state.__sockets.push(this);
        this.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (!this.costIds.has(message.requestId)) return;
          if (event.isTrusted && state.__costDelay) {
            state.__costHeld++;
            event.stopImmediatePropagation();
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: event.data })), state.__costDelay);
            return;
          }
          this.costIds.delete(message.requestId); state.__costInFlight--;
        });
      }
      override send(data: Parameters<InstanceType<typeof Native>["send"]>[0]) {
        if (typeof data === "string") {
          const message = JSON.parse(data);
          if (message.op === "costs.get") {
            this.costIds.add(message.requestId); state.__costReads++; state.__costInFlight++;
            state.__costMaxInFlight = Math.max(state.__costMaxInFlight, state.__costInFlight);
          }
        }
        super.send(data);
      }
    };
  });
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  console.log("cost UI: opening workbench");
  await page.goto(app.origin, { timeout: 15_000 });
  const link = page.getByRole("button", { name: "查看费用明细", exact: true });
  await link.waitFor();
  await page.locator("#prompt").fill("草稿保留在原会话");
  const composerBefore = await page.locator(".composer").boundingBox();
  const originalUrl = page.url();
  await page.waitForFunction(() => document.querySelector('[data-od-id="estimated-cost"]')?.getAttribute('aria-description')?.includes('$1.0500 + 未知'));
  await page.waitForFunction(() => (window as any).__costInFlight === 0);
  assert.ok(operations.includes("costs.get"), "the closed toolbar reads its current-session ledger");
  const readsBeforeOpen = await page.evaluate(() => (window as any).__costReads);
  await link.focus();
  console.log("cost UI: opening cost popover");
  await page.keyboard.press("Enter");
  const detail = page;
  const dialog = page.getByRole("dialog", { name: "费用明细", exact: true });
  await dialog.waitFor();
  assert.equal(context.pages().length, 1, "costs open in the current page");
  assert.equal(page.url(), originalUrl);
  assert.deepEqual(await page.locator(".composer").boundingBox(), composerBefore, "popover styles do not change the composer");
  await detail.locator(".cost-total > .cost-number").filter({ hasText: "$1.5500 + 未知" }).waitFor();
  console.log("cost UI: totals loaded");
  assert.equal(await page.evaluate(() => (window as any).__costReads), readsBeforeOpen, "opening the popover shares the toolbar report without another query");
  assert.equal(await dialog.locator('.cost-session-facts dd').first().textContent(), '$1.0500 + 未知', 'current-session summary uses the same ledger and retains unknown costs');
  assert.equal(await dialog.locator('.cost-session-facts dd').nth(1).textContent(), '10,200', 'current-session tokens include main, tool and compression usage');
  assert.deepEqual(await dialog.locator('.cost-token-facts dd').allTextContents(), ['13,600', '8,000', '1,600', '3,200', '800']);
  assert.ok(!(await dialog.innerText()).includes('完整任务正文'), 'cost details show child titles without task contents');
  assert.match(await dialog.locator('#cost-main .cost-line summary').innerText(), /5,100 Token/);
  assert.match(await dialog.locator('#cost-subagent .cost-line summary').first().innerText(), /1,700 Token/);
  assert.equal(await dialog.getByRole('link', { name: '模型配置', exact: true }).getAttribute('href'), '/model-config.html');
  assert.equal(await dialog.locator('.cost-title').count(), 0, 'popover does not repeat the session name as a large title');
  assert.equal(await dialog.locator('.cost-refresh span').count(), 0, 'refresh stays an icon control');
  assert.ok(await dialog.locator('.cost-total > .cost-number').evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 18), 'compact total size survives stylesheet ordering');
  await page.waitForFunction(() => (window as any).__costInFlight === 0);
  const idleReads = await page.evaluate(() => (window as any).__costReads);
  const unrelated = app.store.execute({ op: 'session.create', requestId: crypto.randomUUID(), workspaceId: workspace.id, params: { title: '无关会话' } }) as Session;
  const noise = setInterval(() => { app.agents.publish(agentScope(scope)); app.agents.publish(agentScope({ ...scope, sessionId: unrelated.id })); }, 25);
  try { await page.waitForTimeout(900); } finally { clearInterval(noise); }
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => (window as any).__costReads), idleReads, 'unchanged progress and unrelated sessions do not reread costs');
  assert.equal(await dialog.getByRole('button', { name: '刷新费用', exact: true }).getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator("#prompt").inputValue(), "草稿保留在原会话");
  assert.equal(await detail.locator("#cost-subagent .cost-source").count(), 2);
  assert.equal(await detail.locator("#cost-compression .cost-source").count(), 1);
  await detail.getByRole("heading", { name: "调查数据来源" }).waitFor();
  await detail.getByRole("heading", { name: "检查边界条件" }).waitFor();
  assert.equal(await detail.locator("#cost-compression > header > .cost-number").textContent(), "$0.2000");
  assert.equal(await detail.locator("#cost-tool > header > .cost-number").textContent(), "$0.7000");
  await detail.locator("#cost-main .cost-line > summary").click();
  await detail.getByRole("table").first().waitFor();
  assert.match(await detail.getByRole("table").first().innerText(), /缓存读取/);
  // Updates faster than the coalescing interval must not starve reads, including
  // notifications received during a deliberately delayed query response.
  const readsBeforeBurst = await detail.evaluate(() => {
    (window as any).__costDelay = 400;
    return (window as any).__costReads as number;
  });
  manager.appendMessage(reply(.25));
  const burst = setInterval(() => app.agents.publish(agentScope(scope)), 25);
  try {
    await detail.waitForFunction((before) => (window as any).__costReads > before && (window as any).__costHeld > 0, readsBeforeBurst, { timeout: 4000 });
    assert.equal(await dialog.getByRole('button', { name: '刷新费用', exact: true }).getAttribute('aria-busy'), 'false', 'automatic reads do not animate the refresh control');
    assert.match(await dialog.locator('.cost-status').innerText(), /用量变化时自动更新/);
    manager.appendMessage(reply(.1));
    await detail.locator(".cost-total > .cost-number").filter({ hasText: "$1.8000 + 未知" }).waitFor({ timeout: 4000 });
    await detail.locator(".cost-total > .cost-number").filter({ hasText: "$1.9000 + 未知" }).waitFor({ timeout: 4000 });
    assert.equal(await detail.evaluate(() => (window as any).__costMaxInFlight), 1, "only one cost query may be in flight");
  } finally {
    clearInterval(burst);
    await detail.evaluate(() => { (window as any).__costDelay = 0; });
  }
  assert.equal(await detail.locator("#cost-main details[open]").count(), 1);
  await detail.getByText(/用量变化时自动更新/).waitFor();
  // Hold the page offline, add spending without a notification, then require a
  // new socket and query to recover it. Old visible content cannot satisfy this.
  await context.setOffline(true);
  await detail.evaluate(() => { for (const socket of (window as any).__sockets) if (new URL(socket.url).pathname === "/ws") socket.close(); });
  await detail.locator(".cost-status").filter({ hasText: "连接已断开" }).waitFor();
  const disconnected = await detail.evaluate(() => ({ sockets: (window as any).__sockets.length, reads: (window as any).__costReads }));
  manager.appendMessage(reply(.125));
  assert.equal(await detail.locator(".cost-total > .cost-number").textContent(), "$1.9000 + 未知");
  await context.setOffline(false);
  await detail.waitForFunction((before) => {
    const state = window as any;
    return state.__sockets.length > before.sockets && state.__sockets.some((socket: WebSocket, index: number) => index >= before.sockets && new URL(socket.url).pathname === "/ws" && socket.readyState === WebSocket.OPEN) && state.__costReads > before.reads;
  }, disconnected);
  await detail.locator(".cost-total > .cost-number").filter({ hasText: "$2.0250 + 未知" }).waitFor();
  assert.equal(await detail.locator("#cost-main details[open]").count(), 1, "reconnect preserves expanded calculation details");
  const artifacts = resolve("test-results/costs"); mkdirSync(artifacts, { recursive: true });
  for (const [width, height] of [[1440, 900], [820, 900], [390, 844], [320, 568], [820, 540]]) {
    await dialog.locator('.cost-content').evaluate(el => { el.scrollTop = 0; });
    await detail.setViewportSize({ width, height });
    assert.equal(await dialog.locator('.cost-total > .cost-number').evaluate(el => getComputedStyle(el).fontSize), '18px');
    assert.equal(await dialog.locator('.cost-title,.cost-refresh span').count(), 0);
    assert.ok(await detail.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: no horizontal overflow`);
    assert.ok(await dialog.evaluate((el) => {
      const box = el.getBoundingClientRect(), content = el.querySelector(".cost-content")!;
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && content.scrollWidth <= content.clientWidth + 1;
    }), `${width}: popover fits viewport without internal horizontal overflow`);
    await detail.screenshot({ path: join(artifacts, `${width}-${height}.png`), fullPage: true });
    await dialog.locator('#cost-subagent').screenshot({ path: join(artifacts, `subagents-${width}-${height}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const readsBeforeRefresh = await page.evaluate(() => (window as any).__costReads);
  await dialog.getByRole("button", { name: "刷新费用", exact: true }).click();
  await page.waitForFunction((before) => (window as any).__costReads > before, readsBeforeRefresh);
  await dialog.locator(".cost-status").filter({ hasText: "用量变化时自动更新" }).waitFor();
  await dialog.getByRole("button", { name: "关闭费用明细", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.ok(await link.evaluate((el) => el === document.activeElement), "close restores trigger focus");
  const readsAfterClose = await page.evaluate(() => (window as any).__costReads);
  app.agents.publish(agentScope(scope));
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => (window as any).__costReads), readsAfterClose, "unchanged progress does not reread the closed toolbar ledger");
  const heldBeforeRefresh = await page.evaluate(() => { (window as any).__costDelay = 400; return (window as any).__costHeld; });
  await link.click();
  await dialog.waitFor();
  assert.equal(await dialog.locator('.cost-total > .cost-number').textContent(), '$2.0250 + 未知', 'reopening immediately renders the live shared report');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => (window as any).__costReads), readsAfterClose, 'reopening does not duplicate the live subscription query');
  await dialog.getByRole('button', { name: '刷新费用', exact: true }).click();
  await page.waitForFunction(before => (window as any).__costHeld > before, heldBeforeRefresh);
  assert.match(await dialog.locator('.cost-status').innerText(), /上次读取的记录/);
  await page.evaluate(() => { (window as any).__costDelay = 0; });
  await dialog.locator('.cost-status').filter({hasText:'用量变化时自动更新'}).waitFor();
  assert.ok(await page.evaluate((before) => (window as any).__costReads > before, readsAfterClose), 'explicit refresh revalidates the shared report');
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await link.evaluate((el) => el === document.activeElement), "Escape restores trigger focus");
  await link.click();
  await dialog.waitFor();
  await page.mouse.click(4, 4);
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator("#prompt").inputValue(), "草稿保留在原会话");
  // The same popover works above a child dialog; Escape closes only the top layer.
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "cost-child-launcher", role: "assistant", text: "费用子会话验证", calls: [{ id: "fixture", name: "delegate", input: "{}" }] });
  views.flush(scope);
  app.agents.publish(tasksScope(scope), app.tasks.list(scope));
  // Delegation cards are visible directly in the conversation. Hold the child's
  // first toolbar query, which starts as soon as its conversation mounts.
  const heldBeforeChild = await page.evaluate(() => { (window as any).__costDelay = 400; return (window as any).__costHeld; });
  await page.getByRole("button", { name: "打开子会话：调查数据来源", exact: true }).click();
  const childDialog = page.getByRole("dialog", { name: "子代理会话", exact: true });
  await childDialog.getByRole("button", { name: "查看费用明细", exact: true }).click();
  await page.waitForFunction(before => (window as any).__costHeld > before, heldBeforeChild);
  assert.equal(await dialog.locator('.cost-total').count(), 0, 'parent cache is never reused for a child request');
  await page.evaluate(() => { (window as any).__costDelay = 0; });
  await dialog.locator(".cost-total > .cost-number").filter({ hasText: "$2.0250 + 未知" }).waitFor();
  await dialog.getByText(/当前查看的子会话/).waitFor();
  assert.equal(await dialog.locator('.cost-session-facts dd').first().textContent(), '$0.5000', 'child summary includes only its own session ledger');
  assert.equal(await dialog.locator('.cost-session-facts dd').nth(1).textContent(), '1,700', 'child token summary includes only its own session ledger');
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await childDialog.isVisible(), "Escape does not close the child conversation");
  await childDialog.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
  // Existing direct URLs remain readable, independently of the popover entry.
  const direct = await context.newPage();
  await direct.goto(`${app.origin}/costs.html?${new URLSearchParams({ workspaceId: workspace.id, sessionId: childIds[0] })}`);
  await direct.locator(".cost-total > .cost-number").filter({ hasText: "$2.0250 + 未知" }).waitFor();
  await direct.getByText(/当前查看的子会话/).waitFor();
  await direct.reload();
  await direct.locator(".cost-total > .cost-number").filter({ hasText: "$2.0250 + 未知" }).waitFor();
  // Explicit memory charges in a sibling invalidate every open report in the same family.
  const family = await context.newPage();
  await family.goto(`${app.origin}/costs.html?${new URLSearchParams(scope)}`);
  await family.locator('.cost-total > .cost-number').filter({ hasText: '$2.0250 + 未知' }).waitFor();
  app.store.db.prepare('INSERT INTO memory_usage(id,sessionId,kind,provider,model,usage,createdAt) VALUES(?,?,?,?,?,?,?)').run('cost-ui-memory', childIds[1], 'query', 'fixture', 'memory-model', JSON.stringify(usage(.1)), Date.now());
  app.agents.publish(`costs:${workspace.id}:${childIds[1]}`, { revision: Date.now() });
  for (const target of [direct, family]) await target.locator('.cost-total > .cost-number').filter({ hasText: '$2.1250 + 未知' }).waitFor();
  app.store.db.prepare('UPDATE memory_usage SET usage=? WHERE id=?').run(JSON.stringify(usage(.2)), 'cost-ui-memory');
  app.agents.publish(`costs:${workspace.id}:${childIds[1]}`, { revision: Date.now() });
  for (const target of [direct, family]) await target.locator('.cost-total > .cost-number').filter({ hasText: '$2.2250 + 未知' }).waitFor();
  await family.close();
  await direct.goto(`${app.origin}/costs.html?workspaceId=foreign&sessionId=${parent.id}`);
  await direct.getByRole("alert").waitFor();
  assert.equal(await direct.locator(".cost-total").count(), 0, "foreign scope never shows costs");
  await direct.goto(`${app.origin}/costs.html`);
  await direct.getByText(/缺少会话信息/).waitFor();
  // Query/subscription are read-only and create no persistent command receipt.
  const requestId = crypto.randomUUID();
  const result = await new Promise<any>((resolve, reject) => {
    const socket = new WebSocket(app.origin.replace("http", "ws") + "/ws", { headers: { Origin: app.origin }, handshakeTimeout: 5000 });
    socket.on("error", reject);
    socket.on("open", () => socket.send(JSON.stringify({ op: "costs.get", requestId, ...scope, params: {} })));
    socket.on("message", (raw) => { const message = JSON.parse(String(raw)); if (message.requestId === requestId) { socket.close(); resolve(message); } });
  });
  console.log("cost UI: query and responsive checks complete");
  assert.equal(result.ok, true); assert.ok(Math.abs(result.data.total.knownCost - 2.225) < 1e-9);
  assert.deepEqual(app.store.receipt(requestId, scope), { status: "not_found" });
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#prompt").inputValue(), "草稿保留在原会话");
  console.log("PASS: in-page cost popover, keyboard entry/close, child dialog layering, refresh button, per-child totals, compression deduplication, tool detail, unknowns, calculation table, live updates/reconnect, scope guards, draft preservation and five responsive viewports");
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
}
