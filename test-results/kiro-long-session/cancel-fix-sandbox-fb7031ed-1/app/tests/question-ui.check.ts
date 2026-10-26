// Fully isolated: real Message/Thread/Composer components, mock HTTP and WS only.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page, type WebSocketRoute } from "playwright";
import { emptyAgent, emptyThread, type ChatMessage } from "../src/shared/agent.js";
import { emptyTasks } from "../src/shared/tasks.js";
import { emptyCostTotals } from "../src/shared/costs.js";
import type { Command } from "../src/shared/protocol.js";
const artifacts = mkdtempSync(join(tmpdir(), "axiom-question-ui-"));
const scope = { workspaceId: "work", sessionId: "session" };
const selection = { provider: "fixture", id: "fixture", thinking: "off" };
const text = `先确认这几个方向，再开始实现。\n<Question type="single">\n你希望采用哪种实现方式？\n1. 轻量起步 — 保持简单，先跑通核心流程\n  先验证核心流程，适合方向尚未确定的阶段。\n  原样文本安全检查：<img src=x onerror=alert(1)>\n2. 完整方案 — 包含边界处理与可维护性设计\n</Question>\n<Question type="multiple">\n这次需要覆盖哪些验证？\n1. 单元测试与协议边界\n2. 浏览器交互与窄屏布局\n3. 长文本与极端输入：${"very-long-option-without-spaces".repeat(6)}\n  ${"long-description-without-spaces".repeat(12)}\n</Question>\n<Question type="single">\n发布节奏怎么安排？\n1. 分阶段上线\n2. 一次性交付\n</Question>`;
const message: ChatMessage = { id: "answer", role: "assistant", phase: "final_answer", status: "completed", text };
const expandedMessage = { ...message, text: text + '\n完整文本保留标记' };
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {connect,useConnectionState} from '/transport.ts';import {Icons} from '/components.tsx';
import {Message} from '/chat/Message.tsx';import {AgentThread} from '/chat/AgentThread.tsx';import {Composer} from '/chat/Composer.tsx';
import {getDraft} from '/drafts.ts';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/chat.css';import '/styles/theme.css';import '/styles/mobile.css';
const h=React.createElement,root=createRoot(document.getElementById('root')),scope=${JSON.stringify(scope)};
let generation=0;
function Probe(){const c=useConnectionState();return h('output',{'data-connected':String(c.connected)});}
window.getFixtureDraft=()=>getDraft(scope);
window.modalFixture=()=>{const dialog=document.createElement('dialog');dialog.style.cssText='padding:0;width:min(850px,100%);max-width:none;max-height:none;height:100dvh;border:0';document.body.append(dialog);dialog.append(document.getElementById('root'));dialog.showModal();window.renderFixture();};
window.renderFixture=(mode='live')=>{generation++;root.render(h(React.Fragment,{},h(Icons),h(Probe),h('main',{className:'workspace',style:{display:'flex',flexDirection:'column',height:'100dvh',boxSizing:'border-box',padding:'16px',maxWidth:'850px',margin:'auto'}},h('div',{className:'fixture-thread',style:{flex:1,minHeight:0,overflow:'auto',display:'flex',flexDirection:'column'}},mode==='hidden'?null:mode==='thread'?h(AgentThread,{scope}):h(Message,{key:generation,scope,id:'answer'})),mode==='unmounted'?null:h(Composer,{scope}))));};
window.renderFixture();connect();`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "cache"),
  plugins: [{ name: "question-fixture", resolveId(id) { if (id === "virtual:question-fixture") return id; }, load(id) { if (id === "virtual:question-fixture") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen();
const origin = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce", serviceWorkers: "block" });
const page = await context.newPage();page.setDefaultTimeout(15000);
let socket: WebSocketRoute | undefined, seq = 0, draftRevision = 0, promptMode: "accepted" | "uncertain" | "failed" = "accepted";
const errors: string[] = [], blocked: string[] = [], commands: Command[] = [];
const snapshots = new Map<string, unknown>([
  ["configuration", { revision: "1", providerCount: 1, modelCount: 1, dataRoot: "fixture", available: [{ ...selection, name: "Fixture", levels: ["off"] }] }],
  ["agent:work:session", { ...emptyAgent, selection }], ["tasks:work:session", emptyTasks],
  ["thread:work:session", { ...emptyThread, ids: ["answer"], groups: [{ id: "answer", ids: ["answer"], activity: false }] }],
  ["messages:work:session", [message]],
]);
const publish = (name: string, data: unknown) => { snapshots.set(name, data);socket!.send(JSON.stringify({ type: "snapshot", scope: name, streamId: "fixture", seq: ++seq, data })); };
const prompts = () => commands.filter(c => c.op === "prompt");
const routeFixture = async (target: Page) => {
  target.on("pageerror", e => errors.push(e.message));
  await target.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) { blocked.push(url.href);return route.abort(); }
    if (url.pathname === "/question-check") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:question-fixture"></script></body></html>' });
    if (url.pathname === "/@vite/client") return route.fulfill({ contentType: "application/javascript", body: `const styles=new Map();export function updateStyle(id,content){let n=styles.get(id);if(!n){n=document.createElement('style');document.head.append(n);styles.set(id,n)}n.textContent=content}export function removeStyle(id){styles.get(id)?.remove();styles.delete(id)}export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}export const injectQuery=u=>u;` });
    if (url.pathname === "/api/status") return route.fulfill({ json: {} });
    if (url.pathname === "/api/draft") { const write = route.request().postDataJSON();return route.fulfill({ json: write ? { revision: ++draftRevision, writer: write.writer, sequence: write.sequence } : { revision: draftRevision, draft: { text: "保留这个未发送的草稿", attachment: null } } }); }
    if (url.pathname.startsWith("/api/")) { blocked.push(url.pathname);return route.abort(); }
    return route.continue();
  });
  await target.routeWebSocket("**/*", s => {
    if (new URL(s.url()).pathname !== "/ws") { blocked.push(s.url());s.close();return; }
    socket = s;s.send(JSON.stringify({ type: "hello", streamId: "fixture" }));
    s.onMessage(raw => {
      const c = JSON.parse(raw.toString()) as Command;commands.push(c);
      const reply = (data: unknown) => s.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
      if (c.op === "subscribe") { const name = String(c.params?.scope);if (snapshots.has(name)) publish(name, snapshots.get(name));reply({}); }
      else if (["unsubscribe", "ping", "agent.read"].includes(c.op)) reply({});
      else if (c.op === "agent.history.index") reply({ revision: "1", segments: [] });
      else if (c.op === "agent.environment") reply(null);
      else if (c.op === "message.get") reply(expandedMessage);
      else if (c.op === "costs.get") reply({ scope, requestedSessionId: scope.sessionId, title: "Fixture", updatedAt: 0, rows: [], sessions: [], total: emptyCostTotals(), warnings: [] });
      else if (c.op === "prompt") {
        if (promptMode === "accepted") reply({ accepted: true, inputId: c.requestId });
        else s.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: promptMode === "uncertain" ? "UNCERTAIN" : "REJECTED", message: "fixture result" } }));
      } else if (c.op === "agent.inputs") reply((c.params!.ids as string[]).map(id => ({ id, consumed: false, receipt: { status: "uncertain" } })));
      else { blocked.push(c.op);reply(null); }
    });
  });
};
try {
  await routeFixture(page);
  await page.goto(origin + "question-check?workspaceId=work&sessionId=session");
  await page.locator('[data-connected="true"]').waitFor({ state: "attached" });
  await page.locator(".model-question input").first().waitFor({ state: "attached" });
  await page.waitForFunction(() => !(document.querySelector('.model-question fieldset') as HTMLFieldSetElement)?.disabled);
  await page.waitForFunction(() => (document.querySelector('#prompt') as HTMLTextAreaElement)?.value === '保留这个未发送的草稿');
  const fields = page.locator(".model-question fieldset");assert.equal(await fields.count(), 3);
  const popup = page.locator('.model-question-popover');
  assert.equal(await page.getByRole('dialog', { name: '模型提问', exact: true }).count(), 1);
  const noExtraUI = async () => {
    assert.equal(await page.getByRole('button', { name: /^(收起|回答问题)/ }).count(), 0, 'no collapse or reopen button');
    assert.equal(await page.locator('.composer-question-entry, .composer-question-trigger, .model-question-record').count(), 0, 'no question notices or records');
  };
  await noExtraUI();
  const geometry = async () => {
    // ResizeObserver and viewport listeners intentionally position on the next frame.
    await page.waitForFunction(() => {
      const panel = document.querySelector('.model-question-popover')?.getBoundingClientRect();
      const composer = document.querySelector('.composer')?.getBoundingClientRect();
      return panel && composer && Math.abs(panel.width - Math.min(composer.width, innerWidth - 24, 680)) <= 1 &&
        Math.abs(panel.bottom - (composer.top - 8)) <= 1 && panel.top >= 11;
    });
    const panel = await popup.boundingBox(), composer = await page.locator('.composer').boundingBox();
    assert.ok(panel && composer);assert.ok(panel.y >= 11, 'popup stays inside viewport');
    assert.ok(Math.abs(panel.y + panel.height - (composer.y - 8)) <= 1, 'popup anchored 8px above input');
    assert.ok(Math.abs(panel.width - Math.min(composer.width, page.viewportSize()!.width - 24, 680)) <= 1, 'popup has a readable 680px cap and shrinks with Composer');
    assert.ok(Math.abs(panel.x - Math.max(12, composer.x)) <= 1, 'popup keeps the Composer leading edge');
  };
  await geometry();
  assert.equal(await page.locator('.log-row .model-question, .log-row input, .log-row textarea').count(), 0, 'no interactive question card in transcript');
  assert.equal(await page.locator('.log-row .reply-body').textContent(), '先确认这几个方向，再开始实现。', 'only ordinary prose remains in transcript');
  assert.equal(await popup.evaluate(el => el.closest('.composer-area') === null), true, 'portal escapes composer overflow/contain');
  // With no reopen entry, outside clicks/Escape must not strand unanswered questions.
  await page.locator('#prompt').click();
  assert.equal(await popup.isVisible(), true);
  assert.equal(await page.locator('#prompt').evaluate(el => el === document.activeElement), true);
  await fields.nth(0).locator('input').first().focus();
  await page.keyboard.press('Escape');
  assert.equal(await popup.isVisible(), true);
  await page.evaluate(() => (window as any).renderFixture());
  await noExtraUI();
  // Descriptions are an independent, keyboard-operable disclosure, not a choice.
  assert.equal(await page.locator('.model-question-details').count(), 2);
  assert.equal(await fields.nth(2).locator('summary').count(), 0, 'no empty disclosure for undescribed choices');
  const details = fields.nth(0).locator('.model-question-details');
  assert.equal(await details.getAttribute('open'), null);
  const summary = details.locator('summary');
  await summary.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.model-question-details')?.hasAttribute('open'));
  assert.equal(await fields.nth(0).locator('input:checked').count(), 0);
  assert.equal(prompts().length, 0);
  assert.ok((await details.locator('dd').textContent())!.includes('<img src=x onerror=alert(1)>'));
  assert.equal(await details.locator('img, script, a').count(), 0, 'description is inert plain text');
  const descriptionId = await fields.nth(0).locator('input').first().getAttribute('aria-describedby');
  assert.ok(descriptionId);
  assert.equal(await details.locator('dd').getAttribute('id'), descriptionId);
  assert.equal(await fields.nth(0).locator('input').nth(1).getAttribute('aria-describedby'), null);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('.model-question-details')?.hasAttribute('open'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.model-question-details')?.hasAttribute('open'));
  await fields.nth(1).locator('summary').click();
  // Compact desktop controls use the product's type/radius tokens, not tiny text.
  const density = await page.locator('.model-question').evaluate(el => {
    const option = el.querySelector('.model-question-option')!, input = el.querySelector('textarea')!;
    return { option: option.getBoundingClientRect().height, input: input.getBoundingClientRect().height,
      radius: getComputedStyle(el).borderRadius, font: getComputedStyle(option.querySelector('.model-question-label')!).fontSize };
  });
  assert.equal(density.option, 36);assert.equal(density.input, 44);
  assert.equal(density.radius, '12px');assert.equal(density.font, '14px');
  assert.equal(await fields.nth(0).getByRole('textbox', { name: '你希望采用哪种实现方式？： 其他答案或补充', exact: true }).count(), 1);
  assert.equal(await page.locator('.model-question-heading').count(), 0);
  assert.equal(await popup.evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
  assert.equal(await page.locator('.model-question').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
  assert.equal(await popup.getByRole('button', { name: '发送回答', exact: true }).evaluate(el => getComputedStyle(el).transitionProperty), 'none', 'reduced motion also applies to the action button');
  // A preceding disclosure click uses pointer modality; enter keyboard modality
  // before checking :focus-visible on the programmatically focused native input.
  await page.keyboard.press('Tab');
  await fields.nth(0).locator('input').first().focus();
  assert.equal(await fields.nth(0).locator('.model-question-option').first().evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await page.keyboard.press('ArrowRight');
  assert.ok(await fields.nth(0).locator('input').nth(1).isChecked());
  await page.keyboard.press('ArrowLeft');
  assert.ok(await fields.nth(0).locator('input').first().isChecked());
  await fields.nth(1).locator('input').first().focus();
  await page.keyboard.press('Space');assert.ok(await fields.nth(1).locator('input').first().isChecked());
  await page.keyboard.press('Space');assert.equal(await fields.nth(1).locator('input').first().isChecked(), false);
  await fields.nth(0).locator("label.model-question-option").nth(0).click();
  await fields.nth(0).locator("label.model-question-option").nth(1).click();
  assert.equal(await fields.nth(0).locator("input:checked").count(), 1);
  await fields.nth(1).locator("label.model-question-option").nth(0).click();
  await fields.nth(1).locator("label.model-question-option").nth(1).click();
  assert.equal(await fields.nth(1).locator("input:checked").count(), 2);
  await fields.nth(2).locator("textarea").fill("先做内部验收，再分批上线");
  await fields.nth(0).locator("textarea").fill("优先可维护性");
  const customBeforeClear = await fields.nth(0).locator('textarea').boundingBox();
  await fields.nth(0).getByRole('button', { name: '清除选择', exact: true }).click();
  const customAfterClear = await fields.nth(0).locator('textarea').boundingBox();
  assert.equal(customAfterClear!.width, customBeforeClear!.width, 'clear choice never changes input width');
  assert.equal(customAfterClear!.y, customBeforeClear!.y, 'clear choice never shifts the input');
  assert.equal(await fields.nth(0).locator('input:checked').count(), 0);
  assert.equal(await fields.nth(0).locator('textarea').inputValue(), '优先可维护性');
  await fields.nth(0).locator('label.model-question-option').nth(1).click();
  // Recycling a virtual row cannot hide the Composer-owned popup.
  await page.evaluate(() => (window as any).renderFixture("hidden"));
  assert.equal(await popup.count(), 1);
  // A full Composer remount retains answers and descriptions.
  await page.evaluate(() => (window as any).renderFixture("unmounted"));
  await page.waitForFunction(() => !document.querySelector('.model-question'));
  await page.evaluate(() => (window as any).renderFixture());
  await page.waitForFunction(() => document.querySelectorAll('.model-question input:checked').length === 3);
  assert.equal(await fields.nth(2).locator("textarea").inputValue(), "先做内部验收，再分批上线");
  assert.equal(await fields.nth(0).locator('details').getAttribute('open'), '', 'expanded state survives virtual row remount');
  assert.equal(await fields.nth(1).locator('details').getAttribute('open'), '');
  for (const theme of ["dark", "light"]) for (const width of [1440, 768, 390, 360, 320]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.setViewportSize({ width, height: 1100 });
    await geometry();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${theme}/${width}`);
    const overflow = await page.locator('.model-question').evaluate(el => [...el.querySelectorAll('*')]
      // Accessible labels intentionally occupy a clipped 1px box, not visible layout.
      .filter(n => !n.matches('.screen-reader') && !(n instanceof HTMLTextAreaElement) && !(n instanceof HTMLInputElement) && n.scrollWidth > n.clientWidth + 1)
      .map(n => ({ tag: n.tagName, class: n.className, client: n.clientWidth, scroll: n.scrollWidth })));
    assert.deepEqual(overflow, [], `card overflow ${theme}/${width}: ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: join(artifacts, `questions-${theme}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 520 });await geometry();
  const body = popup.locator('.model-question-body');
  assert.ok(await body.evaluate(el => el.scrollHeight > el.clientHeight), 'short viewport scrolls only question content');
  const footerBeforeScroll = await popup.locator('.model-question-footer').boundingBox();
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });await geometry();
  assert.deepEqual(await popup.locator('.model-question-footer').boundingBox(), footerBeforeScroll, 'send actions stay fixed outside the content scroller');
  assert.ok(await popup.getByRole('button', { name: '发送回答', exact: true }).evaluate(el => {
    const button = el.getBoundingClientRect(), panel = el.closest('.model-question-popover')!.getBoundingClientRect();
    return button.top >= panel.top && button.bottom <= panel.bottom;
  }), 'send action remains fully visible on a short screen');
  await page.setViewportSize({ width: 1440, height: 1100 });
  // A newer user message makes the old question historical, never a popup.
  publish("thread:work:session", { ...emptyThread, ids: ["answer", "new-user"] });
  await popup.waitFor({ state: 'detached' });await noExtraUI();
  assert.equal(await page.locator('.log-row .reply-body').textContent(), '先确认这几个方向，再开始实现。');
  assert.equal(await page.locator('.log-row form, .log-row input').count(), 0);
  publish("thread:work:session", { ...emptyThread, ids: ["answer"] });
  await popup.waitFor();
  for (const patch of [{ streaming: true }, { status: "failed" }, { phase: "commentary" }, { truncated: true }]) {
    publish("messages:work:session", [{ ...message, ...patch }]);
    await page.waitForFunction(() => !document.querySelector('.model-question'));
    await page.locator('#prompt').focus();
    publish("messages:work:session", [message]);await page.locator('.model-question').waitFor();
    assert.equal(await page.locator('#prompt').evaluate(el => el === document.activeElement), true, 'new popup never steals drafting focus');
  }
  // Locally expanded details must not erase questions the authoritative preview
  // cannot authorize. Text-truncated replies remain readable, not interactive.
  publish('messages:work:session', [{ ...message, text: '<Question type="single">\n尚待完整展开？', textLength: expandedMessage.text.length, truncated: true }]);
  await popup.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '展开完整文本', exact: true }).click();
  await page.locator('.reply-body').filter({ hasText: '完整文本保留标记' }).waitFor();
  assert.ok((await page.locator('.reply-body').textContent())!.includes('你希望采用哪种实现方式？'), 'expanded question text must remain available');
  assert.equal(await popup.count(), 0, 'local details do not authorize a truncated preview');
  // Thinking-only truncation must neither hide the panel nor prevent submission.
  publish('messages:work:session', [{ ...message, truncated: true, textLength: text.length, thinking: 'thinking preview', thinkingLength: 1000 }]);
  await popup.waitFor();
  assert.equal(await page.locator('.reply-body').textContent(), '先确认这几个方向，再开始实现。');
  // Exercise actual Thread authorization too, not just an explicitly enabled Message.
  await page.evaluate(() => (window as any).renderFixture("thread"));
  await page.waitForFunction(() => !(document.querySelector('.model-question fieldset') as HTMLFieldSetElement)?.disabled);
  await page.getByRole("button", { name: "发送回答", exact: true }).click();
  await popup.waitFor({ state: 'detached' });
  await noExtraUI();
  assert.equal(prompts().length, 1);
  assert.equal(prompts()[0].params?.mode, undefined);
  assert.equal(prompts()[0].sessionId, scope.sessionId);
  assert.equal(prompts()[0].params?.text, "问题 1：你希望采用哪种实现方式？\n选择：2. 完整方案 — 包含边界处理与可维护性设计\n补充：优先可维护性\n\n问题 2：这次需要覆盖哪些验证？\n选择：1. 单元测试与协议边界\n选择：2. 浏览器交互与窄屏布局\n\n问题 3：发布节奏怎么安排？\n我的回答：先做内部验收，再分批上线");
  assert.equal(await page.evaluate(() => (window as any).getFixtureDraft().text), "保留这个未发送的草稿");
  await page.evaluate(() => (window as any).renderFixture());
  assert.equal(await popup.count(), 0);await noExtraUI();assert.equal(prompts().length, 1);
  // New independent sessions on reload test uncertain and definitive failures.
  for (const mode of ["uncertain", "failed"] as const) {
    promptMode = mode;
    await page.reload();await page.waitForFunction(() => !(document.querySelector('.model-question fieldset') as HTMLFieldSetElement)?.disabled);
    for (const field of await fields.all()) await field.locator('textarea').fill(`自由回答-${mode}`);
    await page.getByRole('button', { name: '发送回答', exact: true }).click();
    await popup.waitFor({ state: 'detached' });
    const before = prompts().length;
    await page.evaluate(() => (window as any).renderFixture());
    assert.equal(await popup.count(), 0);await noExtraUI();
    assert.equal(prompts().length, before, `${mode} must not replay`);
  }
  // Exercise the real React/Composer popup on a coarse pointer, not copied markup.
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const touchPage = await touch.newPage();await routeFixture(touchPage);
  await touchPage.goto(origin + 'question-check?workspaceId=work&sessionId=session');
  await touchPage.waitForFunction(() => !(document.querySelector('.model-question fieldset') as HTMLFieldSetElement)?.disabled);
  await touchPage.locator('.model-question-option').first().tap();
  assert.equal(await touchPage.locator('.model-question input').first().isChecked(), true);
  assert.equal(await touchPage.locator('.model-question-option').first().evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color')), 'rgba(0, 0, 0, 0)', 'native tap flash never obscures the themed selected state');
  assert.ok(await touchPage.locator('.model-question .model-question-option, .model-question button, .model-question summary').evaluateAll(els => els.every(el => el.getBoundingClientRect().height >= 44)));
  assert.equal(await touchPage.locator('.model-question textarea').first().evaluate(el => getComputedStyle(el).fontSize), '16px');
  for (const theme of ['dark', 'light']) {
    await touchPage.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await touchPage.screenshot({ path: join(artifacts, `touch-${theme}-390.png`), fullPage: true });
  }
  await touch.close();
  // Presentation screenshots use realistic copy; stress-copy checks above remain intact.
  promptMode = 'accepted';await page.reload();
  await page.waitForFunction(() => !(document.querySelector('.model-question fieldset') as HTMLFieldSetElement)?.disabled);
  const previewText = `<Question type="single">\n你希望采用哪种实现方式？\n1. 轻量起步\n  先跑通核心流程，适合快速验证方向；暂不包含全部边界处理，后续可逐步补齐。\n2. 完整方案\n  一次覆盖核心流程、异常边界与可维护性设计，适合需求已明确的阶段；前期投入较高。\n</Question>\n<Question type="multiple">\n这次需要覆盖哪些验证？\n1. 单元测试\n  校验协议解析与业务逻辑，便于快速发现回归。\n2. 浏览器交互\n  验证真实点击、键盘操作和回答发送流程。\n3. 窄屏适配\n  检查手机布局、Tag 换行与触控区域。\n4. 异常与边界输入\n  覆盖长文本、残缺协议和发送结果不确定等情况。\n</Question>\n<Question type="single">\n发布节奏怎么安排？\n1. 分阶段上线\n2. 一次性交付\n</Question>`;
  publish('messages:work:session', [{ ...message, text: previewText }]);
  await fields.nth(0).locator('.model-question-label').filter({ hasText: /^轻量起步$/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.log-row'));
  await noExtraUI();
  const firstTag = fields.nth(0).locator('label.model-question-option').first();
  assert.equal(await page.getByRole('button', { name: '发送回答', exact: true }).isDisabled(), true, 'empty answers cannot be sent');
  assert.equal(await popup.locator('.model-question-progress').textContent(), '0 / 3 已回答');
  const beforeSelect = await firstTag.boundingBox();
  await firstTag.click();
  assert.equal((await firstTag.boundingBox())!.width, beforeSelect!.width, 'selection must not resize a Tag');
  assert.equal(await popup.locator('.model-question-progress').textContent(), '1 / 3 已回答');
  assert.equal(await page.getByRole('button', { name: '发送回答', exact: true }).isDisabled(), true, 'incomplete answers retain the existing submission gate');
  const flow = await fields.nth(1).locator('.model-question-option').evaluateAll(els => els.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width })));
  assert.equal(flow[0].y, flow[1].y, 'short Tags share a row');assert.ok(flow[1].x > flow[0].x);
  assert.ok(flow[0].width < 180, 'Tags use content width, not stretched rows');
  await fields.nth(1).locator('label.model-question-option').first().click();
  await fields.nth(1).locator('label.model-question-option').nth(1).click();
  await fields.nth(2).locator('label.model-question-option').first().click();
  assert.equal(await popup.locator('.model-question-progress').textContent(), '3 / 3 已回答');
  assert.equal(await page.getByRole('button', { name: '发送回答', exact: true }).isEnabled(), true);
  await fields.nth(0).locator('summary').click();
  for (const [theme, width] of [['dark', 1440], ['light', 390], ['dark', 320]] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.setViewportSize({ width, height: 1100 });
    await geometry();
    await page.screenshot({ path: join(artifacts, `popup-${theme}-${width}.png`), fullPage: true });
  }
  // Reproduce the user's single-question example at an ultrawide Composer width.
  await page.setViewportSize({ width: 3120, height: 1000 });
  await page.evaluate(() => { document.querySelector<HTMLElement>('main.workspace')!.style.maxWidth = 'none'; });
  const instanceText = '<Question type="single">\n目标模型配置在哪个 Axiom 实例？\n1. 当前主实例（4317）\n  目标模型已添加在当前连接的 Axiom 中。\n2. 另一个实例\n  目标模型配置在其他端口或设备上。\n</Question>';
  publish('messages:work:session', [{ ...message, text: instanceText }]);
  await fields.nth(0).locator('.model-question-label').filter({ hasText: '当前主实例' }).waitFor();
  await geometry();
  assert.equal((await popup.boundingBox())!.width, 680, 'ultrawide Composer never stretches the question panel');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await popup.screenshot({ path: join(artifacts, `instance-${theme}-empty.png`) });
    await fields.nth(0).locator('label.model-question-option').first().click();
    await popup.screenshot({ path: join(artifacts, `instance-${theme}-selected.png`) });
    await fields.nth(0).getByRole('button', { name: '清除选择', exact: true }).click();
  }
  await page.screenshot({ path: join(artifacts, 'instance-light-ultrawide.png'), fullPage: true });
  // Manual fallback remains owned by a child modal even without any trigger button.
  await page.addInitScript(() => { Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined, configurable: true }); });
  await page.reload();await popup.waitFor();
  await page.waitForFunction(() => document.querySelector('.model-question-popover')?.hasAttribute('data-popover-fallback'));
  await page.evaluate(() => (window as any).modalFixture());
  await page.waitForFunction(() => document.querySelector('.model-question-popover')?.parentElement instanceof HTMLDialogElement);
  await page.locator('#prompt').click();assert.equal(await popup.isVisible(), true);
  await fields.nth(0).locator('label.model-question-option').first().click();
  assert.equal(await fields.nth(0).locator('input').first().isChecked(), true, 'modal-owned fallback remains interactive');
  assert.equal(await popup.isVisible(), true);assert.equal(await page.locator('dialog[open]').count(), 1);
  await noExtraUI();
  assert.deepEqual(errors, []);assert.deepEqual(blocked, []);
  console.log(`PASS: minimal Composer-owned popup, no collapse/reopen buttons or transcript question notice/record, pure questions leave no reply row; unanswered panel survives outside clicks/Escape, modal-owned manual fallback; anchored 8px above input with 680px readable width cap, viewport bounds/content scroll with fixed actions; inert descriptions, keyboard disclosure, accessible links, expanded-state/answer remount retention; header-free wrapping Tags, 36px desktop/44px real-component touch, native radio/checkbox; exact ordinary prompt, draft preserved, auto-close/no duplicate on accepted/UNCERTAIN/failure; historical/incomplete fail closed; ten theme/width layouts. Artifacts: ${artifacts}`);
} finally { await browser.close();await server.close(); }
