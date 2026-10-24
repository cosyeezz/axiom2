// Real product workers and a loopback model only; independent title requests have no main history/tools.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import { running } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
const wait = async (check: () => boolean, label: string) => {
  const deadline = Date.now() + 25000;
  while (!check()) { if (Date.now() > deadline) throw Error(label); await new Promise(resolve => setTimeout(resolve, 20)); }
};
type Request = { body: { messages: { role: string; content: unknown }[]; tools?: unknown[] }; title: boolean; res: ServerResponse; finish: (text: string) => void; tool: () => void };
test("independent titles: real worker cadence, memory and details, no main-context pollution, manual priority", { timeout: 120000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-title-generation-")), project = join(root, "project"), pi = join(root, "pi");
  const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  const requests: Request[] = [];
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    const chunk = (delta: unknown, finish_reason: string | null = null) => {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    };
    requests.push({ body, res, title: JSON.stringify(body.messages).includes("只输出标题纯文本"),
      finish(text) { chunk({ role: "assistant", content: text }); chunk({}, "stop"); res.end("data: [DONE]\n\n"); },
      tool() { chunk({ role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: "read", arguments: JSON.stringify({ path: "context.txt" }) } }] }); chunk({}, "tool_calls"); res.end("data: [DONE]\n\n"); },
    });
  });
  t.after(async () => { try { await app?.close(); } finally { fixture.closeAllConnections(); if (fixture.listening) await new Promise<void>(resolve => fixture.close(() => resolve())); if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; rmSync(root, { recursive: true, force: true }); } });
  mkdirSync(project, { recursive: true }); mkdirSync(pi);
  writeFileSync(join(project, "context.txt"), "MAIN_TOOL_SENTINEL");
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { "title-fixture": { api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ "title-fixture": { type: "api_key", key: "loopback-only" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  app = await startServer({ root, port: 0 });
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const call = (scope: Scope, op: string, params: Record<string, unknown> = {}) => app!.agents.command({ ...scope, op, params, requestId: randomUUID() });
  const create = async () => {
    const session = app!.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    await call(scope, "agent.model", { selection: { provider: "title-fixture", id: "fixture", thinking: "off" } }); return scope;
  };
  const state = (scope: Scope) => app!.store.db.prepare("SELECT title,titleState FROM sessions WHERE id=?").get(scope.sessionId)!;
  const writeMemory = (scope: Scope) => {
    const dir = memoryDirectory(root, scope.sessionId); mkdirSync(join(dir, "references"), { recursive: true });
    // Keep the independent-title fixture out of the unfinished-task auto-continuation flow.
    writeFileSync(join(dir, "MEMORY.md"), "# 修复布局\n## [已完成] 窄屏修复 〔1〕");
    writeFileSync(join(dir, "references/details.md"), "<!-- detail:1:start -->\nDETAIL_ONE_SENTINEL\n<!-- detail:1:end -->\n<!-- detail:2:start -->\nUNRELATED_DETAIL_TWO\n<!-- detail:2:end -->\n");
  };
  const main = () => requests.filter(r => !r.title), titles = () => requests.filter(r => r.title);
  const nextMain = async (index: number) => { await wait(() => main().length > index, "main request missing"); return main()[index]; };
  const settled = async (scope: Scope) => { await wait(() => !running(app!.agents.info(scope).run), "main run did not settle"); assert.equal(app!.agents.info(scope).run!.status, "completed"); };
  const cleanMain = (request: Request) => { const text = JSON.stringify(request.body.messages); assert.ok(!text.includes("不超过10个字符")); assert.ok(!text.includes("会话标题已确定")); assert.ok(!text.includes("只输出标题纯文本")); };

  const scope = await create();
  await call(scope, "prompt", { text: "MAIN_USER_SENTINEL" });
  const first = await nextMain(0); cleanMain(first); assert.equal(titles().length, 0);
  writeMemory(scope); first.tool();
  const second = await nextMain(1); cleanMain(second); assert.equal(titles().length, 0); second.tool();
  const third = await nextMain(2); cleanMain(third);
  await wait(() => titles().length === 1, "third main call did not trigger title request");
  const titleRequest = titles()[0];
  assert.equal(titleRequest.body.messages.filter(m => m.role === "user").length, 1);
  assert.equal(titleRequest.body.messages.length, 2);
  assert.ok(!titleRequest.body.tools?.length);
  const material = JSON.stringify(titleRequest.body.messages);
  assert.ok(material.includes("DETAIL_ONE_SENTINEL")); assert.ok(!material.includes("UNRELATED_DETAIL_TWO"));
  assert.ok(!material.includes("MAIN_USER_SENTINEL") && !material.includes("MAIN_TOOL_SENTINEL"));
  third.finish("主任务完成，不等待标题。"); await settled(scope);
  assert.equal(state(scope).titleState, "pending", "main can settle while title is in flight");
  titleRequest.finish("一二三四五六七八九十甲乙丙");
  await wait(() => state(scope).titleState === "generated", "title not saved");
  assert.equal(state(scope).title, "一二三四五六七八九十甲乙丙");
  const file = app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file as string;
  const history = readFileSync(file, "utf8");
  const entries = history.trim().split("\n").map(line => JSON.parse(line));
  assert.ok(entries.every(entry => !["axiom-title", "axiom-title-settled"].includes(entry.customType)), "no naming protocol messages in main history");
  assert.ok(!history.includes("一二三四五六七八九十甲乙丙"));
  const costs = app.store.db.prepare("SELECT kind FROM memory_usage WHERE sessionId=?").all(scope.sessionId); assert.ok(costs.some(row => row.kind === "title"));
  await call(scope, "prompt", { text: "后续无需命名" }); const later = await nextMain(3); cleanMain(later); later.finish("完成"); await settled(scope); assert.equal(titles().length, 1);

  // End-of-round check when fewer than three requests; manual CAS still wins without any worker IPC.
  const manual = await create(); await call(manual, "prompt", { text: "手动优先" }); const request = await nextMain(4); writeMemory(manual); request.finish("完成"); await settled(manual);
  await wait(() => titles().length === 2, "settlement title missing");
  app.store.execute({ ...manual, op: "session.rename", requestId: randomUUID(), params: { title: "手动名称" } });
  titles()[1].finish("迟到模型标题"); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(state(manual).title, "手动名称"); assert.equal(state(manual).titleState, "manual");

  const empty = await create(); await call(empty, "prompt", { text: "空记忆" }); const noMemory = await nextMain(5); noMemory.finish("完成"); await settled(empty);
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(titles().length, 2); assert.equal(state(empty).titleState, "pending");
});
