// Removal regression: real Message/Thread/Composer, isolated Vite and mock WS.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type WebSocketRoute } from "playwright";
import { emptyAgent, emptyThread, type ChatMessage } from "../src/shared/agent.js";
import { emptyTasks } from "../src/shared/tasks.js";
import { emptyCostTotals } from "../src/shared/costs.js";
import type { Command } from "../src/shared/protocol.js";

const artifacts = mkdtempSync(join(tmpdir(), "axiom-question-removal-"));
const scope = { workspaceId: "work", sessionId: "session" };
const selection = { provider: "fixture", id: "fixture", thinking: "off" };
const single = '<Question type="single">\n保留历史单选问题？\n1. 轻量方案\n  历史说明仍可阅读。\n2. 完整方案\n</Question>';
const multiple = '<Question type="multiple">\n保留历史多选问题？\n1. 单元验证\n2. 浏览器验证\n</Question>';
const text = `普通正文保留。\n\n${single}\n\n${multiple}\n\n正文结尾保留。`;
const message: ChatMessage = { id: "answer", role: "assistant", phase: "final_answer", status: "completed", text };
const expandedMessage = { ...message, text: text + '\n完整文本保留标记' };
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {connect,useConnectionState} from '/transport.ts';import {Icons} from '/components.tsx';
import {Message} from '/chat/Message.tsx';import {AgentThread} from '/chat/AgentThread.tsx';import {Composer} from '/chat/Composer.tsx';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/chat.css';import '/styles/theme.css';import '/styles/mobile.css';
const h=React.createElement,root=createRoot(document.getElementById('root')),scope=${JSON.stringify(scope)};
let generation=0;function Probe(){const c=useConnectionState();return h('output',{'data-connected':String(c.connected)});}
window.renderFixture=(mode='live')=>{generation++;root.render(h(React.Fragment,{},h(Icons),h(Probe),h('main',{className:'workspace',style:{display:'flex',flexDirection:'column',height:'100dvh',boxSizing:'border-box',padding:'16px',maxWidth:'850px',margin:'auto'}},h('div',{className:'fixture-thread',style:{flex:1,minHeight:0,overflow:'auto'}},mode==='thread'?h(AgentThread,{scope}):h(Message,{key:generation,scope,id:'answer'})),h(Composer,{scope}))));};
window.renderFixture();connect();`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "cache"),
  plugins: [{ name: "question-removal-fixture", resolveId(id) { if (id === "virtual:question-removal-fixture") return id; }, load(id) { if (id === "virtual:question-removal-fixture") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen();
const origin = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce", serviceWorkers: "block" });
const page = await context.newPage(); page.setDefaultTimeout(15000);
let socket: WebSocketRoute | undefined, seq = 0, draftRevision = 0;
const errors: string[] = [], blocked: string[] = [], commands: Command[] = [];
const snapshots = new Map<string, unknown>([
  ["configuration", { revision: "1", providerCount: 1, modelCount: 1, dataRoot: "fixture", available: [{ ...selection, name: "Fixture", levels: ["off"] }] }],
  ["agent:work:session", { ...emptyAgent, selection }], ["tasks:work:session", emptyTasks],
  ["thread:work:session", { ...emptyThread, ids: ["answer"], groups: [{ id: "answer", ids: ["answer"], activity: false }] }],
  ["messages:work:session", [message]],
]);
const publish = (name: string, data: unknown) => { snapshots.set(name, data); socket!.send(JSON.stringify({ type: "snapshot", scope: name, streamId: "fixture", seq: ++seq, data })); };
const prompts = () => commands.filter(c => c.op === "prompt");
const noQuestionUI = async () => {
  assert.equal(await page.locator('[class*="model-question"], [class*="composer-question"]').count(), 0);
  assert.equal(await page.getByRole('dialog', { name: '模型提问', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^(发送回答|回答问题|展开问题|收起问题|选项说明)$/ }).count(), 0);
  assert.equal(await page.locator('.log-row form, .log-row textarea, .log-row input[type=radio]').count(), 0);
  assert.equal(await page.locator('form.composer').count(), 1);
};
page.on('pageerror', error => errors.push(error.message));
try {
  // A literal init script avoids serializing tsx/esbuild's external __name helper.
  await page.addInitScript("Object.defineProperty(navigator, 'clipboard', {value: {writeText: async function(text) {window.copiedText = text;}}, configurable: true});");
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === '/removal-check') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:question-removal-fixture"></script></body></html>' });
    if (url.pathname === '/@vite/client') return route.fulfill({ contentType: 'application/javascript', body: `const styles=new Map();export function updateStyle(id,content){let n=styles.get(id);if(!n){n=document.createElement('style');document.head.append(n);styles.set(id,n)}n.textContent=content}export function removeStyle(id){styles.get(id)?.remove();styles.delete(id)}export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}export const injectQuery=u=>u;` });
    if (url.pathname === '/api/status') return route.fulfill({ json: {} });
    if (url.pathname === '/api/draft') { const write = route.request().postDataJSON(); return route.fulfill({ json: write ? { revision: ++draftRevision, writer: write.writer, sequence: write.sequence } : { revision: draftRevision, draft: { text: '保留这个未发送的草稿', attachment: null } } }); }
    if (url.pathname.startsWith('/api/')) { blocked.push(url.pathname); return route.abort(); }
    return route.continue();
  });
  await page.routeWebSocket('**/*', s => {
    if (new URL(s.url()).pathname !== '/ws') { blocked.push(s.url()); s.close(); return; }
    socket = s; s.send(JSON.stringify({ type: 'hello', streamId: 'fixture' }));
    s.onMessage(raw => {
      const c = JSON.parse(raw.toString()) as Command; commands.push(c);
      const reply = (data: unknown) => s.send(JSON.stringify({ type: 'receipt', requestId: c.requestId, ok: true, data }));
      if (c.op === 'subscribe') { const name = String(c.params?.scope); if (snapshots.has(name)) publish(name, snapshots.get(name)); reply({}); }
      else if (['unsubscribe', 'ping', 'agent.read'].includes(c.op)) reply({});
      else if (c.op === 'agent.history.index') reply({ revision: '1', segments: [] });
      else if (c.op === 'agent.environment') reply(null);
      else if (c.op === 'message.get') reply(expandedMessage);
      else if (c.op === 'costs.get') reply({ scope, requestedSessionId: scope.sessionId, title: 'Fixture', updatedAt: 0, rows: [], sessions: [], total: emptyCostTotals(), warnings: [] });
      else if (c.op === 'prompt') reply({ accepted: true, inputId: c.requestId });
      else { blocked.push(c.op); reply(null); }
    });
  });
  await page.goto(origin + 'removal-check?workspaceId=work&sessionId=session');
  await page.locator('[data-connected="true"]').waitFor({ state: 'attached' });
  await page.locator('.reply-body').filter({ hasText: '正文结尾保留。' }).waitFor();
  await page.waitForFunction(() => (document.querySelector('#prompt') as HTMLTextAreaElement)?.value === '保留这个未发送的草稿');
  await noQuestionUI();
  const body = await page.locator('.reply-body').textContent();
  for (const copy of ['普通正文保留。', '保留历史单选问题？', '轻量方案', '历史说明仍可阅读。', '保留历史多选问题？', '浏览器验证', '正文结尾保留。']) assert.ok(body!.includes(copy), copy);
  // Reply actions are intentionally pointer-disabled until the row is hovered.
  await page.locator('.log-row').hover();
  await page.getByRole('button', { name: '复制回复的 Markdown 原文', exact: true }).click();
  await page.waitForFunction(expected => (window as any).copiedText === expected, text);
  assert.equal(prompts().length, 0, 'historical questions do not submit themselves');
  // Pure questions must no longer disappear as an empty message row.
  publish('messages:work:session', [{ ...message, text: single }]);
  await page.locator('.reply-body').filter({ hasText: '保留历史单选问题？' }).waitFor();
  assert.equal(await page.locator('.log-row').count(), 1); await noQuestionUI();
  assert.equal(await page.locator('#prompt').inputValue(), '保留这个未发送的草稿');
  await page.locator('#prompt').focus(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#prompt').evaluate(node => node === document.activeElement), true);
  // Historical/thread and streaming replies use the same ordinary text path.
  publish('messages:work:session', [message]);
  publish('thread:work:session', { ...emptyThread, ids: ['answer', 'new-user'], groups: [{ id: 'answer', ids: ['answer'], activity: false }] });
  await page.evaluate(() => (window as any).renderFixture('thread'));
  await page.locator('.reply-body').filter({ hasText: '正文结尾保留。' }).waitFor(); await noQuestionUI();
  await page.evaluate(() => (window as any).renderFixture());
  const markdown = '# 普通 Markdown\n\n**加粗文字保留**\n\n- 正常列表\n\n```ts\nconst ok = true;\n```';
  publish('messages:work:session', [{ ...message, text: markdown, streaming: true, status: 'running' }]);
  await page.getByRole('heading', { name: '普通 Markdown', exact: true }).waitFor();
  assert.equal(await page.locator('.reply-body strong').textContent(), '加粗文字保留');
  assert.ok((await page.locator('.reply-body').textContent())!.includes('正常列表'));
  await noQuestionUI();
  // Existing full-text expansion remains functional and readable.
  publish('messages:work:session', [{ ...message, text: '<Question type="single">\n尚待完整展开？', textLength: expandedMessage.text.length, truncated: true }]);
  await page.getByRole('button', { name: '展开完整文本', exact: true }).click();
  await page.locator('.reply-body').filter({ hasText: '完整文本保留标记' }).waitFor();
  assert.ok((await page.locator('.reply-body').textContent())!.includes('保留历史单选问题？')); await noQuestionUI();
  publish('messages:work:session', [message]);
  await page.locator('.reply-body').filter({ hasText: '正文结尾保留。' }).waitFor();
  // No Question-specific CSS should be loaded, including on narrow layouts.
  const styles = await page.evaluate(() => [...document.querySelectorAll('style')].map(node => node.textContent).join('\n'));
  assert.ok(!styles.includes('.model-question'));
  for (const theme of ['dark', 'light']) for (const width of [1440, 768, 390, 360, 320]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.setViewportSize({ width, height: 1100 }); await noQuestionUI();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${theme}/${width}`);
  }
  await page.screenshot({ path: join(artifacts, 'ordinary-conversation.png'), fullPage: true });
  // Normal composer clear and ordinary Enter submission still work exactly once.
  await page.getByRole('button', { name: '清空输入', exact: true }).click();
  assert.equal(await page.locator('#prompt').inputValue(), '');
  assert.equal(await page.locator('#prompt').evaluate(node => node === document.activeElement), true);
  await page.locator('#prompt').fill('正常文字发送，不使用提问功能');
  await page.locator('#prompt').press('Enter');
  await page.waitForFunction(() => (document.querySelector('#prompt') as HTMLTextAreaElement)?.value === '');
  assert.equal(prompts().length, 1);
  assert.equal(prompts()[0].params?.text, '正常文字发送，不使用提问功能');
  assert.equal(prompts()[0].sessionId, scope.sessionId);
  assert.equal(prompts()[0].params?.mode, undefined);
  await noQuestionUI(); assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log(`PASS: no Question UI/CSS; historical mixed/pure questions and full text remain readable/copyable; normal Markdown/streaming/thread, drafts/focus/clear/ordinary Enter prompt unaffected; ten theme/width layouts. Artifacts: ${artifacts}`);
} finally { await browser.close(); await server.close(); }
