import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { WebSocket } from "ws";
import { startServer } from "../src/server/index.js";
import { usageAuthScope, usageProviderId, type UsageRecordFilter, type UsageSessionDirectory } from "../src/shared/model-usage.js";
import type { AuthState } from "../src/shared/models.js";
import { usageRefreshMinimum, type ProviderUsage } from "../src/shared/provider-usage.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";
import { emptyCostTotals } from "../src/shared/costs.js";

const root = mkdtempSync(join(tmpdir(), "axiom-usage-ui-")), previous = process.env.AXIOM_PI_DIR;
const artifacts = mkdtempSync(join(tmpdir(), "axiom-dashboard-layout-")); console.log("UI_ARTIFACTS", artifacts);
process.env.AXIOM_PI_DIR = join(root, "primary-pi"); mkdirSync(process.env.AXIOM_PI_DIR);
const authPath = join(process.env.AXIOM_PI_DIR, "auth.json"), configPath = join(process.env.AXIOM_PI_DIR, "models.json"), data = join(root, "data");
const copiedModelId = "axiom-copy-fixture-readable-name";
const longProvider = "自定义接口-" + "长供应商名称".repeat(25), longModel = "统计模型-" + "long-model-name-".repeat(20), longProject = "长项目名称".repeat(40);
const oauth = { type: "oauth", access: "PRIVATE_PRIMARY_ACCESS", refresh: "PRIVATE_PRIMARY_REFRESH", expires: Date.now() + 3600000 };
writeFileSync(authPath, JSON.stringify({ openai: oauth, fixture: { type: "api_key", key: "PRIVATE_PRIMARY_KEY" } }));
writeFileSync(configPath, JSON.stringify({ providers: { openai: { name: "OpenAI 模型账号", headers: {}, models: [{ id: "pricing-model", name: "估值模型", cost: { input: 2, output: 10, cacheRead: .2, cacheWrite: 3 } }] }, fixture: { name: longProvider, api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: copiedModelId, name: longModel, axiomRequestModelId: "fixture-upstream" }] },
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`extra-${i}`, { name: `兼容接口 ${i} ${i === 5 ? "long-provider-".repeat(25) : ""}`, api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [] }])) } }));
const independent = join(data, "model-usage", "pi"); mkdirSync(independent, { recursive: true });
const independentAuth = join(independent, "auth.json");
const saveIndependent = (access: string) => writeFileSync(independentAuth, JSON.stringify({ [usageProviderId]: { ...oauth, access, refresh: "PRIVATE_USAGE_REFRESH" } }));
saveIndependent("PRIVATE_USAGE_ACCESS");
const originalAuth = readFileSync(authPath, "utf8"), originalConfig = readFileSync(configPath, "utf8");
const app = await startServer({ root: data, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    outliers: [...document.querySelectorAll<HTMLElement>("body *")].filter(element => element.getBoundingClientRect().right > innerWidth + 1 && !element.closest(".usage-table-region,.select-menu")).slice(0, 24).map(element => {
      const bounds = element.getBoundingClientRect(); return { tag: element.tagName, class: element.className, x: bounds.x, width: bounds.width, text: element.textContent?.slice(0, 60) };
    }) }));
  assert.ok(overflow.scrollWidth <= overflow.width + 1, `page must not overflow horizontally: ${JSON.stringify(overflow)}`);
  const issues = await page.locator(".usage-table").evaluateAll(tables => tables.flatMap(table => {
    const rows = [...table.querySelectorAll("tr")]; const headings = [...rows[0].children].map(cell => cell.getBoundingClientRect());
    return rows.slice(1).flatMap(row => [...row.children].flatMap((cell, i) => {
      const bounds = cell.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(cell);
      const text = range.getBoundingClientRect(), clipped = [...cell.children].filter(child => getComputedStyle(child).overflowX === "hidden");
      const invalidClip = clipped.some(child => { const box = child.getBoundingClientRect(); return box.left < bounds.left - 1 || box.right > bounds.right + 1; });
      return Math.abs(bounds.left - headings[i].left) > 1 || Math.abs(bounds.right - headings[i].right) > 1 || invalidClip || !clipped.length && text.width && (text.left < bounds.left - 1 || text.right > bounds.right + 1)
        ? [`misaligned/overflowing column ${i}: ${cell.textContent?.slice(0, 40)}`] : [];
    }));
  }));
  assert.deepEqual(issues, [], "table cells must align and contain their own content");
}
try {
  let mode = "ready", queries = 0, statisticsReads = 0, accountReads = 0, statsMode = "normal", opened = 0, cancelled = 0, seq = 0;
  const refreshFlags: boolean[] = [];
  const originalAccountState = app.usageAccounts.state.bind(app.usageAccounts); let accountStateFails = false;
  app.usageAccounts.state = async () => { accountReads++; if (accountStateFails) throw new AppError("FIXTURE_ACCOUNT_STATE", "模拟授权状态读取失败"); return originalAccountState(); };
  const sharedQueries: string[] = []; let release: (() => void) | undefined;
  const finishPending = () => { const finish = release; assert.ok(finish); release = undefined; finish(); };
  app.agents.models.usage = async provider => { sharedQueries.push(String(provider)); return { providerId: String(provider), status: "ready", updatedAt: Date.now(), metrics: [{ id: "shared", kind: "window", label: "模型认证窗口", usedPercent: 88 }] }; };
  app.usageAccounts.query = async (refresh = false): Promise<ProviderUsage> => {
    queries++; refreshFlags.push(refresh);
    if (mode === "slow") await new Promise<void>(resolve => { release = resolve; });
    if (mode === "fail") throw Error("PRIVATE_UPSTREAM_TEXT");
    if (mode === "denied") return { providerId: usageProviderId, status: "unavailable", metrics: [], message: "额度接口拒绝访问（HTTP 403），请检查授权权限或代理访问限制。" };
    if (mode === "limited" || mode === "unsafe") return { providerId: usageProviderId, status: "unavailable", metrics: [], refreshable: false,
      message: "模拟受限授权：请在官方用量页查看。", management: { label: "打开官方用量页", url: mode === "unsafe" ? "javascript:alert('forbidden')" : "https://chatgpt.com/settings/usage" } };
    if (mode === "tokens") return { providerId: usageProviderId, status: "ready", updatedAt: Date.now(), metrics: [{ id: "absolute", label: "绝对 Token 额度", kind: "tokens", model: "pricing-model", used: 100, remaining: 1_000_000, part: "input" }] };
    return { providerId: usageProviderId, status: "ready", updatedAt: Date.now(), nextRefreshAt: Date.now() + usageRefreshMinimum + 300_000, metrics: [
      { id: "5h", kind: "window", label: "5小时已用", usedPercent: 37.5, resetsAt: Date.now() + 3600000 },
      { id: "7d", kind: "window", label: "7天已用", usedPercent: 12 },
      { id: "points", kind: "balance", label: "剩余点数", balance: mode === "zero" ? null : "123.4500", unlimited: mode === "zero" },
      { id: "resets", kind: "count", label: "重置次数", count: mode === "zero" ? 0 : 3 },
    ] };
  };
  const originalStatistics = app.usageLedger.read.bind(app.usageLedger);
  let ledgerRelease: (() => void) | undefined, remainingBuilds = 0, continuedReads = 0, latestLedgerFilter: UsageRecordFilter | undefined;
  app.usageLedger.read = async params => {
    statisticsReads++; latestLedgerFilter = params as UsageRecordFilter; const scenario = statsMode;
    if (scenario === "fail") throw new AppError("FIXTURE_STATISTICS", "模拟统计读取失败");
    if (scenario === "slow") await new Promise<void>(resolve => { ledgerRelease = resolve; });
    const result = await originalStatistics(params);
    if (scenario === "building") {
      const input = params as { continue?: boolean; refresh?: boolean };
      if (input?.continue) { continuedReads++; remainingBuilds--; assert.equal(input.refresh, false, "continuations must not discard scan progress"); }
      if (remainingBuilds > 0) return { ...result, rows: [], count: 0, total: emptyCostTotals(), building: true, partial: true,
        processedRoots: 0, scannedRoots: 0, warnings: ["模拟分批核对：当前仅展示已验证来源。"] };
    }
    if (scenario === "partial") return { ...result, partial: true, warnings: ["模拟扫描预算提示：部分记录未计入。"] };
    if (scenario === "price-only") { result.total.unknownCost = result.total.records; result.total.knownCost = 0; }
    if (scenario === "unknown") result.total.unknownTokens = 1;
    if (scenario === "unknown-all") { result.total.unknownTokens = result.total.records; for (const part of ["input", "output", "cacheRead", "cacheWrite"] as const) result.total.tokens[part] = 0; }
    if (scenario === "small-cost") result.total.knownCost = 0.0000001;
    if (scenario === "tiny-cost") result.total.knownCost = 1e-25;
    if (scenario === "cached") for (const total of [result.total, ...result.rows]) if (total.records) {
      const n = total.records; total.tokens = { input: 200 * n, output: 100 * n, cacheRead: 300 * n, cacheWrite: 500 * n }; total.unknownTokens = 0;
      total.knownCost = .01 * n; total.unknownCost = 0; total.unknownParts = 0; total.estimatedRecords = n; total.estimatedCost = .004 * n;
      total.estimateSources = ["https://example.invalid/fixture-price"]; total.parts = { input: .002 * n, output: .003 * n, cacheRead: .001 * n, cacheWrite: .004 * n };
    }
    if (scenario === "large") for (const total of [result.total, ...result.rows]) if (total.records) {
      total.tokens.input = 1.23456789e24; total.tokens.output = 2e24; total.tokens.cacheRead = 3e24; total.tokens.cacheWrite = 4e24; total.knownCost = 1.234567e28;
      for (const part of ["input", "output", "cacheRead", "cacheWrite"] as const) total.parts[part] = 1.234e27;
    }
    return result;
  };
  for (const [name, amount] of [["统计项目A", .25], ["统计项目B", .5], ["empty-project", 0]] as const) {
    const path = join(root, name); mkdirSync(path);
    const workspace = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path, authorized: true } }) as Workspace;
    if (!amount) { app.store.db.prepare("UPDATE workspaces SET name=? WHERE id=?").run(longProject, workspace.id); continue; }
    const session = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: {} }) as Session;
    const manager = SessionManager.create(path, join(root, "histories")); manager.appendMessage({ role: "user", content: "fixture", timestamp: 1 });
    for (let call = 0; call < 15; call++) manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture answer" }], api: "openai-completions", provider: "fixture", model: copiedModelId, stopReason: "stop", timestamp: Date.now() + call,
      usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: amount / 30, output: amount / 30, cacheRead: 0, cacheWrite: 0, total: amount / 15 } } });
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  }
  let flow: { owner: object; id: ReturnType<typeof crypto.randomUUID>; promptId: string } | undefined;
  const emit = (owner: object, state: AuthState, scope = usageAuthScope) => (owner as WebSocket).send(JSON.stringify({ type: "snapshot", streamId: "usage-ui-fixture", seq: ++seq, scope, data: state }));
  app.usageAccounts.start = async (owner, provider, type, revision) => {
    assert.equal(provider, usageProviderId); assert.equal(type, "oauth"); assert.equal(revision, (await app.usageAccounts.state()).revision);
    flow = { owner, id: crypto.randomUUID(), promptId: crypto.randomUUID() };
    emit(owner, { id: flow.id, providerId: usageProviderId, status: "running", message: "模拟独立授权", url: "https://example.invalid/fixture-auth", prompt: { id: flow.promptId, type: "manual_code", message: "模拟回调地址" } });
    return { id: flow.id, status: "accepted" };
  };
  app.usageAccounts.logins.open = async (owner, id) => { assert.equal(owner, flow!.owner); assert.equal(id, flow!.id); opened++; return { opened: true }; };
  app.usageAccounts.logins.cancel = async () => { cancelled++; return { cancelled: true }; };
  app.usageAccounts.logins.answer = (owner, id, promptId, answer) => {
    assert.equal(owner, flow!.owner); assert.equal(id, flow!.id); assert.equal(promptId, flow!.promptId); assert.equal(answer, "fixture-code");
    saveIndependent("PRIVATE_USAGE_REAUTHORIZED"); emit(owner, { id, providerId: usageProviderId, status: "completed", message: "模拟授权完成" }); return { accepted: true };
  };
  app.usageAccounts.logout = async (revision, generation) => { const current = await app.usageAccounts.state(); assert.equal(revision, current.revision); assert.equal(generation, current.generation); rmSync(independentAuth); return app.usageAccounts.state(); };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors: string[] = [];
  let navigationCount = 0; page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigationCount++; });
  page.on("pageerror", error => { errors.push(error.message); console.error("fixture pageerror:", error.message); });
  const subscribedScopes: string[] = [];
  page.on("websocket", socket => socket.on("framesent", frame => { try { const value = JSON.parse(String(frame.payload)); if (value.op === "subscribe") subscribedScopes.push(value.params.scope); } catch { /* Non-command frame. */ } }));
  await page.addInitScript({ content: `(() => { const original = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window), polls = new Map(); window.setTimeout = (handler, delay, ...args) => { let id; id = original(() => { polls.delete(id); if (typeof handler === "function") handler(...args); }, delay); if (delay >= 1799000 && delay <= 2400000 && typeof handler === "function") polls.set(id, () => { clear(id); polls.delete(id); handler(...args); }); return id; }; window.clearTimeout = id => { polls.delete(id); clear(id); }; window.__testUsagePoll = () => [...polls.values()].forEach(poll => poll()); window.__testUsagePollCount = () => polls.size; const Native = window.WebSocket, sockets = []; let hold = false; window.WebSocket = class extends Native { constructor(url, protocols) { if (hold) throw Error('fixture disconnected'); if (protocols === undefined) super(url); else super(url, protocols); if (new URL(url, location.href).pathname === '/ws') sockets.push(this); this.addEventListener('message', event => { try { const value = JSON.parse(event.data); if (value.type === 'receipt' && value.error?.code === 'INVALID_SCOPE') window.__testDiagnosticSeen = true; } catch {} }); } }; window.__testDropConnection = () => { hold = true; sockets.forEach(socket => { if (socket.readyState < 2) socket.close(); }); }; window.__testResumeConnection = () => { hold = false; window.dispatchEvent(new Event('online')); }; })();` });
  await page.goto(app.origin + "/model-config.html"); await page.locator(".supplier-option").filter({ hasText: "OpenAI 模型账号" }).click();
  assert.equal(await page.getByLabel("供应商额度", { exact: true }).count(), 0); assert.equal(queries, 0); assert.equal(sharedQueries.length, 0);
  await page.getByRole("button", { name: "添加供应商", exact: true }).click(); await page.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click(); await page.getByRole("combobox", { name: "供应商", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: /Codex/ }).count(), 0); await page.keyboard.press("Escape"); await page.getByRole("button", { name: "取消添加", exact: true }).click();
  const navigation = page.locator('.settings-sidebar a[href="/model-usage.html"]'); await navigation.waitFor();
  assert.equal(await navigation.evaluate(element => element.parentElement === document.querySelector('.settings-sidebar a[href="/model-config.html"]')?.parentElement), true); subscribedScopes.length = 0; await navigation.click();
  const local = page.locator('section[aria-labelledby="local-usage-heading"]'), records = page.locator('section[aria-labelledby="usage-record-heading"]'), usage = page.getByLabel("供应商额度", { exact: true });
  const choose = async (label: string, name: string) => { await page.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name, exact: true }).click(); };
  // Keep the existing official-account scenarios below, selecting through the new provider dropdown.
  const tags = { getByRole: (_role: string, options: { name: string; exact?: boolean }) => ({ click: () => choose("模型供应商", options.name === "全部" ? "全部供应商" : options.name) }) };
  const loadOfficial = async () => { await page.locator(".usage-official").waitFor(); };
  const refreshLocal = async () => { await page.getByRole("button", { name: "刷新本机统计", exact: true }).click(); };
  const diagnostic = async (scope: string) => {
    await page.evaluate(async scope => {
      const modulePath = performance.getEntriesByType("resource").find(entry => /\/transport\.(?:js|ts)(?:\?|$)/.test(entry.name))?.name;
      if (!modulePath) throw Error("Loaded transport module not found in fixture resource entries");
      const transport = await import(modulePath);
      const state = window as unknown as { __testDiagnosticSeen: boolean; __stopDiagnostic?: () => void };
      state.__testDiagnosticSeen = false; state.__stopDiagnostic?.(); state.__stopDiagnostic = transport.subscribeScope(scope, () => {});
    }, scope);
    await page.waitForFunction(() => (window as unknown as { __testDiagnosticSeen: boolean }).__testDiagnosticSeen);
  };
  await page.getByRole("button", { name: "加载本机统计", exact: true }).waitFor();
  await page.waitForTimeout(80); assert.equal(statisticsReads, 0); assert.equal(accountReads, 0); assert.equal(queries, 0); assert.equal(sharedQueries.length, 0);
  assert.equal(await page.locator(".usage-provider-tags").count(), 0); assert.equal(await page.getByRole("button", { name: "全部", exact: true }).count(), 0);
  assert.equal(await page.getByRole("combobox", { name: "工作空间", exact: true }).innerText(), "全部工作空间");
  assert.equal(await page.getByRole("combobox", { name: "模型供应商", exact: true }).innerText(), "全部供应商");
  assert.ok(subscribedScopes.includes("usage:providers")); assert.equal(subscribedScopes.includes("configuration"), false);
  await page.getByRole("button", { name: "加载本机统计", exact: true }).click();
  await local.locator(".usage-totals strong").first().getByText("3.6K", { exact: true }).waitFor(); assert.equal(statisticsReads, 1);
  assert.equal(await local.locator(".usage-totals > div").count(), 5); assert.equal(await records.locator("tbody tr").count(), 20);
  assert.match(await local.locator(".usage-totals strong").first().getAttribute("title") ?? "", /3,600 Token/);
  assert.equal(await usage.count(), 0); assert.equal(queries, 0);
  console.log("FIELDS configurable columns, compact density, persistence and token-weighted cache ratio");
  const fields = page.getByRole("dialog", { name: "设置显示字段", exact: true });
  const compactHeight = await records.locator("tbody tr").first().evaluate(row => row.getBoundingClientRect().height), beforeFields = statisticsReads;
  assert.equal(await records.locator("thead th").count(), 11); assert.equal(await records.locator("table").getAttribute("data-density"), "compact");
  await page.getByRole("button", { name: "显示字段", exact: true }).click();
  assert.equal(await fields.getByRole("checkbox").count(), 24);
  await fields.getByRole("checkbox", { name: "调用来源", exact: true }).uncheck(); await fields.getByRole("checkbox", { name: "输入合计", exact: true }).check();
  assert.equal(await records.locator('thead [data-column="source"]').count(), 0); await records.locator('thead [data-column="inputTotal"]').waitFor();
  await fields.getByRole("radio", { name: "舒适", exact: true }).check(); await records.locator('table[data-density="comfortable"]').waitFor();
  assert.ok(await records.locator("tbody tr").first().evaluate(row => row.getBoundingClientRect().height) > compactHeight);
  await page.keyboard.press("Escape"); assert.equal(await fields.count(), 0);
  assert.equal(await page.getByRole("button", { name: "显示字段", exact: true }).evaluate(button => button === document.activeElement), true);
  assert.equal(statisticsReads, beforeFields, "column and density changes never reload accounting");
  await page.reload(); await page.getByRole("button", { name: "加载本机统计", exact: true }).waitFor();
  assert.equal(statisticsReads, beforeFields, "restoring display preferences does not opt into scanning");
  await page.getByRole("button", { name: "显示字段", exact: true }).click();
  assert.equal(await fields.getByRole("checkbox", { name: "调用来源", exact: true }).isChecked(), false); assert.equal(await fields.getByRole("checkbox", { name: "输入合计", exact: true }).isChecked(), true);
  assert.equal(await fields.getByRole("radio", { name: "舒适", exact: true }).isChecked(), true);
  await fields.getByRole("button", { name: "恢复默认", exact: true }).click(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "加载本机统计", exact: true }).click(); await records.locator("tbody tr").first().waitFor();
  const beforePeer = statisticsReads, storagePeer = await page.context().newPage(); await storagePeer.goto(app.origin + "/model-usage.html");
  await storagePeer.getByRole("button", { name: "加载本机统计", exact: true }).waitFor();
  await storagePeer.evaluate(() => localStorage.setItem("axiom.usage.view.v1", JSON.stringify({ columns: ["time", "amount"], density: "comfortable" })));
  await records.locator('table[data-density="comfortable"]').waitFor(); assert.equal(await records.locator("thead th").count(), 2);
  await storagePeer.close(); await page.bringToFront(); assert.equal(statisticsReads, beforePeer, "cross-tab preferences do not trigger a ledger read");
  await page.getByRole("button", { name: "显示字段", exact: true }).click(); await fields.getByRole("button", { name: "恢复默认", exact: true }).click(); await page.keyboard.press("Escape");
  statsMode = "cached"; await refreshLocal(); await records.locator('tbody tr:first-child [data-column="cacheHit"]').getByText("30%", { exact: true }).waitFor();
  assert.match(await local.locator(".usage-insights").innerText(), /30%/);
  await page.getByRole("button", { name: "显示字段", exact: true }).click(); await fields.getByRole("button", { name: "显示全部", exact: true }).click(); await page.keyboard.press("Escape");
  assert.equal(await records.locator("thead th").count(), 24);
  const cachedRow = records.locator("tbody tr").first();
  assert.equal(await cachedRow.locator('[data-column="inputTotal"]').innerText(), "1K");
  assert.equal(await cachedRow.locator('[data-column="inputCost"]').innerText(), "$0.0020");
  assert.equal(await cachedRow.locator('[data-column="estimatedCost"]').innerText(), "$0.0040");
  assert.match(await cachedRow.locator('[data-column="amount"] .usage-money').getAttribute("title") ?? "", /非实际扣款.*example.invalid/);
  await cachedRow.getByText("含估算", { exact: true }).waitFor(); await noOverflow(page); await page.screenshot({ path: join(artifacts, "1440-all-fields.png"), fullPage: true });
  await page.getByRole("button", { name: "显示字段", exact: true }).click(); await fields.getByRole("button", { name: "恢复默认", exact: true }).click(); await page.keyboard.press("Escape");
  statsMode = "normal"; await refreshLocal(); await local.locator(".usage-totals strong").first().getByText("3.6K", { exact: true }).waitFor();
  await records.getByRole("button", { name: "下一页", exact: true }).click(); await records.getByText("第 2 / 2 页 · 共 30 条", { exact: true }).waitFor();
  assert.equal(await records.locator("tbody tr").count(), 10); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3.6K");
  assert.ok(await records.getByRole("button", { name: "下一页", exact: true }).isDisabled());
  await records.getByRole("button", { name: "上一页", exact: true }).click(); await records.getByText("第 1 / 2 页 · 共 30 条", { exact: true }).waitFor();
  for (const [name, expense] of [["统计项目A", "$0.2500"], ["统计项目B", "$0.5000"]]) { await choose("工作空间", name); await local.getByText(expense, { exact: true }).waitFor(); assert.equal(await records.locator("tbody tr").count(), 15); assert.ok(await records.getByRole("button", { name: "下一页", exact: true }).isDisabled()); }
  statsMode = "fail"; await refreshLocal(); await records.getByText(/模拟统计读取失败.*保留上次结果/).waitFor();
  statsMode = "partial"; await refreshLocal(); await records.locator(".usage-warnings summary").click(); await records.getByText("模拟扫描预算提示：部分记录未计入。", { exact: true }).waitFor(); assert.equal(await local.getAttribute("data-partial"), "true");
  statsMode = "normal"; await choose("工作空间", "全部工作空间"); await local.getByText("$0.7500", { exact: true }).waitFor();
  statsMode = "building"; remainingBuilds = 3; continuedReads = 0;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const beforeBuilding = statisticsReads; await refreshLocal();
  await records.getByText(/正在分批核对调用记录，尚未发现/).waitFor();
  assert.equal(await records.locator("tbody tr").count(), 0); assert.ok(await records.getByRole("button", { name: "下一页", exact: true }).isDisabled());
  await page.waitForTimeout(250); assert.equal(continuedReads, 0, "hidden statistics do not continue scanning"); assert.equal(statisticsReads, beforeBuilding + 1);
  assert.doesNotMatch(await records.innerText(), /当前筛选没有已保留/);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await local.getByText("$0.7500", { exact: true }).waitFor(); assert.equal(continuedReads, 3);
  assert.equal(await records.locator("tbody tr").count(), 20); assert.equal(await local.getAttribute("data-partial"), null);
  statsMode = "normal";
  await page.getByLabel("搜索记录", { exact: true }).fill("no-matching-call"); await records.getByRole("button", { name: "筛选", exact: true }).click(); await records.getByText(/当前筛选没有已保留/).waitFor();
  await page.getByLabel("搜索记录", { exact: true }).fill("统计模型-"); await records.getByRole("button", { name: "筛选", exact: true }).click(); await records.getByText("第 1 / 2 页 · 共 30 条", { exact: true }).waitFor();
  console.log("DATES custom calendar, keyboard focus, validation, presets, open bounds and clear");
  const dates = page.getByRole("dialog", { name: "选择日期范围", exact: true }), beforeDates = statisticsReads;
  await page.getByRole("button", { name: "日期范围", exact: true }).click();
  await dates.getByLabel("开始日期", { exact: true }).fill("2024-02-30"); await dates.getByRole("alert").getByText(/有效日期/).waitFor();
  assert.equal(await dates.getByRole("button", { name: "确定日期", exact: true }).isDisabled(), true);
  await dates.getByLabel("开始日期", { exact: true }).fill("2099-01-02"); await dates.getByLabel("结束日期", { exact: true }).fill("2099-01-01"); await dates.getByRole("alert").getByText(/不能晚于/).waitFor();
  await page.keyboard.press("Escape"); assert.equal(await dates.count(), 0); assert.match(await page.getByRole("button", { name: "日期范围", exact: true }).innerText(), /全部日期/);
  assert.equal(await page.getByRole("button", { name: "日期范围", exact: true }).evaluate(button => button === document.activeElement), true);
  await page.getByRole("button", { name: "日期范围", exact: true }).click();
  const activeDay = await dates.locator('button[data-day]:focus').getAttribute("data-day"); assert.ok(activeDay);
  await page.keyboard.press("ArrowRight"); const nextDay = await dates.locator('button[data-day]:focus').getAttribute("data-day"); assert.ok(nextDay && nextDay > activeDay);
  await page.keyboard.press("Enter"); assert.equal(await dates.getByLabel("开始日期", { exact: true }).inputValue(), nextDay);
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter"); assert.ok(await dates.getByLabel("结束日期", { exact: true }).inputValue() > nextDay);
  await dates.getByRole("button", { name: "近7天", exact: true }).click(); assert.ok(await dates.getByLabel("开始日期", { exact: true }).inputValue());
  assert.equal(statisticsReads, beforeDates, "calendar drafts and shortcuts do not query before filter submission");
  await dates.getByLabel("开始日期", { exact: true }).fill("2099-01-01"); await dates.getByLabel("结束日期", { exact: true }).fill(""); await dates.getByRole("button", { name: "确定日期", exact: true }).click();
  await records.getByRole("button", { name: "筛选", exact: true }).click(); await records.getByText(/当前筛选没有已保留/).waitFor();
  await page.getByRole("button", { name: "日期范围", exact: true }).click(); await dates.getByRole("button", { name: "清空日期", exact: true }).click();
  await page.getByLabel("搜索记录", { exact: true }).fill(""); await records.getByRole("button", { name: "筛选", exact: true }).click(); await local.getByText("$0.7500", { exact: true }).waitFor();
  statsMode = "slow"; await refreshLocal(); for (let i = 0; !ledgerRelease && i < 500; i++) await page.waitForTimeout(10); assert.ok(ledgerRelease);
  statsMode = "normal"; await choose("工作空间", "统计项目B"); await local.getByText("$0.5000", { exact: true }).waitFor(); ledgerRelease(); ledgerRelease = undefined; await page.waitForTimeout(80); assert.equal(await local.getByText("$0.5000", { exact: true }).count(), 1);
  await choose("工作空间", "全部工作空间"); await choose("模型供应商", longProvider); await records.locator(`.usage-row-name[title*="${copiedModelId}"]`).first().waitFor();
  assert.equal(await records.locator(`.usage-row-name[title*="${copiedModelId}"]`).first().innerText(), longModel.slice(0, 160));
  assert.doesNotMatch(await records.locator(".usage-row-name").allInnerTexts().then(names => names.join("\n")), /axiom-copy-/);
  await diagnostic("fixture:unsupported");
  assert.ok(await page.getByRole("button", { name: "刷新本机统计", exact: true }).isEnabled(), "subscription diagnostic is not a disconnection");
  assert.doesNotMatch(await records.locator(".usage-status").innerText(), /连接已断开/);
  await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial(); await usage.getByText("123.4500", { exact: true }).waitFor(); assert.equal(sharedQueries.length, 0, "configured Codex uses independent credentials"); await page.screenshot({ path: join(artifacts, "official-1440.png"), fullPage: true });
  assert.equal(await page.getByRole("button", { name: "退出用量授权", exact: true }).isVisible(), false, "authenticated management is collapsed");
  const management = page.locator(".usage-management"); await management.locator("summary").click();
  await page.getByRole("combobox", { name: "官方用量来源", exact: true }).click(); await page.getByRole("option", { name: "模型服务认证", exact: true }).click(); await usage.getByText("已用 88%", { exact: true }).waitFor(); await usage.getByText("剩余 12%", { exact: true }).waitFor(); assert.deepEqual(sharedQueries, ["openai"]);
  await page.getByRole("combobox", { name: "官方用量来源", exact: true }).click(); await page.getByRole("option", { name: "Codex 独立授权", exact: true }).click(); await usage.getByText("123.4500", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "用量查询网络", exact: true }).click(); await page.getByRole("option", { name: "填写代理地址", exact: true }).click(); await page.getByLabel("HTTP / HTTPS 代理地址", { exact: true }).fill("http://127.0.0.1:18522");
  await page.getByRole("button", { name: "保存查询网络", exact: true }).click(); await page.getByRole("button", { name: "保存查询网络", exact: true }).waitFor({ state: "hidden" }); assert.match(readFileSync(join(independent, "models.json"), "utf8"), /18522/);
  await usage.getByText("123.4500", { exact: true }).waitFor(); await management.locator("summary").click();
  assert.equal(await page.getByRole("button", { name: /消耗|重置额度|使用重置/ }).count(), 0);
  const beforeAutomatic = queries; await page.evaluate(() => (window as unknown as { __testUsagePoll: () => void }).__testUsagePoll());
  for (let attempts = 0; queries === beforeAutomatic && attempts < 500; attempts++) await page.waitForTimeout(10);
  assert.equal(queries, beforeAutomatic + 1); assert.equal(refreshFlags.at(-1), false, "automatic reads never force past the cache deadline");
  await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).waitFor({ state: "visible" });
  const beforeHidden = queries;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); (window as unknown as { __testUsagePoll: () => void }).__testUsagePoll(); });
  await page.waitForTimeout(80); assert.equal(queries, beforeHidden, "hidden views do not poll");
  await tags.getByRole("button", { name: "全部", exact: true }).click(); await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial(); await usage.waitFor();
  await page.waitForTimeout(80); assert.equal(queries, beforeHidden, "effect reconstruction while hidden must not start an upstream read");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); const now = Date.now; Date.now = () => now() + 45 * 60_000; document.dispatchEvent(new Event("visibilitychange")); Date.now = now; delete (document as unknown as Record<string, unknown>).visibilityState; });
  for (let attempts = 0; queries === beforeHidden && attempts < 500; attempts++) await page.waitForTimeout(10);
  assert.equal(queries, beforeHidden + 1); assert.equal(refreshFlags.at(-1), false, "becoming visible catches up once with a normal cached read");
  await usage.getByText(/可用金额估计：暂不能估算/).waitFor();
  mode = "tokens"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText(/可用金额估计：绝对 Token 额度 \$2\.0000/).waitFor(); await usage.getByText("已用 100 Token", { exact: true }).waitFor();
  mode = "zero"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText("0 次", { exact: true }).waitFor(); await usage.getByText("无限", { exact: true }).waitFor(); assert.equal(refreshFlags.at(-1), true);
  mode = "fail"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText("旧数据", { exact: true }).waitFor(); assert.match(await usage.innerText(), /0 次/);
  // Keyed provider switches must discard an old response, even when it eventually resolves.
  await tags.getByRole("button", { name: "全部", exact: true }).click(); mode = "slow"; await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial();
  for (let attempts = 0; !release && attempts < 500; attempts++) await page.waitForTimeout(10); assert.ok(release);
  await tags.getByRole("button", { name: "全部", exact: true }).click(); mode = "ready"; release(); release = undefined; await page.waitForTimeout(80); assert.equal(await usage.count(), 0);
  mode = "fail"; await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial(); await usage.getByText("额度暂不可用，请稍后重试。", { exact: true }).waitFor(); assert.equal(await usage.getByText("旧数据", { exact: true }).count(), 0); assert.equal(refreshFlags.at(-1), false, "remount after a manual refresh is still a normal cached read");
  mode = "denied"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); await usage.getByText("额度接口拒绝访问（HTTP 403），请检查授权权限或代理访问限制。", { exact: true }).waitFor();
  mode = "limited"; await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).click(); const official = usage.getByRole("link", { name: "打开官方用量页", exact: true }); await official.waitFor();
  assert.equal(await official.getAttribute("href"), "https://chatgpt.com/settings/usage"); assert.equal(await official.getAttribute("rel"), "noopener noreferrer"); assert.ok(await usage.getByRole("button", { name: "刷新供应商额度", exact: true }).isDisabled());
  const beforePoll = queries; await page.evaluate(() => (window as unknown as { __testUsagePoll: () => void }).__testUsagePoll()); await page.waitForTimeout(80); assert.equal(queries, beforePoll);
  mode = "unsafe"; await tags.getByRole("button", { name: "全部", exact: true }).click(); await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial(); await usage.getByText("模拟受限授权：请在官方用量页查看。", { exact: true }).waitFor(); assert.equal(await usage.getByRole("link").count(), 0);
  mode = "slow"; await tags.getByRole("button", { name: "全部", exact: true }).click(); await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial();
  for (let attempts = 0; !release && attempts < 500; attempts++) await page.waitForTimeout(10); assert.ok(release);
  await management.locator("summary").click(); await page.getByRole("button", { name: "退出用量授权", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "退出用量授权", exact: true }).click(); await page.getByRole("button", { name: "授权连接", exact: true }).waitFor(); mode = "ready"; finishPending(); await page.waitForTimeout(80); assert.equal(await usage.count(), 0);
  await page.getByRole("button", { name: "授权连接", exact: true }).click(); await page.getByLabel("模拟回调地址", { exact: true }).waitFor(); emit(flow!.owner, { id: flow!.id, providerId: "openai", status: "completed", message: "其他认证不应完成用量登录" }, "authentication"); await page.waitForTimeout(50); assert.equal(await page.getByLabel("模拟回调地址", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "取消登录", exact: true }).click(); await page.getByRole("button", { name: "授权连接", exact: true }).waitFor(); assert.ok(cancelled > 0);
  await page.getByRole("button", { name: "授权连接", exact: true }).click(); await page.getByLabel("模拟回调地址", { exact: true }).waitFor();
  const disconnectedFlow = flow!.id, loginNavigations = navigationCount;
  await page.evaluate(() => (window as unknown as { __testDropConnection: () => void }).__testDropConnection());
  await records.getByText(/连接已断开；保留的统计/).waitFor(); await page.getByText("连接已断开；此登录流程不会自动重做，请关闭并重新读取认证状态。", { exact: true }).waitFor(); assert.equal(await page.getByLabel("模拟回调地址", { exact: true }).count(), 0);
  await page.evaluate(() => (window as unknown as { __testResumeConnection: () => void }).__testResumeConnection());
  await page.waitForFunction(() => !document.getElementById("usage-provider")?.hasAttribute("disabled"));
  assert.equal(navigationCount, loginNavigations); assert.equal(flow!.id, disconnectedFlow, "reconnect does not replay OAuth start"); assert.equal(await page.getByLabel("模拟回调地址", { exact: true }).count(), 0, "old OAuth generation remains non-interactive after reconnect");
  assert.equal(await page.getByRole("button", { name: "提交回填", exact: true }).count(), 0);
  await page.getByRole("button", { name: "取消登录", exact: true }).click(); await page.getByRole("button", { name: "授权连接", exact: true }).click(); await page.getByLabel("模拟回调地址", { exact: true }).waitFor(); await diagnostic("fixture:login-diagnostic");
  assert.ok(await page.getByLabel("模拟回调地址", { exact: true }).isEnabled(), "online subscription diagnostics do not invalidate OAuth");
  await page.getByLabel("模拟回调地址", { exact: true }).fill("fixture-code"); await page.getByRole("button", { name: "提交回填", exact: true }).click(); await usage.getByText("123.4500", { exact: true }).waitFor(); assert.ok(opened >= 2);
  await tags.getByRole("button", { name: "全部", exact: true }).click(); statsMode = "price-only"; await refreshLocal(); await local.getByText(/未完整计价/).waitFor(); assert.match(await local.locator(".usage-method strong").getAttribute("title") ?? "", /尚无可核对/); assert.equal(await local.locator(".usage-quality").count(), 0); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3.6K");
  statsMode = "unknown"; await refreshLocal(); await local.locator(".usage-quality").waitFor(); assert.doesNotMatch(await local.locator(".usage-totals").innerText(), /未知|\+/);
  statsMode = "small-cost"; await refreshLocal(); await local.locator(".usage-method strong").getByText("$1.000e-7", { exact: true }).waitFor();
  statsMode = "tiny-cost"; await refreshLocal(); await local.locator(".usage-method strong").getByText("$1.000e-25", { exact: true }).waitFor(); assert.equal(Number((await local.locator(".usage-method strong").getAttribute("title"))!.replace(/ USD$/, "").replaceAll(",", "")), 1e-25, "precise tooltip must not round tiny nonzero amounts to zero");
  statsMode = "unknown-all"; await refreshLocal(); await page.waitForFunction(() => [...document.querySelectorAll(".usage-totals strong")].every(element => element.textContent === "—")); assert.match(await local.locator(".usage-totals strong").first().getAttribute("title") ?? "", /尚无可核对/);
  statsMode = "large"; await refreshLocal(); await local.locator(".usage-totals strong").first().getByText(/e\+25/).waitFor();
  const beforeReconnect = statisticsReads, navigationsBeforeReconnect = navigationCount;
  await page.evaluate(() => (window as unknown as { __testDropConnection: () => void }).__testDropConnection());
  await records.getByText(/连接已断开；保留的统计/).waitFor(); assert.ok(await page.getByRole("button", { name: "刷新本机统计", exact: true }).isDisabled());
  assert.ok(await local.locator(".usage-totals strong").first().innerText() !== "—", "true disconnect keeps last confirmed data");
  await page.evaluate(() => (window as unknown as { __testResumeConnection: () => void }).__testResumeConnection());
  await page.getByRole("button", { name: "刷新本机统计", exact: true }).waitFor();
  for (let i = 0; statisticsReads === beforeReconnect && i < 500; i++) await page.waitForTimeout(10);
  assert.equal(navigationCount, navigationsBeforeReconnect, "Axiom disconnect fixture must not close Vite HMR or reload the page");
  assert.ok(statisticsReads > beforeReconnect); await local.locator(".usage-totals strong").first().getByText(/e\+25/).waitFor();
  assert.ok(await page.getByRole("button", { name: "刷新本机统计", exact: true }).isEnabled());
  const blockedShared = sharedQueries.length, blockedCodex = queries;
  accountStateFails = true; await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial(); await page.getByRole("alert").getByText("模拟授权状态读取失败", { exact: true }).waitFor();
  assert.equal(sharedQueries.length, blockedShared, "unknown automatic source never falls back to primary credentials"); assert.equal(queries, blockedCodex);
  await management.locator("summary").click(); await management.getByText("独立授权状态尚未确认。", { exact: false }).waitFor();
  await page.getByRole("combobox", { name: "官方用量来源", exact: true }).click(); await page.getByRole("option", { name: "模型服务认证", exact: true }).click(); await usage.getByText("已用 88%", { exact: true }).waitFor();
  assert.equal(sharedQueries.length, blockedShared + 1, "explicit primary source does not require readable independent credentials"); assert.equal(queries, blockedCodex);
  await page.getByRole("combobox", { name: "官方用量来源", exact: true }).click(); await page.getByRole("option", { name: "Codex 独立授权", exact: true }).click(); assert.equal(await usage.count(), 0, "independent source remains blocked while its status is unknown");
  accountStateFails = false; await page.getByRole("button", { name: "重新读取授权状态", exact: true }).click(); await usage.getByText("123.4500", { exact: true }).waitFor(); await tags.getByRole("button", { name: "全部", exact: true }).click();
  const originalDirectory = app.agents.models.usageProviders.bind(app.agents.models);
  app.agents.models.usageProviders = async () => (await originalDirectory()).map(provider => provider.id === "openai" ? { ...provider, name: "OpenAI（主认证不支持查询）", query: "unsupported" as const } : provider);
  await app.refreshConfiguration(); await choose("模型供应商", "OpenAI（主认证不支持查询）"); await usage.getByText("123.4500", { exact: true }).waitFor();
  assert.match(await page.locator(".usage-official").innerText(), /Codex 独立授权/, "an API-key-style primary connection must not hide a configured independent query account");
  app.agents.models.usageProviders = originalDirectory; await app.refreshConfiguration(); await page.getByRole("heading", { name: "OpenAI 模型账号 · 官方用量", exact: true }).waitFor(); await tags.getByRole("button", { name: "全部", exact: true }).click();
  await page.evaluate(`(() => { const events = []; window.__testUsageFocus = events; const record = type => { events.push({type,t:performance.now(),width:innerWidth,scrollY,focus:document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,popups:document.querySelectorAll('.usage-popup').length,anchorY:document.querySelector('[aria-label="日期范围"]')?.getBoundingClientRect().top,hasFocus:document.hasFocus()}); if(events.length>80)events.shift(); }; for(const type of ['focusin','focusout','keydown','scroll','resize','blur']) window.addEventListener(type,()=>record(type),true); new MutationObserver(()=>record('mutation')).observe(document.body,{subtree:true,childList:true}); })()`);
  for (const width of [1440, 1024, 768, 390, 320]) {
    console.log("LAYOUT viewport", width); await page.setViewportSize({ width, height: 900 }); await records.locator("tbody tr").first().waitFor(); await noOverflow(page); await page.screenshot({ path: join(artifacts, `${width}-all.png`), fullPage: true });
    for (let repeat = 0; repeat < (width === 320 ? 10 : 1); repeat++) for (const [trigger, label] of [["日期范围", "选择日期范围"], ["显示字段", "设置显示字段"]]) {
      await page.getByRole("button", { name: trigger, exact: true }).click(); const popup = page.getByRole("dialog", { name: label, exact: true }); await popup.waitFor();
      const box = await popup.boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 901, `${label} stays in viewport`);
      await noOverflow(page); if (repeat === 0 && (width === 320 || width === 1440)) {
        console.log("POPUP before capture", width, trigger, await popup.count());
        await page.screenshot({ path: join(artifacts, `${width}-${trigger === "日期范围" ? "calendar" : "fields"}.png`), fullPage: true });
        console.log("POPUP after capture", width, trigger, await popup.count());
      }
      assert.equal(await popup.count(), 1, `${label} stays open before Escape (repeat ${repeat})`);
      await page.keyboard.press("Escape"); assert.equal(await popup.count(), 0);
      const focus = await page.getByRole("button", { name: trigger, exact: true }).evaluate(button => ({ targetFocused: button === document.activeElement, windowFocused: document.hasFocus(), activeTag: document.activeElement?.tagName, activeLabel: document.activeElement?.getAttribute("aria-label"), visibility: document.visibilityState }));
      if (!focus.targetFocused) console.log("POPUP focus trace", width, trigger, repeat, await page.evaluate("window.__testUsageFocus"));
      assert.equal(focus.targetFocused, true, `${label} restores trigger focus: ${JSON.stringify(focus)}`);
    }
    for (const label of ["工作空间", "模型供应商", "会话", "代理类型"]) {
      const selector = page.getByRole("combobox", { name: label, exact: true }); await selector.scrollIntoViewIfNeeded(); await selector.click(); const popup = page.getByRole("listbox", { name: label, exact: true }); await popup.waitFor();
      const box = await popup.boundingBox(); assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= 901, `${label} popup stays in viewport`);
      await page.keyboard.press("End"); await page.keyboard.press("Home"); await page.keyboard.press("Escape"); assert.equal(await selector.getAttribute("aria-expanded"), "false");
    }
    await choose("模型供应商", longProvider); await records.locator("tbody tr").first().waitFor(); await noOverflow(page); await page.screenshot({ path: join(artifacts, `${width}-provider.png`), fullPage: true });
    await records.locator(".usage-table-region").evaluate(element => { element.scrollLeft = 500; }); await tags.getByRole("button", { name: "全部", exact: true }).click(); await records.locator("tbody tr").first().waitFor();
    assert.equal(await records.locator(".usage-table-region").evaluate(element => element.scrollLeft), 0, "switching provider resets horizontal scroll to record labels");
    await tags.getByRole("button", { name: "OpenAI 模型账号", exact: true }).click(); await loadOfficial(); await usage.getByText("123.4500", { exact: true }).waitFor(); await usage.getByText(/可用金额估计：暂不能估算/).waitFor(); await noOverflow(page); await page.screenshot({ path: join(artifacts, `${width}-official.png`), fullPage: true });
    await management.locator("summary").click(); await noOverflow(page); if (width === 320) await page.screenshot({ path: join(artifacts, "320-management.png"), fullPage: true }); await tags.getByRole("button", { name: "全部", exact: true }).click();
  }
  statsMode = "normal";
  for (const action of ["workspace", "provider", "search"] as const) {
    const reads: number = statisticsReads; await page.reload(); await page.getByRole("button", { name: "加载本机统计", exact: true }).waitFor();
    await page.waitForTimeout(80); assert.equal(statisticsReads, reads, "fresh entry remains lightweight");
    if (action === "workspace") await choose("工作空间", "统计项目B");
    else if (action === "provider") await choose("模型供应商", longProvider);
    else { await page.getByLabel("搜索记录", { exact: true }).fill("统计项目A"); await records.getByRole("button", { name: "筛选", exact: true }).click(); }
    await local.getByText(action === "workspace" ? "$0.5000" : action === "provider" ? "$0.7500" : "$0.2500", { exact: true }).waitFor();
    assert.equal(statisticsReads, reads + 1, "the user's explicit filter action starts statistics without a separate load click");
  }
  console.log("SESSION FILTERS main-family drafts, real subagent tool/compression/memory identity, totals, paging, scope reset, metadata errors and late responses");
  const filterPath = join(root, "agent-filter-project"); mkdirSync(filterPath);
  const filterWorkspace = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: filterPath, authorized: true } }) as Workspace;
  const filterMain = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: filterWorkspace.id, params: { title: "筛选主会话" } }) as Session;
  const filterChild = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: filterWorkspace.id, params: { title: "不应列入目录的子会话" } }) as Session;
  // session.create intentionally starts as 新对话; initialize fixture-only titles explicitly.
  const fixtureTitle = app.store.db.prepare("UPDATE sessions SET title=? WHERE id=?");
  fixtureTitle.run("筛选主会话", filterMain.id); fixtureTitle.run("不应列入目录的子会话", filterChild.id);
  app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed','{}',?)")
    .run("ui-filter-task", filterWorkspace.id, filterMain.id, filterChild.id, "anchor", "child", Date.now());
  const filterUsage = (input: number, cost: number) => ({ input, output: 20, cacheRead: 0, cacheWrite: 0, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
  for (const [s, n, input, cost] of [[filterMain, 25, 100, .1], [filterChild, 2, 200, .2]] as const) {
    const entries: unknown[] = Array.from({ length: n }, (_, i) => ({ type: "message", id: `${s.id}-${i}`, timestamp: Date.now() + i,
      message: { role: "assistant", provider: "fixture", model: copiedModelId, usage: filterUsage(input, cost), stopReason: "stop" } }));
    if (s.id === filterChild.id) entries.push({ type: "message", id: "child-tool", timestamp: Date.now(), message: { role: "toolResult", toolName: "fixture-tool", usage: filterUsage(30, .03) } },
      { type: "compaction", id: "child-compression", timestamp: Date.now(), usage: filterUsage(40, .04) });
    const file = join(root, `${s.id}.jsonl`);
    writeFileSync(file, [JSON.stringify({ type: "session", id: crypto.randomUUID(), version: 3, cwd: filterPath }), ...entries.map(row => JSON.stringify(row))].join("\n") + "\n");
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(s.id, file);
  }
  app.store.db.prepare("INSERT INTO memory_usage(id,sessionId,kind,provider,model,usage,createdAt) VALUES(?,?,?,?,?,?,?)")
    .run("child-ui-memory", filterChild.id, "title", "fixture", copiedModelId, JSON.stringify(filterUsage(50, .05)), Date.now());
  const originalSessions = app.usageLedger.sessions.bind(app.usageLedger);
  let sessionMode = "ready", sessionRelease: (() => void) | undefined;
  app.usageLedger.sessions = ((params: unknown) => {
    const value = originalSessions(params);
    if (sessionMode === "fail") throw new AppError("FIXTURE_SESSION_DIRECTORY", "模拟会话目录失败");
    if (sessionMode === "slow") return new Promise<UsageSessionDirectory>(resolve => { sessionRelease = () => resolve(value); });
    return value;
  }) as typeof app.usageLedger.sessions;
  const beforeSessionEntry = statisticsReads; await page.reload(); await page.getByRole("button", { name: "加载本机统计", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "会话", exact: true }).waitFor(); await page.waitForTimeout(80);
  assert.equal(statisticsReads, beforeSessionEntry, "session directory on entry must not scan usage");
  await choose("工作空间", "agent-filter-project"); await local.getByText("$3.0200", { exact: true }).waitFor();
  const beforeSessionDraft = statisticsReads;
  await page.getByRole("combobox", { name: "会话", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: /不应列入目录/ }).count(), 0);
  await page.getByRole("option", { name: /^筛选主会话/ }).click(); await choose("代理类型", "子代理");
  await page.waitForTimeout(80); assert.equal(statisticsReads, beforeSessionDraft, "session and agent drafts do not query");
  assert.match(await local.locator("header p").innerText(), /全部会话 · 全部代理/, "summary describes applied rather than draft filters");
  await records.getByRole("button", { name: "筛选", exact: true }).click(); await local.getByText("$0.5200", { exact: true }).waitFor();
  assert.equal(await records.locator("tbody tr").count(), 5); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "620");
  assert.match(await records.locator("tbody").innerText(), /fixture-tool/); assert.match(await records.locator("tbody").innerText(), /原生摘要/); assert.match(await records.locator("tbody").innerText(), /会话标题/);
  assert.equal(latestLedgerFilter?.rootSessionId, filterMain.id); assert.equal(latestLedgerFilter?.agentRole, "subagent");
  assert.match(await local.locator("header p").innerText(), /筛选主会话 · 子代理/);
  await choose("模型供应商", longProvider); await records.getByText("第 1 / 1 页 · 共 3 条", { exact: true }).waitFor();
  assert.equal(latestLedgerFilter?.rootSessionId, filterMain.id, "provider intersects without clearing the selected family");
  await choose("模型供应商", "全部供应商"); await local.getByText("$0.5200", { exact: true }).waitFor();
  await choose("代理类型", "主代理"); await records.getByRole("button", { name: "筛选", exact: true }).click(); await local.getByText("$2.5000", { exact: true }).waitFor();
  await records.getByRole("button", { name: "下一页", exact: true }).click(); await records.getByText("第 2 / 2 页 · 共 25 条", { exact: true }).waitFor();
  assert.equal(await records.locator("tbody tr").count(), 5); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "3K", "main-agent totals are not page-two subtotal");
  await choose("代理类型", "子代理"); await records.getByRole("button", { name: "筛选", exact: true }).click(); await records.getByText("第 1 / 1 页 · 共 5 条", { exact: true }).waitFor();
  const refreshedTitle = "筛选主会话 · 其他标签已改名";
  fixtureTitle.run(refreshedTitle, filterMain.id); await refreshLocal();
  await page.getByRole("combobox", { name: "会话", exact: true }).getByText(refreshedTitle, { exact: false }).waitFor();
  assert.match(await local.locator("header p").innerText(), /其他标签已改名/, "explicit statistics refresh also refreshes lightweight session metadata");
  sessionMode = "fail"; const beforeDirectoryFailure = statisticsReads; await app.refreshConfiguration();
  await page.getByRole("alert").getByText(/模拟会话目录失败/).waitFor();
  assert.match(await page.getByRole("combobox", { name: "会话", exact: true }).innerText(), /筛选主会话/);
  assert.equal(statisticsReads, beforeDirectoryFailure); assert.equal(await local.locator(".usage-totals strong").first().innerText(), "620");
  sessionMode = "ready"; await page.getByRole("button", { name: "重读会话目录", exact: true }).click(); await page.getByRole("button", { name: "重读会话目录", exact: true }).waitFor({ state: "hidden" });
  assert.match(await page.getByRole("combobox", { name: "会话", exact: true }).innerText(), /筛选主会话/);
  sessionMode = "slow"; await choose("工作空间", "统计项目A");
  for (let i = 0; !sessionRelease && i < 500; i++) await page.waitForTimeout(10); assert.ok(sessionRelease);
  sessionMode = "ready"; await choose("工作空间", "统计项目B"); await records.getByText(/当前筛选没有已保留/).waitFor();
  sessionRelease(); sessionRelease = undefined; await page.waitForTimeout(80);
  assert.equal(await page.getByRole("combobox", { name: "会话", exact: true }).innerText(), "全部会话");
  assert.equal(latestLedgerFilter?.rootSessionId, undefined); assert.equal(latestLedgerFilter?.agentRole, "subagent", "workspace switch clears family, preserving applied role");
  const expectedB = originalSessions().sessions.find(item => item.workspaceName === "统计项目B")!;
  const staleA = originalSessions().sessions.find(item => item.workspaceName === "统计项目A")!;
  await page.getByRole("combobox", { name: "会话", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: new RegExp(expectedB.id.slice(0, 8)) }).count(), 1, "late A directory cannot replace the current B directory");
  assert.equal(await page.getByRole("option", { name: new RegExp(staleA.id.slice(0, 8)) }).count(), 0); await page.keyboard.press("Escape");
  await noOverflow(page); await page.screenshot({ path: join(artifacts, "320-session-filters.png"), fullPage: true });
  assert.equal(readFileSync(authPath, "utf8"), originalAuth); assert.equal(readFileSync(configPath, "utf8"), originalConfig); assert.equal(await page.getByText(/PRIVATE_/).count(), 0); assert.deepEqual(errors, []);
  console.log("PASS dashboard: 24 configurable columns, compact/comfortable density, safe browser and native cross-tab persistence, cache read input-weighted ratios and labelled fee breakdowns, custom local-date range calendar with validation/keyboard/clear/presets and bounded five-viewports, explicit-filter load intent, visible-only bounded scan continuation, honest building-empty state, two dropdowns, lazy per-entry ledger, filtered all-record totals, paging/search/date/empty/late responses, readable exact model identity, compact used/remaining official usage and amount-estimate limits, selected-provider automatic query with lazy management, randomized-deadline automatic/manual distinction, shared vs independent routing, OAuth management/scope/cancel/logout, safe links and stale polling, five viewports including 320px with bounded tables and keyboard dropdowns; primary auth/config unchanged; no real OAuth/consume.");
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]; if (page) { const screenshot = join(tmpdir(), `axiom-dashboard-failure-${Date.now()}.png`); await page.screenshot({ path: screenshot, fullPage: true }); console.error("fixture failure screenshot:", screenshot); console.error("fixture failure DOM:", (await page.locator("body").innerText()).slice(0, 16000)); } throw error;
} finally {
  await browser.close(); await app.close(); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true });
}
