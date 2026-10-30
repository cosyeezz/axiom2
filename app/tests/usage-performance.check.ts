import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { UsageRecordFilter } from "../src/shared/model-usage.js";

// Production assets, isolated history and in-memory monitoring only. Build before running.
const root = mkdtempSync(join(tmpdir(), "axiom-usage-performance-")), previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), "{}");
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: { fixture: { name: "性能测试供应商", models: [] } } }));
const app = await startServer({ root: join(root, "data"), port: 0, dev: false });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: { title: "性能测试会话" } }) as Session;
  const file = join(root, "history.jsonl");
  writeFileSync(file, [JSON.stringify({ type: "session", version: 3, id: crypto.randomUUID(), cwd: root }), ...Array.from({ length: 20 }, (_, i) => JSON.stringify({ type: "message", id: `row-${i}`, timestamp: "2026-01-01T00:00:00Z", message: {
    role: "assistant", provider: "fixture", model: "fixture-model", stopReason: "stop", timestamp: 1767225600000,
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { input: .01, output: 0, cacheRead: 0, cacheWrite: 0, total: .01 } },
  } }))].join("\n") + "\n");
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, file);
  let requestReads = 0, officialReads = 0, ledgerReads = 0;
  const filters: UsageRecordFilter[] = [], read = app.usageLedger.read.bind(app.usageLedger), stats = app.agents.pool.requests.snapshot.bind(app.agents.pool.requests);
  app.usageLedger.read = params => { ledgerReads++; filters.push(params as UsageRecordFilter); return read(params); };
  app.agents.pool.requests.snapshot = () => { requestReads++; return stats(); };
  app.agents.models.usage = async () => { officialReads++; throw Error("Official upstream must not be prefetched"); };
  app.agents.pool.requests.observe("fixture", { type: "provider_request_stat", phase: "start", id: "fixture-request", provider: "fixture", precision: "http" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => { if (!document.querySelector(".usage-page-heading h1")) return;
      (window as any).usageShellAt = performance.now(); observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
  });
  let directories: Record<string, number> = {};
  page.on("websocket", socket => socket.on("framesent", frame => { try { const call = JSON.parse(String(frame.payload));
    if (["usage.providers", "usage.workspaces", "usage.sessions"].includes(call.op)) directories[call.op] = (directories[call.op] ?? 0) + 1;
  } catch { /* Ignore other frames. */ } }));
  const start = performance.now(); await page.goto(app.origin + "/model-usage.html"); await page.getByRole("heading", { name: "模型用量与统计", exact: true }).waitFor();
  const coldShellMs = performance.now() - start;
  await page.waitForFunction(() => !(document.getElementById("usage-session") as HTMLButtonElement)?.disabled);
  assert.equal(ledgerReads, 0); assert.equal(officialReads, 0);
  assert.deepEqual(directories, { "usage.providers": 1, "usage.workspaces": 1, "usage.sessions": 1 });
  for (let i = 0; requestReads < 1 && i < 200; i++) await page.waitForTimeout(10);
  assert.equal(requestReads, 1, "first screen schedules one local monitoring prefetch");
  await page.waitForFunction(() => performance.getEntriesByType("resource").some(resource => /ProviderUsage-[^/]+\.js/.test(resource.name)));
  const preload = await page.evaluate(() => ({ shellAt: (window as any).usageShellAt, modules: performance.getEntriesByType("resource").filter(entry => /Provider(Requests|Usage)-[^/]+\.js/.test(entry.name)).map(entry => ({ name: new URL(entry.name).pathname, start: entry.startTime })) }));
  assert.equal(preload.modules.length, 2); assert.ok(preload.modules.every(entry => entry.start >= preload.shellAt), "later panels never delay the first screen");
  await page.evaluate(() => {
    let clicked: number | undefined;
    document.getElementById("usage-tab-requests")!.addEventListener("click", () => { clicked = performance.now(); }, { once: true });
    const observer = new MutationObserver(() => {
      if (clicked === undefined || !document.querySelector(".provider-requests tbody td")) return;
      observer.disconnect(); requestAnimationFrame(() => { (window as any).usageMonitorPaintMs = performance.now() - clicked!; });
    });
    observer.observe(document.getElementById("content")!, { childList: true, subtree: true });
  });
  const monitorStart = performance.now(); await page.getByRole("tab", { name: "请求监控", exact: true }).click();
  await page.locator(".provider-requests tbody tr").filter({ has: page.getByText("fixture", { exact: true }) }).locator("td").first().getByText("1", { exact: true }).waitFor();
  const monitorAutomationMs = performance.now() - monitorStart;
  await page.waitForFunction(() => typeof (window as any).usageMonitorPaintMs === "number");
  const prefetchedMonitorMs = await page.evaluate(() => (window as any).usageMonitorPaintMs as number);
  assert.equal(requestReads, 1, "fresh prefetched data is used without an immediate duplicate request");
  await page.getByRole("tab", { name: "用量概览", exact: true }).click();
  const pausedReads = requestReads; await page.waitForTimeout(1100); assert.equal(requestReads, pausedReads, "inactive tab does not poll"); assert.equal(officialReads, 0);
  // Deliberately separate asynchronous background preparation from warm page-read latency.
  // Cold eventual publication, source corrections and restart reuse are covered by usage-sidecar.test.ts.
  const preparationStart = performance.now(), timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  let prepared = await read({ analytics: true, timeZone });
  for (let i = 0; (prepared.building || prepared.count !== 20) && i < 400; i++) { await page.waitForTimeout(25); prepared = await read({ analytics: true, timeZone }); }
  assert.equal(prepared.count, 20); assert.equal(prepared.building, false);
  const backgroundPreparationMs = performance.now() - preparationStart;
  const loadStart = performance.now(); await page.getByRole("button", { name: "加载本机统计", exact: true }).click();
  await page.locator(".usage-totals strong").first().getByText("2.4K", { exact: true }).waitFor(); const firstDataMs = performance.now() - loadStart;
  assert.equal(ledgerReads, 1); assert.equal(filters.at(-1)?.refresh, false);
  await page.getByRole("tab", { name: "官方额度", exact: true }).click(); await page.getByText("请选择供应商", { exact: true }).last().waitFor();
  await page.getByRole("tab", { name: "用量概览", exact: true }).click(); assert.equal(ledgerReads, 1); assert.equal(officialReads, 0);
  const warmEntryMs: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto(app.origin + "/model-config.html"); directories = {};
    const before: number = ledgerReads, began = performance.now(); await page.goto(app.origin + "/model-usage.html");
    await page.locator(".usage-totals strong").first().getByText("2.4K", { exact: true }).waitFor(); warmEntryMs.push(performance.now() - began);
    await page.waitForFunction(() => !(document.getElementById("usage-session") as HTMLButtonElement)?.disabled);
    assert.equal(ledgerReads, before + 1); assert.equal(filters.at(-1)?.refresh, false);
    assert.deepEqual(directories, { "usage.providers": 1, "usage.workspaces": 1, "usage.sessions": 1 });
    assert.equal(await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem("axiom.usage.page.v1")!)).some(key => ["report", "account", "credentials"].includes(key))), false);
  }
  const sorted = [...warmEntryMs].sort((a, b) => a - b), p50 = sorted[2], p95 = sorted[4];
  const result = { coldShellMs, backgroundPreparationMs, firstDataMs, prefetchedMonitorMs, monitorAutomationMs, warmEntryMs, p50, p95, preload, ledgerReads, officialReads };
  writeFileSync("/tmp/axiom-usage-performance.json", JSON.stringify(result, null, 2)); console.log("PERFORMANCE", JSON.stringify(result));
  assert.ok(p95 < 500, `warm local entry exceeded 500ms: ${p95}`);
  assert.ok(prefetchedMonitorMs < 200, `prefetched click-to-paint exceeded 200ms: ${prefetchedMonitorMs}`);
  assert.deepEqual(errors, []); assert.equal(officialReads, 0); console.log("PASS isolated usage performance");
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
