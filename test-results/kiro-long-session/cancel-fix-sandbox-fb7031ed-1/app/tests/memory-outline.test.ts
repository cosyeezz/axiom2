import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { assertMemoryTitle, memoryBody, memoryComplete, memoryInstruction, parseMemory } from "../src/shared/memory.js";
import { memoryOutline } from "../src/shared/memory-outline.js";
import { continuationTasks } from "../src/server/memory-continuations.js";
import { reconcileMemoryTree } from "../src/client/memory/memory-task-tree.js";
import { MemoryEntry, MemoryTaskTree } from "../src/client/memory/MemoryOutlineView.js";

test("tree identities survive status changes and new goals but not title/path changes", () => {
  let next = 0; const key = () => String(++next), parse = (text: string) => parseMemory(text).outline!;
  const original = "# [已完成] 数据库\n## [已完成] 验证\n# [已完成] 界面\n## [已完成] 验证";
  const before = reconcileMemoryTree(parse(original), [], key);
  const after = reconcileMemoryTree(parse("# [已完成] 新目标\n" + original.replace("[已完成] 验证", "[进行中] 验证")), before, key);
  assert.equal(after[1].key, before[0].key); assert.equal(after[2].key, before[1].key);
  assert.equal(after[1].children[0].key, before[0].children[0].key);
  assert.notEqual(before[0].children[0].key, before[1].children[0].key);
  const changed = reconcileMemoryTree(parse(original.replace("数据库", "更名")), before, key);
  assert.notEqual(changed[0].key, before[0].key);
});

