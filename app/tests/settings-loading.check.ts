import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import type { ModelConfiguration } from "../src/shared/models.js";

// No production service, user data, model calls or online font downloads.
const server = await createServer({ configFile: resolve("vite.config.ts"), server: { host: "127.0.0.1", port: 0, hmr: false } });
await server.listen();
const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const isCatalogData = (url: string) => new URL(url).pathname.endsWith("/font-catalog.json") && !new URL(url).searchParams.has("url");
const config: ModelConfiguration = { revision: "fixture-1", templates: [], providers: [{
  id: "fixture", originalId: "fixture", providerId: "fixture", name: "加载测试供应商", connectionType: "custom", api: "openai-completions", url: "http://127.0.0.1:1/v1", key: "", headers: [], body: [],
  models: Array.from({ length: 200 }, (_, i) => ({ key: `m-${i}`, id: `m-${i}`, name: `模型 ${i}`, levels: ["none"], input: ["text"], headers: [], body: [] })),
}] };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = [], requests: string[] = [], commands: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/status") return route.fulfill({ json: { ready: true } });
    if (url.pathname === "/api/remote") return route.fulfill({ json: { urls: [], message: "测试", error: "" } });
    return route.continue();
  });
  await page.routeWebSocket("**/ws", ws => {
    ws.send(JSON.stringify({ type: "hello", streamId: "fixture" }));
    ws.onMessage(message => {
      const c = JSON.parse(String(message)); commands.push(c.op);
      if (c.op === "subscribe" && c.params.scope === "configuration") ws.send(JSON.stringify({ type: "snapshot", streamId: "fixture", seq: 1, scope: "configuration", data: { revision: config.revision, providerCount: 1, modelCount: 200, available: [], dataRoot: "/isolated-fixture" } }));
      ws.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data: c.op === "configuration.get" ? config : {} }));
    });
  });
  await page.goto(origin + "/settings.html");
  await page.locator("#model-config-summary").filter({ hasText: "1 个供应商" }).waitFor();
  assert.ok(!requests.some(url => /online-fonts|font-catalog|FontSettings/.test(url)), "overview must not import the font browser/catalog");
  await page.evaluate(() => window.dispatchEvent(new Event("axiom:font-scale")));
  await page.locator(".font-scale-feedback").waitFor({ state: "visible" });
  await page.locator(".font-scale-feedback button").click();

  await page.goto(origin + "/model-config.html");
  await page.locator("#provider-name").waitFor();
  assert.equal(await page.locator("#configured-model-table").count(), 0, "hidden model rows are not mounted initially");
  await page.locator("#models-tab").click();
  await page.locator("#configured-model-table").waitFor();
  assert.equal(await page.locator("#configured-model-table tbody tr").count(), 200);
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("unsaved-model");
  await page.locator("#suppliers-tab").click();
  await page.locator("#models-tab").click();
  assert.equal(await page.locator("#new-model-id").inputValue(), "unsaved-model", "first-visit laziness must not discard drafts on later tab switches");
  assert.ok(!requests.some(url => /online-fonts|font-catalog/.test(url)));
  assert.equal(commands.filter(op => op === "configuration.get").length, 1);
  assert.ok(!commands.includes("configuration.catalog"), "provider catalog remains an explicit user action");

  // Leave the intentionally dirty model editor through its native navigation confirmation.
  page.on("dialog", dialog => void dialog.accept());
  await page.goto(origin + "/display.html");
  await page.getByRole("button", { name: "浏览字体库", exact: true }).waitFor();
  assert.ok(!requests.some(isCatalogData), "display controls do not load the online catalog before opening it");
  await page.getByRole("button", { name: "浏览字体库", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".font-row").length === 60);
  assert.ok(requests.some(isCatalogData));
  const count = requests.filter(isCatalogData).length;
  await page.getByRole("button", { name: "关闭字体库", exact: true }).click();
  await page.getByRole("button", { name: "浏览字体库", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".font-row").length === 60);
  assert.equal(requests.filter(isCatalogData).length, count, "reopening reuses the loaded versioned catalog");

  let failureStatus = 503;
  let releaseCatalog: (() => void) | undefined;
  let delayCatalog = false;
  await page.route(url => isCatalogData(url.href), async route => {
    if (failureStatus) return route.fulfill({ status: failureStatus, headers: { "Cache-Control": "no-store" }, body: "fixture failure" });
    if (delayCatalog) {
      await new Promise<void>(resolve => { releaseCatalog = resolve; });
      // Deliberately different old data makes a stale response overwrite observable.
      return route.fulfill({ json: { googleFontsCommit: "stale-fixture", fonts: [] } });
    }
    return route.continue();
  });
  for (const recovery of ["retry", "reopen"] as const) {
    failureStatus = recovery === "retry" ? 503 : 404;
    await page.reload();
    await page.getByRole("button", { name: "浏览字体库", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "字体目录加载失败" }).waitFor();
    assert.ok(await page.getByRole("button", { name: "导入本地字体", exact: true }).isEnabled());
    failureStatus = 0;
    if (recovery === "retry") await page.getByRole("button", { name: "重试字体目录", exact: true }).click();
    else {
      await page.getByRole("button", { name: "关闭字体库", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "重试字体目录", exact: true }).count(), 0, "closed library must not show an inoperative retry");
      await page.getByRole("button", { name: "浏览字体库", exact: true }).click();
    }
    await page.waitForFunction(() => document.querySelectorAll(".font-row").length === 60);
  }
  delayCatalog = true;
  await page.reload();
  const pendingCatalog = page.waitForRequest(request => isCatalogData(request.url()));
  await page.getByRole("button", { name: "浏览字体库", exact: true }).click();
  await pendingCatalog;
  // Wait for the route handler, not just the request event, before closing.
  const routeDeadline = Date.now() + 10_000;
  while (!releaseCatalog) {
    assert.ok(Date.now() < routeDeadline, "catalog route handler did not start within 10 seconds");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await page.getByRole("button", { name: "关闭字体库", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  delayCatalog = false;
  const freshRequest = page.waitForRequest(request => isCatalogData(request.url()));
  await page.getByRole("button", { name: "浏览字体库", exact: true }).click();
  await freshRequest;
  await page.waitForFunction(() => document.querySelectorAll(".font-row").length === 60);
  const catalogResponse = page.waitForResponse(response => isCatalogData(response.url()));
  releaseCatalog();
  await (await catalogResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await page.locator(".font-row").count(), 60, "late old empty catalog must not overwrite the reopened library's fresh response");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, viewport: "390x844", models: 200, catalogRequests: count, checks: ["no catalog on settings/models/display entry", "shared scale feedback", "lazy model rows", "draft retained across tabs", "font catalog on demand and reused", "503 retry", "404 close and reopen", "close during loading", "no automatic provider catalog fetch"] }));
} finally { await browser.close(); await server.close(); }
