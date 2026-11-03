import { chooseSelect, assertSelectPosition } from "./select-helpers.js";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/server/index.js";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Command } from "../src/shared/protocol.js";
import { openAIProviderId } from "../src/shared/model-providers.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-connect-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
let catalogStatus = 200;
const catalogModel = builtinProviders().find(provider => provider.id === "openai")!.getModels()[0];
const endpoint = createServer((req, res) => {
  assert.equal(req.url, "/proxy/v1/models"); assert.equal(req.headers.authorization, "Bearer UI-FIXTURE-KEY");
  res.writeHead(catalogStatus, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: catalogModel.id, name: "A known model" }, { id: "remote-fixture-model", name: "Unknown model" }] }));
});
await new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve));
const endpointUrl = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/proxy/v1`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/model-polish"); mkdirSync(artifacts, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const capture = async (label: string) => {
    for (const [width, height] of [[360, 800], [390, 844], [820, 1180], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page fits ${width}`);
      assert.ok(await page.locator(".supplier-detail").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) {
        const rect = await dialog.boundingBox(); assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1);
      }
      assert.equal(await page.locator(".topnav button:not(.maintenance-launcher)").count(), 0);
      assert.equal(await page.locator(".configuration-actions button").count(), 3);
      await page.screenshot({ path: join(artifacts, `${label}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  // Only OAuth is intercepted. API-key login, native catalog and persistence use real isolated RPC.
  let seq = 0, opens = 0, loggedIn = false, configReads = 0, legacyCapabilities = true, failNext = false, flowNumber = 0;
  const reads = new Map<string, string>(), startedProviders: string[] = [], startedProxies: unknown[] = [];
  let supportedProviders: { id: string; name: string }[] = [];
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    const auth = (data: unknown) => route.send(JSON.stringify({ type: "snapshot", scope: "authentication", streamId: "auth-ui-fixture", seq: ++seq, data }));
    const flow = { id: "", providerId: openAIProviderId, status: "running", message: "等待授权回填", url: "https://example.invalid/authorize?state=fixture", prompt: { id: "fixture-prompt", type: "manual_code", message: "粘贴回调地址" } };
    route.onMessage(message => {
      const c = JSON.parse(message.toString()) as Command;
      const reply = (data: unknown) => route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
      if (c.op === "configuration.get" || c.op === "accounts.list") { reads.set(c.requestId, c.op); if (c.op === "configuration.get") configReads++; }
      if (c.op === "accounts.usage" && c.params?.accountId === "oauth-fixture-card") { reply({ providerId: openAIProviderId, status: "unsupported", metrics: [], refreshable: false }); return; }
      if (c.op === "auth.start" && c.params!.type === "oauth") {
        flow.id = `fixture-flow-${++flowNumber}`; flow.providerId = c.params!.providerId as string;
        assert.ok((c.params!.account as { label: string }).label);
        startedProviders.push(flow.providerId); startedProxies.push(c.params!.proxy);
        reply({ id: flow.id }); auth(flow);
      } else if (c.op === "auth.open" && c.params!.id === flow.id) {
        opens++; assert.equal(c.params!.url, undefined);
        if (opens === 1) route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: "BROWSER_OPEN_FAILED", message: "无法打开系统浏览器，请复制授权链接手动打开。" } }));
        else reply({ opened: true });
      } else if (c.op === "auth.answer" && c.params!.id === flow.id) {
        assert.equal(c.params!.answer, "http://localhost/callback?code=FIXTURE&state=fixture");
        loggedIn = true; reply({ accepted: true });
        auth(failNext ? { ...flow, status: "failed", message: "认证未完成，请关闭后重试。" } : { id: flow.id, providerId: flow.providerId, status: "completed", message: "pi 已保存认证" });
      } else if (c.op === "auth.cancel" && c.params!.id === flow.id) reply({ cancelled: true });
      else server.send(message);
    });
    server.onMessage(message => {
      const event = JSON.parse(message.toString()), kind = reads.get(event.requestId); reads.delete(event.requestId);
      if (event.type === "snapshot" && event.scope === "authentication" && flowNumber) return;
      if (kind === "configuration.get" && event.data?.providers) {
        supportedProviders = event.data.templates.filter((template: { methods?: string[] }) => template.methods?.includes("oauth"));
        if (legacyCapabilities) for (const template of event.data.templates) delete template.methods;
        if (loggedIn) {
          const template = event.data.templates.find((provider: { id: string }) => provider.id === openAIProviderId);
          event.data.providers.push({ ...event.data.providers[0], id: openAIProviderId, originalId: openAIProviderId, providerId: openAIProviderId, name: "OpenAI", api: template.api, url: template.url, models: [], proxy: { mode: "external", url: "http://127.0.0.1:17890" }, hasConnectionOverrides: false, connectionType: "oauth", auth: { configured: true, source: "stored", type: "oauth", methods: ["oauth"] } });
        }
      }
      if (kind === "accounts.list" && loggedIn && event.data?.accounts) event.data.accounts.push({ id: "oauth-fixture-card", providerId: openAIProviderId, label: "OAuth 界面账号", region: "", createdAt: Date.now(), active: true, type: "oauth" });
      route.send(JSON.stringify(event));
    });
  });
  await page.goto(app.origin + "/model-config.html");
  const menu = page.getByRole("menu", { name: "接入方式" }), setup = page.getByRole("dialog", { name: "添加账号", exact: true });
  const providerSelect = setup.getByRole("combobox", { name: "供应商", exact: true });
  const openSetup = async (label: string) => {
    await page.locator("#add-supplier").click(); await menu.getByRole("menuitem", { name: "添加账号", exact: true }).click();
    await setup.getByLabel("账号名称", { exact: true }).fill(label);
  };
  await openSetup("旧后台测试");
  assert.ok(await providerSelect.isDisabled()); assert.ok(await setup.getByRole("button", { name: "浏览器登录", exact: true }).isDisabled());
  await setup.getByText(/请更新或重启后台服务/).waitFor();
  legacyCapabilities = false; await page.reload();
  await page.locator("#add-supplier").click(); await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
  assert.ok(await page.locator("#add-supplier").evaluate(el => el === document.activeElement));
  await page.locator("#add-supplier").press("ArrowDown"); await page.keyboard.press("ArrowDown");
  assert.ok(await menu.getByRole("menuitem", { name: "自定义接口", exact: true }).evaluate(el => el === document.activeElement));
  await page.keyboard.press("Escape");
  await openSetup("OAuth 界面账号"); await providerSelect.click();
  const options = await page.getByRole("listbox", { name: "供应商", exact: true }).getByRole("option").evaluateAll(rows => rows.map(row => ({ id: row.getAttribute("data-value"), name: row.textContent })));
  assert.deepEqual(options, supportedProviders.filter(provider => provider.id !== "openai").map(provider => ({ id: provider.id, name: provider.name })));
  assert.equal(await page.getByRole("listbox").locator(`[data-value="${openAIProviderId}"]`).getAttribute("aria-selected"), "true");
  assert.ok(supportedProviders.length > 2);
  await assertSelectPosition(page, providerSelect); await page.keyboard.press("Escape"); await capture("setup");
  await setup.getByRole("button", { name: "取消添加", exact: true }).click();
  await page.locator("#add-supplier").click(); await menu.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("openai"); await page.locator("#provider-url").fill(endpointUrl);
  await chooseSelect(page, page.locator("#provider-protocol"), catalogModel.api); await capture("custom");
  await openSetup("草稿不能登录"); assert.ok(await setup.getByRole("button", { name: "浏览器登录", exact: true }).isDisabled());
  await setup.getByRole("button", { name: "取消添加", exact: true }).click();
  assert.equal(await page.locator("#provider-id").inputValue(), "openai");
  await page.locator("#save-provider").click(); await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#accounts-tab").click(); await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await setup.getByLabel("账号名称", { exact: true }).fill("接口账号");
  await chooseSelect(page, setup.getByRole("combobox", { name: "账号登录方式", exact: true }), "api_key");
  await setup.getByRole("button", { name: "API Key 登录", exact: true }).click();
  await page.locator("#auth-answer").fill("UI-FIXTURE-KEY"); await page.getByRole("button", { name: "提交认证输入", exact: true }).click();
  await page.getByRole("article", { name: "账号 接口账号", exact: true }).waitFor();
  await page.locator("#models-tab").click(); await page.getByRole("button", { name: "拉取模型列表", exact: true }).click();
  const catalog = page.locator("#model-catalog-panel");
  await catalog.getByText(/已从当前 Base URL 拉取模型列表/).waitFor(); await catalog.getByText("输入能力待确认", { exact: false }).waitFor();
  const first = catalog.locator(".model-catalog-item").filter({ has: page.locator("input:not([disabled])") }).first();
  const selectedId = await first.locator("code").innerText(); await first.getByRole("checkbox").check();
  await catalog.getByRole("searchbox").fill("no-such-model-fixture"); await catalog.getByText("没有匹配的模型，请调整搜索。").waitFor(); assert.match(await catalog.innerText(), /已选 1 个/);
  await catalog.getByRole("searchbox").fill(""); await capture("catalog");
  await catalog.getByRole("button", { name: "加入配置（1）" }).click();
  assert.equal(await page.locator("#configured-model-table tbody tr").count(), 1);
  const disk = () => JSON.parse(readFileSync(join(root, "pi", "models.json"), "utf8")).providers.openai;
  assert.equal(disk().models.length, 0);
  await page.locator("#save-provider").click(); await page.locator(".configuration-feedback[data-saved=true]").waitFor(); assert.ok(disk().modelOverrides[selectedId]);
  await page.getByRole("button", { name: "拉取模型列表", exact: true }).click(); await catalog.getByText(/已从当前 Base URL 拉取模型列表/).waitFor();
  catalogStatus = 401; await catalog.getByRole("button", { name: "重新拉取", exact: true }).click(); await catalog.getByRole("alert").filter({ hasText: "HTTP 401" }).waitFor();
  assert.equal(await catalog.locator(".model-catalog-item, .model-empty").count(), 0); assert.doesNotMatch(await catalog.innerText(), /0 个模型/);
  catalogStatus = 200; await catalog.getByRole("button", { name: "重新拉取", exact: true }).click(); await catalog.getByText(/已从当前 Base URL 拉取模型列表/).waitFor();
  await catalog.getByRole("searchbox").fill(selectedId); assert.ok(await catalog.locator(".model-catalog-item").filter({ has: page.getByText(selectedId, { exact: true }) }).getByRole("checkbox").isDisabled());
  await page.keyboard.press("Escape"); await catalog.waitFor({ state: "detached" });
  await page.waitForFunction(button => button === document.activeElement, await page.getByRole("button", { name: "拉取模型列表", exact: true }).elementHandle());
  await capture("models");
  await page.getByRole("searchbox", { name: "搜索当前供应商的模型" }).fill("no-match"); await page.locator(".model-empty").getByRole("button", { name: "清除搜索" }).click();
  await page.getByRole("searchbox", { name: "搜索供应商", exact: true }).fill("no-match"); await page.locator(".list-empty").getByRole("button", { name: "清除搜索" }).click();
  await page.locator("#configured-model-table tbody tr").first().hover(); await page.locator("#configured-model-table button[aria-label^='编辑模型']").first().click(); await capture("editor");
  await page.locator("#new-model-name").fill("Unsaved fixture rename"); await page.locator("#model-editor").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃当前模型编辑？" }).getByRole("button", { name: "放弃编辑", exact: true }).click();
  await openSetup("OAuth 界面账号"); await chooseSelect(page, providerSelect, openAIProviderId);
  const proxyMode = setup.getByRole("combobox", { name: "授权与模型代理", exact: true });
  await chooseSelect(page, proxyMode, "builtin"); await setup.getByRole("combobox", { name: "内置线路", exact: true }).waitFor();
  await chooseSelect(page, proxyMode, "external"); await setup.locator("#provider-proxy-url").fill("http://127.0.0.1:17890");
  await setup.getByRole("button", { name: "浏览器登录", exact: true }).click();
  const login = page.getByRole("dialog"); await login.getByRole("alert").filter({ hasText: "无法打开系统浏览器" }).waitFor(); assert.equal(opens, 1);
  assert.ok(await page.locator("#add-supplier").isDisabled());
  await login.getByRole("button", { name: "打开浏览器登录", exact: true }).click(); await login.getByText(/已请求系统浏览器/).waitFor(); assert.equal(opens, 2);
  await capture("oauth"); const beforeComplete = configReads;
  await login.locator("#auth-answer").fill("http://localhost/callback?code=FIXTURE&state=fixture"); await login.getByRole("button", { name: "提交回填", exact: true }).click();
  await page.getByRole("article", { name: "账号 OAuth 界面账号", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0); assert.ok(configReads > beforeComplete);
  assert.equal(await page.locator("#auth-answer, #oauth-url").count(), 0);
  await openSetup("取消测试账号"); await chooseSelect(page, providerSelect, openAIProviderId); await setup.getByRole("button", { name: "浏览器登录", exact: true }).click();
  await login.locator("#auth-answer").waitFor(); assert.deepEqual(startedProviders, [openAIProviderId, openAIProviderId]);
  assert.deepEqual(startedProxies, [{ mode: "external", url: "http://127.0.0.1:17890" }, undefined], "existing connection proxy is reused rather than overridden by account login");
  await login.getByRole("button", { name: "取消登录", exact: true }).click(); await login.waitFor({ state: "detached" });
  failNext = true; await openSetup("失败测试账号"); await chooseSelect(page, providerSelect, openAIProviderId); await setup.getByRole("button", { name: "浏览器登录", exact: true }).click();
  await login.locator("#auth-answer").fill("http://localhost/callback?code=FIXTURE&state=fixture"); await login.getByRole("button", { name: "提交回填", exact: true }).click();
  await login.getByRole("alert").filter({ hasText: "认证未完成" }).waitFor(); assert.equal(await login.locator("#auth-answer, #oauth-url").count(), 0);
  await capture("oauth-error"); await login.getByRole("button", { name: "关闭并刷新状态", exact: true }).click();
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const mobile = await touch.newPage(); await mobile.goto(app.origin + "/model-config.html?provider=openai");
    await mobile.getByRole("article", { name: "账号 接口账号", exact: true }).waitFor();
    for (const selector of ["#save-provider", "#reset-provider", ".config-reload", "#add-supplier", ".account-card-actions button"]) {
      for (const target of await mobile.locator(selector).all()) { const rect = await target.boundingBox(); assert.ok(rect && rect.height >= 44, selector); }
    }
    await mobile.locator("#suppliers-tab").tap(); await mobile.locator("#provider-name").fill("长名称供应商用于检查移动端与桌面布局".repeat(4));
    await mobile.locator("#models-tab").tap(); await mobile.locator("#configured-model-table button[aria-label^='编辑模型']").first().tap();
    await mobile.locator("#new-model-id").fill("long-model-identifier-".repeat(7)); await mobile.locator("#new-model-name").fill("长模型名称用于检查文字换行".repeat(5));
    await mobile.locator("#model-editor").getByRole("button", { name: "完成编辑", exact: true }).tap();
    for (const width of [360, 820, 1440]) {
      await mobile.setViewportSize({ width, height: 900 }); assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await mobile.locator("#configured-model-table").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await mobile.screenshot({ path: join(artifacts, `long-text-${width}.png`), fullPage: true });
    }
  } finally { await touch.close(); }
  assert.deepEqual(errors, []);
  console.log("PASS real API-key account/catalog/search/draft/save/error recovery, model layout/editor, modal OAuth native options/proxy inheritance/browser retry/completion/cancel/failure, mobile touch and long text.");
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close(); await app.close(); endpoint.closeAllConnections();
  await new Promise<void>(resolve => endpoint.close(() => resolve()));
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
