import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { MemoryExecution } from "../src/server/memories.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-memory-organize-ui-"))), project = join(root, "project");
mkdirSync(project);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const wait = async (condition: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 10_000;
  while (!await condition()) { assert.ok(Date.now() < end, "condition timed out"); await new Promise((resolve) => setTimeout(resolve, 20)); }
};
let release: (() => void) | undefined;
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = (title: string, workspaceId = workspace.id, content = "## 目标与范围\n检查手动记忆整理\n") => {
    const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId }) as Session;
    app.store.execute({ requestId: randomUUID(), op: "session.rename", workspaceId, sessionId: session.id, params: { title } });
    const scope = { workspaceId, sessionId: session.id };
    writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), content);
    return scope;
  };
  const a = create("手动整理甲"), b = create("手动整理乙"); create("空白记忆", workspace.id, "");
  const otherProject = join(root, "other"); mkdirSync(otherProject);
  const other = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: otherProject, authorized: true } }) as Workspace;
  const foreign = create("另一空间来源", other.id);
  const entryPath = join(memoryDirectory(root, a.sessionId), "MEMORY.md"), original = readFileSync(entryPath);
  const calls: MemoryExecution[] = [];
  let mode: "hold" | "fail" | "complete" = "hold";
  app.agents.memories.runner = { close: async () => release?.(), execute: async (input) => {
    calls.push(input); input.read(input.scope.sessionId, "MEMORY.md");
    if (mode === "hold") await new Promise<void>((resolve) => { release = resolve; input.signal?.addEventListener("abort", () => resolve(), { once: true }); });
    if (mode === "fail") throw Error("模型暂不可用 api_key=sk-fixture-secret /Users/private/path/to/source.md");
    return { answer: JSON.stringify({ title: "记忆整理验收", summary: "已完成记忆整理验证，入口能够显示进度和结果，来源内容保持完整。" }), incomplete: false };
  } };
  await app.agents.memories.command({ requestId: randomUUID(), op: "memory.configure", ...a, params: { organizerModel: { provider: "fixture", id: "fixture", thinking: "off" } } });
  await app.agents.memories.scanAsync();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), a);
  await page.goto(app.origin);
  const document = page.getByRole("dialog", { name: "会话记忆", exact: true });
  const global = page.getByRole("dialog", { name: "全局记忆", exact: true });
  const resize = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    // Let ResizeObserver positioning and the top-layer compositor settle before capture.
    await page.evaluate(async () => {
      for (let frame = 0; frame < 5; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    assert.equal(await page.locator("dialog:visible").count(), 1, "resizing keeps one visible memory panel");
    assert.equal(await page.locator("#memory-heading").count(), 1, "resizing does not duplicate the memory heading");
  };
  const openDocument = async () => {
    await page.getByRole("button", { name: "上下文与会话记忆", exact: true }).click();
    await page.getByRole("button", { name: "查看完整记忆", exact: true }).click();
    await document.getByRole("button", { name: "编辑", exact: true }).waitFor();
  };
  const closeDocument = async () => { await document.getByRole("button", { name: "关闭记忆", exact: true }).click(); await document.waitFor({ state: "detached" }); };
  const openGlobal = async () => { await page.getByRole("button", { name: "全局记忆", exact: true }).click(); await global.getByRole("textbox", { name: "搜索记忆" }).waitFor(); };
  const currentButton = document.getByRole("button", { name: "立即整理", exact: true });
  await openDocument(); await wait(async () => await currentButton.isEnabled());
  assert.match(await currentButton.getAttribute("data-tooltip") ?? "", /已保存.*模型用量/);
  await document.getByRole("button", { name: "编辑", exact: true }).click();
  await document.getByRole("textbox", { name: "记忆内容" }).fill("不能自动保存的草稿");
  assert.equal(await currentButton.isDisabled(), true); assert.match(await currentButton.getAttribute("data-tooltip") ?? "", /先保存或取消编辑/);
  assert.deepEqual(readFileSync(entryPath), original); assert.equal(calls.length, 0);
  await document.getByRole("button", { name: "取消编辑", exact: true }).click(); await wait(async () => await currentButton.isEnabled());
  await currentButton.focus(); await currentButton.press("Enter"); await wait(() => calls.length === 1);
  await document.getByText("正在整理 0 / 1", { exact: true }).waitFor();
  const running = document.getByRole("button", { name: "整理中…", exact: true });
  assert.equal(await running.isDisabled(), true); assert.equal(await running.getAttribute("aria-busy"), "true");
  await running.evaluate((node) => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  assert.equal(calls.length, 1, "disabled controls prevent duplicate model work");
  mkdirSync("test-results/memory-organization", { recursive: true });
  for (const width of [1440, 820, 390, 320]) {
    await resize(width);
    const layout = await document.locator(".memory-document").evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `${width}px document does not overflow`);
    if (width < 641) assert.ok((await document.getByRole("button", { name: "取消整理", exact: true }).boundingBox())!.height >= 44);
    await page.screenshot({ path: `test-results/memory-organization/source-running-${width}.png` });
  }
  await closeDocument(); assert.equal(calls[0]!.signal?.aborted, false, "closing the panel keeps accepted work alive");
  await page.reload(); await openDocument(); await running.waitFor();
  assert.equal(calls.length, 1, "reload restores running state without repeating acceptance");
  mode = "complete"; release!();
  await document.getByText("整理完成：已生成 1 条摘要", { exact: true }).waitFor();
  assert.deepEqual(readFileSync(entryPath), original);
  mode = "hold"; await currentButton.click(); await wait(() => calls.length === 2);
  await document.getByRole("button", { name: "取消整理", exact: true }).click();
  await document.getByText("整理已取消", { exact: true }).waitFor(); assert.equal(calls[1]!.signal?.aborted, true);
  mode = "fail"; await currentButton.click();
  await document.getByText("整理失败，请重试", { exact: true }).waitFor();
  assert.match(await document.getByRole("alert").innerText(), /模型暂不可用/);
  assert.doesNotMatch(await document.getByRole("alert").innerText(), /sk-fixture-secret|\/Users\/private/);
  const failures = calls.length; mode = "complete"; await currentButton.click();
  await document.getByText("整理完成：已生成 1 条摘要", { exact: true }).waitFor();
  assert.equal(calls.length, failures + 1, "retry sends real organization work");
  assert.equal(await document.getByRole("alert").count(), 0);
  await closeDocument();
  await app.agents.memories.command({ requestId: randomUUID(), op: "memory.summaries.clear", workspaceId: workspace.id, params: { confirmed: true } });
  await openGlobal(); await global.getByText("暂无已整理的摘要", { exact: true }).waitFor();
  const workspaceButton = global.getByRole("button", { name: "整理工作空间", exact: true });
  assert.equal(await workspaceButton.isEnabled(), true, "empty catalog can still start organization");
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("没有匹配的筛选");
  mode = "hold"; const beforeWorkspace = calls.length; await workspaceButton.click(); await wait(() => calls.length > beforeWorkspace);
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("仍然可以搜索");
  const selectWorkspace = async (name: string) => {
    await global.getByRole("combobox", { name: "记忆工作空间" }).click();
    await global.getByRole("listbox", { name: "记忆工作空间" }).getByRole("option", { name, exact: true }).click();
  };
  await selectWorkspace(other.name);
  assert.equal(await global.getByText(/正在整理 \d+ \/ \d+/).count(), 0, "new workspace does not display the previous job progress");
  await workspaceButton.click(); await global.getByRole("alert").filter({ hasText: "已有记忆正在整理" }).waitFor();
  assert.equal(calls.length, beforeWorkspace + 1, "the shared slot rejects another workspace's concurrent request");
  await selectWorkspace(workspace.name);
  await global.getByText(/正在整理 \d+ \/ \d+/).waitFor();
  assert.equal(await global.getByRole("alert").count(), 0, "previous workspace errors cannot leak after switching");
  for (const width of [1440, 390, 320]) {
    await resize(width);
    const layout = await global.locator(".memory-organize").evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `${width}px workspace control does not overflow`);
    await page.screenshot({ path: `test-results/memory-organization/workspace-running-${width}.png` });
  }
  mode = "complete"; release!();
  await global.getByText("整理完成：已生成 2 条摘要，跳过 1 个无需整理的来源", { exact: true }).waitFor();
  assert.deepEqual(new Set(calls.slice(beforeWorkspace).map((call) => call.scope.sessionId)), new Set([a.sessionId, b.sessionId]));
  assert.equal(calls.some((call) => call.scope.sessionId === foreign.sessionId), false);
  assert.equal(await global.getByRole("textbox", { name: "搜索记忆" }).inputValue(), "", "workspace switches reset catalog filters");
  await wait(async () => await global.locator(".memory-catalog-item").count() === 2);
  await workspaceButton.click(); await global.getByText("暂无需要整理的内容", { exact: true }).waitFor();
  assert.equal(calls.length, beforeWorkspace + 2, "workspace action skips valid summaries and empty entries");
  assert.deepEqual(readFileSync(entryPath), original); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, modelCalls: calls.length, viewports: [1440, 820, 390, 320], checks: ["saved-only", "keyboard", "deduplicate", "reload", "cancel", "error-retry", "scope-switch", "workspace-all-sources", "empty-and-ready", "responsive"], pageErrors: errors }));
} finally {
  release?.(); await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
