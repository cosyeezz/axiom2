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
async function expandInPlace(block: Locator, keyboard = false) {
  const header = block.locator(":scope > summary");
  const outside = await header.evaluate(node => {
    const rect = node.getBoundingClientRect(), thread = node.closest(".thread")!.getBoundingClientRect();
    return rect.top < thread.top || rect.bottom > thread.bottom;
  });
  if (outside) {
    // Navigate to the offscreen control as a reader would, ending tail following
    // before Playwright positions it. This preparation is not part of the click.
    const thread = await block.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," thread ")][1]').boundingBox();
    await block.page().mouse.move(thread!.x + 2, thread!.y + thread!.height / 2);
    await block.page().mouse.wheel(0, -1);
    await block.page().waitForTimeout(100);
    await header.scrollIntoViewIfNeeded();
  }
  await settled(block.page());
  const position = () => header.evaluate(node => {
    const thread = node.closest<HTMLElement>(".thread")!, rect = node.getBoundingClientRect();
    const block = node.parentElement!.getBoundingClientRect(), viewport = thread.getBoundingClientRect();
    return { scroll: thread.scrollTop, top: rect.top, bottom: rect.bottom, end: block.bottom, floor: viewport.bottom, ceiling: viewport.top, height: thread.clientHeight };
  });
  const before = await position();
  if (keyboard) {
    await header.focus();
    await header.press("Enter");
  } else await header.click();
  assert.notEqual(await block.getAttribute("open"), null);
  // Include native toggle, React lazy mounting and ResizeObserver callbacks.
  await block.page().waitForTimeout(350);
  await settled(block.page());
  const after = await position();
  const budget = Math.min(320, before.height * 0.45);
  const movement = after.scroll - before.scroll;
  assert.ok(movement >= -2 && movement <= budget + 14, `expansion only makes limited room below: ${JSON.stringify({ before, after })}`);
  if (before.floor - before.bottom >= budget + 12) {
    assert.ok(Math.abs(movement) < 2, "enough room preserves scroll");
    assert.ok(Math.abs(after.top - before.top) < 2, "enough room preserves heading");
  }
  assert.ok(after.top >= after.ceiling - 2, "expanded heading stays visible");
  assert.ok(Math.min(after.end, after.bottom + budget) <= after.floor + 2, `beginning is visible above the composer: ${JSON.stringify(after)}`);
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
    sessionId: child.id, anchor: "delegation", title: "检查长内容", description: "检查长内容", status: "completed", runId: "fixture-run",
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
      await expandInPlace(block);
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
      const beforeCollapse = await page.locator("#thread").evaluate(node => node.scrollTop);
      await header.click();
      assert.equal(await block.getAttribute("open"), null, "sticky header collapses its own block");
      await settled(page);
      const collapsed = await page.locator("#thread").evaluate(node => ({ scroll: node.scrollTop, max: node.scrollHeight - node.clientHeight }));
      assert.ok(Math.abs(collapsed.scroll - Math.min(beforeCollapse, collapsed.max)) < 2, "collapse preserves reading position except for necessary range clamping");
      await expandInPlace(block, true);
      await header.click();
      if (await parent.count()) await parent.locator(":scope > summary").click();
    }
    const group = page.locator('#messages > .tool-activity[data-call-count="1"]').first();
    const groupHeader = group.locator(":scope > summary");
    await expandInPlace(group);
    const inner = group.locator(".thinking-block");
    assert.equal(await inner.locator(".thinking-body").count(), 0);
    await expandInPlace(inner);
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
    await expandInPlace(tool);
    await scrollInside(tool, 180);
    await settled(page);
    await pinned(tool.locator(":scope > summary"), await pinned(groupHeader));
    // Inner output scrolling must not displace either collapse control.
    await tool.locator("pre").last().evaluate(node => { node.scrollTop = 200; });
    await pinned(tool.locator(":scope > summary"), await pinned(groupHeader));
    await tool.locator(":scope > summary").click();
    await expandInPlace(tool);
    // Closing the process releases thinking content and resets nested expansion.
    await groupHeader.click();
    assert.equal(await group.locator(".thinking-body").count(), 0);
    assert.equal(await group.getAttribute("open"), null);
    await expandInPlace(group);
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
  const childThread = dialog.locator(".thread");
  await page.waitForFunction(() => {
    const node = document.querySelector('.subagent-dialog .thread')!;
    return node.scrollHeight - node.clientHeight - node.scrollTop < 2;
  });
  const beforeDelivery = await childThread.evaluate(node => node.scrollTop);
  await dialog.locator(".task-results > details > summary").click();
  await page.waitForTimeout(150);
  assert.equal(await childThread.evaluate(node => node.scrollTop), beforeDelivery, "delivery expansion pauses child tail following before resize");
  await dialog.locator(".task-results > details > summary").click();
  await settled(page);
  assert.equal(await childThread.evaluate(node => node.scrollTop), beforeDelivery, "delivery collapse preserves child reading position");
  const childBlock = dialog.locator(".thinking-block");
  const childGroup = dialog.locator(".tool-activity");
  await expandInPlace(childGroup);
  await expandInPlace(childBlock);
  assert.ok(await childBlock.locator(".thinking-body").isVisible());
  await settled(page);
  const mainScroll = await page.locator("#thread").evaluate(node => node.scrollTop);
  await scrollInside(childBlock);
  await settled(page);
  await pinned(childGroup.locator(":scope > summary"));
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), mainScroll, "child scrolling does not move parent");
  await childGroup.locator(":scope > summary").click();
  await expandInPlace(childGroup);
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), mainScroll, "reopening child leaves parent scroll untouched");
  await dialog.getByRole("button", { name: "关闭子代理会话，返回主对话" }).click();
  // At the tail, make room for the opened rows without restoring automatic following.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  views.messageChanged(scope, { id: "tail-user", role: "user", text: "检查末尾展开" });
  views.messageChanged(scope, { id: "tail-tools", role: "assistant", text: "", thinking: longText, calls: [call("tail-read", "read", { path: "tail.ts", context: longText })] });
  views.messageChanged(scope, { id: "tool-tail-read", role: "toolResult", toolCallId: "tail-read", text: longText, status: "completed" });
  views.flush(scope);
  const tailGroup = page.locator("#messages > .tool-activity").last();
  await page.waitForFunction(() => [...document.querySelectorAll('#messages > .tool-activity')].at(-1)?.getAttribute('data-call-count') === '1');
  await tailGroup.locator(":scope > summary").waitFor();
  await page.locator("#thread").evaluate(node => { node.scrollTop = node.scrollHeight; });
  await settled(page);
  await expandInPlace(tailGroup);
  const shortGeometry = await tailGroup.evaluate(node => ({ end: node.getBoundingClientRect().bottom, floor: node.closest(".thread")!.getBoundingClientRect().bottom }));
  assert.ok(shortGeometry.end <= shortGeometry.floor - 8, `short expansion is fully visible with bottom breathing room: ${JSON.stringify(shortGeometry)}`);
  const afterShort = await page.locator("#thread").evaluate(node => node.scrollTop);
  views.messageChanged(scope, { id: "tail-tools", role: "assistant", text: "", thinking: longText,
    calls: [call("tail-read", "read", { path: "tail.ts", context: longText }), call("added-read", "read", { path: "added.ts" })] }); views.flush(scope);
  await tailGroup.locator(".tool-call").nth(1).waitFor({ state: "attached" });
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), afterShort, "reveal reaching the tail does not restore following on later output");
  views.messageChanged(scope, { id: "tail-tools", role: "assistant", text: "", thinking: longText, calls: [call("tail-read", "read", { path: "tail.ts", context: longText })] }); views.flush(scope);
  await tailGroup.locator(".tool-call").nth(1).waitFor({ state: "detached" });
  await expandInPlace(tailGroup.locator(".tool-call"));
  await page.screenshot({ path: join(artifacts, "expand-in-place.png") });
  // Running inner details also expand in place, including scrollable output.
  const runningMessage: ChatMessage = { id: "tail-tools", role: "assistant", text: "", thinking: longText,
    thinkingActive: true, streaming: true, calls: [call("tail-read", "read", { path: "tail.ts", context: longText })] };
  views.messageChanged(scope, runningMessage);
  views.messageChanged(scope, { id: "tool-tail-read", role: "toolResult", toolCallId: "tail-read", text: longText, status: "running" });
  views.flush(scope);
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-activity')].at(-1)?.getAttribute('data-status') === 'running');
  const tailTool = tailGroup.locator(".tool-call");
  await tailTool.locator(":scope > summary").click();
  await expandInPlace(tailTool);
  assert.equal(await tailTool.locator("pre").last().evaluate(node => node.scrollTop), 0);
  const tailThinking = tailGroup.locator(".thinking-block");
  await expandInPlace(tailThinking);
  await scrollInside(tailThinking, 250); await settled(page);
  await pinned(tailGroup.locator(":scope > summary"));
  assert.deepEqual(await tailThinking.evaluate(node => {
    const header = node.querySelector(':scope > summary')!, body = node.querySelector('.thinking-body')!;
    const top = node.getBoundingClientRect().top;
    return { headerOffset: header.getBoundingClientRect().top - top, bodyOffset: body.getBoundingClientRect().top - top,
      position: getComputedStyle(header).position, background: getComputedStyle(header).backgroundColor };
  }), { headerOffset: 0, bodyOffset: 0, position: 'relative', background: 'rgba(0, 0, 0, 0)' }, 'thinking scrolls as one continuous body beneath the sticky process title');
  // Updating an already open running thought preserves a user's earlier reading position.
  await scrollInside(tailThinking, 250); await settled(page);
  const beforeIncrement = await page.locator("#thread").evaluate(node => node.scrollTop);
  views.messageChanged(scope, { ...runningMessage, thinking: longText + "\n\n新增思考" }); views.flush(scope);
  await tailThinking.getByText("新增思考", { exact: true }).waitFor(); await settled(page);
  assert.equal(await page.locator("#thread").evaluate(node => node.scrollTop), beforeIncrement);
  // Running processes expand downward just like completed details.
  views.messageChanged(scope, { ...runningMessage, calls: [...runningMessage.calls!, ...Array.from({ length: 30 }, (_, i) => call(`pending-${i}`, "read", { path: `file-${i}.ts` }))] });
  views.flush(scope);
  await tailGroup.locator('.tool-call').nth(30).waitFor({ state: "attached" });
  await tailGroup.locator(":scope > summary").click();
  await expandInPlace(tailGroup);
  // A completed nested call also preserves position while its parent is running.
  views.messageChanged(scope, { id: "tool-tail-read", role: "toolResult", toolCallId: "tail-read", text: longText, status: "completed" });
  views.messageChanged(scope, { ...runningMessage, thinkingActive: false }); views.flush(scope);
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-call')].find(node => node.textContent?.includes('tail.ts'))?.getAttribute('data-status') === 'completed');
  await expandInPlace(tailTool);
  await expandInPlace(tailThinking);
  await page.screenshot({ path: join(artifacts, "running-expansion-in-place.png") });
  // The reported case: a folded final process exposes another process row at the bottom.
  await page.setViewportSize({ width: 390, height: 540 });
  views.messageChanged(scope, { id: "nested-user", role: "user", text: "检查底部多层展开" });
  views.messageChanged(scope, { id: "nested-process", role: "assistant", text: "过程中的说明", thinking: "这是一段简短思考", phase: "commentary", status: "completed",
    calls: [call("nested-read", "read", { path: "nested.ts", context: longText })] });
  views.messageChanged(scope, { id: "tool-nested-read", role: "toolResult", toolCallId: "nested-read", text: longText, status: "completed" });
  views.messageChanged(scope, { id: "nested-final", role: "assistant", text: "嵌套场景的最终回复", phase: "final_answer", status: "completed" }); views.flush(scope);
  await page.getByText("嵌套场景的最终回复", { exact: true }).waitFor();
  const folded = page.locator("#messages > .tool-activity:not(.process-live)").last();
  await folded.locator(":scope > summary").waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('#messages > .tool-activity:not(.process-live)')].at(-1)?.hasAttribute("data-folding"));
  await page.locator("#thread").evaluate(node => { node.scrollTop = node.scrollHeight; }); await settled(page);
  await expandInPlace(folded);
  const nestedProcess = folded.locator('.process-live[data-call-count="1"]');
  await expandInPlace(nestedProcess, true);
  await expandInPlace(nestedProcess.locator(".tool-call"));
  await page.screenshot({ path: join(artifacts, "bottom-nested-reveal.png") });
  assert.deepEqual(errors, []);
  console.log(`PASS: sticky environment/tools/compression/task, continuous thinking beneath the sticky process title, nested offsets, resize, streaming, inner scrolling, block boundaries, collapse, draft preservation, independent child window, desktop/mobile, bounded bottom reveal. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
