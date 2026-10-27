import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import { createServer as viteServer } from "vite";
import type { ModelConfiguration, ProviderDraft } from "../src/shared/models.js";

// Source Vite + simulated WS only: no real configuration, auth, catalog or model request.
const temporary = mkdtempSync(join(tmpdir(), "axiom-settings-computation-"));
const provider = (suffix: string): ProviderDraft => ({
  id: `perf-${suffix}`, originalId: `perf-${suffix}`, providerId: `perf-${suffix}`,
  name: `Provider ${suffix.toUpperCase()}`, api: "openai-completions", url: "https://fixture.invalid/v1",
  key: "", headers: [], body: [], auth: { configured: true, methods: [] },
  models: Array.from({ length: 200 }, (_, index) => ({
    key: `perf-${suffix}-${index}`, originalId: `perf-${suffix}-${index}`, id: `perf-${suffix}-${index}`,
    name: `Model ${suffix.toUpperCase()} ${index}`, levels: ["none"], input: ["text"], headers: [], body: [],
  })),
});
let configuration: ModelConfiguration = { revision: "revision-1", providers: [provider("a"), provider("b")], templates: [] };
const saves: ModelConfiguration[] = [];
const requests: string[] = [];
const server = httpServer();
const vite = await viteServer({ server: { middlewareMode: true, hmr: false }, appType: "spa", cacheDir: join(temporary, "vite") });
server.on("request", vite.middlewares);
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", socket => {
  socket.send(JSON.stringify({ type: "hello", streamId: "computation-fixture" }));
  socket.on("message", raw => {
    const message = JSON.parse(String(raw));
    requests.push(message.op);
    if (message.op === "subscribe" && message.params.scope === "configuration")
      socket.send(JSON.stringify({ type: "snapshot", streamId: "computation-fixture", seq: 1, scope: "configuration", data: {
        revision: configuration.revision, providerCount: 2, modelCount: 400, available: [], dataRoot: "/isolated-fixture",
      } }));
    let data: unknown = {};
    if (message.op === "configuration.get") data = configuration;
    if (message.op === "configuration.save") {
      saves.push(structuredClone(message.params));
      configuration = { ...configuration, ...structuredClone(message.params), revision: `revision-${saves.length + 1}` };
      data = { revision: configuration.revision };
    }
    socket.send(JSON.stringify({ type: "receipt", requestId: message.requestId, ok: true, data }));
  });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const pageErrors: string[] = [];
