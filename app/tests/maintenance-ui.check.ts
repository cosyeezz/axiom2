// Pure in-memory component fixture. No backend, native helper, installation or removal.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
import { assertSelectPosition, chooseSelect } from "./select-helpers.js";
import { assertComponentHeader, assertComponentTree, ensureComponentActions } from "./component-layout-helpers.js";
const root = mkdtempSync(join(tmpdir(), "axiom-maintenance-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/maintenance");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root, emptyOutDir: true, target: "safari15", minify: false, lib: { entry: resolve("tests/fixtures/maintenance.tsx"), name: "MaintenanceFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), js = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(readFileSync(join(root, file)));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const fixtureOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors: string[] = [], remote: string[] = [];
const guardRequests = async (route: import("playwright").Route) => {
  if (route.request().url().startsWith(`${fixtureOrigin}/`)) await route.continue();
  else { remote.push(route.request().url()); await route.abort("blockedbyclient"); }
};
try {
  const page = await browser.newPage({ reducedMotion: "reduce", serviceWorkers: "block" }); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", guardRequests);
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  const card = page.getByRole("region", { name: "示例程序维护", exact: true });
  const native = page.getByRole("region", { name: "原生程序维护", exact: true });
  const state = page.getByRole("combobox", { name: "测试状态" });
  const environment = card.locator(":scope > .component-environment");
  const nodeCard = card.getByRole("region", { name: "Node.js维护", exact: true });
  const npmCard = card.getByRole("region", { name: "npm维护", exact: true });
  const count = async () => Number(await page.locator('output[aria-label="请求计数"]').innerText());
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "page has no horizontal overflow");
  await card.getByRole("progressbar", { name: "当前下载进度" }).waitFor();
  assert.equal(await native.locator(".component-environment").count(), 0, "a program without environment capability has no environment section");
  assert.equal(await environment.isVisible(), true, "environment cards are visible, not a collapsed summary");
  assert.equal(await nodeCard.evaluate(node => node.parentElement!.closest(".component-card")?.getAttribute("aria-label")), "示例程序维护");
  assert.equal(await npmCard.evaluate(node => node.parentElement!.closest(".component-card")?.getAttribute("aria-label")), "示例程序维护", "Node and npm are sibling facts, not inverted dependencies");
  assert.equal(await card.getByRole("region", { name: "底层环境维护", exact: true }).evaluate(node => node.parentElement!.closest(".component-card")?.getAttribute("aria-label")), "辅助依赖维护", "the generic card mechanism still recurses to a third level");
  assert.equal(await card.getByRole("button", { name: "卸载程序", exact: true }).isVisible(), true, "core maintenance remains available during an older task");
  assert.equal(await card.getByRole("button", { name: "卸载程序", exact: true }).getAttribute("aria-disabled"), null);
  assert.equal(await card.getByRole("button", { name: "检查安装", exact: true }).getAttribute("aria-disabled"), "true", "a conflicting auxiliary check retains its reason");
  await state.selectOption("idle");
  assert.equal(await card.getByRole("heading", { name: "示例程序", exact: true }).count(), 1);
  assert.match(await card.locator(":scope > .maintenance-panel-heading .component-card-version").innerText(), /当前\s+v1\.0\.0/);
  assert.equal(await card.locator(".maintenance-task,.maintenance-result").count(), 0, "idle has no placeholder task");
  const pathLocation = card.locator(":scope > .maintenance-panel-heading .component-card-location");
  assert.ok(await pathLocation.getByText("/fixture/program", { exact: true }).isVisible());
  await page.evaluate("(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.fixtureCopiedPath = value; } } }); })()");
  await pathLocation.getByRole("button", { name: "复制路径", exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).fixtureCopiedPath), "/fixture/program", "copy preserves the full path without a maintenance request or the system clipboard");
  await pathLocation.getByRole("button", { name: "打开所在文件夹", exact: true }).click();
  assert.equal(await page.getByLabel("路径打开计数", { exact: true }).innerText(), "1", "path opening uses only the fixture callback");
  assert.equal(await count(), 0);
  assert.equal(await card.locator(".component-details-toggle").count(), 0);
  assert.equal(await card.getByText("由原安装器在原位置维护。", { exact: true }).isVisible(), true, "necessary descriptions are always visible");
  assert.equal(await card.locator(":scope > .maintenance-panel-heading").locator(".component-card-candidate").innerText(), "最新 v1.0.1", "candidate row uses a two-character label and version value");
  await ensureComponentActions(card);
  const check = card.getByRole("button", { name: "检查安装", exact: true });
  assert.equal(await check.locator(".component-action-label").isVisible(), false, "desktop uses glyphs, not permanent action prose");
  assert.equal(await check.getAttribute("data-tooltip"), "检查安装");
  await check.hover(); await page.getByRole("tooltip", { name: "检查安装", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  await check.focus(); await page.keyboard.press("Tab");
  assert.equal(await card.locator(":scope > .maintenance-panel-heading .component-actions").evaluate(node => getComputedStyle(node).opacity), "1", "keyboard focus reveals the card's operations without hover");
  await page.getByRole("tooltip", { name: "更新至 v1.0.1", exact: true }).waitFor();
  assert.notEqual(await card.getByRole("button", { name: "更新至 v1.0.1", exact: true }).evaluate(node => getComputedStyle(node).outlineStyle), "none", "keyboard action has a visible focus ring");
  await page.keyboard.press("Escape");
  await assertComponentHeader(card);
  assert.equal(await nodeCard.getByText("原安装器整体维护，不单独改系统环境。", { exact: true }).isVisible(), true);
  assert.equal(await npmCard.getByText(/npm 依赖 Node.js/).isVisible(), true);
  assert.equal(await count(), 0, "reading descriptions and tooltips never submits maintenance");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 850 }); await noOverflow();
      await assertComponentTree(card);
      await assertComponentTree(native); // Adjacent outer cards must retain their complete frame too.
      await ensureComponentActions(card); await assertComponentTree(card); await noOverflow();
      await page.screenshot({ path: join(artifacts, `idle-${theme}-${width}.png`), fullPage: true });
    }
  }
  // A wide viewport does not excuse overflowing a narrow embedding container.
  await page.setViewportSize({ width: 1200, height: 850 });
  const resizeCard = async (width: number) => {
    await card.evaluate((node, value) => (node as HTMLElement).style.width = `${value}px`, width);
    await card.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  // Operations never fold: at every container width they stay one inline group after the name.
  for (const width of [300, 360, 480, 481, 760, 300]) {
    await resizeCard(width); await ensureComponentActions(card);
    const shown = await card.locator(":scope > .maintenance-panel-heading .component-action:visible").count();
    assert.ok(shown >= 2, `operations stay inline at ${width}px`);
    await assertComponentTree(card); await noOverflow();
  }
  await card.evaluate(node => (node as HTMLElement).style.removeProperty("width"));
  assert.equal(await count(), 0, "resizing and reveal never invoke maintenance");
  await page.getByRole("checkbox", { name: "超长头部", exact: true }).check();
  assert.match((await card.getByRole("heading", { level: 3 }).first().getAttribute("title"))!, /超长组件标题/);
  assert.ok((await pathLocation.locator(".local-path-text").getAttribute("data-tooltip"))!.length > 250, "ellipsis retains the complete path tooltip");
  for (const width of [300, 760]) {
    await resizeCard(width); await assertComponentTree(card); await noOverflow();
  }
  await resizeCard(300);
  const hiddenCard = await card.elementHandle();
  assert.ok(hiddenCard);
  await hiddenCard.evaluate(node => (node as HTMLElement).style.display = "none");
  await hiddenCard.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await hiddenCard.evaluate(node => (node as HTMLElement).offsetWidth), 0, "the hidden-card case really has zero layout width");
  await hiddenCard.evaluate(node => { (node as HTMLElement).style.width = "760px"; (node as HTMLElement).style.removeProperty("display"); });
  await hiddenCard.dispose();
  await assertComponentTree(card); await noOverflow();
  await resizeCard(300); await ensureComponentActions(card); await assertComponentTree(card); await noOverflow();
  await page.screenshot({ path: join(artifacts, "long-header-300.png"), fullPage: true });
  await page.getByRole("checkbox", { name: "超长头部", exact: true }).uncheck();
  await card.evaluate(node => (node as HTMLElement).style.removeProperty("width"));
  assert.equal(await count(), 0, "threshold probes and hidden-card recovery never invoke maintenance");
  await state.selectOption("download");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 850 }); await noOverflow();
      await assertComponentTree(card); await noOverflow();
      await card.getByText("时限与任务详情", { exact: true }).click();
      const template = card.getByRole("combobox", { name: "时限模板", exact: true });
      assert.equal(await template.evaluate(node => node.tagName), "BUTTON", "budget uses the shared themed Select");
      await template.click(); await assertSelectPosition(page, template);
      assert.equal(await page.getByRole("listbox").getByRole("option", { selected: true }).innerText(), "标准");
      await page.screenshot({ path: join(artifacts, `card-${theme}-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      assert.ok(await template.evaluate(node => node === document.activeElement));
      await card.getByText("时限与任务详情", { exact: true }).click();
    }
  }
  const missing = await page.locator(".maintenance-panel svg use").evaluateAll(elements => elements.map(element => element.getAttribute("href")!).filter(href => !document.querySelector(href)));
  assert.deepEqual(missing, [], "all glyphs resolve to actual SVG symbols");
  await page.getByRole("checkbox", { name: "提供独立环境", exact: true }).uncheck(); assert.equal(await environment.count(), 0);
  await page.getByRole("checkbox", { name: "提供独立环境", exact: true }).check();
  await page.getByRole("checkbox", { name: "紧凑视图", exact: true }).check();
  await card.getByText("时限与任务详情", { exact: true }).click();
  const template = card.getByRole("combobox", { name: "时限模板", exact: true }), total = card.getByRole("spinbutton", { name: "任务总时限" });
  await template.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("End"); await page.keyboard.press("Escape");
  assert.equal(await template.innerText(), "标准", "Escape does not commit a template");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  assert.equal(await template.innerText(), "大文件安装"); assert.equal(await total.inputValue(), "7200");
  await chooseSelect(page, template, "standard"); await chooseSelect(page, template, "slow"); assert.equal(await total.inputValue(), "3600");
  await total.fill("1800"); assert.equal(await template.innerText(), "自定义");
  await chooseSelect(page, template, "custom"); assert.equal(await total.inputValue(), "1800");
  await template.click(); await page.keyboard.press("Tab"); assert.equal(await page.getByRole("listbox").count(), 0);
  await template.click(); await card.getByText("时限与任务详情", { exact: true }).click(); assert.equal(await page.getByRole("listbox").count(), 0);
  await card.getByText("时限与任务详情", { exact: true }).click();
  await card.getByRole("button", { name: "延长本次时限", exact: true }).click();
  await chooseSelect(page, template, "standard"); assert.equal(await total.inputValue(), "1800", "running task cannot be shortened");
  const beforeOffline = await count();
  await page.getByRole("checkbox", { name: "保持连接", exact: true }).uncheck();
  assert.equal(await card.getByRole("button", { name: "取消任务", exact: true }).isDisabled(), true);
  assert.equal(await card.getByRole("button", { name: "延长本次时限", exact: true }).isDisabled(), true);
  assert.equal(await count(), beforeOffline);
  await page.getByRole("checkbox", { name: "保持连接", exact: true }).check();
  await page.getByRole("checkbox", { name: "隐藏重复任务错误", exact: true }).check();
  await page.getByRole("checkbox", { name: "模拟控制失败", exact: true }).check();
  await card.getByRole("button", { name: "取消任务", exact: true }).click();
  await card.getByText("模拟控制失败，原记录与文件保持不变。", { exact: true }).waitFor();
  await page.getByRole("checkbox", { name: "模拟控制失败", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "隐藏重复任务错误", exact: true }).uncheck();
  await card.getByRole("button", { name: "取消任务", exact: true }).click();
  await ensureComponentActions(card);
  await card.getByRole("button", { name: "卸载程序", exact: true }).waitFor();
  assert.equal(await card.locator(".maintenance-task,.maintenance-result").count(), 0, "cancelled work leaves no completed progress panel");
  for (const phase of ["checking", "verifying", "installing", "validating", "uncancellable"]) {
    await state.selectOption(phase); assert.equal(await card.getByRole("progressbar").count(), 0, "no stale download percentage outside download phase");
  }
  assert.equal(await card.getByRole("button", { name: "取消任务", exact: true }).count(), 0);
  await state.selectOption("waiting"); await card.getByText("正在等待当前执行结束；空闲后自动开始安装。", { exact: true }).waitFor();
  assert.equal(await card.getByRole("progressbar").count(), 0);
  for (const [phase, text] of Object.entries({ queued: "等待执行条件", checking: "检查中", downloading: "下载中", verifying: "校验中", installing: "安装中", validating: "验证中", removing: "清理中" })) {
    await state.selectOption(phase);
    assert.equal(await card.locator(".maintenance-task-copy strong").innerText(), text);
    assert.equal(await card.getByRole("progressbar").count(), phase === "downloading" ? 1 : 0);
    await state.selectOption(`cancelling-${phase}`);
    assert.match(await card.locator(".maintenance-task-copy strong").innerText(), /^正在取消/);
    assert.equal(await card.locator(".maintenance-status").innerText(), "正在取消");
  }
  for (const [connection, text] of Object.entries({ connecting: "正在连接", waiting: "等待数据", retrying: "等待重试", finished: "下载结束" })) {
    await state.selectOption(`${connection}-unknown`);
    assert.equal(await card.locator(".maintenance-meter-label strong").innerText(), text);
    assert.equal(await card.getByRole("progressbar").getAttribute("value"), null, "unknown totals never invent a percentage");
  }
  await state.selectOption("download-no-transfer"); assert.equal(await card.getByRole("progressbar").count(), 0);
  await state.selectOption("failure"); assert.equal(await card.getByRole("alert").count(), 1);
  await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true });
  for (const kind of ["unknown", "interrupted"]) {
    await state.selectOption(kind); const before = await count();
    await card.getByRole("button", { name: "核实中断任务", exact: true }).click();
    await card.getByText("已请求原位核实，未重复安装。", { exact: true }).waitFor(); assert.equal(await count(), before + 1);
  }
  await state.selectOption("success"); const result = card.locator(".maintenance-result");
  assert.equal(await card.locator(".maintenance-task,.maintenance-result").count(), 0, "successful work removes the complete progress panel");
  assert.equal(await card.getByText(/安装已完成|程序与专属环境已验证并切换。|用时/).count(), 0);
  assert.equal(await card.locator(".component-logs,.component-history").count(), 0);
  await page.getByRole("checkbox", { name: "保留旧未决", exact: true }).check();
  assert.equal(await result.count(), 0, "a new success does not compete with unresolved installation results");
  assert.equal(await card.locator('.maintenance-notice[data-status="unknown"],.maintenance-notice[data-status="interrupted"]').count(), 2);
  assert.equal(await card.getByText(/用时|查看任务详情/).count(), 0, "stopped or uncertain operations do not accrue fictional running time");
  assert.match(await card.locator(".component-unresolved").innerText(), /原操作不会自动重试/);
  assert.equal(await card.locator(".component-unresolved").getByRole("button").count(), 0, "read-only old evidence does not gain an invented recovery action");
  for (const theme of ["light", "dark"]) for (const width of [1200, 390, 320]) {
    await page.setViewportSize({ width, height: 850 }); await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await assertComponentHeader(card); await noOverflow();
    await page.screenshot({ path: join(artifacts, `mixed-${theme}-${width}.png`), fullPage: true });
  }
  await page.getByRole("checkbox", { name: "保留旧未决", exact: true }).uncheck();
  await ensureComponentActions(card); await ensureComponentActions(nodeCard);
  for (const operation of ["repair", "remove"]) {
    if (operation === "repair") await nodeCard.getByRole("button", { name: "修复环境", exact: true }).click();
    else await card.getByRole("button", { name: "卸载程序", exact: true }).click();
    const group = card.getByRole("group", { name: operation === "repair" ? "修复独立环境？" : "卸载示例程序？", exact: true });
    assert.equal(await group.evaluate(node => node.closest(".component-card")?.getAttribute("aria-label")), operation === "repair" ? "Node.js维护" : "示例程序维护", "confirmation belongs to the initiating card, not its parent");
    const before = await count(); await group.getByRole("button", { name: "取消", exact: true }).click(); assert.equal(await count(), before, "cancelling confirmation makes no request");
    await card.getByRole("button", { name: operation === "repair" ? "修复环境" : "卸载程序", exact: true }).click();
    await page.getByRole("checkbox", { name: "模拟控制失败", exact: true }).check();
    await group.getByRole("button", { name: operation === "repair" ? "确认修复" : "确认卸载", exact: true }).click();
    await group.getByRole("alert").waitFor(); assert.equal(await count(), before + 1); assert.equal(await group.isVisible(), true, "rejected action keeps inline confirmation and error");
    await page.getByRole("checkbox", { name: "模拟控制失败", exact: true }).uncheck();
    await group.getByRole("button", { name: operation === "repair" ? "确认修复" : "确认卸载", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await group.waitFor({ state: "detached" }); assert.equal(await count(), before + 2, "double submission invokes only once");
  }
  assert.equal(await page.getByRole("button", { name: "任务记录", exact: true }).count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await noOverflow();
  const touch = await browser.newPage({ viewport: { width: 320, height: 850 }, hasTouch: true, isMobile: true, reducedMotion: "reduce", serviceWorkers: "block" });
  await touch.route("**/*", guardRequests);
  touch.on("pageerror", error => errors.push(error.message));
  await touch.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  await touch.getByRole("combobox", { name: "测试状态" }).selectOption("idle");
  const touchCard = touch.getByRole("region", { name: "示例程序维护", exact: true });
  const touchActions = touchCard.locator(":scope > .maintenance-panel-heading .component-actions .component-action:visible");
  assert.equal(await touchActions.count(), 3);
  assert.equal(await touchCard.locator(":scope > .maintenance-panel-heading .component-actions").evaluate(node => getComputedStyle(node).opacity), "1", "touch shows operations without hover");
  // Visible size stays the glyph size; an invisible pseudo-element provides a >=24px (WCAG 2.5.8) hit area.
  const hitArea = (nodes: Element[]) => nodes.map(node => { const box = node.getBoundingClientRect(), before = getComputedStyle(node, "::before");
    return { visible: box.width, hitW: box.width - 2 * parseFloat(before.left), hitH: box.height - 2 * parseFloat(before.top), label: getComputedStyle(node.querySelector(".component-action-label") ?? node).display, padding: getComputedStyle(node).paddingTop }; });
  const touchHits = await touchActions.evaluateAll(hitArea);
  assert.ok(touchHits.every(hit => hit.hitW >= 24 && hit.hitH >= 24 && hit.padding === "0px" && (hit.label === "none" || hit.label === "inline-grid" || hit.label === "grid")), `touch actions are glyph-only with >=24px hit areas: ${JSON.stringify(touchHits)}`);
  const touchPathButtons = touchCard.locator(":scope > .maintenance-panel-heading .component-card-location button");
  assert.equal(await touchPathButtons.count(), 2, "both real path controls are covered");
  const pathHits = await touchPathButtons.evaluateAll(hitArea);
  assert.ok(pathHits.every(hit => hit.hitW >= 22 && hit.hitH >= 24), `copy/open have enlarged touch hit areas below the title: ${JSON.stringify(pathHits)}`);
  assert.ok(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "touch layout does not overflow at 320px");
  await touch.screenshot({ path: join(artifacts, "idle-touch-320.png"), fullPage: true });
  await assertComponentTree(touchCard);
  for (const child of await touchCard.locator(".component-card").all()) await ensureComponentActions(child);
  const visibleActions = touchCard.locator(".component-action:visible");
  assert.ok(await visibleActions.count() >= 4, "touch verification covers real visible controls");
  assert.ok((await visibleActions.evaluateAll(hitArea)).every(hit => hit.hitW >= 24 && hit.hitH >= 24), "each nested card keeps its own touch hit areas");
  await assertComponentHeader(touchCard);
  assert.equal(await touch.locator('output[aria-label="请求计数"]').innerText(), "0", "touch layout checks do not invoke an action");
  await touch.close();
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  const report = { passed: true, artifacts, scope: "Pure in-memory React fixture; no real maintenance. Generic supervisor uncertainty rendering is not integrated-component persisted history.", remote, cases: ["kind glyph spanning name/path, borderless operations after the name, uniform current/candidate versions, visible descriptions and distinct outer frame", "pointer reveal on card hover/keyboard focus, grey until pointed, temporary blockers remain discoverable with reasons", "touch: always-visible glyphs with >=24px invisible hit areas at 320", "dark/light 320/390/1200", "optional isolated environment", "phase-specific progress", "no folded operations at any container width, seven phases and collapsed success", "in-card unknown/interrupted reconciliation", "offline and capability gates", "inline confirmation cancellation/rejection/single submission", "no logs/history queries; mixed success and unresolved status priority", "themed Select keyboard/pointer/templates", "extend-only budgets", "control failure remains visible despite task-error deduplication", "no public task center", "SVG symbols"] };
  writeFileSync(join(artifacts, "result.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); rmSync(root, { recursive: true, force: true }); }
