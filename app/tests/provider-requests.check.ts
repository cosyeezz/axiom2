import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-request-stats-ui-"));
const artifacts = mkdtempSync(join(tmpdir(), "axiom-request-stats-artifacts-"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: {
  alpha: { name: "同名连接", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [] },
  beta: { name: "同名连接", api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [] },
  long: { name: "供应商超长名称".repeat(50), api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [] },
} }));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  let reads = 0, ledgerReads = 0, officialReads = 0, fail = false;
  const snapshot = app.agents.pool.requests.snapshot.bind(app.agents.pool.requests);
  app.agents.pool.requests.snapshot = () => { reads++; if (fail) throw Error("fixture statistics unavailable"); return snapshot(); };
  app.usageLedger.read = async () => { ledgerReads++; throw Error("ledger should not load automatically"); };
  app.agents.models.usage = async () => { officialReads++; throw Error("official should not load automatically"); };
  const observe = (owner: string, id: string, provider: string, precision: "http" | "call" = "http") => app.agents.pool.requests.observe(owner,
    { type: "provider_request_stat", phase: "start", id, provider, precision });
  observe("a", "1", "alpha"); observe("b", "2", "alpha"); observe("c", "3", "beta", "call");
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } }), page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  // Plain browser source avoids tsx's injected __name helper in serialized functions.
  await page.addInitScript(`
    let visible = true;
    Object.defineProperty(document, "visibilityState", { get: () => visible ? "visible" : "hidden", configurable: true });
    window.setStatsVisible = next => { visible = next; document.dispatchEvent(new Event("visibilitychange")); };
    const Native = window.WebSocket, sockets = [], ids = new Set(), backlog = [];
    let hold = false, holdResponses = false;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        if (hold) throw Error("fixture disconnected");
        if (protocols === undefined) super(url); else super(url, protocols);
        // Do not close Vite's HMR socket: doing so reloads the document and resets hold.
        if (new URL(url, location.href).pathname === "/ws") sockets.push(this);
        this.addEventListener("message", event => {
          const data = JSON.parse(event.data);
          if (holdResponses && data.type === "receipt" && ids.has(data.requestId)) {
            event.stopImmediatePropagation(); backlog.push([this, event.data]);
          }
        });
      }
      send(data) {
        if (typeof data === "string") { const command = JSON.parse(data); if (command.op === "usage.requests") ids.add(command.requestId); }
        return super.send(data);
      }
    };
    window.holdStatsResponses = () => { holdResponses = true; };
    window.flushStatsResponses = () => {
      holdResponses = false;
      for (const [socket, data] of backlog.splice(0)) socket.dispatchEvent(new MessageEvent("message", { data }));
    };
    window.dropStatsConnection = () => { hold = true; sockets.forEach(socket => socket.close()); };
    window.resumeStatsConnection = () => { hold = false; window.dispatchEvent(new Event("online")); };
  `);
  await page.goto(app.origin + "/model-usage.html");
  await page.getByRole("tab", { name: "请求监控", exact: true }).click();
  const section = page.locator(".provider-requests"), alpha = section.locator("tbody tr").filter({ has: page.getByText("alpha", { exact: true }) });
  await alpha.locator("td").first().getByText("2", { exact: true }).waitFor();
  assert.deepEqual(await alpha.locator("td").allTextContents(), ["2", "2", "2"]);
  assert.equal(await section.locator("tbody tr").count(), 3, "independent official quota account is not an inference connection");
  assert.match(await section.innerText(), /beta · 含调用级统计/);
  app.agents.pool.requests.releaseOwner("a");
  await alpha.locator("td").first().getByText("1", { exact: true }).waitFor();
  assert.deepEqual(await alpha.locator("td").allTextContents(), ["1", "2", "2"]);
  await page.waitForTimeout(1100); assert.ok(reads >= 3); assert.equal(ledgerReads, 0); assert.equal(officialReads, 0);
  await page.evaluate(() => (window as any).setStatsVisible(false)); await page.waitForTimeout(150);
  const hiddenReads = reads; await page.waitForTimeout(1300); assert.equal(reads, hiddenReads, "hidden page must stop polling");
  await page.evaluate(() => { (window as any).holdStatsResponses(); (window as any).setStatsVisible(true); });
  await section.getByRole("status").getByText(/正在更新/).waitFor();
  await page.waitForTimeout(150); assert.ok(reads > hiddenReads);
  assert.equal(await section.getAttribute("data-stale"), "true", "resumed page stays stale until a new response arrives");
  await page.evaluate(() => (window as any).flushStatsResponses());
  await page.waitForFunction(() => !document.querySelector(".provider-requests")?.hasAttribute("data-stale"));
  fail = true; await section.getByRole("status").getByText(/更新失败/).waitFor();
  assert.deepEqual(await alpha.locator("td").allTextContents(), ["1", "2", "2"], "read errors retain old data");
  fail = false; await page.waitForFunction(() => !document.querySelector(".provider-requests")?.hasAttribute("data-stale"));
  await page.evaluate(() => (window as any).dropStatsConnection());
  await section.getByRole("status").getByText(/连接已断开/).waitFor();
  const disconnectedReads = reads; await page.waitForTimeout(1300); assert.equal(reads, disconnectedReads);
  app.agents.pool.requests.releaseOwner("b");
  await page.evaluate(() => (window as any).resumeStatsConnection());
  await alpha.locator("td").first().getByText("0", { exact: true }).waitFor();
  assert.deepEqual(await alpha.locator("td").allTextContents(), ["0", "2", "2"]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "narrow page must not overflow");
  const longRow = section.locator("tbody tr").filter({ has: page.getByText("long", { exact: true }) });
  assert.ok((await longRow.boundingBox())!.height < 115, "long supplier names must not create screen-height rows");
  assert.equal(await longRow.locator("th span").getAttribute("title"), "供应商超长名称".repeat(50));
  await section.screenshot({ path: join(artifacts, "narrow.png") });
  await page.setViewportSize({ width: 1280, height: 1000 }); await section.screenshot({ path: join(artifacts, "desktop.png") });
  assert.equal(await section.getByText("请求统计口径", { exact: true }).count(), 0, "mechanism prose is not displayed");
  assert.deepEqual(errors, []); assert.equal(ledgerReads, 0); assert.equal(officialReads, 0);
  await page.getByRole("combobox", { name: "供应商", exact: true }).click();
  await page.getByRole("option", { name: "供应商超长名称".repeat(50), exact: true }).click();
  assert.equal(await section.locator("tbody tr").count(), 1); assert.match(await section.innerText(), /long/);
  assert.deepEqual(await section.locator("tbody td").allTextContents(), ["0", "0", "0"]);
  await page.waitForTimeout(1250); assert.equal(ledgerReads, 0, "realtime provider selection never queries historical ledger");
  await page.getByRole("tab", { name: "用量概览", exact: true }).click();
  await page.waitForTimeout(150); const pausedReads = reads;
  await page.waitForTimeout(1250); assert.equal(reads, pausedReads, "leaving realtime tab stops polling");
  await page.evaluate(() => (window as any).holdStatsResponses());
  await page.getByRole("tab", { name: "请求监控", exact: true }).click();
  await section.locator("tbody tr").waitFor(); assert.equal(await section.locator("tbody tr").count(), 1, "monitor scope and last data survive unmount while revalidation is held");
  assert.deepEqual(await section.locator("tbody td").allTextContents(), ["0", "0", "0"]);
  await page.evaluate(() => (window as any).flushStatsResponses());
  assert.equal(ledgerReads, 0); assert.equal(officialReads, 0); assert.deepEqual(errors, []);
  console.log("PASS provider statistics polling, isolation, errors, hidden/disconnected pause, reconnect, narrow layout; artifacts", artifacts);
} finally {
  await browser?.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
