// Production pages, in-memory transport only: no server integration or native execution.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium, type Locator } from "playwright";
import { defaultOpenCliSettings } from "../src/shared/builtin-tools.js";
import { emptyReaState } from "../src/shared/rea.js";
import { emptyRtkState } from "../src/shared/rtk.js";
import { emptyModelProxyState } from "../src/shared/model-proxy.js";
import { ensureComponentActions } from "./component-layout-helpers.js";

type Fixture = typeof import("./fixtures/component-maintenance-transport.js").componentMaintenanceFixture;
const root = mkdtempSync(join(tmpdir(), "axiom-maint-pages-")), artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/component-maintenance-pages");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "memory-only-transport", enforce: "pre", resolveId(source, importer) { if (source.endsWith("/transport.js") && importer?.includes("/src/client/")) return resolve("tests/fixtures/component-maintenance-transport.ts"); } }], build: { outDir: root, emptyOutDir: true, target: "safari15", minify: false, lib: { entry: resolve("tests/fixtures/component-maintenance-pages.tsx"), name: "ComponentMaintenancePages", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), js = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server = createServer((req, res) => {
  const path = new URL(req.url!, "http://fixture").pathname, file = path === "/" ? "index.html" : basename(path);
  if (file === "favicon.ico") { res.writeHead(204).end(); return; }
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(readFileSync(join(root, file)));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors: string[] = [], remote: string[] = [], cases: string[] = [];
let checks = 0, sequence = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const open = { ready: true, configured: true, revision: "open-1", nodeVersion: "v22.22.2", settings: defaultOpenCliSettings, managed: true };
const rea = { ...emptyReaState, revision: "rea-1", supported: true, nodeVersion: "v22.22.2" };
const rtk = { ...emptyRtkState, revision: "rtk-1", supported: true, platform: "darwin/arm64" };
const proxy = { ...emptyModelProxyState, revision: "proxy-1", supported: true, managed: true, platform: "darwin/arm64" };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", async route => { if (route.request().url().startsWith(`${origin}/`)) await route.continue(); else { remote.push(route.request().url()); await route.abort("blockedbyclient"); } });
  const load = async (tool: string, values: Record<string, unknown>, connected = true) => {
    await page.goto(`${origin}/?case=${++sequence}#${tool}`);
    await page.waitForFunction(() => !!(window as unknown as { componentMaintenanceFixture: Fixture }).componentMaintenanceFixture);
    await page.evaluate(({ values, connected }) => (window as unknown as { componentMaintenanceFixture: Fixture }).componentMaintenanceFixture.set(values, connected), { values, connected });
    await page.waitForFunction(() => document.querySelectorAll(".component-action").length > 0);
  };
  const stateCalls = () => page.evaluate(() => (window as unknown as { componentMaintenanceFixture: Fixture }).componentMaintenanceFixture.calls);
  const mutations = async () => (await stateCalls()).filter(call => /\.(install|uninstall|engine-install|engine-uninstall|engine-download|engine-open-installer|clearDownloads)$/.test(call.op));
  const rootCard = (tool: string, label: string) => page.locator(`article#${tool}`).getByRole("region", { name: `${label}维护`, exact: true });
  const assertAction = async (card: Locator, id: string, label?: RegExp) => {
    await ensureComponentActions(card); const button = card.locator(`:scope > .maintenance-panel-heading [data-component-action="${id}"]`);
    await button.waitFor(); check(await button.isVisible(), `${id} remains discoverable`); check(await button.getAttribute("aria-disabled") === null, `${id} is available`);
    if (label) check(label.test((await button.getAttribute("aria-label"))!), `${id} label is factual`);
    return button;
  };
  // Before a first query there is no evidence of absence or platform incompatibility.
  for (const [tool, label] of [["opencli", "OpenCLI"], ["rea", "REA"], ["rtk", "RTK"], ["model-proxy", "Xray-core"]]) {
    await load(tool, {}); const card = rootCard(tool, label);
    await assertAction(card, "install"); check(await card.locator(":scope > .maintenance-panel-heading .component-card-version").count() === 0, `${label} initial snapshot is not fabricated as missing`);
  }
  cases.push("unqueried entry points and no fabricated installation facts");
  for (const [tool, label, key, base] of [["opencli", "OpenCLI", "builtin-tools:opencli", open], ["rea", "REA", "builtin-tools:rea", rea], ["rtk", "RTK", "builtin-tools:rtk", rtk]] as const) {
    for (const [version, target, expected] of [[undefined, undefined, "reinstall"], ["6.8.0", "6.8.0", "reinstall"], ["6.7.0", "6.8.0", "update"], ["6.8.0", "6.7.0", "switch-version"], ["custom", "6.8.0", "reinstall"]] as const) {
      const installed = { ...base, version, latest: target, ...(tool === "rtk" ? { executable: "/fixture/rtk" } : { packageRoot: `/fixture/${tool}` }) };
      await load(tool, { [key]: installed }); const card = rootCard(tool, label);
      await assertAction(card, expected);
      if (!version) check(/已安装/.test(await card.locator(":scope > .maintenance-panel-heading .component-card-version").innerText()), "an unknown version does not erase installation evidence");
      if (!target && tool !== "rea") check(await card.locator(":scope > .maintenance-panel-heading .component-card-candidate").count() === 0, "no unknown remote-version placeholder");
    }
    const running = { ...base, version: "6.8.0", latest: "6.8.0", ...(tool === "rtk" ? { executable: "/fixture/rtk" } : { packageRoot: `/fixture/${tool}` }), job: { id: "old-job", kind: "install", running: true, message: "正在安装" } };
    await load(tool, { [key]: running }); const card = rootCard(tool, label);
    await assertAction(card, "reinstall"); await assertAction(card, "uninstall");
    const auxiliary = card.locator(':scope > .maintenance-panel-heading [data-component-action="check-versions"]');
    check(await auxiliary.getAttribute("aria-disabled") === "true", "a real auxiliary conflict retains a reason");
    await load(tool, { [key]: running }, false); const blocked = card.locator(':scope > .maintenance-panel-heading [data-component-action="uninstall"]');
    await ensureComponentActions(card); check(await blocked.isVisible(), "disconnected core entry remains visible");
    check(await blocked.getAttribute("aria-disabled") === "true", "disconnected request is blocked, not queued");
    await blocked.evaluate(button => (button as HTMLButtonElement).click());
    check((await mutations()).length === 0, "disconnected click submits no command");
    check(await card.locator(".component-action-reason:visible").count() === 1, "blocked click explains itself");
  }
  cases.push("OpenCLI/REA/RTK factual version matrix, busy core actions, disconnected no-op");
  await load("model-proxy", { "builtin-tools:model-proxy": { ...proxy, installations: { xray: { directory: "fixture", version: "1.2.0" } }, latest: { xray: "1.1.0" }, job: { id: "proxy-old", running: true, message: "正在安装" } } });
  await assertAction(rootCard("model-proxy", "Xray-core"), "switch-version", /切换/); await assertAction(rootCard("model-proxy", "Xray-core"), "uninstall");
  await assertAction(rootCard("model-proxy", "mihomo"), "install");
  await load("model-proxy", { "builtin-tools:model-proxy": { ...proxy, managed: false } });
  check(await rootCard("model-proxy", "Xray-core").locator('[data-component-action="install"]').count() === 0, "confirmed unsupported download capability is omitted");
  await assertAction(rootCard("model-proxy", "Xray-core"), "uninstall");
  cases.push("proxy downgrade, uninstalled sibling and unsupported platform");
  const ghidra = { id: "ghidra", path: "/fixture/ghidra", configured: true, revision: "engine-1", status: "error", detail: "fixture failure", installable: true, version: "12.1.4", recommendedVersion: "12.1.4", download: { path: "/fixture/package.zip", version: "12.1.4" } };
  const hopper = { id: "hopper", path: "/Applications/Fixture Hopper.app/Contents/MacOS/hopper", configured: true, revision: "hopper-1", status: "detected", detail: "", installable: false, version: "6.6.0-demo", recommendedVersion: "6.6.0", download: { path: "/fixture/package.dmg", version: "6.6.0" } };
  const enginesState = { ...rea, version: "6.8.0", packageRoot: "/fixture/rea", engineHost: { platform: "darwin", arch: "arm64" }, engines: [ghidra, hopper], downloadCleanup: { ghidra: { revision: "cleanup-1", paths: ["/fixture/package.zip"] } } };
  await load("rea", { "builtin-tools:rea": enginesState });
  const ghidraCard = page.getByRole("region", { name: "Ghidra维护", exact: true }), hopperCard = page.getByRole("region", { name: "Hopper维护", exact: true });
  await assertAction(ghidraCard, "repair", /修复.*重新安装/); await assertAction(ghidraCard, "install-cached"); await assertAction(ghidraCard, "cleanup-package");
  await assertAction(hopperCard, "open-installer"); check(await hopperCard.locator('[data-component-action="uninstall"]').count() === 0, "external Hopper has no fake managed uninstall");
  check(await hopperCard.getByRole("button", { name: "卸载说明", exact: true }).count() === 1, "external Hopper removal instructions are discoverable");
  await ghidraCard.locator('[data-component-action="repair"]').click();
  const installConfirm = ghidraCard.getByRole("group", { name: "确认安装Ghidra", exact: true });
  check((await installConfirm.innerText()).includes("强制清理"), "repair confirmation discloses destructive fallback");
  await installConfirm.getByRole("button", { name: "确认下载安装", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { componentMaintenanceFixture: Fixture }).componentMaintenanceFixture.calls.some(call => call.op === "rea.engine-install"));
  check((await mutations()).some(call => call.op === "rea.engine-install" && call.params.reinstall === true), "repair sends explicit fresh-reinstall intent");
  await ghidraCard.locator('[data-component-action="install-cached"]').click();
  check(/重新校验.*不能保证保留原安装/.test(await installConfirm.innerText()), "cached install states verification and actual fallback consequence");
  await installConfirm.getByRole("button", { name: "暂不安装", exact: true }).click();
  await hopperCard.locator('[data-component-action="open-installer"]').click();
  const opener = hopperCard.getByRole("group", { name: "确认打开Hopper安装器", exact: true });
  check((await opener.innerText()).includes("打开不代表安装完成"), "opening an installer is not installed state");
  await opener.getByRole("button", { name: "暂不打开", exact: true }).click();
  cases.push("engine repair intent, cached package, cleanup and external Hopper installer");
  await load("rea", { "builtin-tools:rea": { ...enginesState, version: undefined, skillInstalled: true, mcpInstalled: true } });
  check(/已安装/.test(await rootCard("rea", "REA").locator(":scope > .maintenance-panel-heading .component-card-version").innerText()), "REA path remains installed without version");
  const skill = page.getByRole("region", { name: "REA Skill维护", exact: true });
  check(/已安装/.test(await skill.locator(":scope > .maintenance-panel-heading .component-card-version").innerText()), "installed Skill is not mislabeled missing without host version");
  await assertAction(skill, "uninstall");
  await ensureComponentActions(ghidraCard); check(await ghidraCard.locator('[data-component-action="repair"]').getAttribute("aria-disabled") === "true", "unresolved host contract is a discoverable real blocker");
  cases.push("host version unknown is separate from installed references");
  for (const width of [1200, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await ensureComponentActions(ghidraCard);
    await ghidraCard.locator('[data-component-action="repair"]').evaluate(button => (button as HTMLButtonElement).click());
    const reason = ghidraCard.locator(".component-action-reason:visible");
    const box = await reason.boundingBox(); check(!!box && box.x >= 0 && box.x + box.width <= width + 1, "blocked reason stays inside viewport");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `production page has no horizontal overflow at ${width}`);
    await page.screenshot({ path: join(artifacts, `rea-${width}.png`), fullPage: true });
  }
  check((await page.evaluate(() => (window as unknown as { componentMaintenanceFixture: Fixture }).componentMaintenanceFixture.network)).length === 0, "no fetch/WebSocket attempted");
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ checks, cases, errors, remote, scope: "production React pages with memory-only transport; zero real maintenance", browser: browser.version() }, null, 2));
  console.log(JSON.stringify({ checks, cases, artifacts, errors, remote }, null, 2));
} finally { await browser.close(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); rmSync(root, { recursive: true, force: true }); }
