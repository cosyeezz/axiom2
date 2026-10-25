import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { PooledMemoryRunner } from "../src/server/memory-runner.js";
import { ModelService } from "../src/server/model-service.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { memoryBatchWaitMs } from "../src/shared/memory-tree.js";
import { purposeFixture, selection, classification, navigation } from "./memory-purpose-fixture.js";

test("read/save preserves BOM and CRLF and detects raw-byte conflicts", async () => {
  const f = purposeFixture(); const scope = f.create(), entry = join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# [In progress] 第一行\r\n## [Not started] emoji 😀\r\n")]);
  try {
    writeFileSync(entry, bytes); const document = f.memories.read(scope); assert.equal(document.content, "# [In progress] 第一行\r\n## [Not started] emoji 😀\r\n");
    f.memories.save(scope, "MEMORY.md", document.revision, document.content); assert.deepEqual(readFileSync(entry), bytes);
    writeFileSync(entry, Buffer.concat([bytes, Buffer.from("并发修改")])); assert.throws(() => f.memories.save(scope, "MEMORY.md", document.revision, document.content), { code: "REVISION_CONFLICT" });
  } finally { await f.close(); }
});
test("classification rejects model write suggestions and never sends full detail bodies", async () => {
  const f = purposeFixture(); try {
    const scope = f.create(); f.detail(scope, "OLD" + "详情".repeat(10000)); f.memories.scan(scope); const entry = join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), bytes = readFileSync(entry); let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async input => { calls++; assert.ok(!input.prompt.includes("OLD")); return { answer: JSON.stringify([{ name: "事务发布", children: JSON.parse(input.prompt).purposes.map((p: any) => ({ purposeId: p.id })), edits: [{ oldText: "OLD", newText: "NEW" }] }]), incomplete: false }; } };
    await assert.rejects(f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal)); assert.equal(calls, 1); assert.deepEqual(readFileSync(entry), bytes); assert.equal(f.tree.snapshot(f.workspace.id).roots.length, 0);
  } finally { await f.close(); }
});
test("cross-revision entry paging isolates an invalid purpose before any classification request", async () => {
  const f = purposeFixture(); try {
    const large = "# [Completed] 大树\n" + Array.from({ length: 400 }, (_, i) => `## [Completed] 步骤${i}${"字".repeat(40)}`).join("\n");
    const scope = f.create(large); f.memories.scan(scope); const entry = join(memoryDirectory(f.root, scope.sessionId), "MEMORY.md"), read = f.memories.read.bind(f.memories); let calls = 0;
    f.memories.read = (...args) => { const page = read(...args); if (args[3] === 16000 && args[2] === 0) writeFileSync(entry, large.replaceAll("字", "变")); return page; };
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; return { answer: "[]", incomplete: false }; } };
    await f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal); assert.equal(calls, 0); assert.equal(f.tree.entries(f.workspace.id)[0].blocked, true); assert.equal(f.tree.snapshot(f.workspace.id).roots.length, 0);
  } finally { await f.close(); }
});
for (const change of ["delete", "revoke", "rewrite", "revoke-delete"] as const) test(`query checks authority but retains captured evidence after external ${change}`, async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection }); const scope = f.create(), attachment = join(f.root, "attachments", f.workspace.id, scope.sessionId); mkdirSync(attachment, { recursive: true });
    const external = join(attachment, "basis.md"); writeFileSync(external, "v1"); const d = f.detail(scope, `[依据](${external})`); f.memories.scan(scope); f.publish();
    let answers = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt); if (data.evidence) {
        answers++; assert.ok(data.evidence.some((e: any) => e.content === "v1"));
        if (change === "delete") rmSync(external);
        else if (change.startsWith("revoke")) { const details = join(memoryDirectory(f.root, scope.sessionId), d.path); writeFileSync(details, readFileSync(details, "utf8").replace(`[依据](${external})`, "撤销引用")); if (change === "revoke-delete") rmSync(external); }
        else writeFileSync(external, "v2");
      }
      return navigation(input, `捕获的v1 ${d.path}`);
    } };
    const result = await f.memories.query(scope, "依据"); assert.equal(answers, 1, "the external file must actually have been read before changing it");
    assert.equal(result.incomplete, change.startsWith("revoke"));
    assert.equal(result.answer, change.startsWith("revoke") ? "" : `捕获的v1 ${d.path}`);
  } finally { await f.close(); }
});
for (const fault of ["nul", "invalid-utf8", "unreadable"] as const) test(`unrelated ${fault} declaration does not hide a valid external reference`, async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection }); const scope = f.create(), directory = memoryDirectory(f.root, scope.sessionId);
    const attachment = join(f.root, "attachments", f.workspace.id, scope.sessionId); mkdirSync(attachment, { recursive: true });
    const external = join(attachment, "basis.md"); writeFileSync(external, "EXTERNAL_VALID"); f.detail(scope, `[依据](${external})`);
    const bad = join(directory, "references", "unrelated.md"); mkdirSync(join(directory, "references"), { recursive: true }); writeFileSync(bad, "unrelated");
    f.memories.scan(scope); f.publish();
    if (fault === "unreadable") chmodSync(bad, 0);
    else writeFileSync(bad, fault === "nul" ? Buffer.from([65, 0, 66]) : Buffer.from([0xff, 0xfe]));
    let answers = 0;
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt); if (data.evidence) { answers++; assert.ok(data.evidence.some((e: any) => e.content === "EXTERNAL_VALID")); }
      return navigation(input, "有效外部依据");
    } };
    const result = await f.memories.query(scope, "依据");
    assert.equal(answers, 1); assert.equal(result.incomplete, false); assert.equal(result.answer, "有效外部依据"); assert.equal(result.readDocuments?.length, 2);
  } finally { await f.close(); }
});
for (const timing of ["before-read", "between-pages"] as const) test(`external alias switch ${timing} cannot detach authority from captured bytes`, async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection }); const scope = f.create(), directory = memoryDirectory(f.root, scope.sessionId);
    const attachment = join(f.root, "attachments", f.workspace.id, scope.sessionId); mkdirSync(attachment, { recursive: true });
    const a = join(attachment, "a.md"), b = join(attachment, "b.md"), alias = join(attachment, "alias.md");
    writeFileSync(a, timing === "between-pages" ? "same".repeat(5000) : "BODY_A");
    writeFileSync(b, timing === "between-pages" ? "same".repeat(5000) : "BODY_B"); symlinkSync(a, alias);
    const d = f.detail(scope, `[别名](${alias}) [保留A](${a})`); f.memories.scan(scope); f.publish();
    const aliasPath = relative(directory, alias).replaceAll("\\", "/"), originalRead = f.memories.read.bind(f.memories); let switched = false, answers = 0;
    const swap = () => { rmSync(alias); symlinkSync(b, alias); switched = true; };
    f.memories.read = (...args) => {
      if (args[1] === aliasPath && !switched && timing === "before-read") swap();
      const page = originalRead(...args);
      if (args[1] === aliasPath && !switched && timing === "between-pages") swap();
      return page;
    };
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt); if (data.evidence) {
        answers++; assert.ok(data.evidence.some((e: any) => e.content === "BODY_B"));
        const detail = join(directory, d.path); writeFileSync(detail, readFileSync(detail, "utf8").replace(`[别名](${alias})`, "撤销B的别名授权"));
      }
      return navigation(input, "不可发布的B正文");
    } };
    const result = await f.memories.query(scope, "依据");
    assert.equal(switched, true); assert.equal(answers, timing === "before-read" ? 1 : 0);
    assert.equal(result.incomplete, true); assert.equal(result.answer, "");
  } finally { await f.close(); }
});
test("pooled direct API isolates classification/navigation/evidence, uses no tools and only system+user", { timeout: 60000 }, async () => {
  const f = purposeFixture(), pi = join(f.root, "pi"), previous = process.env.AXIOM_PI_DIR; mkdirSync(pi); process.env.AXIOM_PI_DIR = pi; const payloads: any[] = [];
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part; const payload = JSON.parse(raw); payloads.push(payload);
    const data = JSON.parse(payload.messages.find((m: any) => m.role === "user").content);
    const content = data.purposes ? classification({ prompt: JSON.stringify(data) }).answer : navigation({ prompt: JSON.stringify(data) }, "已读取完整依据。").answer;
    response.writeHead(200, { "Content-Type": "text/event-stream" }); response.end(`data: ${JSON.stringify({ id: "memory", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, models: [{ id: "fixture", cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }] } } })); writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  const runner = new PooledMemoryRunner(f.memories, new ModelService(f.root)); f.memories.runner = runner;
  try {
    await f.configure({ queryModel: selection }); const scope = f.create(), directory = memoryDirectory(f.root, scope.sessionId); f.detail(scope, "DETAIL_SENTINEL [依据](../references/basis.md)"); mkdirSync(join(directory, "references"), { recursive: true }); writeFileSync(join(directory, "references/basis.md"), "字".repeat(20000)); f.memories.scan(scope);
    await f.memories.pipeline.organize(f.tree.batch(f.workspace.id, Date.now() + memoryBatchWaitMs), selection, new AbortController().signal); assert.equal(payloads.length, 1);
    const result = await f.memories.query(scope, "读取情况"); assert.equal(result.answer, "已读取完整依据。"); assert.equal(payloads.length, 3); assert.equal(result.readDocuments?.length, 2);
    for (const payload of payloads) { assert.ok(!payload.tools?.length); assert.deepEqual(payload.messages.map((m: any) => m.role), ["system", "user"]); }
    for (const payload of payloads.slice(0, -1)) assert.ok(!JSON.stringify(payload).includes("DETAIL_SENTINEL")); assert.ok(JSON.stringify(payloads.at(-1)).includes("DETAIL_SENTINEL"));
    for (const payload of payloads.slice(1, -1)) {
      const user = JSON.parse(payload.messages[1].content);
      assert.equal(typeof user.catalog, "string"); assert.ok(user.catalog.startsWith("目录：\n")); assert.equal(user.candidates, undefined);
      assert.ok(!JSON.stringify(payload).includes("candidateBindings"));
      assert.ok(!JSON.stringify(user).includes(scope.sessionId));
      assert.ok(!JSON.stringify(user).includes("details/"));
      for (const purpose of f.tree.snapshot(f.workspace.id).purposes) assert.ok(!JSON.stringify(user).includes(purpose.id));
    }
  } finally {
    await runner.close(); await f.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
