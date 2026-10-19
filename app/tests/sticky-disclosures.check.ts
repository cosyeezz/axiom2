// Real message components and scrolling; no model calls or user data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { agentScope, emptyAgent, type ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { defaultBudgets, emptyTasks, tasksScope, type TaskList } from "../src/shared/tasks.js";

const root = mkdtempSync(join(tmpdir(), "axiom-sticky-"));
const artifacts = resolve("test-results/sticky-disclosures");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace"));
mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
const longText = Array.from({ length: 65 }, (_, i) => `第 ${i + 1} 段：滚动查看长内容，标题应始终可以收起。`).join("\n\n");
async function scrollInside(block: Locator, amount = 220) {
  await block.evaluate((node, delta) => {
    const thread = node.closest<HTMLElement>(".thread")!;
    thread.scrollTop += node.getBoundingClientRect().top - thread.getBoundingClientRect().top + delta;
  }, amount);
}
async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function startsAtBeginning(block: Locator) {
  const geometry = await block.evaluate(node => {
    const heading = node.querySelector(":scope > summary")!.getBoundingClientRect();
    return { start: node.getBoundingClientRect().top + (parseFloat(getComputedStyle(node).borderTopWidth) || 0),
      heading: heading.top, offsets: [...node.querySelectorAll<HTMLElement>("*")].filter(child => child.scrollTop || child.scrollLeft).length };
  });
  assert.ok(Math.abs(geometry.start - geometry.heading) < 2, `opening shows block start (${geometry.start}), not a retained offset under sticky header (${geometry.heading})`);
  assert.equal(geometry.offsets, 0, "opening resets nested output scrolling");
}
async function pinned(header: Locator, offset = 0) {
  const geometry = await header.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const thread = node.closest(".thread")!.getBoundingClientRect();
    return { top: rect.top - thread.top, height: rect.height, clickable: node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), position: getComputedStyle(node).position, background: getComputedStyle(node).backgroundColor };
  });
  assert.ok(Math.abs(geometry.top - offset - 8) < 2, `header at ${geometry.top}, expected ${offset + 8} with top clearance`);
  assert.equal(geometry.position, "sticky");
  assert.ok(geometry.clickable, "sticky control is not covered");
  assert.notEqual(geometry.background, "rgba(0, 0, 0, 0)", "content cannot show through header");
  return geometry.height;
}
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const child = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const childScope = { workspaceId: workspace.id, sessionId: child.id };
  const list: TaskList = { ...emptyTasks, tasks: [{ id: "fixture-task", workspaceId: workspace.id, parentSessionId: session.id,
    sessionId: child.id, anchor: "delegation", description: "检查长内容", status: "completed", runId: "fixture-run",
    createdAt: Date.now(), budgets: defaultBudgets, results: [], error: null }] };
  const originalList = app.tasks.list.bind(app.tasks);
  app.tasks.list = target => target.sessionId === session.id ? list : originalList(target);
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const call = (id: string, name: string, input: unknown) => ({ id, name, input: JSON.stringify(input) });
  const messages: ChatMessage[] = [
    { id: "compression", role: "notice", text: longText, compression: { number: 1, title: "长摘要吸顶测试", before: 10000, after: 2000 } },
    { id: "think", role: "assistant", text: "思考后的正文", thinking: longText, status: "completed" },
    { id: "tools", role: "assistant", text: "", thinking: longText, calls: [call("read", "read", { path: "long-file.ts", context: longText })] },
    { id: "tool-read", role: "toolResult", toolCallId: "read", text: longText, status: "completed" },
    { id: "boundary", role: "user", text: "继续检查子任务" },
    { id: "task", role: "assistant", text: "", calls: [call("append", "append", { taskId: "fixture-task", text: longText })] },
    { id: "tool-append", role: "toolResult", toolCallId: "append", text: JSON.stringify({ status: "queued" }), status: "completed" },
    { id: "delegate", role: "assistant", text: "", calls: [call("delegation", "delegate", { context: longText, tasks: [{ task: "检查长内容" }] })] },
    { id: "tool-delegation", role: "toolResult", toolCallId: "delegation", text: longText, status: "completed" },
    { id: "tail", role: "assistant", text: longText, status: "completed" },
  ];
  for (const message of messages) views.messageChanged(scope, message);
  views.flush(scope);
  views.publish(tasksScope(scope), list);
  views.messageChanged(childScope, { id: "child-think", role: "assistant", text: "子会话正文", thinking: longText });
  views.messageChanged(childScope, { id: "child-tail", role: "assistant", text: longText });
  views.flush(childScope);
  const environment = { cwd: root, tools: ["read"], skills: [], extensions: 0, warnings: [], systemPrompt: longText };
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,environment) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET environment=excluded.environment").run(session.id, JSON.stringify(environment));
  views.publish(agentScope(scope), { ...emptyAgent, environment });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  await page.locator(".compaction-card").waitFor();
  await page.locator("#prompt").fill("保留我的草稿");
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const selector of [".session-environment", ".compaction-card", ".task-operation > details"]) {
      console.log(`Checking ${width}: ${selector}`);
      const block = page.locator(selector).first();
      const parent = block.locator('xpath=ancestor::details[contains(@class,"tool-activity")][1]');
      if (await parent.count() && await parent.getAttribute("open") === null) await parent.locator(":scope > summary").click();
      const header = block.locator(":scope > summary");
      await header.click();
      await settled(page);
      await scrollInside(block);
      await settled(page);
      await pinned(header, await parent.count() ? await pinned(parent.locator(":scope > summary")) : 0);
      await page.screenshot({ path: join(artifacts, `${width}-${selector.includes("thinking") ? "thinking" : selector.includes("compaction") ? "compaction" : selector.includes("task") ? "task" : "environment"}.png`) });
      // Leaving this block releases its title; it does not float over later messages.
      await block.evaluate(node => {
        const thread = node.closest<HTMLElement>(".thread")!;
        thread.scrollTop += node.getBoundingClientRect().bottom - thread.getBoundingClientRect().top + 30;
      });
      await settled(page);
      assert.ok(await header.evaluate(node => node.getBoundingClientRect().bottom <= node.closest(".thread")!.getBoundingClientRect().top + 1));
      await scrollInside(block);
      await settled(page);
      await header.click();
      assert.equal(await block.getAttribute("open"), null, "sticky header collapses its own block");
      await header.focus();
      await page.keyboard.press("Enter");
      await settled(page);
      await startsAtBeginning(block);
      await header.click();
      if (await parent.count()) await parent.locator(":scope > summary").click();
    }
    const group = page.locator("#messages > .tool-activity").filter({ hasText: "long-file.ts" });
    const groupHeader = group.locator(":scope > summary");
    await groupHeader.click();
    const inner = group.locator(".thinking-block");
    assert.equal(await inner.locator(".thinking-body").count(), 0);
    await inner.locator(":scope > summary").click();
    assert.ok(await inner.locator(".thinking-body").isVisible());
    await settled(page);
    await scrollInside(inner, 350);
    await settled(page);
    await pinned(groupHeader);
    const readingPosition = await page.locator("#thread").evaluate(node => node.scrollTop);
    views.messageChanged(scope, { ...messages[2], thinking: longText + `\n\n增量 ${width}` });
    views.flush(scope);
    await inner.getByText(`增量 ${width}`, { exact: true }).waitFor({ state: "attached" });
    await settled(page);
    assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), readingPosition, "streaming does not restart an already open block");
    await pinned(groupHeader);
    await page.screenshot({ path: join(artifacts, `${width}-nested.png`) });
    // Resize while pinned: offsets follow actual wrapping, without resetting disclosure state.
    await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 900 });
    await settled(page);
    await pinned(groupHeader);
    const tool = group.locator(".tool-call");
    assert.equal(await tool.locator(".tool-detail").count(), 0, "opening the group leaves tool content collapsed");
    await tool.locator(":scope > summary").click();
    await settled(page);
    await startsAtBeginning(tool);
    await scrollInside(tool, 180);
    await settled(page);
    await pinned(tool.locator(":scope > summary"), await pinned(groupHeader));
    // Inner output scrolling must not displace either collapse control.
    await tool.locator("pre").last().evaluate(node => { node.scrollTop = 200; });
    await pinned(tool.locator(":scope > summary"), await pinned(groupHeader));
    await tool.locator(":scope > summary").click();
    await tool.locator(":scope > summary").click();
    await settled(page);
    await startsAtBeginning(tool);
    // Closing the process releases thinking content and resets nested expansion.
    await groupHeader.click();
    assert.equal(await group.locator(".thinking-body").count(), 0);
    assert.equal(await group.getAttribute("open"), null);
    await groupHeader.click();
    await settled(page);
    await startsAtBeginning(group);
    assert.equal(await group.locator(".tool-call[open], .tool-detail").count(), 0, "tool details remain collapsed on reopening");
    assert.equal(await inner.locator(".thinking-body").count(), 0, "thinking remains collapsed on reopening");
    await groupHeader.click();
    await page.setViewportSize({ width, height: 900 });
    const delegation = page.locator(".delegation-card");
    assert.equal(await delegation.locator(".delegation-toggle, .task-call-detail").count(), 0);
    assert.equal(await page.locator("#prompt").inputValue(), "保留我的草稿");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#messages > .tool-activity").last().locator(":scope > summary").click();
  await page.getByRole("button", { name: "打开子会话：检查长内容" }).click();
  const dialog = page.getByRole("dialog", { name: "子代理会话", exact: true });
  const childBlock = dialog.locator(".thinking-block");
  const childGroup = dialog.locator(".tool-activity");
  await childGroup.locator(":scope > summary").click();
  await childBlock.locator(":scope > summary").click();
  assert.ok(await childBlock.locator(".thinking-body").isVisible());
  await settled(page);
  const mainScroll = await page.locator("#thread").evaluate(node => node.scrollTop);
  await scrollInside(childBlock);
  await settled(page);
  await pinned(childGroup.locator(":scope > summary"));
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), mainScroll, "child scrolling does not move parent");
  await childGroup.locator(":scope > summary").click();
  await childGroup.locator(":scope > summary").click();
  await settled(page);
  await startsAtBeginning(childGroup);
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), mainScroll, "reopening child leaves parent scroll untouched");
  await dialog.getByRole("button", { name: "关闭子代理会话，返回主对话" }).click();
  // Expanding at the conversation tail must override automatic bottom following.
  views.messageChanged(scope, { id: "tail-user", role: "user", text: "检查末尾展开" });
  views.messageChanged(scope, { id: "tail-tools", role: "assistant", text: "", calls: [call("tail-read", "read", { path: "tail.ts", context: longText })] });
  views.messageChanged(scope, { id: "tool-tail-read", role: "toolResult", toolCallId: "tail-read", text: longText, status: "completed" });
  views.flush(scope);
  const tailGroup = page.locator("#messages > .tool-activity").last();
  await tailGroup.locator(":scope > summary").filter({ hasText: "tail.ts" }).waitFor();
  await page.locator("#thread").evaluate(node => { node.scrollTop = node.scrollHeight; });
  await settled(page);
  await tailGroup.locator(":scope > summary").click();
  await settled(page);
  await startsAtBeginning(tailGroup);
  await tailGroup.locator(".tool-call > summary").click();
  await settled(page);
  await startsAtBeginning(tailGroup.locator(".tool-call"));
  await page.screenshot({ path: join(artifacts, "reopen-from-start.png") });
  // Running inner details still open at the beginning, including scrollable output.
  const runningMessage: ChatMessage = { id: "tail-tools", role: "assistant", text: "", thinking: longText,
    thinkingActive: true, streaming: true, calls: [call("tail-read", "read", { path: "tail.ts", context: longText })] };
  views.messageChanged(scope, runningMessage);
  views.messageChanged(scope, { id: "tool-tail-read", role: "toolResult", toolCallId: "tail-read", text: longText, status: "running" });
  views.flush(scope);
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-activity')].at(-1)?.getAttribute('data-status') === 'running');
  const endsAtBottom = async (block: Locator) => {
    await settled(page);
    const gap = await block.evaluate(node => {
      const thread = node.closest<HTMLElement>(".thread")!;
      return node.getBoundingClientRect().bottom - thread.getBoundingClientRect().top - thread.clientHeight;
    });
    assert.ok(Math.abs(gap) < 2, `running card ends at viewport bottom, gap ${gap}`);
  };
  const tailTool = tailGroup.locator(".tool-call");
  await tailTool.locator(":scope > summary").click();
  await tailTool.locator(":scope > summary").click();
  await settled(page);
  await startsAtBeginning(tailTool);
  assert.equal(await tailTool.locator("pre").last().evaluate(node => node.scrollTop), 0);
  const tailThinking = tailGroup.locator(".thinking-block");
  await tailThinking.locator(":scope > summary").click();
  await settled(page);
  await startsAtBeginning(tailThinking);
  await pinned(tailThinking.locator(":scope > summary"), await pinned(tailGroup.locator(":scope > summary")));
  // Updating an already open running thought preserves a user's earlier reading position.
  await scrollInside(tailThinking, 250); await settled(page);
  const beforeIncrement = await page.locator("#thread").evaluate(node => node.scrollTop);
  views.messageChanged(scope, { ...runningMessage, thinking: longText + "\n\n新增思考" }); views.flush(scope);
  await tailThinking.getByText("新增思考", { exact: true }).waitFor(); await settled(page);
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), beforeIncrement);
  // Only the outer running process opens at its end.
  views.messageChanged(scope, { ...runningMessage, calls: [...runningMessage.calls!, ...Array.from({ length: 30 }, (_, i) => call(`pending-${i}`, "read", { path: `file-${i}.ts` }))] });
  views.flush(scope);
  await tailGroup.locator('.tool-call').nth(30).waitFor({ state: "attached" });
  await tailGroup.locator(":scope > summary").click();
  await tailGroup.locator(":scope > summary").click();
  await endsAtBottom(tailGroup);
  // A completed nested call starts at the top even while its parent is running.
  views.messageChanged(scope, { id: "tool-tail-read", role: "toolResult", toolCallId: "tail-read", text: longText, status: "completed" });
  views.messageChanged(scope, { ...runningMessage, thinkingActive: false }); views.flush(scope);
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-call')].find(node => node.textContent?.includes('tail.ts'))?.getAttribute('data-status') === 'completed');
  await tailTool.locator(":scope > summary").click(); await settled(page); await startsAtBeginning(tailTool);
  await tailThinking.locator(":scope > summary").click(); await settled(page); await startsAtBeginning(tailThinking);
  await page.screenshot({ path: join(artifacts, "status-aware-expansion.png") });
  assert.deepEqual(errors, []);
  console.log(`PASS: sticky environment/thinking/tools/compression/task, nested offsets, resize, streaming, inner scrolling, block boundaries, collapse, draft preservation, independent child window, desktop/mobile. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
