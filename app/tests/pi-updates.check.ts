// Actual desktop page with fixture IPC; never installs packages on the host.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = resolve(process.env.AXIOM_PI_OUTPUT || "test-results/pi-updates");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(() => {
    const state = {
      version: null as string | null, release: null as any, job: null as any,
      failCheck: false, checkDelay: 0, legacy: false, cliError: "", holdStatus: false,
      held: null as (() => void) | null, calls: [] as any[],
    };
    (window as any).piFixture = state;
    const snapshot = () => ({
      clientVersion: "0.4.1", serviceVersion: "0.4.1", managed: true, clientSupported: false,
      release: null, recovery: false, job: state.job, log: "/example/updates/update.log",
      pi: { runtimeVersion: "1.1.0", cli: { version: state.version, legacy: state.legacy, error: state.cliError,
        packageRoot: "/example/node/lib/node_modules/@earendil-works/pi-coding-agent" }, release: state.release },
    });
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_service") return { desktopView: "control", state: "running", active: ["现有任务"], url: "http://127.0.0.1:4317/" };
      if (name === "axiom_setup") return args.action === "check" ? { nodeReady: true, nodeVersion: "v22.23.2", tailscale: true, writable: true, platform: "darwin" } : { job: null };
      if (name === "axiom_peers") return { peers: [] };
      if (name !== "axiom_update") throw Error("Unexpected IPC: " + name);
      if (args.action === "status" && state.holdStatus) await new Promise<void>(resolve => { state.held = resolve; });
      if (args.action === "pi-check") {
        if (state.checkDelay) await new Promise(resolve => setTimeout(resolve, state.checkDelay));
        if (state.failCheck) throw Error("Pi 版本查询失败，请稍后重试。");
        state.release = { version: "1.1.1", token: "confirmed-token", checkedAt: Date.now() };
      }
      if (args.action === "pi") state.job = { kind: "pi", running: true, phase: "installing", message: "正在安装终端 Pi 1.1.1…" };
      return snapshot();
    } };
  });
  await page.clock.install();
  await page.goto(server.resolvedUrls!.local[0]);
  await page.locator(".startup-maintenance > summary").click();
  const pi = page.getByRole("region", { name: "Pi 引擎" });
  await pi.getByText("未安装", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi-refresh").length), 1);
  assert.ok(await pi.getByRole("button", { name: "安装终端 Pi", exact: true }).isDisabled());
  await pi.getByRole("button", { name: "检查 Pi 更新", exact: true }).click();
  const install = pi.getByRole("button", { name: "安装终端 Pi · 1.1.1", exact: true });
  await install.waitFor();
  assert.ok(await install.isEnabled());
  assert.equal(await pi.locator(".connect-pi-location").getAttribute("open"), null);
  const widths = [1100, 760, 600, 430, 390, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
    const boxes = await pi.locator(".connect-versions > div").evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
    assert.ok(boxes[0].right <= boxes[1].left && boxes[1].right <= boxes[2].left, `three version columns at ${width}`);
    await page.screenshot({ path: resolve(output, `page-${width}.png`), fullPage: true });
  }
  await install.click();
  const dialog = page.getByRole("dialog", { name: "安装终端 Pi 1.1.1？", exact: true });
  await dialog.waitFor();
  assert.ok(await dialog.getByText(/安装位置：/).isVisible());
  assert.equal(await dialog.getByText("现有任务", { exact: true }).count(), 0);
  await page.screenshot({ path: resolve(output, "install-dialog-360.png") });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(await install.evaluate(node => document.activeElement === node));
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi").length), 0);

  // Polling may change the latest release, but never the version being confirmed.
  await install.click();
  await page.evaluate(() => { (window as any).piFixture.release = { version: "1.1.2", token: "new-token", checkedAt: Date.now() }; });
  await page.clock.runFor(2100);
  assert.ok(await dialog.isVisible());
  await page.evaluate(() => { (window as any).piFixture.holdStatus = true; });
  await page.clock.runFor(2100);
  await page.waitForFunction(() => !!(window as any).piFixture.held);
  await dialog.getByRole("button", { name: "确认安装 Pi", exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.filter((c: any) => c.action === "pi").length), 0);
  await page.evaluate(() => { const f = (window as any).piFixture; f.holdStatus = false; f.held(); });
  await pi.getByRole("status").waitFor();
  assert.equal(await page.evaluate(() => (window as any).piFixture.calls.find((c: any) => c.action === "pi").version), "confirmed-token");
  assert.ok(await pi.getByRole("button", { name: /正在安装/ }).isDisabled());
  assert.ok(await page.getByRole("button", { name: "关闭后台服务", exact: true }).isDisabled());
  await page.evaluate(() => {
    const f = (window as any).piFixture;
    f.version = "1.1.1"; f.release = { version: "1.1.1", token: "installed-token", checkedAt: Date.now() };
    f.job = { kind: "pi", running: false, phase: "complete", message: "终端 Pi 已安装至 1.1.1" };
  });
  await page.clock.runFor(2100);
  await pi.getByText("终端 Pi 已是最新版本。", { exact: true }).waitFor();
  assert.ok(await pi.getByRole("button", { name: "更新终端 Pi", exact: true }).isDisabled());
  assert.ok(await page.getByRole("button", { name: "关闭后台服务", exact: true }).isEnabled());

  await page.evaluate(() => { const f = (window as any).piFixture; f.job = { kind: "pi", running: false, phase: "error", message: "终端 Pi 未通过运行验证" }; f.release.token = null; });
  await page.clock.runFor(2100);
  assert.ok(await pi.getByRole("button", { name: "重新安装终端 Pi", exact: true }).isDisabled());
  assert.ok(await pi.getByText("安装状态已变化，请先重新检查 Pi 更新，再确认安装。", { exact: true }).isVisible());
  await pi.getByRole("button", { name: "检查 Pi 更新", exact: true }).click();
  assert.ok(await pi.getByRole("button", { name: "重新安装终端 Pi", exact: true }).isEnabled());
  assert.equal(await pi.getByText("终端 Pi 已是最新版本。", { exact: true }).count(), 0);

  await page.evaluate(() => { const f = (window as any).piFixture; f.version = "1.0.0"; f.job = null; });
  await pi.getByRole("button", { name: "刷新 Pi 安装状态", exact: true }).click();
  await pi.getByRole("button", { name: "更新终端 Pi · 1.1.1", exact: true }).click();
  await page.getByRole("dialog", { name: "更新终端 Pi 1.1.1？", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".startup-maintenance > summary > span").textContent(), "发现新版本");

  await page.evaluate(() => { (window as any).piFixture.failCheck = true; });
  await pi.getByRole("button", { name: "检查 Pi 更新", exact: true }).click();
  await pi.getByRole("alert").waitFor();
  await page.clock.runFor(2100);
  assert.match(await pi.getByRole("alert").textContent() || "", /版本查询失败/);
  await page.evaluate(() => { const f = (window as any).piFixture; f.failCheck = false; f.legacy = true; });
  await pi.getByRole("button", { name: "刷新 Pi 安装状态", exact: true }).click();
  await pi.getByText("需迁移", { exact: true }).waitFor();
  assert.ok(await pi.getByRole("button", { name: /更新终端 Pi/ }).isDisabled());
  await page.evaluate(() => { const f = (window as any).piFixture; f.legacy = false; f.cliError = "无法读取 npm 全局安装"; });
  await pi.getByRole("button", { name: "刷新 Pi 安装状态", exact: true }).click();
  await pi.getByText("读取失败", { exact: true }).waitFor();
  assert.ok(await pi.getByRole("button", { name: /更新终端 Pi/ }).isDisabled());
  await page.evaluate(() => { const f = (window as any).piFixture; f.cliError = ""; f.checkDelay = 32000; });
  await pi.getByRole("button", { name: "检查 Pi 更新", exact: true }).click();
  await page.clock.runFor(30000);
  assert.ok(await pi.getByRole("button", { name: "正在检查…", exact: true }).isDisabled());
  await page.clock.runFor(3000);
  assert.ok(await pi.getByRole("button", { name: "检查 Pi 更新", exact: true }).isEnabled());
  assert.equal(await pi.getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, widths, errors, scope: "actual React page with fixture IPC; no real installation" }, null, 2));
  console.log("Pi UI passed: fresh install, upgrade, confirmation snapshot, queued polling, progress, errors, legacy and six widths.");
} finally { await browser.close(); await server.close(); }
