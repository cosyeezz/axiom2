import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-optional-memory-ui-"));
const project = join(root, "project"); mkdirSync(project);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const output = process.env.AXIOM_TEST_OUTPUT ?? "test-results/optional-memory";
mkdirSync(output, { recursive: true });
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const path = join(root, "memory", "sessions", session.id, "MEMORY.md");
  writeFileSync(path, "## 目标与范围\n可选记忆验证\n\n## 任务进度\n整体状态：进行中\n整体进度：约 30%\n- [进行中] 验证\n");
  await app.agents.memories.scanAsync(scope);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const toggle = page.getByRole("button", { name: "上下文与会话记忆", exact: true });
  await toggle.click();
  const todo = page.getByRole("region", { name: "本会话任务", exact: true });
  await todo.getByText("可选记忆验证", { exact: true }).waitFor();
  await todo.getByRole("button", { name: "收起任务进度" }).click();
  const chat = page.locator("#content textarea").first();
  await chat.fill("记忆失败也要保留的聊天草稿");
  rmSync(path);
  await app.agents.memories.scanAsync(scope);
  await toggle.click();
  await todo.getByText("还没有任务记录", { exact: true }).waitFor();
  assert.equal(await todo.getByRole("alert").count(), 0);
  await todo.getByRole("button", { name: "查看记忆" }).click();
  const dialog = page.getByRole("dialog", { name: "会话记忆", exact: true });
  await dialog.getByText("暂无记忆", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("alert").count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "编辑", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "打开本地文件", exact: true }).isDisabled(), true);
  assert.equal(await chat.inputValue(), "记忆失败也要保留的聊天草稿");
  await page.screenshot({ path: join(output, "missing-memory.png") });
  await dialog.getByRole("button", { name: "关闭记忆" }).click();

  // Emulate a failed/older memory endpoint and failed subscription independently
  // of the new server's normal empty-result contract.
  const original = app.agents.memories.command.bind(app.agents.memories);
  app.agents.memories.command = async (command, signal) => {
    if (["memory.get", "memory.read", "memory.catalog"].includes(command.op)) throw new AppError("SCOPE_MISMATCH", "optional-memory-read-failure");
    return original(command, signal);
  };
  app.agents.memories.snapshot = () => { throw new AppError("SCOPE_MISMATCH", "optional-memory-subscription-failure"); };
  await page.reload();
  await toggle.click();
  await todo.getByText("还没有任务记录", { exact: true }).waitFor();
  assert.equal(await page.getByText(/订阅读取失败/).count(), 0);
  assert.equal(await todo.getByRole("alert").count(), 0);
  await todo.getByRole("button", { name: "查看记忆" }).click();
  await dialog.getByText("暂无记忆", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("alert").count(), 0);
  await dialog.getByRole("button", { name: "关闭记忆" }).click();
  await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  const global = page.getByRole("dialog", { name: "全局记忆", exact: true });
  await global.getByText("暂无已整理的会话", { exact: true }).waitFor();
  assert.equal(await global.getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, "failed-read-empty.png") });
  console.log("PASS: missing files, failed requests and subscriptions show empty memory; drafts and connection remain usable");
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
