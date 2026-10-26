import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryComplete, parseMemory } from "../src/shared/memory.js";
import { continuationPlan, continuationSignature, continuationTasks } from "../src/server/memory-continuations.js";

const cases: Array<{ body: string; state: string; tasks?: string[]; purpose?: string; mode?: string; complete?: boolean }> = [
  { body: "# [进行中] 父\n## [进行中] 子", state: "进行中", tasks: ["子"] },
  { body: "# [进行中] 父\n## [未开始] 子", state: "未开始", tasks: ["子"] },
  { body: "# [进行中] 父\n## [等待] 子", state: "等待" },
  { body: "# [进行中] 父\n## [失败] 子", state: "失败" },
  { body: "# [进行中] 父\n## [等待] 子\n## [失败] 另一个子", state: "失败" },
  { body: "# [等待] 父\n## 无状态分组\n### [进行中] 子", state: "等待" },
  { body: "# [失败] 父\n## 无状态分组\n### [未开始] 子", state: "失败" },
  { body: "# [已放弃] 父\n## 无状态分组\n### [进行中] 子", state: "已放弃" },
  { body: "# [已完成] 父\n## 无状态分组\n### [未开始] 子", state: "等待", mode: "reconcile" },
  { body: "# [已完成] 父\n## [等待] 子", state: "等待", mode: "reconcile" },
  { body: "# [进行中] 父\n## [已完成] 子", state: "进行中", tasks: ["父"], purpose: "verify" },
  { body: "# [进行中] 父\n## [已放弃] 子\n### [进行中] 废弃后代", state: "进行中", tasks: ["父"], purpose: "verify" },
  { body: "# [已完成] 父\n## [已完成] 子", state: "已完成", complete: true },
  { body: "# [已完成] 父\n## [已放弃] 子\n### [进行中] 废弃后代", state: "已完成", complete: true },
  { body: "# [已放弃] 旧\n# [已完成] 当前", state: "已完成", complete: true },
  { body: "# 空树\n## 分组", state: "" },
  { body: "# [未开始] 新\n# [已完成] 旧", state: "未开始", tasks: ["新"] },
  { body: "# [等待] 设备\n## [进行中] 依赖\n# [进行中] 独立", state: "进行中", tasks: ["独立"] },
  { body: "# [失败] 旧尝试\n## [未开始] 旧子\n# [未开始] 独立修复", state: "未开始", tasks: ["独立修复"] },
  { body: "# [已完成] 错误父\n## [进行中] 旧子\n# [进行中] 独立", state: "进行中", tasks: ["独立"] },
];
for (const scenario of cases) test(`effective tree frontier: ${scenario.body.replaceAll("\n", " / ")}`, () => {
  const progress = parseMemory(scenario.body), plan = continuationPlan(progress);
  assert.equal(progress.state, scenario.state);
  assert.equal(plan.analysis.displayState, scenario.state);
  assert.deepEqual(continuationTasks(progress).map(task => task.title), scenario.tasks ?? []);
  assert.equal(plan.mode, scenario.mode ?? (scenario.tasks?.length ? "execute" : "stop"));
  assert.equal(memoryComplete(progress), scenario.complete ?? false);
  if (scenario.purpose) assert.equal(plan.analysis.actionable[0].purpose, scenario.purpose);
});

test("mixed branch diagnostics retain source states, title paths, and distinct stopped frontiers", () => {
  const p = parseMemory("# [进行中] 目标\n## [等待] 外部设备\n### [未开始] 真机\n## [失败] 旧尝试\n### [进行中] 旧后代\n## [进行中] 独立\n# [已完成] 矛盾父\n## [未开始] 旧任务");
  assert.equal(p.state, "进行中");
  assert.deepEqual(p.analysis!.waiting.map(n => n.title), ["外部设备"]);
  assert.deepEqual(p.analysis!.failed.map(n => n.title), ["旧尝试"]);
  assert.deepEqual(p.analysis!.diagnostics.map(n => n.title), ["矛盾父"]);
  assert.deepEqual(p.analysis!.actionable[0].path, [{ title: "目标" }, { title: "独立" }]);
  assert.equal(p.tasks.find(n => n.title === "旧后代")!.state, "进行中", "original historical state is not rewritten");
});

