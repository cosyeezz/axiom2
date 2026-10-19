import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { test } from "node:test";
import { Store } from "../src/server/storage.js";
import { Memories, type MemoryExecution, type MemoryRunner } from "../src/server/memories.js";
import { PooledMemoryRunner } from "../src/server/memory-runner.js";
import { ModelService } from "../src/server/model-service.js";
import { digest, memoryDirectory } from "../src/server/memory-files.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-io-"));
  const project = mkdtempSync(join(tmpdir(), "axiom-memory-io-project-"));
  const store = new Store(root);
  const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const memories = new Memories(store, () => {});
  const entry = join(memoryDirectory(root, scope.sessionId), "MEMORY.md");
  const configure = (values: Record<string, unknown>) => memories.command({ requestId: randomUUID(), op: "memory.configure", ...scope, params: values });
  return { root, project, store, scope, memories, entry, configure, async close() { await memories.close(); store.close(); rmSync(root, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); } };
}

function organizer(read: (input: MemoryExecution) => void, evidence = "MEMORY.md"): MemoryRunner {
  return { close: async () => {}, execute: async (input) => {
    read(input);
    return { answer: JSON.stringify({ title: "已核实", summary: "连续读取的资料", keywords: ["分页"], edits: [{ path: "MEMORY.md", oldText: "OLD", newText: "NEW", evidence: [evidence], reason: "已完整读取当前资料" }] }), incomplete: false };
  } };
}

test("Memories read/save retains BOM and CRLF while detecting raw-byte revision conflicts", async () => {
  const f = fixture();
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("第一行\\r\\nemoji 😀\\r\\n", "utf8")]);
  try {
    writeFileSync(f.entry, bytes);
    const document = f.memories.read(f.scope);
    assert.equal(document.content, "第一行\\r\\nemoji 😀\\r\\n");
    f.memories.save(f.scope, "MEMORY.md", document.revision, document.content);
    assert.deepEqual(readFileSync(f.entry), bytes);
    writeFileSync(f.entry, Buffer.concat([bytes, Buffer.from("并发修改", "utf8")]));
    assert.throws(() => f.memories.save(f.scope, "MEMORY.md", document.revision, document.content), { code: "REVISION_CONFLICT" });
  } finally { await f.close(); }
});

test("organizer edits a long source only after contiguous pages from zero to EOF", async () => {
  const f = fixture();
  try {
    const evidence = join(f.project, "verified.md"); writeFileSync(evidence, "同一范围的外部依据");
    const source = `[依据](<${evidence}>)\n${"前缀".repeat(8_100)}OLD${"尾部".repeat(8_100)}`;
    writeFileSync(f.entry, source);
    f.configure({ organizerModel: selection });
    f.memories.runner = organizer((input) => {
      let offset = 0, pages = 0;
      while (true) {
        const page = input.read(f.scope.sessionId, "MEMORY.md", offset, 16_000); pages++;
        if (page.nextOffset === null) break;
        assert.equal(page.nextOffset, offset + 16_000); offset = page.nextOffset;
      }
      assert.ok(pages > 2, "fixture must exercise more than two 16k pages");
      assert.equal(input.read(f.scope.sessionId, evidence).content, "同一范围的外部依据");
    }, evidence);
    await f.memories.organize();
    assert.equal(readFileSync(f.entry, "utf8").includes("NEW"), true, f.memories.catalog(f.scope.workspaceId)[0]?.error);
    assert.equal(readFileSync(f.entry, "utf8").includes("OLD"), false);
  } finally { await f.close(); }
});

test("organizer rejects tail-only, gapped, and cross-revision long-document edits", async () => {
  for (const mode of ["tail", "gap", "changed"] as const) {
    const f = fixture();
    try {
      const evidence = join(f.project, "verified.md"); writeFileSync(evidence, "同一范围的外部依据");
      writeFileSync(f.entry, `[依据](<${evidence}>)\n${"前缀".repeat(8_100)}OLD${"尾部".repeat(8_100)}`);
      f.configure({ organizerModel: selection });
      let called = false;
      f.memories.runner = organizer((input) => {
        called = true;
        if (mode === "tail") input.read(f.scope.sessionId, "MEMORY.md", 16_000, 16_000);
        else {
          const first = input.read(f.scope.sessionId, "MEMORY.md", 0, 16_000);
          if (mode === "changed") writeFileSync(f.entry, `${readFileSync(f.entry, "utf8")}并发变更`);
          input.read(f.scope.sessionId, "MEMORY.md", mode === "gap" ? first.nextOffset! + 1 : first.nextOffset!, 16_000);
        }
      }, evidence);
      await f.memories.organize();
      assert.equal(called, true, `${mode} must reach the organizer before evidence is rejected`);
      assert.equal(readFileSync(f.entry, "utf8").includes("NEW"), false, `${mode} coverage must not authorize an edit`);
    } finally { await f.close(); }
  }
});

