// Production Usage/MemoryToolbar, transport and cache-only detail; local WS fixture only.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import { emptyCostTotals } from "../src/shared/costs.js";
import type { SessionAccountUsage } from "../src/shared/session-account-usage.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-session-quota-ui-cache-"));
const output = resolve(process.env.AXIOM_TEST_OUTPUT ?? mkdtempSync(join(tmpdir(), "axiom-session-quota-ui-"))); mkdirSync(output, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Usage} from '/chat/Usage.tsx';import {MemoryToolbar} from '/memory/MemoryToolbar.tsx';import {Icons} from '/components.tsx';
import {acceptSnapshot,connect} from '/transport.ts';import {initializeDisplaySettings,setDisplaySettings} from '/display-settings.ts';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/chat.css';await import('/styles/page-overrides.css');
initializeDisplaySettings();const root=createRoot(document.getElementById('root'));let seq=0,revision=0,visible=true;
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visible?'visible':'hidden'});
window.visibility=value=>{visible=value;document.dispatchEvent(new Event('visibilitychange'));};
window.setScale=fontScale=>setDisplaySettings({fontScale});
window.bump=()=>acceptSnapshot({scope:'model-accounts',streamId:'fixture',seq:++seq,data:{revision:++revision}});
window.show=(options={})=>{const scope=options.noScope?undefined:{workspaceId:options.workspaceId??'fixture',sessionId:options.sessionId??'parent'};
  const data={selection:options.provider===null?null:{provider:options.provider??'openai-codex',id:options.model??'fixture-model',thinking:'off'},environment:null,
    run:options.active?{id:options.runId??'run-A',status:options.status??'running',startedAt:Date.now(),endedAt:null}:null,
    usage:{context:{tokens:32000,window:128000,source:'model-usage'},lastRequest:{input:10,cacheRead:90,cacheWrite:0}}};
  flushSync(()=>{root.render(<><Icons/><main className={'app '+(options.variant&&options.variant!=='desktop'?options.variant+'-workbench':'')} style={{height:'100dvh',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'flex-end',padding:'12px'}}>
    <MemoryToolbar scope={scope??null} workspaces={[{id:'fixture',name:'Fixture',path:'/fixture',sessions:[]}]}>{tools=><Usage scope={scope} tools={tools}/>}</MemoryToolbar></main></>);});
    if(scope)acceptSnapshot({scope:'agent:'+scope.workspaceId+':'+scope.sessionId,streamId:'fixture',seq:++seq,data});};
