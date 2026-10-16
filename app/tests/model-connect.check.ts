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

const root = mkdtempSync(join(tmpdir(), "axiom-model-connect-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
let catalogStatus = 200;
const catalogModel = builtinProviders().find((provider) => provider.id === "openai")!.getModels()[0];
const endpoint = createServer((req, res) => {
  assert.equal(req.url, "/proxy/v1/models");
  res.writeHead(catalogStatus, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: [{ id: catalogModel.id, name: "A known model" }, { id: "remote-fixture-model", name: "Unknown model" }] }));
});
await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
const endpointUrl = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/proxy/v1`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const sizes = [[360, 800], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]];
  const artifacts = resolve("test-results/model-polish");
  mkdirSync(artifacts, { recursive: true });
  const capture = async (label: string) => {
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow at ${width}`);
      assert.ok(await page.locator(".supplier-detail").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${label}: detail overflow at ${width}`);
      if (width <= 600 && label === "setup") {
        const action = await page.getByRole("button", { name: "浏览器登录", exact: true }).boundingBox();
        assert.ok(action && action.y + action.height < height, `OAuth action must fit first viewport at ${width}`);
      }
      if (width <= 600 && label === "models") {
        const search = await page.getByRole("searchbox", { name: "搜索当前供应商的模型" }).boundingBox();
        assert.ok(search && search.width >= width - 40, `model search must have its own row at ${width}`);
      }
      assert.equal(await page.locator('.topnav button').count(), 0, 'configuration actions must not be in the header');
      assert.equal(await page.locator('.configuration-actions button').count(), 3);
      assert.equal(await page.locator('.config-reload').innerText(), '', 'reload uses only an SVG');
      const panel = page.getByRole('tabpanel');
      if (await panel.count()) {
        const panelRect = await panel.boundingBox();
        const footerRect = await page.locator('.configuration-actions').boundingBox();
        assert.ok(panelRect && footerRect && footerRect.y >= panelRect.y + panelRect.height - 1, `${label}: actions below config at ${width}`);
      }
      await page.screenshot({ path: join(artifacts, `${label}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  page.on("pageerror", (error) => errors.push(error.message));
  // Only OAuth/browser launch is a UI fixture. Catalog, drafts and persistence use the real server.
  let seq = 0, opens = 0, loggedIn = false, configReads = 0, legacyCapabilities = true, failNext = false;
  const reads = new Set<string>();
  const startedProviders: string[] = [];
  let supportedProviders: { id: string; name: string }[] = [];
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    const auth = (data: unknown) => route.send(JSON.stringify({ type: "snapshot", scope: "authentication", streamId: "auth-ui-fixture", seq: ++seq, data }));
    const flow = { id: "fixture-flow", providerId: "openai", status: "running", message: "等待授权回填", url: "https://example.invalid/authorize?state=fixture", prompt: { id: "fixture-prompt", type: "manual_code", message: "粘贴回调地址" } };
    route.onMessage((message) => {
      const c = JSON.parse(message.toString()) as Command;
      const reply = (data: unknown) => route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
      if (c.op === "configuration.get") { reads.add(c.requestId); configReads++; }
      if (c.op === "auth.start") {
        assert.equal(c.params!.type, "oauth");
        flow.providerId = c.params!.providerId as string;
        startedProviders.push(flow.providerId);
        reply({ id: flow.id }); auth(flow);
      }
      else if (c.op === "auth.open") {
        opens++;
        assert.equal(c.params!.id, flow.id);
        assert.equal(c.params!.url, undefined);
        if (opens === 1) route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: "BROWSER_OPEN_FAILED", message: "无法打开系统浏览器，请复制授权链接手动打开。" } }));
        else reply({ opened: true });
      } else if (c.op === "auth.answer") {
        assert.equal(c.params!.answer, "http://localhost/callback?code=FIXTURE&state=fixture");
        loggedIn = true;
        reply({ accepted: true });
        auth(failNext ? { ...flow, status: "failed", message: "认证未完成，请关闭后重试。" } : { id: flow.id, providerId: "openai", status: "completed", message: "pi 已保存认证" });
      } else if (c.op === "auth.cancel") reply({ cancelled: true });
      else server.send(message);
    });
    server.onMessage((message) => {
      const event = JSON.parse(message.toString());
      if (event.type === "snapshot" && event.scope === "authentication") return;
      if (reads.delete(event.requestId) && event.data?.providers) {
        supportedProviders = event.data.templates.filter((template: { methods?: string[] }) => template.methods?.includes("oauth"));
        if (legacyCapabilities) for (const template of event.data.templates) delete template.methods;
        for (const provider of event.data.providers) if (loggedIn && provider.providerId === "openai") {
          provider.auth = { ...provider.auth, configured: true, source: "stored", type: "oauth" };
          provider.connectionType = "oauth";
        }
        route.send(JSON.stringify(event));
      } else route.send(message);
    });
  });
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  const menu = page.getByRole("menu", { name: "接入方式" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  await menu.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click();
  const setup = page.locator(".oauth-provider-setup");
  const providerSelect = setup.getByRole("combobox", { name: "供应商", exact: true });
  assert.ok(await providerSelect.isDisabled());
  assert.ok(await setup.getByRole("button", { name: "浏览器登录", exact: true }).isDisabled());
  await setup.getByText(/请更新或重启后台服务/).waitFor();
  legacyCapabilities = false;
  await page.reload();
  await page.locator("#add-supplier").click();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    mkdirSync(resolve("test-results"), { recursive: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(`test-results/model-add-menu-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.ok(await page.locator("#add-supplier").evaluate((el) => el === document.activeElement));
  await page.locator("#add-supplier").press("ArrowDown");
  await menu.waitFor();
  await page.keyboard.press("ArrowDown");
  assert.ok(await menu.getByRole("menuitem", { name: "自定义接口", exact: true }).evaluate((el) => el === document.activeElement));
  await page.locator(".configuration-feedback").click();
  await menu.waitFor({ state: "detached" });
  await page.locator("#add-supplier").click();
  await menu.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click();
  assert.deepEqual(await providerSelect.locator("option").evaluateAll((options) => options.map((option) => ({ id: (option as HTMLOptionElement).value, name: option.textContent }))), supportedProviders.map((provider) => ({ id: provider.id, name: `${provider.name} · ${provider.id}` })));
  assert.ok(supportedProviders.length > 2, "dropdown is populated from pi, not a fixed pair");
  await providerSelect.selectOption("openai");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator("#provider-key").count(), 0);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await setup.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: resolve(`test-results/model-add-${width}.png`) });
  }
  await capture("setup");
  await page.locator("#add-supplier").click();
  await menu.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  assert.ok(await page.locator("#provider-id").evaluate((el) => el === document.activeElement));
  await page.locator("#provider-id").fill("openai");
  await page.locator("#provider-url").fill(endpointUrl);
  await page.locator("#provider-protocol").selectOption(catalogModel.api);
  await capture("custom");
  await page.locator("#add-supplier").click();
  await menu.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click();
  assert.ok(await setup.getByRole("button", { name: "浏览器登录", exact: true }).isDisabled());
  await setup.getByRole("button", { name: "取消添加", exact: true }).click();
  assert.equal(await page.locator("#provider-id").inputValue(), "openai", "switching to OAuth preserves custom drafts");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#models-tab").click();
  await page.getByRole("button", { name: "拉取模型列表", exact: true }).click();
  const dialog = page.locator("#model-catalog-panel");
  assert.equal(await page.getByRole("dialog").count(), 0, 'catalog expands in the page');
  assert.equal(await page.getByRole('button', { name: '拉取模型列表', exact: true }).getAttribute('aria-expanded'), 'true');
  await dialog.getByText(/已从当前 Base URL 拉取模型列表/).waitFor();
  await dialog.getByText("输入能力待确认", { exact: false }).waitFor();
  const first = dialog.locator(".model-catalog-item").filter({ has: page.locator('input:not([disabled])') }).first();
  const selectedId = await first.locator("code").innerText();
  await first.getByRole("checkbox").check();
  const search = dialog.getByRole("searchbox");
  await search.fill("no-such-model-fixture");
  await dialog.getByText("没有匹配的模型，请调整搜索。").waitFor();
  assert.match(await dialog.innerText(), /已选 1 个/);
  await search.fill("");
  await capture("catalog");
  await search.fill(selectedId);
  mkdirSync(resolve("test-results"), { recursive: true });
  for (const [width, height] of [[360, 800], [390, 844], [820, 1180], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: resolve(`test-results/model-catalog-${width}.png`) });
  }
  await dialog.getByRole("button", { name: "加入配置（1）" }).click();
  assert.equal(await page.locator("#configured-model-table tbody tr").count(), 1);
  assert.equal(JSON.parse(readFileSync(join(root, "pi", "models.json"), "utf8")).providers.openai.models.length, 0);
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.ok(JSON.parse(readFileSync(join(root, "pi", "models.json"), "utf8")).providers.openai.modelOverrides[selectedId]);
  await page.getByRole("button", { name: "拉取模型列表", exact: true }).click();
  await dialog.getByText(/已从当前 Base URL 拉取模型列表/).waitFor();
  catalogStatus = 401;
  await dialog.getByRole("button", { name: "重新拉取", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "HTTP 401" }).waitFor();
  assert.equal(await dialog.locator(".model-catalog-item").count(), 0, "failed refresh must clear previous results");
  catalogStatus = 200;
  await dialog.getByRole("button", { name: "重新拉取", exact: true }).click();
  await dialog.getByText(/已从当前 Base URL 拉取模型列表/).waitFor();
  await dialog.getByRole("searchbox").fill(selectedId);
  assert.ok(await dialog.locator(".model-catalog-item").filter({ has: page.getByText(selectedId, { exact: true }) }).getByRole("checkbox").isDisabled());
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  // Closing restores focus in requestAnimationFrame, after the panel unmounts.
  await page.waitForFunction(button => button === document.activeElement,
    await page.getByRole("button", { name: "拉取模型列表", exact: true }).elementHandle());
  assert.ok(await page.getByRole("button", { name: "拉取模型列表", exact: true }).evaluate((el) => el === document.activeElement));

  await capture("models");
  const modelSearch = page.getByRole("searchbox", { name: "搜索当前供应商的模型" });
  await modelSearch.fill("no-matching-fixture");
  await page.locator(".model-empty").getByRole("button", { name: "清除搜索" }).click();
  assert.equal(await modelSearch.inputValue(), "");
  assert.ok(await modelSearch.evaluate((el) => el === document.activeElement));
  await page.getByRole("searchbox", { name: "搜索供应商", exact: true }).fill("no-matching-fixture");
  await page.locator(".list-empty").getByRole("button", { name: "清除搜索" }).click();
  assert.ok(await page.getByRole("searchbox", { name: "搜索供应商", exact: true }).evaluate((el) => el === document.activeElement));
  await page.locator("#configured-model-table tbody tr").first().hover();
  await page.locator("#configured-model-table button[aria-label^='编辑模型']").first().click();
  await capture("editor");
  await page.locator("#model-editor").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃当前模型编辑？" }).getByRole("button", { name: "确认", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#suppliers-tab").click();
  assert.equal(await page.getByRole("button", { name: "OAuth 登录", exact: true }).count(), 0, "custom interface has no OAuth login button");
  await page.locator("#add-supplier").click();
  await menu.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click();
  await providerSelect.selectOption("openai");
  await setup.getByRole("button", { name: "浏览器登录", exact: true }).click();
  const login = page.locator(".oauth-login-panel");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.ok(await page.locator("#add-supplier").isDisabled());
  assert.ok(await page.getByRole("button", { name: "重新读取配置", exact: true }).isDisabled());
  await login.getByRole("alert").filter({ hasText: "无法打开系统浏览器" }).waitFor();
  assert.equal(opens, 1);
  await login.getByRole("button", { name: "打开浏览器登录", exact: true }).click();
  await login.getByText(/已请求系统浏览器/).waitFor();
  assert.equal(opens, 2);
  for (const [width, height] of [[360, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await login.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: resolve(`test-results/model-oauth-${width}.png`) });
  }
  await capture("oauth");
  const beforeComplete = configReads;
  await login.locator("#auth-answer").fill("http://localhost/callback?code=FIXTURE&state=fixture");
  await login.getByRole("button", { name: "提交回填" }).click();
  await login.getByRole("button", { name: "关闭并刷新状态" }).waitFor();
  assert.equal(await page.locator("#provider-key, #provider-url, #provider-protocol").count(), 0);
  assert.ok(configReads > beforeComplete, "completion refreshes configuration before closing");
  assert.equal(await login.locator("#auth-answer").count(), 0);
  assert.equal(await login.locator("#oauth-url").count(), 0);
  await login.getByRole("button", { name: "关闭并刷新状态" }).click();
  await page.locator("#provider-auth-status").filter({ hasText: "已通过 OAuth 登录" }).waitFor();
  await page.locator("#add-supplier").click();
  await menu.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click();
  await providerSelect.selectOption("openai");
  await setup.getByRole("button", { name: "浏览器登录", exact: true }).click();
  await login.locator("#auth-answer").waitFor();
  assert.deepEqual(startedProviders, ["openai", "openai"]);
  await login.getByRole("button", { name: "取消登录", exact: true }).click();
  await login.waitFor({ state: "detached" });
  failNext = true;
  await page.locator("#add-supplier").click();
  await menu.getByRole("menuitem", { name: "OAuth 登录", exact: true }).click();
  await providerSelect.selectOption("openai");
  await setup.getByRole("button", { name: "浏览器登录", exact: true }).click();
  await login.locator("#auth-answer").fill("http://localhost/callback?code=FIXTURE&state=fixture");
  await login.getByRole("button", { name: "提交回填" }).click();
  await login.getByRole("alert").filter({ hasText: "认证未完成" }).waitFor();
  assert.equal(await login.locator("#auth-answer, #oauth-url").count(), 0, "terminal auth must hide even stale prompts and links");
  await capture("oauth-error");
  await login.getByRole("button", { name: "关闭并刷新状态" }).click();
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const touchPage = await touch.newPage();
    await touchPage.goto(app.origin + "/model-config.html");
    await touchPage.locator("#provider-key").waitFor();
    await touchPage.locator(".credential-details summary").tap();
    assert.equal(await touchPage.getByRole("button", { name: "API Key 登录", exact: true }).count(), 0);
    assert.ok(await touchPage.locator('#logout-provider').isVisible());
    for (const selector of ["#save-provider", "#reset-provider", ".config-reload", "#logout-provider", "#add-supplier", "#provider-key", ".credential-details summary"]) {
      const rect = await touchPage.locator(selector).boundingBox();
      assert.ok(rect && rect.height >= 44, `touch target: ${selector}`);
    }
    assert.ok(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const stickyHeader = await touchPage.locator(".topnav").boundingBox();
    assert.ok(stickyHeader && Math.abs(stickyHeader.y) <= 1, "touch header stays at viewport top after scrolling");
    await touchPage.locator("#provider-key").tap();
    const keyBox = await touchPage.locator("#provider-key").boundingBox();
    const headerBox = await touchPage.locator(".topnav").boundingBox();
    assert.ok(keyBox && headerBox && keyBox.y >= headerBox.y + headerBox.height, "focused credential field is not covered by sticky header");
    await touchPage.evaluate(() => window.scrollTo(0, 0));
    await touchPage.screenshot({ path: join(artifacts, "touch-390.png"), fullPage: true });
    await touchPage.locator("#provider-name").fill("长名称供应商用于检查移动端与桌面布局".repeat(4));
    await touchPage.locator("#models-tab").tap();
    await touchPage.locator("#configured-model-table button[aria-label^='编辑模型']").first().tap();
    await touchPage.locator("#new-model-id").fill("long-model-identifier-".repeat(7));
    await touchPage.locator("#new-model-name").fill("长模型名称用于检查文字换行".repeat(5));
    await touchPage.locator("#model-editor").getByRole("button", { name: "完成编辑", exact: true }).tap();
    for (const width of [360, 820, 1440]) {
      await touchPage.setViewportSize({ width, height: 900 });
      await touchPage.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `long text page overflow ${width}`);
      assert.ok(await touchPage.locator("#configured-model-table").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `long text table overflow ${width}`);
      assert.ok(await touchPage.locator(".supplier-option").first().evaluate((el) => {
        const card = el.getBoundingClientRect();
        const name = el.querySelector(".supplier-name")!.getBoundingClientRect();
        const status = el.querySelector("small")!.getBoundingClientRect();
        return name.top >= card.top && status.bottom <= card.bottom;
      }), `long supplier name must stay inside card ${width}`);
      await touchPage.screenshot({ path: join(artifacts, `long-text-${width}.png`), fullPage: true });
    }
  } finally { await touch.close(); }
  assert.deepEqual(errors, []);
  console.log("PASS: native catalog/search/selection/duplicates/draft/save, responsive inline catalog and bottom actions, OAuth automatic browser request/retry/manual callback/automatic status refresh (OAuth fixture).");
} finally {
  await browser.close();
  await app.close();
  endpoint.closeAllConnections();
  await new Promise<void>((resolve) => endpoint.close(() => resolve()));
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
