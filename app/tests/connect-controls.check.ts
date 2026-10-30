// Actual Connect UI with synthetic IPC only. Preserves the original upper connection card.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium, type Page } from "playwright";

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/connect-controls");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const origin = server.resolvedUrls!.local[0];
const executablePath = process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath });
// Playwright's default Blink settings hard-code fine/hover hardware. CaptureScreenshot
// temporarily uses those defaults despite touch emulation; match the real touch device.
const touchBrowser = await chromium.launch({ executablePath, args: ["--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2"] });
const errors: string[] = [], remote: string[] = [], passed: string[] = [];
async function scene(savedAddress?: string, touch = false) {
  const page = await (touch ? touchBrowser : browser).newPage({ viewport: { width: 1100, height: 900 }, hasTouch: touch, isMobile: touch, reducedMotion: "reduce", serviceWorkers: "block" });
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => { if (route.request().url().startsWith(origin)) await route.continue(); else { remote.push(route.request().url()); await route.abort("blockedbyclient"); } });
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(savedAddress => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    if (savedAddress) { localStorage.setItem("axiom.connection.mode", "remote"); localStorage.setItem("axiom.remote.address", savedAddress); }
    const state: any = { calls: [], unexpected: [], view: "control", serviceState: "running", serviceError: "", download: "absent", connection: "connected", navigation: 0, delayStatus: false, releaseStatus: null, delayConnect: false, releaseConnect: null, connectError: "", controlsError: "", backendOrigin: "http://127.0.0.1:4317" };
    (window as any).connectControlsFixture = state;
    let theme = "dark", themeRevision = 0;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_theme") { if (args.theme) { theme = args.theme; themeRevision++; } return { theme, revision: themeRevision }; }
      if (name === "axiom_peers") return { peers: [{ name: "合成工作站", ip: "100.64.0.8" }] };
      if (name === "axiom_service") {
        if (args.action === "status" && state.delayStatus) { state.delayStatus = false; await new Promise<void>(resolve => { state.releaseStatus = resolve; }); }
        if (args.action === "status" && state.serviceError) throw Error(state.serviceError);
        if (args.action === "start") state.serviceState = "running";
        if (args.action === "stop") { state.serviceState = "stopped"; state.view = "control"; }
        return { desktopView: state.view, state: state.serviceState, active: ["合成设计会话", "合成代码检查"], artifact: { download: { state: state.download }, installation: { state: state.serviceState === "missing" ? "absent" : "verified" } }, background: true };
      }
      if (name === "axiom_setup") {
        if (args.action === "check") return { nodeReady: true, nodeVersion: "v24.13.0", writable: true, tailscale: true, platform: "darwin" };
        if (args.action === "status") return { job: null };
        if (args.action === "history") return { tasks: [] };
      }
      if (name === "axiom_update") {
        if (args.action === "history") return { tasks: [] };
        if (["status", "check", "pi-refresh", "pi-check"].includes(args.action)) return { clientVersion: "0.4.1", serviceVersion: "0.4.1", managed: true, clientSupported: false, release: { version: "0.4.2", checkedAt: Date.now(), assets: {} }, recovery: false, log: "/synthetic/never-read.log", job: null, pi: { runtimeVersion: "1.1.0", cli: { version: "1.1.0", packageRoot: "/synthetic/pi" }, release: null } };
      }
      if (name === "axiom_cleanup" && args.request?.op.endsWith(".get")) return { requestId: args.request.requestId, data: { revision: "empty-synthetic", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
      if (name === "axiom_controls") { if (state.controlsError) { const message = state.controlsError; state.controlsError = ""; throw Error(message); } ++state.navigation; state.view = "control"; return; }
      if (name === "axiom_connection") return state.connection;
      if (name === "axiom_backend_updates" && args.action === "get") return { runningVersion: "0.4.1", latest: null, checkedAt: null, checking: false, available: false, pending: false, error: null, sourceOrigin: state.backendOrigin };
      if (name === "axiom_local" || name === "axiom_remote") {
        const navigation = state.navigation;
        if (state.delayConnect) { state.delayConnect = false; await new Promise<void>(resolve => { state.releaseConnect = resolve; }); }
        if (state.connectError) throw Error(state.connectError);
        const url = new URL(name === "axiom_local" ? "http://127.0.0.1/" : args.address.includes("://") ? args.address : `http://${args.address}/`);
        url.port = String(args.port);
        if (navigation === state.navigation) { state.view = "workbench"; state.backendOrigin = url.origin; }
        return { url: url.href };
      }
      state.unexpected.push(name + ":" + args.action); throw Error("Unexpected synthetic IPC: " + name + ":" + args.action);
    } };
  }, savedAddress);
  await page.clock.install(); await page.goto(origin);
  if (savedAddress) await page.getByLabel("远程端口", { exact: true }).waitFor();
  else await page.locator('.connection-status-tag[data-state="running"]').waitFor();
  return page;
}
const upper = (page: Page) => page.locator(".startup-device");
const primary = (page: Page) => upper(page).locator(".connection-primary-button");
async function calls(page: Page, name: string, action?: string) { return page.evaluate(({ name, action }) => (window as any).connectControlsFixture.calls.filter((call: any) => call.name === name && (!action || call.action === action)), { name, action }); }
async function setService(page: Page, serviceState: string) {
  await page.evaluate(serviceState => Object.assign((window as any).connectControlsFixture, { serviceState, serviceError: "" }), serviceState);
  await page.clock.runFor(3100); await page.locator(`.connection-status-tag[data-state="${serviceState}"]`).waitFor();
}
async function choose(page: Page, name: string | RegExp) { await page.getByRole("combobox", { name: "连接设备", exact: true }).click(); await page.getByRole("option", { name }).click(); }
async function inputEquals(page: Page, label: string, value: string) {
  await page.waitForFunction(({ label, value }) => (document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null)?.value === value, { label, value });
  assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value);
}
async function clean(page: Page) { assert.deepEqual(await page.evaluate(() => (window as any).connectControlsFixture.unexpected), []); await page.close(); }
try {
  {
    const page = await scene();
    assert.equal(await page.locator(".startup-title h1").textContent(), "就绪之后，专注创造。");
    assert.equal(await page.locator(".startup-title > p").textContent(), "连接设备，管理本机服务与组件。");
    assert.equal(await page.getByRole("combobox", { name: "连接设备", exact: true }).isVisible(), true);
    assert.equal(await page.getByLabel("本地端口", { exact: true }).inputValue(), "4317");
    assert.equal(await upper(page).getByRole("button", { name: "连接工作台", exact: true }).isVisible(), true);
    assert.equal(await upper(page).getByText("本机后台服务", { exact: true }).isVisible(), true);
    assert.equal((await calls(page, "axiom_local")).length + (await calls(page, "axiom_remote")).length, 0, "never auto-connect");
    const checkUpdates = page.locator(".updates-section-heading").getByRole("button", { name: "检查更新", exact: true });
    assert.equal(await checkUpdates.isVisible(), true, "version overview provides a real, named check action without hover");
    assert.equal(await upper(page).getByRole("button", { name: "连接工作台", exact: true }).evaluate(node => document.activeElement === node), true, "initial focus favors navigation, never stopping the running service");
    const defaults: { theme: string; width: number; height: number }[] = [];
    for (const theme of ["dark", "light"]) for (const width of [1100, 390, 320]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      await page.screenshot({ path: resolve(output, `default-connect-${theme}-${width}.png`), fullPage: true });
      defaults.push({ theme, width, height: await page.locator(".connect-page").evaluate(element => element.getBoundingClientRect().height) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width} default fits`);
      assert.equal(await primary(page).evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "stopping the service stays secondary in both themes");
      assert.notEqual(await upper(page).getByRole("button", { name: "连接工作台", exact: true }).evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "connecting keeps a clear primary fill");
      for (const card of await page.locator(".updates-simple > .component-card").all()) assert.equal(await card.evaluate(node => getComputedStyle(node).borderTopWidth), "1px", "overview cards are not heavy focus-like frames");
      const subtitleLines = await page.locator(".updates-section-heading p").evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return range.getClientRects().length; });
      assert.equal(subtitleLines, 1, `${theme}/${width} concise subtitle never leaves an orphaned final character`);
    }
    await writeFile(resolve(output, "default-layout.json"), JSON.stringify(defaults, null, 2));
    const secondary = page.locator(".updates-simple > .component-card > .component-secondary");
    assert.equal(await secondary.count(), 3, "each update card folds its secondary information, not its controls or feedback");
    for (const detail of await secondary.all()) assert.equal(await detail.evaluate(element => (element as HTMLDetailsElement).open), false);
    assert.equal(await page.locator(".startup-preparation").evaluate(element => (element as HTMLDetailsElement).open), false);
    assert.equal(await page.locator(".startup-tools > .startup-maintenance").evaluate(element => (element as HTMLDetailsElement).open), false);
    const backend = page.getByRole("region", { name: "后台服务更新", exact: true });
    assert.equal(await backend.getByText(/应用内 Pi 随后台服务更新/).isVisible(), false);
    assert.equal(await backend.getByRole("button", { name: "检查更新", exact: true }).isVisible(), true);
    assert.equal(await backend.getByText("可更新至 v0.4.2", { exact: true }).isVisible(), true);
    assert.ok(defaults.every(layout => layout.height <= (layout.width === 1100 ? 950 : 1350)), "default page remains compact at desktop and narrow widths");
    await page.setViewportSize({ width: 1100, height: 900 });
    const foldedHeight = await page.locator(".startup-panel").evaluate(element => element.getBoundingClientRect().height);
    for (const detail of await secondary.all()) { const summary = detail.locator(":scope > summary"); await summary.focus(); await page.keyboard.press("Enter"); assert.equal(await detail.evaluate(element => (element as HTMLDetailsElement).open), true); }
    assert.equal(await backend.getByText(/应用内 Pi 随后台服务更新/).isVisible(), true);
    assert.ok(await page.locator(".startup-panel").evaluate(element => element.getBoundingClientRect().height) > foldedHeight + 200, "folding actually removes secondary content height");
    for (const detail of await secondary.all()) { await detail.locator(":scope > summary").focus(); await page.keyboard.press("Space"); assert.equal(await detail.evaluate(element => (element as HTMLDetailsElement).open), false); }
    assert.equal((await calls(page, "axiom_update")).filter((call: { action: string }) => !["status", "pi-refresh", "history"].includes(call.action)).length, 0, "keyboard disclosure never submits an update");
    assert.equal((await calls(page, "axiom_setup")).filter((call: { action: string }) => !["status", "check", "history"].includes(call.action)).length, 0, "keyboard disclosure never submits installation");
    for (const summary of [page.locator(".startup-maintenance > summary").filter({ hasText: "组件管理" }), page.locator(".startup-preparation > summary")]) {
      if (!await summary.evaluate(element => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
    }
    for (const theme of ["dark", "light"]) for (const width of [1100, 390, 320]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.setViewportSize({ width, height: 900 });
      assert.ok(await upper(page).isVisible());
      assert.ok(await page.getByRole("combobox", { name: "连接设备", exact: true }).isVisible());
      assert.ok(await page.getByLabel("本地端口", { exact: true }).isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width} fits`);
      await page.screenshot({ path: resolve(output, `full-connect-${theme}-${width}.png`), fullPage: true });
    }
    await clean(page); passed.push("compact default information hierarchy, primary navigation focus and fill, lighter overview frames, one-line subtitles, keyboard-only disclosure; complete dark/light 320–1100px previews");
  }
  {
    const page = await scene(), checkUpdates = page.locator(".updates-section-heading").getByRole("button", { name: "检查更新", exact: true });
    await page.mouse.move(0, 0);
    const before = (await calls(page, "axiom_update", "check")).length;
    await checkUpdates.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    assert.equal((await calls(page, "axiom_update", "check")).length, before + 1, "the discoverable check reuses the existing exactly-once executor");
    const backend = page.getByRole("region", { name: "后台服务更新", exact: true });
    await backend.locator(":scope > .maintenance-panel-heading h3").focus(); await page.keyboard.press("Tab");
    const cardCheck = backend.getByRole("button", { name: "检查更新", exact: true });
    assert.equal(await cardCheck.evaluate(node => document.activeElement === node), true, "Tab reaches a card's own operation without hover");
    await page.waitForFunction(node => getComputedStyle(node!).opacity === "1", await backend.locator(":scope > .maintenance-panel-heading .component-actions").elementHandle());
    await page.evaluate(() => { (window as any).connectControlsFixture.serviceError = "合成状态读取失败"; }); await page.clock.runFor(3100);
    await page.locator('.connection-status-tag[data-state="unknown"]').waitFor();
    assert.equal(await checkUpdates.getAttribute("aria-disabled"), "true");
    assert.equal(await checkUpdates.evaluate(node => (node as HTMLButtonElement).disabled), false, "temporary blockers remain focusable");
    const blockedBefore = (await calls(page, "axiom_update", "check")).length;
    await checkUpdates.focus(); await page.keyboard.press("Enter");
    assert.equal((await calls(page, "axiom_update", "check")).length, blockedBefore, "blocked keyboard activation never submits a check");
    assert.equal(await page.locator(".updates-section-heading .component-action-reason").isVisible(), true, "blocked check explains the reason instead of disappearing");
    assert.equal((await calls(page, "axiom_service", "stop")).length + (await calls(page, "axiom_service", "start")).length, 0);
    await clean(page); passed.push("visible header check uses existing exactly-once gate; no-hover Tab reveals own actions; unknown blocks submission but keeps keyboard explanation");
  }
  for (const width of [390, 320]) {
    const page = await scene(undefined, true); await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
    for (const card of await page.locator(".updates-simple > .component-card").all()) {
      const name = card.locator(":scope > .maintenance-panel-heading h3");
      assert.ok(await name.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "known component names remain readable with real touch actions");
      const actions = card.locator(":scope > .maintenance-panel-heading .component-actions");
      if (width === 320 && await actions.locator("button").count()) {
        const identityBottom = await card.locator(":scope > .maintenance-panel-heading :is(h3, .component-card-location)").evaluateAll(nodes => Math.max(...nodes.map(node => node.getBoundingClientRect().bottom)));
        assert.ok(await actions.evaluate(node => node.getBoundingClientRect().top) >= identityBottom, "narrow touch keeps name and path before its action row");
      }
    }
    const targets = page.locator(".updates-section-heading .updates-check-button, .updates-simple > .component-card > .maintenance-panel-heading :is(.component-action, .path-actions > button), .updates-simple > .component-card > .component-secondary > summary");
    const boxes = await targets.evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); let opacity = 1; for (let parent: Element | null = node; parent; parent = parent.parentElement) opacity *= parseFloat(getComputedStyle(parent).opacity); return { name: node.getAttribute("aria-label") || node.textContent?.trim(), opacity, left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; }));
    assert.ok(boxes.length >= 10, "touch verification covers real check, card operations, path actions and disclosures");
    for (const box of boxes) { assert.ok(box.width >= 44 && box.height >= 44, `real touch area is at least 44px: ${JSON.stringify(box)}`); assert.ok(box.opacity >= .45, `touch controls must be perceptible without hover, not merely geometrically visible: ${JSON.stringify(box)}`); }
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) assert.ok(Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left) <= .5 || Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top) <= .5, `touch targets never overlap: ${JSON.stringify([boxes[a], boxes[b]])}`);
    for (const target of await targets.all()) {
      await target.scrollIntoViewIfNeeded();
      assert.equal(await target.evaluate(node => { const box = node.getBoundingClientRect(); return [[box.left + 2, box.top + 2], [box.right - 2, box.bottom - 2]].every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === node || !!hit && node.contains(hit); }); }), true, "target corners actually hit their own control, not adjacent content");
    }
    for (const theme of ["dark", "light"]) {
      await page.evaluate(async theme => { document.documentElement.dataset.theme = theme; (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }, theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `touch ${theme}/${width} fits`);
      await page.screenshot({ path: resolve(output, `touch-connect-${theme}-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "full-page capture must retain the touch profile");
      for (const target of await targets.all()) assert.ok(await target.evaluate(node => node.getBoundingClientRect().height) >= 44, "touch geometry remains real after full-page capture");
    }
    await writeFile(resolve(output, `touch-targets-${width}.json`), JSON.stringify(boxes, null, 2));
    assert.equal((await calls(page, "axiom_service", "stop")).length + (await calls(page, "axiom_service", "start")).length, 0);
    await clean(page); passed.push(`coarse-pointer ${width}px: real 44px non-overlapping targets, corner hit-testing, complete themes and no overflow or service mutation`);
  }
  {
    const page = await scene();
    await primary(page).click(); const dialog = page.getByRole("dialog", { name: "关闭后台服务？", exact: true }); await dialog.waitFor();
    assert.match(await dialog.innerText(), /当前有 2 个会话/);
    await dialog.getByRole("button", { name: "继续运行", exact: true }).click(); assert.equal((await calls(page, "axiom_service", "stop")).length, 0);
    await primary(page).click(); await dialog.getByRole("button", { name: "确认关闭服务", exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    await page.locator('.connection-status-tag[data-state="stopped"]').waitFor(); assert.equal((await calls(page, "axiom_service", "stop")).length, 1);
    assert.equal(await primary(page).innerText(), "启动");
    await primary(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    await page.locator('.connection-status-tag[data-state="running"]').waitFor(); assert.equal((await calls(page, "axiom_service", "start")).length, 1);
    await clean(page); passed.push("running/stopped: affected-session confirmation, cancellation and exactly-once stop/start");
  }
  {
    const page = await scene(); await setService(page, "stopped");
    await page.evaluate(() => { (window as any).connectControlsFixture.delayStatus = true; }); await page.clock.runFor(3100);
    await page.waitForFunction(() => !!(window as any).connectControlsFixture.releaseStatus);
    await primary(page).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    assert.equal((await calls(page, "axiom_service", "start")).length, 0, "manual start waits for an already-running status poll");
    await page.evaluate(() => (window as any).connectControlsFixture.releaseStatus()); await page.locator('.connection-status-tag[data-state="running"]').waitFor();
    assert.equal((await calls(page, "axiom_service", "start")).length, 1, "reserved start survives the poll and runs once");
    await clean(page); passed.push("in-flight status poll cannot discard or duplicate a manual start");
  }
  {
    const page = await scene(); await primary(page).click(); const dialog = page.getByRole("dialog", { name: "关闭后台服务？", exact: true });
    await page.evaluate(() => { (window as any).connectControlsFixture.serviceError = "合成状态读取失败"; }); await page.clock.runFor(3100);
    await page.locator('.connection-status-tag[data-state="unknown"]').waitFor();
    const accept = dialog.getByRole("button", { name: "确认关闭服务", exact: true }); assert.ok(await accept.isDisabled());
    await accept.dispatchEvent("click"); assert.equal((await calls(page, "axiom_service", "stop")).length, 0, "unknown invalidates an already-open stop confirmation");
    await dialog.getByRole("button", { name: "继续运行", exact: true }).click(); assert.ok(await primary(page).isEnabled());
    await clean(page); passed.push("unknown service invalidates an open stop confirmation without removing read-only validation");
  }
  for (const state of ["running", "missing", "starting", "stopping", "unmanaged"]) {
    const page = await scene(); await setService(page, state);
    await page.evaluate(() => { (window as any).connectControlsFixture.serviceError = "合成状态读取失败"; });
    await page.clock.runFor(3100); await page.locator('.connection-status-tag[data-state="unknown"]').waitFor();
    assert.equal(await primary(page).innerText(), "校验状态");
    assert.ok(await primary(page).isEnabled(), `unknown after ${state}: read-only validation is not disabled by a stale state`);
    assert.equal(await upper(page).getByRole("status").last().innerText(), "正在确认服务状态", `unknown after ${state} cannot claim running or missing`);
    assert.equal(await page.getByRole("region", { name: "后台服务更新", exact: true }).getByRole("button", { name: "更新后台服务", exact: true }).getAttribute("aria-disabled"), "true", "unknown service blocks service update");
    await page.evaluate(() => { (window as any).connectControlsFixture.serviceError = ""; }); await primary(page).click();
    await page.locator(`.connection-status-tag[data-state="${state}"]`).waitFor();
    assert.equal((await calls(page, "axiom_service", "start")).length + (await calls(page, "axiom_service", "stop")).length, 0);
    await clean(page); passed.push(`unknown after ${state}: no stale claims, validation remains available, no service mutation`);
  }
  {
    const page = await scene(); await page.evaluate(() => { (window as any).connectControlsFixture.serviceState = "__proto__"; }); await page.clock.runFor(3100);
    await page.locator('.connection-status-tag[data-state="unknown"]').waitFor(); assert.equal(await primary(page).innerText(), "校验状态");
    assert.equal(await upper(page).getByRole("status").last().innerText(), "正在确认服务状态");
    assert.equal((await calls(page, "axiom_service", "start")).length + (await calls(page, "axiom_service", "stop")).length, 0);
    await clean(page); passed.push("malformed service states cannot use prototype keys as valid native status");
  }
  {
    const page = await scene(); await setService(page, "missing");
    assert.equal(await primary(page).innerText(), "下载和安装");
    await page.evaluate(() => { (window as any).connectControlsFixture.download = "verified"; }); await page.clock.runFor(3100);
    assert.equal(await primary(page).innerText(), "安装");
    await page.getByLabel("本地端口", { exact: true }).fill("8123");
    assert.equal(await primary(page).isVisible(), false, "custom endpoint never exposes local install/start/stop primary");
    await upper(page).getByRole("button", { name: "连接工作台", exact: true }).click(); await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
    assert.equal((await calls(page, "axiom_local")).at(-1).port, 8123);
    assert.equal((await calls(page, "axiom_setup", "service")).length + (await calls(page, "axiom_service", "start")).length, 0);
    await clean(page); passed.push("missing/cached package labels and custom local port remain; connecting existing endpoint never installs or starts");
  }
  {
    const page = await scene(); await page.getByLabel("本地端口", { exact: true }).fill("8123");
    await choose(page, /手动输入地址/); await page.getByLabel("远程连接地址", { exact: true }).fill("https://100.64.0.9:9000/");
    assert.equal(await page.getByLabel("远程端口", { exact: true }).inputValue(), "9000");
    assert.equal(await upper(page).locator(".connection-primary-area").count(), 0, "remote choice never exposes local service stop/install");
    await choose(page, /合成工作站/); await inputEquals(page, "远程端口", "4317");
    assert.ok(await upper(page).getByText("设备在线仅表示网络可达；点击连接后验证目标 Axiom 服务。", { exact: true }).isVisible());
    await choose(page, /手动输入地址/); await inputEquals(page, "远程连接地址", "https://100.64.0.9:9000/"); await inputEquals(page, "远程端口", "9000");
    await choose(page, /本地电脑/); await inputEquals(page, "本地端口", "8123");
    assert.equal((await calls(page, "axiom_remote")).length + (await calls(page, "axiom_local")).length, 0);
    await clean(page); passed.push("local, peer and manual address/port drafts survive selection changes; online is not service-ready");
  }
  {
    const page = await scene(); await choose(page, /合成工作站/);
    await page.evaluate(() => { (window as any).connectControlsFixture.connectError = "合成目标未运行 Axiom 服务"; });
    await upper(page).getByRole("button", { name: "连接工作台", exact: true }).click(); await upper(page).getByRole("alert").filter({ hasText: "合成目标未运行" }).waitFor();
    assert.ok(await page.locator(".connect-page").isVisible()); assert.equal(await page.locator(".device-name small").innerText(), "100.64.0.8");
    await page.clock.runFor(3500); assert.equal((await calls(page, "axiom_remote")).length, 1, "a failed connection is not automatically replayed");
    await page.evaluate(() => { Object.assign((window as any).connectControlsFixture, { connectError: "", delayConnect: true }); });
    await upper(page).getByRole("button", { name: "连接工作台", exact: true }).click(); await page.waitForFunction(() => !!(window as any).connectControlsFixture.releaseConnect);
    assert.ok(await page.getByRole("combobox", { name: "连接设备", exact: true }).isEnabled()); await choose(page, /本地电脑/);
    await page.evaluate(() => (window as any).connectControlsFixture.releaseConnect()); await page.clock.runFor(3100);
    assert.ok(await page.locator(".connect-page").isVisible(), "late old connection cannot hide current target controls");
    assert.equal(await page.getByLabel("本地端口", { exact: true }).inputValue(), "4317");
    assert.equal((await calls(page, "axiom_service", "start")).length + (await calls(page, "axiom_service", "stop")).length, 0);
    await clean(page); passed.push("remote service failure preserves selected address; late connection is invalidated by device switching");
  }
  {
    const page = await scene(); await page.evaluate(() => { (window as any).connectControlsFixture.controlsError = "合成导航屏障失败"; }); await choose(page, /手动输入地址/);
    await page.getByRole("status").filter({ hasText: "合成导航屏障失败" }).waitFor(); await page.getByLabel("远程连接地址", { exact: true }).fill("100.64.0.9");
    await upper(page).getByRole("button", { name: "连接工作台", exact: true }).click(); await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
    assert.equal((await calls(page, "axiom_controls")).length, 2, "retry establishes a new native navigation barrier");
    assert.equal(await page.evaluate(() => localStorage.getItem("axiom.remote.address")), "http://100.64.0.9:4317/");
    await clean(page); passed.push("rejected navigation barrier is not reused; successful remote address is remembered only after native connection verification");
  }
  for (const [address, port] of [["http://100.64.0.8/", "80"], ["https://100.64.0.8/", "443"], ["http://100.64.0.8:9000/", "9000"]]) {
    const page = await scene(address); await page.getByLabel("远程端口", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("远程端口", { exact: true }).inputValue(), port);
    assert.equal((await calls(page, "axiom_remote")).length, 0); await clean(page); passed.push(`saved remote address preserves port ${port} without auto-connect`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, scope: "Actual Connect upper controls, synthetic IPC only; no native service, installation or deletion", scenarios: passed, errors, remote }, null, 2));
  console.log(`PASS: ${passed.length} connection controls scenarios; synthetic IPC only.`);
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ error: String(error), completedScenarios: passed, errors, remote }, null, 2));
  for (const [index, page] of [browser, touchBrowser].flatMap(browser => browser.contexts()).flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    await writeFile(resolve(output, `failure-${index}.txt`), await page.locator("body").innerText().catch(() => "")).catch(() => {});
  }
  throw error;
} finally { await browser.close(); await touchBrowser.close(); await server.close(); }
