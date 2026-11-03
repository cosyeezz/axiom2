import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { ModelAccount } from "../src/shared/model-accounts.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";

const output = process.env.AXIOM_CARD_ARTIFACTS || "/tmp/acct-visual/r4";
mkdirSync(output, { recursive: true });
const virtual = "virtual:acct-compact";
const fixture = `
import '/platform.ts';import React from 'react';import {createRoot} from 'react-dom/client';
import {ProviderAccounts} from '/models/ProviderAccounts.tsx';import {Icons} from '/components.tsx';
import {TooltipLayer} from '/TooltipLayer.tsx';import {initializeTheme} from '/theme.tsx';
import {connect} from '/transport.ts';import {initializeDisplaySettings,setDisplaySettings} from '/display-settings.ts';
import '/styles/tokens.css';import '/styles/settings.css';import '/styles/models.css';await import('/styles/page-overrides.css');
initializeTheme();initializeDisplaySettings();window.setScale=fontScale=>setDisplaySettings({fontScale});
createRoot(document.getElementById('root')).render(<><Icons/><main className="settings-main" style={{padding:16}}><ProviderAccounts providerId="openai-codex" blocked={false} add={()=>{}} changed={async()=>{}} busyChanged={()=>{}}/></main><TooltipLayer/></>);connect();`;
const temporary = mkdtempSync(join(tmpdir(), "acct-compact-"));
const server = await createServer({ configFile: resolve("vite.config.ts"), cacheDir: join(temporary, "vite-cache"),
  plugins: [{ name: "acct-compact", resolveId(id) { if (id === virtual) return id; },
    async load(id) { if (id === virtual) return (await import("esbuild")).transform(fixture, { loader: "tsx", jsx: "automatic" }); } }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const long = "very-long-identity-without-a-natural-break-".repeat(4);
const account = (id: string, c: Partial<ModelAccount> = {}): ModelAccount => ({ id, providerId: "openai-codex", label: id, region: "美国", active: false, legacy: false, type: "oauth", createdAt: 1, ...c });
const rows = [account("official", { label: "工作账号", active: true, email: "authorization@example.test", emailSource: "token", plan: "plus", expiresAt: Date.now() + 9 * 86400000 }),
  account("unknown", { label: `长账号名称 · ${long}`, region: `认证区域 · ${long}`, email: `${long}@example.test`, emailSource: "token", expiresAt: 1 }),
  account("zero", { label: "零余额账号" }), account("api", { label: "OpenAI API Key", type: "api_key" })];
const deadline = Date.parse("2099-01-02T03:04:05Z"), expiries = [deadline, deadline + 86400000, deadline + 172800000];
const usage = (id: string): ProviderUsage => {
  const row = rows.find(r => r.id === id)!;
  if (row.type === "api_key") return { providerId: row.providerId, status: "unsupported", refreshable: false, metrics: [], message: "只读额度尚未接入，未知余额不会显示为 0。" };
  const unknown = id === "unknown", zero = id === "zero";
  return { providerId: row.providerId, status: "ready", accountStatus: { state: unknown ? "unknown" : "active", checkedAt: Date.now() }, updatedAt: Date.now(),
    ...(unknown ? { stale: true, message: `查询失败，保留上次结果；详细原因 ${long}` } : {}),
    account: { email: unknown ? `${long}@upstream.example.test` : id === "official" ? "authorization@example.test" : `${id}@upstream.example.test`, plan: unknown ? `Enterprise · ${long}` : "pro",
      accountId: id === "official" ? "upstream-official" : `acct-${long}`, ...(id === "official" ? { subscriptionExpiresAt: Date.parse("2098-06-01T00:00:00Z") } : {}) }, metrics: [
      { id: "secondary_window", label: "7天已用", kind: "window", usedPercent: zero ? 100 : 90, resetsAt: Date.now() + 86400000, windowSeconds: 604800 },
      { id: "primary_window", label: "5小时已用", kind: "window", usedPercent: zero ? 100 : 37.5, allowed: !zero, limitReached: zero, resetsAt: Date.now() + 3600000, windowSeconds: 18000 },
      { id: "extra_0_primary_window", label: "Spark 5小时已用", kind: "window", usedPercent: 100, allowed: false, limitReached: true, resetsAt: Date.now() + 3600000, windowSeconds: 18000 },
      { id: "credits", label: "剩余点数", kind: "balance", balance: zero ? "0.0000" : "111.5000", hasCredits: !zero },
      { id: "reset_credits", label: "重置次数", kind: "count", count: zero ? 0 : 3, ...(zero ? {} : { expiresAt: deadline, expiries }) }] } as ProviderUsage;
};
const origin = new URL(server.resolvedUrls!.local[0]).origin, errors: string[] = [], mutations: unknown[] = [], report: unknown[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", r => new URL(r.request().url()).origin === origin ? r.fallback() : r.abort("blockedbyclient"));
  await page.route("**/api/status", r => r.fulfill({ json: { ok: true } }));
  await page.route("**/acct-compact", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${virtual}"></script></body></html>` }));
  await page.routeWebSocket("**/ws", socket => socket.onMessage(raw => {
    const c = JSON.parse(String(raw)), reply = (data: unknown) => socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
    if (["subscribe", "unsubscribe", "ping"].includes(c.op)) return reply({});
    if (c.op === "accounts.list") return reply({ revision: String(mutations.length), accounts: rows });
    if (c.op === "accounts.rename") { mutations.push(c.params); rows.find(r => r.id === c.params.accountId)!.label = c.params.label; return reply({}); }
    if (c.op === "accounts.usage") return reply(usage(String(c.params.accountId)));
    if (c.op === "usage.ledger") return reply({ rows: [], count: 0, page: 1, pageSize: 1, snapshot: "x", partial: false, building: false, updatedAt: Date.now(), total: { records: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, knownCost: 0, estimatedCost: 0, unknownCost: 0, unknownTokens: 0 } });
    socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: "X", message: c.op } }));
  }));
  await page.goto(origin + "/acct-compact");
  const card = (label: string) => page.getByRole("article", { name: `账号 ${label}`, exact: true });
  let official = card("工作账号");
  await official.getByText("剩余 62.5%", { exact: true }).waitFor();
  await official.getByText("账号状态：检查通过", { exact: true }).waitFor();
  assert.equal(await official.locator(".account-card-header .account-status-chip").count(), 0);
  assert.equal(await official.locator("footer .account-status-chip").count(), 1);
  assert.equal(await official.locator(".account-auth-badge").innerText(), "OAuth");
  await page.mouse.move(0, 0);
  assert.equal(await official.locator(".account-card-tools").evaluate(e => getComputedStyle(e).opacity), "0");
  await official.hover();
  assert.equal(await official.locator(".account-card-tools").evaluate(e => getComputedStyle(e).opacity), "1");
  const refresh = official.getByRole("button", { name: "刷新供应商额度", exact: true });
  const muted = await refresh.evaluate(e => getComputedStyle(e).color);
  await refresh.hover();
  assert.notEqual(await refresh.evaluate(e => getComputedStyle(e).color), muted, "hovered icon lights up");
  assert.ok(await refresh.locator("svg").evaluate(e => e.getBoundingClientRect().width <= 12.1));
  for (const badge of await official.locator(".account-active-mark, .account-plan-badge, .account-auth-badge").all()) {
    assert.equal(await badge.evaluate(e => getComputedStyle(e).fontWeight), "400");
    assert.ok(await badge.evaluate(e => parseFloat(getComputedStyle(e).fontSize) <= 9.1));
  }
  await official.locator("h3").dblclick();
  let rename = page.getByRole("dialog", { name: "修改账号名称", exact: true });
  await rename.getByLabel("账号名称", { exact: true }).fill("新工作账号");
  await rename.getByRole("button", { name: "确认", exact: true }).click();
  official = card("新工作账号");
  await official.waitFor();
  assert.deepEqual(mutations, [{ accountId: "official", revision: "0", label: "新工作账号" }]);
  await official.locator(".account-card-name").focus(); await page.keyboard.press("Enter");
  rename = page.getByRole("dialog", { name: "修改账号名称", exact: true });
  await rename.getByRole("button", { name: "取消", exact: true }).click();
  await official.getByRole("button", { name: "查看账号详情", exact: true }).click();
  let details = page.getByRole("dialog", { name: "账号详情：新工作账号", exact: true });
  await details.getByText("upstream-official", { exact: true }).waitFor();
  assert.equal(await details.locator('ol[aria-label="重置券到期明细"] li time').count(), 3);
  await details.getByText("费用估算", { exact: true }).waitFor();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  for (const width of [1440, 1100, 390, 320]) for (const scale of [100, 130, 200]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(s => (window as any).setScale(s), scale); await page.waitForTimeout(120);
    const metrics = await page.locator(".model-account-card").evaluateAll(cards => cards.map(c => {
      const r = c.getBoundingClientRect(), body = c.querySelector<HTMLElement>(".account-card-body")!, br = body.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top, more: !body.lastElementChild!.hasAttribute("hidden"),
        scrollers: [...c.querySelectorAll<HTMLElement>("*")].filter(e => e.offsetWidth > 0 && ((/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1) || (/auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1))).map(e => e.className),
        clippedSections: [...body.children].filter(e => !(e as HTMLElement).hidden && e.getBoundingClientRect().bottom > br.bottom + 1).map(e => e.className),
        overflow: c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1,
        footerInside: c.querySelector("footer")!.getBoundingClientRect().bottom <= r.bottom + 1 };
    }));
    if (metrics.some(m => !m.footerInside || m.overflow || m.clippedSections.length)) {
      console.log("GEOMETRY", width, scale, JSON.stringify(await page.locator(".model-account-card").evaluateAll(cards => cards.map(c => ({
        label: c.getAttribute("aria-label"), card: c.getBoundingClientRect().height,
        parts: [".account-card-header", ".account-card-heading", ".account-card-identity", ".account-provider-panel", ".account-card-body", "footer"].map(s => { const e = c.querySelector(s); return [s, e?.getBoundingClientRect().height, e ? e.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom : null]; })
      })))));
      await page.screenshot({ path: join(output, `failure-${width}-${scale}.png`), fullPage: true });
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page ${width}@${scale}`);
    for (const m of metrics) {
      assert.ok(Math.abs(m.width - m.height) < 1, `square ${width}@${scale}`);
      assert.ok(Math.abs(m.height - metrics[0].height) < 1, "equal heights");
      assert.deepEqual(m.scrollers, [], `no internal scrollers ${width}@${scale}`);
      assert.deepEqual(m.clippedSections, [], `whole sections fit ${width}@${scale}`);
      assert.equal(m.overflow, false, `card overflow ${width}@${scale}`);
      assert.equal(m.footerInside, true, `status/details not clipped ${width}@${scale}`);
    }
    if (width >= 1100) assert.ok(metrics.filter(m => Math.abs(m.top - metrics[0].top) < 1).length >= 2);
    report.push({ width, scale, metrics });
    await page.screenshot({ path: join(output, `page-${width}-${scale}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.evaluate(() => (window as any).setScale(100)); await page.waitForTimeout(100);
  await official.scrollIntoViewIfNeeded();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.mouse.move(0, 0);
  assert.equal(await official.locator(".account-card-tools").evaluate(e => getComputedStyle(e).opacity), "0");
  await official.screenshot({ path: join(output, "card-rest.png") });
  await official.hover(); await official.screenshot({ path: join(output, "card-hover.png") });
  await official.getByRole("button", { name: "选择卡片图标", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择卡片图标：新工作账号", exact: true });
  await picker.getByRole("button", { name: /^Anthropic/ }).click();
  assert.equal(await official.locator(".account-card-avatar").getAttribute("data-icon"), "brand:anthropic");
  await page.reload(); official = card("新工作账号"); await official.waitFor();
  assert.equal(await official.locator(".account-card-avatar").getAttribute("data-icon"), "brand:anthropic");
  assert.deepEqual(errors, [], "browser errors");
  console.log("PASS dense card: dblclick rename RPC + keyboard / small normal-weight badges / hover tools / footer status-details / no scroll or clipped sections 1440,1100,390,320 @100,130,200 / icon persistence", output);
} finally { writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2)); await browser.close(); await server.close(); }
