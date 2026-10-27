// Isolated card fixture. All maintenance and filesystem actions are captured, never executed.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { emptyReaState, type ReaState } from "../src/shared/rea.js";

const downloadDirectory = "/fixture/integrations/rea/downloads/hopper-" + "long-name-".repeat(12);
const base: ReaState = { ...emptyReaState, revision: "config-1", supported: true, version: "6.8.0", engineHost: { platform: "darwin", arch: "arm64" }, engines: [{ id: "hopper", revision: "engine-1", path: "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper", configured: false, status: "detected", detail: "", installable: false, version: "6.6.0-demo", recommendedVersion: "6.6.0", download: { version: "6.6.0", path: downloadDirectory + "/package.dmg" } }], downloadCleanup: { hopper: { revision: "a".repeat(64), paths: [downloadDirectory] } } };
const server = await createServer({ root: resolve("."), configFile: false, server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" } });
const artifacts = resolve(process.env.AXIOM_HOPPER_SCREENSHOTS ?? "test-results/rea-hopper"); mkdirSync(artifacts, { recursive: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors: string[] = [], pathCalls: unknown[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name = value => value;");
  await page.route("**/api/status", route => route.fulfill({ json: { ok: true } }));
  await page.routeWebSocket("**/ws", ws => { ws.onMessage(message => {
    const request = JSON.parse(String(message));
    if (request.op === "paths.reveal") pathCalls.push(request.params);
    else assert.ok(["subscribe", "unsubscribe", "ping"].includes(request.op), `unexpected command ${request.op}`);
    ws.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: true, data: null }));
  }); });
  await page.route("**/__hopper_fixture", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/rea-hopper.tsx"></script></body></html>' }));
  const url = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__hopper_fixture`;
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).hopperFixture);
  const reset = async (state: ReaState, flags: Record<string, unknown> = {}) => {
    await page.evaluate(({ state, flags }) => (window as any).hopperFixture.reset(state, flags), { state, flags });
    await page.waitForFunction(value => document.querySelector("main")?.getAttribute("data-fixture-state") === value, JSON.stringify({ state, flags }));
  };
  const calls = () => page.evaluate(() => (window as any).hopperFixture.calls);
  await reset(base);
  const panel = page.getByRole("region", { name: "Hopper维护", exact: true });
  const cleanup = panel.getByRole("button", { name: "清理安装包", exact: true });
  const uninstall = panel.getByRole("button", { name: "卸载说明", exact: true });
  const confirmation = panel.getByRole("group", { name: "确认清理Hopper安装包", exact: true });
  await panel.getByText("已安装 · 待许可验证", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "安装Hopper", exact: true }).count(), 0);
  assert.equal(await panel.getByRole("button", { name: "卸载托管组件", exact: true }).count(), 0);
  assert.equal(await cleanup.isEnabled(), true);
  await uninstall.click();
  const instructions = panel.getByRole("group", { name: "Hopper卸载说明", exact: true });
  assert.match(await instructions.innerText(), /外部应用.*不会直接删除[\s\S]*运行后台的 Mac.*移到废纸篓/);
  await instructions.locator(".local-path").hover();
  await instructions.getByRole("button", { name: "在后台 Mac 打开应用所在文件夹", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  assert.deepEqual(pathCalls, [{ path: "/Applications" }], "navigate to parent; never open/execute or delete the app bundle");
  assert.deepEqual(await calls(), []);

  await cleanup.click();
  assert.match(await confirmation.innerText(), /保留已安装程序.*系统安装器的副本/);
  // Expanded instructions, confirmation and long paths must remain usable in both themes.
  for (const theme of ["dark", "light"]) for (const width of [320, 390, 820, 1440]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `${theme} overflow at ${width}`);
    for (const button of await panel.getByRole("button").all()) {
      const box = await button.boundingBox(); assert.ok(box && box.height >= 44, `${theme} target ${await button.innerText()} at ${width}`);
    }
    if ([390, 1440].includes(width)) await page.screenshot({ path: join(artifacts, `hopper-${theme}-${width}.png`), fullPage: true });
  }
  await confirmation.getByRole("button", { name: "暂不清理", exact: true }).click();
  assert.deepEqual(await calls(), [], "canceling confirmation never sends a cleanup");
  await panel.getByRole("button", { name: "收起说明", exact: true }).click();
  const staleStates: ReaState[] = [
    { ...base, revision: "config-2" },
    { ...base, downloadCleanup: { hopper: { paths: [downloadDirectory], revision: "b".repeat(64) } } },
    { ...base, downloadCleanup: {} },
    { ...base, downloadCleanupErrors: { hopper: "归属记录已变化" } },
  ];
  for (const changed of staleStates) {
    await reset(base); await cleanup.click(); await reset(changed);
    await confirmation.getByRole("alert").waitFor();
    assert.equal(await confirmation.getByRole("button", { name: "确认清理安装包", exact: true }).isDisabled(), true);
    await confirmation.getByRole("button", { name: "暂不清理", exact: true }).click();
  }
  await reset(base); await cleanup.click(); await reset(base, { busy: true });
  assert.equal(await confirmation.getByRole("button", { name: "确认清理安装包", exact: true }).isDisabled(), true);
  await confirmation.getByRole("button", { name: "暂不清理", exact: true }).click();
  await reset({ ...base, downloadCleanup: {}, downloadCleanupErrors: { hopper: "缺少原始维护归属证明，已保留。" } });
  assert.equal(await cleanup.isDisabled(), true);
  assert.match(await panel.innerText(), /暂不能自动清理.*归属证明/);
  await reset({ ...base, downloadCleanup: undefined });
  assert.equal(await cleanup.isDisabled(), true, "older hosts without a proven scope cannot authorize cleanup");
  for (const flags of [{ busy: true }, { blocked: true }, { sending: ["rea:hopper"] }]) {
    await reset(base, flags); assert.equal(await cleanup.isDisabled(), true);
  }
  await reset(base); await cleanup.click();
  await confirmation.getByRole("button", { name: "确认清理安装包", exact: true }).click();
  assert.deepEqual(await calls(), [{ op: "rea.clearDownloads", params: { engine: "hopper", revision: "config-1", cleanupRevision: "a".repeat(64), confirm: true } }]);
  const installedOnly: ReaState = { ...base, engines: [{ ...base.engines![0], download: undefined }], downloadCleanup: { hopper: { revision: "c".repeat(64), paths: [] } }, jobs: [{ id: "cleaned", engine: "hopper", kind: "clearDownloads", running: false, message: "已清理选定登记下载包；程序、引擎和未登记文件已保留。" }] };
  await reset(installedOnly);
  await panel.getByRole("status").filter({ hasText: "已清理选定登记下载包" }).waitFor();
  assert.equal(await cleanup.count(), 0); assert.equal(await uninstall.count(), 1);
  assert.equal(await panel.getByRole("button", { name: "安装Hopper", exact: true }).count(), 0);
  await reset({ ...base, engines: [{ ...base.engines![0], path: "", version: undefined, status: "missing" }] });
  assert.equal(await uninstall.count(), 0); assert.equal(await cleanup.isEnabled(), true);
  await panel.getByText("已下载 · 待安装", { exact: true }).waitFor();
  await reset({ ...base, engines: [{ ...base.engines![0], recommendedVersion: "6.6.1", download: { version: "6.6.1", path: downloadDirectory + "/package.dmg" } }] });
  assert.equal(await panel.getByRole("button", { name: "安装Hopper", exact: true }).count(), 1, "new official versions can still be installed");
  await reset({ ...installedOnly, engineHost: { platform: "linux", arch: "x64" }, engines: [{ ...installedOnly.engines![0], path: "/opt/hopper/bin/Hopper" }] });
  await uninstall.click();
  assert.match(await instructions.innerText(), /使用原安装方式卸载/);
  assert.equal(await instructions.getByRole("button", { name: "在后台电脑定位程序", exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log("Hopper UI passed: demo version recognition, system uninstall guidance, safe folder navigation, scoped cache cleanup/cancel/stale/error/busy, installed-only/download-only/Linux states, two themes × four widths; no real installation or deletion.");
} finally { await browser?.close(); await server.close(); }