test("query cache decodes a revision once, then invalidates changed or deleted files", async () => {
  const f = fixture();
  const original = globalThis.TextDecoder;
  try {
    writeFileSync(f.entry, "可查询资料 ".repeat(4_000));
    f.configure({ queryModel: selection });
    await f.memories.scanAsync(f.scope);
    let decodes = 0;
    class CountingDecoder extends original { override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions) { decodes++; return super.decode(input, options); } }
    (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = CountingDecoder;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      const first = input.read(f.scope.sessionId, "MEMORY.md", 0, 16_000);
      input.read(f.scope.sessionId, "MEMORY.md", first.nextOffset!, 16_000);
      return { answer: "已读取", incomplete: false };
    } };
    await f.memories.query(f.scope, "可查询资料");
    assert.equal(decodes, 1, "one request must reuse its decoded snapshot for later pages");
    (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = original;
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      input.read(f.scope.sessionId, "MEMORY.md");
      writeFileSync(f.entry, "已替换的资料");
      assert.throws(() => input.read(f.scope.sessionId, "MEMORY.md"), { code: "REVISION_CONFLICT" });
      return { answer: "不应发布", incomplete: false };
    } };
    const changed = await f.memories.query(f.scope, "可查询资料");
    assert.equal(changed.answer, ""); assert.equal(changed.incomplete, true); assert.equal(changed.reason, "revision_conflict");
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      rmSync(f.entry);
      assert.throws(() => input.read(f.scope.sessionId, "MEMORY.md"));
      return { answer: "不应发布", incomplete: false };
    } };
    const unreadable = await f.memories.query(f.scope, "已替换的资料");
    assert.equal(unreadable.answer, ""); assert.equal(unreadable.incomplete, true); assert.ok(unreadable.reason);
  } finally { (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = original; await f.close(); }
});

test("PooledMemoryRunner suppresses image base64 and invalidates a result after worker revision RPC", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-io-runner-"));
  const project = join(root, "project"), pi = join(root, "pi");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  mkdirSync(project); mkdirSync(pi);
  const payloads: string[] = [];
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part;
    payloads.push(raw);
    const value = JSON.parse(raw), hasTool = value.messages.some((message: { role: string }) => message.role === "tool");
    const sessionId = raw.match(/\\"sessionId\\":\\"([^\\"]+)/)?.[1] ?? "";
    const delta = hasTool
      ? { role: "assistant", content: "已读取图片资料。" }
      : { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "memory_read", arguments: JSON.stringify({ sessionId, path: "references/pic.png" }) } }] };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "memory", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: hasTool ? "stop" : "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider = { api: "openai-completions", baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, models: [{ id: "fixture", cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }] };
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: provider } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  const store = new Store(root), memories = new Memories(store, () => {}), runner = new PooledMemoryRunner(memories, new ModelService(root));
  try {
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
    const references = join(memoryDirectory(root, scope.sessionId), "references"); mkdirSync(references);
    writeFileSync(join(references, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const readOptions: boolean[] = [];
    const input = (revision: () => string): MemoryExecution => ({ scope, kind: "query", selection, prompt: JSON.stringify(scope), read: (sessionId, path, offset, limit, options) => {
      readOptions.push(options?.includeImage === false);
      return memories.read({ workspaceId: scope.workspaceId, sessionId }, path, offset, limit, options);
    }, revision: () => revision() });
    const expected = digest(readFileSync(join(references, "pic.png")));
    assert.equal((await runner.execute(input(() => expected))).incomplete, false);
    assert.deepEqual(readOptions, [true], "worker must explicitly request image metadata without base64");
    assert.ok(payloads.every((raw) => !raw.includes("data:image/")), "provider payload must never contain discarded image base64");
    await assert.rejects(runner.execute(input(() => "changed-after-read")), /作废|变化/);
  } finally {
    await runner.close(); await memories.close(); store.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
