// Visual/interaction contract for the real account page. All RPC and usage data are local, synthetic fixtures.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { createServer } from "vite";
import type { ModelAccount, ModelAccounts } from "../src/shared/model-accounts.js";
import type { ModelConfiguration } from "../src/shared/models.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-account-design-cache-"));
const output = resolve(process.env.AXIOM_TEST_OUTPUT ?? mkdtempSync(join(tmpdir(), "axiom-account-design-"))); mkdirSync(output, { recursive: true });
const virtual = "virtual:model-accounts-design";
const fixture = `
import '/platform.ts';import React from 'react';import {createRoot} from 'react-dom/client';
import ModelAccounts from '/pages/ModelAccounts.tsx';import {Icons} from '/components.tsx';
import {TooltipLayer} from '/TooltipLayer.tsx';import {initializeTheme} from '/theme.tsx';
import {acceptSnapshot,connect} from '/transport.ts';import {initializeDisplaySettings,setDisplaySettings} from '/display-settings.ts';
import '/styles/tokens.css';await import('/styles/page-overrides.css');
initializeTheme();initializeDisplaySettings();let seq=0;window.setScale=fontScale=>setDisplaySettings({fontScale});
window.bump=()=>acceptSnapshot({scope:'model-accounts',streamId:'fixture',seq:++seq,data:{revision:seq}});
createRoot(document.getElementById('root')).render(<><Icons/><ModelAccounts/><TooltipLayer/></>);connect();`;
const server = await createServer({ configFile: resolve("vite.config.ts"), cacheDir: join(temporary, "vite-cache"),
  plugins: [{ name: "model-accounts-design-fixture", resolveId(id) { if (id === virtual) return id; },
    async load(id) { if (id === virtual) return (await import("esbuild")).transform(fixture, { loader: "tsx", jsx: "automatic" }); } }],
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const long = "very-long-identity-without-a-natural-break-".repeat(4);
const account = (id: string, changes: Partial<ModelAccount> = {}): ModelAccount => ({ id, providerId: "openai-codex", label: id,
  region: "美国", active: false, legacy: false, type: "oauth", createdAt: 1, ...changes });
const rows = [account("official", { label: "工作账号", active: true, email: "authorization@example.test", emailSource: "token", plan: "plus" }),
  account("unknown", { label: `长账号名称 · ${long}`, region: `认证区域 · ${long}`, email: `${long}@example.test`, emailSource: "token", expiresAt: 1 }),
  account("zero", { label: "零余额账号" }), account("api", { label: "OpenAI API Key", type: "api_key" }),
  account("generic-a", { providerId: "fixture", label: "本地接口", type: "api_key" }),
  account("generic-b", { providerId: "fixture", label: "备用接口账号", type: "api_key" }),
  account("single", { providerId: "kiro", label: "单账号不参与卡片" }),
  account("direct", { providerId: "openai", label: "原有账号", region: "", legacy: true })];
const config: ModelConfiguration = { revision: "fixture", templates: [{ id: "openai-codex", name: "OpenAI", api: "openai-codex-responses", url: "", methods: ["oauth"] }],
  providers: [{ id: "fixture", providerId: "fixture", name: "本地接口", api: "openai-completions", url: "http://127.0.0.1:1", key: "", headers: [], body: [], models: [], auth: { configured: true, methods: ["api_key"] } }] };
const deadline = Date.parse("2099-01-02T03:04:05Z"), expiries = [deadline, deadline + 86400000, deadline + 172800000];
let statusMode: "active" | "disabled" | "missing" = "active";
const usage = (id: string): ProviderUsage => {
  const row = rows.find(row => row.id === id)!;
  if (id === "official" && statusMode === "disabled") return { providerId: row.providerId, status: "unavailable", metrics: [],
    accountStatus: { state: "disabled", checkedAt: Date.now() }, message: "上游明确标记账号或工作区停用，已停止后续查询。" };
  if (id === "official" && statusMode === "missing") return { providerId: row.providerId, status: "ready", updatedAt: Date.now(), nextRefreshAt: Date.now() + 250,
    metrics: [{ id: "primary_window", label: "5小时已用", kind: "window", usedPercent: 50, windowSeconds: 18000, resetsAt: Date.now() + 3600000 },
      { id: "remaining_tokens", label: "剩余 Token", kind: "tokens", model: "fixture", remaining: 1000, used: 10 }] };
  if (id === "direct") return { providerId: row.providerId, status: "unavailable", metrics: [],
    accountStatus: { state: "unknown", checkedAt: Date.now() }, message: "账号状态检查返回 HTTP 403，无法确认状态；已停止后续查询。",
    management: { label: "打开官方用量页", url: "https://chatgpt.com/settings/usage" } };
  if (row.type === "api_key") return { providerId: row.providerId, status: "unsupported", refreshable: false, metrics: [], message: "只读额度尚未接入，未知余额不会显示为 0。" };
  const unknown = id === "unknown", zero = id === "zero";
  return { providerId: row.providerId, status: "ready", accountStatus: { state: "active", checkedAt: Date.now() }, updatedAt: Date.now(), nextRefreshAt: Date.now() + 3600000,
    ...(unknown ? { stale: true, message: `查询失败，保留上次结果；详细原因 ${long}` } : {}),
    account: { email: unknown ? `${long}@upstream.example.test` : `${id}@upstream.example.test`, plan: unknown ? `Enterprise · ${long}` : zero ? "Pro Research Team Annual Plan" : "pro",
      ...(id === "official" ? { accountId: "upstream-official", subscriptionExpiresAt: Date.parse("2098-06-01T00:00:00Z") } : {}) }, metrics: [
      { id: "primary_window", label: "5小时已用", kind: "window", usedPercent: unknown ? null : zero ? 100 : 37.5, allowed: !zero, limitReached: zero, resetsAt: Date.now() + 3600000, windowSeconds: 18000 },
      { id: "secondary_window", label: "7天已用", kind: "window", usedPercent: unknown ? null : zero ? 100 : 90, resetsAt: Date.now() + 86400000, windowSeconds: 604800 },
      { id: "extra_0_primary_window", label: "Spark 5小时已用", kind: "window", usedPercent: unknown ? null : 100, allowed: false, limitReached: true, resetsAt: Date.now() + 3600000, windowSeconds: 18000 },
      { id: "credits", label: "剩余点数", kind: "balance", balance: unknown ? null : zero ? "0.0000" : "111.5000", hasCredits: !zero },
      { id: "reset_credits", label: "重置次数", kind: "count", count: unknown ? null : zero ? 0 : 3, ...(unknown || zero ? {} : { expiresAt: deadline, expiries }) },
    ] };
};
let empty = false, scenario: "direct" | "failed" | "mixed" = "direct", activeId = "official", failNextList = false, holdUsage = false;
const failUsage = new Set<string>(), pendingUsage: (() => void)[] = [], scenes: unknown[] = [];
let disconnectFixture = false, holdList = false; const closeConnections: (() => void)[] = [], pendingList: (() => void)[] = [];
const touch = process.env.AXIOM_TEST_TOUCH !== "0", fixtureOrigin = new URL(server.resolvedUrls!.local[0]).origin;
const commands: { op: string; params?: Record<string, unknown> }[] = [], errors: string[] = [], unexpected: string[] = [], network: string[] = [], geometry: unknown[] = [];
const until = async (test: () => boolean) => { for (let n = 0; n < 120; n++) { if (test()) return; await sleep(25); } assert.fail("fixture condition timed out"); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", hasTouch: touch });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (new URL(request.url()).origin !== fixtureOrigin) network.push(request.url()); });
  await page.route("**/*", route => new URL(route.request().url()).origin === fixtureOrigin ? route.fallback() : route.abort("blockedbyclient"));
  // Vite still injects its CSS/client module with server.hmr=false. Disable only that
  // version-bound dev connection; keep real style injection and reject every WS but /ws.
  await page.route("**/@vite/client", async route => {
    if (new URL(route.request().url()).origin !== fixtureOrigin) { await route.abort("blockedbyclient"); return; }
    const response = await route.fetch({ maxRedirects: 0 }), source = await response.text();
    const start = "transport.connect(createHMRHandler(handleMessage));";
    assert.equal(source.split(start).length, 2, "Vite dev-client fixture must remove exactly one HMR connection");
    await route.fulfill({ response, body: source.replace(start, "/* HMR transport disabled in the offline fixture. */") });
  });
  await page.route("**/api/status", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/model-accounts-design-check", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${virtual}"></script></body></html>` }));
  await page.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    if (url.protocol !== "ws:" || url.host !== new URL(fixtureOrigin).host || url.pathname !== "/ws") { network.push(socket.url()); socket.close({ code: 1008, reason: "Fixture origin only" }); return; }
    if (disconnectFixture) { socket.close({ code: 1012, reason: "Fixture offline" }); return; }
    closeConnections.push(() => socket.close({ code: 1012, reason: "Fixture offline" }));
    socket.onMessage(raw => {
      const command = JSON.parse(String(raw)); commands.push(command);
      const reply = (data: unknown) => socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data }));
      const reject = (code: string, message: string) => socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false, error: { code, message } }));
      const snapshot = (): ModelAccounts => ({ revision: "fixture", accounts: empty ? [] : rows.filter(row => scenario === "mixed" || row.id === (scenario === "direct" ? "direct" : "official")).map(row => ({ ...row, active: row.id === activeId || row.id === "direct" })) });
      if (["subscribe", "unsubscribe", "ping"].includes(command.op)) { reply({}); return; }
      if (command.op === "accounts.list") { if (failNextList) { failNextList = false; reject("FIXTURE_LIST_FAILURE", "离线测试：列表暂不可用"); } else if (holdList) pendingList.push(() => reply(snapshot())); else reply(snapshot()); return; }
      if (command.op === "accounts.activate") { activeId = String(command.params.accountId); failNextList = true; reply(snapshot()); return; }
      if (command.op === "configuration.get") { reply(config); return; }
      if (command.op === "usage.ledger") {
        assert.equal(command.params.providerId, "openai-codex");
        assert.equal(command.params.pageSize, 1, "sample totals are requested without rendering individual records");
        assert.ok(command.params.from < command.params.to && command.params.to <= Date.now());
        reply({ rows: [], count: 4, page: 1, pageSize: 1, snapshot: "fixture-ledger", partial: false, building: false, updatedAt: Date.now(),
          total: { records: 4, input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, knownCost: 15, estimatedCost: 3, unknownCost: 0, unknownTokens: 0 } }); return;
      }
      if (command.op === "accounts.usage") {
        const id = String(command.params.accountId), respond = () => failUsage.has(id) ? reject("FIXTURE_USAGE_FAILURE", "离线查询失败") : reply(usage(id));
        if (holdUsage) pendingUsage.push(respond); else respond(); return;
      }
      unexpected.push(command.op); reject("TEST_UNEXPECTED", command.op);
    });
  });
  const card = (id: string) => page.getByRole("article", { name: `账号 ${rows.find(row => row.id === id)!.label}`, exact: true });
  const stable = () => page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const neutralCapture = async () => {
    await page.mouse.move(0, 0); await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); }); await stable();
  };
  // Element screenshots cannot capture content clipped by the settings scrollport.
  // Keep real viewport screenshots and geometry; supplementary full-card captures
  // retain width/font scale but explicitly increase height, then restore it.
  const captureCard = async (id: string, filename: string) => {
    const viewport = page.viewportSize()!;
    await page.locator(".settings-main").evaluate(node => { node.scrollTop = 0; }); await stable();
    const box = (await card(id).boundingBox())!, captureHeight = Math.max(viewport.height, Math.ceil(box.y + box.height + 100));
    await page.setViewportSize({ width: viewport.width, height: captureHeight }); await neutralCapture();
    const visible = await card(id).evaluate(node => { const r = node.getBoundingClientRect(), m = document.querySelector(".settings-main")!.getBoundingClientRect(); return r.top >= m.top && r.bottom <= m.bottom; });
    assert.ok(visible, "supplementary full-card image is inside its scrollport, not clipped to black");
    await card(id).screenshot({ path: join(output, filename), animations: "disabled" });
    await page.setViewportSize(viewport); await stable(); return { width: viewport.width, height: captureHeight };
  };
  await page.clock.install();
  await page.goto(server.resolvedUrls!.local[0] + "model-accounts-design-check"); await card("direct").getByText("额度暂不可用", { exact: true }).waitFor();
  assert.equal(await page.locator(".model-account-card").count(), 1);
  assert.equal(await page.getByRole("searchbox").count(), 0, "single-account page does not expose an empty management toolbar");
  assert.equal(await page.getByRole("combobox", { name: "筛选供应商" }).count(), 0);
  assert.equal(await card("direct").getByRole("status", { name: "当前账号", exact: true }).count(), 1);
  assert.equal(await card("direct").getByRole("button", { name: "当前账号", exact: true }).count(), 0, "current selection is not duplicated as a dead button");
  assert.ok(await card("direct").getByRole("button", { name: "重试刷新供应商额度" }).isEnabled(), "an upstream HTTP refusal remains retryable, not a local capability block");
  assert.equal(await card("direct").locator(".provider-usage-metric,progress,h4").count(), 0, "no quota report for a no-data response");
  const officialLink = card("direct").getByRole("link", { name: "打开官方用量页", exact: true });
  assert.equal(await officialLink.getAttribute("href"), "https://chatgpt.com/settings/usage");
  assert.equal(await officialLink.getAttribute("rel"), "noopener noreferrer");
  assert.equal(await card("direct").locator("details").count(), 0, "identity, explanation and amount are not hidden behind disclosures");
  assert.equal(await card("direct").getByText("本地授权未提供", { exact: true }).count(), 2, "missing email and plan remain honest, never invented");
  await card("direct").getByText("账号状态：状态未确认", { exact: true }).waitFor();
  assert.equal(await card("direct").getByText("费用估算", { exact: true }).count(), 0);
  assert.equal(commands.filter(command => ["usage.ledger", "usage.pricing"].includes(command.op)).length, 0, "unconfirmed status stops all sample/pricing queries");
  assert.equal(await card("direct").getByText(/^约 \$/).count(), 0, "HTTP failure cannot fabricate an amount");
  assert.equal(await card("direct").getByRole("status", { name: "当前账号", exact: true }).innerText(), "当前启用");
  await officialLink.focus();
  await page.screenshot({ path: join(output, "keyboard-link-focus.png"), animations: "disabled" });
  const directReads = commands.filter(command => command.op === "accounts.usage").length;
  // Advance in heartbeat-sized steps so each synthetic ping can receive its
  // real WS receipt; one giant jump would manufacture a transport disconnect.
  for (let step = 0; step < 22; step++) {
    await page.clock.fastForward(6000); await sleep(30);
    assert.ok(await page.getByRole("button", { name: "添加账号", exact: true }).isEnabled(), "polling is tested while connected, not after a clock-induced disconnect");
  }
  assert.equal(commands.filter(command => command.op === "accounts.usage").length, directReads, "unconfirmed status stops automatic polling while connected");
  await card("direct").getByRole("button", { name: "重试刷新供应商额度" }).click();
  await until(() => commands.filter(command => command.op === "accounts.usage").length === directReads + 1);
  await page.clock.resume();
  for (const [width, height, scale] of [[1440, 1000, 100], [390, 844, 100], [320, 640, 100], [320, 640, 200]]) {
    await page.setViewportSize({ width, height }); await page.evaluate(scale => (window as any).setScale(scale), scale);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.querySelector(".settings-main")!.scrollTop = 0; }, theme); await stable();
      await neutralCapture();
      const box = (await card("direct").boundingBox())!;
      if (width === 1440) assert.ok(await card("direct").locator(".account-profile").isVisible(), "direct identity fields precede the quota limitation, not just a portal");
      assert.ok(await card("direct").evaluate(node => node.scrollWidth <= node.clientWidth + 1));
      await page.screenshot({ path: join(output, `single-direct-${width}-${theme}-${scale}.png`), animations: "disabled" });
      const captureViewport = await captureCard("direct", `single-direct-card-${width}-${theme}-${scale}.png`);
      scenes.push({ scenario: "single-direct", width, height, scale, theme, box, captureViewport });
      if (width === 320 && scale === 200) {
        const explanation = card("direct").getByText("账号状态检查返回 HTTP 403，无法确认状态；已停止后续查询。", { exact: true });
        await explanation.scrollIntoViewIfNeeded();
        assert.ok(await explanation.evaluate(node => { const r=node.getBoundingClientRect(),m=document.querySelector(".settings-main")!.getBoundingClientRect();return r.top>=m.top-1&&r.bottom<=m.bottom+1; }), "full amount explanation can be reached directly in the actual 320×640 viewport");
        await page.screenshot({ path: join(output, `single-direct-scrolled-${theme}-200.png`), animations: "disabled" });
        await captureCard("direct", `single-direct-information-${theme}-200.png`);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => (window as any).setScale(100));
  await card("direct").getByText("账号状态检查返回 HTTP 403，无法确认状态；已停止后续查询。", { exact: true }).waitFor();
  Object.assign(rows.find(row => row.id === "direct")!, { email: "saved-direct@example.test", emailSource: "token", plan: "plus", accountId: "direct-public-account", expiresAt: deadline });
  await page.reload();
  for (const text of ["saved-direct@example.test", "plus", "direct-public-account", "令牌有效期"]) await card("direct").getByText(text, { exact: true }).waitFor();
  assert.equal(await card("direct").locator("details").count(), 0, "available saved identity is visible even when quota cannot be queried");
  await card("direct").getByText("邮箱来自授权令牌，未独立验证，仅作账号区分。", { exact: true }).waitFor();
  assert.match(await card("direct").locator(".account-card-identity").getAttribute("title") ?? "", /授权信息邮箱.*授权令牌/);
  await neutralCapture(); await page.screenshot({ path: join(output, "single-direct-with-identity.png"), animations: "disabled" });
  await captureCard("direct", "single-direct-with-identity-card.png");
  await card("direct").getByRole("button", { name: "查看账号详情" }).click();
  const directDetails = page.getByRole("dialog", { name: "账号详情：原有账号", exact: true });
  await directDetails.getByText("来自授权令牌，仅作账号区分", { exact: false }).waitFor();
  await directDetails.getByRole("button", { name: "关闭", exact: true }).click();
  scenario = "failed"; failUsage.add("official"); holdUsage = true; await page.reload(); await until(() => pendingUsage.length > 0);
  await card("official").getByText("正在检查账号状态…", { exact: true }).waitFor();
  assert.equal(await card("official").locator(".provider-usage-metric,progress,h4").count(), 0);
  holdUsage = false; pendingUsage.splice(0).forEach(reply => reply());
  await card("official").getByText("账号状态无法确认，已停止后续查询；请重试。", { exact: true }).waitFor();
  assert.equal(await card("official").locator(".provider-usage-metric,progress,h4").count(), 0, "a first RPC failure does not become zero or unsupported");
  const retry = card("official").getByRole("button", { name: /刷新供应商额度$/ }); assert.ok(await retry.isEnabled());
  await page.screenshot({ path: join(output, "first-query-failure.png"), animations: "disabled" });
  failUsage.clear(); await retry.click(); await card("official").getByText("111.5000", { exact: true }).waitFor();
  failUsage.add("official"); await retry.click(); await card("official").getByText("账号状态无法确认，已停止后续查询；请重试。", { exact: true }).waitFor();
  assert.equal(await card("official").locator(".provider-usage-metric,.provider-quota-estimate").count(), 0, "an unconfirmed refresh cannot revive old numbers or estimates");
  await page.screenshot({ path: join(output, "cached-query-failure.png"), animations: "disabled" });
  failUsage.clear(); await retry.click(); await card("official").getByText("111.5000", { exact: true }).waitFor();
  await neutralCapture(); await page.screenshot({ path: join(output, "recovered-ready.png"), animations: "disabled" });
  await captureCard("official", "recovered-ready-card.png");
  statusMode = "disabled";
  const samplesBeforeBlocked = commands.filter(command => ["usage.ledger", "usage.pricing"].includes(command.op)).length;
  await page.reload(); await card("official").getByText("账号状态：账号或工作区异常", { exact: true }).waitFor();
  assert.equal(await card("official").locator(".provider-usage-metric,.provider-quota-estimate").count(), 0);
  assert.equal(commands.filter(command => ["usage.ledger", "usage.pricing"].includes(command.op)).length, samplesBeforeBlocked, "disabled accounts do not start billing samples or pricing reads");
  const blockedReads = commands.filter(command => command.op === "accounts.usage").length;
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
  for (let step = 0; step < 15; step++) { await page.clock.fastForward(6000); await sleep(30); }
  assert.equal(commands.filter(command => command.op === "accounts.usage").length, blockedReads, "explicit abnormal state stops automatic follow-up polling");
  await page.clock.resume(); statusMode = "active";
  await card("official").getByRole("button", { name: "重试刷新供应商额度" }).click();
  await card("official").getByText("111.5000", { exact: true }).waitFor();
  await card("official").getByText("账号状态：检查通过", { exact: true }).waitFor();
  statusMode = "missing";
  const samplesBeforeMissing = commands.filter(command => ["usage.ledger", "usage.pricing"].includes(command.op)).length;
  await page.reload(); await card("official").getByText("账号状态：状态未确认", { exact: true }).waitFor();
  assert.equal(await card("official").locator(".provider-usage-metric,.provider-quota-estimate").count(), 0, "legacy ready DTOs without a status cannot expose quotas or trigger token pricing");
  assert.equal(commands.filter(command => ["usage.ledger", "usage.pricing"].includes(command.op)).length, samplesBeforeMissing);
  const missingReads = commands.filter(command => command.op === "accounts.usage").length;
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
  for (let step = 0; step < 15; step++) { await page.clock.fastForward(6000); await sleep(30); }
  assert.equal(commands.filter(command => command.op === "accounts.usage").length, missingReads, "missing status also stops automatic polling");
  await page.clock.resume(); statusMode = "active";
  await card("official").getByRole("button", { name: "重试刷新供应商额度" }).click();
  await card("official").getByText("111.5000", { exact: true }).waitFor();
  scenario = "mixed"; await page.reload(); await card("official").waitFor();
  assert.equal(await page.locator(".model-account-card").count(), 7);
  for (const row of rows.filter(row => row.id !== "single")) {
    await card(row.id).scrollIntoViewIfNeeded(); await until(() => commands.some(command => command.op === "accounts.usage" && command.params?.accountId === row.id));
    if (row.id === "direct") await card(row.id).getByText("额度暂不可用", { exact: true }).waitFor();
    else if (row.type === "api_key") await card(row.id).getByText("暂不支持查询额度", { exact: true }).waitFor();
    else await card(row.id).getByText(row.id === "unknown" ? "有点数，余额未知" : row.id === "zero" ? "0.0000" : "111.5000", { exact: true }).waitFor();
  }
  assert.ok(!commands.some(command => command.op === "accounts.usage" && command.params?.accountId === "single"));
  assert.equal(await card("official").locator(".account-card-identity").innerText(), "official@upstream.example.test", "one primary identity, live email preferred");
  assert.ok(await card("official").getByText("authorization@example.test", { exact: true }).isVisible());
  await card("official").getByText("官方查询邮箱与授权邮箱不同。授权邮箱：", { exact: false }).waitFor();
  assert.match(await card("official").locator(".account-identity-source").innerText(), /来自授权令牌，未独立验证/);
  assert.ok(await page.locator(".model-account-card").evaluateAll(cards => cards.every(card => card.querySelectorAll("details").length <= 1 && [...card.querySelectorAll("details")].every(detail => detail.classList.contains("provider-usage-expiries")))), "only the optional coupon expiry list may collapse");
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 640 }); await page.evaluate(() => (window as any).setScale(200));
    const identity = card("unknown").locator(".account-card-identity"), plan = card("unknown").locator(".provider-usage-account dd");
    await identity.getByText(`${long}@upstream.example.test`, { exact: true }).waitFor();
    await plan.getByText(`Enterprise · ${long}`, { exact: true }).waitFor();
    for (const field of [identity, plan, card("unknown").locator(".account-card-heading h3"), card("unknown").locator(".account-card-meta")]) assert.ok(await field.evaluate(node => getComputedStyle(node).whiteSpace !== "nowrap" && node.scrollWidth <= node.clientWidth + 1), "all long fields wrap directly, without an expansion step");
    if (width === 320) {
      const lastField = plan;
      await lastField.evaluate(node => node.scrollIntoView({ block: "end" }));
      assert.ok(await lastField.evaluate(node => { const text=node.firstChild!,range=document.createRange(); range.setStart(text,text.textContent!.length-1); range.setEnd(text,text.textContent!.length); const r=range.getBoundingClientRect(),m=document.querySelector(".settings-main")!.getBoundingClientRect();return r.top>=m.top-1&&r.bottom<=m.bottom+1; }), "last character of the full live plan is scroll-reachable in the actual viewport");
      await page.screenshot({ path: join(output, "identity-source-scrolled-320-200.png"), animations: "disabled" });
      await captureCard("unknown", "long-identity-expanded-320-200.png");
      for (const field of [card("zero").locator(".account-card-identity"), card("zero").locator(".provider-usage-account dd")]) {
        assert.ok(await field.evaluate(node => { const box=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);return node.textContent!.length<=60&&getComputedStyle(node).whiteSpace!=="nowrap"&&[...range.getClientRects()].every(r=>r.left>=box.left-1&&r.right<=box.right+1); }), "shorter than 61 characters is not a license to ellipsize without an expansion path");
      }
    }
  }
  await page.evaluate(() => (window as any).setScale(100));
  assert.equal(await card("official").getByRole("progressbar", { name: "5小时 剩余额度", exact: true }).getAttribute("value"), "62.5");
  assert.equal(await card("unknown").getByRole("progressbar").count(), 0);
  assert.deepEqual(await card("official").locator(".provider-usage-metric").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-metric-kind"))), ["balance", "count", "window", "window", "window"], "DOM reading order matches the visual summary-first account layout");
  assert.equal(await card("zero").getByRole("progressbar", { name: "5小时 剩余额度", exact: true }).getAttribute("value"), "0");
  assert.equal(await card("official").getByText("费用估算", { exact: true }).count(), 1);
  await card("official").getByText(/尚未按账号拆分；多账号混用/).waitFor();
  const estimatedWindows = card("official").locator(".provider-quota-window");
  assert.equal(await estimatedWindows.count(), 2, "Spark and point balances are not mixed into the two quota-window estimates");
  await estimatedWindows.nth(0).getByText("约 $40.0000", { exact: true }).waitFor();
  await estimatedWindows.nth(0).getByText("约 $25.0000", { exact: true }).waitFor();
  await estimatedWindows.nth(1).getByText("约 $16.6667", { exact: true }).waitFor();
  await estimatedWindows.nth(1).getByText("约 $1.6667", { exact: true }).waitFor();
  await estimatedWindows.nth(0).getByText("样本 4 条 · $15.0000 · 已用 37.5%", { exact: true }).waitFor();
  assert.equal(await card("unknown").getByText(/^约 \$/).count(), 0, "unknown and stale usage cannot be extrapolated");
  await card("zero").getByText("约 $0.0000", { exact: true }).first().waitFor();
  assert.ok(commands.some(command => command.op === "usage.ledger"), "estimates use actual read-only sample queries");
  await card("official").locator(".provider-usage-expiries").evaluate(node => { (node as HTMLDetailsElement).open = true; });
  assert.deepEqual(await card("official").locator(".provider-usage-expiries time").evaluateAll(nodes => nodes.map(node => node.getAttribute("datetime"))), expiries.map(at => new Date(at).toISOString()));

  for (const [width, height] of [[1440, 1000], [768, 900], [680, 800], [600, 800], [390, 844], [320, 640], [390, 480]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const scale of [75, 100, 150, 200]) {
        await page.evaluate(scale => { (window as any).setScale(scale); document.querySelector(".settings-main")!.scrollTop = 0; }, scale); await stable();
        await neutralCapture();
        const measurement = await page.evaluate(() => {
          const workspace = document.querySelector(".model-accounts-workspace")!, main = document.querySelector(".settings-main")!;
          const containers = [...workspace.querySelectorAll<HTMLElement>(".accounts-page-heading,.accounts-filters,.accounts-search,.account-group-heading,.model-account-card,.provider-usage,.provider-account-status,.provider-usage-account,.provider-usage-metric,.provider-usage-metric>strong,.provider-usage-expiries,.provider-quota-estimate,.provider-quota-window,.provider-quota-note")];
          const overflow = containers.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({ class: node.className, width: node.clientWidth, scroll: node.scrollWidth, text: node.innerText.slice(0, 120) }));
          const cards = [...workspace.querySelectorAll<HTMLElement>(".model-account-card")].map(card => {
            const r = card.getBoundingClientRect(), buttons = [...card.querySelectorAll<HTMLElement>("button")].map(button => { const b = button.getBoundingClientRect(); return { label: button.getAttribute("aria-label"), x: b.x-r.x, y: b.y-r.y, width: b.width, height: b.height }; });
            const outside = buttons.some(b => b.x < 0 || b.x+b.width > r.width+1 || b.y < 0 || b.y+b.height > r.height+1);
            const overlap = buttons.some((a, i) => buttons.slice(i+1).some(b => Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1));
            return { label: card.getAttribute("aria-label"), presentation: card.dataset.presentation, width: r.width, height: r.height, buttons, outside, overlap };
          });
          const targets = [...workspace.querySelectorAll<HTMLElement>(".accounts-page-actions button,.accounts-filters input,.accounts-filters button,.model-account-card button,.model-account-card a,.model-account-card summary")].map(node => { const b=node.getBoundingClientRect(); return { label: node.getAttribute("aria-label") || node.textContent, width:b.width,height:b.height, input:node.tagName==="INPUT" }; });
          const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
          // Anonymous array entries avoid tsx keepNames helpers leaking into Playwright's serialized callback.
          const [rgba,blend,luminance]:[(color:string)=>number[],(f:number[],b:number[])=>number[],(c:number[])=>number]=[
            (color:string)=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);},
            (f:number[],b:number[])=>[...f.slice(0,3).map((v,i)=>v*f[3]+b[i]*(1-f[3])),1],
            (c:number[])=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0),
          ];
          const contrast:(unknown[]) = [], text=document.createTreeWalker(workspace,NodeFilter.SHOW_TEXT);
          while(text.nextNode()) { const node=text.currentNode,parent=node.parentElement;if(!parent||!node.textContent?.trim()||parent.closest("svg,:disabled"))continue;
            const range=document.createRange();range.selectNodeContents(node);if(!range.getBoundingClientRect().height)continue;
            const style=getComputedStyle(parent);let bg=[0,0,0,1];const ancestry:Element[]=[];for(let e:Element|null=parent;e;e=e.parentElement)ancestry.unshift(e);
            for(const e of ancestry)bg=blend(rgba(getComputedStyle(e).backgroundColor),bg);
            const fg=blend(rgba(style.color),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
            const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.67&&parseInt(style.fontWeight)>=700),minimum=large?3:4.5;
            if(ratio+.01<minimum)contrast.push({text:node.textContent.trim().slice(0,70),class:parent.className,ratio,minimum,color:style.color});
          }
          const search=workspace.querySelector(".accounts-search")!.getBoundingClientRect(),select=workspace.querySelector(".accounts-filters .select-trigger")!.getBoundingClientRect();
          return { filtersSameRow:Math.abs(search.top+search.height/2-select.top-select.height/2)<1, viewport:innerWidth, documentWidth:document.documentElement.scrollWidth,mainWidth:main.clientWidth, mainScroll:main.scrollWidth, actionRows:new Set([...workspace.querySelectorAll(".accounts-page-actions button")].map(node=>{const box=node.getBoundingClientRect();return Math.round(box.top+box.height/2);})).size,overflow,cards,targets,contrast };
        });
        geometry.push({ width,height,theme,scale,...measurement });
        assert.ok(measurement.documentWidth<=width+1 && measurement.mainScroll<=measurement.mainWidth+1, `workspace fits ${width} ${theme} ${scale}`);
        assert.deepEqual(measurement.overflow,[],`unclipped content at ${width} ${theme} ${scale}`);
        assert.ok(measurement.cards.every(card=>!card.outside&&!card.overlap),`card controls at ${width} ${theme} ${scale}`);
        assert.ok(measurement.targets.every(target=>target.height>=(touch||width<=600?43.9:23.9) && (target.input||target.width>=(touch||width<=600?43.9:23.9))),`pointer targets at ${width} ${theme} ${scale}, touch=${touch}`);
        assert.deepEqual(measurement.contrast,[],`text contrast at ${width} ${theme} ${scale}`);
        if(width===320&&scale===200)assert.equal(measurement.actionRows,1,"narrow enlarged toolbar keeps refresh and add together rather than stranding an icon");
        if(width===1440&&scale===100){ assert.ok(measurement.filtersSameRow, "desktop search and supplier filter share one compact row"); const generic=measurement.cards.find(card=>card.label==="账号 备用接口账号")!; const areaRatio=generic.width*generic.height/(396*417);
          assert.ok(areaRatio>=.20&&areaRatio<=.35,`ordinary card density retained: ${areaRatio}`);
          assert.ok(measurement.cards.find(card=>card.label==="账号 OpenAI API Key")!.height<measurement.cards.find(card=>card.label==="账号 工作账号")!.height/2,"mixed generic card does not stretch to subscription height"); }
        if((scale===100&&[1440,390,320].includes(width))||(scale===200&&width===320))await page.screenshot({path:join(output,`${width}x${height}-${theme}-${scale}.png`),animations:"disabled"});
      }
    }
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=> (window as any).setScale(100));await stable();
  const providerSelect=page.getByRole("combobox",{name:"筛选供应商"});
  await providerSelect.click(); await page.getByRole("option",{name:"本地接口",exact:true}).click();
  assert.equal(await page.locator(".model-account-card").count(),2,"supplier select filters the full qualified set");
  await providerSelect.click(); await page.getByRole("option",{name:"全部供应商",exact:true}).click();
  assert.equal(await page.locator(".model-account-card").count(),7);
  const apiWidth=(await card("api").boundingBox())!.width;
  await page.getByRole("searchbox",{name:"搜索账号"}).fill("OpenAI API Key");await card("api").waitFor();
  await page.getByRole("region", { name: "OpenAI 账号", exact: true }).locator(".account-group-selection").getByText("当前启用：工作账号", { exact: true }).waitFor();
  assert.equal(await page.locator(".model-account-card").count(),1);assert.ok(Math.abs((await card("api").boundingBox())!.width-apiWidth)<1,"search keeps mixed-provider card width");
  await page.getByRole("searchbox",{name:"搜索账号"}).fill("does-not-match-fixture");await page.getByRole("heading",{name:"没有匹配的账号",exact:true}).waitFor();
  await page.getByRole("button",{name:"清除筛选",exact:true}).click();assert.equal(await page.locator(".model-account-card").count(),7);
  await card("zero").getByRole("button",{name:"启用此账号",exact:true}).click();
  const confirmation=page.getByRole("dialog",{name:"切换账号",exact:true}), confirm=confirmation.getByRole("button",{name:"确认切换",exact:true});
  const activationCount=commands.filter(command=>command.op==="accounts.activate").length;
  failNextList=true;await page.evaluate(()=>(window as any).bump());
  await confirmation.getByText("账号状态尚未确认。请关闭此对话框并刷新列表后重试。",{exact:true}).waitFor();
  assert.ok(await confirm.isDisabled(),"an already-open confirmation cannot bypass an unconfirmed account list");
  await confirm.evaluate(node=>(node as HTMLButtonElement).click());
  assert.equal(commands.filter(command=>command.op==="accounts.activate").length,activationCount,"unconfirmed dialog sends no activation request");
  await confirmation.getByRole("button",{name:"取消",exact:true}).click();
  await page.getByRole("button",{name:"刷新列表",exact:true}).click();
  await card("zero").getByRole("button",{name:"启用此账号",exact:true}).click();
  await page.getByRole("dialog",{name:"切换账号",exact:true}).getByRole("button",{name:"确认切换",exact:true}).click();
  await page.getByText("切换请求已提交，当前账号尚未确认。请刷新列表后查看。",{exact:true}).waitFor();
  await card("official").getByText("上次选择",{exact:true}).waitFor();
  assert.equal(await page.getByRole("status",{name:"当前账号",exact:true}).count(),0,"a failed authoritative reread cannot confirm the old active account");
  assert.ok(await page.getByRole("button",{name:"启用此账号",exact:true}).evaluateAll(nodes=>nodes.every(node=>(node as HTMLButtonElement).disabled)));
  await page.getByRole("button",{name:"刷新列表",exact:true}).click();await card("zero").getByRole("status",{name:"当前账号",exact:true}).waitFor();
  assert.equal(await card("zero").getByRole("status", { name: "当前账号", exact: true }).innerText(), "当前启用");
  assert.equal(await card("official").getByRole("status", { name: "当前账号", exact: true }).count(), 0);
  assert.equal(await card("direct").getByRole("status", { name: "当前账号", exact: true }).count(), 1, "switching one provider does not change another provider's selection");
  assert.equal(await page.getByText("切换请求已提交，当前账号尚未确认。请刷新列表后查看。",{exact:true}).count(),0,"a successful reread clears the pending confirmation warning");
  for(const [width,height,scale] of [[1440,1000,100],[320,480,200]]){
    await page.setViewportSize({width,height});await page.evaluate(scale=>(window as any).setScale(scale),scale);await stable();
    const button=card("unknown").getByRole("button",{name:"查看账号详情"});
    await page.getByRole("button",{name:"刷新列表",exact:true}).focus();
    let tabSteps=0;while(!await button.evaluate(node=>document.activeElement===node)&&tabSteps++<70)await page.keyboard.press("Tab");
    assert.ok(tabSteps<=70,"account details are reachable by the natural Tab order from the page toolbar");
    const focus=await button.evaluate(node=>({visible:node.matches(":focus-visible"),style:getComputedStyle(node).outlineStyle,width:parseFloat(getComputedStyle(node).outlineWidth)}));assert.ok(focus.visible&&focus.style!=="none"&&focus.width>=1);
    await page.keyboard.press("Enter");const dialog=page.getByRole("dialog",{name:`账号详情：${rows[1].label}`,exact:true});await dialog.waitFor();
    const box=(await dialog.boundingBox())!;assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=height+1,"long-identity dialog remains in viewport");
    assert.ok(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),"dialog text wraps rather than clipping");
    await dialog.getByText(`${long}@upstream.example.test`,{exact:true}).waitFor();
    assert.equal(await dialog.getByText("来自授权令牌，仅作账号区分",{exact:false}).count(),0,"live official identity is not relabeled as a token-only fallback");
    await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});assert.ok(await button.evaluate(node=>document.activeElement===node));
  }
  disconnectFixture = true; closeConnections.splice(0).forEach(close => close());
  await page.getByText("连接已断开，账号列表及额度可能不是最新状态；恢复连接后重新读取。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("status", { name: "当前账号", exact: true }).count(), 0, "disconnection cannot claim a confirmed enabled account");
  await card("zero").getByRole("status", { name: "上次选择账号", exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "启用此账号", exact: true }).evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled)));
  // Keep this component mounted: reconnection alone must not confirm its old list.
  holdList = true; activeId = "official"; disconnectFixture = false;
  await until(() => pendingList.length > 0);
  assert.equal(await page.getByRole("status", { name: "当前账号", exact: true }).count(), 0, "fresh connection generation needs a fresh authoritative list");
  await card("zero").getByRole("status", { name: "上次选择账号", exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "启用此账号", exact: true }).evaluateAll(nodes => nodes.every(node => (node as HTMLButtonElement).disabled)));
  const writesBeforeReconnect = commands.filter(command => command.op === "accounts.activate").length;
  await card("official").getByRole("button", { name: "启用此账号", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  assert.equal(commands.filter(command => command.op === "accounts.activate").length, writesBeforeReconnect);
  holdList = false; pendingList.splice(0).forEach(reply => reply());
  await card("official").getByRole("status", { name: "当前账号", exact: true }).waitFor();
  assert.equal(await card("zero").getByRole("status", { name: "当前账号", exact: true }).count(), 0);
  assert.ok(await card("zero").getByRole("button", { name: "启用此账号", exact: true }).isEnabled());
  empty=true;await page.evaluate(()=>(window as any).bump());await page.getByRole("heading",{name:"暂无需要展示的账号",exact:true}).waitFor();
  assert.equal(await page.locator(".model-account-card").count(),0);assert.equal(await page.getByRole("link",{name:"前往模型服务",exact:true}).getAttribute("href"),"/model-config.html");
  failNextList=true;await page.reload();await page.getByRole("alert").getByText("离线测试：列表暂不可用",{exact:true}).waitFor();
  await page.locator(".accounts-result-count").getByText("读取失败",{exact:true}).waitFor();
  await page.getByRole("button",{name:"刷新列表",exact:true}).click();await page.getByRole("heading",{name:"暂无需要展示的账号",exact:true}).waitFor();
  assert.deepEqual(unexpected,[]);assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
  writeFileSync(join(output,"evidence.json"),JSON.stringify({touch,scenes,geometry,commands,errors,unexpected,network},null,2));
  console.log(`PASS account page: 56 viewport/theme/scale cases plus 8 single-direct scenes and actual loading/first-failure/cached-failure recovery; touch=${touch}; normal/mixed/long/zero/unknown/stale data; density, contrast, targets, natural Tab/dialog, search/empty, failed selection confirmation recovery and complete expiries. Evidence: ${output}`);
} catch(error){
  writeFileSync(join(output,"failure.json"),JSON.stringify({error:String(error),touch,geometry,commands,errors,unexpected,network},null,2));
  await browser.contexts().flatMap(context=>context.pages())[0]?.screenshot({path:join(output,"failure.png"),animations:"disabled",timeout:3000}).catch(()=>{});
  console.error(`Fixture evidence: ${output}`,error);throw error;
}
finally{await browser.close();await server.close();rmSync(temporary,{recursive:true,force:true});}
