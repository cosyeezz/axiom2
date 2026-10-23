import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
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
  writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), "# 事务验证\n仅覆盖同一来源，其他文件贡献保留。\n"); memory.scan(scope);
  memory.pipeline.tree.publish(workspace.id, { sessionId: session.id, path: "MEMORY.md", revision: memory.read(scope).revision, records: [], dependencies: [] }, [], [
    { topic: "数据库事务", section: "贡献发布", item: "并发更新校验", content: "仅覆盖同一来源，其他文件贡献保留。" },
    { topic: "语义查询", section: "来源选择", item: "查询未命中", content: "未命中时直接结束。" },
  ], memory.pipeline.tree.signature(workspace.id));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin); await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "全局记忆", exact: true }); await dialog.waitFor();
  await dialog.locator('.memory-tree-node[data-kind="Topic"]').first().waitFor();
  assert.equal(await dialog.locator('.memory-tree-node[data-kind="Topic"]').count(), 2);
  await dialog.getByRole("button", { name: /Topic.*数据库事务/ }).click();
  await dialog.getByRole("button", { name: /Section.*贡献发布/ }).click();
  await dialog.getByRole("button", { name: /Item.*并发更新校验/ }).click();
  await dialog.getByRole("complementary", { name: "记忆详情" }).getByText("仅覆盖同一来源，其他文件贡献保留。", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "关闭记忆详情" }).click();
  await dialog.getByRole("button", { name: "记忆设置", exact: true }).click();
  const threshold = dialog.getByLabel("Topic 名称总文字量软审查阈值（字）"); await threshold.fill("1234"); await threshold.press("Tab");
  await page.waitForFunction(() => !document.querySelector('.memory-tree-settings fieldset[disabled]'));
  assert.equal(memory.preferences().topicNameReviewThresholdChars, 1234);
  await dialog.getByRole("button", { name: "记忆设置", exact: true }).click();
  await dialog.getByLabel("搜索记忆").fill("未命中");
  assert.equal(await dialog.locator('.memory-tree-node[data-kind="Topic"]').count(), 1);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(100);
    assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false, `no dialog overflow at ${width}`);
    await page.screenshot({ path: join(output, `tree-${width}.png`) });
  }
  assert.deepEqual(errors, []); console.log("Memory tree UI: source detail, semantic-tree browsing, settings persistence, search, 4 widths passed");
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
}