const source = `# 重构记忆
# [已放弃] 旧方案
## 调研
- [未开始] 不再实现
  - [进行中] 不再验证
# [进行中] 新方案
- [已完成] 设计
- [进行中] 修复取消按钮
- [等待] 外部设备
  - [未开始] 真机验证
- [未开始] 验证等待展示
`;
test("chapter states inherit cancellation and waiting without blocking unrelated work", () => {
  const parsed = parseMemory(source);
  assert.equal(parsed.format, "chapters"); assert.equal(parsed.title, "重构记忆");
  assert.equal(parsed.percent, null); assert.equal(memoryComplete(parsed), false);
  assert.deepEqual(continuationTasks(parsed).map(t => t.title), ["修复取消按钮", "验证等待展示"]);
  assert.equal(parsed.tasks.find(t => t.title === "不再实现")?.abandoned, true);
  assert.equal(parsed.tasks.find(t => t.title === "真机验证")?.waiting, true);
  const outline = memoryOutline(memoryBody(source));
  assert.deepEqual(outline.abandonedLines.slice(1, 6), [true, true, true, true, false]);
  assert.equal(outline.nodes[0].title, "旧方案");
});
test("lists, lazy continuation, fences and explicit deletion keep branch boundaries", () => {
  const parsed = parseMemory(`# 目标\n- [已删除] 旧\n补充说明\n  - [未开始] 旧子项\n- [未开始] 新\n\n\`\`\`md\n- [进行中] 示例\n\`\`\`\n<!-- - [未开始] 注释 -->\n- ~~[未开始] 只是划线~~`);
  assert.deepEqual(continuationTasks(parsed).map(t => t.title), ["新", "只是划线"]);
  assert.equal(parsed.tasks.find(t => t.title === "旧子项")?.abandoned, true);
  assert.equal(parsed.tasks.some(t => t.title === "示例"), false);
});
test("completion excludes abandoned branches but never waiting or all abandoned", () => {
  for (const body of ["# 目标\n- [已放弃] 旧\n  - [未开始] 旧子项\n- [已完成] 新", "## 任务进度\n整体状态：已完成\n整体进度：100%\n- [已放弃] 旧\n  - [未开始] 旧子项\n- [已完成] 新"]) assert.equal(memoryComplete(parseMemory(body)), true);
  for (const body of ["# 目标\n- [已放弃] 旧", "# 目标\n- [等待] 等待输入\n  - [已完成] 子项", "# 目标\n- [已完成] 父\n  - [未开始] 子项", "# 目标"]) assert.equal(memoryComplete(parseMemory(body)), false);
  const modern = parseMemory("# 新目标\n## 目标与范围\n整体状态：进行中\n## [已放弃] 旧\n- [未开始] 废弃项\n## [进行中] 实现\n- [未开始] 验证");
  assert.equal(modern.format, "chapters"); assert.deepEqual(continuationTasks(modern).map(t => t.title), ["验证"]);
});
test("six heading states preserve hierarchy and failure never completes", () => {
  const parsed = parseMemory("# 目标\n# [未开始] A\n## [进行中] B\n### [已完成] C\n## [等待] D\n# [已放弃] E\n# [失败] F");
  assert.deepEqual(parsed.tasks.map(task => task.state), ["未开始", "进行中", "已完成", "等待", "已放弃", "失败"]);
  assert.deepEqual(parsed.outline!.map(node => node.depth), [0, 1, 2, 1, 0, 0]);
  const failure = parseMemory("# 失败任务\n## [失败] 验证失败");
  assert.equal(failure.state, "失败"); assert.equal(memoryComplete(failure), false);
  assert.deepEqual(continuationTasks(failure), []);
  const markup = renderToStaticMarkup(createElement(MemoryTaskTree, { nodes: parsed.outline!, scope: { workspaceId: "w", sessionId: "s" }, revision: "test" }));
  for (const state of ["未开始", "进行中", "已完成", "等待", "已放弃", "失败"]) assert.ok(markup.includes(`class="memory-state-icon" data-state="${state}"`));
  assert.match(markup, /animateTransform/); assert.match(markup, /stroke-dashoffset/);
});
test("English and Chinese status trees share hierarchy, continuation and completion semantics", () => {
  const english = `# [In progress] Deliver a compatible release
## [Completed] Plan
## ~~[Abandoned] Previous approach~~
### [Not started] Old checks
## [Waiting] External input
### [In progress] Dependent work
## [Failed] Earlier attempt
## [Not started] Verify current work
# [Completed] Independent goal
`;
  const translations = new Map([
    ["Not started", "未开始"], ["In progress", "进行中"], ["Completed", "已完成"],
    ["Waiting", "等待"], ["Abandoned", "已放弃"], ["Failed", "失败"],
  ]);
  const chinese = english.replace(/\[([^\]]+)\]/g, (_, state: string) => `[${translations.get(state)}]`);
  const expected = parseMemory(chinese);
  const lowercase = english.replace(/\[([a-z ]+)\]/gi, (_, state: string) => `[${state.toLowerCase()}]`);
  for (const body of [english, english.replaceAll("[In progress]", "[进行中]"), lowercase]) {
    const parsed = parseMemory(body);
    assert.deepEqual(parsed, expected);
    assert.equal(parsed.title, "");
    assert.equal(memoryComplete(parsed), false);
    assert.doesNotThrow(() => assertMemoryTitle("", body), "status-bearing H1 goals are not legacy fixed titles");
    assert.doesNotThrow(() => assertMemoryTitle(body, body.replace(/\[in progress\]/i, "[Completed]")));
  }
  assert.deepEqual(parseMemory(english), expected);
  assert.deepEqual(continuationTasks(parseMemory(english)).map(task => task.title), ["Verify current work"]);
  assert.equal(memoryComplete(parseMemory("# [Completed] Current goal\n## ~~[Abandoned] Old step~~\n### [进行中] Historical work")), true);
});
test("English status headings render SVG icons instead of literal bracketed states", () => {
  const states = [
    ["Not started", "未开始"], ["In progress", "进行中"], ["Completed", "已完成"],
    ["Waiting", "等待"], ["Failed", "失败"], ["Abandoned", "已放弃"],
  ] as const;
  const body = states.map(([state], index) => `# [${state}] Goal ${index + 1}`).join("\n");
  const parsed = parseMemory(body);
  assert.equal(parsed.title, "", "the first English goal must not become an unparsed document title");
  assert.equal(parsed.outline!.length, states.length);
  const markup = renderToStaticMarkup(createElement(MemoryTaskTree, {
    nodes: parsed.outline!, scope: { workspaceId: "w", sessionId: "s" }, revision: "english",
  }));
  for (const [english, normalized] of states) {
    assert.ok(markup.includes(`class="memory-state-icon" data-state="${normalized}"`), english);
    assert.ok(!markup.includes(`[${english}]`), `${english} is metadata, not title text`);
  }
  assert.equal((markup.match(/class="memory-state-icon"/g) ?? []).length, states.length);
  assert.match(markup, /<path/);
  assert.match(markup, /animateTransform/);
});
test("all saved task headings are stable while states and new branches can change", () => {
  const body = "# [In progress] 固定目标\n## [Not started] 实现";
  assert.doesNotThrow(() => assertMemoryTitle(body, body.replace("Not started", "Completed")));
  assert.throws(() => assertMemoryTitle(body, body.replace("实现", "新实现")), /不能改名/);
  assert.throws(() => assertMemoryTitle("", "# 无状态标题"));
  assert.throws(() => assertMemoryTitle("", "# [Waiting] 目标\n<!-- detail:1:start -->"));
});
test("the entire memory instruction exactly matches the approved concise prompt plus the session path", () => {
  const doc = readFileSync(new URL("../../docs/memory-title-details-system-prompt.md", import.meta.url), "utf8");
  const body = doc.match(/```text\n([\s\S]*?)\n```/)?.[1];
  assert.ok(body, "the approved document must contain the complete Markdown prompt");
  assert.equal(memoryInstruction("<session-memory-directory>/MEMORY.md"), body);
  for (const path of ["/tmp/项目 memory/MEMORY.md", "C:/memory/session/MEMORY.md"]) {
    const prompt = memoryInstruction(path);
    assert.equal(prompt, body.replaceAll("<session-memory-directory>/MEMORY.md", path).replaceAll("<session-memory-directory>/details", path.replace(/[/\\][^/\\]+$/, "") + "/details"));
    assert.doesNotMatch(prompt, /RULES|entryRevision|oldText|newText/);
    assert.doesNotMatch(body, /\p{Script=Han}/u);
    assert.match(prompt, /The main memory file contains one or more task trees at the same level/);
    assert.match(prompt, /After maintaining memory, immediately continue authorized work that can proceed/);
  }
});
test("UI offers title and document actions only for existing files, separate from disclosure", () => {
  const body = "# [Abandoned] 旧\n## [Not started] 废弃\n# [In progress] 新\n## [In progress] 继续\n";
  const props = { text: body, scope: { workspaceId: "w", sessionId: "s" }, navigate() {} };
  const absent = renderToStaticMarkup(createElement(MemoryEntry, props));
  assert.doesNotMatch(absent, /查看详情|memory-title-open|icon-file-text/);
  const markup = renderToStaticMarkup(createElement(MemoryEntry, { ...props, files: [{ path: "details/旧.md" }, { path: "details/新/继续.md" }, { path: "details/不存在.md" }] }));
  assert.match(markup, /aria-label="查看详情：旧"/); assert.match(markup, /aria-label="查看详情：继续"/);
  assert.doesNotMatch(markup, /aria-label="查看详情：新"/); assert.doesNotMatch(markup, /不存在/);
  assert.match(markup, /data-abandoned="true"/); assert.match(markup, /aria-expanded="false"/);
  assert.equal((markup.match(/class="[^"]*\bmemory-title-open\b[^"]*"/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  assert.doesNotMatch(markup, /查看详情：废弃/, "abandoned children mount only on expansion");
});
