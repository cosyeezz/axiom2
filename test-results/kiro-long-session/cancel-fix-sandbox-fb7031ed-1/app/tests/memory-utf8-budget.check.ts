import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryEditBudgetBytes } from "../src/shared/memory.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-memory-utf8-budget-")), project = join(root, "project");
mkdirSync(project);
const app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const path = join(memoryDirectory(root, scope.sessionId), "MEMORY.md");
  writeFileSync(path, "## 目标与范围\nUTF-8 编辑预算\n");
  await app.agents.memories.scanAsync(scope);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript((current) => sessionStorage.setItem("view", JSON.stringify(current)), scope);
  await page.goto(app.origin);
  const todo = page.getByRole("region", { name: "本会话任务进度" });
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  await page.getByRole("dialog", { name: "上下文与会话记忆", exact: true }).getByRole("button", { name: "查看完整记忆" }).click();
  const dialog = page.getByRole("dialog", { name: "会话记忆", exact: true });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = dialog.getByRole("textbox", { name: "记忆内容" });
  const atLimit = "😀".repeat(memoryEditBudgetBytes / 4);
  await editor.fill(`${atLimit}😀`);
  await dialog.getByRole("alert").filter({ hasText: "UTF-8 编辑预算" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "保存", exact: true }).isDisabled(), true, "UTF-16 长度不足以判定 emoji 的 UTF-8 字节是否超限");
  await editor.fill(atLimit);
  assert.equal(await dialog.getByRole("alert").filter({ hasText: "UTF-8 编辑预算" }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "保存", exact: true }).isDisabled(), false);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(readFileSync(path).byteLength, memoryEditBudgetBytes);

  // 180 KB 保存合法，但普通查看器会按页读取；先换成完整小文件再进入可编辑合并路径。
  writeFileSync(path, "## 目标与范围\n合并与保存草稿保护\n");
  await app.agents.memories.scanAsync(scope);
  await dialog.getByRole("button", { name: "重新读取", exact: true }).click();
  await dialog.getByRole("button", { name: "编辑", exact: true }).waitFor();

  // 多页最新版本必须使用同一字节上限，且不能覆盖当前草稿。
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.fill("合并前保留的草稿");
  const original = app.agents.memories.command.bind(app.agents.memories);
  let latestReadCalls = 0, saveCalls = 0;
  app.agents.memories.command = async (command, signal) => {
    if (command.op === "memory.read") latestReadCalls++;
    if (command.op === "memory.save") { saveCalls++; throw Error("服务端拒绝保存"); }
    return original(command, signal);
  };
  writeFileSync(path, "😀".repeat(memoryEditBudgetBytes / 4 + 1));
  await app.agents.memories.scanAsync(scope);
  await dialog.getByRole("button", { name: "读取最新版本以合并", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "UTF-8 编辑预算" }).waitFor();
  assert.ok(latestReadCalls > 1, "超限合并必须实际读取分页资料");
  assert.equal(await editor.inputValue(), "合并前保留的草稿", "超限合并不能覆盖编辑草稿");

  // 服务端拒绝保存时，界面仍须保留未超限草稿。
  await editor.fill("服务端拒绝后仍需保留的草稿");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "请求未完成，数据未确认保存；请检查服务或请求格式。" }).waitFor();
  assert.equal(saveCalls, 1, "服务端拒绝夹具必须且只能调用一次 memory.save");
  assert.equal(await editor.inputValue(), "服务端拒绝后仍需保留的草稿");

  // Browsing has no editing-budget cutoff; once fully loaded an oversized file
  // can still be shortened in the editor, but cannot be saved while oversized.
  app.agents.memories.command = original;
  await dialog.getByRole("button", { name: "取消编辑", exact: true }).click();
  const more = dialog.getByRole("button", { name: "继续读取 · 内容尚未完整", exact: true });
  await more.waitFor();
  while (await more.count()) {
    await more.click();
    await dialog.getByRole("button", { name: "重新读取", exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.memory-document [aria-label="记忆内容"]') && !document.querySelector('.memory-document .memory-loading'));
  }
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "UTF-8 编辑预算" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  await editor.fill("缩减后的有效内容");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(readFileSync(path, "utf8"), "缩减后的有效内容");
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
}
