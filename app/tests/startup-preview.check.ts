// Isolated acceptance checks for the real Connect page + dev-only mock bridge.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "/tmp/axiom-startup-preview-check-6316280f");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("dev/startup-preview/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { port: 0, strictPort: false } });
await server.listen();
const origin = new URL(server.resolvedUrls!.local[0]).origin;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors: string[] = [], external: string[] = [], passed: string[] = [];
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
async function scene(scenario = "update") {
  const page = await browser.newPage({ viewport: { width: 1120, height: 980 }, serviceWorkers: "block", reducedMotion: "reduce" });
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => { if (new URL(route.request().url()).origin === origin) await route.continue(); else { external.push(route.request().url()); await route.abort(); } });
  await page.clock.install(); await page.goto(`${origin}/?scenario=${scenario}`);
  await page.getByRole("heading", { name: "组件与运行环境", exact: true }).waitFor();
  await page.waitForFunction(() => { const value = document.querySelector('section[aria-label="后台服务更新"] .component-version-value'); return !!value?.textContent && value.textContent !== "正在读取…"; });
  return page;
}
async function capture(page: Page, filename: string) {
  await page.evaluate(async () => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.screenshot({ path: resolve(output, filename), fullPage: true });
}
async function clean(page: Page) { assert.deepEqual(await page.evaluate(() => (window as any).startupPreview.unexpected), []); await page.close(); }
async function calls(page: Page, name: string, action: string) { return page.evaluate(({ name, action }) => (window as any).startupPreview.calls.filter((call: any) => call.name === name && call.args.action === action).length, { name, action }); }
try {
  {
    const page = await scene();
    assert.equal(await page.locator(".startup-components > .component-card").count(), 4);
    assert.equal(await page.locator(".startup-component-card, .startup-component-grid, .startup-component-footer").count(), 0, "old custom card presentation is fully removed");
    for (const name of ["后台服务更新", "客户端更新", "运行时与 SDK", "远程连接环境"]) {
      const card = region(page, name);
      assert.equal(await card.count(), 1);
      assert.equal(await card.locator(":scope > .maintenance-panel-heading .maintenance-resource-icon > :is(.component-glyph, .component-kind-glyph)").count(), 1);
      assert.equal(await card.evaluate(node => getComputedStyle(node).borderTopWidth), "2px", "uses the built-in component surface without startup overrides");
    }
    assert.equal(await region(page, "运行时与 SDK").getByText("已就绪", { exact: true }).isVisible(), true);
    for (const width of [320, 390, 700, 701, 1024, 1120]) {
      await page.setViewportSize({ width, height: 980 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overview fits ${width}`);
    }
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [390, 1120]) { await page.setViewportSize({ width, height: 980 }); await capture(page, `overview-${theme}-${width}.png`); }
    }
    const runtime = region(page, "运行时与 SDK"), disclosure = runtime.locator(":scope > .component-secondary > summary");
    await disclosure.focus(); await page.keyboard.press("Enter");
    assert.equal(await runtime.getByText("v24.13.0", { exact: true }).isVisible(), true);
    for (const name of ["Node.js 运行环境", "npm 运行环境", "应用内 Pi 运行环境"]) assert.equal(await region(page, name).evaluate(node => node.classList.contains("component-card")), true);
    await page.keyboard.press("Escape");
    assert.equal(await disclosure.evaluate(node => document.activeElement === node && !(node.parentElement as HTMLDetailsElement).open), true, "Escape closes native supporting details and restores summary focus");
    await page.keyboard.press("Space");
    assert.equal(await runtime.getByText("npm", { exact: true }).isVisible(), true);
    await runtime.getByText("可选工具 · 终端 Pi", { exact: true }).click();
    await runtime.getByRole("button", { name: "安装终端 Pi", exact: true }).click();
    const confirm = runtime.getByRole("button", { name: "确认安装终端 Pi", exact: true }); await confirm.waitFor();
    await disclosure.click();
    assert.equal(await confirm.isVisible(), true, "confirmation never hides with supporting details");
    await runtime.locator(".component-confirmation").getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await disclosure.evaluate(node => document.activeElement === node), true, "cancel restores visible disclosure focus when the original nested trigger is hidden");
    await disclosure.click();
    await runtime.getByRole("button", { name: "安装终端 Pi", exact: true }).click(); await confirm.waitFor();
    await disclosure.click();
    await confirm.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    assert.equal(await calls(page, "axiom_update", "pi"), 1, "duplicate confirm cannot resubmit");
    assert.equal(await runtime.locator(':scope > .maintenance-resource-content .maintenance-task[data-status="running"]').isVisible(), true, "active Pi progress remains visible outside closed details");
    await page.clock.runFor(4500);
    assert.equal(await runtime.locator('.maintenance-task[data-status="running"]').count(), 0, "settled tasks leave no progress panel by existing design");
    await disclosure.click();
    assert.equal(await region(page, "终端 Pi").getByText("v1.1.1", { exact: true }).first().isVisible(), true, "completed mock install is reflected in installed version");
    await clean(page); passed.push("four built-in components without custom surfaces, nested environments, six widths, both themes, keyboard disclosure, SDK/optional CLI, constant feedback, duplicate confirmation");
  }
  {
    const page = await scene();
    await region(page, "远程连接环境").getByRole("button", { name: "准备", exact: true }).click();
    assert.equal(await region(page, "Tailscale安装维护").isVisible(), true);
    assert.equal(await region(page, "Node.js 与 npm安装维护").isVisible(), true);
    assert.equal(await region(page, "后台服务安装维护").isVisible(), true, "targeted environment prep preserves original maintenance entries");
    await clean(page); passed.push("Tailscale prep is additive, backend and Node maintenance preserved");
  }
  for (const scenario of ["latest", "stopped", "first", "missing", "downloading", "forbidden", "installFailure", "interrupted", "unknown", "readonly", "windows", "connectionFailure", "slowConnection"]) {
    const page = await scene(scenario), backend = region(page, "后台服务更新");
    if (scenario === "latest") assert.equal(await backend.getByText("已是最新版本", { exact: true }).isVisible(), true);
    if (scenario === "stopped") await page.locator('.connection-status-tag[data-state="stopped"]').waitFor();
    if (["first", "missing"].includes(scenario)) {
      const install = backend.getByRole("button", { name: "安装", exact: true }); await install.click();
      await page.clock.runFor(scenario === "first" ? 9500 : 5000);
      assert.equal(await calls(page, "axiom_setup", "service"), 1);
      assert.equal(await calls(page, "axiom_setup", "node"), scenario === "first" ? 1 : 0);
      await page.locator('.connection-status-tag[data-state="stopped"]').waitFor();
    }
    if (scenario === "downloading") {
      assert.equal(await backend.getByText(/模拟下载与安装/).first().isVisible(), true);
      assert.equal(await backend.getByRole("button", { name: "更新后台服务", exact: true }).getAttribute("aria-disabled"), "true");
    }
    if (scenario === "forbidden") assert.equal(await backend.getByText(/下载失败: HTTP 403/).first().isVisible(), true);
    if (scenario === "installFailure") assert.equal(await backend.getByText(/模拟安装器退出码 1/).first().isVisible(), true);
    if (scenario === "interrupted") {
      await backend.getByRole("button", { name: "核实并恢复", exact: true }).click();
      await page.clock.runFor(2200);
      assert.equal(await calls(page, "axiom_update", "reconcile"), 1);
      assert.equal(await calls(page, "axiom_update", "service"), 0, "reconcile does not restart install");
    }
    if (scenario === "unknown") {
      await page.locator('.connection-status-tag[data-state="unknown"]').waitFor();
      const update = backend.getByRole("button", { name: "更新后台服务", exact: true });
      assert.equal(await update.getAttribute("aria-disabled"), "true"); await update.focus(); await page.keyboard.press("Enter");
      assert.equal(await calls(page, "axiom_update", "service"), 0);
    }
    if (scenario === "readonly") assert.equal(await region(page, "运行时与 SDK").getByText("需要准备环境", { exact: true }).isVisible(), true);
    if (scenario === "windows") {
      const client = region(page, "客户端更新"); await client.getByRole("button", { name: "安装更新", exact: true }).click();
      assert.equal(await client.getByText(/将关闭本客户端并打开安装向导/).isVisible(), true);
      await client.getByRole("button", { name: "打开安装向导", exact: true }).click();
      assert.equal(await page.evaluate(() => (window as any).startupPreview.installerOpened), true);
    }
    if (["connectionFailure", "slowConnection"].includes(scenario)) {
      await page.getByRole("combobox", { name: "连接设备", exact: true }).click();
      await page.getByRole("option", { name: /模拟工作站/ }).click();
      await page.getByRole("button", { name: "连接工作台", exact: true }).click();
      if (scenario === "slowConnection") {
        await page.getByRole("combobox", { name: "连接设备", exact: true }).click();
        await page.getByRole("option", { name: /本地电脑/ }).click(); await page.clock.runFor(6500);
        assert.equal(await page.getByLabel("本地端口", { exact: true }).isVisible(), true);
        assert.equal(await page.locator("#preview-notice").textContent(), "", "late connection does not navigate or announce previous target");
      } else assert.equal(await page.getByText(/模拟连接失败/).first().isVisible(), true);
    }
    await clean(page); passed.push(scenario);
  }
  {
    const page = await scene("clientLegacy"); await region(page, "客户端更新").getByRole("link", { name: "下载本平台更新", exact: true }).click();
    assert.match(await page.locator("#preview-notice").textContent() || "", /已拦截外部链接/);
    await page.getByLabel("模拟场景", { exact: true }).selectOption("latest");
    await page.waitForURL(/scenario=latest/);
    await region(page, "后台服务更新").getByText("已是最新版本", { exact: true }).waitFor();
    assert.equal(await calls(page, "axiom_update", "service"), 0, "switching scenes creates isolated state");
    await clean(page); passed.push("external downloads blocked and scenario state reset");
  }
  {
    const page = await scene("downloading");
    const result = await page.evaluate(async () => {
      const invoke = (window as any).__TAURI_INTERNALS__.invoke;
      const before = await invoke("axiom_update", { action: "status" });
      const budgets = { ...before.budgets, totalMs: before.budgets.totalMs + 60_000 };
      await invoke("axiom_update", { action: "defaults", version: JSON.stringify({ budgets }) });
      const saved = await invoke("axiom_update", { action: "status" });
      await invoke("axiom_update", { action: "extend", version: JSON.stringify({ id: before.job.task.id, budgets }) });
      const extended = await invoke("axiom_update", { action: "status" });
      return { defaults: saved.budgets.totalMs === budgets.totalMs, oldTaskUnchanged: saved.job.task.budgets.totalMs === before.job.task.budgets.totalMs, extended: extended.job.task.budgets.totalMs === budgets.totalMs, idStable: extended.job.task.id === before.job.task.id };
    });
    assert.deepEqual(result, { defaults: true, oldTaskUnchanged: true, extended: true, idStable: true });
    await clean(page); passed.push("mock budget persistence and task-scoped extension contract");
  }
  {
    const page = await scene(), client = region(page, "客户端更新"), backend = region(page, "后台服务更新");
    const download = client.getByRole("button", { name: "下载客户端更新", exact: true });
    await download.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    assert.equal(await calls(page, "axiom_update", "client"), 1);
    await client.locator('.maintenance-task[data-status="running"]').waitFor();
    assert.equal(await backend.locator(".maintenance-task").count(), 0, "client progress never appears under backend");
    const disclosure = client.locator(":scope > .component-secondary > summary");
    await disclosure.click(); await disclosure.click();
    assert.equal(await client.locator(":scope > .maintenance-resource-content .maintenance-task").isVisible(), true);
    const before = Number(await client.getByRole("progressbar", { name: "当前下载进度" }).getAttribute("value"));
    await page.clock.runFor(2500);
    assert.ok(Number(await client.getByRole("progressbar", { name: "当前下载进度" }).getAttribute("value")) > before);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.setViewportSize({ width: 390, height: 980 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await capture(page, `client-download-${theme}-390.png`);
    }
    const id = await page.evaluate(async () => (await (window as any).__TAURI_INTERNALS__.invoke("axiom_update", { action: "status" })).job.task.id);
    await client.getByRole("button", { name: "取消任务", exact: true }).click();
    const cancelId = await page.evaluate(() => JSON.parse((window as any).startupPreview.calls.find((c: any) => c.name === "axiom_update" && c.args.action === "cancel").args.version).id);
    assert.equal(cancelId, id);
    await page.clock.runFor(10000);
    assert.equal(await client.getByRole("button", { name: "打开下载位置", exact: true }).count(), 0, "old completion timer cannot resurrect cancellation");
    await download.click(); await page.clock.runFor(10500);
    await client.getByText(/已下载 · 待手动安装/).waitFor();
    await client.getByRole("button", { name: "打开下载位置", exact: true }).click();
    assert.match(await page.locator("#preview-notice").textContent() || "", /未打开本机目录/);
    assert.equal(await client.getByText("v0.4.1", { exact: true }).isVisible(), true);
    assert.equal(await calls(page, "axiom_update", "installer"), 0);
    const history = await page.evaluate(async () => (await (window as any).__TAURI_INTERNALS__.invoke("axiom_update", { action: "history" })).tasks);
    assert.ok(history.some((task: any) => task.id === id && task.status === "cancelled"));
    assert.ok(history.some((task: any) => task.id !== id && task.status === "succeeded"));
    await clean(page); passed.push("client uses shared progress, real owner, incremental transfer, both themes, precise cancellation, fresh retry and manual-only ready");
  }
  {
    const page = await scene("clientForbidden"), client = region(page, "客户端更新");
    await client.getByRole("button", { name: "下载客户端更新", exact: true }).click(); await page.clock.runFor(2500);
    await client.getByText(/客户端下载失败（HTTP 403/).waitFor();
    const failedId = await client.locator('.maintenance-task[data-status="failed"]').getAttribute("data-task-id");
    await client.getByRole("button", { name: "下载客户端更新", exact: true }).click(); await page.clock.runFor(10500);
    await client.getByText(/已下载 · 待手动安装/).waitFor();
    const history = await page.evaluate(async () => (await (window as any).__TAURI_INTERNALS__.invoke("axiom_update", { action: "history" })).tasks);
    assert.ok(history.some((task: any) => task.id === failedId && task.status === "failed"));
    assert.ok(history.some((task: any) => task.id !== failedId && task.status === "succeeded"));
    assert.equal(await calls(page, "axiom_update", "client"), 2); await clean(page); passed.push("client 403 retains error evidence; retry creates a new task");
  }
  {
    const page = await scene("clientCancelFailure"), client = region(page, "客户端更新");
    await client.getByRole("button", { name: "取消任务", exact: true }).click();
    await client.getByText(/模拟取消失败/).waitFor();
    assert.equal(await client.locator('.maintenance-task[data-status="running"]').count(), 1);
    assert.equal(await calls(page, "axiom_update", "cancel"), 1); assert.equal(await calls(page, "axiom_update", "client"), 0);
    await client.getByRole("button", { name: "取消任务", exact: true }).click(); await page.clock.runFor(10500);
    assert.equal(await client.locator(".maintenance-task").count(), 0); await clean(page); passed.push("failed cancellation does not stop or resubmit the client task");
  }
  for (const scenario of ["windowsOlder", "clientOlder"]) {
    const page = await scene(scenario), client = region(page, "客户端更新");
    await client.getByText("v0.4.3 可更新", { exact: true }).waitFor();
    assert.equal(await client.getByRole("button", { name: "安装更新", exact: true }).count(), 0, "older cached package cannot mask a newer release");
    await client.getByRole("button", { name: "下载客户端更新", exact: true }).click(); await page.clock.runFor(11000);
    await client.getByText(scenario === "windowsOlder" ? "v0.4.3 待安装" : "v0.4.3 已下载 · 待手动安装", { exact: true }).waitFor();
    assert.equal(await client.getByText("v0.4.1", { exact: true }).isVisible(), true);
    assert.equal(await calls(page, "axiom_update", "installer"), 0);
    await clean(page); passed.push(scenario);
  }
  for (const scenario of ["clientPending", "clientReady", "clientNoAsset", "clientDownloading", "windowsDownload"]) {
    const page = await scene(scenario), client = region(page, "客户端更新");
    if (["clientPending", "windowsDownload"].includes(scenario)) {
      await client.getByRole("button", { name: "下载客户端更新", exact: true }).click();
      if (scenario === "clientPending") {
        await client.getByText(/更新状态不完整/).waitFor();
        assert.equal(await client.getByRole("button", { name: "下载客户端更新", exact: true }).getAttribute("aria-disabled"), "true");
      }
      await page.clock.runFor(11000); assert.equal(await calls(page, "axiom_update", "client"), 1);
    }
    if (scenario === "clientNoAsset") {
      assert.equal(await client.getByRole("button", { name: "下载客户端更新", exact: true }).count(), 0);
      const refused = await page.evaluate(async () => {
        const invoke = (window as any).__TAURI_INTERNALS__.invoke;
        try { await invoke("axiom_update", { action: "client", version: "0.4.2" }); return false; } catch { return (await invoke("axiom_update", { action: "status" })).job === null; }
      }); assert.equal(refused, true);
    } else if (scenario === "clientDownloading") assert.equal(await client.locator('.maintenance-task[data-status="running"]').isVisible(), true);
    else if (scenario === "windowsDownload") {
      await client.getByRole("button", { name: "安装更新", exact: true }).waitFor();
      assert.equal(await calls(page, "axiom_update", "installer"), 0, "MSI download never auto launches installer");
    } else {
      await client.getByText(/已下载 · 待手动安装/).waitFor();
      assert.equal(await client.getByRole("button", { name: "安装更新", exact: true }).count(), 0);
      const rejected = await page.evaluate(async () => { try { await (window as any).__TAURI_INTERNALS__.invoke("axiom_update", { action: "installer" }); return false; } catch { return true; } });
      assert.equal(rejected, true); assert.equal(await page.evaluate(() => (window as any).startupPreview.installerOpened), false);
    }
    await clean(page); passed.push(scenario);
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed, errors, external }, null, 2));
  console.log(JSON.stringify({ passed, errors, external, output }, null, 2));
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: String(error), stack: error instanceof Error ? error.stack : null, passed, errors, external }, null, 2));
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, `failure-${index}.txt`), await page.locator("body").innerText().catch(() => "page unavailable"));
  }
  throw error;
} finally { await browser.close(); await server.close(); }
