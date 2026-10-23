import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { test } from "node:test";
import { Store } from "../src/server/storage.js";
import { Memories } from "../src/server/memories.js";
import { PooledMemoryRunner } from "../src/server/memory-runner.js";
import { ModelService } from "../src/server/model-service.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { topicId } from "../src/server/memory-tree.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
const record = { topic: "资料读取", section: "完整性验证", item: "读取结果", content: "完整读取已验证" };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-io-")), project = mkdtempSync(join(tmpdir(), "axiom-memory-io-project-"));
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, memories = new Memories(store, () => {});
  clearInterval((memories as any).timer); (memories as any).watcher?.close();
  const entry = join(memoryDirectory(root, scope.sessionId), "MEMORY.md");
  const configure = (values: Record<string, unknown>) => memories.command({ requestId: randomUUID(), op: "memory.configure", ...scope, params: values });
  return { root, project, store, scope, memories, entry, configure, async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); } };
}
test("Memories read/save retains BOM and CRLF while detecting raw-byte revision conflicts", async () => {
  const f = fixture(), bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("第一行\r\nemoji 😀\r\n", "utf8")]);
  try {
    writeFileSync(f.entry, bytes); const document = f.memories.read(f.scope); assert.equal(document.content, "第一行\r\nemoji 😀\r\n");
    f.memories.save(f.scope, "MEMORY.md", document.revision, document.content); assert.deepEqual(readFileSync(f.entry), bytes);
    writeFileSync(f.entry, Buffer.concat([bytes, Buffer.from("并发修改")]));
    assert.throws(() => f.memories.save(f.scope, "MEMORY.md", document.revision, document.content), { code: "REVISION_CONFLICT" });
  } finally { await f.close(); }
});
test("organizer receives all pages before its one request and rejects model write suggestions", async () => {
  const f = fixture(); try {
    const source = "前缀".repeat(8100) + "OLD" + "尾部".repeat(8100); writeFileSync(f.entry, source); f.memories.scan();
    let calls = 0;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      calls++; assert.equal(JSON.parse(input.prompt).currentFile.content, source);
      return { answer: JSON.stringify([{ ...record, edits: [{ oldText: "OLD", newText: "NEW" }] }]), incomplete: false };
    } };
    await assert.rejects(f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {}), /恰好包含/);
    assert.equal(calls, 1); assert.equal(readFileSync(f.entry, "utf8"), source); assert.equal(f.memories.tree(f.scope.workspaceId).topics.length, 0);
  } finally { await f.close(); }
});
test("cross-revision paging fails before the API receives partial evidence", async () => {
  const f = fixture(); try {
    writeFileSync(f.entry, "字".repeat(33000)); f.memories.scan();
    const read = f.memories.read.bind(f.memories); let calls = 0;
    f.memories.read = (...args) => { const page = read(...args); if (args[3] === 16000 && args[2] === 0) writeFileSync(f.entry, "变".repeat(33000)); return page; };
    f.memories.runner = { close: async () => {}, execute: async () => { calls++; return { answer: "[]", incomplete: false }; } };
    await assert.rejects(f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {}), /读取期间已变化/); assert.equal(calls, 0);
  } finally { await f.close(); }
});
for (const change of ["delete", "revoke", "rewrite"] as const) test(`query rejects ${change} of external evidence before publication`, async () => {
  const f = fixture(); try {
    await f.configure({ queryModel: selection }); const evidence = join(f.project, "basis.md"); writeFileSync(evidence, "v1");
    writeFileSync(f.entry, `[依据](${evidence})`); f.memories.scan(); const tree = f.memories.pipeline.tree;
    tree.publish(f.scope.workspaceId, { sessionId: f.scope.sessionId, path: "MEMORY.md", revision: f.memories.read(f.scope).revision, records: [], dependencies: [] }, [], [record], tree.signature(f.scope.workspaceId));
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      const data = JSON.parse(input.prompt); if (data.sections) return { answer: JSON.stringify([data.sections[0].id]), incomplete: false };
      assert.ok(data.documents.some((document: any) => document.content === "v1"));
      if (change === "delete") rmSync(evidence);
      else if (change === "revoke") writeFileSync(f.entry, "撤销引用");
      else writeFileSync(evidence, "v2");
      return { answer: "不应发布的v1", incomplete: false };
    } };
    const result = await f.memories.query(f.scope, "依据", undefined, undefined, topicId(record.topic));
    assert.equal(result.answer, ""); assert.equal(result.incomplete, true);
  } finally { await f.close(); }
});
test("pooled direct API performs one organization and two isolated query requests", { timeout: 60000 }, async () => {
  const f = fixture(), pi = join(f.root, "pi"), previous = process.env.AXIOM_PI_DIR; mkdirSync(pi); process.env.AXIOM_PI_DIR = pi;
  const payloads: any[] = [];
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part;
    const payload = JSON.parse(raw); payloads.push(payload);
    const data = JSON.parse(payload.messages.find((message: any) => message.role === "user").content);
    const content = data.sections ? JSON.stringify([data.sections[0].id]) : data.currentFile ? JSON.stringify([record]) : "已读取完整依据。";
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "memory", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, models: [{ id: "fixture", cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  const runner = new PooledMemoryRunner(f.memories, new ModelService(f.root)); f.memories.runner = runner;
  try {
    await f.configure({ queryModel: selection });
    const artifacts = join(memoryDirectory(f.root, f.scope.sessionId), "artifacts"); mkdirSync(artifacts);
    writeFileSync(join(artifacts, "basis.md"), "DETAIL_SENTINEL " + "字".repeat(20000));
    writeFileSync(f.entry, "MEMORY_SENTINEL [依据](artifacts/basis.md)"); f.memories.scan();
    await f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {});
    assert.equal(payloads.length, 1);
    const result = await f.memories.query(f.scope, "读取情况", undefined, undefined, topicId(record.topic));
    assert.equal(result.answer, "已读取完整依据。"); assert.equal(payloads.length, 3); assert.equal(result.readDocuments?.length, 2);
    for (const payload of payloads) {
      assert.ok(!payload.tools?.length); assert.deepEqual(payload.messages.map((message: any) => message.role), ["system", "user"]);
    }
    assert.ok(!JSON.stringify(payloads[1]).includes("DETAIL_SENTINEL")); assert.ok(JSON.stringify(payloads[2]).includes("DETAIL_SENTINEL"));
    await f.configure({ readChars: 16000 });
    await assert.rejects(f.memories.pipeline.organize(f.scope, selection, new AbortController().signal, () => {}, true), /读取预算/);
    assert.equal(payloads.length, 3, "oversized organization fails before an API request");
  } finally {
    await runner.close(); await f.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
