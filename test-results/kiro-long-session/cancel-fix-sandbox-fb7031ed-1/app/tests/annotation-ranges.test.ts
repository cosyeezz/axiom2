import assert from "node:assert/strict";
import test from "node:test";
import { detailBounds } from "../src/client/chat/annotation-ranges.js";
const detail = (text: string, offset: number, code = false) => { const [start, end] = detailBounds(text, offset, code); return text.slice(start, end); };
test("detail targeting separates Chinese sentences, clauses and English sentences without splitting decimals", () => {
  const text = "第一句保持。第二句需要修改！第三句待核实；第四句。";
  assert.equal(detail(text, text.indexOf("需要")), "第二句需要修改！");
  assert.equal(detail(text, text.indexOf("核实")), "第三句待核实；");
  const english = "Keep v1.2 here. Change only this sentence. Keep the rest.";
  assert.equal(detail(english, 7), "Keep v1.2 here.");
  assert.equal(detail(english, english.indexOf("only")), "Change only this sentence.");
});
test("code targeting preserves a complete single line including punctuation", () => {
  const code = "const value = 1; // 保持。\n  const retry = true; // 调整！\nreturn value;";
  assert.equal(detail(code, code.indexOf("retry"), true), "const retry = true; // 调整！");
  assert.equal(detail("", 100), "");
  assert.equal(detail("  独立单元格  ", 4), "独立单元格");
});
