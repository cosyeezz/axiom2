// Real Usage component, isolated Vite + mock WebSocket. No model or production service.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import { emptyCostTotals, sumCosts, type CostReport, type CostRow } from "../src/shared/costs.js";
import { formatDuration } from "../src/client/chat/duration.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-cost-indicator-"));
const output = resolve(process.env.AXIOM_TEST_OUTPUT ?? "test-results/cost-indicator");
mkdirSync(output, { recursive: true });
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Usage} from '/chat/Usage.tsx';import {Icons} from '/components.tsx';import {acceptSnapshot,connect} from '/transport.ts';
import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/icon-geometry.css';import '/styles/mobile.css';import '/styles/data-icons.css';import '/styles/action-icons.css';import '/styles/theme.css';
const root=createRoot(document.getElementById('root'));let seq=0;let current;
window.show=(options={})=>{const scope={workspaceId:options.workspaceId??'fixture',sessionId:options.sessionId??'parent'};current=scope;
flushSync(()=>root.render(<><Icons/><main style={{height:'100dvh',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'flex-end',padding:'20px 12px'}}><Usage scope={scope}/></main></>));
const run=options.active?{id:'live-run',status:'running',startedAt:Date.now()-(options.liveSeconds??0)*1000,endedAt:null}:options.minutes!=null?{id:'stopped-run',status:'completed',startedAt:1,endedAt:1}:null;
acceptSnapshot({scope:'agent:'+scope.workspaceId+':'+scope.sessionId,streamId:'fixture',seq:++seq,data:{selection:null,environment:null,task:scope.sessionId==='parent'?undefined:{id:'task',parentSessionId:'parent',status:'completed'},run,completedRunDurationMs:(options.minutes??0)*60000,usage:{input:1,output:1,cacheRead:1,cacheWrite:0,total:3,cost:999,lastRequest:{input:1,cacheRead:1,cacheWrite:0},context:{tokens:1,window:100,estimated:false}}}});};
window.invalidate=()=>acceptSnapshot({scope:'costs:'+current.workspaceId+':'+current.sessionId,streamId:'fixture',seq:++seq,data:{revision:seq}});
window.show();connect();`;
const server = await createServer({
  configFile: false, root: resolve("src/client"), cacheDir: join(temporary, "vite-cache"),
  plugins: [{ name: "cost-indicator-fixture", resolveId(id) { if (id === "virtual:cost-indicator") return id; },
    load(id) { if (id === "virtual:cost-indicator") return fixture; },
    transform(code, id) { if (id === "virtual:cost-indicator") return import("esbuild").then(e => e.transform(code, { loader: "tsx", jsx: "automatic" })); } }],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(".")] } },
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
type Amount = { dollars: number; unknown?: boolean; records?: number; estimated?: boolean };
type Scope = { workspaceId: string; sessionId: string };
const amounts = new Map<string, Amount>(), delays = new Map<string, number>();
const key = (scope: Scope) => JSON.stringify([scope.workspaceId, scope.sessionId]);
const parent = { workspaceId: "fixture", sessionId: "parent" };
const setAmount = (dollars: number, options: Omit<Amount, "dollars"> = {}, scope = parent) => amounts.set(key(scope), { dollars, ...options });
const reads: Scope[] = [], inFlight = new Map<string, number>(), maxInFlight = new Map<string, number>();
const reportFor = (scope: Scope): CostReport => {
  const amount = amounts.get(key(scope)) ?? { dollars: 0 };
  const own: CostRow = { ...emptyCostTotals(), records: amount.records ?? 1, knownCost: amount.dollars, unknownCost: amount.unknown ? 1 : 0,
    id: "own", category: scope.sessionId === "parent" ? "main" : "subagent", sessionId: scope.sessionId, source: "fixture", provider: "fixture", model: "fixture",
    ...(amount.estimated ? { estimatedCost: amount.dollars, estimatedRecords: 1, estimateSources: ["glm-5.3 · 2026-10-27 · https://docs.z.ai/guides/overview/pricing"] } : {}) };
  own.tokens.input = 100; own.parts.input = amount.dollars;
  // Family spending is intentionally high: it must never color the current-session icon.
  const otherId = scope.sessionId === "parent" ? "sibling" : "parent";
  const other: CostRow = { ...own, id: "other", category: "main", sessionId: otherId, knownCost: 250, unknownCost: 0, records: 1, estimatedCost: undefined, estimatedRecords: undefined, estimateSources: undefined };
  const rows = own.records ? [own, other] : [other];
  return { scope: { ...scope, sessionId: "parent" }, requestedSessionId: scope.sessionId, title: "费用图标测试", updatedAt: Date.now(),
    sessions: [{ id: scope.sessionId, title: "当前会话", taskId: scope.sessionId === "parent" ? null : "task", status: "completed" },
      { id: otherId, title: "其他会话", taskId: otherId === "parent" ? null : "sibling-task", status: "completed" }], rows, total: sumCosts(rows), warnings: [] };
};
const until = async (test: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt++) { if (test()) return; await sleep(25); }
  assert.fail("fixture condition timed out");
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/status", route => route.fulfill({ json: { ok: true } }));
  await page.routeWebSocket("**/ws", socket => socket.onMessage(raw => {
    const command = JSON.parse(String(raw));
    if (command.op !== "costs.get") { socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {} })); return; }
    const scope = { workspaceId: command.workspaceId, sessionId: command.sessionId };
    reads.push(scope);
    const id = key(scope), count = (inFlight.get(id) ?? 0) + 1;
    inFlight.set(id, count); maxInFlight.set(id, Math.max(count, maxInFlight.get(id) ?? 0));
    const report = reportFor(scope);
    const send = () => { inFlight.set(id, inFlight.get(id)! - 1); socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: report })); };
    const delay = delays.get(id) ?? 0;
    if (delay) setTimeout(send, delay); else send();
  }));
  await page.route("**/cost-indicator-check", route => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--bg);color:var(--fg)"><div id="root"></div><script type="module" src="/@id/virtual:cost-indicator"></script></body></html>' }));
  const cost = page.locator('[data-od-id="estimated-cost"]'), svg = cost.locator("svg"), bars = cost.locator(".cost-bar");
  const show = async (options: { workspaceId?: string; sessionId?: string; minutes?: number | null; active?: boolean; liveSeconds?: number } = {}) =>
    page.evaluate(options => (window as any).show(options), options);
  const invalidate = async (count = 1) => page.evaluate(count => { for (let i = 0; i < count; i++) (window as any).invalidate(); }, count);
  const expectLevel = async (level: number | null) => {
    await page.waitForFunction(level => document.querySelector('[data-od-id="estimated-cost"] svg')?.getAttribute("data-level") === String(level ?? "unknown"), level);
    assert.deepEqual(await bars.evaluateAll(els => els.map(el => el.getAttribute("data-tone"))), [level == null ? "neutral" : "success", level != null && level >= 1 ? "warning" : "neutral", level != null && level >= 3 ? "danger" : "neutral"]);
    const pulsing = cost.locator('[data-pulse="true"]');
    assert.equal(await pulsing.count(), level === 1 || level === 3 ? 1 : 0);
    if (level === 1 || level === 3) assert.equal(await pulsing.getAttribute("data-tone"), level === 1 ? "warning" : "danger");
  };
  const expectAmount = async (amount: string) => page.waitForFunction(amount => document.querySelector('[data-od-id="estimated-cost"]')?.getAttribute("aria-description")?.includes(amount), amount);
  const update = async (dollars: number, options: Omit<Amount, "dollars"> = {}) => { setAmount(dollars, options); await invalidate(); };
  const escape = async () => { await page.keyboard.press("Escape"); await page.locator(".cost-popover").waitFor({ state: "detached" }); };

  await page.goto(server.resolvedUrls!.local[0] + "cost-indicator-check");
  await expectAmount("$0.0000"); await expectLevel(0); await page.waitForTimeout(300);
  assert.equal(reads.length, 1, "closed toolbar performs one initial read, not zero or duplicate reads");
  assert.match((await cost.getAttribute("data-tooltip"))!, /主会话.*\$0\.0000.*运行.*绿色常亮/);
  const initialReads = reads.length;
  await cost.click(); await page.locator(".cost-session-facts").waitFor();
  assert.equal(await page.locator(".cost-session-facts dd").first().textContent(), "$0.0000");
  await escape(); await page.waitForTimeout(200);
  assert.equal(reads.length, initialReads, "popover shares the mounted toolbar report");
  assert.ok(await cost.evaluate(el => el === document.activeElement), "Escape restores focus");

  const boundaries = [[0, 0], [9.9999, 0], [10, 1], [19.9999, 1], [20, 2], [29.9999, 2], [30, 3], [39.9999, 3], [40, 4], [50, 4]] as const;
  for (const [dollars, level] of boundaries) { await update(dollars); await expectAmount(`$${dollars.toFixed(4)}`); await expectLevel(level); }
  await update(0); await expectAmount("$0.0000");
  const beforeTime = reads.length;
  for (const [minutes, level] of boundaries) {
    await show({ minutes }); await expectLevel(level);
    assert.ok((await cost.getAttribute("data-tooltip"))!.includes(formatDuration(minutes * 60)), `${minutes} minutes appears in tooltip`);
  }
  assert.equal(reads.length, beforeTime, "duration updates do not rescan the ledger");
  await update(8); await expectAmount("$8.0000"); await show({ minutes: 25 }); await expectLevel(2);
  await update(35); await expectAmount("$35.0000"); await show({ minutes: 12 }); await expectLevel(3);
  await show(); await update(0, { unknown: true }); await expectAmount("未知"); await expectLevel(null);
  await update(12, { unknown: true }); await expectAmount("$12.0000 + 未知"); await expectLevel(1);
  assert.match((await cost.getAttribute("data-tooltip"))!, /至少橙色.*已知下限/);
  await update(1, { unknown: true }); await expectAmount("$1.0000 + 未知"); await show({ minutes: 1 }); await expectLevel(null);
  await update(0, { unknown: true }); await expectAmount("预计费用（已记录价格／公开价估算）：未知"); await show({ minutes: 31 }); await expectLevel(3);
  await show(); await update(0, { records: 0 }); await expectAmount("预计费用（已记录价格／公开价估算）：—"); await expectLevel(null);

  // Parent and child use their own row sums, never AgentInfo.usage.cost or report.total.
  await update(40); await expectLevel(4);
  const child = { ...parent, sessionId: "child" }; setAmount(4, {}, child);
  await show({ sessionId: "child", minutes: 1 }); await expectAmount("$4.0000"); await expectLevel(0);
  assert.match((await cost.getAttribute("data-tooltip"))!, /子会话/);
  await cost.click(); await page.locator(".cost-session-facts").waitFor();
  assert.equal(await page.locator(".cost-session-facts dd").first().textContent(), "$4.0000");
  await show(); await page.locator(".cost-popover").waitFor({ state: "detached" }); await expectAmount("$40.0000"); await expectLevel(4);
  const foreign = { workspaceId: "foreign", sessionId: "parent" }; setAmount(3, {}, foreign);
  await show(foreign); await expectAmount("$3.0000"); await expectLevel(0);
  const slow = { ...parent, sessionId: "slow" }, fast = { ...parent, sessionId: "fast" };
  setAmount(40, {}, slow); setAmount(2, {}, fast); delays.set(key(slow), 450);
  await show({ ...slow, minutes: 1 }); await expectLevel(null); await until(() => reads.some(scope => key(scope) === key(slow)));
  await show(fast); await expectAmount("$2.0000"); await expectLevel(0); await page.waitForTimeout(550);
  await expectAmount("$2.0000"); await expectLevel(0);

  await show(); await expectAmount("$40.0000");
  await until(() => [...inFlight.values()].every(count => count === 0)); await page.waitForTimeout(200);
  const beforeBurst = reads.length;
  setAmount(12); await invalidate(30); await expectAmount("$12.0000"); await page.waitForTimeout(220);
  assert.equal(reads.length - beforeBurst, 1, "notification burst preserves one coalesced deadline");
  delays.set(key(parent), 350);
  const beforeSerial = reads.length;
  setAmount(20); await invalidate(); await until(() => reads.length > beforeSerial);
  setAmount(30); await invalidate(20);
  await expectAmount("$20.0000"); await expectAmount("$30.0000"); await page.waitForTimeout(200);
  assert.equal(reads.length - beforeSerial, 2, "in-flight invalidations cause one follow-up read");
  assert.ok([...maxInFlight.values()].every(count => count === 1), "reads are serial per mounted scope");
  delays.delete(key(parent)); await update(0); await expectAmount("$0.0000");
  await show({ active: true, liveSeconds: 599 }); await expectLevel(0);
  const beforeTicks = reads.length;
  await page.waitForFunction(() => document.querySelector('[data-od-id="estimated-cost"] svg')?.getAttribute("data-level") === "1", null, { timeout: 3500 });
  await page.waitForTimeout(1100);
  assert.equal(reads.length, beforeTicks, "live timer crosses a tier without a per-second cost request");
  await show();

  // Actual theme colors, original geometry and stable semantic strokes on interaction.
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const neutral = theme === "light" ? "rgb(100, 108, 101)" : "rgb(138, 143, 152)";
    const highlighted = theme === "light" ? "rgb(37, 40, 36)" : "rgb(247, 248, 248)";
    const tones = theme === "light" ? ["rgb(40, 117, 62)", "rgb(169, 79, 29)", "rgb(180, 35, 35)"] : ["rgb(39, 166, 68)", "rgb(240, 153, 91)", "rgb(239, 83, 80)"];
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--danger-icon").trim()), theme === "light" ? "#ae3838" : "#d99595", "the cost-specific red leaves the shared danger palette unchanged");
    for (const [dollars, level] of [[0, 0], [10, 1], [20, 2], [30, 3], [40, 4]] as const) {
      await update(dollars); await expectAmount(`$${dollars.toFixed(4)}`); await expectLevel(level);
      await page.mouse.move(0, 0); await cost.evaluate(el => (el as HTMLElement).blur());
      await page.waitForFunction(neutral => getComputedStyle(document.querySelector(".cost-axis")!).stroke === neutral, neutral);
      const expected = [tones[0], level >= 1 ? tones[1] : neutral, level >= 3 ? tones[2] : neutral];
      assert.deepEqual(await bars.evaluateAll(els => els.map(el => getComputedStyle(el).stroke)), expected);
      await cost.hover();
      await page.waitForFunction(highlighted => getComputedStyle(document.querySelector(".cost-axis")!).stroke === highlighted, highlighted);
      assert.deepEqual(await bars.evaluateAll(els => els.map(el => getComputedStyle(el).stroke)), expected.map((color, i) => i > 0 && ((i === 1 && level < 1) || (i === 2 && level < 3)) ? highlighted : color));
      await page.mouse.move(0, 0); await cost.focus(); await page.keyboard.press("Enter"); await page.locator(".cost-popover").waitFor();
      assert.equal(await cost.getAttribute("aria-expanded"), "true");
      const colored = await bars.evaluateAll(els => els.filter(el => el.getAttribute("data-tone") !== "neutral").map(el => getComputedStyle(el).stroke));
      assert.deepEqual(colored, tones.slice(0, level < 1 ? 1 : level < 3 ? 2 : 3));
      await escape();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const box = (await cost.boundingBox())!, glyph = (await svg.boundingBox())!;
        assert.ok(box.width >= 44 && box.height >= 44, `${theme}/${level}/${width}: 44px touch target`);
        assert.equal(glyph.width, 16); assert.equal(glyph.height, 16);
      }
      await page.locator(".usage-row").screenshot({ path: join(output, `${theme}-level-${level}.png`) });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  assert.equal(await svg.getAttribute("viewBox"), "2 2 20 20");
  assert.deepEqual(await bars.evaluateAll(els => els.map(el => el.getAttribute("d"))), ["M8 17v-3", "M13 17V9", "M18 17V5"]);
  assert.deepEqual(await bars.first().evaluate(el => { const style = getComputedStyle(el); return [style.strokeWidth, style.vectorEffect]; }), ["1.2px", "non-scaling-stroke"]);
  for (const dollars of [10, 30]) {
    await page.emulateMedia({ reducedMotion: "no-preference" }); await update(dollars); await expectAmount(`$${dollars.toFixed(4)}`);
    const pulsing = cost.locator('[data-pulse="true"]');
    assert.equal(await pulsing.evaluate(el => getComputedStyle(el).animationName), "cost-bar-pulse");
    const samples: number[] = [];
    for (const time of [0, 900, 1800]) samples.push(await pulsing.evaluate(async (el, time) => {
      const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = time;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); return Number(getComputedStyle(el).opacity);
    }, time));
    assert.ok(samples[0] > .99 && samples[1] >= .39 && samples[1] <= .41 && samples[2] > .99, `1.8s breathing never extinguishes the bar: ${samples}`);
    assert.ok(await cost.locator('.cost-bar:not([data-pulse])').evaluateAll(els => els.every(el => getComputedStyle(el).opacity === "1" && getComputedStyle(el).animationName === "none")), "previous bars remain steady");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await pulsing.evaluate(el => getComputedStyle(el).animationName), "none");
    assert.equal(await pulsing.evaluate(el => getComputedStyle(el).opacity), "1");
  }
  await show(); await update(2.36, { estimated: true }); await expectAmount("$2.3600（含估算）");
  await cost.click(); await page.locator(".cost-session-facts").waitFor();
  assert.equal(await page.locator(".cost-session-facts dd").first().textContent(), "$2.3600（含估算）");
  await page.locator("#cost-main .cost-line > summary").first().click();
  await page.waitForFunction(() => document.querySelector("#cost-main .cost-breakdown")?.textContent?.includes("https://docs.z.ai"));
  assert.match(await page.locator("#cost-main .cost-breakdown").first().innerText(), /公开价估算.*2026-10-27/);
  await page.screenshot({ path: join(output, "public-estimate-popover.png") }); await escape();
  assert.deepEqual(errors, [], "no browser runtime errors");
  writeFileSync(join(output, "results.json"), JSON.stringify({ passed: true, reads: reads.length, maxInFlight: Object.fromEntries(maxInFlight), errors,
    checks: ["public estimate labels and source in current-session card and popover", "all dollar/minute boundaries", "max of both metrics", "unknown and partial prices", "own-session ledger not family/agent usage", "workspace/child/late-response isolation", "shared popover reads", "coalescing and serialized follow-up", "live threshold without timer scans", "dark/light hover/focus/expanded", "deeper cost red without changing the shared danger palette", "44px target and 16px glyph", "real CSS opacity and reduced motion"] }, null, 2));
  console.log("PASS: five cost tiers, ledger scope isolation, shared/serialized reads, live time, theme/interaction and reduced-motion animation");
} finally {
  await browser.close(); await server.close(); rmSync(temporary, { recursive: true, force: true });
}
