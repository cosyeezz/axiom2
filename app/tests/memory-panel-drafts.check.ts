import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-memory-panel-drafts-")), project = join(root, "project");
mkdirSync(project);
const app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const wait = async (condition: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 10_000;
  while (!await condition()) { assert.ok(Date.now() < deadline, "condition timed out"); await new Promise((resolve) => setTimeout(resolve, 25)); }
};

try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const path = join(memoryDirectory(root, scope.sessionId), "MEMORY.md");
  const original = "## 目标与范围\n验证记忆编辑保护\n\n## 下一步与接续位置\n保存前核对修订\n";
  writeFileSync(path, original); app.agents.memories.scan(scope);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((current) => sessionStorage.setItem("view", JSON.stringify(current)), scope);
  await page.goto(app.origin);
  const todo = page.getByRole("region", { name: "本会话任务进度" });
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  await page.getByRole("dialog", { name: "上下文与会话记忆", exact: true }).getByRole("button", { name: "查看完整记忆" }).click();
  const dialog = page.getByRole("dialog", { name: "会话记忆", exact: true });
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = dialog.getByRole("textbox", { name: "记忆内容" });
  const draft = `${original}\n本地未保存草稿\n`;
  await editor.fill(draft);

  // A subscription update must not replace a dirty editor with the new source.
  writeFileSync(path, `${original}\n外部来源更新\n`); app.agents.memories.scan(scope);
  await dialog.getByText("来源已更新。当前编辑已保留；保存前需核对并合并新内容。").waitFor();
  assert.equal(await editor.inputValue(), draft);

  // Returning to the catalog is a source switch and is guarded before the view changes.
  await dialog.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  const keep = dialog.getByRole("button", { name: "继续编辑", exact: true });
  await keep.waitFor(); await keep.click();
  assert.equal(await editor.inputValue(), draft, "keeping the edit must retain the source-specific draft");
  assert.equal(await dialog.getByRole("heading", { name: "会话记忆", exact: true }).count(), 1);

  // The stale revision may never overwrite the externally updated source.
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "资料已被修改" }).waitFor();
  assert.equal(await editor.inputValue(), draft, "a revision conflict keeps the unsaved draft for merging");
  assert.equal(readFileSync(path, "utf8").includes("外部来源更新"), true);
  assert.equal(readFileSync(path, "utf8").includes("本地未保存草稿"), false);

  // Only explicit discard completes the requested source switch.
  await dialog.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  await dialog.getByRole("button", { name: "放弃编辑并继续", exact: true }).click();
  await page.getByRole("dialog", { name: "全局记忆", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await page.close();
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
}
