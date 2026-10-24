import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-memory-tree-ui-")), project = join(root, "project"); mkdirSync(project);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const output = "/tmp/axiom-memory-tree-ui"; mkdirSync(output, { recursive: true });
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, memory = app.agents.memories;
  (memory as any).scheduleOrganization = () => {};
  writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), "# [Completed] 并发更新校验\n# [Completed] 查询未命中\n"); memory.scan(scope);
  // Sessions with no memory have source diagnostics, not failed classification jobs.
  for (let i = 0; i < 4; i++) {
    const missing = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    rmSync(join(memoryDirectory(root, missing.id), "MEMORY.md"), { force: true });
    memory.scan({ workspaceId: workspace.id, sessionId: missing.id });
  }
  const tree = memory.pipeline.tree, batch = tree.batch(workspace.id, Date.now() + memoryBatchWaitMs);
  const roots = tree.classify(JSON.stringify([
    { name: "数据库事务", children: [{ name: "贡献发布", children: [{ purposeId: batch.find(p => p.text === "并发更新校验")!.id }] }] },
    { name: "语义查询", children: [{ purposeId: batch.find(p => p.text === "查询未命中")!.id }] },
  ]), batch);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin); await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "全局记忆", exact: true }); await dialog.waitFor();
  await dialog.locator(".memory-tree-empty").waitFor();
  assert.ok((await dialog.boundingBox())!.width > 1000, "global memory gets a real map-sized workspace, not the shared 520px drawer");
  assert.ok((await dialog.locator(".memory-tree-canvas").boundingBox())!.height > 500, "empty document wrapper must not consume half the canvas height");
  const assertFullscreen = async (width: number, height: number) => {
    const bounds = (await dialog.boundingBox())!, canvas = (await dialog.locator(".memory-tree-canvas").boundingBox())!;
    assert.ok(Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1 && Math.abs(bounds.width - width) < 1 && Math.abs(bounds.height - height) < 1, `fullscreen fills ${width}×${height}, including the composer area`);
    assert.ok(Math.abs(canvas.x) < 1 && Math.abs(canvas.y) < 1 && Math.abs(canvas.width - width) < 1 && Math.abs(canvas.height - height) < 1, `the canvas itself fills every edge of ${width}×${height}, with no toolbar, padding or inspector space`);
    for (const selector of [".memory-tree-toolbar", ".memory-tree-status", ".memory-tree-settings", ".memory-tree-errors", ".memory-map-heading", ".memory-map-help"]) {
      assert.equal(await dialog.locator(selector).isVisible(), false, `${selector} must not appear in pure canvas fullscreen`);
    }
    assert.ok(await dialog.locator(".memory-tree-canvas").evaluate(node => { const style = getComputedStyle(node); return style.borderTopWidth === "0px" && style.borderRadius === "0px"; }), "fullscreen canvas has no panel border or rounded corners");
    assert.equal(await dialog.getByRole("button", { name: "退出全屏画布", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1), false, "fullscreen has no clipped/overflowing container");
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
  await assertFullscreen(1920, 1080);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).waitFor();
  assert.ok((await dialog.boundingBox())!.width <= 1440, "exit restores the original panel width without closing memory");
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await dialog.locator(".memory-tree-errors").count(), 0, "four missing sources must not be presented as organization failures");
  assert.match(await dialog.locator(".memory-tree-status").innerText(), /待整理 2 个目的/);
  tree.failure(batch, Error("classification fixture failed")); memory.publishTree(workspace.id);
  await dialog.locator(".memory-tree-errors").waitFor();
  assert.match(await dialog.locator(".memory-tree-errors summary").innerText(), /整理出错 1/);
  await dialog.locator(".memory-tree-errors summary").click();
  assert.match(await dialog.locator(".memory-tree-errors").innerText(), /classification fixture failed/);
  assert.doesNotMatch(await dialog.locator(".memory-tree-errors").innerText(), /记忆读取失败/);
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
  await assertFullscreen(1440, 900);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.locator(".memory-tree-errors").isVisible(), true, "exiting restores classification diagnostics");
  tree.publish(workspace.id, batch, roots, tree.snapshot(workspace.id).version); memory.publishTree(workspace.id);
  await dialog.locator('.memory-tree-node[data-kind="Directory"]').first().waitFor();
  await dialog.locator(".memory-tree-errors").waitFor({ state: "detached" });
  assert.equal(await dialog.locator(".memory-tree-errors").count(), 0, "successful retry clears the actual classification failure without reloading");
  assert.equal(await dialog.locator('.memory-tree-node[data-kind="Directory"]').count(), 2);
  await dialog.getByRole("button", { name: /分类.*数据库事务/ }).click();
  await dialog.getByRole("button", { name: /分类.*贡献发布/ }).click();
  await dialog.getByRole("button", { name: /目的.*并发更新校验/ }).click();
  await dialog.getByRole("complementary", { name: "记忆详情" }).getByText("并发更新校验", { exact: true }).last().waitFor();
  assert.equal(await dialog.getByRole("button", { name: "MEMORY.md", exact: true }).count(), 1);
  await dialog.getByRole("button", { name: "关闭记忆详情" }).click();
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
  await assertFullscreen(1440, 900);
  assert.equal(await dialog.getByRole("button", { name: /分类.*贡献发布/ }).getAttribute("aria-expanded"), "true", "fullscreen keeps manually expanded branches");
  await dialog.getByRole("button", { name: /目的.*并发更新校验/ }).click();
  await assertFullscreen(1440, 900);
  await dialog.getByRole("button", { name: "MEMORY.md", exact: true }).click();
  await page.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  await dialog.getByRole("button", { name: "退出全屏画布", exact: true }).waitFor();
  assert.equal(await dialog.getByRole("complementary", { name: "记忆详情" }).count(), 1, "source round trip retains map selection");
  await dialog.getByRole("button", { name: "关闭记忆详情" }).click();
  await assertFullscreen(1440, 900);
  await dialog.getByRole("button", { name: "退出全屏画布", exact: true }).click();
  await dialog.getByRole("button", { name: "处理记录", exact: true }).click();
  await dialog.getByRole("button", { name: "返回记忆", exact: true }).first().click();
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).waitFor();
  assert.equal(await dialog.locator(".memory-tree-toolbar").isVisible(), true, "normal mode restores workspace, search and records controls");
  await dialog.getByRole("button", { name: "记忆设置", exact: true }).click();
  const threshold = dialog.getByLabel("执行时限（秒）"); await threshold.fill("123"); await threshold.press("Tab");
  await page.waitForFunction(() => !document.querySelector('.memory-tree-settings fieldset[disabled]'));
  assert.equal(memory.preferences().timeoutMs, 123000);
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
  await assertFullscreen(1440, 900);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.locator(".memory-tree-settings").isVisible(), true, "settings state is retained, but only shown outside fullscreen");
  assert.equal(await threshold.inputValue(), "123");
  await dialog.getByRole("button", { name: "记忆设置", exact: true }).click();
  await dialog.getByLabel("搜索记忆").fill("未命中");
  assert.equal(await dialog.locator('.memory-tree-node[data-kind="Directory"]').count(), 1);
  await page.waitForTimeout(400);
  await dialog.getByRole("button", { name: "放大记忆树", exact: true }).click();
  await page.waitForTimeout(400);
  const viewBeforeFullscreen = await dialog.locator(".memory-tree-stage").evaluate(node => getComputedStyle(node).transform);
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
  await assertFullscreen(1440, 900);
  await page.waitForTimeout(400);
  assert.ok(await dialog.locator(".memory-tree-stage").evaluate((node, before) => new DOMMatrix(getComputedStyle(node).transform).a === new DOMMatrix(before).a, viewBeforeFullscreen), "fullscreen does not refit the user's zoom");
  await page.screenshot({ path: join(output, "tree-fullscreen-1440.png") });
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await dialog.getByLabel("搜索记忆").inputValue(), "未命中", "Escape exits fullscreen without clearing search or closing memory");
  assert.equal(await dialog.locator(".memory-tree-stage").evaluate(node => getComputedStyle(node).transform), viewBeforeFullscreen, "fullscreen round trip preserves pan and zoom");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false, `no dialog overflow at ${width}`);
    const box = (await dialog.locator(".memory-tree-canvas").boundingBox())!, controls = (await dialog.locator(".memory-tree-zoom").boundingBox())!;
    assert.ok(controls.x >= box.x && controls.x + controls.width <= box.x + box.width, `map controls remain accessible at ${width}`);
    if (width < 700) {
      assert.ok(await dialog.locator(".memory-tree-stage").evaluate(node => new DOMMatrix(getComputedStyle(node).transform).a >= .9), "phone search focuses a readable branch instead of shrinking every label");
      await page.waitForTimeout(400);
      assert.ok(await dialog.locator('.memory-tree-node[data-kind="Purpose"]').evaluate(node => { const bounds = node.getBoundingClientRect(), canvas = node.closest(".memory-tree-canvas")!.getBoundingClientRect(); return bounds.left >= canvas.left && bounds.right <= canvas.right && bounds.top >= canvas.top && bounds.bottom <= canvas.bottom; }), "phone matching purpose is actually visible, not just rendered offscreen");
    }
    await page.screenshot({ path: join(output, `tree-${width}.png`) });
    await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
    await assertFullscreen(width, 900);
    await page.waitForTimeout(400);
    assert.ok(await dialog.locator('.memory-tree-node[data-kind="Purpose"]').evaluate(node => { const bounds = node.getBoundingClientRect(), canvas = node.closest(".memory-tree-canvas")!.getBoundingClientRect(); return bounds.right > canvas.left && bounds.left < canvas.right && bounds.bottom > canvas.top && bounds.top < canvas.bottom; }), "fullscreen preserves an onscreen matching purpose");
    await page.screenshot({ path: join(output, `tree-fullscreen-${width}.png`) });
    await dialog.getByRole("button", { name: "退出全屏画布", exact: true }).click();
    await dialog.getByRole("button", { name: "全屏画布", exact: true }).waitFor();
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await dialog.getByRole("button", { name: "全屏画布", exact: true }).click();
  await assertFullscreen(844, 390);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(output, "tree-fullscreen-landscape.png") });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []); console.log("Memory tree UI: missing sources excluded, real classification failure/recovery, source detail, semantic-tree browsing, settings persistence, search, edge-to-edge pure canvas fullscreen (no toolbar/settings/diagnostics), Escape/state/source/records round trips, desktop/mobile/landscape passed");
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
}
