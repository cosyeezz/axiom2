import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMemory } from "../src/shared/memory.js";

const progress = (state: string, estimate: string, tasks = "- [进行中] 修复") => `## 任务进度\n整体状态：${state}\n整体进度：${estimate}\n${tasks}\n`;

test("memory progress accepts exact and approximate incomplete ten-percent estimates", () => {
  for (const estimate of ["30%", "约30%", "0%", "约90%"]) {
    const parsed = parseMemory(progress("进行中", estimate));
    assert.equal(parsed.progressState, "valid", estimate);
    assert.equal(parsed.percent, Number(estimate.replace(/\D/g, "")), estimate);
  }
  assert.equal(parseMemory(progress("进行中", "100%", "- [已完成] 修复")).progressState, "conflict");
  assert.equal(parseMemory(progress("进行中", "45%")).progressState, "conflict");
  assert.equal(parseMemory(progress("进行中", "110%")).progressState, "conflict");
  assert.equal(parseMemory(progress("已完成", "约100%", "- [已完成] 修复")).progressState, "conflict");
  assert.equal(parseMemory(progress("已完成", "100%", "- [进行中] 修复")).progressState, "conflict");
});
