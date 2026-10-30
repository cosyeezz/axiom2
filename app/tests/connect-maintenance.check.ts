// Actual Connect and desktop maintenance adapters; synthetic IPC only. No native execution.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";
import { assertComponentTree, ensureComponentActions } from "./component-layout-helpers.js";

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/connect-maintenance");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const origin = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors: string[] = [], remote: string[] = [], passed: string[] = [];
type Options = { windows?: boolean; setup?: "running" | "failed" | "legacy-failed" | "unknown" };
async function scene(options: Options = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => { if (route.request().url().startsWith(origin)) await route.continue(); else { remote.push(route.request().url()); await route.abort("blockedbyclient"); } });
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(options => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: options.windows ? "Win32" : "MacIntel" });
    const budgets = { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 };
    let sequence = 0;
    const task = (action: string, status = "succeeded", phase = "checking") => ({ id: `synthetic-${action}-${++sequence}`, attemptId: `synthetic-attempt-${sequence}`, endpoint: "desktop", scope: "纯合成界面测试", resource: action, label: action, action, status, phase, steps: [phase], completedSteps: status === "succeeded" ? 1 : 0, createdAt: Date.now(), updatedAt: Date.now(), budgets, capabilities: { cancel: status === "running", extend: status === "running" } });
    const path = "/synthetic/" + "very-long-private-installation-directory/".repeat(7) + "component";
    const items = [{ label: "托管程序", path, state: "remove" }, { label: "个人设置与会话", path: "/synthetic/personal", state: "retain" }];
    const state: any = {
      calls: [], unexpected: [], updateJob: null, setupJob: null, removal: null, serviceRemoval: null, archiveCleanup: null, serviceError: "", servicePreviews: 0, delayServicePreview: false, resolveServicePreview: null,
      delayRemoval: false, delayTool: false, resolveRemoval: null, resolveTool: null, rejectTool: "", rejectToolLate: "", toolVerifyError: "",
      opencli: { revision: "open-revision", configured: true, ready: true, cleanup: { revision: "open-path-revision", paths: [path] }, job: null },
      rtk: { revision: "rtk-revision", version: "1.0.0", executable: "/synthetic/rtk", cleanup: { revision: "rtk-path-revision", paths: ["/synthetic/rtk"] }, offline: false },
    };
    if (options.setup) {
      const status = options.setup === "legacy-failed" ? "failed" : options.setup;
      const current: any = task("service", status, status === "running" ? "downloading" : "installing");
      current.message = status === "running" ? "合成服务安装进度" : "当前安装合成失败";
      if (status === "running") current.transfer = { received: 1024, total: 4096, bytesPerSecond: 128, updatedAt: Date.now(), source: "https://example.invalid/synthetic", connection: "receiving" };
      if (status === "failed") current.error = { code: "operation", phase: "installing", message: "当前安装合成失败" };
      state.setupJob = { id: current.id, action: "service", running: status === "running", phase: status === "failed" ? "error" : "installing", message: current.message, lines: [], ...(options.setup === "legacy-failed" ? {} : { task: current }) };
    }
    const snapshot = () => ({ clientVersion: "0.4.1", clientSupported: false, serviceVersion: "0.4.1", managed: true, release: null, recovery: false, log: "/synthetic/never-read.log", job: state.updateJob, pi: { runtimeVersion: "1.1.0", cli: { version: "1.1.0", packageRoot: path }, release: null, removal: state.removal }, serviceRemoval: state.serviceRemoval, archiveCleanup: state.archiveCleanup });
    (window as any).connectMaintenanceFixture = state;
    let theme = "dark", revision = 0;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_theme") { if (args.theme) { theme = args.theme; revision++; } return { theme, revision }; }
      if (name === "axiom_service" && args.action === "status") { if (state.serviceError) throw Error(state.serviceError); return { desktopView: "control", state: "running", active: [], background: true }; }
      if (name === "axiom_peers") return { peers: [] };
      if (name === "axiom_setup") {
        if (args.action === "history") return { tasks: [] };
        if (args.action === "check") return { nodeReady: true, nodeVersion: "v24.13.0", writable: true, tailscale: true, platform: options.windows ? "windows" : "darwin" };
        if (args.action === "status") return { job: state.setupJob };
        if (args.action === "extend") { state.setupJob.task.budgets = args.maintenance.budgets; return { job: state.setupJob }; }
        if (args.action === "cancel") { state.setupJob = { ...state.setupJob, running: false, task: { ...state.setupJob.task, status: "cancelled", capabilities: { cancel: false, extend: false } } }; return { job: state.setupJob }; }
        if (args.action === "uninstall-settings") return null;
      }
      if (name === "axiom_update") {
        if (args.action === "history") return { tasks: [] };
        if (["status", "pi-refresh", "pi-check", "check"].includes(args.action)) return snapshot();
        if (["pi-remove-preview", "service-remove-preview", "archive-preview"].includes(args.action)) {
          if (args.action === "pi-remove-preview") state.removal = { installed: true, version: "1.1.0", packageRoot: path, token: "pi-removal-token", items };
          if (args.action === "service-remove-preview") state.serviceRemoval = { version: "0.4.1", packageRoot: path, token: `service-removal-token-${++state.servicePreviews}`, items };
          if (args.action === "archive-preview") state.archiveCleanup = { token: "archive-token", items: [{ id: "archive-id", label: "后台合成下载包", path: path + ".tar.gz", state: "remove", size: 4096 }] };
          state.updateJob = { kind: args.action, running: false, phase: "complete", message: "已核对合成范围", task: task(args.action) };
          if (args.action === "service-remove-preview" && state.delayServicePreview) return new Promise(resolve => { state.resolveServicePreview = () => resolve(snapshot()); });
          return snapshot();
        }
        if (["pi-uninstall", "service-uninstall", "archive-remove"].includes(args.action)) {
          const active = task(args.action, "running", "removing");
          state.updateJob = { kind: args.action, running: true, phase: "removing", message: "合成删除正在执行", task: active };
          if (state.removal) state.removal.token = null;
          if (state.serviceRemoval) state.serviceRemoval.token = null;
          if (state.archiveCleanup) state.archiveCleanup.token = null;
          if (state.delayRemoval) return new Promise(resolve => { state.resolveRemoval = () => resolve(snapshot()); });
          state.updateJob = { ...state.updateJob, running: false, task: { ...active, status: "succeeded" }, cleanup: { complete: true, items: [] } }; return snapshot();
        }
      }
      if (name === "axiom_cleanup") {
        const { requestId, op } = args.request;
        if (op.endsWith(".get")) {
          if (op === "opencli.get" && state.opencli.job && state.toolVerifyError) throw Error(state.toolVerifyError);
          return { requestId, data: op === "opencli.get" ? state.opencli : op === "rtk.get" ? state.rtk : { revision: "empty-revision", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
        }
        if (op === "opencli.uninstall") {
          if (state.rejectTool) throw Error(state.rejectTool);
          const finish = () => {
            state.opencli = { ...state.opencli, revision: "open-removed", configured: false, cleanup: { revision: "open-path-removed", paths: [] }, job: { id: requestId, running: false, kind: "uninstall", message: "合成移除完成" } };
            return { requestId, data: state.opencli };
          };
          if (state.delayTool) return new Promise((resolve, reject) => { state.resolveTool = () => state.rejectToolLate ? reject(state.rejectToolLate) : resolve(finish()); });
          return finish();
        }
      }
      if (name === "axiom_environment") return null;
      state.unexpected.push(name + ":" + (args.action ?? args.request?.op)); throw Error("Unexpected synthetic IPC: " + name);
    } };
  }, options);
  await page.clock.install(); await page.goto(origin);
  await page.getByRole("button", { name: "关闭", exact: true }).waitFor();
  return page;
}
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
async function openComponents(page: Page) {
  const summary = page.locator(".startup-maintenance > summary").filter({ hasText: "组件管理" });
  if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
  await region(page, "OpenCLI卸载").waitFor();
}
async function count(page: Page, action: string) { return page.evaluate(action => (window as any).connectMaintenanceFixture.calls.filter((call: any) => call.action === action || call.request?.op === action).length, action); }
async function payload(page: Page, action: string) { return page.evaluate(action => (window as any).connectMaintenanceFixture.calls.find((call: any) => call.action === action || call.request?.op === action), action); }
async function clean(page: Page) {
  assert.deepEqual(await page.evaluate(() => (window as any).connectMaintenanceFixture.unexpected), []);
  assert.equal(await page.getByRole("dialog", { name: "下载与维护" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^(安装任务记录|更新任务记录|关闭下载与维护)$/ }).count(), 0);
  await page.close();
}
try {
  {
    const page = await scene(); await openComponents(page);
    const inventory = region(page, "已安装组件");
    assert.equal(await inventory.locator(".environment-item,.environment-cleanup-row").count(), 0);
    for (const card of await inventory.locator(".environment-component").all()) { await ensureComponentActions(card); await assertComponentTree(card); }
    const tailscale = region(page, "Tailscale 卸载");
    await tailscale.getByRole("button", { name: "打开系统卸载列表" }).dispatchEvent("click");
    assert.equal(await count(page, "uninstall-settings"), 0, "unsupported platform cannot gain uninstall capability through the shared action");
    await clean(page); passed.push("all removal rows use shared component surfaces and unsupported actions remain guarded");
  }
  for (const [owner, preview, action, title, acceptLabel, expected] of [
    ["终端 Pi 卸载", "pi-remove-preview", "pi-uninstall", "确认 Pi 卸载", "确认卸载", { token: "pi-removal-token", confirm: true, sessionsClosed: true }],
    ["托管后台卸载", "service-remove-preview", "service-uninstall", "确认后台卸载", "确认卸载后台", { token: "service-removal-token-2", confirm: true }],
    ["下载归档清理", "archive-preview", "archive-remove", "确认归档清理", "确认清理", { token: "archive-token", id: "archive-id", confirm: true }],
  ] as const) {
    const page = await scene(); await openComponents(page);
    const card = region(page, owner), trigger = card.getByRole("button", { name: owner === "下载归档清理" ? "清理" : "卸载", exact: true });
    await trigger.click(); const confirmation = card.getByRole("group", { name: title, exact: true }); await confirmation.waitFor();
    assert.equal(await confirmation.evaluate(element => element.classList.contains("component-confirmation")), true);
    const accept = confirmation.getByRole("button", { name: acceptLabel, exact: true });
    if (owner !== "下载归档清理") { assert.ok(await accept.isDisabled()); await confirmation.getByRole("checkbox").check(); }
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await count(page, action), 0, "cancellation never sends a destructive command");
    await trigger.click(); await confirmation.waitFor();
    assert.equal(await count(page, preview), 2, "reopening obtains a fresh preview");
    if (owner !== "下载归档清理") { assert.equal(await confirmation.getByRole("checkbox").isChecked(), false); await confirmation.getByRole("checkbox").check(); }
    if (owner === "托管后台卸载") {
      await confirmation.getByText("查看移除与保留范围", { exact: true }).click();
      for (const theme of ["dark", "light"]) for (const width of [1100, 390, 320]) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme); await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width} removal confirmation has no horizontal overflow`);
        assert.equal(await accept.evaluate(element => getComputedStyle(element).color), "rgb(255, 255, 255)");
        await page.screenshot({ path: resolve(output, `synthetic-service-${theme}-${width}.png`), fullPage: true });
      }
    }
    await page.evaluate(() => { (window as any).connectMaintenanceFixture.delayRemoval = true; });
    await accept.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    assert.equal(await count(page, action), 1, "double click submits exactly once");
    assert.deepEqual(JSON.parse((await payload(page, action)).version), expected);
    await page.evaluate(() => (window as any).connectMaintenanceFixture.resolveRemoval());
    await page.clock.runFor(2200); assert.equal(await count(page, action), 1);
    await clean(page); passed.push(`${owner}: shared confirmation, cancellation, renewed consent, original token, single submission`);
  }
  for (const previewTiming of ["open confirmation", "during unknown", "after recovery"] as const) {
    const delayedPreview = previewTiming !== "open confirmation";
    const page = await scene(); await openComponents(page); const card = region(page, "托管后台卸载");
    if (delayedPreview) await page.evaluate(() => { (window as any).connectMaintenanceFixture.delayServicePreview = true; });
    await card.getByRole("button", { name: "卸载", exact: true }).click(); const confirmation = card.getByRole("group", { name: "确认后台卸载", exact: true });
    if (!delayedPreview) { await confirmation.getByRole("checkbox").check(); assert.equal(await confirmation.getByRole("button", { name: "确认卸载后台", exact: true }).isEnabled(), true); }
    await page.evaluate(() => { (window as any).connectMaintenanceFixture.serviceError = "synthetic service state unavailable after uninstall preview"; }); await page.clock.runFor(3_000);
    await page.locator('.connection-status-tag[data-state="unknown"]').waitFor({ state: "visible" });
    if (previewTiming === "during unknown") { await page.evaluate(() => { const state = (window as any).connectMaintenanceFixture; state.delayServicePreview = false; state.resolveServicePreview(); }); await confirmation.waitFor(); }
    if (previewTiming !== "after recovery") {
      assert.equal(await confirmation.getByRole("button", { name: "确认卸载后台", exact: true }).isDisabled(), true, "unknown service invalidates a previously consented uninstall confirmation");
      assert.equal(await confirmation.getByRole("checkbox").isChecked(), false); assert.equal(await confirmation.getByRole("checkbox").isDisabled(), true);
      await confirmation.getByRole("button", { name: "确认卸载后台", exact: true }).dispatchEvent("click");
    }
    assert.equal(await count(page, "service-uninstall"), 0);
    await page.evaluate(() => { (window as any).connectMaintenanceFixture.serviceError = ""; }); await page.getByRole("button", { name: "校验状态", exact: true }).click();
    await page.locator('.connection-status-tag[data-state="running"]').waitFor({ state: "visible" });
    if (previewTiming === "after recovery") { await page.evaluate(() => { const state = (window as any).connectMaintenanceFixture; state.delayServicePreview = false; state.resolveServicePreview(); }); await confirmation.waitFor(); }
    assert.equal(await confirmation.getByRole("checkbox").isDisabled(), true, "a preview that crossed unknown cannot regain authorization by arriving after service recovery"); assert.equal(await confirmation.getByRole("checkbox").isChecked(), false);
    assert.equal(await confirmation.getByRole("button", { name: "确认卸载后台", exact: true }).isDisabled(), true, "service revalidation must not revive the old consent or preview token");
    await confirmation.getByText("服务状态已变化，旧确认不再授权卸载。请取消此确认，再重新预览移除范围。", { exact: true }).waitFor();
    await confirmation.getByRole("button", { name: "确认卸载后台", exact: true }).dispatchEvent("click"); assert.equal(await count(page, "service-uninstall"), 0); assert.equal(await count(page, "service-remove-preview"), 1);
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await card.getByRole("button", { name: "卸载", exact: true }).click(); await confirmation.waitFor(); assert.equal(await count(page, "service-remove-preview"), 2);
    assert.equal(await confirmation.getByRole("checkbox").isEnabled(), true); assert.equal(await confirmation.getByRole("checkbox").isChecked(), false);
    await confirmation.getByRole("checkbox").check(); await confirmation.getByRole("button", { name: "确认卸载后台", exact: true }).click();
    assert.equal(await count(page, "service-uninstall"), 1); assert.deepEqual(JSON.parse((await payload(page, "service-uninstall")).version), { token: "service-removal-token-2", confirm: true }); await clean(page);
    passed.push(`backend unknown (${previewTiming}): old confirmation and token stay invalid after read-only service recovery; only a fresh preview and consent can submit exactly once with the new token`);
  }
  {
    const page = await scene(); await openComponents(page); const card = region(page, "OpenCLI卸载");
    await card.getByRole("button", { name: "卸载", exact: true }).click();
    const confirmation = card.getByRole("group", { name: "确认工具清理范围", exact: true });
    await confirmation.waitFor(); await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await count(page, "opencli.uninstall"), 0);
    await card.getByRole("button", { name: "卸载", exact: true }).click();
    await confirmation.getByRole("button", { name: "确认卸载", exact: true }).evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await page.getByText("OpenCLI · 选定范围已核实", { exact: true }).waitFor();
    assert.equal(await count(page, "opencli.uninstall"), 1);
    assert.deepEqual((await payload(page, "opencli.uninstall")).request.params, { revision: "open-revision", cleanupRevision: "open-path-revision", confirm: true });
    const fallback = region(page, "OpenCLI维护"); assert.ok(await fallback.getByRole("button", { name: "刷新状态", exact: true }).isVisible(), "settled row disappearing does not discard verification feedback");
    await fallback.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(await page.getByText("OpenCLI · 选定范围已核实", { exact: true }).count(), 0);
    await clean(page); passed.push("tool cleanup: shared owner card, cancel, original revisions, single submission, feedback survives disappearing row");
  }
  {
    const page = await scene(); await openComponents(page); const card = region(page, "OpenCLI卸载");
    await page.evaluate(() => { (window as any).connectMaintenanceFixture.delayTool = true; });
    await card.getByRole("button", { name: "卸载", exact: true }).click();
    await card.getByRole("group", { name: "确认工具清理范围" }).getByRole("button", { name: "确认卸载", exact: true }).click();
    await page.clock.fastForward(96000);
    await page.getByText("OpenCLI · 尚未完成核实", { exact: true }).waitFor();
    assert.equal(await count(page, "opencli.uninstall"), 1);
    await page.clock.fastForward(10000); assert.equal(await count(page, "opencli.uninstall"), 1, "polling never replays an uncertain request");
    assert.equal(await card.getByRole("button", { name: "卸载", exact: true }).getAttribute("aria-disabled"), "true");
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("axiom.desktop.cleanup.pending")!));
    assert.equal(saved.accepted, false); assert.ok(saved.requestId);
    await page.reload(); await page.getByRole("button", { name: "关闭", exact: true }).waitFor(); await openComponents(page);
    await page.getByText("OpenCLI · 尚未完成核实", { exact: true }).waitFor();
    assert.equal(await count(page, "opencli.uninstall"), 0, "reload restores evidence without issuing deletion again");
    assert.match(await region(page, "工具与资源卸载").innerText(), /尚不能将其他任务或文件消失归因于本次请求|响应超时|尚未确认/);
    await clean(page); passed.push("unknown cleanup: timeout, persisted request identity, polling and reload without replay");
  }
  const offlineRefusal = "后台未运行；RTK 仅可读取范围，缺少历史工作进程退出证明时不可离线卸载。其他工具与资源请先启动后台；终端 Pi 与安装归档使用各自维护入口。";
  for (const late of [false, true]) {
    const page = await scene(); await openComponents(page); const card = region(page, "OpenCLI卸载");
    await page.evaluate(({ late, message }) => Object.assign((window as any).connectMaintenanceFixture, late ? { delayTool: true, rejectToolLate: message } : { rejectTool: message }), { late, message: offlineRefusal });
    await card.getByRole("button", { name: "卸载", exact: true }).click();
    await card.getByRole("group", { name: "确认工具清理范围" }).getByRole("button", { name: "确认卸载", exact: true }).click();
    if (late) {
      await page.clock.fastForward(96000); await page.getByText("OpenCLI · 尚未完成核实", { exact: true }).waitFor();
      assert.equal(await card.getByRole("button", { name: "关闭", exact: true }).count(), 0, "timeout alone never releases an unknown attempt");
      await page.evaluate(() => (window as any).connectMaintenanceFixture.resolveTool());
    }
    await page.getByText("OpenCLI · 请求未受理", { exact: true }).waitFor();
    await card.getByRole("alert").filter({ hasText: offlineRefusal }).waitFor();
    let saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("axiom.desktop.cleanup.pending")!));
    assert.equal(saved.accepted, false); assert.equal(saved.refused, true); assert.equal(saved.result.state, "failed");
    assert.equal(await count(page, "opencli.uninstall"), 1);
    await card.getByRole("button", { name: "刷新状态", exact: true }).click();
    await page.clock.fastForward(4000); assert.equal(await count(page, "opencli.uninstall"), 1);
    saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("axiom.desktop.cleanup.pending")!)); assert.equal(saved.result.state, "failed", "read-only refresh cannot erase a proven submission refusal");
    await page.reload(); await page.locator(".connection-primary-button").waitFor(); await openComponents(page);
    await card.getByText("OpenCLI · 请求未受理", { exact: true }).waitFor(); assert.equal(await count(page, "opencli.uninstall"), 0, "reload never replays a refused request");
    await card.getByRole("button", { name: "关闭", exact: true }).click(); assert.equal(await page.evaluate(() => sessionStorage.getItem("axiom.desktop.cleanup.pending")), null);
    await card.getByRole("button", { name: "卸载", exact: true }).click(); await card.getByRole("group", { name: "确认工具清理范围" }).getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await count(page, "opencli.uninstall"), 0, "new preview and cancellation do not resubmit");
    await clean(page); passed.push(`${late ? "late" : "immediate"} exact native pre-helper refusal: failed, durable, dismissible, no replay and fresh confirmation required`);
  }
  for (const message of ["无法连接本机后台", offlineRefusal + " 附加错误"]) {
    const page = await scene(); await openComponents(page); const card = region(page, "OpenCLI卸载");
    await page.evaluate(message => { (window as any).connectMaintenanceFixture.rejectTool = message; }, message);
    await card.getByRole("button", { name: "卸载", exact: true }).click(); await card.getByRole("group", { name: "确认工具清理范围" }).getByRole("button", { name: "确认卸载", exact: true }).click();
    await card.getByText("OpenCLI · 尚未完成核实", { exact: true }).waitFor();
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("axiom.desktop.cleanup.pending")!)); assert.equal(saved.accepted, false); assert.notEqual(saved.refused, true);
    assert.equal(await card.getByRole("button", { name: "关闭", exact: true }).count(), 0); await page.clock.fastForward(4000); assert.equal(await count(page, "opencli.uninstall"), 1);
    await clean(page); passed.push("unproven cleanup rejection remains unknown and locked; exact evidence is required, no automatic replay");
  }
  for (const late of [false, true]) {
    const page = await scene(); await openComponents(page); const card = region(page, "OpenCLI卸载");
    await page.evaluate(({ late, message }) => Object.assign((window as any).connectMaintenanceFixture, { delayTool: late, toolVerifyError: message }), { late, message: offlineRefusal });
    await card.getByRole("button", { name: "卸载", exact: true }).click(); await card.getByRole("group", { name: "确认工具清理范围" }).getByRole("button", { name: "确认卸载", exact: true }).click();
    if (late) { await page.clock.fastForward(96000); await page.evaluate(() => (window as any).connectMaintenanceFixture.resolveTool()); }
    await card.getByText("OpenCLI · 尚未完成核实", { exact: true }).waitFor();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("axiom.desktop.cleanup.pending")!).accepted === true);
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("axiom.desktop.cleanup.pending")!)); assert.equal(saved.accepted, true); assert.notEqual(saved.refused, true);
    assert.equal(await card.getByRole("button", { name: "关闭", exact: true }).count(), 0, "an accepted job cannot be released by a verification error with the same refusal text");
    await page.evaluate(() => { (window as any).connectMaintenanceFixture.toolVerifyError = ""; }); await page.clock.runFor(1700);
    await page.getByText("OpenCLI · 选定范围已核实", { exact: true }).waitFor(); assert.equal(await count(page, "opencli.uninstall"), 1);
    await clean(page); passed.push(`${late ? "late" : "immediate"} accepted cleanup: verification refusal text never unlocks; re-read original job without replay`);
  }
  {
    const page = await scene(); await openComponents(page); const card = region(page, "RTK卸载");
    await card.getByRole("button", { name: "卸载", exact: true }).click();
    const confirmation = card.getByRole("group", { name: "确认工具清理范围", exact: true }); await confirmation.waitFor();
    await page.evaluate(() => { (window as any).connectMaintenanceFixture.rtk.offline = true; });
    await confirmation.getByRole("button", { name: "确认卸载", exact: true }).click();
    await confirmation.getByRole("alert").filter({ hasText: "RTK 执行能力或范围已变化" }).waitFor();
    assert.equal(await count(page, "rtk.uninstall"), 0, "read-only capability change is detected immediately before dispatch");
    assert.ok(await confirmation.isVisible(), "a pre-admission error is not mistaken for successful confirmation");
    assert.ok(await confirmation.getByRole("button", { name: "确认卸载", exact: true }).isDisabled());
    assert.equal(await page.evaluate(() => sessionStorage.getItem("axiom.desktop.cleanup.pending")), null);
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await clean(page); passed.push("RTK: immediate pre-submit capability recheck, read-only transition denies deletion without losing confirmation error");
  }
  {
    const page = await scene({ windows: true }); await openComponents(page);
    const action = region(page, "托管后台卸载").getByRole("button", { name: "卸载", exact: true });
    assert.equal(await action.getAttribute("aria-disabled"), "true"); await action.dispatchEvent("click");
    assert.equal(await count(page, "service-remove-preview"), 0); assert.equal(await region(page, "下载归档清理").count(), 0);
    await region(page, "Tailscale 卸载").getByRole("button", { name: "打开系统卸载列表" }).click();
    assert.equal(await count(page, "uninstall-settings"), 1); await clean(page); passed.push("Windows: service automatic removal unavailable, archives hidden, system Tailscale path retained");
  }
  {
    const page = await scene({ setup: "running" });
    assert.equal(await page.locator(".startup-preparation").evaluate(element => (element as HTMLDetailsElement).open), true);
    const card = region(page, "后台服务安装维护");
    await card.getByRole("progressbar", { name: "当前下载进度" }).waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 2, "original upper download feedback and owning-card progress are both retained");
    assert.equal(await card.getByText("合成服务安装进度", { exact: true }).count(), 1);
    assert.match(await page.locator('.connection-primary-area > div[role="status"]').innerText(), /合成服务安装进度/, "original top summary retains its text alongside the nested file progress");
    assert.equal(await page.locator(".connection-primary-area .install-download").count(), 1);
    assert.equal(await page.locator(".connection-primary-area .maintenance-task,.setup-job").count(), 0, "the upper summary does not duplicate task controls");
    await card.getByText("时限与任务详情", { exact: true }).click();
    await card.getByRole("button", { name: "延长本次时限", exact: true }).click(); assert.equal(await count(page, "extend"), 1);
    const originalId = (await payload(page, "extend")).maintenance.id;
    await card.getByRole("button", { name: "取消任务", exact: true }).click(); assert.equal(await count(page, "cancel"), 1);
    assert.equal((await payload(page, "cancel")).maintenance.id, originalId);
    assert.equal(await page.getByRole("progressbar").count(), 0); await clean(page); passed.push("installation: upper feedback retained, owning card auto-revealed, original task extension/cancellation retained once");
  }
  for (const setup of ["failed", "legacy-failed", "unknown"] as const) {
    const page = await scene({ setup });
    await region(page, "后台服务安装维护").waitFor();
    assert.equal(await page.locator(".startup-preparation").evaluate(element => (element as HTMLDetailsElement).open), true, "initial current failure or unresolved job is visible both above and in its owning maintenance area");
    const card = region(page, "后台服务安装维护");
    if (setup === "failed") { await card.getByRole("alert").filter({ hasText: "当前安装合成失败" }).waitFor(); assert.equal(await card.getByText("当前安装合成失败", { exact: true }).count(), 1); assert.equal(await page.locator(".startup-device").getByText("当前安装合成失败", { exact: true }).count(), 1); }
    if (setup === "unknown") await card.getByText(/结果待核实/).first().waitFor();
    if (setup === "legacy-failed") {
      await card.locator(".setup-job").waitFor();
      const before = await count(page, "status"); await card.getByRole("button", { name: "重新读取安装进度", exact: true }).click();
      assert.ok(await count(page, "status") > before, "legacy failed evidence still has a manual read-only recovery entry");
    }
    assert.equal(await count(page, "service"), 0, "failure visibility does not auto-submit an installation"); await clean(page); passed.push(`initial ${setup}: owning maintenance section visible, no automatic replay`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, scope: "Actual Connect React UI, synthetic IPC only; no real installation, deletion or native helper", scenarios: passed, errors, remote }, null, 2));
  console.log(`PASS: ${passed.length} connection maintenance scenarios; synthetic IPC only.`);
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: String(error), completedScenarios: passed, errors, remote }, null, 2));
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, `failure-${index}.txt`), await page.locator("body").innerText().catch(() => "")).catch(() => {});
  }
  throw error;
} finally { await browser.close(); await server.close(); }
