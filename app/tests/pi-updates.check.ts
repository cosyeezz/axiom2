// Actual desktop page with fixture IPC; never installs packages on the host.
import assert from "node:assert/strict";
import { assertComponentTree, ensureComponentActions } from "./component-layout-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = resolve(process.env.AXIOM_PI_OUTPUT || process.env.AXIOM_TEST_ARTIFACTS || "test-results/pi-updates");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(() => {
    const state = {
      version: null as string | null, runtimeVersion: "1.1.0" as string | null, release: null as any, job: null as any, missing: true, execution: null as any,
      failCheck: false, checkDelay: 0, legacy: false, cliError: "", repairRequired: false, clientInstaller: null as any, clientVersion: '0.4.1', holdStatus: false,
      held: null as (() => void) | null, calls: [] as any[], unexpected: [] as string[],
    };
    (window as any).piFixture = state;
    const snapshot = () => ({
      clientVersion: state.clientVersion, serviceVersion: state.missing ? null : "0.4.1", serviceInstallation: state.missing ? "absent" : "registered", managed: !state.missing, clientSupported: false, execution: state.execution,
      release: null, recovery: false, job: state.job && { ...state.job, task: { id: "fixture-" + state.job.kind, attemptId: "fixture-attempt", endpoint: "desktop", scope: "合成 Pi UI，无真实安装", resource: state.job.kind, label: state.job.message, action: state.job.kind, status: state.job.running ? "running" : state.job.phase === "error" ? "failed" : "succeeded", phase: "installing", steps: ["installing"], completedSteps: state.job.running ? 0 : 1, createdAt: state.job.startedAt ?? 1, updatedAt: Date.now(), budgets: { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 }, capabilities: { cancel: false, extend: false } } }, clientInstaller: state.clientInstaller, log: "/example/updates/update.log",
      pi: { runtimeVersion: state.missing ? null : state.runtimeVersion, cli: { version: state.version, legacy: state.legacy, error: state.cliError, repairRequired: state.repairRequired,
        packageRoot: "/example/node/lib/node_modules/@earendil-works/pi-coding-agent" }, release: state.release },
    });
    let theme = "dark", revision = 0;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_theme" && args.action === undefined) { if (args.theme) { theme = args.theme; revision++; } return { theme, revision }; }
      if (name === "axiom_service" && args.action === "status") return { desktopView: "control", state: state.missing ? "missing" : "running", active: ["现有任务"], url: "http://127.0.0.1:4317/" };
      if (name === "axiom_setup" && args.action === "check") return { nodeReady: true, nodeVersion: "v22.23.2", tailscale: true, writable: true, platform: "darwin" };
      if (name === "axiom_setup" && args.action === "status") return { job: null };
      if ((name === "axiom_setup" || name === "axiom_update") && args.action === "history") return { tasks: [] };
      if (name === "axiom_peers" && args.action === undefined) return { peers: [] };
      if (name === "axiom_reveal_path" && args.action === undefined) return null;
      if (name === "axiom_cleanup" && args.action === undefined && ["resources.get", "rea.get", "rtk.get", "opencli.get", "modelProxy.get"].includes(args.request?.op)) return { requestId: args.request.requestId, data: { revision: "empty-fixture", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
      if (name !== "axiom_update" || !["status", "pi-refresh", "pi-check", "pi"].includes(args.action)) {
        state.unexpected.push(name + ":" + args.action);
        throw Error("Unexpected IPC: " + name + ":" + args.action);
      }
      if (args.action === "status" && state.holdStatus) await new Promise<void>(resolve => { state.held = resolve; });
      if (args.action === "pi-check") {
        if (state.checkDelay) await new Promise(resolve => setTimeout(resolve, state.checkDelay));
        if (state.failCheck) throw Error("Pi 版本查询失败，请稍后重试。");
        state.release = { version: "1.1.1", token: "confirmed-token", checkedAt: Date.now() };
        state.job = { kind: "pi-check", running: false, phase: "complete", message: "版本检查完成。" };
      }
      if (args.action === "pi-refresh") state.job = { kind: "pi-refresh", running: false, phase: "complete", message: "Pi 安装状态读取完成。" };
      if (args.action === "pi") state.job = { kind: "pi", running: true, phase: "installing", message: "正在安装终端 Pi 1.1.1…", startedAt: Date.now() };
      return snapshot();
    } };
  });
  await page.clock.install();
  await page.goto(server.resolvedUrls!.local[0]);
  const maintenance = page.getByRole("region", { name: "版本与更新", exact: true });
  const backend = maintenance.getByRole("region", { name: "后台服务更新", exact: true });
  const installedSDK = backend.getByRole("region", { name: "后台服务的应用内 Pi 环境", exact: true });
  const pi = maintenance.getByRole("region", { name: "终端 Pi", exact: true });
  await pi.waitFor();
  await page.locator(".startup-preparation > summary").click();
  const entry = await pi.boundingBox(), preparation = await page.locator(".startup-preparation").boundingBox();
  assert.ok(entry && preparation && entry.y + entry.height <= preparation.y, "Pi controls precede expanded environment setup");
  await page.screenshot({ path: resolve(output, "pi-entry-with-setup.png"), fullPage: true });
  await page.locator(".startup-preparation > summary").click();
  await pi.getByText("未安装", { exact: true }).waitFor();
  assert.match(await installedSDK.innerText(), /应用内 Pi\s*当前\s*后台未安装/, "absence is explicit only when the backend installation is absent");
  assert.ok(await pi.getByText("独立使用的 Pi 命令行程序", { exact: true }).isVisible(), "CLI scope is visible without expanding evidence");
  assert.equal(await pi.locator(".component-details-toggle").count(), 0);
  await ensureComponentActions(pi);
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi-refresh").length), 1);
  const install = pi.getByRole("button", { name: "安装终端 Pi", exact: true });
  assert.ok(await install.isEnabled());
  await install.click();
  const initialDialog = pi.getByRole("group", { name: "安装终端 Pi 1.1.1？", exact: true });
  await initialDialog.waitFor();
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((call: any) => call.action === "pi-check").length), 1, "the initial install action checks a fresh release before confirmation");
  await initialDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((call: any) => call.action === "pi").length), 0);
  await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true }).click();
  await pi.getByText("可安装 v1.1.1", { exact: true }).waitFor({ state: "attached" });
  assert.ok(await install.isEnabled());
  assert.ok(await maintenance.getByRole("region", { name: "后台服务更新", exact: true }).getByText("未安装", { exact: true }).isVisible());
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((call: any) => call.action === "service").length), 0, "Pi installation is independent of background-service installation");
  await page.screenshot({ path: resolve(output, "pi-without-backend.png"), fullPage: true });
  await page.evaluate(() => { (window as any).piFixture.missing = false; });
  await page.clock.runFor(3100);
  await page.getByRole("button", { name: "关闭", exact: true }).waitFor();
  assert.equal(await pi.locator(".component-details-toggle").count(), 0);
  await installedSDK.filter({ hasText: "v1.1.0" }).waitFor();
  // Reproduce the reported mismatch: the CLI can be current while the app SDK is older.
  await page.evaluate(() => { const f = (window as any).piFixture; f.version = "1.4.0"; f.release = { version: "1.4.0", token: "latest-cli-token", checkedAt: Date.now() }; });
  await page.clock.runFor(2100);
  await pi.getByText("终端已是最新版本", { exact: true }).waitFor({ state: "attached" });
  assert.match(await pi.locator(".component-card-version").innerText(), /当前\s+v1\.4\.0/);
  assert.match(await installedSDK.innerText(), /v1\.1\.0/);
  assert.doesNotMatch(await installedSDK.innerText(), /1\.4\.0|最新/);
  await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).click();
  await pi.getByRole("status").filter({ hasText: "终端 Pi 已是最新版本。" }).waitFor();
  assert.equal(await maintenance.locator(".component-confirmation").count(), 0);
  await page.screenshot({ path: resolve(output, "sdk-1.1-cli-1.4.png"), fullPage: true });
  // Unknown SDK metadata must never borrow the known CLI version or imply absence.
  await page.evaluate(() => { (window as any).piFixture.runtimeVersion = null; });
  await page.clock.runFor(2100);
  await installedSDK.filter({ hasText: "版本未能读取" }).waitFor();
  assert.doesNotMatch(await installedSDK.innerText(), /1\.4\.0|后台未安装/);
  await page.evaluate(() => { (window as any).piFixture.missing = true; });
  await page.clock.runFor(3100);
  await installedSDK.filter({ hasText: "后台未安装" }).waitFor();
  assert.ok(await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true }).isEnabled(), "CLI maintenance remains independent of backend installation");
  await page.evaluate(() => { const f = (window as any).piFixture; f.missing = false; f.runtimeVersion = "1.1.0"; f.version = null; f.release = { version: "1.1.1", token: "confirmed-token", checkedAt: Date.now() }; });
  await page.clock.runFor(3100);
  await installedSDK.filter({ hasText: "v1.1.0" }).waitFor();
  await pi.getByText(/^未安装/).waitFor();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  assert.ok(await backend.locator(":scope > .component-card-notes").getByText(/应用内 Pi 随后台服务更新.*并非运行中进程的版本查询/).isVisible());
  const location = pi.locator(":scope > .maintenance-panel-heading .component-card-location .local-path");
  assert.ok(await location.isVisible(), "Pi path is directly below its name without a disclosure");
  assert.equal(await pi.locator(":scope > .maintenance-panel-heading .component-card-candidate").innerText(), "最新 v1.1.1", "candidate row shows the latest version with a two-character label");
  await location.hover();
  await location.getByRole("button", { name: "复制路径", exact: true }).click();
  await location.getByRole("status").filter({ hasText: "已复制路径" }).waitFor();
  const packageRoot = "/example/node/lib/node_modules/@earendil-works/pi-coding-agent";
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), packageRoot);
  await location.getByRole("button", { name: "打开所在文件夹", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.name === "axiom_reveal_path")), [{ name: "axiom_reveal_path", path: packageRoot }]);
  assert.equal(await location.locator("button").first().evaluate(node => getComputedStyle(node).borderTopWidth), "0px", "standalone page loads shared action styles");
  assert.equal(await pi.locator(".component-details-toggle").count(), 0);
  const widths = [1100, 760, 600, 430, 390, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
    await ensureComponentActions(pi);
    await assertComponentTree(pi); await assertComponentTree(backend);
    const boxes = await pi.locator("button:visible").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
    assert.ok(boxes.every(box => box.left >= 0 && box.right <= width + 1), `Pi actions remain inside ${width}px viewport`);
    await page.screenshot({ path: resolve(output, `page-${width}.png`), fullPage: true });
  }
  await install.click();
  const dialog = pi.getByRole("group", { name: "安装终端 Pi 1.1.1？", exact: true });
  await dialog.waitFor();
  assert.ok(await dialog.getByText(/安装位置：/).isVisible());
  assert.ok(await dialog.getByText(/仅管理独立终端程序，应用内 Pi 引擎随后台服务更新/).isVisible());
  assert.equal(await dialog.getByText("现有任务", { exact: true }).count(), 0);
  await page.screenshot({ path: resolve(output, "install-dialog-360.png") });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(await install.evaluate(node => document.activeElement === node));
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi").length), 0);

  // A current safety gate can invalidate an open confirmation without changing its frozen target.
  await install.click();
  await page.evaluate(() => { (window as any).piFixture.release.token = null; });
  await page.clock.runFor(2100);
  const acceptInstall = dialog.getByRole("button", { name: "确认安装终端 Pi", exact: true });
  await acceptInstall.and(page.locator(":disabled")).waitFor();
  await acceptInstall.dispatchEvent("click");
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi").length), 0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => { (window as any).piFixture.release.token = "confirmed-token"; });
  await page.clock.runFor(2100);
  await install.and(page.locator(":enabled")).waitFor();

  // Polling may change the latest release, but never the version being confirmed.
  await install.click();
  await page.evaluate(() => { (window as any).piFixture.release = { version: "1.1.2", token: "new-token", checkedAt: Date.now() }; });
  await page.clock.runFor(2100);
  assert.ok(await dialog.isVisible());
  await page.evaluate(() => { (window as any).piFixture.holdStatus = true; });
  await page.clock.runFor(2100);
  await page.waitForFunction(() => !!(window as any).piFixture.held);
  await dialog.getByRole("button", { name: "确认安装终端 Pi", exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi").length), 0);
  await page.evaluate(() => { const f = (window as any).piFixture; f.holdStatus = false; f.held(); });
  await pi.locator(".maintenance-task").getByText("安装中", { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).piFixture.execution = { lines: ["npm http fetch GET 200 https://registry.npmjs.org/pi 200ms"], updatedAt: Date.now() }; });
  await page.clock.runFor(2100);
  assert.equal(await pi.getByText("执行详情", { exact: true }).count(), 0);
  assert.equal(await pi.getByText(/npm http fetch GET 200/).count(), 0, "execution evidence remains internal, not a log viewer");
  assert.ok(await pi.getByText(/安装期间无法计算整体百分比/).isVisible());
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.find((c: any) => c.action === "pi").version), "confirmed-token");
  // Disabled header operations stay in the DOM but are hidden (display:none).
  const hiddenInstall = pi.getByRole("button", { name: "安装终端 Pi", exact: true, includeHidden: true });
  assert.ok(await hiddenInstall.isDisabled() && await hiddenInstall.isHidden(), "unavailable install is disabled and hidden");
  assert.equal(await pi.getAttribute("aria-busy"), "true", "installation is represented as real busy state, not a second version panel");
  assert.ok(await page.locator(".connection-primary-button").isDisabled(), "service control remains locked while terminal installation is running");
  await page.evaluate(() => {
    const f = (window as any).piFixture;
    f.version = "1.1.1"; f.release = { version: "1.1.1", token: "installed-token", checkedAt: Date.now() };
    f.job = { kind: "pi", running: false, phase: "complete", message: "终端 Pi 已安装至 1.1.1" };
  });
  await page.clock.runFor(2100);
  await pi.getByText("终端已是最新版本", { exact: true }).waitFor({ state: "attached" });
  assert.match(await installedSDK.innerText(), /v1\.1\.0/, "terminal installation leaves the displayed SDK version unchanged");
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "service").length), 0, "terminal maintenance must not submit a backend update");
  await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).click();
  await pi.getByRole("status").filter({ hasText: "终端 Pi 已是最新版本。" }).waitFor();
  assert.equal(await maintenance.locator(".component-confirmation").count(), 0, "an up-to-date installation must not open a redundant install confirmation");
  assert.ok(await page.getByRole("button", { name: "关闭", exact: true }).isEnabled());

  await page.evaluate(() => { const f = (window as any).piFixture; f.job = { kind: "pi", running: false, phase: "error", message: "终端 Pi 未通过运行验证" }; f.repairRequired = true; f.release.token = null; });
  await page.clock.runFor(2100);
  assert.ok(await pi.getByText("安装状态已变化，请重新检查更新。", { exact: true }).isVisible());
  await pi.getByRole("button", { name: "重新安装终端 Pi", exact: true }).click();
  const repairDialog = pi.getByRole("group", { name: "更新终端 Pi 1.1.1？", exact: true });
  await repairDialog.waitFor();
  assert.equal(await page.evaluate(() => (window as any).piFixture.release.token), "confirmed-token", "a stale repair token is refreshed before showing confirmation");
  await repairDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(await pi.getByRole("button", { name: "重新安装终端 Pi", exact: true }).isEnabled());
  assert.equal(await pi.getByText("终端已是最新版本", { exact: true }).count(), 0);

  assert.equal(await page.evaluate(() => (window as any).piFixture.job.kind), "pi-check", "fixture must reproduce production task replacement");
  await page.evaluate(() => { (window as any).piFixture.job = { kind: "pi-refresh", running: false, phase: "complete", message: "Pi 安装状态读取完成。" }; });
  await page.clock.runFor(2100);
  assert.ok(await pi.getByRole("button", { name: "重新安装终端 Pi", exact: true }).isEnabled(), "a refreshed task snapshot cannot erase the independent repair requirement");
  await page.evaluate(() => { const f = (window as any).piFixture; f.clientInstaller = { version: "0.4.2", readyAt: Date.now() }; f.job = { kind: "client", phase: "ready", running: false, message: "安装包已就绪" }; });
  await page.clock.runFor(2100);
  await page.getByRole("button", { name: "安装更新", exact: true }).waitFor();
  await page.evaluate(() => { (window as any).piFixture.job = { kind: "pi-refresh", running: false, phase: "complete", message: "Pi 安装状态读取完成。" }; });
  await page.clock.runFor(2100);
  await page.getByRole("button", { name: "安装更新", exact: true }).click();
  const installerDialog = maintenance.getByRole("region", { name: "客户端更新", exact: true }).getByRole("group", { name: "打开客户端安装向导？", exact: true });
  await installerDialog.waitFor();
  await installerDialog.getByRole("button", { name: "取消", exact: true }).click();
  for (const clientVersion of ["0.4.2", "0.5.0"]) {
    await page.evaluate(version => { (window as any).piFixture.clientVersion = version; }, clientVersion);
    await page.clock.runFor(2100);
    assert.equal(await page.getByRole("button", { name: "安装更新", exact: true }).count(), 0, `installed client ${clientVersion} must not offer an old installer`);
  }
  await page.evaluate(() => { const f = (window as any).piFixture; f.version = "1.0.0"; f.clientVersion = "0.4.1"; f.job = null; f.repairRequired = false; f.clientInstaller = null; });
  await page.clock.runFor(2100);
  await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).click();
  const updateConfirmation = pi.getByRole("group", { name: "更新终端 Pi 1.1.1？", exact: true });
  await updateConfirmation.waitFor();
  await updateConfirmation.getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).isEnabled());
  assert.equal(await pi.getByText("可安装 v1.1.1", { exact: true }).count(), 1, "comparison remains available in deferred evidence");

  await page.evaluate(() => { (window as any).piFixture.failCheck = true; });
  await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true }).click();
  const checkFailure = pi.getByRole("status").filter({ hasText: "Pi 版本查询失败，请稍后重试。" });
  await checkFailure.waitFor();
  assert.equal(await pi.getByRole("alert").count(), 0, "read-only check failures remain neutral and do not imply a failed installation");
  await page.clock.runFor(2100);
  assert.ok(await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true }).isEnabled());
  await page.evaluate(() => { const f = (window as any).piFixture; f.failCheck = false; f.legacy = true; });
  await page.clock.runFor(2100);
  await pi.getByText(/^需要迁移/).waitFor();
  assert.equal(await pi.getByText(/可安装 v|终端已是最新版本/).count(), 0, "legacy CLI metadata cannot claim release comparison results");
  await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).click();
  await pi.getByRole("alert").filter({ hasText: "请先通过原安装方式迁移旧版 Pi。" }).waitFor();
  assert.equal(await maintenance.locator(".component-confirmation").count(), 0, "legacy installations cannot reach install confirmation");
  await page.evaluate(() => { const f = (window as any).piFixture; f.legacy = false; f.cliError = "无法读取 npm 全局安装"; });
  await page.clock.runFor(2100);
  await pi.getByText(/^状态读取失败/).waitFor();
  assert.equal(await pi.getByText(/可安装 v|终端已是最新版本/).count(), 0, "unreadable CLI metadata cannot display a cached latest claim");
  assert.match(await installedSDK.innerText(), /v1\.1\.0/, "CLI read failure does not erase independently known SDK metadata");
  await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).click();
  assert.equal(await maintenance.locator(".component-confirmation").count(), 0, "failed installation-state reads cannot reach install confirmation");
  await page.evaluate(() => { const f = (window as any).piFixture; f.cliError = ""; f.checkDelay = 32000; });
  await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true }).click();
  await page.clock.runFor(30000);
  assert.ok(await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true, includeHidden: true }).isDisabled());
  assert.equal(await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true, includeHidden: true }).getAttribute("aria-busy"), "true");
  await page.clock.runFor(3000);
  assert.ok(await pi.getByRole("button", { name: "检查终端 Pi 更新", exact: true }).isEnabled());
  assert.equal(await pi.getByRole("alert").count(), 0);
  assert.equal(await page.locator(".startup-global-error").count(), 0, "no caught IPC errors hidden from pageerror checks");
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((call: any) => call.action === "pi").length), 1, "only the explicit frozen-snapshot confirmation submitted installation");
  const unexpected = await page.evaluate(() => (window as any).piFixture.unexpected);
  assert.deepEqual(unexpected, [], "unknown IPC names or actions must never receive fixture success");
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, widths, errors, unexpected, scope: "actual React page with fixture IPC; no real installation" }, null, 2));
  console.log("Pi UI passed: fresh install, upgrade, confirmation snapshot, queued polling, progress, errors, legacy and six widths.");
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, `failure-${index}.txt`), await page.locator("body").innerText()).catch(() => {});
  }
  throw error;
} finally { await browser.close(); await server.close(); }
