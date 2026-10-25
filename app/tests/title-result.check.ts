// Real AgentThread + virtual timeline + modal. Fake transport only; no backend/model.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type WebSocketRoute } from "playwright";
import { emptyAgent, type ChatMessage } from "../src/shared/agent.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import type { Command } from "../src/shared/protocol.js";
import type { ProcessingRecord } from "../src/shared/processing.js";
const artifacts = mkdtempSync(join(tmpdir(), "axiom-title-process-ui-"));
const selection = { provider: "openai", id: "axiom-copy-fixture-internal", thinking: "off" as const };
const environment = { cwd: "/fixture", source: "runtime", systemPrompt: "测试系统指令", tools: [], skills: [], extensions: 0, warnings: [] };
const messages: ChatMessage[] = [
  { id: "user", runId: "run", role: "user", text: "请检查这段代码", status: "completed" },
  { id: "final", runId: "run", role: "assistant", phase: "final_answer", text: "检查完成，代码无误。", status: "completed" },
];
let record: ProcessingRecord = { id: "title-result", workspaceId: "work", sessionId: "session", kind: "session.title", title: "根据记忆生成标题",
  runId: "run", anchorMessageId: "final", state: "running", stage: "生成会话标题", startedAt: Date.now() - 1000, endedAt: null, error: null, selection,
  stages: [{ name: "读取标题资料", at: 1000 }, { name: "生成会话标题", at: 1100 }],
  calls: [{ id: "call", stage: "生成标题", state: "running", startedAt: 1000, sentAt: 1100, endedAt: null, selection,
    input: { text: '{"systemPrompt":"只输出标题","prompt":"真实输入资料"}', truncated: false } }] };
