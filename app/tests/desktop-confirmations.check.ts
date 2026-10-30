// Actual desktop React pages with synthetic IPC only. Never invokes a native helper.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";
import { assertComponentTree, ensureComponentActions } from "./component-layout-helpers.js";
const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/desktop-confirmations");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [], passed: string[] = [];
async function scene(options: { recovery?: boolean; interrupted?: boolean; legacyRecovery?: boolean; installer?: boolean; histories?: boolean; clientFailure?: boolean; serviceFailure?: boolean } = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(options => {
    const task = (kind: string, status = "succeeded") => ({ id: "fixture-" + kind, attemptId: "fixture-attempt", endpoint: "desktop", scope: "界面合成测试，无真实操作", resource: kind, label: kind, action: kind, status, phase: "installing", steps: ["installing"], completedSteps: 1, createdAt: Date.now(), updatedAt: Date.now(), budgets: { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 }, capabilities: { cancel: false, extend: false } });
    const state = {
      calls: [] as { name: string; action?: string; version?: string | null; confirmed?: boolean }[], unexpected: [] as string[],
      makeTask: task,
      updateOverrides: {} as Record<string, unknown>, serviceState: "running", setupCheckFails: false,
      stopped: false, clientVersion: "0.4.1", recovery: !!options.recovery, job: null as any,
      setupJob: options.interrupted ? { id: "fixture-node", action: "node", running: false, phase: "interrupted", message: "安装器状态待核实", lines: [], task: task("node", "interrupted") } : null as any,
      removal: null as any,
    };
    (window as any).desktopConfirmFixture = state;
    let theme = "dark", revision = 0;
    const snapshot = () => ({ clientVersion: state.clientVersion, serviceVersion: "0.4.1", managed: true, clientSupported: true, release: { version: "0.4.2", checkedAt: Date.now(), assets: { "Axiom2.msi": { url: "https://example.invalid/Axiom2.msi" } } }, clientInstaller: { version: "0.4.2", readyAt: 1 }, job: state.job, recovery: state.recovery, log: "C:/fixture/update.log", pi: { runtimeVersion: "1.1.0", cli: { version: "1.1.0", packageRoot: "C:/fixture/npm/pi" }, release: { version: "1.1.1", checkedAt: 1, token: "pi-token" }, removal: state.removal }, ...state.updateOverrides });
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_theme" && args.action === undefined) { if (args.theme) { theme = args.theme; revision++; } return { theme, revision }; }
      if (name === "axiom_service" && ["status", "stop"].includes(args.action)) { if (args.action === "stop") state.stopped = true; return { desktopView: "control", state: state.stopped ? "stopped" : state.serviceState, active: ["设计会话", "代码检查"], url: "http://127.0.0.1:4317/" }; }
      if (name === "axiom_peers" && args.action === undefined) return { peers: [] };
      if (name === "axiom_setup") {
        if (args.action === "history") return { tasks: options.histories ? [{ ...task("service", "interrupted"), id: "old-setup-service" }] : [] };
        if (args.action === "check") { if (state.setupCheckFails) throw Error("环境检查合成失败"); return { nodeReady: true, nodeVersion: "v24.13.0", writable: true, tailscale: true, platform: "windows" }; }
        if (args.action === "status") return { job: state.setupJob };
        if (args.action === "acknowledge-interruption") { if (args.confirmed !== true) throw Error("缺少人工确认"); state.setupJob = { ...state.setupJob, phase: "error", message: "旧版安装失败证据", task: options.legacyRecovery ? undefined : task("node", "failed") }; return { job: state.setupJob }; }
      }
      if (name === "axiom_update") {
        if (args.action === "history") return { tasks: options.histories ? [{ ...task("pi", "unknown"), id: "old-update-pi" }, { ...task("pi", "failed"), id: "old-update-pi-failed", error: { code: "operation", phase: "installing", message: "此前Pi安装合成失败" } }] : [], error: options.histories ? "合成旧记录损坏，原证据保留。" : null };
        if (args.action === "client" && options.clientFailure) throw Error("客户端下载合成失败");
        if (args.action === "service" && options.serviceFailure) throw Error("服务更新合成拒绝");
        if (["status", "check", "pi-refresh", "pi-check"].includes(args.action)) return snapshot();
        if (["service", "recover", "installer"].includes(args.action)) { state.job = { kind: args.action, running: false, phase: "complete", message: "合成提交完成", task: task(args.action) }; return snapshot(); }
        if (args.action === "pi-remove-preview") {
          state.removal = { installed: true, token: "removal-token", version: "1.1.0", packageRoot: "C:/fixture/npm/pi", items: [{ label: "程序目录", path: "C:/fixture/npm/pi", state: "remove" }, { label: "个人设置", path: "C:/fixture/settings", state: "retain" }] };
          state.job = { kind: args.action, running: false, phase: "complete", message: "已核对", task: task(args.action) }; return snapshot();
        }
        if (args.action === "pi-uninstall") { state.removal.token = null; state.job = { kind: args.action, running: false, phase: "complete", message: "合成卸载完成", task: task(args.action), cleanup: { complete: true, items: [] } }; return snapshot(); }
      }
      if (name === "axiom_cleanup" && args.action === undefined && ["resources.get", "rea.get", "rtk.get", "opencli.get", "modelProxy.get"].includes(args.request?.op)) return { requestId: args.request.requestId, data: { revision: "empty-fixture", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
      if (name === "axiom_environment" && args.action === undefined) return null;
      if (name === "axiom_reveal_path" && args.action === undefined) return null;
      state.unexpected.push(name + ":" + args.action); throw Error("Unexpected IPC " + name + ":" + args.action);
    } };
  }, options);
  await page.clock.install(); await page.goto(server.resolvedUrls!.local[0]);
  await page.getByRole("button", { name: "关闭", exact: true }).waitFor();
  return page;
}
async function count(page: Page, name: string, action: string) { return page.evaluate(({ name, action }) => (window as any).desktopConfirmFixture.calls.filter((call: any) => call.name === name && call.action === action).length, { name, action }); }
async function checkUnexpected(page: Page) { assert.deepEqual(await page.evaluate(() => (window as any).desktopConfirmFixture.unexpected), []); }
async function expandPreparation(page: Page) {
  const summary = page.locator(".startup-preparation > summary");
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}
async function updates(page: Page) {
  const region = page.getByRole("region", { name: "版本与更新", exact: true });
  await region.waitFor();
  assert.equal(await region.locator(".update-component").count(), 3, "all three update component headers remain visible without opening technical details");
  assert.equal(await region.locator(".component-details-toggle").count(), 0, "no question-mark disclosure remains");
  for (const card of await region.locator(".update-component").all()) {
    assert.equal(await card.locator(":scope > .maintenance-panel-heading h3").isVisible(), true);
    const secondary = card.locator(":scope > .component-secondary");
    if (await secondary.count() && !await secondary.evaluate(element => (element as HTMLDetailsElement).open)) await secondary.locator(":scope > summary").click();
    await ensureComponentActions(card); await assertComponentTree(card);
  }
  const sdk = region.getByRole("region", { name: "后台服务更新", exact: true }).getByRole("region", { name: "后台服务的应用内 Pi 环境", exact: true });
  assert.equal(await sdk.getByRole("heading", { name: "应用内 Pi", exact: true }).isVisible(), true);
  assert.match(await sdk.locator(":scope > .maintenance-panel-heading .component-card-version").innerText(), /当前\s+v1\.1\.0/);
  assert.equal(await sdk.getByText(/此为应用内实际引擎版本/).isVisible(), true, "environment ownership remains explicit after opening supporting information");
  assert.ok(await region.getByRole("region", { name: "终端 Pi", exact: true }).getByText("独立使用的 Pi 命令行程序", { exact: true }).isVisible());
}
try {
  {
    const page = await scene();
    const pi = page.getByRole("region", { name: "终端 Pi", exact: true });
    const secondary = pi.locator(":scope > .component-secondary");
    for (const status of ["running", "failed", "unknown", "interrupted"]) {
      await page.evaluate(status => {
        const state = (window as any).desktopConfirmFixture;
        state.job = { kind: "pi", running: status === "running", phase: status === "running" ? "installing" : status === "failed" ? "error" : "interrupted", reconciled: false, message: `折叠回归 ${status}`, task: { ...state.makeTask("pi", status), capabilities: { cancel: true, extend: true }, message: `折叠回归 ${status}`, ...(status === "failed" ? { error: { code: "operation", phase: "installing", message: "折叠后仍可见的合成错误" } } : {}) } };
      }, status);
      await page.clock.runFor(2100);
      const task = pi.locator(`.maintenance-task[data-status="${status}"]`); await task.waitFor();
      assert.equal(await secondary.evaluate(element => (element as HTMLDetailsElement).open), false, "polling does not force secondary explanations open");
      assert.equal(await task.isVisible(), true, "necessary task feedback is outside supporting disclosure");
      if (status === "running") {
        assert.equal(await task.getByRole("button", { name: "取消任务", exact: true }).isVisible(), true);
        await task.locator(".maintenance-task-details > summary").click();
        assert.equal(await task.getByRole("button", { name: "延长本次时限", exact: true }).isVisible(), true);
      } else if (status === "failed") assert.equal(await task.getByRole("alert").isVisible(), true);
      else assert.equal(await pi.getByRole("button", { name: "核实并恢复", exact: true }).isVisible(), true);
    }
    assert.equal(await count(page, "axiom_update", "pi"), 0);
    assert.equal(await count(page, "axiom_update", "cancel"), 0);
    assert.equal(await count(page, "axiom_update", "extend"), 0);
    await checkUnexpected(page); await page.close(); passed.push("folded supporting information never hides active/failed/unknown/interrupted tasks, cancellation, extension or read-only reconciliation; polling does not reopen details or replay work");
  }
  {
    const page = await scene();
    await page.evaluate(() => {
      const state = (window as any).desktopConfirmFixture;
      state.clientVersion = "0.4.19"; state.serviceState = "unmanaged";
      state.updateOverrides = { clientSupported: false, foregroundSupported: false, clientPlatform: "darwin", clientAsset: "Axiom2.dmg", clientCheckedAt: 1, clientInstaller: null,
        release: { version: "0.4.21", checkedAt: 1, assets: {} }, clientRelease: { version: "0.4.19", checkedAt: 1, assets: { "Axiom2.dmg": { url: "https://github.com/cosyeezz/axiom2/releases/download/v0.4.19/Axiom2.dmg" } } } };
    });
    await page.clock.runFor(4500);
    const client = page.getByRole("region", { name: "客户端更新", exact: true });
    assert.match(await client.innerText(), /macOS 客户端.*v0.4.19.*本平台已是最新版本/s);
    assert.doesNotMatch(await client.innerText(), /0.4.21/);
    const backend = page.getByRole("region", { name: "后台服务更新", exact: true });
    assert.equal(await backend.getByRole("button", { name: "更新后台服务", exact: true }).isDisabled(), true);
    assert.match(await backend.innerText(), /端口被非托管后台占用/); assert.match(await backend.innerText(), /不会自动停止或覆盖/);
    assert.equal(await backend.getByRole("link", { name: "查看安装与更新方式" }).count(), 1);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      const colors = await client.locator(".client-platform-status").evaluate(el => ({ own: getComputedStyle(el).color, parent: getComputedStyle(el.parentElement!).color }));
      assert.equal(colors.own, colors.parent, "update notice uses neutral body color, not yellow accent");
      await page.screenshot({ path: resolve(output, `platform-mac-${theme}-390.png`), fullPage: true });
    }
    await page.evaluate(() => { const state = (window as any).desktopConfirmFixture; state.updateOverrides.clientRelease.version = "0.4.22"; state.updateOverrides.clientRelease.assets["Axiom2.dmg"].url = "https://github.com/cosyeezz/axiom2/releases/download/v0.4.22/Axiom2.dmg"; });
    await page.clock.runFor(2100);
    assert.equal(await client.getByRole("link", { name: "下载本平台更新" }).getAttribute("href"), "https://github.com/cosyeezz/axiom2/releases/download/v0.4.22/Axiom2.dmg");
    await page.evaluate(() => { const state = (window as any).desktopConfirmFixture; state.updateOverrides.clientRelease = null; state.updateOverrides.clientReleaseError = "客户端版本检查失败"; state.updateOverrides.clientCheckedAt = null; });
    await page.clock.runFor(2100);
    assert.doesNotMatch(await client.innerText(), /已是最新|可更新至/); assert.match(await client.innerText(), /客户端版本检查失败/);
    assert.equal(await client.getByRole("link", { name: "下载本平台更新" }).count(), 0);
    assert.equal(await count(page, "axiom_update", "service"), 0); assert.equal(await count(page, "axiom_service", "stop"), 0);
    await checkUnexpected(page); await page.close(); passed.push("platform clients: backend-only does not update Mac; matching download; independent failure; neutral colors; unmanaged explanation without unsafe action");
  }
  {
    const page = await scene(), trigger = page.getByRole("button", { name: "关闭", exact: true });
    await trigger.click(); const dialog = page.getByRole("dialog", { name: "关闭后台服务？", exact: true });
    assert.match(await dialog.innerText(), /2 个会话/); assert.match(await dialog.innerText(), /设计会话/);
    assert.equal(await dialog.getByRole("button", { name: "继续运行", exact: true }).evaluate(el => document.activeElement === el), true);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" }); assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await trigger.click(); await page.mouse.click(5, 5); await dialog.waitFor({ state: "detached" });
    assert.equal(await count(page, "axiom_service", "stop"), 0);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme); await page.setViewportSize({ width: 390, height: 844 });
      await trigger.click(); await page.screenshot({ path: resolve(output, `close-${theme}-390.png`) }); await dialog.getByRole("button", { name: "继续运行", exact: true }).click();
    }
    await trigger.click(); await dialog.getByRole("button", { name: "确认关闭服务", exact: true }).click();
    assert.equal(await count(page, "axiom_service", "stop"), 1); await checkUnexpected(page); await page.close(); passed.push("close-service: safe focus, tasks, Escape/backdrop/cancel, explicit submission");
  }
  {
    const page = await scene(); await updates(page); const trigger = page.getByRole("button", { name: "更新后台服务", exact: true });
    await trigger.click(); const dialog = page.getByRole("region", { name: "后台服务更新", exact: true }).getByRole("group", { name: "更新后台至 0.4.2？", exact: true }), accept = dialog.getByRole("button", { name: "确认更新服务", exact: true });
    assert.match(await dialog.locator(".maintenance-warning").innerText(), /独占此安装.*共用安装/);
    await dialog.getByText("受影响的会话 · 2", { exact: true }).click(); assert.match(await dialog.innerText(), /代码检查/);
    await page.evaluate(() => { (window as any).desktopConfirmFixture.job = { kind: "service", running: false, servicePending: true, phase: "complete", message: "后台待核实", task: { id: "pending", attemptId: "pending", endpoint: "desktop", scope: "合成", resource: "service", label: "service", action: "service", status: "succeeded", phase: "installing", steps: ["installing"], completedSteps: 1, createdAt: 1, updatedAt: 1, budgets: { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 }, capabilities: { cancel: false, extend: false } } }; });
    await page.clock.runFor(2100); assert.equal(await accept.isDisabled(), true, "poll safety gate also disables an already-open confirmation");
    await accept.dispatchEvent("click"); assert.equal(await count(page, "axiom_update", "service"), 0);
    await page.evaluate(() => { (window as any).desktopConfirmFixture.job = null; }); await page.clock.runFor(2100); assert.equal(await accept.isEnabled(), true);
    await page.evaluate(() => { const state = (window as any).desktopConfirmFixture; state.job = { kind: "service", running: true, phase: "installing", message: "已有后台更新正在执行", task: state.makeTask("service", "running") }; });
    await page.clock.runFor(2100); await accept.and(page.locator(":disabled")).waitFor(); assert.equal(await accept.isDisabled(), true, "poll safety gate also disables an already-open confirmation");
    await accept.dispatchEvent("click"); assert.equal(await count(page, "axiom_update", "service"), 0);
    await page.evaluate(() => { (window as any).desktopConfirmFixture.job = null; }); await page.clock.runFor(2100); await accept.and(page.locator(":enabled")).waitFor(); assert.equal(await accept.isEnabled(), true);
    await dialog.getByRole("button", { name: "暂不更新", exact: true }).click(); assert.equal(await count(page, "axiom_update", "service"), 0);
    await trigger.click(); await accept.click(); assert.equal(await count(page, "axiom_update", "service"), 1);
    assert.equal(await page.evaluate(() => (window as any).desktopConfirmFixture.calls.find((call: any) => call.action === "service").version), "0.4.2");
    await checkUnexpected(page); await page.close(); passed.push("service-update: scope warning, tasks, poll invalidation, cancel and version submission");
  }
  {
    const page = await scene({ installer: true }); await updates(page); await page.getByRole("button", { name: "安装更新", exact: true }).click();
    const dialog = page.getByRole("region", { name: "客户端更新", exact: true }).getByRole("group", { name: "打开客户端安装向导？", exact: true }), accept = dialog.getByRole("button", { name: "打开安装向导", exact: true });
    assert.equal(await dialog.locator(".confirm-danger").count(), 0);
    await page.evaluate(() => { (window as any).desktopConfirmFixture.clientVersion = "0.4.2"; }); await page.clock.runFor(2100);
    await accept.and(page.locator(":disabled")).waitFor(); assert.equal(await accept.isDisabled(), true, "stale installer is no longer confirmable");
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await count(page, "axiom_update", "installer"), 0);
    await page.evaluate(() => { (window as any).desktopConfirmFixture.clientVersion = "0.4.1"; }); await page.clock.runFor(2100);
    await page.getByRole("button", { name: "安装更新", exact: true }).click(); await accept.click(); assert.equal(await count(page, "axiom_update", "installer"), 1);
    await checkUnexpected(page); await page.close(); passed.push("installer: normal action, current-version invalidation, cancel and explicit open");
  }
  {
    const page = await scene({ recovery: true }); await updates(page); const trigger = page.getByRole("button", { name: "恢复旧版本", exact: true });
    await trigger.click(); const dialog = page.getByRole("region", { name: "后台服务更新", exact: true }).getByRole("group", { name: "恢复之前的服务版本？", exact: true }); assert.match(await dialog.locator(".maintenance-warning").innerText(), /当前数据目录独占此安装.*共用安装/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await count(page, "axiom_update", "recover"), 0);
    await trigger.click(); await dialog.getByRole("button", { name: "确认恢复", exact: true }).click(); assert.equal(await count(page, "axiom_update", "recover"), 1);
    await checkUnexpected(page); await page.close(); passed.push("recovery: risk warning, cancellation and explicit recovery");
  }
  {
    const page = await scene({ interrupted: true }); await expandPreparation(page);
    const trigger = page.getByRole("button", { name: /^确认安装器退出后/ }); await trigger.click();
    const dialog = page.getByRole("region", { name: "Node.js 与 npm安装维护", exact: true }).getByRole("group", { name: "确认安装器已退出？", exact: true }); assert.match(await dialog.innerText(), /重复安装/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await count(page, "axiom_setup", "acknowledge-interruption"), 0);
    await trigger.click(); await dialog.getByRole("button", { name: "我已确认安装器全部退出", exact: true }).click();
    assert.equal(await count(page, "axiom_setup", "acknowledge-interruption"), 1); assert.equal(await page.evaluate(() => (window as any).desktopConfirmFixture.calls.find((call: any) => call.action === "acknowledge-interruption").confirmed), true);
    await checkUnexpected(page); await page.close(); passed.push("installer-exit: explicit manual confirmation and cancellation");
  }
  {
    const page = await scene({ interrupted: true, legacyRecovery: true }); await expandPreparation(page);
    const card = page.getByRole("region", { name: "Node.js 与 npm安装维护", exact: true });
    await card.getByRole("button", { name: /^确认安装器退出后/ }).click();
    await card.getByRole("group", { name: "确认安装器已退出？", exact: true }).getByRole("button", { name: "我已确认安装器全部退出", exact: true }).click();
    await card.locator(".setup-job.has-error").waitFor(); await ensureComponentActions(card);
    const before = await count(page, "axiom_setup", "status"); await card.getByRole("button", { name: "重新读取安装进度", exact: true }).click();
    assert.ok(await count(page, "axiom_setup", "status") > before, "settled legacy error keeps manual progress re-read even before another status poll");
    assert.equal(await count(page, "axiom_setup", "acknowledge-interruption"), 1); assert.equal(await count(page, "axiom_setup", "node"), 0);
    await checkUnexpected(page); await page.close(); passed.push("legacy-failed recovery: accepted old-format failure retains a manual read-only re-read entry, no installation replay");
  }
  for (const variant of ["same", "different", "fallback", "cross-owner"]) {
    const page = await scene({ clientFailure: true });
    await page.evaluate(variant => {
      const state = (window as any).desktopConfirmFixture, kind = variant === "cross-owner" ? "service" : "client";
      const failed = { ...state.makeTask(kind, "failed"), message: "客户端下载合成失败" };
      if (variant !== "fallback") failed.error = { code: "operation", phase: "installing", message: variant === "different" ? "执行器更具体的合成错误" : "客户端下载合成失败" };
      state.job = { kind, running: false, phase: "error", message: "客户端下载合成失败", task: failed };
    }, variant);
    await page.clock.runFor(2100);
    const client = page.getByRole("region", { name: "客户端更新", exact: true });
    await client.getByRole("button", { name: "下载客户端更新", exact: true }).click();
    await client.getByRole("alert").filter({ hasText: "客户端下载合成失败" }).waitFor();
    assert.equal(await client.getByText("客户端下载合成失败", { exact: true }).count(), 1, "the triggering card keeps the concrete error once");
    if (variant === "different") { await client.getByRole("alert").filter({ hasText: "执行器更具体的合成错误" }).waitFor(); assert.equal(await client.getByRole("alert").count(), 2, "a distinct task diagnostic never suppresses the request error"); }
    if (variant === "cross-owner") await page.getByRole("region", { name: "后台服务更新", exact: true }).getByRole("alert").filter({ hasText: "客户端下载合成失败" }).waitFor();
    await page.clock.runFor(2100); assert.equal(await client.getByText("客户端下载合成失败", { exact: true }).count(), 1, "polls do not erase the manual failure");
    await checkUnexpected(page); await page.close(); passed.push(`update-error ${variant}: concrete task/request diagnostics retain their owner without mutual suppression`);
  }
  {
    const page = await scene(); await page.locator(".startup-maintenance > summary").filter({ hasText: "组件管理" }).click();
    const region = page.getByRole("region", { name: "终端 Pi 卸载", exact: true }), trigger = region.getByRole("button", { name: "卸载", exact: true });
    await trigger.click(); const group = region.getByRole("group", { name: "确认 Pi 卸载", exact: true }), accept = group.getByRole("button", { name: "确认卸载", exact: true }); await group.waitFor();
    assert.equal(await accept.isDisabled(), true); await group.getByRole("checkbox").check(); assert.equal(await accept.isEnabled(), true);
    for (const theme of ["dark", "light"]) { await page.evaluate(value => document.documentElement.dataset.theme = value, theme); await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: resolve(output, `inline-pi-${theme}-390.png`), fullPage: true }); }
    assert.equal(await accept.evaluate(el => getComputedStyle(el).color), "rgb(255, 255, 255)");
    await group.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await count(page, "axiom_update", "pi-uninstall"), 0);
    await trigger.click(); await group.waitFor(); assert.equal(await group.getByRole("checkbox").isChecked(), false);
    await group.getByRole("checkbox").check(); await accept.click(); assert.equal(await count(page, "axiom_update", "pi-uninstall"), 1);
    assert.deepEqual(JSON.parse(await page.evaluate(() => (window as any).desktopConfirmFixture.calls.find((call: any) => call.action === "pi-uninstall").version)), { token: "removal-token", confirm: true, sessionsClosed: true });
    await checkUnexpected(page); await page.close(); passed.push("inline-pi: consent, safe action order/styles, cancel, fresh consent and snapshot payload");
  }
  {
    const page = await scene({ histories: true, clientFailure: true }); await updates(page);
    const pi = page.getByRole("region", { name: "终端 Pi", exact: true }), backend = page.getByRole("region", { name: "后台服务更新", exact: true }), client = page.getByRole("region", { name: "客户端更新", exact: true });
    await pi.locator('.component-unresolved .maintenance-task[data-status="unknown"]').waitFor();
    assert.equal(await backend.locator(".component-unresolved .maintenance-task").count(), 0);
    const pendingPi = pi.locator(".component-unresolved");
    assert.match(await pendingPi.innerText(), /结果待核实.*原操作不会自动重试/s);
    assert.equal(await pendingPi.locator('[data-task-id="old-update-pi"]').count(), 1);
    assert.equal(await pi.locator(".component-history,.component-logs,.maintenance-task-details").count(), 0);
    assert.equal(await pi.getByRole("alert").count(), 0, "old failures are not current alerts");
    assert.equal(await pendingPi.getByRole("button", { name: "核实中断任务", exact: true }).count(), 0, "old records cannot reuse the current job's recovery action");
    await page.evaluate(() => { const f = (window as any).desktopConfirmFixture; f.job = { kind: "pi", running: false, phase: "complete", message: "最近检查完成", task: f.makeTask("pi-check") }; });
    await page.clock.runFor(2100);
    assert.equal(await pi.locator('.maintenance-result[data-status="succeeded"]').count(), 0, "new success cannot compete with an older unresolved operation");
    assert.equal(await pendingPi.locator('[data-task-id="old-update-pi"]').count(), 1);
    await page.evaluate(() => { const f = (window as any).desktopConfirmFixture; f.job = { kind: "service", running: false, phase: "complete", message: "后台检查完成", task: f.makeTask("service") }; });
    await page.clock.runFor(2100);
    assert.equal(await backend.locator('.maintenance-result[data-status="succeeded"]').count(), 0, "settled work never leaves a completed panel, even without unresolved work on this card");
    const historyWarning = page.getByRole("region", { name: "版本与更新", exact: true }).getByText("合成旧记录损坏，原证据保留。", { exact: false });
    await historyWarning.waitFor(); assert.equal(await historyWarning.count(), 1, "shared evidence warning appears once per maintenance area");
    await client.getByRole("button", { name: "下载客户端更新", exact: true }).click();
    await client.getByRole("alert").filter({ hasText: "客户端下载合成失败" }).waitFor();
    assert.equal(await backend.getByRole("alert").filter({ hasText: "客户端下载合成失败" }).count(), 0);
    await expandPreparation(page);
    const setup = page.getByRole("region", { name: "后台服务安装维护", exact: true });
    await setup.locator('.component-unresolved .maintenance-task[data-status="interrupted"]').waitFor();
    assert.equal(await setup.locator('[data-task-id="old-setup-service"]').count(), 1);
    assert.match(await setup.locator(".component-unresolved").innerText(), /已中断，结果待核实/);
    assert.equal(await page.getByRole("button", { name: "任务记录", exact: true }).count(), 0);
    await checkUnexpected(page); await page.close(); passed.push("history: old unresolved attempts remain in their program cards; history warnings and client errors are not lost or misattributed");
  }
  {
    const page = await scene({ serviceFailure: true });
    const backend = page.getByRole("region", { name: "后台服务更新", exact: true });
    await backend.getByRole("button", { name: "更新后台服务", exact: true }).click();
    const confirmation = backend.getByRole("group", { name: "更新后台至 0.4.2？", exact: true });
    await confirmation.getByRole("button", { name: "确认更新服务", exact: true }).click();
    await confirmation.getByRole("alert").filter({ hasText: "服务更新合成拒绝" }).waitFor();
    assert.equal(await backend.getByRole("alert").count(), 1, "submission rejection remains in the open confirmation without a duplicate card alert");
    await confirmation.getByRole("button", { name: "暂不更新", exact: true }).click();
    await backend.getByRole("alert").filter({ hasText: "服务更新合成拒绝" }).waitFor();
    await checkUnexpected(page); await page.close(); passed.push("rejected-confirmation: error stays inline once and remains inspectable after closing");
  }
  {
    const page = await scene();
    await page.evaluate(() => { const f = (window as any).desktopConfirmFixture; f.setupJob = { id: "fixture-service", action: "service", running: false, phase: "error", message: "此前服务安装失败", lines: [], task: { ...f.makeTask("service", "failed"), error: { code: "operation", phase: "installing", message: "此前服务安装合成失败" } } }; f.setupCheckFails = true; });
    await page.clock.runFor(1600); await expandPreparation(page);
    const node = page.getByRole("region", { name: "Node.js 与 npm安装维护", exact: true }), service = page.getByRole("region", { name: "后台服务安装维护", exact: true });
    await service.locator('.maintenance-task[data-status="failed"]').waitFor();
    await node.getByRole("button", { name: "检查", exact: true }).click();
    await node.getByText("环境检查合成失败", { exact: true }).waitFor();
    assert.equal(await service.getByText("环境检查合成失败", { exact: true }).count(), 0, "a Node check error never belongs to the previous service job");
    await service.getByRole("alert").filter({ hasText: "此前服务安装合成失败" }).waitFor();
    await service.getByRole("button", { name: "检查", exact: true }).click();
    await service.getByText("环境检查合成失败", { exact: true }).waitFor();
    assert.equal(await node.getByText("环境检查合成失败", { exact: true }).count(), 0);
    await service.getByRole("alert").filter({ hasText: "此前服务安装合成失败" }).waitFor();
    await checkUnexpected(page); await page.close(); passed.push("setup-feedback: checks stay on the triggering program, not the previous installation");
  }
  {
    const page = await scene();
    await expandPreparation(page);
    const service = page.getByRole("region", { name: "后台服务安装维护", exact: true });
    await service.getByRole("button", { name: "重新安装服务", exact: true }).click();
    const confirmation = service.getByRole("group", { name: "前台重新安装服务？", exact: true });
    await confirmation.waitFor();
    await page.evaluate(() => { (window as any).desktopConfirmFixture.serviceState = "unmanaged"; });
    await page.clock.runFor(3100);
    assert.match(await service.locator(":scope > .maintenance-panel-heading .component-card-version").innerText(), /当前\s+待检查/);
    assert.equal(await service.getByRole("button", { name: "安装", exact: true }).count(), 0);
    assert.equal(await service.getByRole("button", { name: "重新安装服务", exact: true }).count(), 0);
    const accept = confirmation.getByRole("button", { name: "前台重新安装", exact: true });
    assert.ok(await accept.isDisabled(), "unverified ownership invalidates an already-open reinstall confirmation");
    await accept.dispatchEvent("click");
    assert.equal(await count(page, "axiom_setup", "service"), 0);
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    assert.ok(await service.getByRole("button", { name: "检查", exact: true }).isEnabled());
    await checkUnexpected(page); await page.close(); passed.push("setup-service-state: unverified installation has only check and cannot submit stale reinstall");
  }
  assert.deepEqual(errors, []); await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, scope: "Actual React pages with synthetic IPC only; no real installation/removal", scenarios: passed, errors }, null, 2));
  console.log(`PASS: ${passed.length} actual-page desktop confirmation scenarios; synthetic IPC only.`);
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await server.close(); }
