import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelQuestions, questionMessageComplete, questionIsCurrent, questionAnswered, modelQuestionsReply, modelQuestionInstruction } from "../src/shared/model-question.js";
import { emptyThread, type ChatMessage } from "../src/shared/agent.js";
import { memoryInstruction } from "../src/shared/memory-instruction.js";
import { environmentResourceOptions } from "../src/server/environment-resources.js";
const single = '<Question type="single">\n选择方向？\n1. 简洁实现\n2. 完整实现\n</Question>';
const multiple = '<Question type="multiple">\n需要哪些检查？\n1. 单元测试\n2. 浏览器测试\n3. 构建\n</Question>';
test("Question tags parse single, multiple and prose without JSON or tools", () => {
  assert.deepEqual(parseModelQuestions(single)?.questions[0], { type: "single", question: "选择方向？", options: ["简洁实现", "完整实现"] });
  const result = parseModelQuestions(`先确认两点。\n${single}\n\n${multiple}\n等你回答。`)!;
  assert.equal(result.questions.length, 2); assert.equal(result.questions[1].type, "multiple");
  assert.equal(result.text, "先确认两点。\n\n等你回答。");
  assert.equal(parseModelQuestions("普通回复"), null);
});
test("fenced examples are inert; malformed or partial tags preserve the entire source", () => {
  for (const fence of ["```", "~~~~"]) {
    const example = `${fence}xml\n${single}\n${fence}`;
    assert.equal(parseModelQuestions(example), null);
    assert.equal(parseModelQuestions(`${example}\n${multiple}`)?.text, example);
  }
  for (const bad of [single.replace("</Question>", ""), single.replace("2.", "3."), single.replace("2. 完整实现", "2. 简洁实现"), single.replace('"single"', '"unknown"'), single.replace("选择方向？", ""), single.replace("2. 完整实现", ""), single.replace("简洁实现", "<Question>"), single + "\n</Question>", single.replace("完整实现", "完整实现\n续行"), Array(14).join(single + "\n")]) assert.equal(parseModelQuestions(bad), null, bad);
});
test("optional descriptions are aligned plain text, multiline and backward compatible", () => {
  const described = single.replace("1. 简洁实现", "1. 简洁实现\n  先跑通核心流程。\n  适合验证方向；暂不覆盖全部边界。");
  assert.deepEqual(parseModelQuestions(described)?.questions[0], {
    type: "single", question: "选择方向？", options: ["简洁实现", "完整实现"],
    descriptions: ["先跑通核心流程。\n适合验证方向；暂不覆盖全部边界。", ""],
  });
  assert.deepEqual(parseModelQuestions(described.replaceAll("\n", "\r\n")), parseModelQuestions(described));
  assert.equal(parseModelQuestions(single)?.questions[0].descriptions, undefined);
  const content = '<img src=x onerror=alert(1)> & [详情](javascript:alert(1))';
  assert.equal(parseModelQuestions(single.replace("2. 完整实现", `2. 完整实现\n  ${content}`))?.questions[0].descriptions?.[1], content);
  assert.deepEqual(parseModelQuestions(single.replace("2. 完整实现", "  2. 完整实现")), parseModelQuestions(single), "legacy indented numbered options remain options");
  assert.equal(parseModelQuestions(single.replace("1. 简洁实现", "1. 简洁实现\n\t说明"))?.questions[0].descriptions?.[0], "说明");
});
test("description limits and malformed blocks still fail closed", () => {
  for (const continuation of ["  <Question>", "  </Question> trailing", `  ${"a".repeat(4001)}`, `  ${"a".repeat(2500)}\n  ${"b".repeat(1500)}`, " 没有足够缩进", "没有缩进"]) {
    const source = single.replace("1. 简洁实现", `1. 简洁实现\n${continuation}`);
    assert.equal(parseModelQuestions(source), null, continuation.slice(0, 80));
  }
  assert.equal(parseModelQuestions(single.replace("1. 简洁实现", `1. 简洁实现\n  ${"a".repeat(4000)}`))?.questions[0].descriptions?.[0].length, 4000);
});
test("descriptions explain choices but do not change or inflate the submitted answer", () => {
  const described = parseModelQuestions(single.replace("2. 完整实现", "2. 完整实现\n  覆盖全部边界，前期投入较高。"))!.questions;
  const answers = [{ selected: [1], text: "优先可维护性" }];
  assert.equal(modelQuestionsReply(described, answers), modelQuestionsReply(parseModelQuestions(single)!.questions, answers));
  assert.equal(questionAnswered(described[0], { selected: [], text: "" }), false);
});
test("reply validates every question, supports free answers and stable multi-choice ordering", () => {
  const questions = parseModelQuestions(`${single}\n${multiple}`)!.questions;
  const answers = [{ selected: [1], text: "优先可维护性" }, { selected: [2, 0], text: "" }];
  assert.equal(modelQuestionsReply(questions, answers), "问题 1：选择方向？\n选择：2. 完整实现\n补充：优先可维护性\n\n问题 2：需要哪些检查？\n选择：1. 单元测试\n选择：3. 构建");
  assert.equal(modelQuestionsReply(questions, [answers[0], { selected: [], text: " " }]), null);
  assert.match(modelQuestionsReply([questions[0]], [{ selected: [], text: "自己的方案" }])!, /我的回答：自己的方案/);
  for (const selected of [[0, 1], [0, 0], [-1], [2], [0.5]]) assert.equal(questionAnswered(questions[0], { selected, text: "" }), false);
});
test("only complete final assistant and authoritative idle tail are eligible", () => {
  const message: ChatMessage = { id: "q", role: "assistant", phase: "final_answer", status: "completed", text: single };
  assert.equal(questionMessageComplete(message), true);
  assert.equal(questionMessageComplete({ ...message, truncated: true, textLength: single.length, thinking: "preview", thinkingLength: 1000 }), true, "complete reply with truncated thinking remains answerable");
  assert.equal(questionMessageComplete({ ...message, truncated: true, textLength: single.length + 1 }), false, "text-truncated preview remains inert");
  assert.equal(questionMessageComplete({ ...message, textLength: single.length - 1 }), false, "inconsistent length remains inert");
  for (const patch of [{ role: "user" }, { phase: "commentary" }, { streaming: true }, { truncated: true }, { textLength: 9999 }, { error: "error" }, { status: "failed" }, { calls: [{ id: "c", name: "bash", input: "" }] }]) assert.equal(questionMessageComplete({ ...message, ...patch } as ChatMessage), false);
  assert.equal(questionIsCurrent("q", { ...emptyThread, ids: ["old", "q"] }), true);
  assert.equal(questionIsCurrent("q", { ...emptyThread, ids: ["q", "new"] }), false);
  assert.equal(questionIsCurrent("q", { ...emptyThread, ids: ["q"], runStatus: "running" }), false);
});
test("short English Question rule is appended exactly once for main, memoryless and child loadouts", () => {
  assert.doesNotMatch(modelQuestionInstruction, /\p{Script=Han}|axiom-question|JSON/u);
  assert.match(modelQuestionInstruction, /short option labels.*description.*indented by two spaces/);
  assert.doesNotMatch(modelQuestionInstruction, /type their own answers/);
  assert.equal(memoryInstruction("/memory/MEMORY.md").split(modelQuestionInstruction).length, 2);
  for (const extra of [{}, { memoryPath: "/memory/MEMORY.md" }, { task: {} }]) {
    const options = environmentResourceOptions({ root: "/fixture", cwd: "/fixture", ...extra }, () => ({}), "CHILD_POLICY");
    const result = options.appendSystemPromptOverride!(["CUSTOM_APPEND"]).join("\n");
    assert.ok(result.startsWith("CUSTOM_APPEND"));
    assert.equal(result.split(modelQuestionInstruction).length, 2);
    if ("task" in extra) assert.match(result, /CHILD_POLICY/);
  }
});
