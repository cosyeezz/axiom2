import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
for (const change of ["delete", "revoke", "rewrite"] as const) test(`query rejects ${change} of external evidence before publication`, async () => {
  const f = purposeFixture(); try {
    await f.configure({ queryModel: selection }); const scope = f.create(), external = join(f.project, "basis.md"); writeFileSync(external, "v1"); const d = f.detail(scope, `[依据](${external})`); f.memories.scan(scope); f.publish();
    f.memories.runner = { close: async () => {}, execute: async input => {
      const data = JSON.parse(input.prompt); if (data.evidence) {
        assert.ok(data.evidence.some((e: any) => e.content === "v1"));
        if (change === "delete") rmSync(external);
        else if (change === "revoke") { const details = join(memoryDirectory(f.root, scope.sessionId), d.path); writeFileSync(details, readFileSync(details, "utf8").replace(`[依据](${external})`, "撤销引用")); }
        else writeFileSync(external, "v2");
      }
      return navigation(input, `不应发布的v1 ${d.path}`);
    } };
    const result = await f.memories.query(scope, "依据"); assert.equal(result.answer, ""); assert.equal(result.incomplete, true);
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
    const result = await f.memories.query(scope, "读取情况"); assert.equal(result.answer, "已读取完整依据。"); assert.equal(payloads.length, 5); assert.equal(result.readDocuments?.length, 3);
    for (const payload of payloads) { assert.ok(!payload.tools?.length); assert.deepEqual(payload.messages.map((m: any) => m.role), ["system", "user"]); }
    for (const payload of payloads.slice(0, -1)) assert.ok(!JSON.stringify(payload).includes("DETAIL_SENTINEL")); assert.ok(JSON.stringify(payloads.at(-1)).includes("DETAIL_SENTINEL"));
    for (const payload of payloads.slice(1, -1)) {
      const user = JSON.parse(payload.messages[1].content);
      assert.ok(Array.isArray(user.catalog)); assert.equal(user.candidates, undefined);
      assert.ok(!JSON.stringify(payload).includes("candidateBindings"));
      assert.ok(!JSON.stringify(user).includes(scope.sessionId));
      assert.ok(!JSON.stringify(user).includes("details/"));
      for (const purpose of f.tree.snapshot(f.workspace.id).purposes) assert.ok(!JSON.stringify(user).includes(purpose.id));
    }
  } finally {
    await runner.close(); await f.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
