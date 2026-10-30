import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { type UsageRecordFilter, type UsageSessionDirectory } from "../src/shared/model-usage.js";
import { openAIProviderId as usageProviderId } from "../src/shared/model-providers.js";
import { usageRefreshMinimum, type ProviderUsage } from "../src/shared/provider-usage.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";
import { emptyCostTotals } from "../src/shared/costs.js";

// All ledger data and OAuth/quota responses are local fixtures. Never call a paid model or real OAuth.
const root = mkdtempSync(join(tmpdir(), "axiom-usage-ui-")), previous = process.env.AXIOM_PI_DIR;
const artifacts = mkdtempSync(join(tmpdir(), "axiom-dashboard-layout-")); console.log("UI_ARTIFACTS", artifacts);
process.env.AXIOM_PI_DIR = join(root, "primary-pi"); mkdirSync(process.env.AXIOM_PI_DIR);
const authPath = join(process.env.AXIOM_PI_DIR, "auth.json"), configPath = join(process.env.AXIOM_PI_DIR, "models.json"), data = join(root, "data");
const copiedModelId = "axiom-copy-fixture-readable-name", longProvider = "自定义接口-" + "长供应商名称".repeat(25), longModel = "统计模型-" + "long-model-name-".repeat(20);
const oauth = { type: "oauth", access: "PRIVATE_PRIMARY_ACCESS", refresh: "PRIVATE_PRIMARY_REFRESH", expires: Date.now() + 3600000 };
writeFileSync(authPath, JSON.stringify({ [usageProviderId]: oauth, fixture: { type: "api_key", key: "PRIVATE_PRIMARY_KEY" } }));
writeFileSync(configPath, JSON.stringify({ providers: {
  [usageProviderId]: { name: "OpenAI 模型账号", models: [{ id: "pricing-model", name: "估值模型", cost: { input: 2, output: 10, cacheRead: .2, cacheWrite: 3 } }] },
  fixture: { name: longProvider, api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: copiedModelId, name: longModel, axiomRequestModelId: "fixture-upstream" }] },
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`extra-${i}`, { name: `兼容接口 ${i}`, api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [] }])),
} }));
const independent = join(data, "model-usage", "pi"); mkdirSync(independent, { recursive: true });
const independentAuth = join(independent, "auth.json");
const saveIndependent = () => writeFileSync(independentAuth, JSON.stringify({ [usageProviderId]: { ...oauth, access: "PRIVATE_USAGE_ACCESS", refresh: "PRIVATE_USAGE_REFRESH" } }));
saveIndependent();
const retiredAuth = readFileSync(independentAuth, "utf8");
const originalAuth = readFileSync(authPath, "utf8"), originalConfig = readFileSync(configPath, "utf8");
const app = await startServer({ root: data, port: 0, dev: true, usageSidecar: { pollMs: 50, cooldownMs: 0, pauseMs: 0, initialDelayMs: 0 } });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
async function viewportScreenshot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: join(artifacts, name), animations: "disabled" });
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width + 1, `page overflows: ${JSON.stringify(size)}`);
  const issues = await page.locator(".usage-record-table").evaluateAll(tables => tables.flatMap(table => {
    const rows = [...table.querySelectorAll("tr")], heads = [...rows[0].children].map(cell => cell.getBoundingClientRect());
    return rows.slice(1).flatMap(row => [...row.children].flatMap((cell, i) => {
      const bounds = cell.getBoundingClientRect();
      return Math.abs(bounds.left - heads[i].left) > 1 || Math.abs(bounds.right - heads[i].right) > 1 ? [`misaligned column ${i}`] : [];
    }));
  }));
  assert.deepEqual(issues, []);
}
try {
  let mode = "ready", queries = 0, statisticsReads = 0, statsMode = "normal";
  const refreshFlags: boolean[] = [], sharedQueries: string[] = [];
  let release: (() => void) | undefined, ledgerRelease: (() => void) | undefined, remainingBuilds = 0, continuedReads = 0, latestLedgerFilter: UsageRecordFilter | undefined;
  app.agents.models.usage = async (provider, refresh = false): Promise<ProviderUsage> => {
    sharedQueries.push(String(provider)); assert.equal(provider, usageProviderId);
    queries++; refreshFlags.push(refresh);
    if (mode === "slow") await new Promise<void>(resolve => { release = resolve; });
    if (mode === "fail") throw Error("PRIVATE_UPSTREAM_TEXT");
    if (mode === "denied") return { providerId: usageProviderId, status: "unavailable", metrics: [], message: "额度接口拒绝访问（HTTP 403），请检查授权权限或代理访问限制。" };
    if (mode === "limited" || mode === "unsafe") return { providerId: usageProviderId, status: "unavailable", metrics: [], refreshable: false, message: "模拟受限授权：请在官方用量页查看。", management: { label: "打开官方用量页", url: mode === "unsafe" ? "javascript:alert('forbidden')" : "https://chatgpt.com/settings/usage" } };
    if (mode === "tokens") return { providerId: usageProviderId, status: "ready", accountStatus: { state: "active", checkedAt: Date.now() }, updatedAt: Date.now(), metrics: [{ id: "absolute", label: "绝对 Token 额度", kind: "tokens", model: "pricing-model", used: 100, remaining: 1_000_000, part: "input" }] };
    return { providerId: usageProviderId, status: "ready", accountStatus: { state: "active", checkedAt: Date.now() }, updatedAt: Date.now(), nextRefreshAt: Date.now() + usageRefreshMinimum + 300_000, metrics: [
      { id: "5h", kind: "window", label: "5小时已用", usedPercent: 37.5, resetsAt: Date.now() + 3600000 },
      { id: "points", kind: "balance", label: "剩余点数", balance: mode === "zero" ? null : "123.4500", unlimited: mode === "zero" },
      { id: "resets", kind: "count", label: "重置次数", count: mode === "zero" ? 0 : 3 },
    ] };
  };
  const originalLedger = app.usageLedger.read.bind(app.usageLedger);
  app.usageLedger.read = async params => {
    statisticsReads++; latestLedgerFilter = params as UsageRecordFilter; const scenario = statsMode;
    if (scenario === "fail") throw new AppError("FIXTURE_STATISTICS", "模拟统计读取失败");
    if (scenario === "slow") await new Promise<void>(resolve => { ledgerRelease = resolve; });
    const result = await originalLedger(params);
    if (scenario === "preparing") return { ...result, rows: [], count: 0, total: emptyCostTotals(), analytics: undefined, updatedAt: 0, building: true, partial: true, background: { state: "preparing", verifiedThrough: 0 } };
    if (scenario === "building") {
      const input = params as UsageRecordFilter;
      if (input.continue) { continuedReads++; remainingBuilds--; assert.equal(input.refresh, false); }
      if (remainingBuilds > 0) return { ...result, background: undefined, rows: [], count: 0, total: emptyCostTotals(), analytics: undefined, building: true, partial: true, processedRoots: 0, scannedRoots: 0, warnings: ["模拟分批核对：当前仅展示已验证来源。"] }; // Legacy DTO compatibility, without a background field.
    }
    if (scenario === "partial") return { ...result, partial: true, warnings: ["模拟扫描预算提示：部分记录未计入。"] };
    if (scenario === "price-only") { result.total.unknownCost = result.total.records; result.total.knownCost = 0; }
    if (scenario === "unknown") result.total.unknownTokens = 1;
    if (scenario === "unknown-all") { result.total.unknownTokens = result.total.records; for (const part of ["input", "output", "cacheRead", "cacheWrite"] as const) result.total.tokens[part] = 0; }
    if (scenario === "tiny-cost") result.total.knownCost = 1e-25;
    if (scenario === "cached") for (const total of [result.total, ...result.rows]) if (total.records) {
      const n = total.records; total.tokens = { input: 200 * n, output: 100 * n, cacheRead: 300 * n, cacheWrite: 500 * n }; total.unknownTokens = 0;
      total.knownCost = .01 * n; total.unknownCost = 0; total.unknownParts = 0; total.estimatedRecords = n; total.estimatedCost = .004 * n;
      total.estimateSources = ["https://example.invalid/fixture-price"]; total.parts = { input: .002 * n, output: .003 * n, cacheRead: .001 * n, cacheWrite: .004 * n };
    }
    if (scenario === "large") for (const total of [result.total, ...result.rows]) if (total.records) { total.tokens.input = 1.23456789e24; total.tokens.output = 2e24; total.tokens.cacheRead = 3e24; total.tokens.cacheWrite = 4e24; total.knownCost = 1.234567e28; }
    return result;
  };
  for (const [name, amount] of [["统计项目A", .25], ["统计项目B", .5], ["empty-project", 0]] as const) {
    const path = join(root, name); mkdirSync(path);
    const workspace = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path, authorized: true } }) as Workspace;
    if (!amount) { app.store.db.prepare("UPDATE workspaces SET name=? WHERE id=?").run("长项目名称".repeat(40), workspace.id); continue; }
    const session = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: {} }) as Session;
    const manager = SessionManager.create(path, join(root, "histories")); manager.appendMessage({ role: "user", content: "fixture", timestamp: 1 });
    for (let call = 0; call < 15; call++) manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture answer" }], api: "openai-completions", provider: "fixture", model: copiedModelId, stopReason: "stop", timestamp: Date.now() + call,
      usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: amount / 30, output: amount / 30, cacheRead: 0, cacheWrite: 0, total: amount / 15 } } });
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  const directoryCalls: Record<string, number> = {}, retiredCalls: string[] = [];
  page.on("websocket", socket => socket.on("framesent", event => { try { const call = JSON.parse(String(event.payload));
    if (["usage.providers", "usage.workspaces", "usage.sessions"].includes(call.op)) directoryCalls[call.op] = (directoryCalls[call.op] ?? 0) + 1;
    if (/^usage\.(auth|account)[.]/.test(call.op)) retiredCalls.push(call.op);
  } catch { /* Not an application command. */ } }));
  await page.addInitScript(`(() => { const original = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window), polls = new Map(); window.setTimeout = (handler, delay, ...args) => { let id; id = original(() => { polls.delete(id); if (typeof handler === 'function') handler(...args); }, delay); if (delay >= 1799000 && delay <= 2400000 && typeof handler === 'function') polls.set(id, () => { clear(id); polls.delete(id); handler(...args); }); return id; }; window.clearTimeout = id => { polls.delete(id); clear(id); }; window.usagePoll = () => [...polls.values()].forEach(poll => poll()); const Native = window.WebSocket, sockets = []; let hold = false; window.WebSocket = class extends Native { constructor(url, protocols) { if (hold) throw Error('fixture disconnected'); if (protocols === undefined) super(url); else super(url, protocols); if (new URL(url, location.href).pathname === '/ws') sockets.push(this); } }; window.dropUsage = () => { hold = true; sockets.forEach(socket => socket.close()); }; window.resumeUsage = () => { hold = false; window.dispatchEvent(new Event('online')); }; })();`);
  const choose = async (label: string, name: string) => { await page.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name, exact: true }).click(); };
  const tab = async (name: string) => { await page.getByRole("tab", { name, exact: true }).click(); };
  const apply = async () => { await page.getByRole("button", { name: "应用", exact: true }).click(); };
  const refreshLocal = async () => { await page.getByRole("button", { name: "刷新本机统计", exact: true }).click(); };
  const local = page.locator('section[aria-labelledby="local-usage-heading"]'), records = page.locator('section[aria-labelledby="usage-record-heading"]'), usage = page.getByLabel("供应商额度", { exact: true }), status = page.locator(".usage-local-status");
  const cost = () => local.locator(".usage-totals strong").nth(1);
  const official = async (name = "OpenAI 模型账号") => { await tab("官方额度"); await choose("供应商", name); };
  const clearOfficial = async () => { await choose("供应商", "请选择供应商"); };
  await page.goto(app.origin + "/model-config.html"); await page.locator(".supplier-option").filter({ hasText: "OpenAI 模型账号" }).click();
  assert.equal(await usage.count(), 0); assert.equal(queries, 0);
  await page.locator('.settings-sidebar a[href="/model-usage.html"]').click();
  await page.getByRole("button", { name: "加载本机统计", exact: true }).waitFor(); await page.waitForTimeout(100);
  assert.equal(statisticsReads, 0); assert.equal(queries, 0); assert.equal(await page.locator(".provider-requests").count(), 0);
  assert.deepEqual(await page.getByRole("tab").allTextContents(), ["用量概览", "调用明细", "请求监控", "官方额度"]);
  await page.waitForFunction(() => !(document.getElementById("usage-session") as HTMLButtonElement)?.disabled);
  assert.deepEqual(directoryCalls, { "usage.providers": 1, "usage.workspaces": 1, "usage.sessions": 1 }, "initial invalidation must not duplicate directory reads");
  assert.deepEqual(await page.locator(".usage-filter-grid label").allTextContents(), ["日期", "工作空间", "会话", "类型", "供应商"]);
  await page.getByRole("combobox", { name: "类型", exact: true }).click(); assert.deepEqual(await page.getByRole("option").allTextContents(), ["主代理", "子代理", "压缩"]); await page.keyboard.press("Escape");
  statsMode = "preparing"; await page.getByRole("button", { name: "加载本机统计", exact: true }).click();
  await status.getByText(/后台准备中/).waitFor(); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "—"); assert.equal(await cost().innerText(), "—");
  statsMode = "normal"; await cost().getByText("$0.7500", { exact: true }).waitFor();
  assert.equal(await local.locator(".usage-totals > div").count(), 4); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3.6K");
  assert.match(await local.locator(".usage-totals strong").first().getAttribute("title") ?? "", /3,600 Token/);
  assert.equal(latestLedgerFilter?.analytics, true); assert.ok(latestLedgerFilter?.timeZone); assert.equal(await page.locator(".usage-trend svg").count(), 1);
  await page.getByText("查看趋势数据", { exact: true }).click(); assert.match(await page.locator(".usage-chart-data tbody").innerText(), /30\s+3,600/);
  const beforeTabs = statisticsReads; await tab("调用明细"); await records.locator("tbody tr").first().waitFor(); assert.equal(await records.locator("tbody tr").count(), 20);
  await tab("用量概览"); assert.equal(statisticsReads, beforeTabs, "local tab switches reuse the snapshot without reads");
  await tab("调用明细"); await records.getByRole("button", { name: "下一页", exact: true }).click(); await records.getByText("第 2 / 2 页 · 共 30 条", { exact: true }).waitFor();
  assert.equal(await records.locator("tbody tr").count(), 10); await tab("用量概览"); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3.6K");
  await page.getByRole("button", { name: "费用", exact: true }).click(); await page.getByRole("heading", { name: "费用趋势", exact: true }).waitFor(); assert.match(await page.locator(".usage-ranking").first().innerText(), /\$0.7500/);
  const beforeDraft = statisticsReads; await choose("工作空间", "统计项目B"); await choose("供应商", longProvider); await page.waitForTimeout(80); assert.equal(statisticsReads, beforeDraft); assert.equal(await cost().innerText(), "$0.7500");
  await tab("调用明细"); assert.equal(await page.getByRole("combobox", { name: "工作空间", exact: true }).innerText(), "统计项目B"); await apply(); await records.getByText("第 1 / 1 页 · 共 15 条", { exact: true }).waitFor();
  await tab("用量概览"); await cost().getByText("$0.5000", { exact: true }).waitFor(); await page.getByRole("button", { name: "重置", exact: true }).click(); await cost().getByText("$0.7500", { exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "类型", exact: true }).innerText(), "请选择");

  console.log("FIELDS density, persistence, costs and precise tooltips");
  await tab("调用明细"); const fields = page.getByRole("dialog", { name: "设置显示字段", exact: true }), beforeFields = statisticsReads;
  const compactHeight = await records.locator("tbody tr").first().evaluate(row => row.getBoundingClientRect().height);
  await page.getByRole("button", { name: "显示字段", exact: true }).click(); assert.equal(await fields.getByRole("checkbox").count(), 24);
  await fields.getByRole("checkbox", { name: "调用来源", exact: true }).uncheck(); await fields.getByRole("checkbox", { name: "输入合计", exact: true }).check(); await fields.getByRole("radio", { name: "舒适", exact: true }).check();
  await records.locator('table[data-density="comfortable"]').waitFor(); assert.ok(await records.locator("tbody tr").first().evaluate(row => row.getBoundingClientRect().height) > compactHeight);
  await page.keyboard.press("Escape"); assert.equal(statisticsReads, beforeFields);
  await page.reload(); await cost().getByText("$0.7500", { exact: true }).waitFor(); assert.equal(statisticsReads, beforeFields + 1, "warm document entry revalidates the previous query once without refresh");
  assert.equal(latestLedgerFilter?.refresh, false);
  await tab("调用明细"); await page.getByRole("button", { name: "显示字段", exact: true }).click(); assert.equal(await fields.getByRole("checkbox", { name: "调用来源", exact: true }).isChecked(), false);
  assert.equal(await fields.getByRole("radio", { name: "舒适", exact: true }).isChecked(), true); await fields.getByRole("button", { name: "恢复默认", exact: true }).click(); await page.keyboard.press("Escape");
  await records.locator("tbody tr").first().waitFor();
  const peer = await context.newPage(); await peer.goto(app.origin + "/model-usage.html"); await peer.getByRole("button", { name: "加载本机统计", exact: true }).waitFor();
  const beforePeer = statisticsReads; await peer.evaluate(() => localStorage.setItem("axiom.usage.view.v1", JSON.stringify({ columns: ["time", "amount"], density: "comfortable" })));
  await records.locator('table[data-density="comfortable"]').waitFor(); assert.equal(await records.locator("thead th").count(), 2); await peer.close(); await page.bringToFront(); assert.equal(statisticsReads, beforePeer);
  await page.getByRole("button", { name: "显示字段", exact: true }).click(); await fields.getByRole("button", { name: "显示全部", exact: true }).click(); await page.keyboard.press("Escape");
  statsMode = "cached"; await refreshLocal(); await records.locator('tbody tr:first-child [data-column="cacheHit"]').getByText("30%", { exact: true }).waitFor();
  assert.equal(await records.locator('tbody tr:first-child [data-column="inputTotal"]').innerText(), "1K"); assert.equal(await records.locator('tbody tr:first-child [data-column="estimatedCost"]').innerText(), "$0.0040");
  assert.match(await records.locator('tbody tr:first-child [data-column="amount"] .usage-money').getAttribute("title") ?? "", /非实际扣款.*example.invalid/); await noOverflow(page); await page.screenshot({ path: join(artifacts, "1440-all-fields.png"), fullPage: true });
  await tab("用量概览"); assert.equal(await local.locator(".usage-totals strong").nth(2).innerText(), "30%"); assert.match(await local.locator(".usage-totals").innerText(), /含估算/);
  statsMode = "normal"; await refreshLocal(); await cost().getByText("$0.7500", { exact: true }).waitFor();
  statsMode = "fail"; await refreshLocal(); await status.getByText(/模拟统计读取失败.*保留上次结果/).waitFor(); assert.equal(await cost().innerText(), "$0.7500");
  statsMode = "partial"; await refreshLocal(); await status.getByText(/部分数据/).waitFor(); assert.equal(await local.getAttribute("data-partial"), "true");
  statsMode = "building"; remainingBuilds = 3; continuedReads = 0;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await tab("调用明细"); await refreshLocal(); await records.getByText("加载中…", { exact: true }).waitFor(); await page.waitForTimeout(250); assert.equal(continuedReads, 0);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await records.locator("tbody tr").first().waitFor(); assert.equal(continuedReads, 3); statsMode = "normal";
  await page.getByLabel("搜索记录", { exact: true }).fill("no-matching-call"); await apply(); await records.getByText("暂无记录", { exact: true }).waitFor();
  await page.getByLabel("搜索记录", { exact: true }).fill("统计模型-"); await apply(); await records.getByText("第 1 / 2 页 · 共 30 条", { exact: true }).waitFor();
  console.log("DATES keyboard, drafts, validation, boundaries and clear");
  const dates = page.getByRole("dialog", { name: "选择日期范围", exact: true }), beforeDates = statisticsReads;
  await page.getByRole("button", { name: "日期范围", exact: true }).click(); await dates.getByLabel("开始日期", { exact: true }).fill("2024-02-30"); await dates.getByRole("alert").getByText(/有效日期/).waitFor();
  assert.ok(await dates.getByRole("button", { name: "确定日期", exact: true }).isDisabled()); await dates.getByLabel("开始日期", { exact: true }).fill("2099-01-02"); await dates.getByLabel("结束日期", { exact: true }).fill("2099-01-01"); await dates.getByRole("alert").getByText(/不能晚于/).waitFor(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "日期范围", exact: true }).click(); const day = await dates.locator("button[data-day]:focus").getAttribute("data-day"); await page.keyboard.press("ArrowRight"); assert.ok((await dates.locator("button[data-day]:focus").getAttribute("data-day"))! > day!);
  await dates.getByRole("button", { name: "近7天", exact: true }).click(); assert.equal(statisticsReads, beforeDates);
  await dates.getByLabel("开始日期", { exact: true }).fill("2099-01-01"); await dates.getByLabel("结束日期", { exact: true }).fill(""); await dates.getByRole("button", { name: "确定日期", exact: true }).click(); await apply(); await records.getByText("暂无记录", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重置", exact: true }).click(); await records.locator("tbody tr").first().waitFor();
  statsMode = "slow"; await refreshLocal(); for (let i = 0; !ledgerRelease && i < 500; i++) await page.waitForTimeout(10); assert.ok(ledgerRelease);
  statsMode = "normal"; await choose("工作空间", "统计项目B"); await apply(); await records.getByText("第 1 / 1 页 · 共 15 条", { exact: true }).waitFor(); ledgerRelease(); ledgerRelease = undefined; await page.waitForTimeout(80); assert.match(await records.innerText(), /共 15 条/);
  await tab("用量概览"); await cost().getByText("$0.5000", { exact: true }).waitFor(); const historicalReads = statisticsReads;

  console.log("OFFICIAL main connection, read-only UI, cache and no secondary authentication");
  await official(); await usage.getByText("123.4500", { exact: true }).waitFor(); assert.equal(statisticsReads, historicalReads); assert.deepEqual(sharedQueries, [usageProviderId]);
  await tab("用量概览"); await cost().getByText("$0.5000", { exact: true }).waitFor(); await page.waitForTimeout(80);
  assert.equal(statisticsReads, historicalReads, "returning from official tab reuses historical results without another read");
  await tab("官方额度"); await usage.getByText("123.4500", { exact: true }).waitFor();
  assert.equal(await page.locator(".usage-filter-panel").count(), 0); assert.equal(await page.getByText("统计口径", { exact: true }).count(), 0); await page.screenshot({ path: join(artifacts, "official-1440.png"), fullPage: true });
  assert.equal(await page.locator(".usage-management").count(), 0);
  assert.equal(await page.getByRole("button", { name: /授权连接|退出用量授权|保存查询网络/ }).count(), 0);
  assert.equal(await page.getByRole("combobox", { name: /官方用量来源|用量查询网络/ }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "模型服务设置", exact: true }).getAttribute("href"), "/model-config.html");
  assert.equal(readFileSync(independentAuth, "utf8"), retiredAuth);
  await usage.getByText("123.4500", { exact: true }).waitFor(); const automatic = queries; await page.evaluate("window.usagePoll()"); for (let i = 0; queries === automatic && i < 500; i++) await page.waitForTimeout(10); assert.equal(queries, automatic + 1); assert.equal(refreshFlags.at(-1), false);
  await tab("用量概览"); const offTab = queries; await page.evaluate("window.usagePoll()"); await page.waitForTimeout(100); assert.equal(queries, offTab, "official polling stops on inactive tab"); await cost().getByText("$0.5000", { exact: true }).waitFor();
  await tab("官方额度"); await usage.getByText("123.4500", { exact: true }).waitFor();
  mode = "tokens"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText(/绝对 Token 额度 \$2\.0000/).waitFor();
  mode = "zero"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText("0 次", { exact: true }).waitFor(); await usage.getByText("无限", { exact: true }).waitFor(); assert.equal(refreshFlags.at(-1), true);
  mode = "fail"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText("旧数据", { exact: true }).waitFor(); assert.match(await usage.innerText(), /0 次/);
  await clearOfficial(); mode = "slow"; await choose("供应商", "OpenAI 模型账号"); for (let i = 0; !release && i < 500; i++) await page.waitForTimeout(10); assert.ok(release);
  await clearOfficial(); mode = "ready"; release(); release = undefined; await page.waitForTimeout(80); assert.equal(await usage.count(), 0);
  mode = "denied"; await choose("供应商", "OpenAI 模型账号"); await usage.getByText(/额度接口拒绝访问/).waitFor();
  mode = "limited"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); const link = usage.getByRole("link", { name: "打开官方用量页", exact: true }); await link.waitFor(); assert.equal(await link.getAttribute("href"), "https://chatgpt.com/settings/usage"); assert.equal(await link.getAttribute("rel"), "noopener noreferrer"); assert.ok(await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).isDisabled());
  await clearOfficial(); mode = "unsafe"; await choose("供应商", "OpenAI 模型账号"); await usage.getByText("模拟受限授权：请在官方用量页查看。", { exact: true }).waitFor(); assert.equal(await usage.getByRole("link").count(), 0);
  await clearOfficial(); mode = "ready"; await choose("供应商", "OpenAI 模型账号"); await usage.getByText("123.4500", { exact: true }).waitFor();
  assert.deepEqual(retiredCalls, []); assert.ok(sharedQueries.every(provider => provider === usageProviderId));

  console.log("QUALITY unknowns, tiny values, reconnect and responsive layout");
  await tab("用量概览"); await page.getByRole("button", { name: "重置", exact: true }).click(); await cost().getByText("$0.7500", { exact: true }).waitFor();
  statsMode = "price-only"; await refreshLocal(); await status.getByText(/未完整计价/) .waitFor(); assert.equal(await cost().innerText(), "—");
  statsMode = "unknown"; await refreshLocal(); await status.getByText(/Token 不完整/).waitFor(); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3.6K");
  statsMode = "tiny-cost"; await refreshLocal(); await cost().getByText("$1.000e-25", { exact: true }).waitFor(); assert.equal(Number((await cost().getAttribute("title"))!.replace(/ USD$/, "").replaceAll(",", "")), 1e-25);
  statsMode = "unknown-all"; await refreshLocal(); await local.locator(".usage-totals strong").first().getByText("—", { exact: true }).waitFor();
  statsMode = "large"; await refreshLocal(); await local.locator(".usage-totals strong").first().getByText(/e\+25/).waitFor(); const beforeReconnect = statisticsReads;
  await page.evaluate("window.dropUsage()"); await status.getByText(/连接已断开 · 数据未更新/).waitFor(); assert.ok(await page.getByRole("button", { name: "刷新本机统计", exact: true }).isDisabled()); assert.notEqual(await local.locator(".usage-totals strong").first().innerText(), "—");
  await page.evaluate("window.resumeUsage()"); for (let i = 0; statisticsReads === beforeReconnect && i < 500; i++) await page.waitForTimeout(10); assert.ok(statisticsReads > beforeReconnect);
  statsMode = "normal"; await refreshLocal(); await cost().getByText("$0.7500", { exact: true }).waitFor();
  await tab("调用明细"); await page.getByRole("button", { name: "显示字段", exact: true }).click(); await fields.getByRole("button", { name: "恢复默认", exact: true }).click(); await page.keyboard.press("Escape"); await tab("用量概览");
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow(page);
    const layout = await page.locator(".usage-filter-grid").evaluate(grid => { const b = [...grid.children].map(child => child.getBoundingClientRect()); return { width: (grid.closest(".model-usage-page") as HTMLElement).clientWidth - 2 * parseFloat(getComputedStyle(grid.closest(".model-usage-page")!).paddingLeft), x: b.map(v => v.x), y: b.map(v => v.y) }; });
    if (layout.width > 1060) assert.ok(layout.y.every(y => Math.abs(y - layout.y[0]) < 1), "wide filters stay on one row");
    else if (layout.width > 480) { assert.equal(layout.y[1], layout.y[2]); assert.equal(layout.y[3], layout.y[4]); assert.ok(layout.y[0] < layout.y[1] && layout.y[1] < layout.y[3]); }
    else assert.ok(layout.y.every((y, i) => i === 0 || y > layout.y[i - 1]), "narrow fields intentionally form one column");
    await viewportScreenshot(page, `${width}-overview.png`);
    await page.locator(".usage-trend").scrollIntoViewIfNeeded(); await viewportScreenshot(page, `${width}-charts.png`);
    await tab("调用明细"); await records.locator("tbody tr").first().waitFor(); await noOverflow(page); await viewportScreenshot(page, `${width}-records.png`);
    for (const [trigger, label] of [["日期范围", "选择日期范围"], ["显示字段", "设置显示字段"]]) {
      await page.getByRole("button", { name: trigger, exact: true }).click(); const popup = page.getByRole("dialog", { name: label, exact: true }); await popup.waitFor();
      const box = await popup.boundingBox(); assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= 901, `${label} bounded`); await page.keyboard.press("Escape"); assert.equal(await popup.count(), 0);
      assert.ok(await page.getByRole("button", { name: trigger, exact: true }).evaluate(button => button === document.activeElement));
    }
    for (const label of ["工作空间", "供应商", "会话", "类型"]) { await page.getByRole("combobox", { name: label, exact: true }).click(); const box = await page.getByRole("listbox", { name: label, exact: true }).boundingBox(); assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1); await page.keyboard.press("End"); await page.keyboard.press("Home"); await page.keyboard.press("Escape"); }
    await choose("供应商", longProvider); await apply(); await records.locator("tbody tr").first().waitFor(); await noOverflow(page);
    await official(); await usage.getByText("123.4500", { exact: true }).waitFor(); await noOverflow(page); await viewportScreenshot(page, `${width}-official.png`); await tab("用量概览");
  }
  await page.getByRole("tab", { name: "用量概览", exact: true }).focus(); await page.keyboard.press("ArrowRight"); assert.equal(await page.getByRole("tab", { name: "调用明细", exact: true }).getAttribute("aria-selected"), "true"); await page.keyboard.press("Home");

  console.log("SESSION FILTERS main-family ownership, compression, paging and metadata races");
  const filterPath = join(root, "agent-filter-project"); mkdirSync(filterPath);
  const fw = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: filterPath, authorized: true } }) as Workspace;
  const create = () => app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: fw.id, params: {} }) as Session;
  const main = create(), child = create(); app.store.db.prepare("UPDATE sessions SET title=? WHERE id=?").run("筛选主会话", main.id); app.store.db.prepare("UPDATE sessions SET title=? WHERE id=?").run("不应列入目录的子会话", child.id);
  app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)").run("ui-filter-task", fw.id, main.id, child.id, "anchor", "child", Date.now());
  const u = (input: number, cost: number) => ({ input, output: 20, cacheRead: 0, cacheWrite: 0, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
  for (const [s, n, input, expense] of [[main, 25, 100, .1], [child, 2, 200, .2]] as const) {
    const rows: unknown[] = Array.from({ length: n }, (_, i) => ({ type: "message", id: `${s.id}-${i}`, timestamp: Date.now() + i, message: { role: "assistant", provider: "fixture", model: copiedModelId, usage: u(input, expense), stopReason: "stop" } }));
    if (s.id === child.id) rows.push({ type: "message", id: "child-tool", timestamp: Date.now(), message: { role: "toolResult", toolName: "fixture-tool", usage: u(30, .03) } }, { type: "compaction", id: "child-compression", timestamp: Date.now(), usage: u(40, .04) });
    const file = join(root, `${s.id}.jsonl`); writeFileSync(file, [JSON.stringify({ type: "session", id: crypto.randomUUID(), version: 3, cwd: filterPath }), ...rows.map(row => JSON.stringify(row))].join("\n") + "\n"); app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(s.id, file);
  }
  app.store.db.prepare("INSERT INTO memory_usage(id,sessionId,kind,provider,model,usage,createdAt) VALUES(?,?,?,?,?,?,?)").run("child-memory", child.id, "title", "fixture", copiedModelId, JSON.stringify(u(50, .05)), Date.now());
  const originalSessions = app.usageLedger.sessions.bind(app.usageLedger); let sessionMode = "ready", sessionRelease: (() => void) | undefined;
  app.usageLedger.sessions = ((params: unknown) => { const value = originalSessions(params); if (sessionMode === "fail") throw new AppError("FIXTURE_SESSION", "模拟会话目录失败"); if (sessionMode === "slow") return new Promise<UsageSessionDirectory>(resolve => { sessionRelease = () => resolve(value); }); return value; }) as typeof app.usageLedger.sessions;
  await page.evaluate(() => sessionStorage.removeItem("axiom.usage.page.v1"));
  const beforeEntry = statisticsReads; await page.reload(); await page.getByRole("button", { name: "加载本机统计", exact: true }).waitFor(); await page.waitForTimeout(100); assert.equal(statisticsReads, beforeEntry);
  await choose("工作空间", "agent-filter-project"); await choose("会话", "筛选主会话"); await choose("类型", "子代理"); await page.waitForTimeout(80); assert.equal(statisticsReads, beforeEntry); await apply(); await cost().getByText("$0.5200", { exact: true }).waitFor();
  assert.equal(await local.locator(".usage-totals strong").first().innerText(), "620"); assert.equal(latestLedgerFilter?.rootSessionId, main.id); assert.equal(latestLedgerFilter?.requestType, "subagent"); assert.match(await page.locator(".usage-applied-scope").innerText(), /筛选主会话 · 子代理/);
  await tab("调用明细"); assert.equal(await records.locator("tbody tr").count(), 5); assert.match(await records.locator("tbody").innerText(), /fixture-tool/); assert.match(await records.locator("tbody").innerText(), /原生摘要/); assert.match(await records.locator("tbody").innerText(), /会话标题/);
  await choose("类型", "主代理"); await apply(); await records.getByText("第 1 / 2 页 · 共 25 条", { exact: true }).waitFor(); await records.getByRole("button", { name: "下一页", exact: true }).click(); await records.getByText("第 2 / 2 页 · 共 25 条", { exact: true }).waitFor(); await tab("用量概览"); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3K");
  await choose("类型", "压缩"); await apply(); await cost().getByText("$0.0400", { exact: true }).waitFor(); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "60"); await tab("调用明细"); assert.equal(await records.locator("tbody tr").count(), 1); assert.match(await records.locator("tbody").innerText(), /原生摘要/);
  sessionMode = "fail"; const beforeFailure = statisticsReads; await app.refreshConfiguration(); await page.getByRole("alert").getByText(/模拟会话目录失败/).waitFor(); assert.equal(statisticsReads, beforeFailure); assert.equal(await page.getByRole("combobox", { name: "会话", exact: true }).innerText(), "筛选主会话");
  sessionMode = "ready"; await page.getByRole("button", { name: "重读会话目录", exact: true }).click(); await page.getByRole("button", { name: "重读会话目录", exact: true }).waitFor({ state: "hidden" });
  sessionMode = "slow"; await choose("工作空间", "统计项目A"); for (let i = 0; !sessionRelease && i < 500; i++) await page.waitForTimeout(10); assert.ok(sessionRelease);
  sessionMode = "ready"; await choose("工作空间", "统计项目B"); await apply(); await records.getByText("暂无记录", { exact: true }).waitFor(); sessionRelease(); sessionRelease = undefined; await page.waitForTimeout(80);
  assert.equal(await page.getByRole("combobox", { name: "会话", exact: true }).innerText(), "全部会话"); assert.equal(latestLedgerFilter?.rootSessionId, undefined); assert.equal(latestLedgerFilter?.requestType, "compression");
  const expectedB = originalSessions().sessions.find(item => item.workspaceName === "统计项目B")!; await page.getByRole("combobox", { name: "会话", exact: true }).click(); assert.equal(await page.locator(`[role="option"][data-value="${expectedB.id}"]`).innerText(), expectedB.title); await page.keyboard.press("Escape");
  await noOverflow(page); await page.screenshot({ path: join(artifacts, "320-session-filters.png"), fullPage: true });
  assert.equal(readFileSync(authPath, "utf8"), originalAuth); assert.equal(readFileSync(configPath, "utf8"), originalConfig); assert.equal(await page.getByText(/PRIVATE_/).count(), 0); assert.deepEqual(errors, []);
  console.log("PASS tabbed usage dashboard: full-scope charts, five draft filters, type menu, shared snapshots, fields, dates, scan lifecycle, late responses, shared official quota with no independent login, five responsive widths; artifacts", artifacts);
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]; if (page) { const screenshot = join(artifacts, "failure.png"); await page.screenshot({ path: screenshot, fullPage: true }); console.error("failure screenshot:", screenshot); console.error("failure DOM:", (await page.locator("body").innerText()).slice(0, 16000)); } throw error;
} finally {
  await browser.close(); await app.close(); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true });
}
