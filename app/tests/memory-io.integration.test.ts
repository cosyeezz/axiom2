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
import { memorySummaryVersion } from "../src/shared/memory.js";
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

function indexSources(f: ReturnType<typeof fixture>) {
  f.memories.scan();
  for (const entry of f.memories.catalog(f.scope.workspaceId)) {
    if (entry.hasContent && !entry.reason) f.store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...entry, status: "ready", summaryVersion: memorySummaryVersion, summary: "可查询资料", indexedAt: Date.now() }), entry.sessionId);
  }
}

function organizer(read: (input: MemoryExecution) => void): MemoryRunner {
  return { close: async () => {}, execute: async (input) => {
    read(input);
    return { answer: JSON.stringify({ title: "已核实", summary: "连续读取的资料", keywords: ["分页"], edits: [{ path: "MEMORY.md", oldText: "OLD", newText: "NEW", evidence: ["MEMORY.md"], reason: "模型额外字段不能获得写权限" }] }), incomplete: false };
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

test("organizer summarizes contiguous pages from zero to EOF and never applies suggested edits", async (t) => {
  const f = fixture();
  try {
    const source = `${"前缀".repeat(8_100)}OLD${"尾部".repeat(8_100)}`;
    writeFileSync(f.entry, source);
    f.memories.scan(); t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * 60_000 });
    f.configure({ organizerModel: selection });
    f.memories.runner = organizer((input) => {
      let offset = 0, pages = 0;
      while (true) {
        const page = input.read(f.scope.sessionId, "MEMORY.md", offset, 16_000); pages++;
        if (page.nextOffset === null) break;
        assert.equal(page.nextOffset, offset + 16_000); offset = page.nextOffset;
      }
      assert.ok(pages > 2, "fixture must exercise more than two 16k pages");
    });
    await f.memories.organize();
    assert.equal(f.memories.catalog(f.scope.workspaceId)[0]?.status, "ready", f.memories.catalog(f.scope.workspaceId)[0]?.error);
    assert.equal(readFileSync(f.entry, "utf8"), source, "摘要生成只写索引");
  } finally { await f.close(); }
});

test("organizer rejects tail-only, gapped, and cross-revision long-document summaries", async (t) => {
  for (const mode of ["tail", "gap", "changed"] as const) {
    const f = fixture();
    try {
      writeFileSync(f.entry, `${"前缀".repeat(8_100)}OLD${"尾部".repeat(8_100)}`);
      f.memories.scan(); t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 30 * 60_000 });
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
      });
      await f.memories.organize();
      assert.equal(called, true, `${mode} must reach the organizer before evidence is rejected`);
      assert.notEqual(f.memories.catalog(f.scope.workspaceId)[0]?.status, "ready", `${mode} coverage must not authorize a summary`);
      assert.equal(readFileSync(f.entry, "utf8").includes("NEW"), false);
    } finally { t.mock.timers.reset(); await f.close(); }
  }
});

test("query cache decodes a revision once, then invalidates changed or deleted files", async () => {
  const f = fixture();
  const original = globalThis.TextDecoder;
  try {
    writeFileSync(f.entry, "可查询资料 ".repeat(4_000));
    f.configure({ queryModel: selection });
    await f.memories.scanAsync(f.scope); indexSources(f);
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
    indexSources(f);
    f.memories.runner = { close: async () => {}, execute: async (input) => {
      rmSync(f.entry);
      assert.throws(() => input.read(f.scope.sessionId, "MEMORY.md"));
      return { answer: "不应发布", incomplete: false };
    } };
    const unreadable = await f.memories.query(f.scope, "已替换的资料");
    assert.equal(unreadable.answer, ""); assert.equal(unreadable.incomplete, true); assert.ok(unreadable.reason);
  } finally { (globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = original; await f.close(); }
});

test("PooledMemoryRunner protects image reads, revision evidence, query failures and organizer budgets", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-memory-io-runner-"));
  const project = join(root, "project"), pi = join(root, "pi");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  mkdirSync(project); mkdirSync(pi);
  const payloads: string[] = [];
  let mode: "image" | "missing" | "budget" = "image", readSessionId = "";
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part;
    payloads.push(raw);
    const value = JSON.parse(raw), toolCount = value.messages.filter((message: { role: string }) => message.role === "tool").length;
    const sessionId = raw.match(/\\"sessionId\\":\\"([^\\"]+)/)?.[1] ?? readSessionId;
    const done = toolCount > 0 && (mode !== "budget" || toolCount >= 2);
    const delta = done
      ? { role: "assistant", content: mode === "budget" ? JSON.stringify({ title: "预算测试", summary: "尝试读取完整来源" }) : "已读取资料。" }
      : { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "memory_read", arguments: JSON.stringify({ sessionId, path: mode === "image" ? "references/pic.png" : mode === "missing" ? "references/missing.md" : "MEMORY.md", offset: toolCount ? 16000 : 0 }) } }] };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "memory", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: done ? "stop" : "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
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

    readSessionId = scope.sessionId;
    mode = "missing";
    memories.runner = runner;
    await memories.command({ requestId: randomUUID(), op: "memory.configure", ...scope, params: { queryModel: selection, organizerModel: selection, readChars: 16000 } });
    const entryPath = join(memoryDirectory(root, scope.sessionId), "MEMORY.md");
    writeFileSync(entryPath, "有摘要，但所请求的专题文件缺失");
    await memories.scanAsync(scope);
    const source = memories.catalog(scope.workspaceId)[0]!;
    store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...source, status: "ready", summaryVersion: memorySummaryVersion, summary: "可查询资料" }), scope.sessionId);
    const failed = await memories.query(scope, "请读取专题文件");
    assert.equal(failed.answer, ""); assert.deepEqual(failed.sources, []);
    assert.equal(failed.incomplete, true); assert.equal(failed.reason, "read_failed");

    mode = "budget";
    writeFileSync(entryPath, "字".repeat(16000));
    await memories.scanAsync(scope);
    const pending = memories.catalog(scope.workspaceId)[0]!;
    store.db.prepare("UPDATE memory_sources SET body=? WHERE sessionId=?").run(JSON.stringify({ ...pending, updatedAt: Date.now() - 30 * 60_000 }), scope.sessionId);
    let promptChars = 0, bodyChars = 0;
    memories.runner = { close: async () => {}, execute: (input) => {
      promptChars = input.prompt.length;
      return runner.execute({ ...input, read: (...args) => { const document = input.read(...args); bodyChars += document.content.length; return document; } });
    } };
    await memories.organize();
    assert.ok(promptChars > 0);
    assert.equal(promptChars + bodyChars, 16000, "整理提示和正文共用累计读取额度");
    const incomplete = memories.catalog(scope.workspaceId)[0]!;
    assert.equal(incomplete.status, "error"); assert.equal(incomplete.summary, "");
    assert.match(incomplete.error!, /读取字符预算已到/);
  } finally {
    await runner.close(); await memories.close(); store.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
