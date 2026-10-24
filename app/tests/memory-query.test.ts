import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { purposeFixture, navigation, selection } from "./memory-purpose-fixture.js";
async function fixture() {
  const f = purposeFixture(); await f.configure({ queryModel: selection });
  const create = (text = "当前来源事实", title = "来源核验") => { const scope = f.create(`# [Completed] ${title}\n## [Completed] 验证结果\n`); f.detail(scope, text); f.memories.scan(scope); return scope; };
  const scope = create(); f.publish();
  const query = (signal?: AbortSignal, target = f.memories) => target.query(scope, "当前事实", signal);
  return { ...f, create, scope, query };
}
test("cold restart reads only selected purposes beyond 24 sources with full detail files", async () => {
  const f = await fixture(); let restarted: Memories | undefined;
  try {
    const selected = f.create("模型迁移验证通过", "迁移验证"); for (let i = 0; i < 24; i++) f.create(`无关来源${i}`, `无关目的${i}`); f.publish();
    await f.memories.close(); restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close();
    let calls = 0; restarted.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt);
      if (data.candidates) {
        assert.ok(!input.prompt.includes("模型迁移验证通过"));
        return { answer: JSON.stringify(data.candidates.filter((c: any) => c.kind !== "purpose" || c.text === "迁移验证").map((c: any) => c.id)), incomplete: false };
      }
      assert.equal(data.evidence.length, 1); assert.equal(data.evidence[0].content, "模型迁移验证通过"); return navigation(input, "模型迁移验证通过");
    } };
    const result = await f.query(undefined, restarted); assert.equal(result.answer, "模型迁移验证通过"); assert.equal(calls, 4); assert.deepEqual(result.sources.map(s => s.sessionId), [selected.sessionId]); assert.equal(result.readDocuments?.length, 2);
  } finally { await restarted?.close(); await f.close(); }
});
test("query never scans, uses invocation-time latest index, and does not switch snapshots in flight", async () => {
  const f = await fixture(); try {
    const internal = f.memories as any, generation = internal.generation(f.scope), captured = f.tree.snapshot(f.workspace.id).version;
    internal.scanAsync = async () => { throw Error("query must not scan"); }; let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; if (calls === 1) { f.create("晚到原文", "晚到目的"); f.publish("最新目录"); }
      return navigation(input, "当前来源事实");
    } };
    const first = await f.query(); assert.equal(first.indexVersion, captured); assert.equal(first.answer, "当前来源事实"); assert.equal(internal.generation(f.scope), generation);
    const latest = await f.query(); assert.equal(latest.indexVersion, f.tree.snapshot(f.workspace.id).version); assert.ok(latest.indexVersion! > captured);
  } finally { await f.close(); }
});
for (const change of ["source", "correction", "authorization"] as const) test(`query suppresses stale output after ${change}`, async () => {
  const f = await fixture(); try {
    f.memories.runner = { close: async () => {}, execute: async input => {
      if (JSON.parse(input.prompt).evidence) {
        if (change === "source") writeFileSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"), "# [Completed] 已修改目的\n");
        else if (change === "correction") await f.memories.correct(f.workspace.id, "当前来源事实");
        else f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.workspace.id);
      }
      return navigation(input, "不可发布旧事实");
    } };
    const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, true);
  } finally { await f.close(); }
});
test("invalid goal locators fail explicitly, without guessing paths or synthesizing from the directory", async () => {
  const f = await fixture(); try {
    f.write(f.scope, "# [Completed] 改名后目的\n"); let answers = 0;
    f.memories.runner = { close: async () => {}, execute: async input => { if (JSON.parse(input.prompt).evidence) answers++; return navigation(input); } };
    const result = await f.query(); assert.equal(result.reason, "locator_invalid"); assert.equal(result.answer, ""); assert.equal(answers, 0);
  } finally { await f.close(); }
});
test("matching no necessary detail is a verified miss and never answers from titles", async () => {
  const f = await fixture(); try {
    let calls = 0; f.memories.runner = { close: async () => {}, execute: async input => { calls++; return JSON.parse(input.prompt).stage === "details" ? { answer: "[]", incomplete: false } : navigation(input); } };
    const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, false); assert.equal(calls, 3); assert.equal(result.readDocuments?.length, 1);
  } finally { await f.close(); }
});
for (const action of ["cancel", "timeout", "close"] as const) test(`query promptly settles ${action} when runner ignores cancellation`, async () => {
  const f = await fixture(); let release!: () => void, enter!: () => void; const gate = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { enter = r; }); const alive = setInterval(() => {}, 1000);
  try {
    if (action === "timeout") await f.configure({ timeoutMs: 1000 });
    let signal: AbortSignal | undefined; f.memories.runner = { close: async () => {}, execute: async input => { signal = input.signal; enter(); await gate; return navigation(input); } };
    const controller = new AbortController(), pending = f.query(controller.signal); await entered;
    if (action === "cancel") controller.abort(); else if (action === "close") await f.memories.close();
    if (action === "cancel") await assert.rejects(pending, { name: "AbortError" });
    else { const result = await pending; assert.equal(result.answer, ""); assert.equal(result.incomplete, true); if (action === "timeout") assert.equal(result.reason, "timeout"); }
    assert.equal(signal?.aborted, true); release(); await new Promise(r => setImmediate(r));
  } finally { clearInterval(alive); release?.(); await f.close(); }
});
test("only [] is a valid empty match, malformed/forged/duplicate IDs fail", async () => {
  const f = await fixture(); try {
    for (const answer of ["", "not JSON", "{}", '["forged"]', "[]"]) {
      f.memories.runner = { close: async () => {}, execute: async () => ({ answer, incomplete: false }) };
      const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, answer !== "[]");
    }
  } finally { await f.close(); }
});
