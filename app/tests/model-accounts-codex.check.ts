import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { codexAccountFixture } from "./fixtures/model-accounts-codex.js";

// No service/adapter mock: the actual account RPC, cache, worker and adapter run.
const f = await codexAccountFixture(), artifacts = mkdtempSync(join(tmpdir(), "axiom-codex-card-"));
const app = await startServer({ root: f.root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin + "/model-accounts.html");
  const a = page.getByRole("article", { name: "账号 Codex A", exact: true }), b = page.getByRole("article", { name: "账号 Codex B", exact: true });
  try { await a.getByText("111.5000", { exact: true }).waitFor(); await b.getByText("222.2500", { exact: true }).waitFor(); }
  catch (error) {
    writeFileSync(join(artifacts, "failure-body.txt"), await page.locator("body").innerText());
    writeFileSync(join(artifacts, "failure-requests.json"), JSON.stringify(f.requests(), null, 2));
    await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true });
    console.error("CODEX_UI_DIAGNOSTICS", artifacts, JSON.stringify({ errors, requests: f.requests() })); throw error;
  }
  assert.equal(await page.locator(".model-account-card").count(), 3);
  await a.getByText("a@example.test", { exact: true }).waitFor();
  assert.equal(await a.locator(".account-card-identity").getAttribute("title"), "官方查询邮箱：a@example.test", "an identical token email must not relabel the live official source as unverified");
  assert.equal(await a.locator(".account-identity-source").count(), 0, "no duplicate provenance warning when official and saved email agree; token-only fallback is covered by the direct fixture");
  assert.ok(await a.locator("details").evaluateAll(nodes => nodes.length <= 1 && nodes.every(node => node.classList.contains("provider-usage-expiries"))), "account identity and amount are visible without expansion");
  await b.getByText("b@example.test", { exact: true }).waitFor(); // Real wham email, absent from the saved credential.
  await a.getByText("pro", { exact: true }).waitFor();
  await a.getByText("账号状态：检查通过", { exact: true }).waitFor();
  assert.equal(await a.getByText("plus", { exact: true }).count(), 0, "live plan takes precedence over older grant metadata");
  assert.equal(await a.getByRole("progressbar", { name: "5小时 剩余额度", exact: true }).getAttribute("value"), "62.5");
  assert.equal(await a.getByRole("progressbar", { name: "Spark 5小时 剩余额度", exact: true }).getAttribute("value"), "0");
  await a.getByText("额度已达上限", { exact: true }).waitFor(); await a.getByText("3 次", { exact: true }).waitFor();
  await a.getByText("重置券到期明细 · 3", { exact: true }).click();
  assert.equal(await a.locator(".provider-usage-expiries li time").count(), 3);
  assert.equal(await a.locator(".provider-usage-expiries li time").first().getAttribute("datetime"), "2099-01-01T00:00:00.000Z");
  assert.equal(await a.getByRole("link", { name: /供应商样本金额/ }).count(), 0);
  await a.getByText("费用估算", { exact: true }).waitFor();
  await a.getByText(/尚未按账号拆分；多账号混用/).waitFor();
  await a.getByText("订阅有效至", { exact: true }).waitFor();
  assert.equal(await a.locator('.provider-usage-account time').getAttribute("datetime"), "2098-06-01T00:00:00.000Z");
  await a.getByRole("button", { name: "查看账号详情" }).click();
  const details = page.getByRole("dialog", { name: "账号详情：Codex A" });
  await details.getByText("pro", { exact: true }).waitFor();
  assert.equal(await details.getByText("plus", { exact: true }).count(), 0, "details share the same live account information as the card");
  await details.getByText("account-A", { exact: true }).waitFor();
  await details.getByText("订阅有效至", { exact: true }).waitFor();
  await details.getByText("令牌有效期", { exact: true }).waitFor();
  await details.getByText("账号状态", { exact: true }).waitFor();
  await details.locator("dd").filter({ hasText: /^检查通过 · 检查于 / }).waitFor();
  await details.getByRole("button", { name: "关闭", exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const overflow = await page.locator(".model-account-card").evaluateAll(cards => cards.some(card => card.scrollWidth > card.clientWidth + 1));
    assert.equal(overflow, false, `all account information fits at ${width}`);
    // Let Chrome commit the resized compositor surface before a full-page capture.
    await page.evaluate(() => { window.scrollTo(0, 0); return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(artifacts, `${width}-codex.png`), fullPage: true, animations: "disabled" });
  }
  assert.ok(!JSON.stringify(await context.storageState()).includes("FIXTURE_PRIVATE"));
  assert.ok(!(await page.locator("body").innerText()).includes("FIXTURE_PRIVATE")); assert.deepEqual(errors, []);
  const requests = f.requests(); assert.equal(requests.length, 9); assert.deepEqual(new Set(requests.map(row => row.slot)), new Set(["A", "B", "LEGACY"]));
  for (const slot of ["A", "B", "LEGACY"]) assert.deepEqual(requests.filter(row => row.slot === slot).map(row => row.path), [
    "/backend-api/accounts/check/v4-2023-04-27", "/backend-api/wham/usage", "/backend-api/wham/rate-limit-reset-credits",
  ], "each real worker waits for status before quota and reset-credit reads");
  for (const slot of ["A", "B", "LEGACY"] as const) assert.equal(readFileSync(join(f.slots[slot].dir, "auth.json"), "utf8"), f.originals[slot]);
  console.log("PASS real Codex RPC→cache→worker→official adapter card: per-account GETs/identity/plan/decimal balance/remaining progress/Spark limits/reset expiry list/no secret leaks/no auth mutation/1440/390/320", artifacts);
  await context.close();
} finally { await browser.close(); await app.close(); await f.close(); }
