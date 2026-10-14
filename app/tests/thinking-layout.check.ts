// Isolated real subscription/DOM check. No model calls or user data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-process-layout-"));
const artifacts = resolve("test-results/thinking-layout");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const publish = (message: ChatMessage) => { views.messageChanged(scope, message); views.flush(scope); };
  const thought: ChatMessage = { id: "first", role: "assistant", text: "", thinking: "检查当前实现", thinkingActive: true, streaming: true };
  publish(thought);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const group = page.locator("#messages > .tool-activity");
  const head = group.locator(":scope > summary");
  await group.waitFor();
  await page.waitForFunction(() => document.querySelector(".activity-status")?.getAttribute("data-state") === "running");
  assert.equal(await group.count(), 1);
  assert.equal(await group.getAttribute("open"), null);
  assert.equal(await head.locator(".thinking-dots span").count(), 3);
  assert.doesNotMatch(await head.innerText(), /thinking|正在思考/);
  assert.equal(await head.locator(".thinking-dots span").first().evaluate(node => getComputedStyle(node).animationName), "thinking-dot");
  assert.notEqual(await group.locator('.activity-status-glyph').evaluate(node => getComputedStyle(node).maskImage), 'none');
  assert.equal(await group.locator(".thinking-block").isVisible(), false);
  assert.equal(await group.locator(".activity-status").evaluate(node => getComputedStyle(node, "::before").animationName), "activity-breathe");
  await head.focus(); await page.keyboard.press("Enter");
  assert.equal(await group.locator(".activity-ticker").count(), 0);
  const thinking = group.locator(".thinking-block");
  await thinking.locator("summary").click();
  assert.equal(await thinking.locator(".thinking-dots span").count(), 3);
  assert.doesNotMatch(await thinking.locator("summary").innerText(), /thinking|正在思考/);
  const groupNode = await group.elementHandle(), thinkingNode = await thinking.elementHandle();
  publish({ ...thought, thinking: "持续更新思考内容" });
  await thinking.getByText("持续更新思考内容").waitFor();
  const delegated: ChatMessage = { ...thought, thinkingActive: false, streaming: false, calls: [{ id: "delegate", name: "functions.delegate", input: JSON.stringify({ context: "检查过程", tasks: [{ task: "审查卡片布局" }] }) }] };
  publish(delegated);
  await group.locator(".delegation-card").waitFor();
  assert.ok(await groupNode!.evaluate(node => node.isConnected && node.hasAttribute("open")));
  assert.ok(await thinkingNode!.evaluate(node => node.isConnected && node.hasAttribute("open")));
  assert.equal(await group.locator(".thinking-label").textContent(), "thought");
  assert.equal(await group.locator(".thinking-dots").count(), 0);
  assert.equal(await page.locator(".delegation-card").count(), 1);
  publish({ id: "tool-delegate", role: "toolResult", text: "{}", status: "completed" });
  publish({ id: "operations", role: "assistant", text: "", calls: [
    { id: "read", name: "read", input: '{"path":"src/main.ts"}' },
    { id: "result", name: "read_result", input: '{"taskId":"task","resultId":"result"}' },
    { id: "append", name: "append", input: '{"taskId":"task","mode":"followUp","text":"核对窄屏布局"}' },
    { id: "cancel", name: "cancel_task", input: '{"taskId":"task","reason":"已完成核查"}' },
  ] });
  for (const id of ["read", "result", "append", "cancel"]) publish({ id: `tool-${id}`, role: "toolResult", text: "{}", status: "completed", durationMs: 250 });
  publish({ id: "tool-append", role: "toolResult", text: "追加请求失败", status: "failed" });
  publish({ id: "notice", role: "notice", text: "子任务执行失败", taskNotice: "failed" });
  publish({ id: "answer", role: "assistant", text: "最终回复保持独立可见", status: "completed" });
  await page.waitForFunction(() => document.querySelector(".activity-title")?.textContent?.includes("5 项"));
  await page.waitForFunction(() => document.querySelector(".activity-status")?.getAttribute("data-state") === "completed");
  assert.equal(await group.count(), 1);
  assert.equal(await group.locator(".task-operation").count(), 3);
  assert.equal(await group.locator(".task-notice").count(), 1);
  assert.equal(await group.locator('.task-operation[data-status="failed"]').count(), 1);
  assert.equal(await group.locator('.task-notice[data-state="failed"]').count(), 1);
  assert.ok(await page.getByText("最终回复保持独立可见", { exact: true }).isVisible());
  await group.locator(".task-operation > details > summary").first().click();
  assert.equal(await group.locator(".task-operation details[open]").count(), 1);
  await head.click();
  assert.equal(await group.locator(".delegation-card").isVisible(), false);
  await head.click();
  assert.equal(await group.locator(".thinking-block[open], .task-operation details[open]").count(), 0);
  assert.equal(await group.locator(".activity-ticker").count(), 0);
  await group.screenshot({ path: join(artifacts, "process-expanded-1440.png") });
  await head.click();
  for (const width of [360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await head.evaluate(node => {
      const status = node.querySelector(".activity-status")!.getBoundingClientRect();
      const title = node.querySelector(".activity-title")!.getBoundingClientRect();
      const chevron = node.querySelector(":scope > svg")!.getBoundingClientRect();
      const ticker = node.querySelector(".activity-ticker")!.getBoundingClientRect();
      return { sameRow: Math.abs(status.y + status.height / 2 - title.y - title.height / 2) < 2, right: chevron.x > title.right, secondRow: ticker.y >= status.bottom, fits: node.scrollWidth <= node.clientWidth + 1 };
    });
    assert.deepEqual(geometry, { sameRow: true, right: true, secondRow: true, fits: true }, `two-line header at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await group.screenshot({ path: join(artifacts, `process-collapsed-${width}.png`) });
  }
  // Thinking added after tools takes over the second line without opening the group.
  publish({ id: "answer", role: "assistant", text: "", thinking: "汇总结果", thinkingActive: true, streaming: true });
  await page.waitForFunction(() => document.querySelector(".activity-current:not(.activity-current-out) .thinking-dots") !== null);
  assert.doesNotMatch(await head.innerText(), /thinking|正在思考/);
  assert.equal(await group.getAttribute("open"), null);
  await group.screenshot({ path: join(artifacts, "process-running-1440.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await group.locator(".activity-status").evaluate(node => getComputedStyle(node, "::before").animationName), "none");
  assert.equal(await head.locator(".thinking-dots span").first().evaluate(node => getComputedStyle(node).animationName), "none");
  publish({ id: "answer", role: "assistant", text: "最终回复保持独立可见", status: "completed" });
  await page.reload(); await group.waitFor();
  assert.equal(await group.count(), 1);
  assert.equal(await group.getAttribute("open"), null);
  assert.equal(await page.locator(".delegation-card").isVisible(), false);
  assert.ok(await page.getByText("最终回复保持独立可见", { exact: true }).isVisible());
  publish({ id: "failed-reply", role: "assistant", text: "", thinking: "尝试生成回复", status: "failed", error: "模型请求失败" });
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-activity')].at(-1)?.getAttribute('data-status') === 'failed');
  assert.equal(await page.locator('.tool-activity[data-status="failed"]').count(), 1, "only the actual failed assistant process shows failure");
  assert.deepEqual(errors, []);
  console.log(`PASS: two-line header, Phosphor status, thinking/task/notice grouping, stable streaming DOM, no expanded ticker, nested reset, keyboard, reduced motion, reload, 4 widths. ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
