// Isolated presentation fixtures: no real data, model calls or application service.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type WebSocketRoute } from "playwright";
import { emptyCostTotals, sumCosts, type CostReport } from "../src/shared/costs.js";
import { emptyAgent } from "../src/shared/agent.js";
import type { Configuration, Command } from "../src/shared/protocol.js";

const artifacts = mkdtempSync(join(tmpdir(), "axiom-model-display-ui-"));
const id = "axiom-copy-4a210b7a-abd9-4611-be62-068b9ae2e65b";
const selection = { provider: "openai", id, thinking: "off" };
const scope = { workspaceId: "work", sessionId: "session" };
const config: Configuration = { revision: "1", providerCount: 2, modelCount: 2, dataRoot: "fixture", available: [
  { provider: "openai", providerName: "可读供应商", id, name: "GPT 标题模型", levels: ["off"] },
  { provider: "other", providerName: "其他供应商", id, name: "不能串用的名称", levels: ["off"] },
] };
const rows = (["main", "subagent", "compression", "tool", "other"] as const).map(category => ({
  ...emptyCostTotals(), records: 1, knownCost: .0025, id: category, category,
  sessionId: category === "subagent" ? "child" : "session", source: category === "other" ? "会话标题" : category,
  provider: selection.provider, model: id,
}));
const report: CostReport = { scope, requestedSessionId: "session", title: "测试账单", updatedAt: Date.now(), rows,
  sessions: [{ id: "session", title: "测试会话", taskId: null, status: null }, { id: "child", title: "测试子任务", taskId: "task", status: "completed" }],
  total: sumCosts(rows), warnings: [] };
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {connect} from '/transport.ts'; import {Icons} from '/components.tsx';
import Costs from '/pages/Costs.tsx';
import {ModelPicker} from '/chat/ModelPicker.tsx';
import {ModelChangeNotice} from '/chat/ModelChangeNotice.tsx';
import {Environment} from '/chat/SessionState.tsx';
import {ProcessingDetails} from '/processing/ProcessDetail.tsx';
import {CompressionDetail} from '/chat/CompressionDetail.tsx';
import '/styles/tokens.css'; import '/styles/workbench.css'; import '/styles/chat.css';
const h=React.createElement,root=createRoot(document.getElementById('root'));
const selection=${JSON.stringify(selection)},scope=${JSON.stringify(scope)};
const record={id:'record',kind:'session.title',title:'生成会话标题',workspaceId:'work',sessionId:'session',state:'completed',stage:'已应用',startedAt:1,endedAt:2,error:null,selection,stages:[],calls:[{id:'call',stage:'请求标题',state:'completed',startedAt:1,endedAt:2,selection}]};
const job={id:'compression',state:'completed',phase:'done',summary:'生成的摘要',startedAt:1,endedAt:2,selection,error:null};
function Compression(){const trigger=React.useRef(null),[open,setOpen]=React.useState(false);return h(React.Fragment,{},h('button',{ref:trigger,onClick:()=>setOpen(true)},'打开压缩'),open&&h(CompressionDetail,{id:'compression',scope,trigger:trigger.current,job,selection,title:'测试会话',busy:false,pending:false,error:'',inherited:false,startUnavailable:'仅测试',onSelect:async()=>{},onStart:()=>{},onCancel:()=>{},onReconcile:()=>{},onClose:()=>setOpen(false)}));}
window.renderFixture=(mode)=>root.render(h(React.Fragment,{},h(Icons),mode==='costs'?h(Costs):h('main',{},h(ModelPicker,{scope}),h(ModelChangeNotice,{change:{from:{provider:'old',id:'upstream',thinking:'high'},to:selection}}),h(Environment,{scope}),h(ProcessingDetails,{record}),h(Compression))));
window.renderFixture('details');connect();`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "vite-cache"),
  plugins: [{ name: "model-display-fixture", resolveId(id) { if (id === "virtual:model-display") return id; }, load(id) { if (id === "virtual:model-display") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen();
const origin = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(10000);
const errors: string[] = [], blocked: string[] = [], commands: Command[] = [];
let socket: WebSocketRoute | undefined, seq = 1;
const snapshots = new Map<string, unknown>([
  ["configuration", { ...config, available: [] }],
  ["agent:work:session", { ...emptyAgent, selection, run: { id: "run", sessionId: "session", status: "running", selection, startedAt: Date.now(), endedAt: null, error: null },
    memoryDirectory: null, environment: { cwd: "/fixture", source: "runtime", systemPrompt: "系统提示词", tools: [], skills: [], extensions: 0, warnings: [] } }],
  ["costs:work:session", { revision: 0 }],
]);
const publish = (name: string, data: unknown) => { snapshots.set(name, data); socket!.send(JSON.stringify({ type: "snapshot", scope: name, streamId: "fixture", seq: ++seq, data })); };
page.on("pageerror", e => errors.push(e.message));
try {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) { blocked.push(url.href); return route.abort(); }
    if (url.pathname === "/model-display-check") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div><script type="module" src="/@id/virtual:model-display"></script></body></html>' });
    if (url.pathname === "/@vite/client") return route.fulfill({ contentType: "application/javascript", body: `
      const styles=new Map();export function updateStyle(id,content){let n=styles.get(id);if(!n){n=document.createElement('style');document.head.append(n);styles.set(id,n)}n.textContent=content}
      export function removeStyle(id){styles.get(id)?.remove();styles.delete(id)}export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}export const injectQuery=(u)=>u;` });
    return route.continue();
  });
  await page.routeWebSocket("**/*", s => {
    if (new URL(s.url()).pathname !== "/ws") { blocked.push(s.url()); s.close(); return; }
    socket = s; s.send(JSON.stringify({ type: "hello", streamId: "fixture" }));
    s.onMessage(raw => {
      const c = JSON.parse(raw.toString()) as Command; commands.push(c);
      const reply = (data: unknown) => s.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
      if (c.op === "subscribe") { const name = String(c.params?.scope); if (snapshots.has(name)) publish(name, snapshots.get(name)); reply({}); }
      else if (["unsubscribe", "ping"].includes(c.op)) reply({});
      else if (c.op === "costs.get") reply(report);
      else if (c.op === "agent.environment") reply((snapshots.get("agent:work:session") as typeof emptyAgent).environment);
      else { blocked.push(c.op); reply(null); }
    });
  });
  await page.goto(origin + "model-display-check?workspaceId=work&sessionId=session");
  await page.getByRole("button", { name: "系统提示词", exact: true }).click();
  await page.locator(".model-picker > summary").click();
  await page.locator(".model-run-note > summary").click();
  await page.getByText(/当前执行：.*未知模型配置/).waitFor();
  assert.doesNotMatch(await page.locator("main").innerText(), /axiom-(copy|model)-/);
  publish("configuration", config);
  await page.getByText("当前执行：可读供应商 / GPT 标题模型 · none", { exact: true }).waitFor();
  assert.match(await page.locator(".session-environment").innerText(), /模型：可读供应商 \/ GPT 标题模型/);
  assert.match(await page.locator(".processing-call").innerText(), /可读供应商 \/ GPT 标题模型/);
  const option = page.getByRole("button", { name: "GPT 标题模型 可读供应商", exact: true });
  assert.equal(await option.getAttribute("data-tooltip"), "可读供应商 / GPT 标题模型");
  assert.doesNotMatch(await page.locator("main").innerText(), /axiom-(copy|model)-/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开压缩", exact: true }).click();
  const compression = page.getByRole("dialog", { name: "后台压缩", exact: true });
  await compression.getByText("模型摘要 · GPT 标题模型", { exact: true }).waitFor();
  assert.doesNotMatch(await compression.innerText(), /axiom-(copy|model)-/);
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as any).renderFixture("costs"));
  await page.locator("#cost-other .cost-line-title").filter({ hasText: "GPT 标题模型" }).waitFor();
  assert.equal(await page.locator(".cost-line").count(), 5);
  for (const summary of await page.locator(".cost-line > summary").all()) await summary.click();
  assert.match(await page.locator(".cost-model-context").innerText(), /GPT 标题模型 · 可读供应商/);
  assert.doesNotMatch(await page.locator(".cost-page").innerText(), /axiom-(copy|model)-|不能串用的名称/);
  assert.equal(await page.locator(".cost-total > .cost-number").innerText(), "$0.0125");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no overflow at ${width}`);
    await page.screenshot({ path: join(artifacts, `costs-${width}.png`), fullPage: true });
  }
  publish("configuration", { ...config, available: [] });
  await page.locator("#cost-other .cost-line-title").filter({ hasText: "未知模型配置" }).waitFor();
  assert.doesNotMatch(await page.locator(".cost-page").innerText(), /axiom-(copy|model)-/);
  assert.equal(report.rows[4].model, id, "display does not rewrite the billing identity");
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
  assert.ok(commands.every(c => ["subscribe", "unsubscribe", "ping", "costs.get", "agent.environment"].includes(c.op)));
  console.log(`PASS: readable names in all 5 cost categories, picker/tooltip/current run, model notices, environment, processing record/calls and compression; metadata arrival/removal, exact provider lookup, unchanged amounts/identities, 320/390/1440 widths. Artifacts: ${artifacts}`);
} finally { await browser.close(); await server.close(); }
