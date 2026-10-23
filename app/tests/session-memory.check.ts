import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryTemplate, memorySummaryVersion, memoryCatalogScope, memoryScope, type MemoryCatalogEntry } from "../src/shared/memory.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

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
  const a = create("记忆会话甲"), b = create("记忆会话乙");
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,usage) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET usage=excluded.usage").run(a.sessionId, JSON.stringify({ input: 64000, output: 0, cacheRead: 0, cacheWrite: 0, total: 64000, cost: null, context: { tokens: 64000, window: 128000, estimated: false } }));
  // Supply organizer outcomes without making remote model requests in this UI check.
  const summaryText = "记录会话记忆浏览、编辑与资料引用的实现。\n先排查入口定位，再校验来源修订与未保存草稿。\n已完成关联资料导航、脚注跳转和冲突合并验证。\n来源更新时摘要失效，避免把过期结果展示成当前内容。\n后续可通过关联记忆查看完整过程、验证依据与接续事项。";
  const summaryFor = (scope: Scope, status: MemoryCatalogEntry["status"] = "ready", summary = summaryText) => {
    const source = app.agents.memories.catalog(workspace.id).find((entry) => entry.sessionId === scope.sessionId);
    assert.ok(source);
    app.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...source, status, summary, summaryVersion: memorySummaryVersion, indexedAt: status === "ready" ? Date.now() : null, error: undefined }), scope.sessionId);
    app.agents.memories.publish(memoryCatalogScope(workspace.id), app.agents.memories.catalog(workspace.id));
  };
  create("空白模板会话");
  writeFileSync(join(root, "memory", "sessions", b.sessionId, "MEMORY.md"), "## 目标与范围\n保留历史迁移记录\n\n## 结论与决定\n已完成资料迁移并保留原始文件。");
  const path = join(root, "memory", "sessions", a.sessionId, "MEMORY.md");
  const entry = "## 目标与范围\n实现记忆浏览\n\n## 任务进度\n整体状态：进行中\n整体进度：约 30%\n当前进展：检查编辑与长路径 /Volumes/D_Work/axiom2/app/src/client/styles/toolbar-details.css，确认长说明内容正常换行且短标签保持横排。\n- [已完成] 存储\n- [进行中] 验证\n\n## 下一步与接续位置\n完成验证\n\n## 资料导航\n过程与验证见引用。[^details] 再次查看。[^details]\n\n[^details]: [过程说明](references/a%20b.md#details)\n";
  mkdirSync(join(root, "memory", "sessions", a.sessionId, "references"));
  writeFileSync(join(root, "memory", "sessions", a.sessionId, "references", "a b.md"), "# 过程详情\n已验证资料导航解码\n\n" + Array.from({ length: 50 }, (_, i) => `## 依据 ${i + 1}\n保存实际观察、验证结果与下一步，保留可独立理解的上下文。`).join("\n\n"));
  writeFileSync(path, entry); app.agents.memories.scan();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const animated = async (selector: string) => {
    const moving = await page.locator(selector).evaluate(async (svg) => {
      (svg as SVGSVGElement).setCurrentTime(0.1);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const before = [...svg.querySelectorAll("circle")].map((circle) => [circle.r.animVal.value, getComputedStyle(circle).opacity]), start = performance.now();
      while (performance.now() - start < 280) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return [...svg.querySelectorAll("circle")].some((circle, i) => Math.abs(circle.r.animVal.value - Number(before[i][0])) > 0.01 || getComputedStyle(circle).opacity !== before[i][1]);
    });
    assert.ok(moving, `${selector} remains animated under reduced motion`);
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), a);
  await page.goto(app.origin);
  const todo = page.getByRole("region", { name: "本会话任务进度" });
  const todoBody = page.getByRole("dialog", { name: "上下文与会话记忆", exact: true });
  const closeTodo = async () => { await todoBody.getByRole('button', {name:'关闭统计详情',exact:true}).click(); await todoBody.waitFor({state:'detached'}); };
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("30%") === true);
  const chat = page.locator("#content textarea").first();
  await chat.fill("保留主聊天草稿");
  assert.equal(await todo.locator('.memory-todo-toggle').innerText(), '', 'toolbar is icon-only');
  assert.equal(await page.locator('#content [data-od-id="context-capacity"]').count(), 1);
  assert.equal(await todo.locator('svg.data-icon-context-memory[data-value="50"]').count(), 1);
  const contextArc = await todo.locator('.context-ring.data-filled').getAttribute('d');
  assert.ok(contextArc, 'context capacity renders a filled arc');
  assert.equal(await todo.locator('.memory-todo-toggle .memory-progress-bars').count(), 1, "context capacity retains the memory list symbol");
  assert.equal(await todo.locator('.memory-todo-toggle animate, .memory-todo-toggle animateTransform').count(), 0, "context capacity is a static measurement, independent of active tasks");
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  assert.match(await todoBody.locator('.memory-context-detail').innerText(), /64,000 \/ 128,000/);
  assert.match(await todoBody.locator('.memory-context-detail').innerText(), /50.0%/);
  assert.match(await todoBody.locator('.memory-progress-summary').innerText(), /约 30%/);
  assert.equal(await todoBody.locator('pre').count(), 0, "Todo 首层不展示 MEMORY.md 原文");
  await animated('.memory-todo-body li[data-state="进行中"] .bubble-loading');
  assert.equal(await todoBody.locator('li[data-state="已完成"] animate').count(), 0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await todoBody.locator('.memory-next').evaluate(node => ({
      labels: [...node.querySelectorAll('dt')].map(label => { const css = getComputedStyle(label), range = document.createRange(); range.selectNodeContents(label); return { width: label.getBoundingClientRect().width, height: range.getBoundingClientRect().height, line: parseFloat(css.lineHeight), nowrap: css.whiteSpace }; }),
      overflow: node.scrollWidth > node.clientWidth + 1,
    }));
    assert.ok(layout.labels.length > 0);
    for (const label of layout.labels) { assert.equal(label.nowrap, 'nowrap'); assert.ok(label.height <= label.line + 1); assert.ok(label.width >= 48); }
    assert.equal(layout.overflow, false, 'long content wraps without squeezing labels into a vertical column');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await closeTodo();
  const nonstandardEntry = "## 目标与状态\n继续真实任务，浏览器与截图解码验证中。整体状态：进行中；整体进度：约60%。类型与构建已通过。\n\n## 验证与交付\n- [完整验收](artifacts/validation.md)\n- 普通证据说明\n\n## 后续\n尚未部署本轮新布局。";
  writeFileSync(path, nonstandardEntry); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("60%") === true);
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  assert.match(await todoBody.locator(".memory-goal-text").innerText(), /继续真实任务.*浏览器与截图解码验证中/s);
  assert.equal(await todoBody.getByRole("heading", { name: /继续真实任务/ }).count(), 0, "目标正文不再作为标题渲染");
  assert.equal(await todoBody.locator(".memory-goal-toggle").count(), 0, "短目标完整显示，不提供展开按钮");
  assert.match(await todoBody.locator('.memory-progress-summary').innerText(), /进行中.*约 60%/s);
  await todoBody.getByText("尚未记录任务清单", { exact: true }).waitFor();
  assert.equal(await todoBody.locator('li').count(), 0, "证据链接和普通项目符号不能生成 Todo");
  assert.equal(await todoBody.locator('pre').count(), 0, "兼容旧栏目也不回退为正文预览");
  await closeTodo();
  const blockedEntry = "## 目标与范围\n第一轮：用户要求重新设计记忆卡片。\n第二轮：" + "目标按段落分开阅读，每段默认完整显示。".repeat(6) + "\n第三轮：实现记忆卡片阻塞态展示。\n- 范围：只改工具栏卡片，地址 https://example.test:8080/a 保持原样。\n\n## 任务进度\n整体状态：阻塞（等待实体设备）\n整体进度：约 50%\n- [已完成] 检查桌面\n- [阻塞] 等待实体设备";
  writeFileSync(path, blockedEntry); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("50%") === true);
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  assert.equal(await todoBody.locator(".memory-status").getAttribute("data-tone"), "blocked");
  assert.equal(await todoBody.locator(".memory-state-badge").innerText(), "阻塞");
  assert.equal(await todoBody.locator(".memory-state-reason").innerText(), "等待实体设备", "阻塞原因单独展示，不混在状态徽章里");
  assert.match(await todoBody.locator(".memory-progress-summary").innerText(), /阻塞.*约 50%/s);
  const goalText = todoBody.locator(".memory-goal-text");
  assert.deepEqual(await goalText.locator(".memory-goal-label").allInnerTexts(), ["第一轮：", "第二轮：", "第三轮：", "范围："], "每轮单独成段，段首标签单独加粗");
  assert.equal(await goalText.locator("p").count(), 4);
  assert.equal(await goalText.evaluate((node) => [...node.children].some((p) => p.scrollHeight > p.clientHeight + 1)), false, "长目标默认完整显示，不截断");
  assert.equal(await todoBody.locator(".memory-goal-toggle").count(), 0, "不提供展开按钮");
  assert.equal(await goalText.locator("p").last().innerText(), "范围：只改工具栏卡片，地址 https://example.test:8080/a 保持原样。", "列表符去掉，半角冒号不当作标签");
  await closeTodo();
  const checkboxEntry = "## 当前目标与状态\n完成布局验收\n\n## 任务进度\n整体状态：进行中；整体进度：40%；当前进展：检查桌面；下一步：检查手机\n- [x] 完成类型检查\n- [ ] 检查手机\n- [进行中] 检查桌面\n- [阻塞] 等待实体设备\n- [完整验收](artifacts/validation.md)";
  writeFileSync(path, checkboxEntry); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("40%") === true);
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  assert.match(await todoBody.locator('.memory-task-count').innerText(), /已完成 1 \/ 4 项/);
  assert.equal(await todoBody.locator('li').count(), 4, "只展示标准 checkbox 与四态任务");
  assert.match(await todoBody.locator('.memory-next').innerText(), /检查桌面.*检查手机/s);
  await closeTodo();
  const fencedEntry = "## 目标与状态\n核对文档示例\n```md\n整体状态：已完成；整体进度：100%；当前进展：示例\n```\n\n## 任务进度\n整体状态：进行中\n<!--\n- [x] 注释示例\n-->\n```md\n- [x] 文档示例\n- [进行中] 另一示例\n```\n~~~\n- [ ] 未闭合示例";
  writeFileSync(path, fencedEntry); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("进度待评估") === true);
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  await todoBody.getByText("尚未记录任务清单", { exact: true }).waitFor();
  assert.equal(await todoBody.locator("li").count(), 0, "source→scan→UI 不展示 fenced code 中的示例 checkbox");
  await closeTodo();
  writeFileSync(path, entry); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("30%") === true);
  const availableMemory = app.agents.memories.snapshot(a)!;
  // 即使传输层暂时携带旧正文和旧进度，不可用原因也必须阻止旧事实进入首层展示。
  app.agents.memories.publish(memoryScope(a), { ...availableMemory, reason: "unavailable" });
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("记忆暂不可用") === true);
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  await todoBody.getByText("记忆暂不可用", { exact: true }).waitFor();
  assert.equal(await todoBody.locator("pre").count(), 0, "不可用状态不展示旧正文");
  assert.equal(await todoBody.locator(".memory-progress-summary").count(), 0, "不可用状态不展示旧任务进度");
  await closeTodo();
  app.agents.memories.publish(memoryScope(a), availableMemory);
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.includes("30%") === true);
  await todo.getByRole("button", { name: "上下文与会话记忆" }).click();
  await todoBody.getByRole("button", { name: "查看完整记忆" }).click();
  const dialog = page.getByRole("dialog", { name: "会话记忆", exact: true });
  const reference = dialog.getByRole("link", { name: "查看引用 1", exact: true });
  await reference.nth(1).click();
  assert.ok(await dialog.locator('section[aria-label="引用"] li').evaluate((node) => document.activeElement === node));
  await dialog.getByRole("link", { name: "返回引用 1", exact: true }).click();
  assert.ok(await reference.nth(1).evaluate((node) => document.activeElement === node), "returns to the exact clicked reference");
  holdOpen = true;
  await dialog.getByRole("button", { name: "打开本地文件", exact: true }).click();
  await dialog.getByRole("button", { name: "正在打开…", exact: true }).waitFor();
  await animated('.memory-doc-actions button[aria-busy="true"] .bubble-loading');
  holdOpen = false; releaseOpen!();
  await dialog.getByText("已提交本地打开请求").waitFor();
  assert.deepEqual(openedFiles, [path]);
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = dialog.getByRole("textbox", { name: "记忆内容" });
  const draft = entry + "\n本地未保存修改\n";
  await editor.fill(draft);
  writeFileSync(path, entry + "\n外部新事实\n"); app.agents.memories.scan();
  await dialog.getByText("来源已更新。当前编辑已保留；保存前需核对并合并新内容。").waitFor();
  assert.equal(await editor.inputValue(), draft);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "资料已被修改" }).waitFor();
  assert.equal(await editor.inputValue(), draft);
  await dialog.getByRole("button", { name: "读取最新版本以合并" }).click();
  await dialog.getByRole("heading", { name: "最新版本 · 当前草稿保留在下方" }).waitFor();
  await editor.fill(draft + "外部新事实\n");
  await dialog.getByRole("button", { name: "已核对，以此修订保存合并后的草稿" }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await wait(async () => await editor.count() === 0);
  assert.ok(readFileSync(path, "utf8").includes("本地未保存修改\n外部新事实"));
  await dialog.getByRole("link", { name: "过程说明", exact: true }).click();
  await dialog.getByText("已验证资料导航解码", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "关闭记忆" }).click();
  assert.ok(await todo.locator(".memory-todo-toggle").evaluate((button) => document.activeElement === button), "closing memory restores the surviving task toggle");
  assert.equal(await chat.inputValue(), "保留主聊天草稿");
  // Safari mouse activation does not focus buttons. Keep focus elsewhere while
  // clicking the icon so panel placement cannot accidentally use activeElement.
  for (const [width, height] of [[1440, 900], [390, 480]]) {
    await page.setViewportSize({ width, height });
    for (const focus of ["body", "input"] as const) {
      await chat.focus();
      if (focus === "body") await chat.evaluate((node) => node.blur());
      const trigger = page.getByRole("button", { name: "全局记忆", exact: true });
      await trigger.evaluate((button) => button.addEventListener("mousedown", (event) => event.preventDefault(), { once: true }));
      await trigger.locator("svg").click();
      const panel = page.getByRole("dialog", { name: "全局记忆", exact: true });
      await panel.getByRole("textbox", { name: "搜索记忆" }).waitFor();
      const bounds = await panel.boundingBox(), toolbar = await page.locator("#content .usage").boundingBox();
      assert.ok(bounds && toolbar);
      assert.ok(Math.abs(bounds.y + bounds.height - (toolbar.y - 8)) < 2, `${width}px / ${focus}: memory drawer stays above its toolbar`);
      assert.ok(await panel.getByRole("textbox", { name: "搜索记忆" }).evaluate((input) => {
        const rect = input.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input;
      }), `${width}px / ${focus}: memory content is visible and reachable`);
      await panel.getByRole("button", { name: "关闭记忆" }).click();
      await panel.waitFor({ state: "detached" });
      assert.ok(await trigger.evaluate((button) => document.activeElement === button), "memory close restores the actual trigger");
      assert.equal(await chat.inputValue(), "保留主聊天草稿");
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  const global = page.getByRole("dialog", { name: "全局记忆", exact: true });
  const openLinkedMemory = async (title: string) => {
    const toggle = global.locator(".memory-summary-toggle").filter({ hasText: title });
    if (!await toggle.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)) await toggle.click();
    assert.equal(await global.isVisible(), true, "clicking a summary keeps the global summary view open");
    assert.equal(await global.locator(".memory-document").count(), 0, "a summary expands its source link without loading the memory document");
    await global.getByRole("button", { name: `查看关联记忆：${title}`, exact: true }).click();
  };
  await global.getByText("暂无已整理的摘要", { exact: true }).waitFor();
  assert.equal(await global.locator(".memory-catalog-item").count(), 0, "pending sources are not shown as global memories");
  mkdirSync("test-results/session-memory", { recursive: true });
  for (const [width, height] of [[1440,900],[390,480]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `test-results/session-memory/global-empty-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const status of ["pending", "indexing", "error", "ready"] as const) {
    summaryFor(a);
    await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话甲" }).waitFor();
    summaryFor(a, status, status === "ready" ? " \n " : "过期摘要不得显示");
    await global.getByText("暂无已整理的摘要", { exact: true }).waitFor();
    assert.equal(await global.locator(".memory-catalog-item").count(), 0, `${status} without a usable summary is hidden`);
    const sourceFilter = global.getByRole("combobox", { name: "来源会话" });
    await sourceFilter.click();
    assert.equal(await global.getByRole("listbox", { name: "来源会话" }).getByRole("option").count(), 1, "source filters exclude unorganized records");
    await sourceFilter.press("Escape");
  }
  const failedSource = app.agents.memories.catalog(workspace.id).find((item) => item.sessionId === a.sessionId)!;
  app.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({
    ...failedSource, status: "error", summary: "", hasContent: false, reason: undefined,
    error: "未配置后台整理模型；api_key=sk-secretvalue123；C:\\Users\\dane\\private\\memory\\source.md",
  }), a.sessionId);
  app.agents.memories.publish(memoryCatalogScope(workspace.id), app.agents.memories.catalog(workspace.id));
  const failures = global.getByRole("region", { name: "整理错误详情" });
  await failures.getByText("记忆会话甲", { exact: true }).waitFor();
  assert.match(await failures.innerText(), /未配置后台整理模型/);
  assert.doesNotMatch(await failures.innerText(), /sk-secretvalue123|C:\\Users\\dane/);
  assert.equal(await global.locator(".memory-catalog-item").count(), 0, "整理错误不伪装成 ready 摘要卡");
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("未配置后台整理模型");
  await failures.waitFor();
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("不匹配错误");
  assert.equal(await failures.count(), 0, "搜索同时约束错误诊断区");
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("");
  app.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...failedSource, summaryVersion: memorySummaryVersion }), a.sessionId);
  app.agents.memories.publish(memoryCatalogScope(workspace.id), app.agents.memories.catalog(workspace.id));
  summaryFor(a); summaryFor(b);
  await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话乙" }).waitFor();
  assert.equal(await global.locator(".memory-summary-toggle").filter({ hasText: "空白模板会话" }).count(), 0, "empty templates are absent from the catalog");
  assert.equal(await global.locator(".memory-count").innerText(), "2");
  assert.ok(!(await global.locator(".memory-catalog").innerText()).includes("原文摘录"));
  const titleSource = app.agents.memories.catalog(workspace.id).find((entry) => entry.sessionId === a.sessionId)!;
  app.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({
    ...titleSource, title: "模型归纳的浏览主题", summaryVersion: memorySummaryVersion, sourceTitle: "记忆会话甲",
  }), a.sessionId);
  app.agents.memories.publish(memoryCatalogScope(workspace.id), app.agents.memories.catalog(workspace.id));
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("记忆会话甲");
  await global.locator(".memory-summary-toggle").filter({ hasText: "模型归纳的浏览主题" }).waitFor();
  await global.getByRole("combobox", { name: "来源会话" }).click();
  await global.getByRole("listbox", { name: "来源会话" }).getByRole("option", { name: "记忆会话甲", exact: true }).waitFor();
  await global.getByRole("combobox", { name: "来源会话" }).press("Escape");
  const topic = global.locator(".memory-summary-toggle").filter({ hasText: "模型归纳的浏览主题" });
  await topic.focus(); await topic.press("Enter");
  await global.getByRole("button", { name: "查看关联记忆：记忆会话甲", exact: true }).waitFor();
  assert.equal(await global.isVisible(), true, "summary topics and source memories are separate levels");
  await global.getByRole("button", { name: "查看关联记忆：记忆会话甲", exact: true }).click();
  await dialog.getByRole("button", { name: "编辑", exact: true }).waitFor();
  assert.equal(await dialog.locator(".memory-panel-title p").innerText(), "记忆会话甲", "source view uses its session title rather than the generated topic");
  await dialog.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  assert.equal(await global.getByRole("textbox", { name: "搜索记忆" }).inputValue(), "记忆会话甲");
  assert.equal(await topic.evaluate((node) => (node.parentElement as HTMLDetailsElement).open), true, "returning preserves the expanded summary");
  await topic.focus(); await topic.press("Space");
  assert.equal(await topic.evaluate((node) => (node.parentElement as HTMLDetailsElement).open), false, "space collapses the related-memory disclosure");
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("");
  app.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...titleSource, summaryVersion: memorySummaryVersion }), a.sessionId);
  app.agents.memories.publish(memoryCatalogScope(workspace.id), app.agents.memories.catalog(workspace.id));
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("实现记忆浏览");
  await global.getByText("没有符合筛选条件的摘要").waitFor();
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("");
  await global.getByRole("combobox", { name: "来源会话" }).click();
  await global.getByRole("listbox", { name: "来源会话" }).getByRole("option", { name: "记忆会话甲", exact: true }).click();
  writeFileSync(path, readFileSync(path, "utf8") + "\n摘要依据已更新\n"); app.agents.memories.scan();
  await wait(async () => await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话甲" }).count() === 0);
  await wait(async () => await global.getByRole("combobox", { name: "来源会话" }).innerText() === "全部来源会话");
  await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话乙" }).waitFor();
  assert.equal(await global.locator(".memory-count").innerText(), "1", "invalidated summaries leave the list and count");
  summaryFor(a);
  await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话甲" }).waitFor();
  const count = [...readFileSync(path, "utf8")].length.toLocaleString("zh-CN");
  await global.getByText(`入口 ${count} 字`, { exact: true }).waitFor();
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("记忆会话甲");
  await openLinkedMemory("记忆会话甲");
  await dialog.locator(".memory-related > summary").first().click();
  await dialog.getByRole("button", { name: "references/a b.md", exact: true }).click();
  await dialog.getByText("已验证资料导航解码", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "返回上一级", exact: true }).click();
  await dialog.getByRole("button", { name: "编辑", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  assert.equal(await global.getByRole("textbox", { name: "搜索记忆" }).inputValue(), "记忆会话甲", "multi-level back preserves catalog filters");
  const globalBox = await global.boundingBox(); assert.ok(globalBox);
  await page.mouse.move(globalBox.x + 40, globalBox.y + 40); await page.mouse.down();
  await page.mouse.move(500, 110); await page.mouse.up();
  assert.equal(await global.count(), 1, "dragging out of the panel does not dismiss it");
  await page.locator("#content .topnav").click({ position: { x: 180, y: 20 } });
  assert.equal(await global.count(), 0, "outside blank click closes global memory");
  await page.getByRole("button", { name: "全局记忆", exact: true }).click();
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("没有匹配的关键字");
  await global.getByText("没有符合筛选条件的摘要").waitFor();
  await global.getByRole("textbox", { name: "搜索记忆" }).fill("");
  app.store.execute({ requestId: randomUUID(), op: "session.delete", ...b, params: { confirmed: true } }); app.agents.memories.scan();
  await wait(async () => await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话乙" }).count() === 0);
  summaryFor(b);
  await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话乙" }).filter({ hasText: "来源会话已移除" }).waitFor();
  await openLinkedMemory("记忆会话乙");
  await page.getByText("来源会话已从普通列表移除，记忆仍保留。").waitFor();
  await page.getByRole("button", { name: "关闭记忆" }).click();
  await todo.locator(".memory-todo-toggle").click();
  await todoBody.getByRole("button", { name: "查看完整记忆" }).click();
  await dialog.getByRole("button", { name: "编辑", exact: true }).click();
  await editor.fill("未保存，不得被关闭丢弃");
  await dialog.getByRole("button", { name: "打开本地文件", exact: true }).click();
  await wait(() => openedFiles.length === 2);
  assert.equal(await editor.inputValue(), "未保存，不得被关闭丢弃", "local opening never saves the editor draft");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const metric of ['cache-tokens', 'estimated-cost']) {
      const button = page.locator(`#content [data-od-id="${metric}"]`);
      await button.click();
      const keep = dialog.getByRole('button', { name: '继续编辑', exact: true });
      await keep.waitFor();
      assert.equal(await page.locator('dialog:popover-open').count(), 1, 'unsaved confirmation is not covered by another detail');
      assert.ok(await keep.evaluate((el) => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), 'confirmation remains clickable');
      await keep.click();
      assert.equal(await editor.inputValue(), '未保存，不得被关闭丢弃');
      await button.focus(); await button.press('Enter');
      await dialog.getByRole('button', { name: '放弃编辑并继续', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      const selected = page.locator(metric === 'estimated-cost' ? '.cost-popover' : '.metric-detail');
      await selected.waitFor();
      assert.equal(await page.locator('dialog:popover-open').count(), 1, 'confirmed switch opens exactly the requested detail');
      await selected.getByRole('button', { name: metric === 'estimated-cost' ? '关闭费用明细' : '关闭统计详情', exact: true }).click();
      await selected.waitFor({ state: 'detached' });
      await todo.locator('.memory-todo-toggle').click();
      await todoBody.getByRole('button', { name: '查看完整记忆' }).click();
      await dialog.getByRole('button', { name: '编辑', exact: true }).click();
      await editor.fill('未保存，不得被关闭丢弃');
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#content .topnav").click({ position: { x: 180, y: 20 } });
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(await editor.inputValue(), "未保存，不得被关闭丢弃", "outside close guards dirty text");
  await dialog.getByRole("button", { name: "返回全局记忆", exact: true }).click();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(await editor.inputValue(), "未保存，不得被关闭丢弃", "back navigation guards dirty text");
  await dialog.getByRole("button", { name: "关闭记忆" }).click();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(await editor.inputValue(), "未保存，不得被关闭丢弃");
  await dialog.getByRole("button", { name: "关闭记忆" }).click();
  await dialog.getByRole("button", { name: "放弃编辑并继续" }).click();
  assert.equal(await chat.inputValue(), "保留主聊天草稿");
  mkdirSync("test-results/session-memory", { recursive: true });
  const icons = page.locator("#content .usage .memory-todo-toggle, #content .usage .memory-global");
  const matrix = [[360,800],[390,844],[430,932],[600,960],[640,800],[641,800],[650,800],[820,1180],[1024,768],[1366,768],[1440,900],[1920,1080],[390,480]];
  const geometry = async () => {
    await page.waitForFunction(() => document.querySelector(".app")?.classList.contains("mobile-workbench") === matchMedia("(max-width:640px), (pointer:coarse) and (max-height:500px)").matches);
    const toolbar = page.locator("#content .usage");
    await toolbar.evaluate((element) => { element.scrollLeft = 0; });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const mobile = await page.locator(".app").evaluate((element) => element.matches(".mobile-workbench,.android-workbench"));
    // Sample the responsive layout in one frame; mobile intentionally scrolls horizontally.
    const [session, global, row, usage, composer, previous] = await page.evaluate((selectors) => selectors.map((selector) => {
      const element = [...document.querySelectorAll(selector)].at(-1);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, paddingRight: parseFloat(getComputedStyle(element).paddingRight) };
    }), ["#content .memory-todo-toggle", "#content .memory-global", "#content .usage-row", "#content .usage", "#content .composer-area .container", "#content .usage-settings > .compression-trigger"]);
    assert.ok(session && global && row && usage && composer && previous);
    assert.ok(Math.abs(session.x - row.x) < 2, "session task entry starts the left usage group");
    assert.ok(session.x + session.width < global.x, "session memory is left of global memory");
    assert.ok(Math.abs(global.y + global.height / 2 - previous.y - previous.height / 2) < 2, "global memory shares the existing tool row");
    assert.ok(global.x >= previous.x + previous.width && global.x - previous.x - previous.width <= 8, "global memory sits directly after existing tools");
    if (mobile) {
      assert.ok(Math.abs(session.y - global.y) < 2, "mobile memory controls remain on one row");
      const scrolling = await toolbar.evaluate((element) => ({ overflow: getComputedStyle(element).overflowX, width: element.scrollWidth, visible: element.clientWidth }));
      assert.equal(scrolling.overflow, "auto", "mobile toolbar keeps horizontal scrolling");
      assert.ok(global.x + global.width - usage.x <= scrolling.width + 1, "global control is within the scrollable toolbar");
    } else assert.ok(Math.abs(session.y - global.y) < 2, 'desktop controls remain on one compact row');
    for (const box of [session, global]) assert.ok(box.y >= composer.y && box.y + box.height <= composer.y + composer.height, "memory entries stay inside the composer");
    assert.equal(await page.locator(".app > .memory-toolbar").count(), 0, "no separate memory footer");
    const labels = await icons.allInnerTexts();
    assert.equal(labels[0], '', 'context percentage is in details');
    assert.equal(labels[1], "", "global entry stays an icon");
    const inside = await icons.evaluateAll((buttons) => buttons.every((button) => { const b = button.getBoundingClientRect(); const node = button.querySelector("svg")!; const svg = node.getBoundingClientRect(), expected = node.classList.contains("data-icon") ? 20 : 16; return b.width >= 44 && b.height >= 44 && svg.width === expected && svg.height === expected && b.y >= 0 && b.bottom <= innerHeight; }));
    assert.ok(inside, "both icons have matching size and vertical touch targets");
    for (const icon of await icons.all()) {
      await icon.scrollIntoViewIfNeeded();
      assert.ok(await icon.evaluate((button) => {
        const rect = button.getBoundingClientRect(), toolbar = button.closest(".usage")!.getBoundingClientRect();
        return rect.left >= Math.max(0, toolbar.left) - 1 && rect.right <= Math.min(innerWidth, toolbar.right) + 1
          && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), "each memory entry is fully reachable and hit-testable after toolbar scrolling");
    }
    await toolbar.evaluate((element) => { element.scrollLeft = 0; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page overflow");
  };
  for (const [width, height] of matrix) {
    await page.setViewportSize({ width, height });
    await geometry();
    await page.screenshot({ path: `test-results/session-memory/todo-${width}-${height}.png` });
    await todo.locator(".memory-todo-toggle").click();
    await todoBody.getByText("已完成 1 / 2 项", { exact: true }).waitFor();
    const popover = await todoBody.boundingBox();
    assert.ok(popover && popover.y >= 0 && popover.x >= 0 && popover.x + popover.width <= width);
    await page.screenshot({ path: `test-results/session-memory/tasks-${width}-${height}.png` });
    await closeTodo();
    if (width === 390 && height === 844) await app.agents.memories.command({ requestId: randomUUID(), op: "memory.configure", workspaceId: workspace.id, params: { queryModel: { provider: "fixture", id: "query-model", thinking: "off" }, organizerModel: { provider: "fixture", id: "organizer-model", thinking: "off" } } });
    await page.getByRole("button", { name: "全局记忆", exact: true }).click();
    await global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话甲" }).waitFor();
    const box = await global.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    const toolRow = await page.locator("#content .usage-settings").boundingBox();
    assert.ok(toolRow && Math.abs(box.y + box.height - toolRow.y + 8) < 2 && box.y === 0 && Math.abs(box.x + box.width - width) < 1 && box.width === Math.min(520, width), "memory drawer attaches to top/right and keeps its toolbar reachable");
    const panelFooter = await global.locator(":scope > footer").boundingBox();
    assert.ok(panelFooter && panelFooter.y >= box.y && panelFooter.y + panelFooter.height <= box.y + box.height + 1, "back navigation stays visible");
    const backBox = await global.getByRole("button", { name: "返回会话", exact: true }).boundingBox();
    const footerPadding = await global.locator(":scope > footer").evaluate((element) => { const style = getComputedStyle(element); return { left: parseFloat(style.paddingLeft), bottom: parseFloat(style.paddingBottom) }; });
    assert.ok(backBox && backBox.height >= 44 && Math.abs(backBox.x - box.x - footerPadding.left) <= 2 && Math.abs(box.y + box.height - backBox.y - backBox.height - footerPadding.bottom) <= 2, `return is anchored at the panel bottom-left with the shared padding and touch target: ${JSON.stringify({ width, height, box, panelFooter, backBox, footerPadding })}`);
    const summaryLayout = await global.locator(".memory-source-summary").first().evaluate((node) => {
      const style = getComputedStyle(node), range = document.createRange(); range.selectNodeContents(node);
      return { text: node.textContent, height: node.getBoundingClientRect().height, textHeight: range.getBoundingClientRect().height, line: parseFloat(style.lineHeight), overflow: node.scrollWidth > node.clientWidth + 1 };
    });
    assert.equal(summaryLayout.text, summaryText, "the full generated summary is present");
    assert.ok(summaryLayout.height >= summaryLayout.line * 5 - 1 && summaryLayout.height >= summaryLayout.textHeight - 1, "all summary lines are visible instead of being clamped to three lines");
    assert.equal(summaryLayout.overflow, false, "full summaries wrap at narrow widths");
    await page.screenshot({ path: `test-results/session-memory/global-${width}-${height}.png` });
    const summaryToggle = global.locator(".memory-summary-toggle").filter({ hasText: "记忆会话甲" });
    await summaryToggle.click();
    const sourceLink = global.getByRole("button", { name: "查看关联记忆：记忆会话甲", exact: true });
    await sourceLink.scrollIntoViewIfNeeded();
    const sourceBox = await sourceLink.boundingBox();
    assert.ok(sourceBox && sourceBox.height >= 44 && sourceBox.x >= 0 && sourceBox.x + sourceBox.width <= width, "associated memory links remain reachable with a 44px touch target");
    assert.equal(await global.isVisible(), true, "summary disclosure does not navigate directly into the source");
    await page.screenshot({ path: `test-results/session-memory/summary-sources-${width}-${height}.png` });
    if (width === 1440 || width === 390 && height === 844) {
      await openLinkedMemory("记忆会话甲");
      await dialog.getByRole("button", { name: "编辑", exact: true }).waitFor();
      await dialog.locator(".memory-related > summary").first().click();
      await page.screenshot({ path: `test-results/session-memory/record-${width}.png` });
      await dialog.getByRole("button", { name: "references/a b.md", exact: true }).click();
      await dialog.getByText("已验证资料导航解码", { exact: true }).waitFor();
      await page.screenshot({ path: `test-results/session-memory/file-${width}.png` });
      const scroller = dialog.locator(".memory-dialog-body"), headBefore = await dialog.locator(":scope > header").boundingBox(), footBefore = await dialog.locator(":scope > footer").boundingBox();
      const readingPosition = await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
      assert.ok(readingPosition > 300, "long document actually scrolls");
      assert.deepEqual(await dialog.locator(":scope > header").boundingBox(), headBefore, "header stays fixed while reading");
      assert.deepEqual(await dialog.locator(":scope > footer").boundingBox(), footBefore, "back stays fixed while reading");
      await dialog.getByRole("button", { name: "返回上一级", exact: true }).click();
      await dialog.getByRole("button", { name: "references/a b.md", exact: true }).click();
      await wait(async () => Math.abs(await scroller.evaluate((element) => element.scrollTop) - readingPosition) < 2);
      await page.screenshot({ path: `test-results/session-memory/file-scroll-${width}.png` });
      await dialog.getByRole("button", { name: "返回上一级", exact: true }).click();
      await dialog.getByRole("button", { name: "返回全局记忆", exact: true }).click();
    }
    if (width === 390 && height === 844) {
      await global.getByRole("button", { name: "记忆设置与纠正" }).click();
      const picker = global.locator(".model-picker").first();
      await picker.locator("summary").click();
      const menu = picker.locator(".model-popover");
      await menu.waitFor();
      const menuBox = await menu.boundingBox(), settingsBox = await global.locator(".memory-settings").boundingBox();
      assert.ok(menuBox && settingsBox && menuBox.width >= settingsBox.width - 40 && menuBox.x >= settingsBox.x && menuBox.x + menuBox.width <= settingsBox.x + settingsBox.width, "model menu uses the available settings width");
      const searchBox = await menu.locator(".model-search").boundingBox();
      assert.ok(searchBox && searchBox.height <= 50, "model search stays on one line");
      await picker.getByRole("button", { name: "使用来源会话模型", exact: true }).click();
      await wait(() => app.agents.memories.preferences().queryModel === null);
      assert.equal(app.agents.memories.preferences().organizerModel?.id, "organizer-model", "reset query model preserves organizer selection");
      await picker.locator("summary").getByText("使用来源会话模型", { exact: true }).waitFor();
      await page.screenshot({ path: "test-results/session-memory/settings-390.png" });
      const timeBudget = global.getByLabel("执行时限（秒）", { exact: true });
      await timeBudget.fill("900"); await timeBudget.press("Enter");
      await wait(() => app.agents.memories.preferences().timeoutMs === 900000);
      const readBudget = global.getByLabel("整理读取上限（字符）", { exact: true });
      await readBudget.fill("480000"); await readBudget.press("Tab");
      await wait(() => app.agents.memories.preferences().readChars === 480000);
      const turns = global.getByLabel("整理交互轮数", { exact: true });
      await turns.fill("64"); await turns.press("Enter");
      await wait(() => app.agents.memories.preferences().maxTurns === 64);
      await turns.fill("0"); await turns.press("Tab");
      assert.equal(app.agents.memories.preferences().maxTurns, 64, "invalid budget must not save");
      await turns.fill("64"); await turns.press("Tab");
      await picker.locator("summary").click();
      const organizer = global.locator(".model-picker").nth(1);
      await organizer.locator("summary").click();
      await organizer.getByRole("button", { name: "使用来源会话模型", exact: true }).click();
      await wait(() => app.agents.memories.preferences().organizerModel === null);
      await organizer.locator("summary").getByText("使用来源会话模型", { exact: true }).waitFor();
    }
    await global.getByRole("button", { name: "关闭记忆" }).click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await geometry();
  await page.screenshot({ path: "test-results/session-memory/collapsed-sidebar.png" });
  writeFileSync(path, entry.replace("整体状态：进行中", "整体状态：已完成").replace("整体进度：约 30%", "整体进度：100%").replace("- [进行中] 验证", "- [已完成] 验证")); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.endsWith("任务进度 · 100%") === true);
  await todo.locator(".memory-todo-toggle").click();
  assert.equal(await todo.locator('.memory-todo-toggle').innerText(), '', 'completion retains icon-only entry');
  assert.equal(await todo.locator('svg.data-icon-context-memory[data-value="50"]').count(), 1);
  assert.equal(await todo.locator('.context-ring.data-filled').getAttribute('d'), contextArc, 'task completion never changes context usage');
  assert.equal(await todo.locator('.memory-progress-bars > .memory-progress-lit').count(), 3, 'memory symbol keeps its three list lines after completion');
  assert.equal(await todo.locator("animate,animateTransform").count() + await todoBody.locator("animate,animateTransform").count(), 0, "completed memory has no running animation");
  await todoBody.locator(".memory-progress-summary").getByText("100%", { exact: true }).waitFor();
  assert.equal(await todoBody.getByRole("progressbar", { name: "任务整体进度" }).getAttribute("value"), "100");
  await page.screenshot({ path: "test-results/session-memory/completed-1440.png" });
  await closeTodo();
  writeFileSync(path, memoryTemplate); app.agents.memories.scan();
  await wait(async () => (await todo.locator(".memory-todo-toggle").getAttribute("data-tooltip"))?.endsWith("任务进度 · 暂无记录") === true);
  for (const [width, height] of [[1440,900],[390,844]]) {
    await page.setViewportSize({ width, height });
    await geometry();
    assert.ok(!(await todo.innerText()).includes("进度待评估"), "empty state has only one status");
    await page.screenshot({ path: `test-results/session-memory/empty-${width}.png` });
    await todo.locator(".memory-todo-toggle").click();
    await todoBody.getByText("还没有任务记录", { exact: true }).waitFor();
    assert.equal(await todoBody.locator("progress").count(), 0);
    await closeTodo();
  }
  await todo.locator(".memory-todo-toggle").click();
  await page.locator("#content .topnav").click({ position: { x: 180, y: 20 } });
  await todoBody.waitFor({state:'detached'});
  await todo.locator(".memory-todo-toggle").click();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await todoBody.isVisible(), true, "non-modal details retain keyboard access to the toolbar");
  await page.keyboard.press("Escape");
  await todoBody.waitFor({state:'detached'});
  assert.equal(await chat.inputValue(), "保留主聊天草稿");
  assert.deepEqual(errors, []);
  console.log("PASS: subscriptions, edit/conflict merge, navigation, deleted sources, filters and drafts; thirteen viewport layouts, inline SVG tool icons, completed progress, collapsed sidebar, empty state, settings menu and keyboard dismissal.");
} finally {
  releaseOpen?.();
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
