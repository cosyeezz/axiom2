import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";
import type { UsageRecordFilter } from "../src/shared/model-usage.js";

// Temporary histories and mocked official GET results only; no OAuth, paid models or real account operations.
const root = mkdtempSync(join(tmpdir(), "axiom-quota-reference-")), artifacts = mkdtempSync(join(tmpdir(), "axiom-quota-evidence-"));
console.log("QUOTA_EVIDENCE", artifacts);
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
const auth = join(process.env.AXIOM_PI_DIR, "auth.json"), config = join(process.env.AXIOM_PI_DIR, "models.json");
const credential = { type: "oauth", access: "PRIVATE_FIXTURE_ACCESS", refresh: "PRIVATE_FIXTURE_REFRESH", expires: Date.now() + 86400000 };
writeFileSync(auth, JSON.stringify({ openai: credential }));
writeFileSync(config, JSON.stringify({ providers: { openai: { name: "OpenAI 参考连接", models: [] }, other: { name: "其他连接", models: [] } } }));
const data = join(root, "data");
const originalAuth = readFileSync(auth, "utf8"), originalConfig = readFileSync(config, "utf8");
// Long observation interval keeps the append fixture deterministic; explicit refresh/view intents still wake the worker immediately.
const app = await startServer({ root: data, port: 0, dev: true, usageSidecar: { pollMs: 60_000, cooldownMs: 0, pauseMs: 0, initialDelayMs: 0 } });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const now = Date.now(), hour = 3600000, sampleAt = now - hour / 2, histories: SessionManager[] = [];
  for (const [index, rows] of [
    [["openai", 5, now - 2 * hour], ["openai", 40, now - 2 * 86400000], ["openai", 900, now - 6 * 86400000]],
    [["openai", 5, now - hour], ["openai", 100, now - hour / 4], ["other", 999, now - hour]],
  ].entries()) {
    const path = join(root, `workspace-${index}`); mkdirSync(path);
    const workspace = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path, authorized: true } }) as Workspace;
    const session = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: {} }) as Session;
    const manager = SessionManager.create(path, join(root, "histories")); histories.push(manager);
    for (const [provider, amount, timestamp] of rows as [string, number, number][]) manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }],
      api: "openai-completions", provider, model: "priced-fixture", timestamp, stopReason: "stop", usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
        cost: { input: amount, output: 0, cacheRead: 0, cacheWrite: 0, total: amount } } });
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  }
  let mode = "ready", officialReads = 0, building = 0, outdated = 0;
  const reads: UsageRecordFilter[] = [];
  let release: (() => void) | undefined;
  const releasePending = () => { const pending = release; release = undefined; assert.ok(pending); pending(); };
  const official = (providerId: string): ProviderUsage => ({ providerId, status: "ready", updatedAt: sampleAt, metrics: [
    { id: "primary_window", kind: "window", label: "5小时已用", usedPercent: mode === "zero" ? 0 : mode === "exhausted" ? 100 : 25, windowSeconds: 5 * 3600, resetsAt: mode === "expired" ? now - 1 : mode === "soon" ? Date.now() + 1500 : now + hour },
    { id: "secondary_window", kind: "window", label: "7天已用", usedPercent: mode === "zero" ? 0 : 50, windowSeconds: 7 * 86400, resetsAt: mode === "expired" ? now - 1 : now + 2 * 86400000 },
    { id: "extra_0_primary_window", kind: "window", label: "Spark 5小时已用", usedPercent: 10, windowSeconds: 5 * 3600, resetsAt: now + hour },
    { id: "credits", kind: "balance", label: "剩余点数", balance: "123.4500" },
  ] });
  app.agents.models.usage = async provider => { officialReads++; if (mode === "fail") throw Error("PRIVATE_ERROR"); return official(String(provider)); };
  const originalRead = app.usageLedger.read.bind(app.usageLedger);
  app.usageLedger.read = async input => {
    const params = input as UsageRecordFilter;
    if (params.providerId === "openai" && params.from !== undefined) {
      reads.push(params);
      if (mode === "slow") await new Promise<void>(resolve => { release = resolve; });
      const page = await originalRead(input);
      if (mode === "outdated" && outdated-- > 0) return { ...page, updatedAt: sampleAt - 1 };
      if (mode === "partial") return { ...page, partial: true };
      if (mode === "unknown") return { ...page, total: { ...page.total, unknownCost: 1 } };
      if (mode === "tiny") return { ...page, total: { ...page.total, knownCost: 1e-25 } };
      if (mode === "building" && building-- > 0) return { ...page, building: true };
      return page;
    }
    return originalRead(input);
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const choose = async (label: string, name: string) => { await page.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name, exact: true }).click(); };
  await page.goto(app.origin + "/model-usage.html"); await page.getByRole("tab", { name: "官方额度", exact: true }).waitFor();
  assert.equal(reads.length, 0); assert.equal(officialReads, 0);
  await page.getByRole("tab", { name: "官方额度", exact: true }).click(); await choose("供应商", "OpenAI 参考连接");
  const estimate = page.getByRole("region", { name: "额度金额预估", exact: true });
  // A labelled section is exposed as a region; current and weekly windows remain independent.
  const cards = estimate.locator(".provider-quota-window"), refresh = page.getByRole("button", { name: "刷新供应商额度", exact: true });
  await cards.nth(0).getByText("约 $40.0000", { exact: true }).waitFor(); await cards.nth(1).getByText("约 $100.0000", { exact: true }).waitFor();
  assert.equal(await cards.count(), 2); assert.match(await cards.nth(0).innerText(), /约 \$30\.0000/); assert.match(await cards.nth(1).innerText(), /约 \$50\.0000/);
  assert.match(await estimate.innerText(), /未核对历史换号及其他设备消费/); assert.match(await estimate.innerText(), /非官方余额/);
  assert.equal(new Set(reads.map(params => params.from)).size, 2); assert.ok(reads.every(params => params.providerId === "openai" && params.to === sampleAt && params.pageSize === 1 && !params.workspaceId && !params.rootSessionId && !params.query));
  assert.equal(reads[0].from, now - 4 * hour); assert.ok(reads.some(params => params.from === now - 5 * 86400000)); assert.match(await cards.nth(0).getAttribute("title") ?? "", /2 条账务，\$10\.0000/);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: join(artifacts, `${width}-quota.png`), fullPage: true });
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1, JSON.stringify(size));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const refreshAs = async (next: string) => { mode = next; const before = officialReads; await refresh.click(); await page.waitForFunction(() => !document.querySelector('[aria-label="供应商额度"]')?.getAttribute("aria-busy") || document.querySelector('[aria-label="供应商额度"]')?.getAttribute("aria-busy") === "false"); assert.ok(officialReads > before); };
  await refreshAs("partial"); await cards.nth(0).getByText("本机记录未完整核对", { exact: true }).waitFor(); assert.equal(await estimate.getByText(/^约 \$/).count(), 0);
  await refreshAs("unknown"); await cards.nth(1).getByText("窗口内存在未计价或不完整记录", { exact: true }).waitFor();
  await refreshAs("tiny"); await cards.nth(0).getByText("约 $4.000e-25", { exact: true }).waitFor();
  await refreshAs("zero"); await cards.nth(0).getByText("窗口时间或已用比例不足，暂不能外推", { exact: true }).waitFor(); const zeroReads = reads.length; await page.waitForTimeout(150); assert.equal(reads.length, zeroReads); assert.equal(await estimate.getByText(/^约 \$/).count(), 0);
  await refreshAs("expired"); await cards.nth(1).getByText("窗口时间或已用比例不足，暂不能外推", { exact: true }).waitFor();
  await refreshAs("exhausted"); await cards.nth(0).getByText("约 $0.0000", { exact: true }).waitFor();
  building = 2; await refreshAs("building"); await cards.nth(0).getByText("约 $40.0000", { exact: true }).waitFor(); assert.ok(reads.some(params => params.continue));
  await refreshAs("fail"); await page.getByText("旧数据", { exact: true }).waitFor(); await cards.nth(0).getByText("官方额度为旧数据，暂不外推", { exact: true }).waitFor(); assert.equal(await estimate.getByText(/^约 \$/).count(), 0);
  // A late local sample cannot populate a different official provider selection.
  mode = "slow"; await refresh.click(); for (let i = 0; !release && i < 200; i++) await page.waitForTimeout(10); assert.ok(release);
  await choose("供应商", "其他连接"); await page.getByText("请先在模型服务设置中连接账号。", { exact: true }).waitFor(); mode = "ready"; releasePending(); await page.waitForTimeout(150); assert.equal(await estimate.count(), 0);
  await choose("供应商", "OpenAI 参考连接"); await cards.nth(0).getByText("约 $40.0000", { exact: true }).waitFor();
  assert.equal(await page.locator(".usage-management").count(), 0); assert.match(await estimate.innerText(), /未核对历史换号及其他设备消费/);
  // A manual refresh must rebuild a cached ledger, even when the official reading is unchanged.
  const sampleFilter = { providerId: "openai", from: now - 4 * hour, to: sampleAt, pageSize: 1 };
  assert.equal((await originalRead(sampleFilter)).total.knownCost, 10);
  histories[0].appendMessage({ role: "assistant", content: [{ type: "text", text: "late imported sample" }], api: "openai-completions", provider: "openai", model: "priced-fixture",
    timestamp: now - hour, stopReason: "stop", usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
      cost: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, total: 2 } } });
  assert.equal((await originalRead(sampleFilter)).total.knownCost, 10, "fixture must actually reuse the old ledger cache");
  const beforeManual = reads.length; await refreshAs("ready");
  await cards.nth(0).getByText("约 $48.0000", { exact: true }).waitFor(); await cards.nth(1).getByText("约 $104.0000", { exact: true }).waitFor();
  assert.equal(reads[beforeManual].refresh, true); assert.equal(reads.slice(beforeManual).filter(params => params.refresh).length, 1, "one asynchronous rebuild shared by both windows");
  assert.ok(reads.slice(beforeManual).some(params => params.continue), "wait for the new background generation, even when the old watermark was after the official cutoff");
  // A normal initial read also rebuilds once if its snapshot predates the official sampling cutoff.
  await choose("供应商", "其他连接"); mode = "outdated"; outdated = 1; const beforeOutdated = reads.length;
  await choose("供应商", "OpenAI 参考连接"); await cards.nth(1).getByText("约 $104.0000", { exact: true }).waitFor();
  assert.equal(reads[beforeOutdated].refresh, false); assert.equal(reads.slice(beforeOutdated).filter(params => params.refresh).length, 1);
  // Hiding the page stops both late sample publication and continuation, then resumes on visibility.
  mode = "slow"; await refresh.click(); for (let i = 0; !release && i < 200; i++) await page.waitForTimeout(10); assert.ok(release);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const hiddenReads = reads.length; mode = "building"; building = 2; releasePending();
  await page.waitForTimeout(250); assert.equal(reads.length, hiddenReads, "hidden page must not continue scanning");
  await page.evaluate(() => { Reflect.deleteProperty(document, "visibilityState"); document.dispatchEvent(new Event("visibilitychange")); });
  await cards.nth(1).getByText("约 $104.0000", { exact: true }).waitFor(); assert.ok(reads.slice(hiddenReads).some(params => params.continue));
  // An already-visible estimate is withdrawn when its reset time passes, without another official poll.
  await refreshAs("soon"); await cards.nth(0).getByText("约 $48.0000", { exact: true }).waitFor(); const beforeReset = officialReads;
  await cards.nth(0).getByText("窗口时间或已用比例不足，暂不能外推", { exact: true }).waitFor(); assert.equal(officialReads, beforeReset);
  assert.equal(await cards.nth(0).getByText(/^约 \$/).count(), 0); await cards.nth(1).getByText("约 $104.0000", { exact: true }).waitFor();
  const beforeLeaving = reads.length; await page.getByRole("tab", { name: "用量概览", exact: true }).click(); await page.waitForTimeout(200); assert.equal(reads.length, beforeLeaving);
  assert.deepEqual(errors, []); assert.equal(readFileSync(auth, "utf8"), originalAuth); assert.equal(readFileSync(config, "utf8"), originalConfig);
  console.log("PASS OpenAI quota reference: window sums, formulas, sample cutoff, provider scope, unknowns, continuation, stale/provider races, cache refresh, visibility pause, timed expiry and 3 viewports");
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
