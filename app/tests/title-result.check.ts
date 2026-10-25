// Real AgentThread + virtual timeline, entirely fake transport; no app backend or model.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type WebSocketRoute } from "playwright";
import { emptyAgent, type ChatMessage } from "../src/shared/agent.js";
import type { Command } from "../src/shared/protocol.js";
import type { ProcessingRecord } from "../src/shared/processing.js";

const artifacts = mkdtempSync(join(tmpdir(), "axiom-title-result-ui-"));
const selection = { provider: "openai", id: "axiom-copy-fixture-internal", thinking: "off" as const };
const environment = { cwd: "/fixture", source: "runtime", systemPrompt: "测试系统指令", tools: [], skills: [], extensions: 0, warnings: [] };
const messages: ChatMessage[] = [
  { id: "user", role: "user", text: "请检查这段代码", status: "completed" },
  { id: "final", role: "assistant", phase: "final_answer", text: "检查完成，代码无误。", status: "completed" },
];
let record: ProcessingRecord = { id: "title-result", workspaceId: "work", sessionId: "session", kind: "session.title", title: "根据记忆生成标题",
  state: "running", stage: "生成中", startedAt: 1000, endedAt: 6800, error: null, selection, stages: [], calls: [] };
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {connect} from '/transport.ts';
import {AgentThread} from '/chat/AgentThread.tsx';import {OriginalConversationProvider} from '/chat/OriginalConversation.tsx';import {Icons} from '/components.tsx';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/chat.css';import '/styles/mobile.css';
const h=React.createElement,root=createRoot(document.getElementById('root'));
window.renderSession=(sessionId='session',reading=false)=>{const scope={workspaceId:'work',sessionId};root.render(h(React.Fragment,{},h(Icons),h('div',{className:'app'+(reading?' reading-mode':'')},h('main',{id:'content',className:'workspace',style:{height:'100dvh',display:'flex',flexDirection:'column'}},h('header',{className:'topnav'},'隔离会话'),h(OriginalConversationProvider,{key:sessionId,scope},h(AgentThread,{scope,readingRevision:reading?1:0}))))));};
window.renderSession();connect();`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "vite-cache"),
  plugins: [{ name: "title-result-fixture", resolveId(id) { if (id === "virtual:title-result") return id; }, load(id) { if (id === "virtual:title-result") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen();
const origin = server.resolvedUrls!.local[0]; assert.notEqual(new URL(origin).port, "4317");
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); page.setDefaultTimeout(12000);
const errors: string[] = [], blocked: string[] = [], commands: Command[] = [];
const sockets: WebSocketRoute[] = []; let seq = 1, emptyPages = false;
function snapshot(s: WebSocketRoute, scope: string) {
  let data: unknown;
  if (scope === "configuration") data = { revision: "1", available: [{ ...selection, name: "GPT 标题模型", providerName: "OpenAI", levels: ["off"] }] };
  else if (scope === "processing:work") data = { revision: seq };
  else if (scope.startsWith("messages:work:")) data = messages;
  else if (scope.startsWith("thread:work:")) data = { ids: messages.map(m => m.id), groups: messages.map(m => ({ id: m.id, ids: [m.id], activity: false, delivery: m.role === "assistant" })), resultVersion: 0 };
  else if (scope.startsWith("agent:work:")) data = { ...emptyAgent, selection, environment };
  else if (scope.startsWith("tasks:work:")) data = { tasks: [], revision: 0 };
  else return;
  s.send(JSON.stringify({ type: "snapshot", scope, streamId: "title-fixture", seq: ++seq, data }));
}
const publish = () => snapshot(sockets.at(-1)!, "processing:work");
const card = page.locator("#messages .title-result-card");
const tick = () => page.waitForTimeout(150);
page.on("pageerror", e => errors.push(e.message));
try {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin || url.pathname.startsWith("/api/")) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/title-result-check") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>.app{display:block!important}</style></head><body><div id="root"></div><script type="module" src="/@id/virtual:title-result"></script></body></html>' });
    if (url.pathname === "/@vite/client") return route.fulfill({ contentType: "application/javascript", body: `const styles=new Map();export function updateStyle(id,c){let n=styles.get(id);if(!n){n=document.createElement('style');document.head.append(n);styles.set(id,n)}n.textContent=c}export function removeStyle(id){styles.get(id)?.remove();styles.delete(id)}export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}export const injectQuery=u=>u;` });
    return route.continue();
  });
  await page.routeWebSocket("**/*", s => {
    if (new URL(s.url()).pathname !== "/ws") { blocked.push(s.url()); s.close(); return; }
    sockets.push(s); s.send(JSON.stringify({ type: "hello", streamId: "title-fixture" }));
    s.onMessage(raw => {
      const c = JSON.parse(raw.toString()) as Command; commands.push(c);
      const reply = (data: unknown) => s.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
      if (c.op === "subscribe") { snapshot(s, String(c.params?.scope)); reply({}); }
      else if (["unsubscribe", "ping"].includes(c.op)) reply({});
      else if (c.op === "agent.history.index") reply({ revision: "1", segments: [] });
      else if (c.op === "agent.environment") reply(environment);
      else if (c.op === "processing.get") reply(record);
      else if (c.op === "processing.list") {
        const { calls, stages, result, ...summary } = record;
        const matching = c.params?.sessionId === record.sessionId && (!c.params?.state || c.params.state === record.state);
        if (matching && emptyPages && (c.params?.before === undefined || c.params.before === 50)) {
          reply({ items: Array.from({ length: 50 }, (_, i) => ({ ...summary, id: `empty-${c.params?.before ?? 100}-${i}`, outcome: "no_evidence" })), next: c.params?.before === 50 ? 25 : 50 });
        } else reply({ items: matching ? [summary] : [], next: null });
      } else { blocked.push(c.op); reply(null); }
    });
  });
  await page.goto(origin + "title-result-check");
  await page.getByText("检查完成，代码无误。", { exact: true }).waitFor(); await tick();
  assert.equal(await card.count(), 0, "running has no card or placeholder");
  record = { ...record, state: "completed", outcome: "no_evidence" }; publish(); await tick();
  assert.equal(await card.count(), 0, "completed checks are not generated titles");
  record = { ...record, outcome: "applied", result: { text: JSON.stringify({ title: "检查代码正确性", applied: true }), truncated: false },
    calls: [{ id: "call", stage: "生成标题", state: "completed", startedAt: 1000, endedAt: 6800, selection }] }; publish(); await tick();
  assert.equal(await card.count(), 0, "call start without actual send is insufficient");
  record.calls[0].sentAt = 1100; publish(); await card.waitFor();
  assert.match(await card.innerText(), /检查代码正确性/); assert.match(await card.innerText(), /GPT 标题模型/); assert.match(await card.innerText(), /5\.8 秒/);
  assert.doesNotMatch(await card.innerText(), /axiom-copy-/);
  const row = card.locator(".."); assert.equal(await row.getAttribute("data-timeline-key"), "title:title-result");
  assert.equal(await card.locator("xpath=ancestor::details").count(), 0, "outside folded process");
  assert.equal(await row.locator("[data-delivery-start]").count(), 0, "not a delivery or message");
  for (let i = 0; i < 4; i++) publish(); await tick(); assert.equal(await card.count(), 1, "repeated invalidations never duplicate a record");
  emptyPages = true; publish(); await tick(); await card.waitFor();
  assert.ok(commands.some(c => c.op === "processing.list" && c.params?.before === 50));
  assert.ok(commands.some(c => c.op === "processing.list" && c.params?.before === 25), "scan beyond multiple full pages of no-evidence checks");
  assert.ok(commands.filter(c => c.op === "processing.get").every(c => c.params?.id === "title-result"), "pagination only reads summaries for empty checks");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => (window as any).renderSession("session", true));
    await page.locator("#thread").evaluate(n => { n.scrollTop = n.scrollHeight; }); await tick();
    assert.equal(await card.isVisible(), true, `result visible in reading mode at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}`);
    const textBox = await card.locator("strong").boundingBox(); assert.ok(textBox && textBox.width > 120);
    await page.screenshot({ path: join(artifacts, `title-${width}-reading.png`) });
  }
  await card.getByRole("button").click(); const panel = page.getByRole("dialog", { name: "标题生成详情", exact: true }); await panel.waitFor();
  await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
  assert.equal(await card.getByRole("button").evaluate(n => document.activeElement === n), true);
  await page.evaluate(() => (window as any).renderSession("other")); await tick();
  assert.equal(await card.count(), 0, "switching scope cannot leak title from another session");
  await page.evaluate(() => (window as any).renderSession()); await card.waitFor();
  sockets.at(-1)!.close(); await page.waitForTimeout(1800); await card.waitFor(); assert.equal(await card.count(), 1);
  await page.reload(); await card.waitFor(); assert.equal(await card.count(), 1, "reload rehydrates the same record exactly once");
  record = { ...record, outcome: "not_applied", result: { text: JSON.stringify({ title: "新标题未采用", applied: false }), truncated: false } }; publish();
  await card.getByRole("button", { name: "查看标题生成详情：新标题未采用 · 未采用", exact: true }).waitFor();
  assert.match(await card.innerText(), /未采用/);
  assert.equal(await page.locator(".tool-call,.subagent-card,button.title-feedback").count(), 0);
  assert.equal(messages.length, 2); assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  assert.ok(commands.every(c => ["subscribe", "unsubscribe", "ping", "agent.history.index", "agent.environment", "processing.list", "processing.get"].includes(c.op)));
  console.log(`PASS real Thread: generated-only gates, stable virtual row, no delegate/message/delivery impersonation, repeated updates, multi-page empty checks, scope/reconnect/reload, readable model and 320/390/768/1440 reading mode. Artifacts: ${artifacts}`);
} finally {
  await page.screenshot({ path: join(artifacts, "last-state.png") }).catch(() => {});
  writeFileSync(join(artifacts, "audit.json"), JSON.stringify({ commands, errors, blocked, text: await page.locator("body").innerText().catch(() => "") }, null, 2));
  await browser.close(); await server.close();
}
