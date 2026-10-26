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
const screenshots = mkdtempSync(join(tmpdir(), "axiom-memory-organize-shots-"));
mkdirSync(project);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const wait = async (condition: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 15_000;
  while (!await condition()) { assert.ok(Date.now() < end, "condition timed out"); await new Promise(resolve => setTimeout(resolve, 20)); }
};
let release: (() => void) | undefined;
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = (title: string, workspaceId = workspace.id, content = "# 自动整理验收\n## [进行中] 验证记忆整理\n") => {
    const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId }) as Session;
    app.store.execute({ requestId: randomUUID(), op: "session.rename", workspaceId, sessionId: session.id, params: { title } });
    writeFileSync(join(memoryDirectory(root, session.id), "MEMORY.md"), content);
    return { workspaceId, sessionId: session.id };
  };
  const a = create("自动整理甲"), b = create("自动整理乙"); create("空白记忆", workspace.id, "");
  const otherProject = join(root, "other"); mkdirSync(otherProject);
  const other = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: otherProject, authorized: true } }) as Workspace;
  const foreign = create("另一空间来源", other.id);
  const entryPath = join(memoryDirectory(root, a.sessionId), "MEMORY.md"), original = readFileSync(entryPath);
  const calls: MemoryExecution[] = [];
  let mode: "hold" | "fail" | "complete" = "hold";
  app.agents.memories.runner = { close: async () => release?.(), execute: async input => {
    calls.push(input); assert.ok(JSON.parse(input.prompt).currentFile.content);
    if (mode === "hold") await new Promise<void>(resolve => { release = resolve; input.signal?.addEventListener("abort", () => resolve(), { once: true }); });
    if (mode === "fail") throw Error("模型暂不可用 api_key=sk-fixture-secret /Users/private/path/to/source.md");
    return { answer: JSON.stringify([{ topic: "记忆整理验收", section: "关联资料", item: "整理验证", content: "相同经验合并展示并保留所有来源。" }]), incomplete: false };
  } };
  await app.agents.memories.command({ requestId: randomUUID(), op: "memory.configure", ...a, params: { organizerModel: { provider: "fixture", id: "fixture", thinking: "off" }, intervalMs: 86400000 } });
  await app.agents.memories.scanAsync();
  const status = (scope = a) => app.agents.memories.catalog(scope.workspaceId).find(entry => entry.sessionId === scope.sessionId)?.status;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), a);
  await page.goto(app.origin);
  const document = page.getByRole("dialog", { name: "会话记忆", exact: true });
  const global = page.getByRole("dialog", { name: "全局记忆", exact: true });
  const openDocument = async () => {
    await page.getByRole("button", { name: "上下文与会话记忆", exact: true }).click();
    await page.getByRole("button", { name: "查看完整记忆", exact: true }).click();
    await document.getByRole("button", { name: "编辑", exact: true }).waitFor();
  };
  const closeDocument = async () => { await document.getByRole("button", { name: "关闭记忆", exact: true }).click(); await document.waitFor({ state: "detached" }); };
  await openDocument(); assert.equal(await document.getByRole("button", { name: "立即整理", exact: true }).count(), 0);
  await document.getByRole("button", { name: "编辑", exact: true }).click();
  await document.getByRole("textbox", { name: "记忆内容" }).fill("# 草稿\n## [已完成] 不应整理未保存内容\n");
  assert.deepEqual(readFileSync(entryPath), original); assert.equal(calls.length, 0);
  await document.getByRole("button", { name: "取消编辑", exact: true }).click();
  const completed = "# 自动整理验收\n## [已完成] 验证记忆整理\n";
  writeFileSync(entryPath, completed); await app.agents.memories.scanAsync(a); await wait(() => calls.length === 1);
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    assert.equal(await page.locator("dialog:visible").count(), 1);
    const layout = await document.locator(".memory-document").evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(layout.scroll <= layout.width + 1, `${width}px document does not overflow`);
    await page.screenshot({ path: join(screenshots, `source-${width}.png`) });
  }
  await closeDocument(); assert.equal(calls[0].signal?.aborted, false);
  await page.reload(); await openDocument(); assert.equal(calls.length, 1, "reload does not reissue work");
  mode = "complete"; release!(); await wait(() => status() === "ready");
  assert.equal(readFileSync(entryPath, "utf8"), completed);
  await closeDocument(); await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  await global.getByRole("textbox", { name: "搜索记忆" }).waitFor();
  assert.equal(await global.getByRole("button", { name: "整理工作空间", exact: true }).count(), 0);
  await global.getByRole("button", { name: "记忆设置", exact: true }).click();
  await global.getByText(/任务完成后立即自动整理/).waitFor();
  assert.equal(await global.getByText(/30分钟|整理间隔/).count(), 0);
  await global.getByRole("button", { name: "记忆设置", exact: true }).click();
  mode = "fail"; writeFileSync(entryPath, completed + "新经验\n"); await app.agents.memories.scanAsync(a);
  await wait(() => status() === "error"); await global.locator(".memory-tree-errors summary").click();
  const failure = await global.locator(".memory-tree-errors").innerText();
  assert.match(failure, /模型暂不可用/); assert.doesNotMatch(failure, /sk-fixture-secret|\/Users\/private/);
  const failures = calls.length; await app.agents.memories.scanAsync(a); assert.equal(calls.length, failures, "unchanged errors back off");
  mode = "complete"; writeFileSync(entryPath, completed + "修订后的经验\n"); await app.agents.memories.scanAsync(a);
  await wait(() => status() === "ready"); await global.locator(".memory-tree-errors").waitFor({ state: "detached" });
  writeFileSync(join(memoryDirectory(root, b.sessionId), "MEMORY.md"), completed); await app.agents.memories.scanAsync(b);
  await wait(() => status(b) === "ready");
  await global.locator('.memory-tree-node[data-kind="Topic"]').waitFor();
  assert.equal(await global.locator('.memory-tree-node[data-kind="Topic"]').count(), 1);
  await global.locator('.memory-tree-node[data-kind="Topic"]').click();
  await global.locator('.memory-tree-node[data-kind="Section"]').click();
  await global.locator('.memory-tree-node[data-kind="Item"]').click();
  await wait(async () => await global.locator('.memory-tree-source').count() === 2);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: join(screenshots, `tree-${width}.png`) });
  }
  await global.getByRole("combobox", { name: "记忆工作空间" }).click();
  await global.getByRole("listbox", { name: "记忆工作空间" }).getByRole("option", { name: other.name, exact: true }).click();
  await global.getByText("暂无已整理记忆", { exact: true }).waitFor();
  assert.equal(await global.locator(".memory-tree-errors").count(), 0);
  assert.equal(calls.some(call => call.scope.sessionId === foreign.sessionId), false);
  assert.equal(readFileSync(entryPath, "utf8"), completed + "修订后的经验\n"); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, modelCalls: calls.length, screenshots, viewports: [1440, 820, 390, 320], checks: ["no-manual-controls", "completion-immediate", "saved-only", "reload-deduplicate", "error-backoff", "revision-retry", "scope-switch", "merged-provenance"], pageErrors: errors }));
} finally {
  release?.(); await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
