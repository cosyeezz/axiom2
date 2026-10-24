import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { assertMemoryTitle, memoryBody, memoryComplete, memoryInstruction, parseMemory } from "../src/shared/memory.js";
import { detailIds, memoryOutline, parseDetailBlocks } from "../src/shared/memory-outline.js";
import { continuationTasks } from "../src/server/memory-continuations.js";
import { MemoryEntry, MemoryTaskTree } from "../src/client/memory/MemoryOutlineView.js";

const source = `# 重构记忆
# [已放弃] 旧方案 〔1〕
## 调研
- [未开始] 不再实现
  - [进行中] 不再验证
# [进行中] 新方案
- [已完成] 设计
- [进行中] 修复取消按钮 〔2〕
- [等待] 外部设备
  - [未开始] 真机验证
- [未开始] 验证等待展示
`;
test("chapter states inherit cancellation and waiting without blocking unrelated work", () => {
  const parsed = parseMemory(source);
  assert.equal(parsed.format, "chapters"); assert.equal(parsed.title, "重构记忆");
  assert.equal(parsed.percent, null); assert.equal(memoryComplete(parsed), false);
  assert.deepEqual(continuationTasks(parsed).map(t => t.title), ["新方案", "修复取消按钮", "验证等待展示"]);
  assert.equal(parsed.tasks.find(t => t.title === "不再实现")?.abandoned, true);
  assert.equal(parsed.tasks.find(t => t.title === "真机验证")?.waiting, true);
  const outline = memoryOutline(memoryBody(source));
  assert.deepEqual(outline.abandonedLines.slice(1, 6), [true, true, true, true, false]);
  assert.deepEqual(outline.nodes[0].details, [1]);
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
  assert.equal(modern.format, "chapters"); assert.deepEqual(continuationTasks(modern).map(t => t.title), ["实现", "验证"]);
});
test("six heading states preserve hierarchy and failure never completes", () => {
  const parsed = parseMemory("# 目标\n# [未开始] A\n## [进行中] B\n### [已完成] C\n## [等待] D\n# [已放弃] E\n# [失败] F");
  assert.deepEqual(parsed.tasks.map(task => task.state), ["未开始", "进行中", "已完成", "等待", "已放弃", "失败"]);
  assert.deepEqual(parsed.outline!.map(node => node.depth), [0, 1, 2, 1, 0, 0]);
  const failure = parseMemory("# 失败任务\n## [失败] 验证失败");
  assert.equal(failure.state, "失败"); assert.equal(memoryComplete(failure), false);
  assert.deepEqual(continuationTasks(failure), []);
  const markup = renderToStaticMarkup(createElement(MemoryTaskTree, { nodes: parsed.outline!, scope: { workspaceId: "w", sessionId: "s" }, revision: "test" }));
  for (const icon of ["circle", "circle-dot", "circle-check", "clock", "circle-slash", "circle-x"]) assert.ok(markup.includes(`#i-${icon}`));
});
test("fixed titles allow detail references, not replacement or oversized initial titles", () => {
  assert.doesNotThrow(() => assertMemoryTitle("# 固定目标", "# 固定目标 〔1〕\n- [进行中] 新目标"));
  assert.throws(() => assertMemoryTitle("# 固定目标", "# 换目标"), /不能修改/);
  assert.throws(() => assertMemoryTitle("", `# ${"字".repeat(14)}`), /13字/);
  assert.doesNotThrow(() => assertMemoryTitle(`# ${"字".repeat(14)}`, `# ${"字".repeat(14)}\n新记录`));
});
test("detail boundaries fail closed and IDs are unique", () => {
  assert.deepEqual(detailIds("〔1〕 〔2〕 〔1〕 〔0〕"), [1, 2]);
  const block = "<!-- detail:1:start -->\n正文\n<!-- detail:1:end -->";
  assert.equal(parseDetailBlocks(block)[0].content, "正文");
  for (const body of [block + block, "<!-- detail:1:start -->", "<!-- detail:2:end -->", block.replace("end", "broken"), "<!-- detail:1:start -->\n<!-- detail:2:start -->\n<!-- detail:2:end -->\n<!-- detail:1:end -->"]) assert.throws(() => parseDetailBlocks(body), /边界/);
});
test("final prompt exactly matches the approved document without RULES or tool parameter prose", () => {
  const doc = readFileSync(new URL("../../docs/memory-refactor/00-system-prompt.md", import.meta.url), "utf8");
  const prompt = doc.split("<!-- prompt:start -->")[1].split("<!-- prompt:end -->")[0].trim();
  assert.equal(memoryInstruction("{memoryPath}"), prompt);
  assert.doesNotMatch(prompt, /RULES|entryRevision|oldText|newText/);
});
test("UI retains a single Markdown scope, branch strikes and per-detail links", () => {
  const body = "# 目标\n## [已放弃] 旧\n- [未开始] 废弃[^证据] 〔1〕\n  - [未开始] 子项\n## [进行中] 新\n- [进行中] 继续\n\n[^证据]: 历史证据\n";
  const markup = renderToStaticMarkup(createElement(MemoryEntry, { text: body, scope: { workspaceId: "w", sessionId: "s" }, navigate() {} }));
  assert.match(markup, /data-abandoned/); assert.match(markup, /data-footnote-target/);
  assert.match(markup, /references\/details.md#detail:1/); assert.match(markup, /历史证据/);
  const tree = renderToStaticMarkup(createElement(MemoryTaskTree, { nodes: parseMemory(body).outline!, scope: { workspaceId: "w", sessionId: "s" }, revision: "test" }));
  assert.match(tree, /<summary class="memory-task-row">/); assert.match(tree, /〔1〕/); assert.match(tree, /data-abandoned="true"/);
});