window.show();connect();`;
const virtual = "virtual:session-account-usage";
const server = await createServer({ configFile: resolve("vite.config.ts"), cacheDir: join(temporary, "vite-cache"),
  plugins: [{ name: "session-account-usage-fixture", resolveId(id) { if (id === virtual) return id; },
    async load(id) { if (id === virtual) return (await import("esbuild")).transform(fixture, { loader: "tsx", jsx: "automatic" }); } }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const record = (label = "账号 A", source: SessionAccountUsage["source"] = "execution"): SessionAccountUsage => ({ identity: `fixture:${label}:${source}`, providerId: "openai-codex", source,
  account: { id: "fixture-id", label, email: "fixture@example.test", plan: "plus" },
  usage: { providerId: "openai-codex", status: "ready", updatedAt: Date.now(), account: { email: "official@example.test", plan: "pro" }, metrics: [
    { id: "five-hour", label: "5 小时已用", kind: "window", usedPercent: 100, resetsAt: Date.now() + 3600000, limitReached: true, allowed: false },
    { id: "balance", label: "点数", kind: "balance", balance: "0.0000", hasCredits: false },
    { id: "reset", label: "重置券", kind: "count", count: 0 }] } });
let result: SessionAccountUsage | null = null, delay = 0, lastSocket: any;
const commands: any[] = [], errors: string[] = [], unexpected: string[] = [], network: string[] = [], geometry: unknown[] = [];
const until = async (test: () => boolean) => { for (let n = 0; n < 120; n++) { if (test()) return; await sleep(25); } assert.fail("fixture condition timed out"); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) network.push(request.url()); });
  await page.route("**/*", route => /^(127\.0\.0\.1|localhost)$/.test(new URL(route.request().url()).hostname) ? route.fallback() : route.abort("blockedbyclient"));
  await page.route("**/api/status", route => route.fulfill({ json: { ok: true } }));
  await page.routeWebSocket("**/*", socket => { if (new URL(socket.url()).pathname !== "/ws") { socket.send(JSON.stringify({ type: "connected" })); return; } lastSocket = socket; socket.onMessage(raw => {
    const command = JSON.parse(String(raw)); commands.push(command);
    const reply = (data: unknown) => { try { socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data })); } catch { /* Deliberately late after close. */ } };
    if (["subscribe", "unsubscribe", "ping"].includes(command.op)) { reply({}); return; }
    if (command.op === "costs.get") { reply({ scope: { workspaceId: command.workspaceId, sessionId: command.sessionId }, requestedSessionId: command.sessionId,
      title: "fixture", updatedAt: Date.now(), sessions: [], rows: [], total: emptyCostTotals(), warnings: [] }); return; }
    if (command.op === "agent.accountUsage.cached") { assert.deepEqual(command.params, {}); const value = result && structuredClone(result); if (delay) setTimeout(() => reply(value), delay); else reply(value); return; }
    unexpected.push(command.op); socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false, error: { code: "TEST_UNEXPECTED", message: command.op } }));
  }); });
  await page.route("**/session-account-usage-check", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${virtual}"></script></body></html>` }));
  const show = (options: Record<string, unknown> = {}) => page.evaluate(options => (window as any).show(options), options);
  const bump = () => page.evaluate(() => (window as any).bump());
  const quota = page.locator('[data-od-id="session-account-usage"]'), panel = page.locator(".session-account-usage-detail");
  const reads = () => commands.filter(command => command.op === "agent.accountUsage.cached");
  const escape = async () => { await page.keyboard.press("Escape"); await panel.waitFor({ state: "detached" }); };
  await page.goto(server.resolvedUrls!.local[0] + "session-account-usage-check"); await until(() => reads().length > 0); await page.waitForTimeout(80);
  assert.equal(await quota.count(), 0, "query support alone does not show the shortcut");
  for (const value of [null, { ...record(), usage: { ...record().usage, metrics: [] } }, { ...record(), usage: { ...record().usage, metrics: [{ id: "unknown", label: "未知", kind: "balance" as const, balance: null }] } },
    { ...record(), usage: { ...record().usage, status: "unsupported" as const } }, { ...record(), usage: { ...record().usage, updatedAt: Date.now() + 86400000 } },
    { ...record(), providerId: "wrong-provider" }]) {
    result = value; const previous = reads().length; await bump(); await until(() => reads().length > previous); await page.waitForTimeout(60); assert.equal(await quota.count(), 0);
  }
  result = record(); await show({ active: true }); await quota.waitFor();
  assert.match((await quota.getAttribute("aria-description"))!, /当前执行固定账号.*账号 A/);
  const beforeOpen = commands.filter(command => !["subscribe", "unsubscribe"].includes(command.op)).map(command => command.op);
  await quota.click(); await panel.waitFor(); const text = await panel.innerText();
  assert.match(text, /当前执行固定账号/); assert.match(text, /不跟随后续全局切号/); assert.match(text, /official@example.test/); assert.match(text, /pro/); assert.match(text, /剩余 0%/); assert.match(text, /0\.0000/);
  assert.match(text, /不会发起额度查询或刷新认证/); assert.equal(await panel.locator(".provider-usage-refresh,.provider-usage-estimate").count(), 0);
  assert.deepEqual(commands.filter(command => !["subscribe", "unsubscribe"].includes(command.op)).map(command => command.op), beforeOpen, "opening cached detail adds no provider/pricing/ledger commands");
  await escape(); assert.ok(await quota.evaluate(node => document.activeElement === node));
  await quota.focus(); await page.keyboard.press("Enter"); await panel.waitFor(); await page.mouse.click(800, 10); await panel.waitFor({ state: "detached" });

  // All identity boundaries hide old data synchronously and ignore a deliberately late receipt.
  delay = 350; result = record("迟到 A"); const beforeSlow = reads().length; await show({ sessionId: "slow", active: true });
  assert.equal(await quota.count(), 0); await until(() => reads().length > beforeSlow);
  delay = 0; result = record("快速 B", "next-execution"); await show({ sessionId: "fast" }); await quota.waitFor(); await page.waitForTimeout(450);
  assert.match((await quota.getAttribute("aria-description"))!, /下次执行默认账号.*快速 B/);
  await quota.click(); assert.match(await panel.innerText(), /不是上次调用的账号/); await escape();
  for (const options of [{ sessionId: "fast", model: "new-model" }, { workspaceId: "foreign", sessionId: "fast" }, { sessionId: "fast", active: true, runId: "new-run" },
    { sessionId: "fast", active: true, runId: "new-run", status: "stopping" }]) {
    delay = 80; result = record(); await show(options); assert.equal(await quota.count(), 0); await quota.waitFor();
  }
  delay = 0; await show({ provider: null }); assert.equal(await quota.count(), 0);
  const absentReads = reads().length; await show({ noScope: true }); await page.waitForTimeout(80); assert.equal(reads().length, absentReads);
  result = record("旧数据", "next-execution"); result.usage.stale = true; await show(); await quota.waitFor(); assert.match((await quota.getAttribute("aria-description"))!, /旧数据/);
  await quota.click(); await panel.waitFor(); assert.match(await panel.innerText(), /旧数据/); await bump(); assert.equal(await panel.count(), 0); await quota.waitFor();

  await page.evaluate(() => (window as any).visibility(false)); const beforeHidden = reads().length;
  await page.clock.install(); await page.clock.runFor(5200); await page.waitForTimeout(80); assert.equal(reads().length, beforeHidden, "hidden document never polls the cache");
  await page.evaluate(() => (window as any).visibility(true)); await until(() => reads().length > beforeHidden);
  const previousGeneration = reads().length; result = record("重连 B"); await lastSocket.close({ code: 1012, reason: "offline fixture reconnect" });
  await quota.waitFor({ state: "detached" }); await page.clock.runFor(6000); await until(() => reads().length > previousGeneration); await quota.waitFor();
  assert.match((await quota.getAttribute("aria-description"))!, /重连 B/);

  result = record("账号 A"); await show({ active: true }); await quota.waitFor();
  for (const [width, height] of [[1440, 900], [390, 844], [320, 640], [390, 480]]) {
    await page.setViewportSize({ width, height }); await show({ active: true, variant: width <= 390 ? "android" : "desktop" }); await quota.waitFor();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const scale of [75, 100, 150, 200]) {
        await page.evaluate(scale => (window as any).setScale(scale), scale);
        const rows = await page.locator(".usage-row > button").evaluateAll(nodes => nodes.map(node => { const svg = node.querySelector("svg")!, b = node.getBoundingClientRect(), g = svg.getBoundingClientRect();
          return { id: node.getAttribute("data-od-id"), label: node.getAttribute("aria-label"), x: b.x, y: b.y, width: b.width, height: b.height, glyph: g.width,
            stroke: getComputedStyle(svg).getPropertyValue("--icon-stroke").trim(), centered: Math.abs((b.left+b.right-g.left-g.right)/2) }; }));
        const q = rows.find(row => row.id === "session-account-usage")!, cost = rows.find(row => row.id === "estimated-cost")!, reload = rows.find(row => row.label === "重新加载会话配置")!;
        assert.ok(Math.abs(q.width - 44 * scale / 100) < .12); assert.equal(q.height, q.width); assert.equal(q.width, cost.width); assert.equal(q.width, reload.width);
        assert.ok(Math.abs(q.glyph - 16 * scale / 100) < .12); assert.ok(q.centered < .12); assert.equal(q.stroke, "1.2px");
        assert.equal(q.y, cost.y); assert.equal(q.y, reload.y); assert.ok(Math.abs(q.x - cost.x - q.width) < .12); assert.ok(Math.abs(reload.x - q.x - q.width) < .12);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); geometry.push({ width, height, theme, scale, rows });
      }
      await page.evaluate(() => (window as any).setScale(100)); await quota.click(); await panel.waitFor();
      const readable = await panel.locator(".provider-usage-metric").first().evaluate(node => ({ width: node.getBoundingClientRect().width, labelHeight: node.firstElementChild!.getBoundingClientRect().height,
        layout: getComputedStyle(node.parentElement!).display, direction: getComputedStyle(node.closest(".provider-usage")!).flexDirection }));
      assert.ok(readable.width > 200 && readable.labelHeight < 45, "quota row and label must not collapse into vertical text"); assert.equal(readable.layout, "grid"); assert.equal(readable.direction, "column");
      const box = await panel.boundingBox(); assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `detail stays inside ${width}x${height}`);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: join(output, `${width}x${height}-${theme}.png`), animations: "disabled" }); await escape();
    }
  }
  assert.deepEqual(unexpected, []); assert.deepEqual(network, []); assert.deepEqual(errors, []);
  assert.ok(reads().every(command => command.workspaceId && command.sessionId));
  writeFileSync(join(output, "evidence.json"), JSON.stringify({ geometry, commands: commands.map(({ op, workspaceId, sessionId }) => ({ op, workspaceId, sessionId })), errors, unexpected, network }, null, 2));
  console.log(`PASS cache-only quota UI: known zero, unknown/future/mismatch hidden; no provider/pricing/ledger side effects; scope/model/run/account/connection/late guards; hidden pause; source, keyboard, geometry and 8 screenshots. Evidence: ${output}`);
} catch (error) {
  writeFileSync(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, unexpected, commands: commands.map(command => command.op) }, null, 2));
  console.error(`Fixture evidence: ${output}`, { errors, unexpected, commands: commands.map(command => command.op) }); throw error;
} finally { await browser.close(); await server.close(); rmSync(temporary, { recursive: true, force: true }); }
