import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Memories } from "../src/server/memories.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import { purposeFixture, navigation, selection, matchingCandidates } from "./memory-purpose-fixture.js";
async function fixture() {
  const f = purposeFixture(); await f.configure({ queryModel: selection });
  const create = (text = "当前来源事实", title = "来源核验") => { const scope = f.create(`# [Completed] ${title}\n## [Completed] 验证结果\n`); f.detail(scope, text); f.memories.scan(scope); return scope; };
  // Semantic subdirectories are explicit fixture choices, not original-title leaves.
  const publish = (name = "记忆事务") => {
    const old = f.tree.snapshot(f.workspace.id), batch = f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), purposes = [...old.purposes, ...batch];
    const groups = [...new Set(purposes.map(p => p.text))].map(title => ({ name: title.replace(/\d/g, digit => String.fromCharCode(65 + Number(digit))), children: [{ title }] }));
    const roots = f.tree.classify(JSON.stringify([{ name, children: groups }]), purposes);
    f.tree.publish(f.workspace.id, batch, roots, old.version); return batch;
  };
  const scope = create(); publish();
  const query = (signal?: AbortSignal, target = f.memories) => target.query(scope, "当前事实", signal);
  return { ...f, create, publish, scope, query };
}

test("one complete-tree match directly reads all associated documents, then one answer", async () => {
  const f = await fixture(); try {
    f.detail(f.scope, "子任务原文", "## [Completed] 验证结果"); f.memories.scan(f.scope);
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt), candidates = matchingCandidates(input);
      if (candidates) {
        assert.equal(data.stage, undefined); assert.equal(typeof data.catalog, "string");
        assert.ok(data.catalog.includes("记忆事务\n  来源核验")); assert.ok(!input.prompt.includes("当前来源事实"));
      } else { assert.equal(data.evidence.length, 2); assert.equal(data.outlines, undefined); }
      return navigation(input);
    } };
    const result = await f.query(); assert.equal(result.answer, "原文验证通过"); assert.equal(calls, 2);
    assert.equal(result.readDocuments?.length, 2); assert.ok(result.readDocuments?.every(ref => ref.path !== "MEMORY.md"));
  } finally { await f.close(); }
});
test("cold restart selects sources beyond 24 without reading unselected documents", async () => {
  const f = await fixture(); let restarted: Memories | undefined;
  try {
    const selected = f.create("模型迁移验证通过", "迁移验证"); for (let i = 0; i < 24; i++) f.create(`无关来源${i}`, `无关目的${i}`); f.publish();
    await f.memories.close(); restarted = new Memories(f.store, () => {}); clearInterval((restarted as any).timer); (restarted as any).watcher?.close();
    let calls = 0; restarted.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt), candidates = matchingCandidates(input);
      if (candidates) return { answer: JSON.stringify(candidates.filter(c => c.text === "迁移验证").map(c => c.id)), incomplete: false };
      assert.equal(data.evidence.length, 1); assert.equal(data.evidence[0].content, "模型迁移验证通过"); return navigation(input, "模型迁移验证通过");
    } };
    const result = await f.query(undefined, restarted); assert.equal(result.answer, "模型迁移验证通过"); assert.equal(calls, 2);
    assert.deepEqual(result.sources.map(s => s.sessionId), [selected.sessionId]); assert.equal(result.readDocuments?.length, 1);
  } finally { await restarted?.close(); await f.close(); }
});
test("query freezes directory and references at invocation, never scans or switches versions", async () => {
  const f = await fixture(); try {
    const internal = f.memories as any, generation = internal.generation(f.scope), captured = f.tree.snapshot(f.workspace.id).version;
    internal.scanAsync = async () => { throw Error("query must not scan"); }; let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; if (calls === 1) { f.detail(f.scope, "晚到原文", "## [Completed] 验证结果"); f.memories.scan(f.scope); f.create("晚到目的原文", "晚到目的"); f.publish("最新目录"); }
      const data = JSON.parse(input.prompt); if (data.evidence && calls === 2) assert.deepEqual(data.evidence.map((e: any) => e.content), ["当前来源事实"]);
      return navigation(input, "当前来源事实");
    } };
    const first = await f.query(); assert.equal(first.indexVersion, captured); assert.equal(first.answer, "当前来源事实");
    assert.equal(internal.generation(f.scope), generation + 1, "only the explicit test scan advanced the generation");
    const latest = await f.query(); assert.equal(latest.indexVersion, f.tree.snapshot(f.workspace.id).version); assert.ok(latest.indexVersion! > captured);
  } finally { await f.close(); }
});
test("direct references do not depend on rereading or rediscovering MEMORY.md", async () => {
  const f = await fixture(); try {
    rmSync(join(memoryDirectory(f.root, f.scope.sessionId), "MEMORY.md"));
    f.memories.runner = { close: async () => {}, execute: async input => navigation(input) };
    const result = await f.query(); assert.equal(result.incomplete, false); assert.equal(result.answer, "原文验证通过");
  } finally { await f.close(); }
});
for (const change of ["source", "detail"] as const) test(`already-read ${change} edits do not discard the frozen answer`, async () => {
  const f = await fixture(); try {
    f.memories.runner = { close: async () => {}, execute: async input => {
      if (JSON.parse(input.prompt).evidence) {
        if (change === "source") f.write(f.scope, "# [Completed] 已修改目的\n");
        else f.detail(f.scope, "稍后修订的新事实");
      }
      return navigation(input, "捕获时的事实");
    } };
    const result = await f.query(); assert.equal(result.answer, "捕获时的事实"); assert.equal(result.incomplete, false);
  } finally { await f.close(); }
});
for (const change of ["correction", "authorization", "revocation"] as const) test(`query still suppresses output after ${change}`, async () => {
  const f = await fixture(); try {
    f.memories.runner = { close: async () => {}, execute: async input => {
      if (JSON.parse(input.prompt).evidence) {
        if (change === "correction") await f.memories.correct(f.workspace.id, "当前来源事实");
        else if (change === "revocation") { f.write(f.scope, "# [In progress] 来源核验\n"); f.memories.scan(f.scope); }
        else f.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(f.workspace.id);
      }
      return navigation(input, "不可发布旧事实");
    } };
    const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, true);
  } finally { await f.close(); }
});
test("missing documents are skipped individually; all missing is a normal empty result", async () => {
  const f = await fixture(); try {
    const child = f.detail(f.scope, "仍可读取的子文档", "## [Completed] 验证结果"); f.memories.scan(f.scope);
    const root = memoryDirectory(f.root, f.scope.sessionId); rmSync(join(root, "details/来源核验.md"));
    let answers = 0; f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt); if (data.evidence) { answers++; assert.deepEqual(data.evidence.map((e: any) => e.content), ["仍可读取的子文档"]); }
      return navigation(input);
    } };
    assert.equal((await f.query()).incomplete, false); assert.equal(answers, 1);
    rmSync(join(root, child.path)); const empty = await f.query(); assert.equal(empty.answer, ""); assert.equal(empty.incomplete, false); assert.equal(answers, 1);
  } finally { await f.close(); }
});
for (const bytes of [Buffer.from("A\u0000B"), Buffer.from([0xff, 0xfe, 0x80])]) test(`non-text detail ${bytes.toString("hex")} is skipped, not synthesized or treated as execution failure`, async () => {
  const f = await fixture(); try {
    const directory = memoryDirectory(f.root, f.scope.sessionId), child = f.detail(f.scope, "可读依据", "## [Completed] 验证结果"); f.memories.scan(f.scope);
    writeFileSync(join(directory, "details/来源核验.md"), bytes);
    let answers = 0; f.memories.runner = { close: async () => {}, execute: async input => {
      const evidence = JSON.parse(input.prompt).evidence;
      if (evidence) { answers++; assert.deepEqual(evidence.map((e: any) => e.content), ["可读依据"]); }
      return navigation(input);
    } };
    assert.equal((await f.query()).incomplete, false); assert.equal(answers, 1);
    rmSync(join(directory, child.path)); const empty = await f.query(); assert.equal(empty.answer, ""); assert.equal(empty.incomplete, false); assert.equal(answers, 1);
  } finally { await f.close(); }
});
test("revoked filesystem read access suppresses an already captured answer", async t => {
  if (process.getuid?.() === 0 || process.platform === "win32") { t.skip("requires ordinary Unix filesystem permissions"); return; }
  const f = await fixture(), file = join(memoryDirectory(f.root, f.scope.sessionId), "details/来源核验.md");
  try {
    let answered = false; f.memories.runner = { close: async () => {}, execute: async input => {
      if (JSON.parse(input.prompt).evidence) { answered = true; chmodSync(file, 0o000); }
      return navigation(input, "不可发布的已撤权原文");
    } };
    const result = await f.query(); assert.equal(answered, true); assert.equal(result.answer, ""); assert.equal(result.incomplete, true);
  } finally { chmodSync(file, 0o600); await f.close(); }
});
for (const revoke of ["never", "before query", "during answer"] as const) test(`explicit linked task details retain their actual provenance and revocation: ${revoke}`, async () => {
  const f = await fixture(); try {
    const entry = "# [Completed] 来源核验\n## [Completed] 验证结果\n# [Completed] 其他目的\n## [Abandoned] ~~历史路线~~\n";
    f.write(f.scope, entry); const source = f.detail(f.scope, "[显式依据](其他目的/历史路线.md)"), linked = f.detail(f.scope, "历史路线失败依据", "## [Abandoned] ~~历史路线~~");
    f.memories.scan(f.scope); f.publish();
    const invalidate = () => { f.write(f.scope, entry.replace("# [Completed] 其他目的", "# [In progress] 其他目的")); f.memories.scan(f.scope); };
    if (revoke === "before query") invalidate();
    let answered = false; f.memories.runner = { close: async () => {}, execute: async input => {
      const evidence = JSON.parse(input.prompt).evidence;
      if (!evidence) return { answer: '["记忆事务 / 来源核验"]', incomplete: false };
      answered = true; assert.equal(evidence.length, 2);
      const actual = evidence.find((e: any) => e.content === "历史路线失败依据");
      assert.equal(actual.heading, "历史路线"); assert.equal(actual.state, "已放弃"); assert.deepEqual(actual.purposes, ["其他目的"]); assert.equal(actual.linkedFrom, source.path);
      if (revoke === "during answer") invalidate();
      return { answer: "有原始状态的依据", incomplete: false };
    } };
    const result = await f.query(); assert.equal(answered, revoke !== "before query"); assert.equal(result.incomplete, revoke !== "never");
    if (revoke === "never") { assert.equal(result.answer, "有原始状态的依据"); assert.ok(result.readDocuments?.some(document => document.path === linked.path)); }
    else assert.equal(result.answer, "");
  } finally { await f.close(); }
});
test("matching a documentless parent expands descendant documents and answers only from evidence", async () => {
  const f = await fixture(); try {
    let calls = 0; f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; const evidence = JSON.parse(input.prompt).evidence;
      if (!evidence) return { answer: '["记忆事务"]', incomplete: false };
      assert.deepEqual(evidence.map((e: any) => e.content), ["当前来源事实"]);
      return { answer: "来自后代原文", incomplete: false };
    } };
    const result = await f.query(); assert.equal(result.answer, "来自后代原文"); assert.equal(result.incomplete, false); assert.equal(calls, 2);
  } finally { await f.close(); }
});
test("same full path merges navigation, keeps both source files and audit bindings, no short numbers", async () => {
  const f = await fixture(); try {
    const second = f.create("第二来源独立依据 /project/current.md", "来源核验"); f.publish();
    const snapshot = f.tree.nodeSnapshot(f.workspace.id); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      calls++; const data = JSON.parse(input.prompt), candidates = matchingCandidates(input);
      if (candidates) {
        assert.equal(candidates.filter(c => c.text === "来源核验").length, 1);
        for (const id of [...snapshot.purposes.map(p => p.id), f.scope.sessionId, second.sessionId]) assert.ok(!input.prompt.includes(id));
        assert.ok(!input.prompt.includes("details/")); assert.equal((input as any).candidateBindings, undefined);
        return { answer: '["记忆事务 / 来源核验"]', incomplete: false };
      }
      assert.equal(data.evidence.length, 2); return navigation(input, "保留两个独立来源");
    } };
    const result = await f.query(); assert.equal(result.answer, "保留两个独立来源"); assert.equal(calls, 2); assert.equal(result.readDocuments?.length, 2);
    const row = f.store.db.prepare("SELECT body FROM processing_records WHERE kind='memory.query'").get()!;
    const audit = JSON.parse(String(row.body)).calls.map((call: any) => JSON.parse(call.input.text)).find((input: any) => input.candidateBindings);
    assert.equal(JSON.parse(audit.prompt).catalog, "目录：\n记忆事务\n  来源核验");
    assert.equal(audit.candidateBindings.find((binding: any) => binding.titlePath === "记忆事务 / 来源核验").purposeIds.length, 2);
    assert.equal(audit.candidateBindings[0].number, undefined); assert.deepEqual(f.tree.nodeSnapshot(f.workspace.id), snapshot);
  } finally { await f.close(); }
});
test("only [] is a valid empty match; malformed, forged, ambiguous and repeated paths fail", async () => {
  const f = await fixture(); try {
    for (const answer of ["", "not JSON", "{}", '["forged"]', '["来源核验"]', '["记忆事务/来源核验"]', "[0]", "[null]", "[true]", '["记忆事务","记忆事务"]', "[]"]) {
      f.memories.runner = { close: async () => {}, execute: async () => ({ answer, incomplete: false }) };
      const result = await f.query(); assert.equal(result.answer, ""); assert.equal(result.incomplete, answer !== "[]");
    }
  } finally { await f.close(); }
});
test("actual runner failures remain failures rather than no-match", async () => {
  const f = await fixture(); try {
    f.memories.runner = { close: async () => {}, execute: async () => { throw Error("injected provider failure"); } };
    const result = await f.query(); assert.equal(result.incomplete, true); assert.equal(result.reason, "unavailable");
  } finally { await f.close(); }
});
test("paging still rejects revisions mixed during a single document read", async () => {
  const f = await fixture(); try {
    const detail = f.detail(f.scope, "旧".repeat(20000)), read = f.memories.read.bind(f.memories);
    f.memories.read = (...args) => { const page = read(...args); if (args[1] === detail.path && args[2] === 0) f.detail(f.scope, "新".repeat(20000)); return page; };
    f.memories.runner = { close: async () => {}, execute: async input => navigation(input) };
    const result = await f.query(); assert.equal(result.reason, "revision_conflict"); assert.equal(result.incomplete, true);
  } finally { await f.close(); }
});
for (const action of ["cancel", "timeout", "close"] as const) test(`query promptly settles ${action} when runner ignores cancellation`, async () => {
  const f = await fixture(); let release!: () => void, enter!: () => void;
  const gate = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { enter = r; }), alive = setInterval(() => {}, 1000);
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
