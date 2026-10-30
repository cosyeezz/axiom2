import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { chatMessage } from "../src/server/transcript.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-process-display-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/process-unified");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const publish = (...messages: ChatMessage[]) => { for (const message of messages) views.messageChanged(scope, message); views.flush(scope); };
  const first: ChatMessage = { id: "first", role: "assistant", runId: "run", text: "", thinking: "**核对环境。**\n\n读取配置并确认依赖。", thinkingActive: true, streaming: true, status: "running" };
  const call = { id: "c", name: "bash", input: '{"command":"printf ready"}' };
  const tool: ChatMessage = { id: "tool", role: "assistant", runId: "run", text: "", calls: [call], streaming: true, status: "running" };
  const thought: ChatMessage = { id: "thought", role: "assistant", runId: "run", text: "", thinking: "继续检查。", thinkingActive: true, streaming: true, status: "running" };
  const setRequest = (runId = 'run', status = 'running') => {
    app!.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,?,'{}',1,'requesting') ON CONFLICT(id) DO UPDATE SET status=excluded.status,phase=excluded.phase").run(runId, session.id, status);
    views.changed(scope);
  };
  const clearRequest = () => { app!.store.db.prepare('DELETE FROM runs WHERE sessionId=?').run(session.id); views.changed(scope); };
  publish({ id: "user", role: "user", text: "检查环境", runId: "run" });
  setRequest();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const groups = page.locator('#messages .timeline-row > .tool-activity');
  const group = groups.first();
  const title = group.locator(':scope > summary .activity-title');
  const request = page.locator('.process-requesting');
  await request.getByText('请求中', { exact: true }).waitFor();
  assert.equal(await groups.count(), 0, 'initial request needs no fabricated activity or message');
  assert.equal(await request.locator('.process-ellipsis').count(), 1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await request.locator('.activity-title').evaluate(n => getComputedStyle(n).fontSize), width === 390 ? '14px' : '15px');
    assert.equal(await request.locator('.activity-title').evaluate(n => getComputedStyle(n).animationDuration), '3s');
    await page.screenshot({ path: join(artifacts, `${width}-requesting.png`) });
  }
  await page.reload();
  await request.getByText('请求中', { exact: true }).waitFor();
  for (const status of ['stopping', 'completed', 'failed', 'cancelled']) {
    setRequest('run', status);
    await request.waitFor({ state: 'detached' });
    setRequest();
    await request.waitFor();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  clearRequest(); publish({ ...first, thinking: '' });
  await request.waitFor({ state: 'detached' });
  await title.filter({ hasText: '正在思考' }).waitFor();
  const emptyHead = group.locator(':scope > summary');
  const assertEmptyClosed = async () => {
    assert.equal(await emptyHead.getAttribute('aria-disabled'), 'true');
    const height = await group.evaluate(n => n.getBoundingClientRect().height);
    await emptyHead.click();
    await emptyHead.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await emptyHead.tap();
    assert.equal(await group.getAttribute('open'), null, 'empty process ignores mouse, keyboard and touch');
    assert.equal(await group.evaluate(n => n.getBoundingClientRect().height), height, 'empty clicks do not change card size');
    assert.equal(await group.locator('.thinking-body').count(), 0);
    assert.equal(await emptyHead.evaluate(n => getComputedStyle(n).cursor), 'default');
    assert.equal(await emptyHead.evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await assertEmptyClosed();
  }
  publish({ ...first, thinking: '  \n\t' });
  await assertEmptyClosed();
  publish(first);
  await page.waitForFunction(() => !document.querySelector('.tool-activity > summary')?.hasAttribute('aria-disabled'));
  assert.equal(await group.getAttribute('open'), null, 'content arrival does not replay earlier empty clicks');
  await page.setViewportSize({ width: 1440, height: 900 });
  await title.filter({ hasText: '正在思考' }).waitFor();
  assert.equal(await title.evaluate(n => getComputedStyle(n).fontWeight), '700', 'live thinking title uses the bold running weight');
  assert.equal(await groups.count(), 1);
  assert.equal(await group.getAttribute('open'), null);
  assert.equal(await page.locator('.thinking-block, .tool-call, .tool-batch').count(), 0);
  assert.equal(await title.evaluate(n => getComputedStyle(n).fontStyle), 'normal');
  assert.deepEqual(await group.evaluate(n => ({ border: getComputedStyle(n).borderTopWidth, background: getComputedStyle(n).backgroundColor })), { border: '0px', background: 'rgba(0, 0, 0, 0)' }, 'live process is an unboxed disclosure');
  assert.equal(await group.locator(':scope > summary > .activity-status').count(), 0, 'running entry has no leading status icon or placeholder');
  assert.equal(await group.locator(':scope > summary > svg').count(), 0, 'ordinary process entry has no trailing disclosure arrow');
  assert.equal(await group.locator('.activity-overview').evaluate(n => getComputedStyle(n).gridColumnStart), '1');
  assert.equal(await title.evaluate(n => getComputedStyle(n).animationDuration), '3s');
  assert.equal(await title.locator('.process-ellipsis').count(), 1);
  const sweep = await title.evaluate(node => {
    const animation = node.getAnimations()[0];
    const dots = node.querySelector('.process-ellipsis')!;
    const parent = node.getBoundingClientRect(), glyph = dots.getBoundingClientRect();
    animation.pause(); animation.currentTime = 0;
    const start = getComputedStyle(node).backgroundPosition;
    const dotStart = getComputedStyle(dots).backgroundPositionX;
    animation.currentTime = 1000;
    const end = getComputedStyle(node).backgroundPosition;
    const dotEnd = getComputedStyle(dots).backgroundPositionX;
    const inheritedProgress = getComputedStyle(dots).getPropertyValue('--process-progress');
    const labelProgress = getComputedStyle(node).getPropertyValue('--process-progress');
    animation.currentTime = 2700;
    const pauseStart = [getComputedStyle(node).backgroundPosition, getComputedStyle(dots).backgroundPositionX];
    animation.currentTime = 2925;
    const pauseEnd = [getComputedStyle(node).backgroundPosition, getComputedStyle(dots).backgroundPositionX];
    const pulse = [...dots.querySelectorAll('circle')].map(circle => {
      const peak = Number(getComputedStyle(circle).getPropertyValue('--process-dot-peak'));
      const radii = [-.1, 0, .1].map(delta => {
        animation.currentTime = (peak + delta) * 2550;
        return parseFloat(getComputedStyle(circle).r);
      });
      animation.currentTime = peak * 2550;
      const whiteCenter = parseFloat(getComputedStyle(dots).backgroundPositionX) + parent.width * 1.25;
      return { peak, radii, whiteCenter, cx: circle.cx.baseVal.value };
    });
    animation.currentTime = 2925;
    const result = { start, end, fill: getComputedStyle(node).webkitTextFillColor,
      dotAnimations: dots.getAnimations().length, inheritedProgress, labelProgress, pauseStart, pauseEnd,
      dotStart, dotEnd, background: getComputedStyle(node).backgroundImage, dotsBackground: getComputedStyle(dots).backgroundImage,
      clip: getComputedStyle(dots).clipPath, pulse,
      gradientWidth: parseFloat(getComputedStyle(dots).backgroundSize), labelWidth: parent.width, offset: glyph.left - parent.left };
    animation.play(); return result;
  });
  assert.notEqual(sweep.start, sweep.end, 'the highlight actually moves');
  assert.match(sweep.background, /linear-gradient/);
  assert.equal(sweep.fill, 'rgba(0, 0, 0, 0)');
  assert.equal(sweep.dotsBackground, sweep.background, 'gray dots receive the actual white-highlight gradient');
  assert.match(sweep.clip, /url\(/);
  assert.equal(sweep.pulse.length, 3);
  for (const [index, dot] of sweep.pulse.entries()) {
    assert.ok(Math.abs(dot.radii[1] - 2) < .01, 'each dot reaches its original 2px radius at the light peak');
    assert.ok(dot.radii[0] < dot.radii[1] && dot.radii[2] < dot.radii[1], 'each dot expands as the light arrives and contracts as it leaves');
    assert.ok(Math.abs(dot.whiteCenter - dot.cx) < .01, 'the white highlight is centered exactly on the enlarged dot');
    if (index) assert.ok(dot.peak > sweep.pulse[index - 1].peak, 'dots peak from left to right with the sweep');
  }
  assert.equal(sweep.dotAnimations, 0, 'dots have no separate animation clock');
  assert.equal(sweep.inheritedProgress, sweep.labelProgress, 'dots inherit the text sweep progress');
  assert.deepEqual(sweep.pauseStart, sweep.pauseEnd, 'text and dots pause together at the end of each sweep');
  assert.notEqual(sweep.dotStart, sweep.dotEnd, 'advancing the text animation sweeps the same light through the dots');
  assert.ok(Math.abs(sweep.gradientWidth - sweep.labelWidth * 2.5) < .01, 'gradient width matches the full text, not the shorter dot glyph');
  assert.ok(Math.abs(parseFloat(sweep.dotStart) - (sweep.labelWidth * -1.5 - sweep.offset)) < .01);
  assert.ok(Math.abs(parseFloat(sweep.dotEnd) - (sweep.labelWidth * -1.5 * (1 - Number(sweep.labelProgress)) - sweep.offset)) < .01, 'text and dots use identical pixel speed and a continuous gradient origin');
  await page.locator('#prompt').fill('保留草稿');
  await group.evaluate(n => { (window as any).originalProcess = n; });
  await group.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  await group.locator('.thinking-header').waitFor();
  assert.equal(await group.evaluate(n => getComputedStyle(n).borderTopWidth), '1px', 'expanded process has a thin enclosing border');
  assert.deepEqual(await group.locator(':scope > .activity-content').evaluate(n => ({ left: getComputedStyle(n).paddingLeft, right: getComputedStyle(n).paddingRight })), { left: '10px', right: '10px' }, 'expanded process content is slightly inset');
  assert.equal(await group.locator('.thinking-header > .process-icon-think').count(), 0, 'expanded thought rows have no leading glyph');
  assert.equal(await group.locator('.thinking-label').evaluate(n => getComputedStyle(n).fontStyle), 'italic', 'Think stays italic while running');
  assert.equal(await group.locator('.thinking-label').evaluate(n => getComputedStyle(n).fontWeight), '400');
  assert.equal((await group.locator('.thinking-scroll-line').first().innerText()).trim(), '核对环境。');
  publish({ ...first, thinking: '**继续核对环境。**\n\n读取配置并确认依赖。' });
  await group.locator('.thinking-scroll-line').getByText('继续核对环境。', { exact: true }).waitFor();
  assert.ok(await group.getAttribute('open') !== null, 'streaming thought text updates without closing the process');
  publish(first);
  await group.locator('.thinking-scroll-line').getByText('核对环境。', { exact: true }).waitFor();
  assert.equal(await group.locator('.thinking-label .process-ellipsis').count(), 1);
  assert.match(await group.locator('.thinking-label').evaluate(n => getComputedStyle(n).backgroundImage), /rgb\(230, 216, 163\)/, 'Think sweep uses pale yellow');

  // A sibling tool keeps the outer group expandable, but an empty thought
  // inside it must still ignore activation until its own content arrives.
  publish({ ...first, thinking: '', calls: [call] });
  await group.locator('.tool-header').waitFor();
  const emptyThinking = group.locator('.thinking-block').first();
  const emptyThinkingHead = emptyThinking.locator(':scope > summary');
  await page.waitForFunction(() => document.querySelector('.thinking-header')?.getAttribute('aria-disabled') === 'true');
  await emptyThinkingHead.click();
  await emptyThinkingHead.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
  await emptyThinkingHead.tap();
  assert.equal(await emptyThinking.getAttribute('open'), null, 'empty inner thought ignores all activation');
  assert.equal(await emptyThinking.locator('.thinking-body').count(), 0);
  assert.equal(await emptyThinkingHead.evaluate(n => getComputedStyle(n).cursor), 'default');
  assert.ok(await group.getAttribute('open') !== null, 'tool content keeps its parent accessible');
  publish(first);
  await group.locator('.tool-header').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('.thinking-header')?.hasAttribute('aria-disabled'));
  assert.equal(await emptyThinking.getAttribute('open'), null, 'new thought content stays collapsed until requested');

  // Only the running, collapsed thought follows the newest visual line.
  const scroll = group.locator('.thinking-scroll');
  const scrollBody = group.locator('.thinking-scroll-content');
  const checkLatestVisible = async () => {
    await scrollBody.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.thinking-scroll')!.getBoundingClientRect();
      const content = document.querySelector('.thinking-scroll-content')!.getBoundingClientRect();
      return Math.abs(viewport.bottom - content.bottom) < 1;
    });
    assert.equal(await scroll.evaluate(n => n.getBoundingClientRect().height), 20);
    assert.notEqual(await scrollBody.evaluate(n => getComputedStyle(n).webkitTextFillColor), 'rgba(0, 0, 0, 0)', 'translated glyphs paint independently of the ancestor gradient clip');
    assert.deepEqual(await group.locator('.thinking-label').evaluate(n => ({ clip: getComputedStyle(n).backgroundClip, size: getComputedStyle(n).backgroundSize })), { clip: 'border-box', size: '0px 0px' }, 'the ancestor never ghost-paints clipped glyphs behind the moving preview');
    assert.match(await group.locator('.thinking-label .process-ellipsis').evaluate(n => getComputedStyle(n).backgroundImage), /linear-gradient/, 'the dots retain their original inherited gradient');
    assert.equal(await group.locator('.thinking-block[open], .thinking-body').count(), 0);
    assert.ok(await group.getAttribute('open') !== null);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  };
  await checkLatestVisible();
  assert.ok(await scrollBody.evaluate(n => n.getBoundingClientRect().top < n.parentElement!.getBoundingClientRect().top), 'old first line is above the one-line window');
  await page.evaluate(() => {
    (window as any).thinkingRolls = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      if (this.classList.contains('thinking-scroll-content')) (window as any).thinkingRolls.push(args[0]);
      return animate.apply(this, args);
    };
  });
  const rolling = '**核对环境。**\r\n\r\n读取配置并确认依赖。\r\n最新进展正在生成。';
  publish({ ...first, thinking: rolling });
  await scroll.getByText('最新进展正在生成。', { exact: true }).waitFor();
  await checkLatestVisible();
  const frames = await page.evaluate(() => (window as any).thinkingRolls.at(-1));
  assert.ok(frames && parseFloat(frames[0].transform.slice(11)) > parseFloat(frames[1].transform.slice(11)), 'new rows animate upward');
  const rollCount = await page.evaluate(() => (window as any).thinkingRolls.length);
  publish({ ...first, thinking: rolling + '继续。' });
  await scroll.getByText('最新进展正在生成。继续。', { exact: true }).waitFor();
  await checkLatestVisible();
  assert.equal(await page.evaluate(() => (window as any).thinkingRolls.length), rollCount, 'tokens within one visual line do not restart the roll');
  publish({ ...first, thinking: rolling + '继续。\n连续换行一。' });
  await scroll.getByText('连续换行一。', { exact: true }).waitFor();
  const painted = await scrollBody.evaluate(n => {
    const animation = n.getAnimations()[0];
    animation.pause(); animation.currentTime = 80;
    return new DOMMatrixReadOnly(getComputedStyle(n).transform).m42;
  });
  publish({ ...first, thinking: rolling + '继续。\n连续换行一。\n连续换行二。' });
  await scroll.getByText('连续换行二。', { exact: true }).waitFor();
  const continuedFrames = await page.evaluate(() => (window as any).thinkingRolls.at(-1));
  assert.ok(Math.abs(parseFloat(continuedFrames[0].transform.slice(11)) - painted) < 1, 'rapid new lines resume from the currently painted position');
  await checkLatestVisible();
  publish({ ...first, thinking: rolling + '继续。' });
  await scroll.getByText('最新进展正在生成。继续。', { exact: true }).waitFor();
  await group.locator('.thinking-header').click();
  await group.locator('.thinking-body').getByText('最新进展正在生成。继续。', { exact: true }).waitFor();
  assert.equal(await scroll.count(), 0, 'expanded thinking keeps the existing full-text view');
  await group.locator('.thinking-header').click();
  await checkLatestVisible();
  for (const length of [767, 768, 1023, 1024]) {
    const text = '尾段切换边界。\n' + 'x'.repeat(length - 8);
    const count = await page.evaluate(() => (window as any).thinkingRolls.length);
    const height = await scrollBody.evaluate(n => n.getBoundingClientRect().height);
    publish({ ...first, thinking: text });
    await page.waitForFunction(expected => Array.from(document.querySelectorAll('.thinking-scroll-line')).map(n => n.textContent?.trim()).join('\n') === expected, text);
    await checkLatestVisible();
    assert.deepEqual((await group.locator('.thinking-scroll-line').allTextContents()).map(line => line.trim()), text.split('\n'), 'chunk shifts preserve the buffer origin and natural wrapping');
    if (length === 768 || length === 1024) {
      const nextHeight = await scrollBody.evaluate(n => n.getBoundingClientRect().height);
      if (nextHeight === height) assert.equal(await page.evaluate(() => (window as any).thinkingRolls.length), count, 'transport chunk shifts alone never trigger a roll');
    }
  }
  publish({ ...first, thinking: '切换测试段。' });
  await scroll.getByText('切换测试段。', { exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const long = '首行保持原样。\n' + '不含换行的长段落自动折行，展示实时最新内容。'.repeat(100) + '当前尾部标记';
    publish({ ...first, thinking: long });
    await scrollBody.getByText(/当前尾部标记/).waitFor();
    await checkLatestVisible();
    assert.ok((await scrollBody.innerText()).length < 800, 'long thoughts use a bounded live tail, not the stale 320-character prefix or the full transcript');
    const geometry = await scrollBody.evaluate(n => {
      const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let last: Node | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.trim()) last = node;
      const range = document.createRange(); range.setStart(last!, last!.textContent!.length - 1); range.setEnd(last!, last!.textContent!.length);
      const glyph = range.getBoundingClientRect(), viewport = n.parentElement!.getBoundingClientRect();
      return { visible: glyph.bottom <= viewport.bottom + 2 && glyph.top >= viewport.top - 2, wrapped: n.getBoundingClientRect().height > 20 };
    });
    assert.deepEqual(geometry, { visible: true, wrapped: true }, 'the newest character, including natural paragraph wrapping, is visible');
    await page.screenshot({ path: join(artifacts, `${width}-thinking-scroll.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedCount = await page.evaluate(() => (window as any).thinkingRolls.length);
  publish({ ...first, thinking: rolling + '\n减少动效时仍能看到最新内容。' });
  await scroll.getByText('减少动效时仍能看到最新内容。', { exact: true }).waitFor();
  await checkLatestVisible();
  assert.equal(await page.evaluate(() => (window as any).thinkingRolls.length), reducedCount);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const status of ['failed', 'cancelled'] as const) {
    publish({ ...first, thinkingActive: false, streaming: false, status });
    await group.locator('.thinking-text').getByText(status === 'failed' ? '思考失败' : '思考已停止', { exact: true }).waitFor();
    assert.equal(await scroll.count(), 0);
  }
  publish({ ...first, thinkingActive: false, streaming: false, status: 'completed' });
  await group.locator('.thinking-text').getByText('核对环境。', { exact: true }).waitFor();
  assert.equal(await scroll.count(), 0, 'completed thinking restores the existing first-line preview');
  await group.locator(':scope > summary').click();
  await group.locator(':scope > summary').click();
  assert.equal(await group.locator('.thinking-block[open]').count(), 0, 'outer disclosure retains its reset behavior');
  await page.setViewportSize({ width: 1440, height: 900 });

  publish({ ...first, thinkingActive: false, streaming: false, status: 'completed' }, tool,
    { id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: '', status: 'running', toolStartedAt: Date.now() });
  await title.filter({ hasText: '调用工具' }).waitFor();
  await group.locator('.tool-call').waitFor();
  assert.ok(await group.evaluate(n => n === (window as any).originalProcess && n.hasAttribute('open')));
  assert.equal(await group.locator('.tool-duration').count(), 0, 'running tools hide elapsed time for the first two seconds');
  await group.locator('.tool-duration').waitFor();
  const elapsed = parseFloat(await group.locator('.tool-duration').innerText());
  await page.waitForTimeout(250);
  assert.ok(parseFloat(await group.locator('.tool-duration').innerText()) > elapsed);
  const bashPaint = await group.locator('.process-icon-bash path').first().evaluate(n => ({ fill: getComputedStyle(n).fill, color: getComputedStyle(n).color, stroke: getComputedStyle(n).stroke }));
  assert.equal(bashPaint.fill, 'none'); assert.equal(bashPaint.stroke, bashPaint.color);
  assert.equal(await group.locator('.tool-name').innerText(), '执行命令');
  assert.equal(await group.locator('.process-icon-bash').evaluate(n => getComputedStyle(n).width), '13px');
  assert.ok(await group.locator('.thinking-label, .tool-name, .tool-target, .tool-duration').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).fontSize === '13px')), 'thoughts and tools use compact text distinct from the reply');
  assert.ok(await group.locator('.thinking-header, .tool-header').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height === 32)), 'touch single-line rows are compact at 32px');
  assert.equal(await group.locator('.tool-heading .tool-name').evaluate(n => getComputedStyle(n).fontWeight), '400', 'single tool rows use regular weight');
  await group.locator('.tool-header').click();
  await group.locator('.tool-detail').waitFor();
  publish({ ...tool, streaming: false, status: 'completed' },
    { id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: 'ready', status: 'completed', durationMs: 1500 });
  setRequest();
  await title.filter({ hasText: '调用工具' }).waitFor();
  assert.equal(await title.innerText(), '调用工具', 'tool continuation requesting retains the latest actual activity');
  assert.equal(await request.count(), 0, 'tool continuation reuses the existing process title');
  assert.equal(await group.locator('.tool-call[open]').count(), 1, 'requesting preserves expanded tool details');
  assert.equal(await title.getAttribute('data-thinking'), null, 'a follow-up request does not invent thinking');
  clearRequest(); publish(thought);
  await title.filter({ hasText: '正在思考' }).waitFor();
  assert.equal(await group.locator('.tool-result-state .process-outcome').count(), 0, 'successful tool rows have no checkmark or icon placeholder');
  assert.equal(await group.locator('.tool-duration').count(), 0, 'fast completed calls retain their tool row without duration');
  for (const [durationMs, latency] of [[2000, null], [2001, 'normal'], [10000, 'normal'], [10001, 'slow'], [60000, 'slow'], [60001, 'long']] as const) {
    publish({ id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: 'ready', status: 'completed', durationMs });
    await page.waitForFunction(({ latency, durationMs }) => {
      const duration = document.querySelector('.tool-duration');
      return latency === null ? duration === null : duration?.getAttribute('data-latency') === latency && duration.textContent === `${(durationMs / 1000).toFixed(1)}s`;
    }, { latency, durationMs });
    if (latency === 'slow' || latency === 'long') assert.equal(await group.locator('.tool-duration').evaluate(n => getComputedStyle(n).color), latency === 'slow' ? 'rgb(230, 164, 91)' : 'rgb(217, 149, 149)');
  }
  for (const [elapsedMs, latency] of [[10100, 'slow'], [60100, 'long']] as const) {
    publish({ id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: '', status: 'running', toolStartedAt: Date.now() - elapsedMs });
    await group.locator(`.tool-duration[data-latency="${latency}"]`).waitFor();
    assert.equal(await group.locator('.tool-duration').evaluate(n => getComputedStyle(n).color), latency === 'slow' ? 'rgb(230, 164, 91)' : 'rgb(217, 149, 149)');
  }
  publish({ id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: '运行期失败夹具', status: 'failed', durationMs: 1500 });
  await group.locator('.process-counts [data-status="failed"]').waitFor();
  assert.equal(await group.getAttribute('data-status'), 'running');
  assert.deepEqual(await group.locator('.process-counts > span').allTextContents(), ['成功 0', '失败 1'], 'a failure reveals both counters while running');
  publish({ id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: 'ready', status: 'completed', durationMs: 1500 });
  await group.locator('.process-counts').waitFor({ state: 'detached' });
  await group.locator('.tool-duration').waitFor({ state: 'detached' });
  assert.equal(await group.locator('.tool-call[open]').count(), 1, 'phase changes retain expanded tools');
  assert.deepEqual(await group.locator('.thinking-block, .tool-call').evaluateAll(nodes => nodes.map(n => n.classList.contains('tool-call') ? 'tool' : 'thinking')), ['thinking', 'tool', 'thinking']);
  assert.equal(await group.locator('.tool-batch').count(), 0, 'there is no second aggregate layer');
  publish({ ...thought, thinkingActive: false, streaming: false, status: 'completed' },
    { id: 'task', role: 'assistant', runId: 'run', text: '', calls: [{ id: 'task-call', name: 'append', input: '{"taskId":"task-demo","text":"补充检查"}' }] },
    { id: 'tool-task-call', role: 'toolResult', toolCallId: 'task-call', text: '{}', status: 'completed' });
  await title.filter({ hasText: '执行完成' }).waitFor();
  assert.equal(await group.locator('.process-counts').count(), 0, 'successful calls do not show counters');
  await page.locator('#messages .timeline-row > .task-operation').waitFor();
  setRequest();
  await request.waitFor();
  assert.equal(await title.innerText(), '执行完成', 'a settled local segment keeps its completed label during a separate request');
  assert.equal(await request.count(), 1);
  clearRequest();
  await request.waitFor({ state: 'detached' });
  const singleThought = group.locator('.thinking-block').last();
  await singleThought.locator('summary').focus(); await page.keyboard.press('Enter');
  await singleThought.locator('.thinking-body').getByText('继续检查。', { exact: true }).waitFor();
  assert.equal(await singleThought.locator('.thinking-label').evaluate(n => getComputedStyle(n).color), 'rgb(230, 216, 163)', 'completed Think uses pale yellow');
  await singleThought.locator('summary').click();
  assert.equal(await singleThought.locator('.thinking-body').count(), 0, 'even short single-line thoughts expand and collapse');
  assert.equal(await group.locator('.task-operation').count(), 0, 'subagent operations are outside the process');
  assert.equal(await title.innerText(), '执行完成', 'a subagent card settles only the local process, not the whole user turn');
  assert.equal(await title.evaluate(n => getComputedStyle(n).color), 'rgb(156, 163, 175)');
  assert.equal(await group.locator(':scope > summary > .activity-status').count(), 0, 'ordinary completed segments have no checkmark');
  assert.equal(await group.locator('.activity-overview').evaluate(n => getComputedStyle(n).gridColumnStart), '1', 'completion keeps the text aligned with running state');
  publish({ id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: '失败夹具', status: 'failed', durationMs: 1500 });
  await group.locator('.process-counts [data-status="failed"]').waitFor();
  assert.deepEqual(await group.locator('.process-counts > span').allTextContents(), ['成功 0', '失败 1'], 'completed segments retain both counters if a tool failed');
  assert.equal(await group.locator('.process-counts [data-status="failed"]').evaluate(n => getComputedStyle(n).color), 'rgb(217, 149, 149)');
  assert.equal(await group.getAttribute('data-status'), 'completed', 'a failed tool does not fail the whole process');

  // Prose closes the preceding entry, including delayed stale thinking/tool events.
  publish({ id: 'narration', role: 'assistant', runId: 'run', phase: 'commentary', text: '已检查环境，继续处理配置。', streaming: true });
  await page.getByText('已检查环境，继续处理配置。', { exact: true }).waitFor();
  publish({ id: 'narration', role: 'assistant', runId: 'run', phase: 'commentary', text: '已检查环境，继续处理配置。', status: 'completed' });
  const narration = page.locator('.log-row.message-result').filter({ hasText: '已检查环境，继续处理配置。' });
  await narration.waitFor();
  assert.equal(await narration.locator('.reply-actions').count(), 0, 'completed commentary is process content and has no copy button');
  assert.equal(await narration.evaluate(n => getComputedStyle(n).borderTopWidth), '0px', 'completed narration has no divider above the body');
  publish(first, { id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: '', status: 'running', toolStartedAt: Date.now() });
  await page.waitForFunction(() => document.querySelector('.tool-activity')?.getAttribute('data-settled') === 'true');
  assert.equal(await title.innerText(), '执行完成', 'settled local tools show completion even after stale running deltas');
  assert.equal(await group.locator('.process-status-text.is-active, .thinking-indicator').count(), 0, 'no stale intermediate display above prose');
  publish({ id: 'next', role: 'assistant', runId: 'run', text: '', thinking: '核对配置内容。', thinkingActive: true, streaming: true, status: 'running' });
  await page.waitForFunction(() => document.querySelectorAll('#messages .timeline-row > .tool-activity').length === 2);
  const next = groups.last();
  await next.locator(':scope > summary .activity-title').filter({ hasText: '正在思考' }).waitFor();
  assert.deepEqual(await page.locator('#messages .timeline-row > .tool-activity, #messages .timeline-row > .log-row:has(.reply-body)').evaluateAll(nodes => nodes.map(n => n.matches('details') ? 'process' : 'body')), ['process', 'body', 'process']);
  await group.locator(':scope > summary').click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const textSizes = await page.locator('.reply-body > .markdown, .task-operation-heading strong, .tool-activity > summary .activity-title').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).fontSize));
    assert.ok(textSizes.length > 0 && textSizes.every(size => size === (width <= 640 ? '14px' : '15px')), `reply, process and subagent text sizes at ${width}px`);
    await next.locator('.activity-title').evaluate(node => {
      const animation = node.getAnimations()[0];
      animation.pause();
      const middle = node.querySelectorAll('.process-ellipsis circle')[1];
      animation.currentTime = Number(getComputedStyle(middle).getPropertyValue('--process-dot-peak')) * 2550;
    });
    await page.screenshot({ path: join(artifacts, `${width}-live.png`) });
    await next.locator('.activity-title').evaluate(node => node.getAnimations()[0].play());
  }
  publish({ ...first, thinkingActive: false, streaming: false, status: 'completed' },
    { id: 'tool-c', role: 'toolResult', toolCallId: 'c', text: 'ready', status: 'completed', durationMs: 1500 },
    { id: 'next', role: 'assistant', runId: 'run', text: '', thinking: '核对配置内容。', status: 'completed' });
  const final = chatMessage({ role: 'assistant', axiomRunId: 'run', api: 'openai-responses', stopReason: 'stop', content: [{ type: 'thinking', thinking: '结果已核对。' }, { type: 'text', text: '环境检查完成。' }] }, 'final', true)!;
  publish({ id: 'narration2', role: 'assistant', runId: 'run', phase: 'commentary', text: '配置已经核对，准备交付。' });
  await page.getByText('配置已经核对，准备交付。', { exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const spacing = await next.evaluate(node => {
      const row = node.closest('.timeline-row');
      const before = node.previousElementSibling ?? row?.previousElementSibling?.querySelector('.log-row');
      const after = node.nextElementSibling ?? row?.nextElementSibling?.querySelector('.log-row');
      if (!before || !after) throw Error('Expected narration rows around the process');
      const rect = node.getBoundingClientRect();
      return { above: rect.top - before.getBoundingClientRect().bottom,
        below: after.getBoundingClientRect().top - rect.bottom,
        beforePadding: getComputedStyle(before).paddingBottom, afterPadding: getComputedStyle(after).paddingTop };
    });
    assert.deepEqual(spacing, { above: 8, below: 8, beforePadding: '0px', afterPadding: '0px' }, `process spacing is compact and symmetric at ${width}px`);
    await page.screenshot({ path: join(artifacts, `${width}-spacing.png`) });
  }
  await page.evaluate(() => {
    (window as any).foldFrames = [];
    const observer = new MutationObserver(() => {
      const card = document.querySelector('#messages .timeline-row > .tool-activity[data-folding="true"]');
      if (!card) return;
      (window as any).foldFrames = card.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.height));
      observer.disconnect();
    });
    observer.observe(document.querySelector('#messages')!, { subtree: true, childList: true, attributes: true });
  });
  publish(final);
  await page.getByText(final.text, { exact: true }).waitFor();
  assert.equal(await page.locator('.timeline-row > .tool-activity:not(.process-live)').count(), 0, 'streaming final cannot create the delivered outer card');
  assert.equal(await page.getByText('已检查环境，继续处理配置。', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('#messages .timeline-row > .task-operation').isVisible(), true);
  assert.equal(await page.locator('.reply-actions').count(), 0, 'streaming final has no delivery actions');
  publish({ ...final, streaming: false, status: 'completed' });
  await page.waitForFunction(() => document.querySelectorAll('#messages .timeline-row > .tool-activity').length === 1 && !document.querySelector('#messages .timeline-row > .tool-activity[open]'));
  assert.ok(await page.evaluate(() => {
    const heights = (window as any).foldFrames.map(parseFloat);
    return heights.length === 2 && heights[0] > heights[1];
  }), 'final delivery animates from the visible process height to the closed card');
  assert.equal(await group.getAttribute('open'), null);
  assert.equal(await title.innerText(), '执行完成');
  await page.getByText(final.text, { exact: true }).waitFor();
  await page.getByRole('button', { name: '复制回复的 Markdown 原文' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('.reply-actions').count(), 1, 'only the finished final delivery can be copied');
  setRequest('next-run');
  await request.waitFor();
  assert.equal(await title.innerText(), '执行完成', 'a later request never reactivates folded history');
  assert.equal(await request.count(), 1);
  clearRequest();
  await request.waitFor({ state: 'detached' });
  await group.locator(':scope > summary').click();
  assert.equal(await group.locator('.tool-detail, .thinking-body').count(), 0);
  assert.equal(await group.getByText(final.text, { exact: true }).count(), 0);
  assert.equal(await page.locator('#messages .timeline-row > .task-operation').count(), 0, 'final folding keeps tasks in their original timeline inside the card');
  assert.equal(await group.locator(':scope > .activity-content > .task-operation').count(), 1);
  assert.equal(await group.evaluate(n => getComputedStyle(n).borderTopWidth), '1px', 'only the final aggregate uses the card surface');
  assert.deepEqual(await group.locator(':scope > .activity-content > .tool-activity, :scope > .activity-content > .log-row, :scope > .activity-content > .task-operation').evaluateAll(nodes => nodes.map(node => node.matches('.task-operation') ? 'task' : node.matches('details') ? node.querySelector('.activity-title')?.textContent : node.textContent?.trim())),
    ['执行完成', 'task', '已检查环境，继续处理配置。', '执行完成', '配置已经核对，准备交付。', '执行完成']);
  const segments = group.locator(':scope > .activity-content > .tool-activity');
  assert.equal(await group.locator(':scope > summary .activity-status-completed').count(), 1, 'only the final card keeps its completion icon');
  assert.equal(await segments.locator(':scope > summary .activity-status-completed').count(), 0);
  assert.equal(await segments.locator(':scope > summary > svg').count(), 0);
  assert.equal(await group.locator(':scope > summary > svg').count(), 1, 'the final folding card keeps its disclosure affordance');
  assert.ok(await segments.locator('.activity-title').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).color === 'rgb(156, 163, 175)')));
  assert.equal(await segments.locator('.process-status-text.is-active').count(), 0);
  await page.screenshot({ path: join(artifacts, '390-final-segments.png') });
  await segments.first().locator(':scope > summary').click();
  const thinkingPreview = await group.locator('.thinking-label').first().textContent();
  const firstLinePosition = await group.locator('.thinking-text strong').first().evaluate(node => {
    const text = node.getBoundingClientRect(), block = node.closest('.thinking-block')!.getBoundingClientRect();
    return { x: text.x - block.x, y: text.y - block.y };
  });
  await group.locator('.thinking-block').first().locator('summary').click();
  await group.locator('.thinking-body').first().getByText('读取配置并确认依赖。', { exact: true }).waitFor();
  const typography = await group.locator('.thinking-body').first().evaluate(n => ({ font: getComputedStyle(n).fontSize, line: getComputedStyle(n).lineHeight, paragraphs: [...n.querySelectorAll('p')].map(p => parseFloat(getComputedStyle(p).marginBottom)) }));
  assert.deepEqual(await group.locator('.thinking-body').first().evaluate(n => ({ color: getComputedStyle(n).color, style: getComputedStyle(n).fontStyle })), { color: 'rgb(230, 216, 163)', style: 'italic' });
  assert.equal(await group.locator('.thinking-body strong').first().evaluate(n => getComputedStyle(n).fontWeight), '400', 'Markdown emphasis in thinking stays regular weight');
  assert.equal(await group.locator('.thinking-label').first().textContent(), thinkingPreview, 'expansion retains the preview for collapse');
  assert.equal(await group.locator('.thinking-text').first().evaluate(n => getComputedStyle(n).visibility), 'hidden', 'expanded thinking does not repeat its first line above the body');
  assert.equal(await group.locator('.thinking-text').first().getAttribute('aria-hidden'), 'true', 'the duplicate preview is also hidden from assistive technology');
  assert.deepEqual(await group.locator('.thinking-body strong').first().evaluate(node => {
    const text = node.getBoundingClientRect(), block = node.closest('.thinking-block')!.getBoundingClientRect();
    return { x: text.x - block.x, y: text.y - block.y };
  }), firstLinePosition, 'expanded text begins at the original first-line position');
  assert.equal(await group.locator('.thinking-header svg').count(), 0, 'completed thinking has no extra disclosure icon');
  assert.equal(await group.locator('.thinking-header').first().getAttribute('aria-label'), '收起思考');
  assert.equal(await group.locator('.thinking-label').first().evaluate(n => getComputedStyle(n).fontWeight), '400');
  assert.equal(typography.font, '13px'); assert.equal(typography.line, '20px'); assert.ok(typography.paragraphs.every(n => n <= 6));
  assert.ok(await group.locator('.activity-message').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).paddingBottom === '0px')));
  await page.screenshot({ path: join(artifacts, '390-final-expanded.png') });
  publish({ ...final, text: `${final.text}全部通过。`, streaming: false, status: 'completed' });
  assert.ok(await group.getAttribute('open') !== null);
  assert.equal(await page.locator('#prompt').inputValue(), '保留草稿');
  await page.reload(); await group.waitFor();
  assert.equal(await group.getAttribute('open'), null); assert.equal(await title.innerText(), '执行完成');

  const pathCalls = [
    { id: 'path-short', name: 'read', input: JSON.stringify({ path: '/tmp/a.ts', offset: 1, limit: 20 }) },
    { id: 'path-long', name: 'read', input: JSON.stringify({ path: '/Volumes/D_Work/axiom2/app/src/client/chat/components/very-long-directory-name/FilePreviewHost.tsx', offset: 1, limit: 2000 }) },
    { id: 'path-write', name: 'write', input: JSON.stringify({ path: '/Users/dane/.axiom/memory/12345678-1234-1234-1234-123456789abc/MEMORY.md', content: 'first\nsecond' }) },
    { id: 'path-image', name: 'read', input: JSON.stringify({ path: '/Users/dane/Library/Application Support/Axiom2/attachments/12345678-1234-1234-1234-123456789abc/image.png' }) },
  ];
  publish({ id: 'path-user', role: 'user', runId: 'path-run', text: '检查工具路径显示' },
    { id: 'path-tools', role: 'assistant', runId: 'path-run', text: '', calls: pathCalls, status: 'completed' },
    ...pathCalls.map(call => ({ id: `tool-${call.id}`, role: 'toolResult' as const, toolCallId: call.id, text: 'done', status: 'completed' as const, durationMs: 1500 })));
  const pathGroup = page.locator('#messages .timeline-row > .tool-activity[data-call-count="4"]');
  await pathGroup.waitFor();
  await pathGroup.locator(':scope > summary').click();
  const pathRows = pathGroup.locator('.tool-call');
  await pathRows.nth(3).waitFor();
  for (const width of [1440, 650, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const measurements = await pathRows.evaluateAll(rows => rows.map(row => {
      const container = row.querySelector('.process-status-text')!.getBoundingClientRect();
      const path = row.querySelector('.local-path')!.getBoundingClientRect();
      const text = row.querySelector('.local-path-text')!;
      const detail = row.querySelector('.tool-input-detail')?.getBoundingClientRect();
      return { contained: path.left >= container.left && path.right <= container.right + 1,
        textWidth: text.getBoundingClientRect().width, clipped: text.scrollWidth > text.clientWidth + 1,
        detailVisible: !detail || detail.right <= container.right + 1 && detail.left >= path.right - 1 };
    }));
    for (const measurement of measurements) {
      assert.ok(measurement.contained, `path widget must fit beside its label at ${width}px, not be replaced wholesale by an ellipsis`);
      assert.ok(measurement.textWidth > 30, `available row space must show path text at ${width}px`);
      assert.ok(measurement.detailVisible, `line range stays visible beside the path at ${width}px`);
    }
    if (width === 1440) assert.equal(measurements[0].clipped, false, 'short paths remain fully readable');
    if (width === 390) assert.equal(measurements[1].clipped, true, 'long path text truncates within its own bounds');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `${width}-tool-paths.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: unified thinking/tool entry, upright process label and pale-yellow italic clickable Think, phase changes and stable expansion, chronological details, red failure counts, frozen process above prose even after stale deltas, active process below prose, final folding, full thinking, mobile density, reload and draft retention. Artifacts: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
