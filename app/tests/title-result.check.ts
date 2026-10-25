// Real AgentThread + virtual timeline. Title generation is background-only.
// Fake transport only: no backend, external requests, or model calls.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type WebSocketRoute } from "playwright";
import { emptyAgent, type ChatMessage } from "../src/shared/agent.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import type { Command } from "../src/shared/protocol.js";
import type { ProcessingSummary } from "../src/shared/processing.js";

const artifacts = mkdtempSync(join(tmpdir(), "axiom-title-hidden-ui-"));
const selection = { provider: "openai", id: "fixture", thinking: "off" as const };
const environment = { cwd: "/fixture", source: "runtime", systemPrompt: "测试系统指令", tools: [], skills: [], extensions: 0, warnings: [] };
const messages: ChatMessage[] = [
  { id: "user", runId: "run", role: "user", text: "请检查这段代码", status: "completed" },
  { id: "final", runId: "run", role: "assistant", phase: "final_answer", text: "检查完成，代码无误。", status: "completed" },
];
let record: ProcessingSummary = { id: "title-result", workspaceId: "work", sessionId: "session", kind: "session.title", title: "根据记忆生成标题",
  runId: "run", anchorMessageId: "final", state: "running", stage: "生成会话标题", startedAt: Date.now() - 1000, endedAt: null, error: null, selection };
let archived = false;
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {connect} from '/transport.ts';
import {AgentThread} from '/chat/AgentThread.tsx';import {OriginalConversationProvider} from '/chat/OriginalConversation.tsx';import {Icons} from '/components.tsx';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/chat.css';import '/styles/mobile.css';
const h=React.createElement,root=createRoot(document.getElementById('root'));
window.renderSession=(sessionId='session')=>{const scope={workspaceId:'work',sessionId};root.render(h(React.Fragment,{},h(Icons),h('div',{className:'app'},h('main',{id:'content',className:'workspace',style:{height:'100dvh',display:'flex',flexDirection:'column'}},h('header',{className:'topnav'},'隔离会话'),h(OriginalConversationProvider,{key:sessionId,scope},h(AgentThread,{scope}))))));};
window.renderSession();connect();`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "vite-cache"),
  plugins: [{ name: "title-hidden-fixture", resolveId(id) { if (id === "virtual:title-result") return id; }, load(id) { if (id === "virtual:title-result") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen(); const origin = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); page.setDefaultTimeout(12000);
const errors: string[] = [], blocked: string[] = [], commands: Command[] = [], sockets: WebSocketRoute[] = []; let seq = 1;
function snapshot(s: WebSocketRoute, scope: string) {
  let data: unknown; const live = archived ? [] : messages;
  if (scope === "configuration") data = { revision: "1", available: [{ ...selection, name: "测试模型", providerName: "OpenAI", levels: ["off"] }] };
  else if (scope === "processing:work") data = { revision: seq };
  else if (scope.startsWith("messages:work:")) data = live;
  else if (scope.startsWith("thread:work:")) data = { ids: live.map(m => m.id), groups: threadGroups(live), contextRevision: seq, resultVersion: 0 };
  else if (scope.startsWith("agent:work:")) data = { ...emptyAgent, selection, environment };
  else if (scope.startsWith("tasks:work:")) data = { tasks: [], revision: 0 };
  else return;
  s.send(JSON.stringify({ type: "snapshot", scope, streamId: "title-fixture", seq: ++seq, data }));
}
async function expectNoTitleCard() {
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".title-result-card, .title-process-dialog, [data-timeline-key^='title:']").count(), 0);
  assert.equal(commands.filter(c => c.op === "processing.list" || c.op === "processing.get").length, 0, "chat does not read or paginate title records");
  assert.equal(commands.filter(c => c.op === "subscribe" && c.params?.scope === "processing:work").length, 0, "chat does not subscribe for title feedback");
}
page.on("pageerror", e => errors.push(e.message));
try {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/api/status") return route.fulfill({ json: {} });
    if (url.pathname.startsWith("/api/")) { blocked.push(url.href); return route.abort(); }
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
      else if (["unsubscribe", "ping", "read.cancel"].includes(c.op)) reply({});
      else if (c.op === "agent.history.index") reply({ revision: archived ? "2" : "1", segments: archived ? [{ id: "archive", compression: { number: 1, before: 200, after: 100 }, messageIds: messages.map(m => m.id), groups: threadGroups(messages).map(g => ({ ...g, estimatedHeight: 100 })) }] : [] });
      else if (c.op === "agent.history.read") reply({ revision: "2", messages });
      else if (c.op === "agent.environment") reply(environment);
      // If the removed integration returns, supply real-looking records so the
      // regression fails on visible cards as well as the unwanted read itself.
      else if (c.op === "processing.list") reply({ items: [record], next: null });
      else if (c.op === "processing.get") reply({ ...record, stages: [], calls: [] });
      else { blocked.push(c.op); reply(null); }
    });
  });
  await page.goto(origin + "title-result-check");
  await page.getByText("检查完成，代码无误。", { exact: true }).waitFor();
  for (const state of ["running", "completed", "failed", "cancelled"] as const) {
    record = { ...record, state, endedAt: state === "running" ? null : Date.now(), outcome: state === "completed" ? "applied" : undefined };
    snapshot(sockets.at(-1)!, "processing:work");
    await expectNoTitleCard();
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoTitleCard();
    await page.getByText("检查完成，代码无误。", { exact: true }).waitFor();
  }
  await page.evaluate(() => (window as any).renderSession("other"));
  await page.getByText("检查完成，代码无误。", { exact: true }).waitFor(); await expectNoTitleCard();
  await page.evaluate(() => (window as any).renderSession());
  await page.getByText("检查完成，代码无误。", { exact: true }).waitFor(); await expectNoTitleCard();
  await page.reload();
  await page.getByText("检查完成，代码无误。", { exact: true }).waitFor(); await expectNoTitleCard();

  archived = true;
  await page.evaluate(() => sessionStorage.setItem("axiom:history-ranges:work:session", JSON.stringify({ archive: false })));
  await page.reload();
  await page.getByRole("button", { name: "展开会话原文" }).waitFor(); await expectNoTitleCard();
  assert.equal(commands.filter(c => c.op === "agent.history.read").length, 0, "collapsed history stays lazy");
  await page.getByRole("button", { name: "展开会话原文" }).click();
  await page.getByText("检查完成，代码无误。", { exact: true }).waitFor(); await expectNoTitleCard();
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log(`PASS background-only titles: no cards, dialogs, record reads or subscriptions; live states, scope changes, reload, lazy archived history, 320/390/768/1440. Artifacts: ${artifacts}`);
} finally {
  await page.screenshot({ path: join(artifacts, "last-state.png") }).catch(() => {});
  writeFileSync(join(artifacts, "audit.json"), JSON.stringify({ commands, errors, blocked }, null, 2));
  await browser.close(); await server.close();
}
