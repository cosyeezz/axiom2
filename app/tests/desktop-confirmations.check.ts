// Actual desktop React pages with synthetic IPC only. Never invokes a native helper.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";
const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/desktop-confirmations");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [], passed: string[] = [];
async function scene(options: { recovery?: boolean; interrupted?: boolean; installer?: boolean } = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(options => {
    const task = (kind: string, status = "succeeded") => ({ id: "fixture-" + kind, attemptId: "fixture-attempt", endpoint: "desktop", scope: "界面合成测试，无真实操作", resource: kind, label: kind, action: kind, status, phase: "installing", steps: ["installing"], completedSteps: 1, createdAt: Date.now(), updatedAt: Date.now(), budgets: { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 }, capabilities: { cancel: false, extend: false } });
    const state = {
      calls: [] as { name: string; action?: string; version?: string | null; confirmed?: boolean }[], unexpected: [] as string[],
      makeTask: task,
      stopped: false, clientVersion: "0.4.1", recovery: !!options.recovery, job: (options.installer ? { kind: "client", version: "0.4.2", running: false, phase: "ready", message: "安装包已经校验", task: task("client") } : null) as any,
      setupJob: options.interrupted ? { id: "fixture-node", action: "node", running: false, phase: "interrupted", message: "安装器状态待核实", lines: [], task: task("node", "interrupted") } : null as any,
      removal: null as any,
    };
    (window as any).desktopConfirmFixture = state;
    let theme = "dark", revision = 0;
    const snapshot = () => ({ clientVersion: state.clientVersion, serviceVersion: "0.4.1", managed: true, clientSupported: true, release: { version: "0.4.2", checkedAt: Date.now(), assets: { "Axiom2.msi": { url: "https://example.invalid/Axiom2.msi" } } }, job: state.job, recovery: state.recovery, log: "C:/fixture/update.log", pi: { runtimeVersion: "1.1.0", cli: { version: "1.1.0", packageRoot: "C:/fixture/npm/pi" }, release: { version: "1.1.1", checkedAt: 1, token: "pi-token" }, removal: state.removal } });
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_theme" && args.action === undefined) { if (args.theme) { theme = args.theme; revision++; } return { theme, revision }; }
      if (name === "axiom_service" && ["status", "stop"].includes(args.action)) { if (args.action === "stop") state.stopped = true; return { desktopView: "control", state: state.stopped ? "stopped" : "running", active: ["设计会话", "代码检查"], url: "http://127.0.0.1:4317/" }; }
      if (name === "axiom_peers" && args.action === undefined) return { peers: [] };
      if (name === "axiom_setup") {
        if (args.action === "check") return { nodeReady: true, nodeVersion: "v24.13.0", writable: true, tailscale: true, platform: "windows" };
        if (args.action === "status") return { job: state.setupJob };
        if (args.action === "acknowledge-interruption") { if (args.confirmed !== true) throw Error("缺少人工确认"); state.setupJob = { ...state.setupJob, phase: "error", task: task("node", "failed") }; return { job: state.setupJob }; }
      }
      if (name === "axiom_update") {
        if (["status", "pi-refresh", "pi-check"].includes(args.action)) return snapshot();
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
  await page.getByRole("button", { name: "关闭后台服务", exact: true }).waitFor();
  return page;
}
async function count(page: Page, name: string, action: string) { return page.evaluate(({ name, action }) => (window as any).desktopConfirmFixture.calls.filter((call: any) => call.name === name && call.action === action).length, { name, action }); }
async function checkUnexpected(page: Page) { assert.deepEqual(await page.evaluate(() => (window as any).desktopConfirmFixture.unexpected), []); }
async function updates(page: Page) {
  const region = page.getByRole("region", { name: "版本与更新", exact: true });
  await region.waitFor();
  assert.equal(await region.locator(".update-component").count(), 3, "all three update components remain visible without opening technical details");
}
try {
  {
    const page = await scene(), trigger = page.getByRole("button", { name: "关闭后台服务", exact: true });
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
    await trigger.click(); const dialog = page.getByRole("dialog", { name: "更新后台至 0.4.2？", exact: true }), accept = dialog.getByRole("button", { name: "确认更新服务", exact: true });
    assert.match(await dialog.locator(".confirm-warning").innerText(), /当前数据目录独占此安装.*共用安装/);
    await dialog.locator("summary").filter({ hasText: "受影响的会话 · 2" }).click();
    assert.match(await dialog.innerText(), /代码检查/);
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
    const dialog = page.getByRole("dialog", { name: "打开客户端安装向导？", exact: true }), accept = dialog.getByRole("button", { name: "打开安装向导", exact: true });
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
    await trigger.click(); const dialog = page.getByRole("dialog", { name: "恢复之前的服务版本？", exact: true }); assert.match(await dialog.locator(".confirm-warning").innerText(), /当前数据目录独占此安装.*共用安装/);
    await page.keyboard.press("Escape"); assert.equal(await count(page, "axiom_update", "recover"), 0);
    await trigger.click(); await dialog.getByRole("button", { name: "确认恢复", exact: true }).click(); assert.equal(await count(page, "axiom_update", "recover"), 1);
    await checkUnexpected(page); await page.close(); passed.push("recovery: risk warning, cancellation and explicit recovery");
  }
  {
    const page = await scene({ interrupted: true }); await page.locator(".startup-preparation > summary").click();
    const trigger = page.getByRole("button", { name: /^确认安装器退出后/ }); await trigger.click();
    const dialog = page.getByRole("dialog", { name: "确认安装器已退出？", exact: true }); assert.match(await dialog.innerText(), /重复安装/);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await count(page, "axiom_setup", "acknowledge-interruption"), 0);
    await trigger.click(); await dialog.getByRole("button", { name: "我已确认安装器全部退出", exact: true }).click();
    assert.equal(await count(page, "axiom_setup", "acknowledge-interruption"), 1); assert.equal(await page.evaluate(() => (window as any).desktopConfirmFixture.calls.find((call: any) => call.action === "acknowledge-interruption").confirmed), true);
    await checkUnexpected(page); await page.close(); passed.push("installer-exit: explicit manual confirmation and cancellation");
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
  assert.deepEqual(errors, []); await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, scope: "Actual React pages with synthetic IPC only; no real installation/removal", scenarios: passed, errors }, null, 2));
  console.log(`PASS: ${passed.length} actual-page desktop confirmation scenarios; synthetic IPC only.`);
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await server.close(); }
