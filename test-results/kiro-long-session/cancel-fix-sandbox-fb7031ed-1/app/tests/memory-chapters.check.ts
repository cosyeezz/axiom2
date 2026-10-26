import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-memory-chapters-ui-"))), project = realpathSync(mkdtempSync(join(tmpdir(), "axiom-memory-chapters-project-")));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const output = process.env.AXIOM_TEST_ARTIFACTS || mkdtempSync(join(tmpdir(), "axiom-memory-chapters-artifacts-")); mkdirSync(output, { recursive: true });
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, directory = memoryDirectory(root, session.id), entry = join(directory, "MEMORY.md");
  const originalEntry = "# [已放弃] 旧方案\n## [失败] 旧探索\n### [未开始] 废弃实现\n#### [进行中] 废弃验证\n# [已完成] 已交付目标\n## [已完成] 交付步骤\n# [进行中] 新方案\n## [已完成] 明确卸载范围\n### [未开始] 标题关联验证\n## [进行中] 修复取消按钮\n## [等待] 外部设备\n### [未开始] 真机验证\n## [失败] 验证失败\n## [未开始] 长详情验证\n";
  writeFileSync(entry, originalEntry);
  const shortPath = "details/新方案/修复取消按钮.md", longPath = "details/新方案/长详情验证.md", linkedPath = "details/新方案/明确卸载范围.md";
  const detail = (path: string, content: string) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), content); };
  detail(shortPath, "ONLY_DETAIL_ONE：保留修复依据与验证结果。");
  detail(longPath, "DETAIL_TWO_START\n\n" + "第二段正文。".repeat(2800) + "\n\nDETAIL_TWO_END");
  detail(linkedPath, "LINKED_CLEANUP_CONTENT");
  detail("details/无关文件.md", "UNRELATED_DETAIL_SENTINEL");
  app.agents.memories.scan();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [], reads: Array<{ path: string; offset?: number }> = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => socket.on("framesent", frame => { try { const value = JSON.parse(String(frame.payload)); if (value.op === "memory.read") reads.push(value.params); } catch {} }));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const entryIcon = page.getByRole("button", { name: "上下文与会话记忆", exact: true });
  for (const state of ["未开始", "进行中", "已完成", "等待", "失败", "已放弃"] as const) {
    writeFileSync(entry, `# [${state}] 入口状态验证\n`); app.agents.memories.scan();
    const bars = entryIcon.locator(`.memory-progress-bars[data-state="${state}"]`); await bars.waitFor();
    assert.equal(await bars.locator("path").count(), 3);
    assert.equal(await bars.locator("animate").count(), state === "进行中" ? 3 : 0);
    assert.equal(await bars.getAttribute("data-progress"), null);
    assert.match(await entryIcon.getAttribute("data-tooltip") ?? "", new RegExp(`任务状态 · ${state}`));
    if (state === "进行中") for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      const stroke = bars.locator("path").first(), before = await stroke.evaluate(node => getComputedStyle(node).opacity);
      await page.waitForTimeout(220); assert.notEqual(await stroke.evaluate(node => getComputedStyle(node).opacity), before);
    }
  }
  const treeCases = [
    { body: "# [进行中] 父任务\n## [等待] 外部条件", state: "等待", tasks: [] },
    { body: "# [进行中] 父任务\n## [失败] 已结束尝试", state: "失败", tasks: [] },
    { body: "# [失败] 父任务\n## [进行中] 不得恢复子项", state: "失败", tasks: [] },
    { body: "# [已完成] 父任务\n## [未开始] 遗留子项", state: "等待", tasks: [] },
    { body: "# [进行中] 收尾任务\n## [已完成] 实现步骤", state: "进行中", tasks: ["收尾任务"] },
    { body: "# [进行中] 当前目标\n## [等待] 外部设备\n### [进行中] 真机验证\n## [失败] 旧尝试\n### [未开始] 旧后代\n## [进行中] 独立检查", state: "进行中", tasks: ["独立检查"] },
  ];
  for (const scenario of treeCases) {
    writeFileSync(entry, scenario.body); app.agents.memories.scan();
    const analysis = app.agents.memories.snapshot(scope)!.progress.analysis!;
    assert.equal(analysis.displayState, scenario.state); assert.deepEqual(analysis.actionable.map(task => task.title), scenario.tasks);
    await entryIcon.locator(`.memory-progress-bars[data-state="${scenario.state}"]`).waitFor();
  }
  writeFileSync(entry, originalEntry); app.agents.memories.scan();
  await entryIcon.locator('.memory-progress-bars[data-state="进行中"]').waitFor(); await entryIcon.click();
  const todo = page.getByRole("dialog", { name: "上下文与会话记忆", exact: true });
  await todo.getByText("新方案", { exact: true }).waitFor();
  assert.equal(await todo.locator(".memory-goals > li").count(), 3);
  const toggle = (name: string) => todo.getByRole("button", { name: new RegExp(`^(展开|收起)：${name}$`) });
  assert.equal(await toggle("旧方案").getAttribute("aria-expanded"), "false");
  assert.equal(await toggle("已交付目标").getAttribute("aria-expanded"), "false");
  assert.equal(await toggle("新方案").getAttribute("aria-expanded"), "true");
  const assertDirection = async (name: string, expanded: boolean) => {
    const arrow = toggle(name).locator(".memory-task-chevron");
    assert.equal(await arrow.locator("use").getAttribute("href"), "#i-chevron-down");
    const matrix = await arrow.evaluate(node => {
      const value = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { a: value.a, d: value.d };
    });
    assert.ok(Math.abs(matrix.a - (expanded ? -1 : 1)) < 0.001 && Math.abs(matrix.d - (expanded ? -1 : 1)) < 0.001, expanded ? "expanded arrow points up" : "collapsed arrow points down");
  };
  await assertDirection("已交付目标", false); await assertDirection("新方案", true);
  assert.equal(await todo.getByText("交付步骤", { exact: true }).count(), 0);
  assert.equal(await todo.getByRole("button", { name: "新方案", exact: true }).count(), 0, "no file means no clickable title");
  assert.equal(await todo.getByRole("button", { name: "查看详情：新方案", exact: true }).count(), 0);
  assert.equal(await todo.locator("button button, button a").count(), 0);
  assert.equal(await todo.locator(".memory-task-state").count(), 0, "task rows must not show status text");
  assert.equal(await todo.getByRole("button", { name: "查看详情：修复取消按钮", exact: true }).count(), 1);
  for (const name of ["旧方案", "旧探索", "废弃实现"]) await toggle(name).click();
  assert.ok(await todo.locator('li[data-abandoned="true"]').count() >= 4);
  assert.equal(await todo.locator('li[data-abandoned="true"] animateTransform').count(), 0);
  for (const state of ["未开始", "进行中", "已完成", "等待", "已放弃", "失败"]) {
    assert.ok(await todo.locator(`svg.memory-state-icon[data-state="${state}"]`).count(), state);
    assert.ok(await todo.getByRole("img", { name: state, exact: true }).count(), `accessible status: ${state}`);
  }
  const active = todo.locator('li:not([data-abandoned]) > .memory-task-row svg[data-state="进行中"]').first();
  const waiting = todo.locator('svg.memory-state-icon[data-state="等待"]').first();
  const done = todo.locator('li:not([data-goal]) > .memory-task-row svg[data-state="已完成"]').first();
  const doneNode = await done.elementHandle(); assert.ok(doneNode);
  assert.equal(await done.evaluate(node => { const sample = document.createElement("span"); sample.style.color = "var(--fg-2)"; node.parentElement!.append(sample); const same = getComputedStyle(sample).color === getComputedStyle(node).color; sample.remove(); return same; }), true);
  for (const mode of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion: mode });
    const sample = async () => ({ rotate: await active.evaluate(node => (node.querySelector("path") as SVGPathElement).transform.animVal.getItem(0).matrix.a), opacity: await waiting.evaluate(node => getComputedStyle(node.querySelector("path")!).opacity) });
    const before = await sample(); await page.waitForTimeout(180); const after = await sample();
    assert.notEqual(before.rotate, after.rotate); assert.notEqual(before.opacity, after.opacity);
    const stroke = await done.evaluate(async node => { const svg = node as SVGSVGElement; svg.setCurrentTime(0); const first = getComputedStyle(svg.querySelector("path")!).strokeDashoffset; await new Promise(resolve => setTimeout(resolve, 550)); return [first, getComputedStyle(svg.querySelector("path")!).strokeDashoffset]; });
    assert.notEqual(stroke[0], stroke[1]); assert.equal(stroke[1], "0px");
  }
  assert.equal(await done.locator('[repeatCount="indefinite"]').count(), 0);
  assert.equal(reads.length, 0, "closed details must not prefetch");
  await toggle("新方案").click(); await assertDirection("新方案", false);
  await toggle("新方案").click(); await assertDirection("新方案", true);
  assert.equal(await done.evaluate((node, previous) => node === previous, doneNode), true);
  const detailButton = todo.getByRole("button", { name: "查看详情：修复取消按钮", exact: true });
  await todo.locator(".toolbar-detail-body").evaluate(node => { node.scrollTop = 100; });
  await detailButton.evaluate(node => (node as HTMLElement).focus({ preventScroll: true })); const scrollTop = await todo.locator(".toolbar-detail-body").evaluate(node => node.scrollTop); assert.ok(scrollTop > 0); await page.keyboard.press("Enter");
  await todo.getByText("ONLY_DETAIL_ONE：保留修复依据与验证结果。", { exact: true }).waitFor();
  assert.deepEqual(reads.map(read => read.path), [shortPath]); assert.doesNotMatch(await todo.innerText(), /DETAIL_TWO_START|UNRELATED_DETAIL_SENTINEL/);
  assert.equal(await todo.locator(".memory-goals").isVisible(), false);
  await todo.getByRole("button", { name: "返回执行树", exact: true }).click();
  assert.equal(await detailButton.evaluate(node => node === document.activeElement), true);
  assert.equal(await todo.locator(".toolbar-detail-body").evaluate(node => node.scrollTop), scrollTop);
  assert.equal(await done.evaluate((node, previous) => node === previous, doneNode), true);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await todo.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `tree overflow at ${width}`);
    const rows = await todo.locator(".memory-task-row:visible").evaluateAll(nodes => nodes.map(row => {
      const toggle = row.querySelector(".memory-branch-disclosure"), marker = row.querySelector(".memory-task-marker")!, title = row.querySelector(".memory-task-title")!, detail = row.querySelector(".memory-task-detail-button");
      return { text: (row as HTMLElement).innerText.trim(), title: (title as HTMLElement).innerText.trim(), ordered: marker.getBoundingClientRect().right <= title.getBoundingClientRect().left && (!toggle || title.nextElementSibling === toggle && title.getBoundingClientRect().right <= toggle.getBoundingClientRect().left && (!detail || toggle.nextElementSibling === detail && toggle.getBoundingClientRect().right <= detail.getBoundingClientRect().left)) };
    }));
    for (const row of rows) {
      assert.equal(row.text, row.title, `only title text at ${width}`);
      assert.equal(row.ordered, true, `disclosure after title and before optional document icon at ${width}`);
    }
    assert.match(await todo.locator('li[data-abandoned="true"] .memory-task-title').first().evaluate(node => getComputedStyle(node).textDecorationLine), /line-through/);
    if (width <= 640) {
      const targets = await todo.locator('.memory-title-open:visible,.memory-branch-disclosure:visible,.memory-task-detail-button:visible').evaluateAll(nodes => nodes.map(node => ({ label: node.getAttribute("aria-label") || node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `touch target ${JSON.stringify(target)} at ${width}`);
    }
    await page.screenshot({ path: join(output, `memory-chapters-${width}.png`) });
  }
  // The title is the same action as the document icon, not the disclosure control.
  const titleButton = todo.getByRole("button", { name: "长详情验证", exact: true });
  await titleButton.focus(); const titleScroll = await todo.locator(".toolbar-detail-body").evaluate(node => node.scrollTop); await page.keyboard.press("Space");
  await todo.getByText("DETAIL_TWO_START", { exact: true }).waitFor();
  assert.equal(await todo.getByRole("button", { name: "返回执行树", exact: true }).evaluate(node => node === document.activeElement), true);
  assert.doesNotMatch(await todo.innerText(), /ONLY_DETAIL_ONE|DETAIL_TWO_END|UNRELATED_DETAIL_SENTINEL/);
  await todo.getByRole("button", { name: "继续读取此条详情", exact: true }).click(); await todo.getByText("DETAIL_TWO_END", { exact: true }).waitFor();
  assert.deepEqual(reads.map(read => read.path), [shortPath, longPath, longPath]); assert.ok(reads.at(-1)!.offset! > 0);
  assert.equal(await todo.getByRole("button", { name: "编辑", exact: true }).count(), 0);
  await todo.getByRole("button", { name: "返回执行树", exact: true }).focus(); await page.keyboard.press("Space");
  await todo.locator(".memory-inline-detail").waitFor({ state: "detached" }); assert.ok(await todo.getByText("真机验证", { exact: true }).isVisible());
  assert.equal(await titleButton.evaluate(node => node === document.activeElement), true, "title entry returns to the title, not the adjacent file icon");
  assert.equal(await todo.locator(".toolbar-detail-body").evaluate(node => node.scrollTop), titleScroll);
  // A state/revision refresh while details are open must preserve the original entry.
  await titleButton.focus(); await page.keyboard.press("Enter"); await todo.getByText("DETAIL_TWO_START", { exact: true }).waitFor();
  await todo.getByRole("button", { name: "继续读取此条详情", exact: true }).focus();
  writeFileSync(entry, originalEntry.replace("[未开始] 长详情验证", "[进行中] 长详情验证")); app.agents.memories.scan();
  await todo.locator('.memory-detail-heading svg[data-state="进行中"]').waitFor();
  assert.equal(await todo.getByRole("button", { name: "返回执行树", exact: true }).evaluate(node => node === document.activeElement), true, "revision refresh keeps detail keyboard focus on the stable back action");
  await todo.getByRole("button", { name: "返回执行树", exact: true }).click();
  assert.equal(await titleButton.evaluate(node => node === document.activeElement), true);
  writeFileSync(entry, originalEntry); app.agents.memories.scan();
  await todo.locator('li[data-state="未开始"] .memory-title-open').filter({ hasText: "长详情验证" }).waitFor();
  await detailButton.click(); await todo.getByText("ONLY_DETAIL_ONE：保留修复依据与验证结果。", { exact: true }).waitFor();
  rmSync(join(directory, shortPath)); app.agents.memories.scan();
  await todo.getByText("此项或其详情文件已移除，可返回查看最新执行树。", { exact: true }).waitFor();
  await todo.getByRole("button", { name: "返回执行树", exact: true }).click();
  assert.equal(await todo.getByRole("button", { name: "查看详情：修复取消按钮", exact: true }).count(), 0);
  assert.equal(await todo.getByRole("button", { name: "修复取消按钮", exact: true }).count(), 0);
  assert.equal(await todo.locator(".memory-execution-view").evaluate(node => node === document.activeElement), true);
  await todo.getByRole("button", { name: "查看完整记忆" }).click();
  const panel = page.getByRole("dialog", { name: "会话记忆", exact: true }); await panel.locator(".memory-entry").waitFor();
  assert.ok(await panel.locator(".memory-entry [data-abandoned]").count() > 0);
  await panel.getByRole("button", { name: "明确卸载范围", exact: true }).click(); await panel.getByText("LINKED_CLEANUP_CONTENT", { exact: true }).waitFor();
  assert.equal(reads.at(-1)?.path, linkedPath);
  await panel.getByRole("button", { name: "返回上一级", exact: true }).click();
  await panel.locator(".memory-entry").waitFor();
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  const source = panel.getByRole("textbox", { name: "记忆内容" }), original = await source.inputValue(); assert.equal(original, originalEntry);
  await source.fill(original.replace("修复取消按钮", "改名不允许")); await panel.getByRole("button", { name: "保存", exact: true }).click();
  const rejection = panel.locator(".memory-error").first(); await rejection.waitFor();
  assert.match(await rejection.innerText(), /已有记忆标题不能改名/);
  assert.equal(readFileSync(entry, "utf8"), originalEntry);
  assert.deepEqual(errors, []);
  console.log("标题路径任务树UI通过：隐藏状态文字/保留无障碍状态、展开箭头在标题右侧及文本文件图标左侧/收起向下展开向上、六态/有效前沿、独立折叠、存在才可点、标题与图标同路、懒加载分页隔离、DOM/焦点/滚动、1440/390/320、文件消失降级、完整详情导航与改名拒绝。");
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true });
}