page.on("pageerror", error => pageErrors.push(String(error)));
await page.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.origin !== `http://127.0.0.1:${port}`) return route.abort();
  if (url.pathname === "/api/status") return route.fulfill({ json: { ready: true } });
  if (url.pathname === "/api/remote") return route.fulfill({ json: { urls: [], message: "fixture", error: "" } });
  return route.continue();
});
await page.addInitScript(() => {
  (window as any).__name = (value: unknown) => value;
  (window as any).__safeWork = { snapshots: 0, filters: 0, maps: 0 };
  (window as any).__safeProviderFilters = 0;
  (window as any).__safeFlagKeyChecks = 0;
  const includes = Array.prototype.includes;
  Array.prototype.includes = function (this: unknown[], value: unknown, fromIndex?: number) {
    if (this.length === 3 && this[0] === "clearKey" && this[1] === "keepUrl" && this[2] === "keep")
      (window as any).__safeFlagKeyChecks++;
    return includes.call(this, value, fromIndex);
  };
  const stringify = JSON.stringify;
  JSON.stringify = function (this: JSON, value, ...args) {
    if (Array.isArray(value) && value[0]?.id === "perf-a" && Array.isArray(value[0]?.models))
      (window as any).__safeWork.snapshots++;
    return (stringify as any).call(this, value, ...args);
  } as typeof JSON.stringify;
  for (const method of ["filter", "map"] as const) {
    const original = Array.prototype[method];
    (Array.prototype as any)[method] = function (...args: unknown[]) {
      if (method === "filter" && this[0]?.id === "perf-a" && Array.isArray(this[0]?.models))
        (window as any).__safeProviderFilters++;
      if (this[0]?.id?.startsWith("perf-") && this[0]?.levels && this[0]?.key)
        (window as any).__safeWork[method === "filter" ? "filters" : "maps"]++;
      return (original as any).apply(this, args);
    };
  }
});
const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const work = () => page.evaluate(() => ({ ...(window as any).__safeWork })) as Promise<{ snapshots: number; filters: number; maps: number }>;
const resetWork = async () => { await settle(); await page.evaluate(() => {
  (window as any).__safeWork = { snapshots: 0, filters: 0, maps: 0 };
  (window as any).__safeProviderFilters = 0;
}); };
const noWork = async (label: string) => { await settle(); assert.deepEqual(await work(), { snapshots: 0, filters: 0, maps: 0 }, label); };
const rows = page.locator("#models-screen tbody tr");
const waitRows = (length: number) => page.waitForFunction(count => document.querySelectorAll("#models-screen tbody tr").length === count, length);
const rowFor = (name: string) => rows.filter({ has: page.getByRole("button", { name: `编辑模型：${name}`, exact: true }) });
const edit = async (name: string) => {
  await rowFor(name).hover();
  await page.getByRole("button", { name: `编辑模型：${name}`, exact: true }).click();
};
const duplicate = async (name: string) => {
  await rowFor(name).hover();
  await page.getByRole("button", { name: `复制模型配置：${name}`, exact: true }).click();
};
const choose = (name: string) => page.locator(".supplier-option").filter({ hasText: name }).click();
const metrics: Record<string, unknown> = {};
let passed = false;
try {
  await page.goto(`http://127.0.0.1:${port}/model-config.html`);
  await page.waitForFunction(() => (document.querySelector("#provider-name") as HTMLInputElement)?.value === "Provider A");
  assert.equal(await rows.count(), 0, "first visit stays lazy");
  metrics.initialRead = await work();
  assert.equal((await work()).filters, 0, "empty model search reuses the source model list");
  metrics.initialProviderFilters = await page.evaluate(() => (window as any).__safeProviderFilters);
  assert.equal(metrics.initialProviderFilters, 0, "empty supplier search reuses the source provider list");
  assert.equal((await work()).snapshots, 1, "a loaded draft reuses its identical saved baseline snapshot");
  metrics.initialFlagKeyChecks = await page.evaluate(() => (window as any).__safeFlagKeyChecks);
  assert.equal(metrics.initialFlagKeyChecks, 0, "non-false draft values bypass flag-name checks");
  // Keep=false normalization must still return an unchanged draft to clean.
  await page.locator("#provider-key").fill("temporary-fixture-key");
  await page.locator("#provider-key").fill("");
  await page.locator("#provider-url").fill("https://temporary.invalid/v1");
  await page.locator("#provider-url").fill("https://fixture.invalid/v1");
  assert.equal(await page.locator("#save-provider").isDisabled(), true, "restored false flags do not leave a dirty draft");
  await page.getByRole("tab", { name: "模型配置" }).click();
  await waitRows(200);
  await page.evaluate(() => { (window as any).__firstRow = document.querySelector("#models-screen tbody tr"); });
  await resetWork();
  await page.getByRole("searchbox", { name: "搜索供应商" }).fill("Provider A");
  await noWork("supplier search neither serializes drafts nor rebuilds model rows");
  await page.getByRole("searchbox", { name: "搜索供应商" }).fill("");
  await noWork("clearing supplier search reuses model work");
  metrics.supplierSearch = await work();
  await rowFor("Model A 0").hover();
  await rowFor("Model A 0").getByRole("button", { name: "复制模型名称：Model A 0", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#models-screen caption")?.textContent?.includes("已复制模型名称"));
  await noWork("copy feedback does not remap the table");
  await page.getByRole("tab", { name: "连接配置" }).click();
  await resetWork();
  await page.locator("#provider-name").fill("Provider A edited");
  await settle();
  assert.deepEqual(await work(), { snapshots: 1, filters: 0, maps: 0 }, "provider edit recomputes only the changed draft snapshot");
  metrics.connectionEdit = await work();
  assert.equal(await page.evaluate(() => (window as any).__firstRow === document.querySelector("#models-screen tbody tr")), true, "hidden table keeps existing DOM");
  await page.getByRole("tab", { name: "模型配置" }).click();
  await edit("Model A 0");
  await page.locator("#new-model-name").fill("Draft A");
  await resetWork();
  await page.locator("#new-model-name").fill("Draft A second");
  await noWork("subsequent editor keystroke does not serialize provider drafts, filter models or remap rows");
  metrics.editorKeystroke = await work();
  metrics.providerFiltersOnEditor = await page.evaluate(() => (window as any).__safeProviderFilters);
  assert.equal(metrics.providerFiltersOnEditor, 0, "model editor input reuses the supplier filter");
  assert.equal(await page.locator("#new-model-name").evaluate(node => document.activeElement === node), true, "editor retains focus");
  await edit("Model A 1");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator("#new-model-name").inputValue(), "Draft A second", "stable callback retains current dirty-editor confirmation");
  await page.getByRole("tab", { name: "连接配置" }).click();
  await page.locator("#save-provider").click();
  await page.waitForFunction(() => (document.querySelector("#save-provider") as HTMLButtonElement)?.disabled && document.querySelector(".configuration-feedback[data-saved=true]"));
  assert.equal(saves.length, 1);
  assert.equal(saves[0].providers[0].models[0].name, "Draft A second", "unified save stages a hidden editor");
  assert.equal(saves[0].providers[1].models.length, 200, "unvisited provider models are preserved");
  await page.getByRole("tab", { name: "模型配置" }).click();
  await edit("Draft A second");
  await page.locator("#new-model-name").fill("Staged A");
  await choose("Provider B");
  await waitRows(200);
  assert.equal(await rowFor("Model B 0").count(), 1);
  await duplicate("Model B 0");
  await waitRows(201);
  await duplicate("Model B 0");
  await waitRows(202);
  assert.equal(await rowFor("Model B 0（复制 2）").count(), 1, "duplicate uses latest list rather than a stale closure");
  const deleteSecond = page.getByRole("button", { name: "删除模型：Model B 0（复制 2）", exact: true });
  await rowFor("Model B 0（复制 2）").hover();
  await deleteSecond.click();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await rows.count(), 202, "delayed real single-click confirmation can still be cancelled");
  await deleteSecond.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "删除草稿", exact: true }).click();
  await waitRows(201);
  await rowFor("Model B 0（复制）").hover();
  await page.getByRole("button", { name: "删除模型：Model B 0（复制）", exact: true }).dblclick();
  await waitRows(200);
  assert.equal(await rowFor("Model B 0").count(), 1, "deleting copies leaves current source and provider intact");
  await choose("Provider A edited");
  assert.equal(await rowFor("Staged A").count(), 1, "supplier switch staged the latest edited model");
  await page.getByRole("searchbox", { name: "搜索供应商" }).fill("  ");
  await page.waitForFunction(() => document.querySelectorAll(".supplier-option").length === 0);
  assert.equal(await rows.count(), 200, "supplier filtering does not discard the selected provider");
  await page.getByRole("searchbox", { name: "搜索供应商" }).fill("");
  await page.waitForFunction(() => document.querySelectorAll(".supplier-option").length === 2);
  await page.getByRole("searchbox", { name: "搜索当前供应商的模型" }).fill("  ");
  await waitRows(0);
  await page.getByRole("searchbox", { name: "搜索当前供应商的模型" }).fill("Staged A");
  await waitRows(1);
  await resetWork();
  await page.getByRole("searchbox", { name: "搜索当前供应商的模型" }).fill("");
  await waitRows(200);
  metrics.modelFiltersOnClear = (await work()).filters;
  assert.equal(metrics.modelFiltersOnClear, 0, "clearing model search reuses the complete source list");
  await page.locator("#save-provider").click();
  await page.waitForFunction(() => !!document.querySelector(".configuration-feedback[data-saved=true]"));
  assert.equal(saves.length, 2);
  assert.equal(saves[1].providers[0].models[0].name, "Staged A");
  assert.equal(saves[1].providers[1].models.length, 200);
  assert.equal(requests.filter(command => command === "configuration.catalog").length, 0);
  assert.deepEqual(pageErrors, []);
  passed = true;
  console.log(JSON.stringify({ result: "passed", modelsPerProvider: 200, metrics, saves: saves.length, requests }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(temporary, "failure.png"), fullPage: true });
  console.error(`Failure artifacts: ${temporary}`);
  throw error;
} finally {
  await browser.close();
  for (const socket of wss.clients) socket.terminate();
  await new Promise<void>(resolve => wss.close(() => resolve()));
  await vite.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (passed) rmSync(temporary, { recursive: true, force: true });
}
