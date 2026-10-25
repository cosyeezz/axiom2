import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { purposeFixture, navigation, selection, matchingCandidates } from "./memory-purpose-fixture.js";
async function fixture() {
  const f = purposeFixture(); await f.configure({ queryModel: selection });
  const create = (text = "当前来源事实", title = "来源核验") => { const scope = f.create(`# [Completed] ${title}\n## [Completed] 验证结果\n`); f.detail(scope, text); f.memories.scan(scope); return scope; };
  const scope = create(); f.publish();
  const query = (signal?: AbortSignal, target = f.memories) => target.query(scope, "当前事实", signal);
  return { ...f, create, scope, query };
}
test("legacy duplicates are projected once from the captured index and only current numbered detail is read", async () => {
  const f = await fixture(); try {
    // Simulate the published historical tuple without treating its first member as a title.
    const previous = f.tree.snapshot(f.workspace.id), old = previous.purposes[0];
    old.source.key = '["unrelated historical label",7]';
    const row = f.tree.entries(f.workspace.id)[0];
    f.store.db.prepare("UPDATE memory_purposes SET sourceKey=?,body=? WHERE id=?").run(old.source.key, JSON.stringify({ ...row, source: old.source }), old.id);
    f.store.db.prepare("UPDATE memory_purpose_indexes SET body=? WHERE workspaceId=?").run(JSON.stringify(previous), f.workspace.id);
    f.write(f.scope, "# [Completed] 来源核验 〔7〕\n## [Completed] 验证结果\n");
    const detail = f.detail(f.scope, "新版编号详情依据");
    // Capture a historical overlap; query itself must not scan or repair storage.
    f.tree.enqueue(f.scope, "# [Completed] 来源核验 〔7〕\n## [Completed] 验证结果\n"); f.publish();
    const before = f.tree.snapshot(f.workspace.id), rows = f.tree.entries(f.workspace.id); let answers = 0;
    assert.equal(before.purposes.length, 2); assert.equal(f.tree.tree(f.workspace.id).purposes.length, 1);
    (f.memories as any).scanAsync = async () => { throw Error("query must not scan"); };
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt);
      const candidates = matchingCandidates(input);
      if (candidates?.some(candidate => candidate.kind === "purpose")) assert.equal(candidates.filter(candidate => candidate.kind === "purpose").length, 1);
      if (data.evidence) { answers++; assert.equal(data.evidence.length, 1); assert.equal(data.evidence[0].content, "新版编号详情依据"); }
      return navigation(input, "新版编号详情依据");
    } };
    const result = await f.query(); assert.equal(result.answer, "新版编号详情依据"); assert.equal(answers, 1); assert.equal(result.indexVersion, before.version);
    assert.equal(result.readDocuments?.filter(document => document.path === detail.path).length, 1);
    assert.deepEqual(f.tree.snapshot(f.workspace.id), before); assert.deepEqual(f.tree.entries(f.workspace.id), rows);
    f.write(f.scope, "# [In progress] 来源核验 〔7〕\n## [Completed] 验证结果\n");
    const invalid = await f.query(); assert.equal(invalid.reason, "locator_invalid"); assert.equal(invalid.answer, ""); assert.equal(answers, 1, "legacy duplicate cannot revive a reopened canonical goal");
  } finally { await f.close(); }
});
test("an unnumbered canonical binding follows only a unique reference annotation", async () => {
  const f = await fixture(); try {
    f.write(f.scope, "# [Completed] 来源核验 〔8〕\n## [Completed] 验证结果\n"); const detail = f.detail(f.scope, "编号补注后仍可核验");
    let answers = 0; f.memories.runner = { close: async () => {}, execute: async input => { if (JSON.parse(input.prompt).evidence) answers++; return navigation(input, "编号补注后仍可核验"); } };
    const unproven = await f.query(); assert.equal(unproven.reason, "locator_invalid"); assert.equal(answers, 0, "a source-only annotation is not a published binding");
    f.memories.scan(f.scope); f.publish();
    const result = await f.query(); assert.equal(result.answer, "编号补注后仍可核验"); assert.ok(result.readDocuments?.some(document => document.path === detail.path));
    f.write(f.scope, "# [Completed] 来源核验 〔9〕\n");
    const changed = await f.query(); assert.equal(changed.reason, "locator_invalid"); assert.equal(answers, 1);
  } finally { await f.close(); }
});
test("selecting only an old unnumbered leaf cannot bypass a changed numbered binding", async () => {
  const f = await fixture(); try {
    f.tree.enqueue(f.scope, "# [Completed] 来源核验 〔1〕\n"); f.publish();
    f.write(f.scope, "# [Completed] 来源核验 〔2〕\n"); f.detail(f.scope, "不得通过旧别名读取"); let answers = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt); if (data.evidence) answers++;
      const candidates = matchingCandidates(input);
      return candidates ? { answer: JSON.stringify(candidates.filter(candidate => candidate.kind !== "purpose" || candidate.text === "来源核验").map(candidate => candidate.id)), incomplete: false } : navigation(input);
    } };
    const result = await f.query(); assert.equal(result.reason, "locator_invalid"); assert.equal(result.answer, ""); assert.equal(answers, 0);
  } finally { await f.close(); }
});
test("cold restart reads only selected purposes beyond 24 sources with full detail files", async () => {
  const f = await fixture(); let restarted: Memories | undefined;
  try {
    const selected = f.create("模型迁移验证通过", "迁移验证"); for (let i = 0; i < 24; i++) f.create(`无关来源${i}`, `无关目的${i}`); f.publish();
    await f.memories.close(); restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close();
    let calls = 0; restarted.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt);
      const candidates = matchingCandidates(input);
      if (candidates) {
        assert.ok(!input.prompt.includes("模型迁移验证通过"));
        return { answer: JSON.stringify(candidates.filter(c => c.kind !== "purpose" || c.text === "迁移验证").map(c => c.id)), incomplete: false };
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
test("short-number navigation preserves same-name source bindings and keeps locator metadata audit-only", async () => {
  const f = await fixture(); try {
    const second = f.create("第二来源独立依据 /project/current.md", "来源核验"); f.publish();
    const snapshot = f.tree.snapshot(f.workspace.id);
    const internalIds = snapshot.purposes.map(p => p.id).concat(snapshot.roots.map(n => n.id));
    let detailCalls = 0, answerCalls = 0, detailCatalog: unknown;
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt), candidates = matchingCandidates(input);
      if (candidates) {
        assert.equal(data.candidates, undefined);
        for (const id of [...internalIds, f.scope.sessionId, second.sessionId]) assert.ok(!input.prompt.includes(id));
        assert.ok(!input.prompt.includes("details/"));
        assert.equal((input as any).candidateBindings, undefined);
        assert.equal(candidates[0]!.id, 1, "every call restarts numbering");
        if (data.stage === "details") {
          detailCalls++;
          detailCatalog = data.catalog;
          const groups = data.catalog.filter((row: any[]) => row[0] === "G");
          assert.deepEqual(groups, [["G", 1, "来源核验"], ["G", 2, "来源核验"]]);
          assert.equal(candidates.length, 2);
          return { answer: "[2]", incomplete: false };
        }
        return navigation(input);
      }
      answerCalls++; assert.equal(data.evidence.length, 1);
      assert.equal(data.evidence[0].content, "第二来源独立依据 /project/current.md");
      return navigation(input, "第二来源独立依据 /project/current.md");
    } };
    const result = await f.query();
    assert.equal(result.answer, "第二来源独立依据 /project/current.md"); assert.equal(detailCalls, 1); assert.equal(answerCalls, 1);
    assert.ok(result.readDocuments?.some(document => document.sessionId === second.sessionId && document.path.startsWith("details/")));
    assert.ok(!result.readDocuments?.some(document => document.sessionId === f.scope.sessionId && document.path.startsWith("details/")));
    const row = f.store.db.prepare("SELECT body FROM processing_records WHERE kind='memory.query'").get()!;
    const calls = JSON.parse(String(row.body)).calls;
    const audited = calls.map((call: any) => JSON.parse(call.input.text)).filter((input: any) => input.candidateBindings);
    assert.equal(audited.length, 3);
    const detailAudit = audited.find((input: any) => JSON.parse(input.prompt).stage === "details");
    assert.deepEqual(JSON.parse(detailAudit.prompt).catalog, detailCatalog, "audit retains the actual model catalog without fragment redaction");
    assert.deepEqual(detailAudit.candidateBindings.map((binding: any) => binding.number), [1, 2]);
    assert.notEqual(detailAudit.candidateBindings[0].purposeId, detailAudit.candidateBindings[1].purposeId);
    const [purposeId, path] = JSON.parse(detailAudit.candidateBindings[1].id);
    assert.equal(snapshot.purposes.find(p => p.id === purposeId)?.source.sessionId, second.sessionId);
    assert.ok(result.readDocuments?.some(document => document.sessionId === second.sessionId && document.path === path));
    assert.deepEqual(f.tree.snapshot(f.workspace.id), snapshot, "projection never rewrites persistent identities");
  } finally { await f.close(); }
});

test("only [] is a valid empty match, malformed/forged/duplicate numbers fail", async () => {
  const f = await fixture(); try {
    for (const answer of ["", "not JSON", "{}", '["forged"]', '["1"]', "[0]", "[-1]", "[1.5]", "[2]", "[null]", "[true]", "[1,1]", "[]"]) {
      f.memories.runner = { close: async () => {}, execute: async () => ({ answer, incomplete: false }) };
      const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, answer !== "[]");
    }
  } finally { await f.close(); }
});