test("frontier signatures include full title ancestry, not lines or notes", () => {
  const signature = (body: string) => { const p = continuationPlan(parseMemory(body)); return continuationSignature(p.analysis, p.mode); };
  const body = "# [进行中] A\n## [进行中] 相同步骤 〔1〕";
  assert.equal(signature(body), signature("\n" + body + "\n过程日志与详情扩写，不是进展"));
  assert.notEqual(signature(body), signature(body.replace("相同步骤", "改名是不同任务")));
  assert.equal(signature(body), signature(body.replace("进行中] A", "进行中]   A   ")));
  assert.notEqual(signature(body), signature(body.replace("] A", "] B")));
  assert.notEqual(signature(body), signature(body.replace("〔1〕", "〔2〕")));
  assert.notEqual(signature(body), signature(body.replace("## [进行中]", "## [未开始]")));
});

const legacy = (state: string, tasks: string, estimate = "约 50%") => `# 会话记忆\n## 目标与范围\n原授权任务\n## 任务进度\n整体状态：${state}\n整体进度：${estimate}\n${tasks}\n## 证据\n- [进行中] 证据中的伪任务\n`;
test("legacy uses only the task subtree, preserving grouping and failure/waiting inheritance", () => {
  const p = parseMemory(legacy("进行中", "- [进行中] 父\n  - [等待] 子\n- [失败] 失败父\n  - [未开始] 旧后代\n- [未开始] 独立"));
  assert.equal(p.format, "legacy"); assert.equal(p.percent, 50);
  assert.deepEqual(continuationTasks(p).map(n => n.title), ["独立"]);
  assert.equal(p.analysis!.waiting.length, 1); assert.equal(p.analysis!.failed.length, 1);
  assert.equal(p.analysis!.actionable.some(n => n.title.includes("伪任务")), false);
});
test("legacy percentage conflicts do not veto explicit work; completed-state conflicts reconcile only", () => {
  for (const estimate of ["45%", "100%", "约100%", "110%"]) {
    const p = parseMemory(legacy("进行中", "- [进行中] 验证", estimate));
    assert.equal(p.percent, null); assert.equal(p.progressState, "conflict");
    assert.equal(continuationPlan(p).mode, "execute");
    assert.ok(p.analysis!.diagnostics.some(n => n.code === "legacy_progress_conflict"));
  }
  const p = parseMemory(legacy("已完成", "- [进行中] 验证", "100%"));
  assert.equal(continuationPlan(p).mode, "reconcile"); assert.equal(memoryComplete(p), false);
  assert.deepEqual(continuationTasks(p), []);
});
test("legacy percentage-only conflicts cannot wake empty, waiting or failed trees", () => {
  for (const [tasks, reason] of [["", "no_tasks"], ["- [等待] 外部设备", "waiting"], ["- [失败] 旧尝试", "failed"]]) {
    const p = parseMemory(legacy("进行中", tasks, "45%"));
    assert.ok(p.analysis!.diagnostics.some(item => item.code === "legacy_progress_conflict"));
    assert.equal(continuationPlan(p).mode, "stop");
    assert.equal(continuationPlan(p).reason, reason);
    assert.deepEqual(continuationTasks(p), []);
  }
});
test("legacy explicit whole failure, abandonment and prose waiting remain conservative boundaries", () => {
  for (const [state, expected] of [["失败（尝试已结束）", "失败"], ["已放弃", "已放弃"], ["进行中（等待用户确认）", "等待"]]) {
    const p = parseMemory(legacy(state, "- [进行中] 旧后代"));
    assert.equal(p.analysis!.displayState, expected); assert.equal(continuationPlan(p).mode, "stop");
  }
});
test("English states normalize to exactly the same tree analysis", () => {
  const english = "# [In progress] Goal\n## [Waiting] Device\n### [Not started] Dependent\n## [Failed] Attempt\n### [In progress] Old\n## [Completed] Conflict\n### [Not started] Old 2\n## [In progress] Independent";
  const states: Record<string, string> = { "In progress": "进行中", Waiting: "等待", "Not started": "未开始", Failed: "失败", Completed: "已完成" };
  assert.deepEqual(parseMemory(english), parseMemory(english.replace(/\[([^\]]+)\]/g, (_, state: string) => `[${states[state]}]`)));
});
