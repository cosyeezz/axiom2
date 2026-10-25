// Fake-only UI regression. No backend, model, real data or fixed application port.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type WebSocketRoute } from "playwright";
import type { Command } from "../src/shared/protocol.js";
import type { ProcessingRecord } from "../src/shared/processing.js";

const artifacts = process.env.AXIOM_TEST_ARTIFACTS || mkdtempSync(join(tmpdir(), "axiom-feedback-ui-"));
mkdirSync(artifacts, { recursive: true });
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {connect} from '/transport.ts';
import {useProcessingList,useProcessingRecord} from '/processing/records.ts';
import {TitleResultCard,useTitleResult} from '/workspaces/TitleFeedback.tsx';
import {OrganizationFeedback} from '/memory/OrganizationFeedback.tsx';
import {MemoryTreePage} from '/memory/MemoryTreePage.tsx';
import {MemoryToolbar} from '/memory/MemoryToolbar.tsx';
import {Tool} from '/chat/ToolActivity.tsx';
import {CompressionDetail} from '/chat/CompressionDetail.tsx';
import {Icons} from '/components.tsx';
import '/styles/tokens.css';
import '/styles/workbench.css';
import '/styles/chat.css';
import '/styles/memory.css';
const h=React.createElement, root=createRoot(document.getElementById('root'));
const scope={workspaceId:'work',sessionId:'session'}, selection={provider:'fixture',id:'fixture',thinking:'off'};
const noAction=()=>{throw Error('A browse-only fixture attempted a mutation')};
function Probe({index,workspaceId}) {
 const list=useProcessingList(workspaceId,index%2?{sessionId:'session',kind:'memory.query',state:undefined}:{kind:'memory.query',sessionId:'session'});
 const detail=useProcessingRecord(workspaceId,'cache');
 return h('output',{'data-probe':workspaceId+'-'+index},JSON.stringify({list:{data:list.data,error:list.error,stale:list.stale,loading:list.loading},detail:{data:detail.data,error:detail.error,stale:detail.stale,loading:detail.loading}}));
}
function TitleFeedback({scope}) {const record=useTitleResult(scope);return record?h(TitleResultCard,{record}):null;}
function Business({tree}) {return h('main',{},
 h('header',{style:{height:48,display:'flex',alignItems:'center'}},h('strong',{},'会话标题')),
 h(TitleFeedback,{scope}),
 h(OrganizationFeedback,{workspaceId:'work',tree,openRecords:noAction}),
 h(Tool,{scope,call:{id:'run:call',name:'memory_query',input:JSON.stringify({question:'公开问题'})},message:{id:'assistant',role:'assistant',text:'',status:'running'}}));}
