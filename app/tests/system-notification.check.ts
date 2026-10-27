// Real desktop React pages, mock IPC only. No native helper or installation runs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/system-notification");
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve("desktop/vite.config.ts"), cacheDir: resolve(output, ".vite"),
  plugins: [{ name: "system-notifications-fixture", configureServer(server) {
    // Register before Vite's SPA fallback, otherwise this route loads Connect.
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.split("?")[0] !== "/system-notifications-fixture.html") return next();
      try {
        const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@fs${resolve("tests/fixtures/system-notifications.tsx")}"></script></body></html>`;
        response.setHeader("Content-Type", "text/html");
        response.end(await server.transformIndexHtml("/system-notifications-fixture.html", html));
      } catch (error) { next(error); }
    });
  } }], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const errors: string[] = [], passed: string[] = [];
async function scene(options: { remote?: boolean; unsupported?: boolean; runningVersion?: string; desktopFreshVersion?: string; foreground?: boolean; sourceOrigin?: string } = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(options => {
    if (options.remote) localStorage.setItem("axiom.connection.mode", "remote");
    const state = { health: "connected", control: false, latest: "0.4.19", freshVersion: "0.4.20", desktopVersion: "0.4.17", checkError: null as string | null,
      runningVersion: options.runningVersion || "0.4.10", seen: JSON.parse(localStorage.getItem("fixture-notices") || "{}") as Record<string, string>,
      calls: [] as { name: string; action?: string; version?: string; maintenance?: unknown }[], unexpected: [] as string[], job: null as any };
    (window as any).noticeFixture = state;
    const notice = () => ({ sourceOrigin: options.sourceOrigin || (options.remote ? "http://100.64.0.2:4317" : "http://127.0.0.1:4317"), runningVersion: state.runningVersion, latest: { version: state.latest, url: `https://github.com/cosyeezz/axiom2/releases/tag/v${state.latest}` }, checkedAt: Date.now(), checking: false, available: state.latest !== state.runningVersion, pending: state.latest !== state.runningVersion && !state.seen[state.latest], error: state.checkError });
    const update = () => ({ clientVersion: "0.4.1", serviceVersion: "0.4.10", managed: true, clientSupported: false, foregroundSupported: !!options.foreground,
      release: { version: state.desktopVersion, checkedAt: Date.now(), assets: {} }, job: state.job, recovery: false, log: "fixture/update.log" });
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, ...args });
      if (name === "axiom_theme") return { theme: args.theme || "dark", revision: 0 };
      if (name === "axiom_connection") return state.health;
      if (name === "axiom_service" && args.action === "status") return { desktopView: state.control ? "control" : "workbench", state: "running", active: [], url: "http://127.0.0.1:4317/" };
      if (name === "axiom_peers") return { peers: [] };
      if (name === "axiom_backend_updates") {
        if (options.unsupported) throw Error("Unknown command: axiom_backend_updates");
        if (args.action === "check" && !state.checkError) state.latest = state.freshVersion;
        let claimed: string | null = null;
        if (args.action === "present" && args.version === state.latest && !state.seen[args.version]) { claimed = args.version; state.seen[args.version] = "shown"; }
        if (args.action === "dismiss") state.seen[args.version] = "dismissed";
        localStorage.setItem("fixture-notices", JSON.stringify(state.seen));
        return { ...notice(), notice: claimed };
      }
      if (name === "axiom_controls") { state.control = true; window.dispatchEvent(new CustomEvent("axiom-desktop-view", { detail: "control" })); return; }
      if (name === "axiom_setup") {
        if (args.action === "check") return { nodeReady: true, writable: true, tailscale: true, platform: options.foreground ? "windows" : "macos" };
        if (args.action === "status") return { job: null };
        if (args.action === "service") throw Error("Fixture installation intentionally blocked after recording payload");
      }
      if (name === "axiom_update") {
        if (args.action === "check") state.desktopVersion = options.desktopFreshVersion || state.freshVersion;
        if (["status", "pi-refresh", "check"].includes(args.action)) return update();
        if (args.action === "service") { state.job = { kind: "service", running: false, phase: "complete", message: "Fixture submission only" }; return update(); }
      }
      if (name === "axiom_cleanup" && ["resources.get", "rea.get", "rtk.get", "opencli.get", "modelProxy.get"].includes(args.request?.op)) return { requestId: args.request.requestId, data: { revision: "fixture", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
      if (name === "axiom_environment") return null;
      state.unexpected.push(name + ":" + args.action); throw Error("Unexpected IPC: " + name + ":" + args.action);
    } };
  }, options);
  await page.clock.install(); await page.goto(server.resolvedUrls!.local[0]);
  await page.locator('.desktop-workbench-bar').waitFor();
  if (!options.unsupported) await page.getByRole("button", { name: "关闭 v0.4.19 更新通知", exact: true }).waitFor();
  else await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
  return page;
}
async function count(page: Page, name: string, action: string) { return page.evaluate(({ name, action }) => (window as any).noticeFixture.calls.filter((value: any) => value.name === name && value.action === action).length, { name, action }); }
async function safe(page: Page) { assert.deepEqual(await page.evaluate(() => (window as any).noticeFixture.unexpected), []); }
async function originalHeaderVisual(page: Page) {
  return page.evaluate(() => [".desktop-workbench-bar", ".desktop-workbench-status", ".desktop-workbench-status svg", ".desktop-workbench-status > span", ".desktop-workbench-actions", ".desktop-workbench-actions > .theme-toggle", ".desktop-workbench-actions > button:not(.theme-toggle)"].map(selector => {
    const element = document.querySelector(selector)!;
    const { x, y, width, height } = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { selector, rect: { x, y, width, height }, text: element.textContent,
      style: { color: style.color, font: style.font, gap: style.gap, padding: style.padding, display: style.display },
      icon: element.querySelector("svg")?.outerHTML };
  }));
}
try {
  {
    const page = await scene();
    assert.match(await page.locator('[data-kind="update"] .system-notification-message').innerText(), /v0\.4\.19/);
    assert.equal(await page.locator('.desktop-workbench-status path').getAttribute("d"), "M1.88 12.21q2.32.02 4.62-.36q1.21-3.49 2.99-6.73q2.26 7.09 5.12 13.96q1.44-3.57 2.8-7.17q2.22.15 4.44.31", "original waveform SVG, never a dot/emoji");
    assert.deepEqual(await page.locator('.system-notification').evaluateAll(items => items.map(item => item.getAttribute("data-kind"))), ["connection", "update"], "connection is retained first, update is appended");
    await page.evaluate(() => { (window as any).noticeFixture.health = "disconnected"; }); await page.clock.runFor(1100);
    await page.locator('.desktop-workbench-status[data-state="disconnected"]').waitFor();
    assert.equal(await page.locator('[data-kind="update"]').count(), 0);
    await page.evaluate(() => { (window as any).noticeFixture.health = "connected"; }); await page.clock.runFor(1100);
    await page.getByRole("button", { name: "关闭 v0.4.19 更新通知", exact: true }).waitFor();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [360, 390, 430, 600, 820, 1024, 1100, 1366, 1440, 1920]) {
        await page.setViewportSize({ width, height: 48 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `notice fits ${width}px`);
        await page.locator('.system-notifications-following').evaluate(element => { element.scrollLeft = 0; });
        const actual = await originalHeaderVisual(page);
        // Restore the pre-notification flex layout in-place for a visual reference.
        // display:contents neutralizes only added wrappers; the original status,
        // SVG, navigation DOM and their unmodified original styles stay intact.
        const reference = await page.addStyleTag({ content: '.desktop-workbench-left { flex: 0 0 auto; min-width: auto; } .system-notifications, .system-notification-leading { display: contents; } .system-notifications-following { display: none !important; }' });
        assert.deepEqual(actual, await originalHeaderVisual(page), `original icons/text/colors/sizes/coordinates unchanged at ${width}px in ${theme}`);
        await reference.evaluate(element => { element.parentNode?.removeChild(element); });
        const actions = await page.locator('.desktop-workbench-actions').boundingBox();
        const connection = await page.locator('.desktop-workbench-status').boundingBox();
        const following = await page.locator('.system-notifications-following').boundingBox();
        assert.equal(await page.locator('.desktop-workbench-status').innerText(), "后台服务已连接");
        assert.equal(await page.locator('.desktop-workbench-actions > button:not(.theme-toggle) > span').isVisible(), true, "existing navigation text is never hidden");
        assert.ok(connection && following && actions && connection.x + connection.width <= following.x && following.x + following.width <= actions.x, `only new notices use remaining space at ${width}px`);
        if (width === 390 || width === 1100) await page.locator('.desktop-workbench-bar').screenshot({ path: resolve(output, `notice-${theme}-${width}.png`) });
        // Narrow screens may scroll ONLY the new area; keyboard focus must reach
        // its action and close buttons without moving any pre-existing controls.
        await page.locator('.system-notification-update').focus();
        await page.getByRole("button", { name: "关闭 v0.4.19 更新通知", exact: true }).focus();
        const close = await page.getByRole("button", { name: "关闭 v0.4.19 更新通知", exact: true }).boundingBox();
        assert.ok(close && following && close.x >= following.x - 0.5 && close.x + close.width <= following.x + following.width + 0.5, `new notice close is reachable by scrolling at ${width}px`);
        assert.deepEqual(await originalHeaderVisual(page), actual, "scrolling new notices never shifts old controls");
      }
    }
    assert.equal(await count(page, "axiom_backend_updates", "present"), 1);
    await page.getByRole("button", { name: "关闭 v0.4.19 更新通知", exact: true }).click();
    await page.locator('[data-kind="update"]').waitFor({ state: "detached" });
    await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
    assert.equal(await page.locator('.system-notification').count(), 1, "closing update leaves the original connection notice intact");
    await page.clock.runFor(31_000); assert.equal(await page.locator('[data-kind="update"]').count(), 0);
    await page.evaluate(() => { (window as any).noticeFixture.health = "disconnected"; }); await page.clock.runFor(1100);
    await page.locator('.desktop-workbench-status[data-state="disconnected"]').waitFor();
    await page.evaluate(() => { (window as any).noticeFixture.health = "connected"; }); await page.clock.runFor(1100);
    await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
    assert.equal(await page.locator('[data-kind="update"]').count(), 0, "dismissed version does not return on reconnect");
    assert.equal(await count(page, "axiom_backend_updates", "present"), 1);
    await page.reload(); await page.locator('.desktop-workbench-status[data-state="connected"]').waitFor();
    assert.equal(await page.locator('[data-kind="update"]').count(), 0, "same version does not return after reload");
    await page.evaluate(() => { (window as any).noticeFixture.latest = "0.4.20"; });
    await page.clock.runFor(10_100); await page.getByRole("button", { name: "关闭 v0.4.20 更新通知", exact: true }).waitFor();
    assert.equal(await count(page, "axiom_update", "service"), 0); await safe(page); await page.close();
    passed.push("original waveform/text/navigation styles and coordinates unchanged; appended notices alone scroll; disconnect/reconnect and independent dismissal persist; 10 widths, 2 themes");
  }
  {
    const page = await scene(); await page.locator('.system-notification-update').click();
    const dialog = page.getByRole("dialog", { name: "更新后台至 0.4.20？", exact: true }); await dialog.waitFor();
    assert.equal(await count(page, "axiom_backend_updates", "check"), 1); assert.equal(await count(page, "axiom_update", "check"), 1);
    assert.equal(await count(page, "axiom_update", "service"), 0, "checking never silently installs or stops a service");
    await dialog.getByRole("button", { name: "暂不更新", exact: true }).click(); assert.equal(await count(page, "axiom_update", "service"), 0);
    await page.getByRole("button", { name: "更新后台服务", exact: true }).click();
    await dialog.getByRole("button", { name: "确认更新服务", exact: true }).click();
    assert.equal(await count(page, "axiom_update", "service"), 1);
    assert.equal(await page.evaluate(() => (window as any).noticeFixture.calls.find((value: any) => value.name === "axiom_update" && value.action === "service").version), "0.4.20");
    await safe(page); await page.close(); passed.push("fresh backend + local check, explicit v20 confirmation instead of stale v17; cancel safe, pinned submission");
  }
  {
    const page = await scene({ foreground: true }); await page.locator('.system-notification-update').click();
    await page.getByRole("dialog", { name: "更新后台至 0.4.20？", exact: true }).getByRole("button", { name: "确认更新服务", exact: true }).click();
    await page.waitForFunction(() => (window as any).noticeFixture.calls.some((value: any) => value.name === "axiom_setup" && value.action === "service"));
    const request = await page.evaluate(() => (window as any).noticeFixture.calls.find((value: any) => value.name === "axiom_setup" && value.action === "service"));
    assert.deepEqual(request.maintenance, { version: "0.4.20", latest: true }); assert.equal(request.confirmed, true);
    await safe(page); await page.close(); passed.push("Windows foreground receives explicit version, latest-at-execution intent and confirmation");
  }
  for (const options of [{ remote: true }, { sourceOrigin: "http://100.64.0.2:4317" }]) {
    const page = await scene(options); assert.equal(await page.locator('.system-notification-update').isDisabled(), true);
    assert.match(await page.locator('.system-notification-update').getAttribute("title") || "", /后台所在设备/);
    await page.locator('.system-notification-update').dispatchEvent("click");
    assert.equal(await count(page, "axiom_backend_updates", "check"), 0); assert.equal(await count(page, "axiom_update", "service"), 0); assert.equal(await count(page, "axiom_setup", "service"), 0);
    await safe(page); await page.close(); passed.push(options.remote ? "remote backend notice cannot trigger a local installation" : "native-reported remote origin cannot install locally even if UI selection says local");
  }
  {
    const page = await scene(); await page.evaluate(() => { (window as any).noticeFixture.checkError = "离线测试：未取得最新版本"; });
    await page.locator('.system-notification-update').click(); await page.getByRole("alert").filter({ hasText: "离线测试" }).waitFor();
    assert.equal(await count(page, "axiom_controls", ""), 0); assert.equal(await count(page, "axiom_update", "check"), 0);
    assert.equal(await page.getByRole("button", { name: "关闭 v0.4.19 更新通知", exact: true }).isVisible(), true);
    await safe(page); await page.close(); passed.push("failed live check retains notice and refuses stale installation");
  }
  for (const [options, message] of [[{ desktopFreshVersion: "0.4.19" }, "旧于通知版本"], [{ runningVersion: "0.4.9" }, "登记安装版本不一致"]] as const) {
    const page = await scene(options); await page.locator('.system-notification-update').click(); await page.getByRole("alert").filter({ hasText: message }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0); assert.equal(await count(page, "axiom_update", "service"), 0);
    await safe(page); await page.close(); passed.push(`safe refusal: ${message}`);
  }
  {
    const page = await scene({ unsupported: true }); await page.clock.runFor(20_100);
    assert.equal(await page.locator('[data-kind="update"]').count(), 0); assert.equal(await page.getByRole("alert").count(), 0);
    await safe(page); await page.close(); passed.push("old desktop/backend gracefully keeps ordinary connection notification");
  }
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(new URL("system-notifications-fixture.html", server.resolvedUrls!.local[0]).href);
    const items = page.getByRole("list", { name: "系统通知", exact: true }).getByRole("listitem");
    await page.getByRole("button", { name: "查看记录", exact: true }).waitFor();
    assert.deepEqual(await items.evaluateAll(items => items.map(item => item.getAttribute("data-kind"))), ["connection", "resource-sync", "maintenance"]);
    assert.equal(await page.getByRole("button", { name: "等待确认", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "查看记录", exact: true }).click();
    assert.equal(await page.getByRole("status", { name: "已查看次数", exact: true }).innerText(), "1");
    await page.getByRole("button", { name: "关闭同步通知", exact: true }).click();
    assert.deepEqual(await items.evaluateAll(items => items.map(item => item.getAttribute("data-kind"))), ["connection", "maintenance"]);
    await page.getByRole("button", { name: "关闭维护通知", exact: true }).click();
    assert.deepEqual(await items.evaluateAll(items => items.map(item => item.getAttribute("data-kind"))), ["connection"]);
    assert.equal(await page.locator('.desktop-workbench-status').innerText(), "后台服务已连接");
    assert.equal(await page.evaluate(() => "__TAURI_INTERNALS__" in window), false, "generic module needs no update/native bridge");
    await page.close(); passed.push("generic module accepts ordered non-update notices with independent actions, disabled state and dismissal; connection persists");
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, "result.json"), JSON.stringify({ passed: true, scope: "actual React with synthetic IPC, no real install or service restart", scenarios: passed, errors }, null, 2));
  console.log(`PASS ${passed.length} system-notification actual-page scenarios; no real installation.`);
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); await server.close(); }
