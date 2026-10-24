import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryTemplate, memoryScope } from "../src/shared/memory.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

// Session/document regressions. Global browsing uses the current tree contract;
// memory-tree.check.ts covers tree search, zoom, source navigation and settings.
const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-memory-ui-"))), project = join(root, "project");
mkdirSync(project);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const openedFiles: string[] = [];
let holdOpen = false, releaseOpen: (() => void) | undefined;
const app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1", openMemoryFile: async (path) => { openedFiles.push(path); if (holdOpen) await new Promise<void>((resolve) => { releaseOpen = resolve; }); } });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const wait = async (condition: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 10000;
  while (!await condition()) { assert.ok(Date.now() < end, "condition timed out"); await new Promise((r) => setTimeout(r, 30)); }
};
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = (title: string): Scope => {
    const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    app.store.execute({ requestId: randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    return { workspaceId: workspace.id, sessionId: session.id };
  };
  const scope = create("记忆会话甲"), deleted = create("历史来源");
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,usage) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET usage=excluded.usage").run(scope.sessionId, JSON.stringify({ input: 64000, output: 0, cacheRead: 0, cacheWrite: 0, total: 64000, cost: null, context: { tokens: 64000, window: 128000, estimated: false } }));
  const path = join(memoryDirectory(root, scope.sessionId), "MEMORY.md");
  const entry = "## 目标与范围\n实现记忆浏览\n\n## 任务进度\n整体状态：进行中\n整体进度：约 30%\n当前进展：检查编辑与长路径 /Volumes/D_Work/axiom2/app/src/client/styles/toolbar-details.css，确认长说明正常换行。\n- [已完成] 存储\n- [进行中] 验证\n\n## 下一步与接续位置\n完成验证\n\n## 资料导航\n过程与验证见引用。[^details] 再次查看。[^details]\n\n[^details]: [过程说明](references/a%20b.md#details)\n";
  mkdirSync(join(memoryDirectory(root, scope.sessionId), "references"), { recursive: true });
  writeFileSync(join(memoryDirectory(root, scope.sessionId), "references", "a b.md"), "# 过程详情\n已验证资料导航解码\n\n" + Array.from({ length: 50 }, (_, i) => `## 依据 ${i + 1}\n保存实际观察、验证结果与下一步，保留可独立理解的上下文。`).join("\n\n"));
  const setEntry = (text: string) => { writeFileSync(path, text); app.agents.memories.scan(); };
  setEntry(entry);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const toggle = page.getByRole("button", { name: "上下文与会话记忆", exact: true });
  const todo = page.getByRole("dialog", { name: "上下文与会话记忆", exact: true });
  const panel = page.getByRole("dialog", { name: "会话记忆", exact: true });
  const global = page.getByRole("dialog", { name: "全局记忆", exact: true });
  const chat = page.locator("#content textarea").first(); await chat.fill("保留主聊天草稿");
  const closeTodo = async () => { await todo.getByRole("button", { name: "关闭统计详情", exact: true }).click(); await todo.waitFor({ state: "detached" }); };
  const openDocument = async () => { await toggle.click(); await todo.getByRole("button", { name: "查看完整记忆", exact: true }).click(); await panel.getByRole("button", { name: "编辑", exact: true }).waitFor(); };
  const closePanel = async () => { await page.getByRole("button", { name: "关闭记忆", exact: true }).click(); };
  const progress = async (text: string) => wait(async () => (await toggle.getAttribute("data-tooltip"))?.includes(text) === true);
  await progress("30%"); await toggle.click();
  await todo.locator('.memory-context-summary > summary').click();
  assert.match(await todo.locator(".memory-context-detail").innerText(), /64,000 \/ 128,000/);
  assert.match(await todo.locator(".memory-progress-summary").innerText(), /约 30%/);
  assert.equal(await toggle.innerText(), "");
  assert.equal(await todo.locator("pre").count(), 0);
  assert.equal(await todo.locator('li[data-state="进行中"] .memory-state-icon animateTransform').count(), 1);
  const contextArc = await toggle.locator(".context-ring.data-filled").getAttribute("d");
  await closeTodo();

  // Legacy formats remain readable without turning evidence links into tasks.
  setEntry("## 目标与状态\n继续真实任务。整体状态：进行中；整体进度：约60%。\n\n## 验证\n- [完整验收](artifacts/validation.md)\n- 普通证据说明");
  await progress("60%"); await toggle.click();
  await todo.getByText("尚未记录任务清单", { exact: true }).waitFor();
  assert.equal(await todo.locator("li").count(), 0); await closeTodo();
  setEntry("## 目标与范围\n第一轮：检查桌面。\n第二轮：等待设备。\n\n## 任务进度\n整体状态：阻塞（等待实体设备）\n整体进度：50%\n- [已完成] 桌面\n- [阻塞] 真机");
  await progress("50%"); await toggle.click();
  assert.equal(await todo.locator(".memory-status").getAttribute("data-tone"), "blocked");
  assert.equal(await todo.locator(".memory-state-reason").innerText(), "等待实体设备");
  assert.deepEqual(await todo.locator(".memory-goal-label").allInnerTexts(), ["第一轮：", "第二轮："]); await closeTodo();
  setEntry("## 目标与范围\n核对示例\n\n## 任务进度\n整体状态：进行中\n<!--\n- [x] 注释示例\n-->\n```md\n- [x] 围栏示例\n```\n~~~\n- [ ] 未闭合围栏");
  await progress("进度待评估"); await toggle.click();
  await todo.getByText("尚未记录任务清单", { exact: true }).waitFor();
  assert.equal(await todo.locator("li").count(), 0); await closeTodo();
  setEntry(entry); await progress("30%");
  const available = app.agents.memories.snapshot(scope)!;
  app.agents.memories.publish(memoryScope(scope), { ...available, reason: "unavailable" });
  await progress("记忆暂不可用"); await toggle.click();
  await todo.getByText("记忆暂不可用", { exact: true }).waitFor();
  assert.equal(await todo.locator(".memory-progress-summary").count(), 0); await closeTodo();
  app.agents.memories.publish(memoryScope(scope), available); await progress("30%");

  await openDocument();
  const references = panel.getByRole("link", { name: "查看引用 1", exact: true });
  await references.nth(1).click();
  await panel.getByRole("link", { name: "返回引用 1", exact: true }).click();
  assert.ok(await references.nth(1).evaluate(node => document.activeElement === node));
  holdOpen = true; await panel.getByRole("button", { name: "打开本地文件", exact: true }).click();
  await panel.getByRole("button", { name: "正在打开…", exact: true }).waitFor();
  holdOpen = false; releaseOpen!(); await panel.getByText("已提交本地打开请求").waitFor();
  assert.deepEqual(openedFiles, [path]);
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = panel.getByRole("textbox", { name: "记忆内容" });
  const draft = entry + "\n本地未保存修改\n"; await editor.fill(draft);
  setEntry(entry + "\n外部新事实\n");
  await panel.getByText("来源已更新。当前编辑已保留；保存前需核对并合并新内容。").waitFor();
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "资料已被修改" }).waitFor();
  assert.equal(await editor.inputValue(), draft);
  await panel.getByRole("button", { name: "读取最新版本以合并" }).click();
  await panel.getByRole("heading", { name: "最新版本 · 当前草稿保留在下方" }).waitFor();
  await editor.fill(draft + "外部新事实\n");
  await panel.getByRole("button", { name: "已核对，以此修订保存合并后的草稿" }).click();
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.ok(readFileSync(path, "utf8").includes("本地未保存修改\n外部新事实"));
  await panel.getByRole("link", { name: "过程说明", exact: true }).click();
  await panel.getByText("已验证资料导航解码", { exact: true }).waitFor();
  const scroller = panel.locator(".memory-dialog-body");
  const head = await panel.locator(":scope > header").boundingBox(), foot = await panel.locator(":scope > footer").boundingBox();
  const position = await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
  assert.ok(position > 300);
  assert.deepEqual(await panel.locator(":scope > header").boundingBox(), head);
  assert.deepEqual(await panel.locator(":scope > footer").boundingBox(), foot);
  await closePanel(); assert.ok(await toggle.evaluate(node => document.activeElement === node));

  // Dirty drafts guard close, back, outside click and switching to other toolbar details.
  await openDocument(); await panel.getByRole("button", { name: "编辑", exact: true }).click(); await editor.fill("未保存草稿");
  for (const name of ["返回全局记忆", "关闭记忆"]) {
    await panel.getByRole("button", { name, exact: true }).click();
    await panel.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(await editor.inputValue(), "未保存草稿");
  }
  await page.locator("#content .topnav").click({ position: { x: 180, y: 20 } });
  await panel.getByRole("button", { name: "继续编辑", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const metric = page.locator('#content [data-od-id="estimated-cost"]');
    await metric.click(); await panel.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(await editor.inputValue(), "未保存草稿");
    await metric.focus(); await metric.press("Enter");
    await panel.getByRole("button", { name: "放弃编辑并继续", exact: true }).click();
    await panel.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "关闭费用明细", exact: true }).click();
    await openDocument(); await panel.getByRole("button", { name: "编辑", exact: true }).click(); await editor.fill("未保存草稿");
  }
  await closePanel(); await panel.getByRole("button", { name: "放弃编辑并继续", exact: true }).click();
  assert.equal(await chat.inputValue(), "保留主聊天草稿");

  // Current global tree retains source navigation even after source-session deletion.
  (app.agents.memories as any).scheduleOrganization = () => {};
  writeFileSync(join(memoryDirectory(root, deleted.sessionId), "MEMORY.md"), "# [Completed] 保留历史记录\n");
  app.agents.memories.scan();
  const tree = app.agents.memories.pipeline.tree, batch = tree.batch(workspace.id, Date.now() + memoryBatchWaitMs);
  tree.publish(workspace.id, batch, tree.classify(JSON.stringify([{ name: "历史资料", children: batch.map(p => ({ purposeId: p.id })) }]), batch), tree.snapshot(workspace.id).version);
  app.store.execute({ requestId: randomUUID(), op: "session.delete", ...deleted, params: { confirmed: true } }); app.agents.memories.scan();
  await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("保留历史记录");
  await global.locator('.memory-tree-node[data-kind="Purpose"]').click();
  await global.locator(".memory-tree-source").click();
  await panel.getByText("来源会话已从普通列表移除，记忆仍保留。").waitFor();
  await panel.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  assert.equal(await global.getByRole("textbox", { name: "搜索记忆" }).inputValue(), "保留历史记录");
  await closePanel();

  mkdirSync("test-results/session-memory", { recursive: true });
  for (const [width, height] of [[360,800],[390,844],[430,932],[600,960],[640,800],[641,800],[650,800],[820,1180],[1024,768],[1366,768],[1440,900],[1920,1080],[390,480]]) {
    await page.setViewportSize({ width, height }); await toggle.click();
    await todo.getByText("已完成 1 / 2 项", { exact: true }).waitFor();
    const box = await todo.boundingBox(); assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1);
    assert.equal(await todo.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await page.screenshot({ path: `test-results/session-memory/tasks-${width}-${height}.png` }); await closeTodo();
    const trigger = page.getByRole("button", { name: "全局记忆", exact: true });
    await chat.focus(); await trigger.evaluate(button => button.addEventListener("mousedown", e => e.preventDefault(), { once: true }));
    await trigger.locator("svg").click();
    await global.getByRole("textbox", { name: "搜索记忆" }).waitFor();
    const bounds = await global.boundingBox(), toolbar = await page.locator("#content .usage").boundingBox();
    assert.ok(bounds && toolbar && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(Math.abs(bounds.y + bounds.height - (toolbar.y - 8)) < 2, "actual trigger anchors panel even without mouse focus");
    await closePanel(); assert.ok(await trigger.evaluate(node => document.activeElement === node));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  setEntry(entry.replace("整体状态：进行中", "整体状态：已完成").replace("整体进度：约 30%", "整体进度：100%").replace("- [进行中] 验证", "- [已完成] 验证"));
  await progress("100%"); await toggle.click();
  assert.equal(await todo.getByRole("progressbar", { name: "任务整体进度" }).getAttribute("value"), "100");
  assert.equal(await toggle.locator(".context-ring.data-filled").getAttribute("d"), contextArc);
  assert.equal(await todo.locator('animate[repeatCount="indefinite"],animateTransform').count(), 0);
  const completedIcons = todo.locator('.memory-state-icon[data-state="已完成"]');
  assert.equal(await completedIcons.count(), 2);
  for (const icon of await completedIcons.all()) {
    // The completed double-check glyph animates each of its two strokes once.
    assert.equal(await icon.locator("path > animate").count(), 2);
    for (const stroke of await icon.locator("path > animate").all()) {
      assert.equal(await stroke.getAttribute("attributeName"), "stroke-dashoffset");
      assert.equal(await stroke.getAttribute("from"), "1");
      assert.equal(await stroke.getAttribute("to"), "0");
      assert.equal(await stroke.getAttribute("dur"), "0.45s");
      assert.equal(await stroke.getAttribute("fill"), "freeze");
      assert.equal(await stroke.getAttribute("repeatCount"), null);
    }
  }
  await closeTodo();
  setEntry(memoryTemplate); await progress("暂无记录"); await toggle.click();
  await todo.getByText("还没有任务记录", { exact: true }).waitFor();
  assert.equal(await todo.locator("progress").count(), 0);
  await page.keyboard.press("Escape"); await todo.waitFor({ state: "detached" });
  assert.equal(await chat.inputValue(), "保留主聊天草稿"); assert.deepEqual(errors, []);
  console.log("PASS: legacy/empty states, subscriptions, footnotes, edit/conflict merge, drafts, deleted tree sources, 13 viewport layouts, focus and keyboard dismissal.");
} finally {
  releaseOpen?.(); await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