function Compression({job}) {
 const trigger=React.useRef(null),[open,setOpen]=React.useState(false);
 return h(React.Fragment,{},h('button',{ref:trigger,onClick:()=>setOpen(true),style:{position:'fixed',bottom:12}},'查看原压缩入口'),open&&trigger.current&&h(CompressionDetail,{scope,id:'compression',trigger:trigger.current,job,selection,inherited:true,title:'会话标题',busy:false,error:'',pending:false,onReconcile:noAction,onClose:()=>setOpen(false),onStart:noAction,onCancel:noAction,onSelect:noAction,startUnavailable:'仅浏览测试'}));
}
window.renderFixture=(options)=>{
 let body=null;
 if(options.mode==='cache') body=h(React.Fragment,{},...(options.workspaces||['work']).flatMap(workspaceId=>Array.from({length:options.count??2},(_,index)=>h(Probe,{key:workspaceId+index,index,workspaceId}))));
 if(options.mode==='business') body=h(Business,{tree:options.tree});
 if(options.mode==='tree') body=h(MemoryTreePage,{workspaceId:'work',visible:options.visible,workspaces:[{id:'work',name:'隔离工作空间'}],select:noAction,open:noAction,openRecords:noAction});
 if(options.mode==='toolbar') body=h(MemoryToolbar,{scope,workspaces:[{id:'work',name:'隔离工作空间'}],children:tools=>h('div',{className:'usage'},tools.global)});
 if(options.mode==='compression') body=h(Compression,{job:options.job});
 root.render(h(React.Fragment,{key:options.mode},h(Icons),body));
};
window.renderFixture({mode:'cache'});
connect();
`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "vite-cache"),
  plugins: [{ name: "background-feedback-fixture", resolveId(id) { if (id === "virtual:background-feedback") return id; }, load(id) { if (id === "virtual:background-feedback") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen();
const origin = server.resolvedUrls!.local[0]; assert.notEqual(new URL(origin).port, "4317");
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
const page = await context.newPage(); page.setDefaultTimeout(10000);
const commands: Command[] = [], errors: string[] = [], blocked: string[] = [], sockets: WebSocketRoute[] = [];
const snapshots = new Map<string, { data: unknown; seq: number }>([["processing:work", { data: { revision: 1 }, seq: 1 }], ["processing:other", { data: { revision: 1 }, seq: 1 }]]);
let sequence = 1, hold: ((c: Command) => boolean) | undefined, freshOnSubscribe = true;
const held: { command: Command; release: (data?: unknown, code?: string) => void }[] = [];
const records = new Map<string, ProcessingRecord>();
function record(id: string, kind: ProcessingRecord["kind"], title = id): ProcessingRecord {
  return { id, kind, title, workspaceId: "work", sessionId: "session", state: "running", stage: "真实准备阶段", startedAt: Date.now() - 1000, endedAt: null, error: null,
    calls: [{ id: id + "-call", stage: "模型阶段", state: "completed", startedAt: Date.now() - 500, endedAt: Date.now(), sentAt: Date.now() - 400,
      input: { text: "PUBLIC_INPUT", truncated: false }, output: { text: '<script id="injected">throw Error("XSS")</script> PUBLIC_OUTPUT', truncated: false } }], stages: [{ name: "真实准备阶段", at: Date.now() - 1000 }] };
}
records.set("cache", record("cache", "memory.query", "CACHE_BASE"));
function dataFor(c: Command): unknown {
  if (c.op === "processing.get") return records.get(String(c.params?.id));
  const items = [...records.values()].filter(r => (!c.params?.kind || r.kind === c.params.kind) && (!c.params?.sessionId || r.sessionId === c.params.sessionId) && (!c.params?.toolCallId || r.toolCallId === c.params.toolCallId))
    .map(({ calls, stages, result, ...summary }) => summary);
  return { items, next: null };
}
const count = (op: string, workspaceId = "work") => commands.filter(c => c.op === op && c.workspaceId === workspaceId).length;
function sendSnapshot(socket: WebSocketRoute, scope: string) {
  const item = snapshots.get(scope); if (item) socket.send(JSON.stringify({ type: "snapshot", streamId: "fake-stream", scope, ...item }));
}
function publish(scope: string, data: unknown) {
  snapshots.set(scope, { data, seq: ++sequence }); sendSnapshot(sockets.at(-1)!, scope);
}
async function render(options: Record<string, unknown>) { await page.evaluate(value => (window as any).renderFixture(value), options); }
const settle = () => page.waitForTimeout(80);
const fresh = () => page.waitForFunction(() => [...document.querySelectorAll('[data-probe]')].every(node => { const p = JSON.parse(node.textContent!); return p.detail.data && !p.detail.stale && !p.detail.loading; }));
page.on("pageerror", error => errors.push(error.message));
try {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/feedback-check") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/virtual:background-feedback"></script></body></html>' });
    // Only Vite's CSS helpers are needed. Suppress its dev-only HMR socket entirely;
    // every application socket below still uses the real transport with fake receipts.
    if (url.pathname === "/@vite/client") return route.fulfill({ contentType: "application/javascript", body: `
      const styles=new Map();
      export function updateStyle(id,content){let node=styles.get(id);if(!node){node=document.createElement('style');document.head.append(node);styles.set(id,node)}node.textContent=content}
      export function removeStyle(id){styles.get(id)?.remove();styles.delete(id)}
      export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}
      export const injectQuery=(url)=>url;
    ` });
    if (url.pathname === "/api/status") return route.fulfill({ json: {} });
    if (url.pathname.startsWith("/api/")) { blocked.push(url.href); return route.abort(); }
    return route.continue();
  });
  await page.routeWebSocket("**/*", socket => {
    if (new URL(socket.url()).pathname !== "/ws") { blocked.push(socket.url()); socket.close(); return; }
    sockets.push(socket); socket.send(JSON.stringify({ type: "hello", streamId: "fake-stream" }));
    socket.onMessage(raw => {
      const c = JSON.parse(raw.toString()) as Command; commands.push(c);
      const reply = (data?: unknown, code?: string) => socket.send(JSON.stringify(code ? { type: "receipt", requestId: c.requestId, ok: false, error: { code, message: code + " fixture error" } } : { type: "receipt", requestId: c.requestId, ok: true, data }));
      if (c.op === "subscribe") { if (freshOnSubscribe) sendSnapshot(socket, String(c.params?.scope)); reply({}); }
      else if (c.op === "unsubscribe" || c.op === "ping") reply({});
      else if (c.op === "processing.list" || c.op === "processing.get") {
        const captured = structuredClone(dataFor(c));
        if (hold?.(c)) held.push({ command: c, release: (data = captured, code) => reply(data, code) }); else reply(captured);
      } else { blocked.push(c.op); reply(undefined, "FORBIDDEN_MODEL_OR_MUTATION"); }
    });
  });
  await page.goto(origin + "feedback-check"); await fresh();
  assert.equal(count("processing.list"), 1); assert.equal(count("processing.get"), 1, "same-key consumers share a single body read");
  const initial = commands.length; await page.waitForTimeout(1200); assert.equal(commands.filter(c => c.op.startsWith("processing.")).length, 2, "elapsed labels do not poll");
  await render({ mode: "cache", count: 1 }); await settle(); assert.equal(count("processing.get"), 1);
  assert.equal(commands.slice(initial).filter(c => c.op === "unsubscribe").length, 0, "one consumer unmount cannot release the shared subscription");
  await render({ mode: "cache", count: 2 }); await fresh(); assert.equal(count("processing.get"), 1);
  // Multiple invalidations while A is pending: A must never commit as fresh B.
  hold = c => c.op === "processing.get";
  records.get("cache")!.title = "OLD_SHOULD_NEVER_RENDER"; publish("processing:work", { revision: 2 });
  await page.waitForFunction(() => document.querySelector('[data-probe]')!.textContent!.includes('"loading":true'));
  assert.equal(held.length, 1);
  await page.evaluate(() => { (window as any).oldRendered = false; new MutationObserver(() => { if ([...document.querySelectorAll('[data-probe]')].some(node => JSON.parse(node.textContent!).detail.data?.title === "OLD_SHOULD_NEVER_RENDER")) (window as any).oldRendered = true; }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  records.get("cache")!.title = "CACHE_NEWEST"; publish("processing:work", { revision: 3 }); publish("processing:work", { revision: 4 }); await settle();
  assert.equal(held.length, 1, "same-key reads remain serial"); hold = undefined; held.shift()!.release(); await fresh();
  assert.equal(await page.evaluate(() => (window as any).oldRendered), false); assert.match(await page.locator('[data-probe]').first().innerText(), /CACHE_NEWEST/);
  assert.equal(count("processing.get"), 3, "one pending read plus one latest-revision follow-up");
  // Reconnect does not confirm cached data until a fresh scope arrives, even with reused seq.
  freshOnSubscribe = false; const beforeReconnect = count("processing.get"); sockets.at(-1)!.close();
  await page.waitForFunction(() => document.querySelector('[data-probe]')!.textContent!.includes('"stale":true'));
  await page.waitForTimeout(1800); assert.equal(sockets.length, 2); assert.equal(count("processing.get"), beforeReconnect);
  sendSnapshot(sockets.at(-1)!, "processing:work"); await fresh(); assert.equal(count("processing.get"), beforeReconnect + 1); freshOnSubscribe = true;
  // Revoke while a body is pending; no late reply can resurrect it. Another workspace is intact.
  await render({ mode: "cache", workspaces: ["work", "other"] }); await fresh();
  hold = c => c.op === "processing.get" && c.workspaceId === "work"; publish("processing:work", { revision: 5 }); await settle(); assert.equal(held.length, 1);
  publish("processing:work", null); await page.waitForFunction(() => !document.querySelector('[data-probe="work-0"]')!.textContent!.includes('PUBLIC_INPUT'));
  assert.match(await page.locator('[data-probe="other-0"]').innerText(), /PUBLIC_INPUT/);
  hold = undefined; held.shift()!.release(); await settle(); assert.doesNotMatch(await page.locator('[data-probe="work-0"]').innerText(), /PUBLIC_INPUT/);
  publish("processing:work", { revision: 6 }); await fresh();
  for (const code of ["NOT_FOUND", "SCOPE_MISMATCH", "AUTHORIZATION_REQUIRED"]) {
    hold = c => c.op === "processing.get" && c.workspaceId === "work"; publish("processing:work", { revision: code }); await settle(); assert.equal(held.length, 1);
    hold = undefined; held.shift()!.release(undefined, code); await settle();
    assert.doesNotMatch(await page.locator('[data-probe="work-0"]').innerText(), /PUBLIC_INPUT/); assert.match(await page.locator('[data-probe="work-0"]').innerText(), new RegExp(code === "AUTHORIZATION_REQUIRED" ? "授权" : code));
    publish("processing:work", { revision: code + "-restored" }); await fresh();
  }
  // The hidden directory keeps its old tree UI state but not a processing subscription.
  await render({ mode: "empty" }); await settle();
  snapshots.set("memory-tree:work", { data: { version: 0, roots: [], purposes: [], nameChars: 0, pending: 0, failed: 0 }, seq: ++sequence });
  snapshots.set("memory-catalog:work", { data: [], seq: ++sequence });
  const beforeHidden = commands.length; await render({ mode: "tree", visible: false }); await settle();
  assert.equal(commands.slice(beforeHidden).some(c => c.op === "subscribe" && c.params?.scope === "processing:work"), false);
  await render({ mode: "tree", visible: true }); await settle();
  assert.ok(commands.slice(beforeHidden).some(c => c.op === "subscribe" && c.params?.scope === "processing:work"));
  const beforeHide = commands.length; await render({ mode: "tree", visible: false }); await settle();
  assert.ok(commands.slice(beforeHide).some(c => c.op === "unsubscribe" && c.params?.scope === "processing:work"));
  // The real toolbar must retain master's fullscreen/IME/Escape contract alongside
  // the new visible-only processing feedback; a bare MindMap fixture cannot prove it.
  await render({ mode: "toolbar" }); await settle();
  const globalButton = page.getByRole("button", { name: "全局记忆", exact: true });
  await globalButton.click();
  const memoryPanel = page.getByRole("dialog", { name: "全局记忆", exact: true });
  await memoryPanel.getByRole("button", { name: "全屏画布", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.memory-dialog')?.classList.contains('memory-tree-fullscreen'));
  await memoryPanel.getByRole("button", { name: "退出全屏画布", exact: true }).evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true })));
  assert.equal(await memoryPanel.evaluate(node => node.classList.contains("memory-tree-fullscreen")), true, "IME Escape must not exit fullscreen or close memory");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('.memory-dialog')?.classList.contains('memory-tree-fullscreen'));
  assert.equal(await memoryPanel.isVisible(), true, "first Escape exits fullscreen only");
  await memoryPanel.getByRole("button", { name: "全屏画布", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await memoryPanel.waitFor({ state: "detached" });
  assert.equal(await globalButton.evaluate(node => document.activeElement === node), true, "second Escape closes memory and restores the original toolbar trigger");
  // Actual business entries: generated-only title result, queue/batch, and the ORIGINAL tool row.
  records.clear(); records.set("title", record("title", "session.title", "生成标题"));
  const organize = record("organize", "memory.organize", "整理本批次"); organize.batch = { purposeIds: ["p1", "p2"], sessionIds: ["s1", "s2"], published: false }; records.set(organize.id, organize);
  const query = record("query", "memory.query", "查询过程"); query.toolCallId = "run:call"; query.runId = "run"; query.state = "failed"; query.error = "模型成功但解析失败"; records.set(query.id, query);
  const tree = { version: 0, roots: [], purposes: [], nameChars: 0, pending: 5, failed: 0, queue: { waiting: 3, eligible: 2, backoff: 1, blocked: 0, oldestQueuedAt: Date.now(), nextBatchAt: Date.now() + 1000, retryAt: Date.now() + 2000 }, activeBatch: { processingId: "organize", purposeIds: ["p1", "p2"], sessionIds: ["s1", "s2"] } };
  const beforeBusiness = count("processing.get"); await render({ mode: "business", tree }); publish("processing:work", { revision: 20 });
  await page.getByText("后续等待 3 个目的", { exact: true }).waitFor(); await page.getByText(/正在整理 2 个目的 · 来自 2 个会话/).waitFor();
  assert.equal(await page.locator('.title-result-card').count(), 0, "running title has no result card or placeholder");
  assert.equal(count("processing.get"), beforeBusiness, "pending entries do not load model bodies");
  const generated = records.get("title")!; generated.state = "completed"; generated.outcome = "applied";
  generated.result = { text: JSON.stringify({ title: "真实生成的标题", applied: true }), truncated: false };
  publish("processing:work", { revision: "title-generated" });
  const titleButton = page.getByRole("button", { name: "查看标题生成详情：真实生成的标题", exact: true });
  await titleButton.waitFor(); assert.equal(await page.locator('header .title-result-card').count(), 0, "old topbar entry is removed");
  await titleButton.click(); const titlePanel = page.getByRole("dialog", { name: "标题生成详情", exact: true }); await titlePanel.waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await settle();
    const geometry = await titlePanel.evaluate(node => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height, overflow: node.scrollWidth > node.clientWidth + 1 }; });
    assert.ok(geometry.top >= 0 && geometry.bottom <= 901 && geometry.height > 180, `readable title panel at ${width}: ${JSON.stringify(geometry)}`); assert.equal(geometry.overflow, false);
    await page.screenshot({ path: join(artifacts, `title-${width}.png`) });
  }
  await page.keyboard.press("Escape"); await titlePanel.waitFor({ state: "detached" }); assert.equal(await titleButton.evaluate(node => document.activeElement === node), true);
  const tool = page.locator("details.tool-call"); assert.equal(await tool.count(), 1); await tool.locator(":scope > summary").click();
  await tool.getByRole("region", { name: "记忆查询过程" }).waitFor();
  await tool.locator(".processing-disclosure > summary").click(); await tool.getByRole("heading", { name: "处理失败原因" }).waitFor();
  assert.match(await tool.innerText(), /模型成功但解析失败/); assert.match(await tool.innerText(), /模型原始响应/);
  await tool.locator(".processing-payload > summary").filter({ hasText: "模型原始响应" }).click();
  assert.match(await tool.locator("pre").last().innerText(), /PUBLIC_OUTPUT/); assert.equal(await page.locator("#injected").count(), 0);
  assert.equal(await page.locator("details.tool-call").count(), 1, "query feedback never creates a second tool card");
  for (const [outcome, label] of [["no_match", "无匹配目的"], ["no_evidence", "无有效依据"], ["incomplete", "结果不完整"]] as const) {
    query.state = "completed"; query.error = null; query.outcome = outcome; publish("processing:work", { revision: outcome }); await tool.getByText(label, { exact: true }).first().waitFor();
  }
  // Non-results never grow a success card, even if a model call itself completed.
  const title = records.get("title")!;
  for (const state of ["running", "cancelling", "cancelled", "invalidated", "interrupted", "failed"] as const) {
    title.state = state; title.outcome = undefined; publish("processing:work", { revision: state });
    await page.locator('.title-result-card').waitFor({ state: 'detached' });
  }
  title.state = "completed"; title.outcome = "no_evidence"; title.calls = []; title.result = undefined;
  publish("processing:work", { revision: "empty-finish" }); await settle();
  assert.equal(await page.locator('.title-result-card').count(), 0, "empty-memory checks never create cards");
  // Generated but not adopted is a genuine result, never a claim that the title changed.
  title.calls = record("title", "session.title").calls;
  for (const outcome of ["not_applied", "applied"] as const) {
    title.outcome = outcome;
    title.result = { text: JSON.stringify({ title: "真实生成的标题", applied: outcome === "applied" }), truncated: false };
    publish("processing:work", { revision: outcome });
    const button = page.getByRole("button", { name: `查看标题生成详情：真实生成的标题${outcome === "not_applied" ? " · 未采用" : ""}`, exact: true });
    await button.waitFor(); assert.equal(await page.locator('.title-result-card').count(), 1);
    if (outcome === "not_applied") assert.match(await button.innerText(), /未采用/);
    await button.click(); await titlePanel.waitFor();
    if (outcome === "not_applied") await titlePanel.getByText(/标题已生成，但未替换会话名称/).waitFor();
    await page.keyboard.press("Escape"); await titlePanel.waitFor({ state: "detached" });
    assert.equal(await button.evaluate(node => document.activeElement === node), true);
  }
  await render({ mode: "business", tree: { ...tree, pending: 0, queue: { ...tree.queue, waiting: 0 } } }); await settle();
  assert.equal(await page.getByText(/后续等待/).count(), 0); await page.getByText(/正在整理 2 个目的/).waitFor();
  // Original compression card uses the native phase/application fact, not generated==applied.
  snapshots.set("configuration", { data: { revision: "1", providerCount: 0, modelCount: 0, available: [], dataRoot: "fixture", autoCompression: { enabled: false } }, seq: ++sequence });
  const job = { id: "compression-job", sessionId: "session", state: "completed", phase: "applying", stage: "应用状态待核实", selection: { provider: "fixture", id: "fixture", thinking: "off" }, startedAt: Date.now() - 2000, endedAt: Date.now(), error: null, summary: "公开摘要", messageCount: 2 };
  await render({ mode: "compression", job }); await page.getByRole("button", { name: "查看原压缩入口", exact: true }).click();
  const compression = page.getByRole("dialog", { name: "后台压缩", exact: true }); await compression.waitFor();
  assert.match(await compression.innerText(), /应用状态待核实/); assert.equal(await compression.locator('.compression-steps [data-phase="done"]').count(), 0);
  await render({ mode: "compression", job: { ...job, phase: "done", stage: "摘要已应用" } }); await compression.getByText("摘要已应用", { exact: false }).first().waitFor();
  assert.equal(await compression.locator('.compression-steps [data-phase="done"]').count(), 3);
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
  assert.equal(commands.some(c => /^(prompt|memory\.(query|organize|configure)|compression\.(start|cancel)|task\.)/.test(c.op)), false);
  console.log("PASS fake-only UI: dedup/serial reads, stale receipts, reconnect, revocation, hidden directory, generated-only title/focus/four widths, queue/batch, original query card/outcomes, native compression application; no models or mutations");
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {}); throw error;
} finally {
  writeFileSync(join(artifacts, "commands.json"), JSON.stringify(commands, null, 2));
  writeFileSync(join(artifacts, "browser-errors.json"), JSON.stringify({ errors, blocked }, null, 2));
  await browser.close(); await server.close();
}
