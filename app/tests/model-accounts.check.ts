import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import { ModelService } from "../src/server/model-service.js";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { Logins } from "../src/server/auth.js";
import { accountDirectory, privateJson } from "../src/server/model-account-storage.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";
import type { AuthState } from "../src/shared/models.js";
import type { UsageRecordFilter } from "../src/shared/model-usage.js";
import { emptyCostTotals } from "../src/shared/costs.js";
import { AppError } from "../src/shared/protocol.js";

// Private temporary fixtures only. Never authorize real OAuth or contact a model.
const root = mkdtempSync(join(tmpdir(), "axiom-account-ui-")), artifacts = mkdtempSync(join(tmpdir(), "axiom-account-layout-"));
console.log("UI_ARTIFACTS", artifacts);
// Exercise the mutable backend selection, not the parent agent's captured execution bindings.
const environment = ["AXIOM_PI_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER"];
const previous = new Map(environment.map(key => [key, process.env[key]]));
for (const key of environment) delete process.env[key];
process.env.AXIOM_PI_DIR = join(root, "models"); mkdirSync(process.env.AXIOM_PI_DIR);
const authPath = join(process.env.AXIOM_PI_DIR, "auth.json"), configPath = join(process.env.AXIOM_PI_DIR, "models.json");
const kiro = { type: "oauth", access: "FIXTURE_PRIVATE_KIRO", refresh: "FIXTURE_PRIVATE_REFRESH", expires: Date.now() + 3600000, authMethod: "identity-center", startUrl: "https://org.awsapps.com/start", authRegion: "eu-west-1", authFlow: "device" };
writeFileSync(authPath, JSON.stringify({ openai: { type: "oauth", access: "FIXTURE_PRIVATE_LEGACY", refresh: "FIXTURE_PRIVATE_REFRESH", expires: Date.now() + 3600000 }, fixture: { type: "api_key", key: "FIXTURE_PRIVATE_ORIGINAL_KEY" }, kiro }));
writeFileSync(configPath, JSON.stringify({ providers: { fixture: { name: "Fixture 本地接口", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 4096, maxTokens: 1024 }] } } }));
const models = new ModelService(root), accounts = new ModelAccountService(models);
await accounts.list();
for (const [label, region] of [["工作账号", "美国"], ["个人账号", "欧洲"]]) {
  const staged = accounts.prepare("openai", { label, region }); await accounts.configure(staged);
  privateJson(join(staged.dir, "auth.json"), { openai: { type: "oauth", access: `FIXTURE_PRIVATE_${region}`, refresh: "FIXTURE_PRIVATE_REFRESH", expires: Date.now() + 3600000, ...(label === "工作账号" ? { email: "work@example.test" } : { accountId: "personal-account" }) } });
  await accounts.commit(staged, "oauth");
}
const secondFixture = accounts.prepare("fixture", { label: "备用接口账号" }); await accounts.configure(secondFixture);
privateJson(join(secondFixture.dir, "auth.json"), { fixture: { type: "api_key", key: "FIXTURE_PRIVATE_SECOND_KEY" } }); await accounts.commit(secondFixture, "api_key");
const before = await accounts.list(), work = before.accounts.find(row => row.label === "工作账号")!, personal = before.accounts.find(row => row.label === "个人账号")!;
const originalAuth = readFileSync(authPath, "utf8"), requests: { id: string; refresh: boolean; cache: boolean }[] = [];
const originalUsage = ModelAccountService.prototype.usage, originalActivate = ModelAccountService.prototype.activate, originalList = ModelAccountService.prototype.list, originalCommit = ModelAccountService.prototype.commit, originalCancel = Logins.prototype.cancel;
let automatic = false, stale = false, reorderActivation = false, metricMode: "ready" | "unknown" | "zero" = "ready";
ModelAccountService.prototype.activate = async function(this: ModelAccountService, id, revision) {
  const result = await originalActivate.call(this, id, revision);
  if (reorderActivation && id === personal.id) { reorderActivation = false; await originalActivate.call(this, work.id, result.revision); }
  return result;
};
ModelAccountService.prototype.usage = async function(id, refresh, _signal, preferCache = false): Promise<ProviderUsage> {
  requests.push({ id: String(id), refresh, cache: preferCache });
  const row = (await originalList.call(accounts)).accounts.find(row => row.id === id)!;
  if (row.providerId !== "openai") return { providerId: row.providerId, status: "unsupported", metrics: [], refreshable: false, message: "此供应商暂未提供官方额度适配，未知余额不显示为 0。" };
  return { providerId: row.providerId, status: "ready", accountStatus: { state: "active", checkedAt: Date.now() }, updatedAt: Date.now(), nextRefreshAt: Date.now() + (automatic ? 250 : 60000), stale,
    ...(stale ? { message: "查询失败，保留上次结果。" } : {}), metrics: [
      { id: "primary_window", label: "5小时已用", kind: "window", usedPercent: metricMode === "unknown" ? null : metricMode === "zero" ? 0 : row.id === work.id ? 37.5 : 12, windowSeconds: 5 * 3600, resetsAt: Date.now() + 3600000 },
      { id: "secondary_window", label: "7天已用", kind: "window", usedPercent: metricMode === "unknown" ? null : metricMode === "zero" ? 0 : 50, windowSeconds: 7 * 86400, resetsAt: Date.now() + 86400000 },
      { id: "extra_0_primary_window", label: "Spark 5小时已用", kind: "window", usedPercent: metricMode === "unknown" ? null : metricMode === "zero" ? 0 : 10, windowSeconds: 5 * 3600, resetsAt: Date.now() + 3600000 },
      { id: "credits", label: "剩余点数", kind: "balance", balance: metricMode === "unknown" ? null : metricMode === "zero" ? "0" : row.id === work.id ? "111.50" : "222.25" },
      { id: "reset_credits", label: "重置次数", kind: "count", count: metricMode === "unknown" ? null : metricMode === "zero" ? 0 : 3, expiresAt: Date.now() + 86400000 },
    ] };
};
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
let ledgerReads = 0;
// Keep the UI's no-priced-sample case deterministic. Real ledger scans/watermarks are covered by provider-quota-estimate.check.ts.
app.usageLedger.read = async input => {
  ledgerReads++;
  const filter = input as UsageRecordFilter;
  assert.equal(filter.providerId, "openai"); assert.equal(filter.pageSize, 1);
  assert.ok(filter.from! < filter.to! && filter.to! <= Date.now());
  return { rows: [], total: emptyCostTotals(), count: 0, page: 1, pageSize: 1, snapshot: "fixture-empty-ledger",
    updatedAt: Date.now(), scannedRoots: 0, totalRoots: 0, partial: false, building: false, warnings: [], providers: ["openai"] };
};
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
async function noOverflow(page: Page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "page must fit viewport");
  const violations = await page.locator(".model-account-card").evaluateAll(cards => cards.flatMap(card => {
    const rect = card.getBoundingClientRect(), buttons = [...card.querySelectorAll(".account-card-actions button, .provider-usage-refresh")].map(button => button.getBoundingClientRect());
    const bad = card.scrollWidth > card.clientWidth + 1 || buttons.some(b => b.left < rect.left - 1 || b.right > rect.right + 1 || b.top < rect.top - 1 || b.bottom > rect.bottom + 1);
    const intersects = buttons.some((a, i) => buttons.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
    return bad || intersects ? [card.getAttribute("aria-label")] : [];
  }));
  assert.deepEqual(violations, [], "card controls must fit and not overlap");
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const card = (label: string) => page.getByRole("article", { name: `账号 ${label}`, exact: true });
  const accountsPage = async () => { await page.goto(app.origin + "/model-accounts.html"); await page.getByRole("heading", { name: "多账号管理", exact: true, level: 1 }).waitFor(); await card("工作账号").waitFor(); };
  const startAdding = async (label: string) => {
    await page.getByRole("button", { name: "添加账号", exact: true }).click();
    await page.waitForURL("**/model-config.html?add-account=1");
    await page.getByLabel("账号名称", { exact: true }).fill(label);
    await page.getByLabel("区域或备注", { exact: true }).fill("亚洲");
  };
  const submitKey = async (value: string) => { await page.locator("#auth-answer").fill(value); await page.getByRole("button", { name: "提交认证输入", exact: true }).click(); };
  await page.goto(app.origin + "/settings.html");
  await page.locator('a.module-row[href="/model-accounts.html"]').click();
  await page.getByRole("heading", { name: "多账号管理", exact: true, level: 1 }).waitFor();
  await card("工作账号").getByText("111.50", { exact: true }).waitFor();
  await card("工作账号").getByText("work@example.test", { exact: true }).waitFor();
  assert.equal(await card("工作账号").getByRole("progressbar", { name: "5小时 剩余额度", exact: true }).getAttribute("value"), "62.5");
  assert.match(await card("个人账号").innerText(), /222\.25/);
  assert.equal(await page.locator(".model-account-card").count(), 5);
  assert.equal(await page.locator(".accounts-intro, .accounts-guide, .accounts-footer").count(), 0, "workspace has no repeated introduction or navigation blocks");
  assert.equal(await page.getByRole("button", { name: "添加账号", exact: true }).count(), 1);
  await page.getByRole("searchbox", { name: "搜索账号" }).fill("no-matching-fixture");
  await page.getByRole("heading", { name: "没有匹配的账号", exact: true }).waitFor();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await card("工作账号").waitFor();
  assert.equal(await page.locator(".model-account-card").count(), 5);
  assert.equal((await accounts.list()).accounts.length, 6, "generic suppliers with two Auth accounts display; single accounts remain stored");
  await card("工作账号").getByRole("heading", { name: "订阅余额与额度", exact: false }).waitFor();
  await card("工作账号").getByText("剩余 62.5%", { exact: true }).waitFor();
  await card("工作账号").getByText("3 次", { exact: true }).waitFor();
  await card("工作账号").getByText("Spark 5小时", { exact: true }).waitFor();
  assert.equal(await card("工作账号").locator(".provider-usage-deadline").count(), 4);
  assert.ok(await card("工作账号").locator(".provider-usage-updated").isVisible());
  await card("工作账号").getByText("费用估算", { exact: true }).waitFor();
  await card("工作账号").getByText("窗口内暂无已计价样本", { exact: true }).first().waitFor();
  await card("工作账号").getByText(/尚未按账号拆分；多账号混用/).waitFor();
  assert.equal(await card("工作账号").getByText(/^约 \$/).count(), 0, "no priced sample must not invent an amount");
  assert.ok(ledgerReads > 0, "account estimates query actual same-window provider totals without rendering request records");
  const singleIds = before.accounts.filter(row => row.providerId === "kiro").map(row => row.id);
  assert.ok(!requests.some(row => singleIds.includes(row.id)), "single accounts must not query card usage");
  const desktopCard = (await card("工作账号").boundingBox())!, areaRatio = desktopCard.width * desktopCard.height / (396 * 417);
  console.log("EXTENDED_OPENAI_CARD", JSON.stringify({ ...desktopCard, areaRatio }));
  // Provider extensions keep all fields and grow naturally; the generic shell stays compact.
  await noOverflow(page); await page.screenshot({ path: join(artifacts, "1440-accounts.png"), fullPage: true });
  await card("工作账号").getByRole("button", { name: "查看账号详情" }).click();
  const details = page.getByRole("dialog", { name: "账号详情：工作账号" });
  await details.getByText("独立保存", { exact: true }).waitFor(); await details.getByText("令牌有效期", { exact: true }).waitFor();
  await details.getByText("账号状态", { exact: true }).waitFor(); await details.locator("dd").filter({ hasText: /^检查通过 · 检查于 / }).waitFor();
  await details.getByRole("button", { name: "关闭", exact: true }).click();

  // One OpenAI OAuth is independently eligible; missing credentials never count as Auth.
  ModelAccountService.prototype.list = async function() { const list = await originalList.call(this); return { ...list, accounts: list.accounts.filter(row => row.id === work.id) }; };
  const single = await context.newPage(); await single.goto(app.origin + "/model-accounts.html");
  const subscription = single.getByRole("article", { name: "账号 工作账号", exact: true });
  await subscription.getByText("111.50", { exact: true }).waitFor(); assert.equal(await single.locator(".model-account-card").count(), 1);
  await subscription.getByText("费用估算", { exact: true }).waitFor();
  await subscription.getByText("窗口内暂无已计价样本", { exact: true }).first().waitFor();
  assert.equal(await subscription.getByText(/^约 \$/).count(), 0, "empty historical samples cannot establish an entitlement");
  assert.ok(ledgerReads > 0); await single.close();
  ModelAccountService.prototype.list = async function() { const list = await originalList.call(this); const rows = list.accounts.filter(row => row.providerId !== "openai"); return { ...list, accounts: [...rows, { ...rows[0], id: "missing-auth-fixture", providerId: "fixture", label: "认证已移除", type: undefined }] }; };
  const two = await context.newPage(); await two.goto(app.origin + "/model-accounts.html");
  await two.getByRole("article", { name: "账号 备用接口账号", exact: true }).waitFor();
  assert.equal(await two.locator(".model-account-card").count(), 2, "two Auth accounts display but a missing credential never becomes a card"); await two.close();
  ModelAccountService.prototype.list = async function() { const list = await originalList.call(this); const one = list.accounts.find(row => row.providerId === "fixture")!; return { ...list, accounts: [one, { ...one, id: "missing-auth-fixture", label: "认证已移除", type: undefined }] }; };
  const empty = await context.newPage();
  await empty.goto(app.origin + "/model-accounts.html"); await empty.getByRole("heading", { name: "暂无需要展示的账号", exact: true }).waitFor();
  assert.equal(await empty.locator(".model-account-card").count(), 0); assert.ok(await empty.getByRole("button", { name: "添加账号", exact: true }).isEnabled());
  await empty.close(); ModelAccountService.prototype.list = originalList;
  assert.ok(!JSON.stringify(await context.storageState()).includes("FIXTURE_PRIVATE"));
  assert.ok(!(await page.locator("body").innerText()).includes("FIXTURE_PRIVATE"));
  metricMode = "unknown"; await card("工作账号").getByRole("button", { name: "刷新供应商额度", exact: true }).click();
  await card("工作账号").locator('[data-metric-kind="count"] strong').filter({ hasText: "—" }).waitFor();
  assert.equal(await card("工作账号").getByRole("progressbar").count(), 0, "unknown percentages are not zero progress");
  metricMode = "zero"; await card("工作账号").getByRole("button", { name: "刷新供应商额度", exact: true }).click();
  await card("工作账号").getByText("0 次", { exact: true }).waitFor();
  assert.equal(await card("工作账号").getByRole("progressbar", { name: "5小时 剩余额度", exact: true }).getAttribute("value"), "100");
  metricMode = "ready"; await card("工作账号").getByRole("button", { name: "刷新供应商额度", exact: true }).click();
  await card("工作账号").getByText("111.50", { exact: true }).waitFor();

  await page.getByRole("searchbox", { name: "搜索账号" }).fill("欧洲");
  assert.equal(await page.locator(".model-account-card").count(), 1); await card("个人账号").waitFor();
  assert.ok(Math.abs((await card("个人账号").boundingBox())!.width - desktopCard.width) < 2, "one filtered result must not stretch");
  await page.getByRole("searchbox", { name: "搜索账号" }).fill("");
  await page.getByRole("combobox", { name: "筛选供应商", exact: true }).click(); await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await card("工作账号").getByRole("button", { name: "启用此账号", exact: true }).click();
  await page.getByRole("dialog", { name: "切换账号", exact: true }).getByRole("button", { name: "确认切换", exact: true }).click();
  await card("工作账号").getByRole("status", { name: "当前账号", exact: true }).waitFor();
  assert.equal((await accounts.list()).accounts.find(row => row.id === work.id)!.active, true); assert.equal(readFileSync(authPath, "utf8"), originalAuth);
  await page.evaluate(() => {
    (window as any).__staleSelection = false;
    new MutationObserver(() => { if (document.querySelector('[aria-label="账号 个人账号"]')?.getAttribute("data-active") === "true") (window as any).__staleSelection = true; })
      .observe(document.querySelector(".model-account-grid")!, { subtree: true, attributes: true, childList: true });
  });
  reorderActivation = true;
  await card("个人账号").getByRole("button", { name: "启用此账号", exact: true }).click();
  await page.getByRole("dialog", { name: "切换账号", exact: true }).getByRole("button", { name: "确认切换", exact: true }).click();
  await page.getByRole("dialog", { name: "切换账号", exact: true }).waitFor({ state: "hidden" });
  await card("工作账号").getByRole("status", { name: "当前账号", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).__staleSelection), false, "late write response must not roll back cards");

  assert.ok(requests.filter(row => row.id === work.id && !row.refresh).every(row => row.cache), "account cards must read the cache by default");
  automatic = true; const queued = requests.length;
  await card("工作账号").getByRole("button", { name: "刷新供应商额度", exact: true }).click();
  await page.waitForTimeout(100); assert.deepEqual(requests.slice(queued).map(row => [row.id, row.refresh, row.cache]), [[work.id, true, false]], "重新查询 must bypass the cache once");
  assert.match(await card("工作账号").getByRole("button", { name: "刷新供应商额度", exact: true }).innerText(), /重新查询/);
  const calls = requests.filter(row => row.id === work.id).length;
  await page.waitForTimeout(1400); assert.equal(requests.filter(row => row.id === work.id).length, calls, "account cards must not poll even when nextRefreshAt has passed");
  stale = true; await card("工作账号").getByRole("button", { name: "刷新供应商额度", exact: true }).click();
  await card("工作账号").getByText(/查询失败，保留上次结果/).waitFor(); assert.match(await card("工作账号").innerText(), /旧数据/);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(100); const hiddenCalls = requests.length;
  await page.waitForTimeout(1400); assert.equal(requests.length, hiddenCalls, "hidden page must pause queries");
  automatic = false; stale = false;
  await page.evaluate(() => { delete (document as any).visibilityState; document.dispatchEvent(new Event("visibilitychange")); });

  // Native Kiro prompts are prefilled; cancel before flow submission, so no external network starts.
  await startAdding("取消的企业账号");
  await page.getByRole("combobox", { name: "供应商", exact: true }).click(); await page.getByRole("option", { name: "kiro", exact: true }).click();
  await page.getByRole("button", { name: "浏览器登录", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector("#auth-answer") as HTMLElement)?.textContent?.includes("企业"));
  assert.match(await page.locator("#auth-answer").innerText(), /企业/);
  await page.getByRole("button", { name: "提交认证输入", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector("#auth-answer") as HTMLInputElement)?.value === "https://org.awsapps.com/start");
  await page.getByRole("button", { name: "提交认证输入", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector("#auth-answer") as HTMLInputElement)?.value === "eu-west-1");
  await page.getByRole("button", { name: "提交认证输入", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector("#auth-answer") as HTMLElement)?.textContent?.includes("设备"));
  // A failed cancel receipt must not revoke the user's intent. Inject the late event
  // only after the client has rendered that failure, then retry cancellation.
  let cancelAttempts = 0, lateCompletion: (() => void) | undefined;
  Logins.prototype.cancel = async function(owner, id) {
    const publishLate = () => {
      const state = { ...this.get(owner, id).state, status: "completed" as const };
      (this as unknown as { publish: (owner: object, state: AuthState) => void }).publish(owner, state);
    };
    if (++cancelAttempts === 1) {
      lateCompletion = publishLate;
      throw new AppError("AUTH_CANCEL_RETRY", "取消暂未确认，请再次取消。");
    }
    const result = await originalCancel.call(this, owner, id);
    // The native operation is cancelled before this synthetic event; no external auth.
    publishLate();
    await new Promise(resolve => setTimeout(resolve, 200)); return result;
  };
  await page.getByRole("button", { name: "取消登录", exact: true }).click();
  await page.getByText("取消暂未确认，请再次取消。", { exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "取消登录", exact: true }).isEnabled(), "a failed cancellation must remain retryable");
  lateCompletion!();
  await page.waitForTimeout(350);
  assert.match(page.url(), /model-config\.html\?add-account=1/, "completion after a failed cancellation must never redirect");
  await page.getByRole("button", { name: "关闭并刷新状态", exact: true }).click();
  await page.locator(".oauth-login-panel").waitFor({ state: "hidden" });
  await page.waitForTimeout(350);
  assert.ok(cancelAttempts >= 2, "explicit cancellation must be retryable (unmount cleanup may cancel again)");
  assert.match(page.url(), /model-config\.html\?add-account=1/, "a late completion must never redirect after explicit cancel");
  Logins.prototype.cancel = originalCancel;
  assert.equal((await accounts.list()).accounts.length, 6);
  await accountsPage();

  await startAdding("新增测试账号");
  await page.getByRole("combobox", { name: "供应商", exact: true }).click(); await page.getByRole("option", { name: "Fixture 本地接口", exact: true }).click();
  await page.getByRole("button", { name: "API Key 登录", exact: true }).click();
  await submitKey("FIXTURE_PRIVATE_NEW_KEY"); await page.waitForURL("**/model-accounts.html**");
  await page.getByText("账号已保存。", { exact: true }).waitFor();
  await card("新增测试账号").waitFor(); assert.equal(await page.locator(".model-account-card").count(), 6);
  const genericCard = (await card("新增测试账号").boundingBox())!, genericRatio = genericCard.width * genericCard.height / (396 * 417);
  console.log("COMPACT_GENERIC_CARD", JSON.stringify({ ...genericCard, areaRatio: genericRatio }));
  assert.ok(genericRatio >= .20 && genericRatio <= .35, "generic card retains the compact quarter-area shell");
  assert.equal(await page.locator(".account-provider-group").count(), 2);
  const added = (await accounts.list()).accounts.find(row => row.label === "新增测试账号")!;
  assert.ok(added && !added.active); assert.equal(readFileSync(authPath, "utf8"), originalAuth);
  assert.ok(readFileSync(join(accountDirectory(models.dir, added.id), "auth.json"), "utf8").includes("FIXTURE_PRIVATE_NEW_KEY"));
  assert.equal((await accounts.list()).accounts.find(row => row.id === work.id)!.active, true);
  for (const [width, height] of [[390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height }); await noOverflow(page);
    assert.equal(await page.locator(".model-account-card").count(), 6);
    await page.screenshot({ path: join(artifacts, `${width}-accounts.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A new custom provider uses shared configuration save, then the existing Auth UI.
  await startAdding("首个自定义账号");
  await page.getByRole("button", { name: "添加供应商", exact: true }).click(); await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("fresh-fixture"); await page.locator("#provider-name").fill("Fresh 本地接口"); await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  assert.equal(await page.locator("#provider-key").count(), 0, "add mode must never save keys through configuration");
  await page.locator("#save-provider").click();
  await page.getByRole("heading", { name: "Fresh 本地接口", exact: true }).waitFor();
  await page.getByRole("button", { name: "添加 API Key 账号", exact: true }).click(); await submitKey("FIXTURE_PRIVATE_FRESH_KEY");
  await page.waitForURL("**/model-accounts.html**"); await card("工作账号").waitFor();
  const fresh = (await accounts.list()).accounts.find(row => row.providerId === "fresh-fixture")!;
  assert.ok(fresh?.active, "the first successful supplier account must be usable");
  assert.equal(await card("首个自定义账号").count(), 0, "single custom supplier remains hidden");
  assert.equal((await (await models.runtime()).getAuth("fresh-fixture"))?.auth.apiKey, "FIXTURE_PRIVATE_FRESH_KEY");
  assert.equal(readFileSync(authPath, "utf8"), originalAuth);

  // Saved-before-failure is not success and cannot fake a return. Recovery is explicit in Models.
  await startAdding("写后失败账号");
  await page.getByRole("button", { name: "添加供应商", exact: true }).click(); await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("recovery-fixture"); await page.locator("#provider-name").fill("Recovery 本地接口"); await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#save-provider").click(); await page.getByRole("heading", { name: "Recovery 本地接口", exact: true }).waitFor();
  ModelAccountService.prototype.commit = async function(staged, type, selectIfFirst) {
    if (staged.providerId === "recovery-fixture" && selectIfFirst) throw Error("fixture synchronization failure after save");
    return originalCommit.call(this, staged, type, selectIfFirst);
  };
  await page.getByRole("button", { name: "添加 API Key 账号", exact: true }).click(); await submitKey("FIXTURE_PRIVATE_RECOVER_KEY");
  await page.getByText(/认证已写入并保存为独立账号，但登录流程未正常结束/).waitFor();
  assert.match(page.url(), /model-config\.html\?add-account=1/);
  const recovered = (await accounts.list()).accounts.find(row => row.providerId === "recovery-fixture")!; assert.ok(recovered && !recovered.active);
  ModelAccountService.prototype.commit = originalCommit;
  await page.getByRole("button", { name: "关闭并刷新状态", exact: true }).click();
  await page.getByRole("button", { name: "启用已保留账号", exact: true }).click();
  await page.getByRole("button", { name: "启用已保留账号", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await accounts.list()).accounts.find(row => row.id === recovered.id)!.active, true);
  assert.equal((await (await models.runtime()).getAuth("recovery-fixture"))?.auth.apiKey, "FIXTURE_PRIVATE_RECOVER_KEY");
  await accountsPage(); assert.equal(await page.locator(".model-account-card").count(), 6);

  // Offscreen cards are not queried eagerly.
  for (let n = 0; n < 30; n++) {
    const staged = accounts.prepare("fixture", { label: `不可见卡片 ${n}` }); await accounts.configure(staged);
    privateJson(join(staged.dir, "auth.json"), { fixture: { type: "api_key", key: "FIXTURE_PRIVATE_HIDDEN" } }); await accounts.commit(staged, "api_key");
  }
  await page.getByRole("button", { name: "刷新列表", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".model-account-card").length === 36); await page.waitForTimeout(150);
  const unseen = (await accounts.list()).accounts.find(row => row.label === "不可见卡片 29")!, box = (await card("不可见卡片 29").boundingBox())!;
  assert.ok(box.y > 1100, "last card really is outside viewport and observer margin");
  assert.ok(!requests.some(request => request.id === unseen.id), "offscreen cards must not be queried");
  assert.ok(!JSON.stringify(await context.storageState()).includes("FIXTURE_PRIVATE")); assert.ok(!(await page.locator("body").innerText()).includes("FIXTURE_PRIVATE"));
  assert.deepEqual(errors, []);
  console.log("PASS generic compact shell + OpenAI extension, single subscription visible, generic 1 hidden/2 Auth visible, missing Auth excluded, full windows/points/reset count/deadlines, zero/unknown, account estimate attribution guard, identity/details, filters, activation/late response, refresh/stale/hidden, Auth add/cancel retry/late completion/failure/return, new supplier usable, explicit recovery, credential isolation, 1440/390/320 and offscreen demand");
  await context.close();
} finally {
  ModelAccountService.prototype.usage = originalUsage; ModelAccountService.prototype.activate = originalActivate; ModelAccountService.prototype.list = originalList; ModelAccountService.prototype.commit = originalCommit; Logins.prototype.cancel = originalCancel;
  await browser.close(); await app.close();
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
}
