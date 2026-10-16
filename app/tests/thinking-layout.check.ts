// Isolated real subscription/DOM check. No model calls or user data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
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
  app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
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
  const assertThinkingAnimates = async (container: Locator) => {
    const dots = container.locator(".thinking-dots");
    assert.equal(await dots.locator("circle").count(), 3);
    assert.match(await container.innerText(), /thinking/);
    const radii = await dots.locator("circle").evaluateAll(nodes => nodes.map(node => (node as SVGCircleElement).r.animVal.value));
    await page.waitForFunction(({ svg, radii }) => [...svg!.querySelectorAll<SVGCircleElement>("circle")]
      .some((circle, i) => Math.abs(circle.r.animVal.value - radii[i]) > 0.2), { svg: await dots.elementHandle(), radii });
    assert.deepEqual(await dots.evaluate(node => { const style = getComputedStyle(node); return [style.width, style.height, style.stroke]; }), ["18px", "18px", "none"]);
  };
  await assertThinkingAnimates(head);
  const runningIcon = group.locator('.activity-status-dots');
  const radii = await runningIcon.evaluate(node => {
    const svg = node as SVGSVGElement;
    const circles = [...svg.querySelectorAll<SVGCircleElement>('circle')];
    svg.pauseAnimations();
    svg.setCurrentTime(0.25);
    const first = circles.map(circle => circle.r.animVal.value);
    svg.setCurrentTime(0.75);
    const second = circles.map(circle => circle.r.animVal.value);
    svg.unpauseAnimations();
    return { first, second, size: [getComputedStyle(svg).width, getComputedStyle(svg).height], stroke: getComputedStyle(svg).stroke };
  });
  assert.equal(radii.first.length, 3);
  assert.notDeepEqual(radii.first, radii.second, 'running dots change radius over time');
  assert.ok(radii.first.some(radius => radius > 0) && radii.second.some(radius => radius > 0));
  assert.deepEqual(radii.size, ['24px', '24px']);
  assert.equal(radii.stroke, 'none');
  assert.equal(await runningIcon.evaluate(node => getComputedStyle(node).color), 'rgb(39, 166, 68)', 'running dots use success green');
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedRadii = await runningIcon.locator('circle').evaluateAll(nodes => nodes.map(node => (node as SVGCircleElement).r.animVal.value));
  await page.waitForFunction(previous => [...document.querySelectorAll<SVGCircleElement>('.activity-status-dots circle')].some((circle, index) => Math.abs(circle.r.animVal.value - previous[index]) > 0.2), reducedRadii);
  assert.equal(await runningIcon.locator('circle').count(), 3, 'loading still animates under reduced motion');
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Live completion reveals the left dashes, draws the right arc, then the check once.
  const completedIcon = group.locator('.activity-status-completed');
  const completedThought = { ...thought, thinkingActive: false, streaming: false, status: 'completed' as const };
  await page.waitForTimeout(2300); // Complete after page startup, as a real task would.
  publish(completedThought);
  await completedIcon.waitFor();
  const liveStart = await completedIcon.evaluate(node => ({
    time: (node as SVGSVGElement).getCurrentTime(),
    checkOpacity: Number(getComputedStyle(node.querySelector('.activity-completed-check')!).opacity),
  }));
  assert.ok(liveStart.time < 0.35, `completion starts its own clock, got ${liveStart.time}s`);
  assert.equal(liveStart.checkOpacity, 0, 'live completion does not skip directly to the check');
  await page.waitForFunction(() => (document.querySelector('.activity-status-completed') as SVGSVGElement).getCurrentTime() >= 0.65);
  const liveArc = await completedIcon.evaluate(node => ({
    arc: parseFloat(getComputedStyle(node.querySelector('.activity-completed-arc')!).strokeDashoffset),
    check: Number(getComputedStyle(node.querySelector('.activity-completed-check')!).opacity),
  }));
  assert.ok(liveArc.arc > 0 && liveArc.arc < 100, 'the live arc visibly draws before the check');
  assert.equal(liveArc.check, 0);
  await page.waitForFunction(() => (document.querySelector('.activity-status-completed') as SVGSVGElement).getCurrentTime() >= 2.05);
  assert.equal(await completedIcon.locator('.activity-completed-check').evaluate(node => parseFloat(getComputedStyle(node).strokeDashoffset)), 0, 'live completion finishes within two seconds');
  const dashedCompletion = { dashes: 1, arc: { opacity: 0, offset: 100 }, check: { opacity: 0, offset: 100 } };
  const finishedCompletion = { dashes: 1, arc: { opacity: 1, offset: 0 }, check: { opacity: 1, offset: 0 } };
  const readCompletion = (time: number) => completedIcon.evaluate((node, time) => {
    const svg = node as SVGSVGElement;
    svg.pauseAnimations(); svg.setCurrentTime(time);
    const arc = getComputedStyle(svg.querySelector('.activity-completed-arc')!);
    const check = getComputedStyle(svg.querySelector('.activity-completed-check')!);
    return {
      dashes: Number(getComputedStyle(svg.querySelector('.activity-completed-dashes')!).opacity),
      arc: { opacity: Number(arc.opacity), offset: parseFloat(arc.strokeDashoffset) },
      check: { opacity: Number(check.opacity), offset: parseFloat(check.strokeDashoffset) },
    };
  }, time);
  assert.deepEqual(await readCompletion(0.25), dashedCompletion, 'only the left dashes appear first');
  await group.screenshot({ path: join(artifacts, 'process-completion-dashes-1440.png') });
  const arcFrame = await readCompletion(0.75);
  assert.equal(arcFrame.arc.opacity, 1);
  assert.ok(arcFrame.arc.offset > 0 && arcFrame.arc.offset < 100, 'right arc is partially drawn');
  assert.equal(arcFrame.check.opacity, 0, 'check waits until the arc finishes');
  await group.screenshot({ path: join(artifacts, 'process-completion-arc-1440.png') });
  const checkFrame = await readCompletion(1.6);
  assert.deepEqual(checkFrame.arc, finishedCompletion.arc);
  assert.equal(checkFrame.check.opacity, 1);
  assert.ok(checkFrame.check.offset > 0 && checkFrame.check.offset < 100, 'check draws after the completed arc');
  await group.screenshot({ path: join(artifacts, 'process-completion-check-1440.png') });
  assert.deepEqual(await readCompletion(2.05), finishedCompletion, 'all strokes finish drawing');
  await group.screenshot({ path: join(artifacts, 'process-completion-finished-1440.png') });
  assert.deepEqual(await readCompletion(3), finishedCompletion, 'completion stays drawn instead of looping');
  const completedNode = await completedIcon.elementHandle();
  await completedIcon.evaluate(node => (node as SVGSVGElement).unpauseAnimations());
  publish({ ...completedThought, thinking: '完成内容继续同步' });
  await head.getByText('完成内容继续同步', { exact: true }).waitFor();
  await head.click(); await head.click();
  assert.ok(await completedNode!.evaluate(node => node.isConnected && (node as SVGSVGElement).getCurrentTime() >= 3), 'updates and disclosure toggles do not restart completion');
  publish(thought);
  await head.locator('.thinking-dots').waitFor();
  assert.equal(await group.getAttribute('data-status'), 'running', 'active thinking restores the running state');
  assert.equal(await completedNode!.evaluate(node => node.isConnected), false, 'active thinking removes the completion icon');
  assert.equal(await group.locator(".thinking-block").isVisible(), false);
  await head.focus(); await page.keyboard.press("Enter");
  assert.equal(await group.locator(".activity-ticker").count(), 0);
  assert.equal(await head.locator(".tool-icon").count(), 0, "thinking summary has no icon");
  const thinking = group.locator(".thinking-block");
  assert.equal(await thinking.getAttribute("open"), null);
  assert.equal(await thinking.locator(".thinking-body").count(), 0);
  assert.equal(await thinking.locator(":scope > summary .thinking-glyph path").count(), 7);
  await assertThinkingAnimates(thinking);
  await thinking.locator(":scope > summary").focus(); await page.keyboard.press("Enter");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await assertThinkingAnimates(thinking);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.ok(await thinking.getByText("检查当前实现", { exact: true }).isVisible());
  const groupNode = await group.elementHandle(), thinkingNode = await thinking.elementHandle();
  publish({ ...thought, thinking: "持续更新思考内容" });
  await thinking.getByText("持续更新思考内容").waitFor();
  const delegated: ChatMessage = { ...thought, thinkingActive: false, streaming: false, calls: [{ id: "delegate", name: "functions.delegate", input: JSON.stringify({ context: "检查过程", tasks: [{ task: "审查卡片布局" }] }) }] };
  publish(delegated);
  await group.locator(".delegation-card").waitFor();
  assert.ok(await groupNode!.evaluate(node => node.isConnected && node.hasAttribute("open")));
  assert.ok(await thinkingNode!.evaluate(node => node.isConnected));
  assert.equal(await group.locator(".thinking-label").innerText(), "thinking");
  assert.equal(await thinking.getAttribute("open"), "", "streaming completion preserves manual expansion");
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
  assert.equal(await group.locator('.activity-status-dots').count(), 0);
  assert.deepEqual(await group.locator('.activity-status-completed').evaluate(node => {
    const style = getComputedStyle(node);
    return [style.width, style.height, style.fill, style.strokeWidth, style.strokeLinecap, style.strokeLinejoin];
  }), ['22px', '22px', 'none', '2px', 'round', 'round']);
  assert.equal(await group.count(), 1);
  assert.equal(await group.locator(".task-operation").count(), 3);
  assert.equal(await group.locator(".task-notice").count(), 1);
  assert.equal(await group.locator('.task-operation[data-status="failed"]').count(), 1);
  assert.ok(await group.locator('.task-operation[data-status="failed"] > details > summary').evaluate(node => [node, ...node.querySelectorAll('*')].every(child => getComputedStyle(child).color === getComputedStyle(node).color)), "failed task operation uses red throughout its header");
  assert.equal(await group.locator('.task-notice[data-state="failed"]').count(), 1);
  assert.ok(await page.getByText("最终回复保持独立可见", { exact: true }).isVisible());
  await group.locator(".task-operation > details > summary").first().click();
  assert.equal(await group.locator(".task-operation details[open]").count(), 1);
  await head.click();
  assert.equal(await group.locator(".delegation-card").isVisible(), false);
  await head.click();
  assert.equal(await group.locator(".task-operation details[open]").count(), 0);
  assert.equal(await thinking.locator(".thinking-body").count(), 0, "reopening leaves thinking collapsed");
  assert.equal(await thinking.getAttribute("open"), null);
  await thinking.locator(":scope > summary").click();
  assert.ok(await thinking.locator(".thinking-body").isVisible());
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
  await assertThinkingAnimates(head);
  assert.equal(await group.getAttribute("open"), null);
  assert.equal(await group.getAttribute('data-status'), 'running', 'merged running thinking keeps the outer process active');
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await runningIcon.count(), 1);
  assert.equal(await completedIcon.count(), 0, 'thinking cannot coexist with a completed status icon');
  await group.screenshot({ path: join(artifacts, "process-running-merged-1440.png") });
  await assertThinkingAnimates(head);
  const markdownThought = "**正在复核关键落实**，检查 `src/main.ts` 与 [说明](https://example.com)\n\n- 核对列表\n\n```ts\nconst ready = true;\n```";
  publish({ id: "answer", role: "assistant", text: "", thinking: markdownThought, status: "completed" });
  await completedIcon.waitFor();
  assert.equal(await completedIcon.locator('animate, set').count(), 0, 'completion after resumed activity does not replay its animation');
  assert.deepEqual(await readCompletion(0), finishedCompletion, 'resumed process finishes with the static completion icon');
  assert.deepEqual(await readCompletion(3), finishedCompletion);
  await completedIcon.evaluate(node => (node as SVGSVGElement).unpauseAnimations());
  const preview = head.locator(".activity-current:not(.activity-current-out) .thinking-preview");
  await preview.locator("strong").waitFor();
  assert.equal(await preview.locator("strong").innerText(), "正在复核关键落实");
  assert.equal(await preview.locator("code").count(), 2);
  assert.equal(await preview.locator("a, button, input, pre, p, ul").count(), 0);
  assert.doesNotMatch(await preview.innerText(), /\*\*|```|\]\(https/);
  assert.equal(await head.locator(".thinking-indicator").count(), 0);
  assert.deepEqual(await preview.locator("strong").evaluate(node => { const style = getComputedStyle(node); return [style.color, style.fontStyle, style.fontWeight]; }), ["rgb(156, 163, 175)", "italic", "400"]);
  for (const width of [360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await preview.evaluate(node => node.clientHeight <= 24 && node.scrollWidth > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await group.screenshot({ path: join(artifacts, `thinking-markdown-${width}.png`) });
  }
  await head.click();
  const markdownThinking = group.locator(".thinking-block").last();
  assert.equal(await markdownThinking.getAttribute("open"), null);
  assert.equal(await markdownThinking.locator("summary a, summary button").count(), 0);
  await markdownThinking.locator(":scope > summary").click();
  assert.deepEqual(await markdownThinking.locator(".thinking-body strong").evaluate(node => { const style = getComputedStyle(node); return [style.color, style.fontStyle, style.fontWeight]; }), ["rgb(156, 163, 175)", "italic", "400"]);
  await head.click();
  const streamingReply: ChatMessage = { id: "answer", role: "assistant", text: "最终回复保持独立可见", thinking: markdownThought, streaming: true };
  publish(streamingReply);
  await page.getByText("最终回复保持独立可见", { exact: true }).waitFor();
  assert.equal(await page.locator("#messages .tool-activity").count(), 1, "reply thinking must not create a second process card");
  assert.equal(await group.getAttribute("open"), null);
  await head.click();
  assert.ok(await groupNode!.evaluate(node => node.isConnected && node.hasAttribute("open")), "the original process stays mounted");
  const replyThinking = group.locator(".thinking-block").last();
  await replyThinking.locator(":scope > summary").click();
  await replyThinking.locator(".thinking-body strong").waitFor();
  const replyThinkingNode = await replyThinking.elementHandle();
  publish({ ...streamingReply, text: "最终回复保持独立可见，正文继续输出", status: "completed", streaming: false });
  await page.getByText("最终回复保持独立可见，正文继续输出", { exact: true }).waitFor();
  assert.ok(await replyThinkingNode!.evaluate(node => node.isConnected));
  assert.equal(await page.locator("#messages .tool-activity").count(), 1);
  assert.equal(await page.locator(".reply-body .thinking-block").count(), 0);
  await page.screenshot({ path: join(artifacts, "merged-reply-thinking-1440.png") });
  await page.reload(); await group.waitFor();
  await completedIcon.waitFor();
  assert.equal(await completedIcon.locator('animate, set').count(), 0, 'completed history does not replay its animation');
  assert.deepEqual(await readCompletion(0), finishedCompletion, 'completed history starts fully drawn');
  assert.equal(await page.locator("#messages .tool-activity").count(), 1);
  assert.equal(await group.getAttribute("open"), null);
  assert.equal(await page.locator(".delegation-card").isVisible(), false);
  assert.ok(await page.getByText("最终回复保持独立可见，正文继续输出", { exact: true }).isVisible());
  await head.click();
  assert.equal(await group.locator(".thinking-block").count(), 2, "reload keeps both thinking segments in one process");
  await head.click();
  publish({ id: "failed-reply", role: "assistant", text: "", thinking: "尝试生成回复", status: "failed", error: "模型请求失败" });
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-activity')].at(-1)?.getAttribute('data-status') === 'failed');
  assert.equal(await page.locator('.tool-activity[data-status="failed"]').count(), 1, "only the actual failed assistant process shows failure");
  assert.deepEqual(errors, []);
  console.log(`PASS: two-line header, animated three-dot status, one-shot progress-check drawing without replay on updates/toggles/history, thinking/task/notice grouping, stable streaming DOM, no expanded ticker, nested reset, keyboard, reduced motion, reload, 4 widths. ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