let extra: ProcessingRecord | undefined, archived = false, archiveCount = 2, emptyPages = false, failDetail = false;
let holdDetail = false, modelName = "GPT 标题模型";
let livePhase: "generating" | "executing_tools" | undefined;
const heldDetails: Array<() => void> = [];
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {connect} from '/transport.ts';
import {AgentThread} from '/chat/AgentThread.tsx';import {OriginalConversationProvider} from '/chat/OriginalConversation.tsx';import {Icons} from '/components.tsx';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/chat.css';import '/styles/mobile.css';import '/styles/display-settings.css';
const h=React.createElement,root=createRoot(document.getElementById('root'));
window.renderSession=(sessionId='session',reading=false)=>{const scope={workspaceId:'work',sessionId};root.render(h(React.Fragment,{},h(Icons),h('div',{className:'app'+(reading?' reading-mode':'')},h('main',{id:'content',className:'workspace',style:{height:'100dvh',display:'flex',flexDirection:'column'}},h('header',{className:'topnav'},'隔离会话'),h(OriginalConversationProvider,{key:sessionId,scope},h(AgentThread,{scope,readingRevision:reading?1:0}))))));};
window.renderSession();connect();`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: join(artifacts, "vite-cache"),
  plugins: [{ name: "title-process-fixture", resolveId(id) { if (id === "virtual:title-result") return id; }, load(id) { if (id === "virtual:title-result") return fixture; } }],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, ws: false } });
await server.listen(); const origin = server.resolvedUrls!.local[0]; assert.notEqual(new URL(origin).port, "4317");
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); page.setDefaultTimeout(12000);
const errors: string[] = [], blocked: string[] = [], commands: Command[] = [], sockets: WebSocketRoute[] = []; let seq = 1;
function snapshot(s: WebSocketRoute, scope: string) {
  let data: unknown; const live = archived ? messages.slice(archiveCount) : messages;
  if (scope === "configuration") data = { revision: "1", available: [{ ...selection, name: modelName, providerName: "OpenAI", levels: ["off"] }] };
  else if (scope === "processing:work") data = { revision: seq };
  else if (scope.startsWith("messages:work:")) data = live;
  else if (scope.startsWith("thread:work:")) data = { ids: live.map(m => m.id), groups: threadGroups(live), contextRevision: seq, resultVersion: 0,
    runId: livePhase ? "run" : undefined, runStatus: livePhase ? "running" : undefined, runPhase: livePhase };
  else if (scope.startsWith("agent:work:")) data = { ...emptyAgent, selection, environment };
  else if (scope.startsWith("tasks:work:")) data = { tasks: [], revision: 0 };
  else return;
  s.send(JSON.stringify({ type: "snapshot", scope, streamId: "title-fixture", seq: ++seq, data }));
}
const publish = () => snapshot(sockets.at(-1)!, "processing:work");
const card = page.locator('#messages .title-result-card[data-processing-id="title-result"]');
const panel = page.getByRole("dialog", { name: "标题生成详情", exact: true });
const tick = () => page.waitForTimeout(200);
const rowKeys = () => page.locator("[data-timeline-key]").evaluateAll(nodes => nodes.map(n => n.getAttribute("data-timeline-key")));
const detailReads = () => commands.filter(c => c.op === "processing.get").length;
async function expectSummaryCard() {
  const copy = card.locator(".title-result-copy");
  assert.equal(await copy.locator("strong").innerText(), "标题生成");
  assert.equal(await copy.locator("small").innerText(), "OpenAI / GPT 标题模型");
  assert.doesNotMatch(await copy.innerText(), /检查代码正确性|未采用|秒|真实输入资料/);
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
      else if (c.op === "agent.history.index") reply({ revision: archived ? "2" : "1", segments: archived ? [{ id: "archive", compression: { number: 1, before: 200, after: 100 }, messageIds: messages.slice(0, archiveCount).map(m => m.id), groups: threadGroups(messages.slice(0, archiveCount)).map(g => ({ ...g, estimatedHeight: 100,
        messageRunIds: Object.fromEntries(messages.slice(0, archiveCount).flatMap(m => g.ids.includes(m.id) && m.runId ? [[m.id, m.runId]] : [])) })) }] : [] });
      else if (c.op === "agent.history.read") {
        const original = messages.slice(0, archiveCount), ids = threadGroups(original).find(g => g.id === c.params?.groupId)?.ids;
        reply({ revision: "2", messages: original.filter(m => !c.params?.groupId || ids?.includes(m.id) || m.role === "toolResult") });
      }
      else if (c.op === "agent.environment") reply(environment);
      else if (c.op === "processing.get") {
        const captured = structuredClone(c.params?.id === extra?.id ? extra : record);
        if (failDetail) s.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: "TEMPORARY_FAILURE", message: "fixture detail read failed" } }));
        else if (holdDetail) heldDetails.push(() => reply(captured));
        else reply(captured);
      }
      else if (c.op === "processing.list") {
        const matching = c.params?.sessionId === record.sessionId;
        const summary = ({ calls, stages, result, ...s }: ProcessingRecord) => s;
        if (matching && emptyPages && (c.params?.before === undefined || c.params.before === 50)) reply({ items: Array.from({ length: 50 }, (_, i) => ({ ...summary(record), state: "completed", id: `empty-${c.params?.before ?? 100}-${i}`, outcome: "no_evidence" })), next: c.params?.before === 50 ? 25 : 50 });
        else reply({ items: matching ? [record, ...(extra ? [extra] : [])].map(summary) : [], next: null });
      } else { blocked.push(c.op); reply(null); }
    });
  });
  await page.goto(origin + "title-result-check"); await card.waitFor();
  await expectSummaryCard();
  assert.match(await card.getByRole("button").getAttribute("aria-label") ?? "", /进行中/);
  assert.equal(await card.locator('.process-status-text.is-active').count(), 1, "real running status animates");
  assert.equal(await card.locator('use[href="#i-heading"]').count(), 1, "Lucide title icon");
  const normalIconColor = await card.locator(".title-result-icon").evaluate(node => getComputedStyle(node).color);
  assert.equal(commands.filter(c => c.op === "processing.get").length, 0, "running card never preloads request body");
  await card.getByRole("button").click(); await panel.waitFor();
  assert.equal(await panel.evaluate(n => n instanceof HTMLDialogElement && n.matches(":modal")), true, "native modal, not a popover");
  await panel.getByText("真实输入资料", { exact: false }).waitFor();
  assert.match(await panel.innerText(), /读取标题资料/); assert.match(await panel.innerText(), /生成会话标题/);
  await page.screenshot({ path: join(artifacts, "running-modal.png") });
  // Update the actual record while the same dialog stays open.
  record = { ...record, state: "failed", stage: "生成失败", endedAt: Date.now(), error: "fixture provider timeout", calls: record.calls.map(c => ({ ...c, state: "failed", endedAt: Date.now(), error: "fixture provider timeout" })) };
  publish(); await panel.getByRole("alert").getByText("fixture provider timeout", { exact: true }).waitFor();
  await expectSummaryCard(); assert.equal(await card.getAttribute("data-state"), "failed");
  assert.match(await card.locator(".title-result-trigger").getAttribute("aria-label") ?? "", /失败/); assert.equal(await panel.count(), 1);
  await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
  assert.equal(await card.getByRole("button").evaluate(n => document.activeElement === n), true, "focus returns to trigger");
  let afterClose = detailReads();
  for (const state of ["failed", "interrupted", "cancelling", "cancelled", "invalidated"] as const) {
    record = { ...record, state }; publish();
    await page.locator(`.title-result-card[data-state="${state}"]`).waitFor(); await tick();
    await expectSummaryCard(); assert.equal(detailReads(), afterClose, `closed ${state} card never loads details`);
    const color = await card.locator(".title-result-icon").evaluate(node => getComputedStyle(node).color);
    if (state === "failed" || state === "interrupted") assert.notEqual(color, normalIconColor, "failures retain visible error color");
    else assert.equal(color, normalIconColor, "cancellation/invalidation are not failure-colored");
    await card.getByRole("button").click(); await panel.waitFor();
    if (state === "failed" || state === "interrupted") await panel.getByRole("alert").getByText("fixture provider timeout", { exact: true }).waitFor();
    else {
      await panel.locator(".title-dialog-notice").filter({ hasText: "fixture provider timeout" }).waitFor();
      assert.equal(await panel.getByRole("alert").count(), 0, `${state} is not a failure`);
    }
    await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
    afterClose = detailReads();
  }
  record = { ...record, state: "completed", outcome: "no_evidence", error: null }; publish(); await card.waitFor({ state: "detached" });
  record = { ...record, state: "completed", outcome: "applied", stage: "标题已生效", startedAt: 1000, endedAt: 6800,
    result: { text: JSON.stringify({ title: "检查代码正确性", applied: true }), truncated: false },
    calls: [{ ...record.calls[0], state: "completed", endedAt: 6800, error: undefined, output: { text: "检查代码正确性", truncated: false } },
      ...Array.from({ length: 5 }, (_, index) => ({ ...record.calls[0], id: `scroll-call-${index}`, state: "completed" as const, endedAt: 6800, error: undefined,
        input: { text: "用于验证滚动时顶部固定的调用输入。\n".repeat(35), truncated: false },
        output: { text: "调用输出详情。\n".repeat(35), truncated: false } }))] }; publish();
  await page.locator('.title-result-card[data-state="completed"]').waitFor(); await expectSummaryCard(); await tick();
  assert.equal(detailReads(), afterClose, "completion does not load the generated result while closed");
  const beforeReload = detailReads(); await page.reload(); await card.waitFor(); await tick();
  await expectSummaryCard(); assert.equal(detailReads(), beforeReload, "cold completed cards do not load bodies on refresh");
  failDetail = true; await card.getByRole("button").click(); await panel.getByRole("alert").filter({ hasText: "fixture detail read failed" }).waitFor();
  await expectSummaryCard(); assert.equal(detailReads(), beforeReload + 1, "first click attempts one detail read");
  failDetail = false; await panel.getByRole("button", { name: "重新读取", exact: true }).click();
  await panel.locator(".title-dialog-result").getByText("检查代码正确性", { exact: true }).waitFor();
  assert.match(await panel.locator(".title-dialog-summary").innerText(), /5\.8 秒/);
  assert.equal(detailReads(), beforeReload + 2, "retry reads the same revision and clears the error");
  assert.equal(await panel.getByRole("alert").count(), 0);
  await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
  const beforeClosedUpdate = detailReads(); publish(); await tick(); await expectSummaryCard();
  assert.equal(detailReads(), beforeClosedUpdate, "closing unmounts the body subscription before updates");
  holdDetail = true; await card.getByRole("button").click(); await panel.waitFor(); await tick();
  assert.equal(heldDetails.length, 1, "reopening after a revision change requests fresh details");
  await expectSummaryCard(); await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
  holdDetail = false; heldDetails.shift()!(); await tick();
  assert.equal(await panel.count(), 0, "a late detail receipt cannot reopen the dialog");
  assert.equal(await card.locator("xpath=ancestor::details").count(), 0);
  assert.equal(await card.locator("..").locator("[data-delivery-start]").count(), 0, "not a delivery or message");
  // A later conversation is appended; the title stays at the original trigger.
  messages.push({ id: "later-user", runId: "later", role: "user", text: "第二轮问题", status: "completed" }, { id: "later-final", runId: "later", role: "assistant", text: "第二轮结果", phase: "final_answer", status: "completed" });
  snapshot(sockets.at(-1)!, "messages:work:session"); snapshot(sockets.at(-1)!, "thread:work:session"); await page.getByText("第二轮结果", { exact: true }).waitFor();
  let keys = await rowKeys(); assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:later-user"), JSON.stringify(keys));
  for (let i = 0; i < 4; i++) publish(); await tick(); assert.equal(await card.count(), 1);
  emptyPages = true; publish(); await tick(); await card.waitFor();
  assert.ok(commands.some(c => c.op === "processing.list" && c.params?.before === 50)); assert.ok(commands.some(c => c.op === "processing.list" && c.params?.before === 25));
  assert.ok(commands.filter(c => c.op === "processing.get").every(c => c.params?.id === "title-result"));
  for (const [width, height] of [[1440, 900], [768, 900], [390, 900], [320, 900], [1440, 360], [390, 320]]) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => (window as any).renderSession("session", true)); await tick();
    await card.scrollIntoViewIfNeeded(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await card.getByRole("button").click(); await panel.waitFor();
    await panel.getByText("真实输入资料", { exact: false }).waitFor();
    assert.match(await panel.locator('.title-dialog-call .processing-payload').nth(1).innerText(), /检查代码正确性/);
    assert.ok(await panel.evaluate(n => n.scrollWidth <= n.clientWidth + 1), `no modal overflow ${width}`);
    const body = panel.locator(".title-dialog-body");
    assert.equal(await panel.evaluate(node => getComputedStyle(node).overflowY), "hidden", "local shell overrides shared dialog styles");
    assert.equal(await panel.locator(".dialog-content").evaluate(node => getComputedStyle(node).overflowY), "hidden", "header container never owns scrolling");
    assert.ok(await body.evaluate(node => node.scrollHeight > node.clientHeight + 100), "fixture has genuinely scrollable details");
    const geometry = () => panel.evaluate(node => ({
      shell: node.scrollTop, content: node.querySelector(".dialog-content")!.scrollTop,
      header: [".dialog-content > h2", ".title-dialog-summary", ".title-dialog-close"].map(selector => {
        const rect = node.querySelector(selector)!.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
      thread: document.querySelector(".thread")!.scrollTop,
    }));
    const before = await geometry(), box = (await body.boundingBox())!;
    assert.ok(box.height > 20, `details remain usable in ${width}x${height}`);
    await page.mouse.move(box.x + 4, box.y + Math.min(40, box.height / 2));
    await page.mouse.wheel(0, 300); await page.waitForFunction(() => document.querySelector(".title-dialog-body")!.scrollTop > 0);
    await tick(); assert.deepEqual(await geometry(), before, `only details scroll; top stays fixed at ${width}x${height}`);
    await body.evaluate(node => { node.scrollTop = node.scrollHeight; }); await tick();
    assert.deepEqual(await geometry(), before, "header remains fixed at the end of long details");
    // Wheel at the lower boundary must not transfer to the modal shell or background.
    await page.mouse.wheel(0, 600); await tick(); assert.deepEqual(await geometry(), before, "no scroll chaining or header jitter");
    const closeBox = (await panel.locator(".title-dialog-close").boundingBox())!;
    assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= height, "close stays visible even in short windows");
    await page.screenshot({ path: join(artifacts, `title-modal-${width}x${height}.png`) });
    await panel.getByRole("button", { name: "关闭标题生成详情" }).click(); await panel.waitFor({ state: "detached" });
  }
  // Cold compressed history uses catalogue IDs/runIds, never preloads original bodies.
  archived = true; emptyPages = false;
  // Product defaults open the latest three ranges. Explicitly close this fixture
  // before asserting that locating a closed archive does not hydrate its bodies.
  await page.evaluate(() => sessionStorage.setItem("axiom:history-ranges:work:session", JSON.stringify({ archive: false })));
  const beforeColdArchive = detailReads(); await page.reload(); await card.waitFor(); await tick();
  assert.equal(detailReads(), beforeColdArchive, "cold archived cards also remain summary-only");
  assert.equal(commands.filter(c => c.op === "agent.history.read").length, 0);
  keys = await rowKeys(); assert.ok(keys.indexOf("compression:archive") < keys.indexOf("title:title-result")); assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:later-user"));
  await page.getByRole("button", { name: "展开会话原文" }).click(); await page.getByText("检查完成，代码无误。", { exact: true }).waitFor();
  keys = await rowKeys(); assert.ok(keys.indexOf("archive:archive:final") < keys.indexOf("title:title-result")); assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:later-user"));
  await page.reload(); await card.waitFor(); keys = await rowKeys(); assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:later-user"));
  // Legacy records locate their run, not the most recent tail. Same-run attempts remain independent.
  record = { ...record, anchorMessageId: undefined }; extra = { ...record, id: "second-attempt", anchorMessageId: "final", startedAt: 2000 }; publish();
  await page.locator('[data-processing-id="second-attempt"]').waitFor(); assert.equal(await page.locator(".title-result-card").count(), 2);
  keys = await rowKeys(); assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:later-user"));
  extra = undefined; record = { ...record, runId: "unknown", anchorMessageId: "missing" }; publish(); await card.waitFor({ state: "detached" });
  record = { ...record, runId: "run", anchorMessageId: "final", outcome: "not_applied", result: { text: JSON.stringify({ title: "新标题未采用", applied: false }), truncated: false } }; publish();
  await card.getByRole("button", { name: "查看标题生成详情：成功 · 未采用", exact: true }).waitFor();
  await expectSummaryCard();
  await card.getByRole("button").click(); await panel.locator(".title-dialog-result").getByText("新标题未采用", { exact: true }).waitFor();
  await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" });
  const beforeReconnect = detailReads();
  await page.evaluate(() => (window as any).renderSession("other")); await tick(); assert.equal(await card.count(), 0);
  await page.evaluate(() => (window as any).renderSession()); await card.waitFor(); sockets.at(-1)!.close(); await page.waitForTimeout(1800); await card.waitFor();
  assert.equal(await card.count(), 1); await tick(); assert.equal(detailReads(), beforeReconnect, "scope switching/reconnect never preload closed details");
  await page.setViewportSize({ width: 320, height: 900 });
  modelName = "超长模型显示名称用于检查卡片保持两行且不会横向溢出".repeat(5);
  snapshot(sockets.at(-1)!, "configuration"); await tick();
  const copy = card.locator(".title-result-copy");
  assert.equal(await copy.locator("small").getAttribute("title"), `OpenAI / ${modelName}`, "truncated model remains available in tooltip");
  assert.ok(await copy.locator("small").evaluate(node => node.scrollWidth > node.clientWidth), "long model is truncated instead of wrapping");
  assert.ok(await copy.evaluate(node => node.getBoundingClientRect().height <= 40), "card copy remains exactly two lines");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "long model does not overflow narrow window");
  await page.screenshot({ path: join(artifacts, "summary-card-long-model-320.png") });
  // A title is a real display boundary even when no assistant prose follows.
  archived = false; emptyPages = false; modelName = "GPT 标题模型";
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); livePhase = "executing_tools";
    messages.splice(0, messages.length,
      { id: "user", runId: "run", role: "user", text: "继续检查", status: "completed" },
      { id: "before-thought", runId: "run", role: "assistant", text: "", thinking: "标题之前的思考", thinkingActive: true, streaming: true, status: "running" },
      { id: "before-tool", runId: "run", role: "assistant", text: "", calls: [{ id: "before-read", name: "read", input: '{"path":"before.json"}' }], status: "running" },
      { id: "tool-before-read", role: "toolResult", toolCallId: "before-read", text: "", status: "running", toolStartedAt: Date.now() - 5000 });
    record = { ...record, state: "running", outcome: undefined, endedAt: null, error: null,
      anchorMessageId: width === 390 ? "not-yet-visible" : "before-tool" };
    await page.reload();
    const prefix = page.locator('[data-timeline-key="live:process:before-thought"]');
    await prefix.waitFor();
    if (width === 1440) {
      await card.waitFor();
      assert.equal(await prefix.locator('.tool-activity[data-status="running"]').count(), 0);
      await page.locator('#messages > .process-requesting').waitFor();
      assert.equal(await page.locator('#messages > .process-requesting .activity-title').innerText(), "调用工具");
    }
    livePhase = "generating";
    messages.push({ id: "after-thought", runId: "run", role: "assistant", text: "", thinking: "标题之后继续思考", thinkingActive: true, streaming: true, status: "running" });
    snapshot(sockets.at(-1)!, "messages:work:session"); snapshot(sockets.at(-1)!, "thread:work:session");
    if (width === 390) { record = { ...record, anchorMessageId: "before-tool" }; publish(); }
    await card.waitFor();
    const suffix = page.locator('[data-timeline-key="live:process:before-thought:after:before-tool"]');
    await suffix.locator(':scope > .tool-activity > summary .activity-title').getByText("正在思考", { exact: true }).waitFor();
    keys = await rowKeys();
    assert.ok(keys.indexOf("live:process:before-thought") < keys.indexOf("title:title-result"));
    assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:process:before-thought:after:before-tool"), JSON.stringify(keys));
    assert.equal(await prefix.locator('.tool-activity[data-status="running"]').count(), 0);
    assert.equal(await page.locator('#messages .process-status-text.is-active').count(), 2, "only the title card and the new process are active");
    assert.equal(await page.locator('#messages > .process-requesting').count(), 0, "real post-title process replaces the placeholder");
    await prefix.locator(':scope > .tool-activity > summary').click();
    assert.equal(await prefix.locator('.thinking-block[data-status="running"]').count(), 0, "stale thinking before the title is settled");
    const oldDuration = await prefix.locator('.tool-duration').innerText();
    await page.waitForTimeout(350);
    assert.equal(await prefix.locator('.tool-duration').innerText(), oldDuration, "old tool duration does not keep ticking above the title");
    await suffix.evaluate(node => (window as any).__titleSuffix = node.querySelector('.tool-activity'));
    livePhase = "executing_tools";
    messages[messages.length - 1] = { ...messages.at(-1)!, thinkingActive: false, streaming: false, status: "completed" };
    messages.push({ id: "after-tool", runId: "run", role: "assistant", text: " ", calls: [{ id: "after-read", name: "read", input: '{"path":"after.json"}' }], status: "running" },
      { id: "tool-after-read", role: "toolResult", toolCallId: "after-read", text: "", status: "running", toolStartedAt: Date.now() - 5000 });
    snapshot(sockets.at(-1)!, "messages:work:session"); snapshot(sockets.at(-1)!, "thread:work:session");
    await suffix.locator(':scope > .tool-activity > summary .activity-title').getByText("调用工具", { exact: true }).waitFor();
    assert.equal(await suffix.evaluate(node => (window as any).__titleSuffix === node.querySelector('.tool-activity')), true, "normal post-title thinking/tool flow remains continuous");
    await suffix.locator(':scope > .tool-activity > summary').click();
    await suffix.getByText("标题之后继续思考", { exact: true }).waitFor();
    assert.equal(await prefix.getByText("标题之后继续思考", { exact: true }).count(), 0);
    const elapsed = parseFloat(await suffix.locator('.tool-duration').innerText());
    await page.waitForTimeout(350);
    assert.ok(parseFloat(await suffix.locator('.tool-duration').innerText()) > elapsed, "new tool duration keeps ticking below the title");
    for (let i = 0; i < 3; i++) publish(); await tick();
    assert.equal(await card.count(), 1);
    await page.screenshot({ path: join(artifacts, `title-process-boundary-${width}.png`) });
    await page.reload(); await card.waitFor(); await suffix.waitFor();
    keys = await rowKeys(); assert.ok(keys.indexOf("title:title-result") < keys.indexOf("live:process:before-thought:after:before-tool"), "reload reconstructs the boundary");
  }
  // The same boundary survives compaction through an original lazy-read group.
  archived = true; archiveCount = 5;
  await page.evaluate(() => sessionStorage.setItem("axiom:history-ranges:work:session", JSON.stringify({ archive: false })));
  const readsBeforeBoundaryArchive = commands.filter(c => c.op === "agent.history.read").length;
  await page.reload(); await card.waitFor(); await tick();
  assert.equal(commands.filter(c => c.op === "agent.history.read").length, readsBeforeBoundaryArchive, "a closed title-bearing archive does not hydrate originals");
  await page.getByRole("button", { name: "展开会话原文" }).click();
  const archivedPrefix = page.locator('[data-timeline-key="archive:archive:process:before-thought"]');
  const joinedSuffix = page.locator('[data-timeline-key="archive:archive:process:before-thought:after:before-tool"]');
  await archivedPrefix.waitFor(); await joinedSuffix.waitFor(); await tick();
  assert.equal(commands.filter(c => c.op === "agent.history.read" && c.params?.groupId === "process:before-thought").length, 0,
    "expanding the range does not hydrate a split process while both disclosures remain closed");
  keys = await rowKeys(); assert.ok(keys.indexOf("archive:archive:process:before-thought") < keys.indexOf("title:title-result"));
  assert.ok(keys.indexOf("title:title-result") < keys.indexOf("archive:archive:process:before-thought:after:before-tool"), JSON.stringify(keys));
  assert.equal(await archivedPrefix.locator('.tool-activity[data-status="running"]').count(), 0);
  await joinedSuffix.locator(':scope > .tool-activity > summary').click();
  await joinedSuffix.getByText("标题之后继续思考", { exact: true }).waitFor();
  assert.equal(await archivedPrefix.getByText("标题之后继续思考", { exact: true }).count(), 0);
  const boundaryReads = commands.filter(c => c.op === "agent.history.read").slice(readsBeforeBoundaryArchive);
  assert.ok(boundaryReads.some(c => c.params?.groupId === "process:before-thought"), "split ranges read the original group ID");
  assert.ok(boundaryReads.every(c => !String(c.params?.groupId).includes(":after:")), "synthetic display IDs never reach archive reads");
  // Task visibility belongs to the retained group, not to a discarded aggregate summary.
  messages[4] = { ...messages[4], calls: [{ id: "archived-delegate", name: "delegate", input: JSON.stringify({ context: "归档任务", tasks: [{ title: "标题之后的子任务", task: "检查归档分段" }] }) }] };
  await page.reload(); await joinedSuffix.waitFor();
  await joinedSuffix.getByRole("region", { name: "子代理协作" }).waitFor();
  await joinedSuffix.getByText("标题之后的子任务", { exact: true }).waitFor();
  assert.equal(await archivedPrefix.getByText("标题之后的子任务", { exact: true }).count(), 0, "archive tasks remain visible only in their own suffix without opening a disclosure");
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  assert.ok(commands.every(c => ["subscribe", "unsubscribe", "ping", "read.cancel", "agent.history.index", "agent.history.read", "agent.environment", "processing.list", "processing.get"].includes(c.op)));
  console.log(`PASS title process: summary-only two-line cards, lazy detail/error retry/close/reconnect, live animation, native modal/input/output/error, focus, exact/legacy/unknown anchors, later rounds, collapsed/expanded/cold history, multi-page summaries, multiple attempts, scope/reconnect, fixed modal header/body-only wheel scrolling, short windows, 320/390/768/1440. Artifacts: ${artifacts}`);
} finally {
  await page.screenshot({ path: join(artifacts, "last-state.png") }).catch(() => {});
  writeFileSync(join(artifacts, "audit.json"), JSON.stringify({ commands, errors, blocked, text: await page.locator("body").innerText().catch(() => "") }, null, 2));
  await browser.close(); await server.close();
}
