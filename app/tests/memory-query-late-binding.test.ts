import assert from "node:assert/strict";
import { test } from "node:test";
import { purposeFixture, selection } from "./memory-purpose-fixture.js";

for (const scanDuringMatch of [false, true]) test(`an uncaptured linked task detail cannot inherit the linking purpose: late scan ${scanDuringMatch}`, async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection });
    const entry = "# [Completed] 来源\n# [Completed] 目标\n", scope = f.create(entry);
    f.detail(scope, "[目标](目标.md)"); f.memories.scan(scope); f.publish();
    f.detail(scope, "未捕获的目标依据", "# [Completed] 目标"); let answered = false;
    f.memories.runner = { close: async () => {}, execute: async input => {
      if (JSON.parse(input.prompt).catalog) {
        if (scanDuringMatch) f.memories.scan(scope);
        return { answer: '["记忆事务"]', incomplete: false };
      }
      answered = true;
      f.write(scope, entry.replace("# [Completed] 目标", "# [In progress] 目标")); f.memories.scan(scope);
      return { answer: "不允许发布目标旧依据", incomplete: false };
    } };
    const result = await f.memories.query(scope, "目标依据");
    assert.equal(result.answer, ""); assert.equal(result.incomplete, true); assert.equal(result.reason, "locator_invalid");
    assert.equal(answered, false, "unknown task provenance fails before answer generation, even if a later scan discovers it");
  } finally { await f.close(); }
});
