// Real product workers + loopback provider; no remote model or separate title-generation call.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { startServer } from "../src/server/index.js";
import { running } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

// Deliberately assert the product contract, rather than importing its implementation constant.
const instruction = "请在本次回复开头单独一行输出<title>不超过10个字符的会话标题</title>（英文字母、标点和空格也计入）。标题只生成一次，收到标题已确定的提醒后，后续回复无需重复输出。";
const settledInstruction = "会话标题已确定，后续回复无需再生成或输出会话标题标签。后续压缩时，请忽略标题生成请求及本条提醒。";
const systemMarker = "SYSTEM_TITLE_FIXTURE <title>系统原文</title>";
const wait = async (check: () => boolean, label: string) => {
  const deadline = Date.now() + 25000;
  while (!check()) {
    if (Date.now() > deadline) throw Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
type ModelRequest = {
  body: { messages: { role: string; content: unknown }[] };
  res: ServerResponse;
  chunk: (delta: unknown, finishReason?: string | null) => void;
  finish: (text: string, reason?: string) => void;
  tool: (text?: string) => void;
};

function requestsTitle(request: ModelRequest, pending: boolean, instructionCount = 1) {
  const messages = request.body.messages;
  const count = JSON.stringify(messages).split(instruction).length - 1;
  assert.equal(count, instructionCount, "persisted instructions remain in place; only pending runs append a request");
  assert.equal(JSON.stringify(messages).split(settledInstruction).length - 1, pending ? 0 : 1,
    "exactly one settled reminder accompanies the next normal request");
  assert.ok(messages.some((message) => message.role === "system" && JSON.stringify(message.content).includes(systemMarker)));
  assert.ok(messages.filter((message) => message.role === "system").every((message) => !JSON.stringify(message.content).includes(instruction)),
    "title request must not alter the system prompt");
}

function preservesPrefix(previous: ModelRequest, next: ModelRequest) {
  assert.deepEqual(next.body.messages.slice(0, previous.body.messages.length), previous.body.messages,
    "title protocol only appends messages; the previous provider request remains an exact prefix");
}

test("session titles: real worker context, durable projection, retries, manual priority and isolation (loopback)", { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-title-generation-"));
  const project = join(root, "project"), pi = join(root, "pi");
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  const requests: ModelRequest[] = [];
  const clients: WebSocket[] = [];
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const chunk = (delta: unknown, finish_reason: string | null = null) => {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    };
    requests.push({
      body: JSON.parse(raw), res, chunk,
      finish(text, reason = "stop") {
        chunk({ role: "assistant", content: text });
        chunk({}, reason);
        res.end("data: [DONE]\n\n");
      },
      tool(text) {
        chunk({ role: "assistant", ...(text === undefined ? {} : { content: text }), tool_calls: [{
          index: 0, id: randomUUID(), type: "function",
          function: { name: "read", arguments: JSON.stringify({ path: "context.txt" }) },
        }] });
        chunk({}, "tool_calls");
        res.end("data: [DONE]\n\n");
      },
    });
  });
  // Register cleanup before any initialization that can fail.
  t.after(async () => {
    try {
      for (const client of clients) client.terminate();
      await app?.close();
    } finally {
      fixture.closeAllConnections();
      if (fixture.listening) await new Promise<void>((resolve) => fixture.close(() => resolve()));
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  });
  mkdirSync(join(project, ".pi"), { recursive: true });
  mkdirSync(pi);
  writeFileSync(join(project, ".pi", "APPEND_SYSTEM.md"), systemMarker);
  writeFileSync(join(project, "context.txt"), "TOOL_TITLE_FIXTURE <title>工具原文</title>\n");
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { "title-fixture": {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
    models: [{ id: "fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ "title-fixture": { type: "api_key", key: "loopback-only" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const start = process.env.AXIOM_TEST_COMPILED
    ? (await import(new URL("../dist/server/index.js", import.meta.url).href)).startServer as typeof startServer
    : startServer;
  app = await start({ root, port: 0 });
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const call = (scope: Scope, op: string, params: Record<string, unknown> = {}) =>
    app!.agents.command({ ...scope, op, params, requestId: randomUUID() });
  const create = async () => {
    const session = app!.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
    await call(scope, "agent.model", { selection: { provider: "title-fixture", id: "fixture", thinking: "off" } });
    return scope;
  };
  const state = (scope: Scope) => app!.store.db.prepare("SELECT title,titleState FROM sessions WHERE id=?").get(scope.sessionId)!;
  const title = (scope: Scope) => app!.store.session(scope.workspaceId, scope.sessionId).title;
  const messages = (scope: Scope) => app!.agents.thread(scope).ids.map((id) => app!.agents.message(scope, id)!);
  const transcript = (scope: Scope) => {
    const file = app!.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file as string;
    return { file, raw: readFileSync(file, "utf8") };
  };
  const next = async (index: number) => {
    await wait(() => requests.length > index, `model request ${index + 1} did not arrive`);
    assert.equal(requests.length, index + 1, "no additional title-only model request");
    return requests[index];
  };
  const settle = async (scope: Scope, count: number, status = "completed") => {
    await wait(() => !running(app!.agents.info(scope).run), "worker did not settle");
    assert.equal(app!.agents.info(scope).run!.status, status, JSON.stringify(app!.agents.info(scope).run));
    assert.equal(requests.length, count, "title generation must share the existing model response");
  };
  const begin = async (scope: Scope, text: string) => {
    const index = requests.length;
    await call(scope, "prompt", { text });
    return next(index);
  };

  await t.test("first-input fallback; every tool turn requests a title until generated; display-only filtering and restart", async () => {
    const scope = await create();
    const input = "<title>用户原文</title>\n  " + "请读取上下文并验证工具。".repeat(8);
    const fallback = [...input.replace(/\s+/g, " ").trim()].slice(0, 60).join("");
    const initial = requests.length;
    const first = await begin(scope, input);
    assert.equal(title(scope), fallback);
    assert.equal([...title(scope)].length, 60);
    assert.equal(state(scope).titleState, "pending");
    requestsTitle(first, true);
    first.tool();
    const second = await next(initial + 1);
    requestsTitle(second, true);
    preservesPrefix(first, second);
    assert.equal(title(scope), fallback, "a tool-only response cannot settle the title");
    assert.ok(second.body.messages.some((message) => message.role === "tool" && JSON.stringify(message.content).includes("TOOL_TITLE_FIXTURE")),
      "the real pi read tool ran between provider requests");
    second.tool("<title>工具核验</title>\n继续读取。");
    const third = await next(initial + 2);
    requestsTitle(third, false);
    preservesPrefix(second, third);
    const reminderIndex = third.body.messages.findIndex((message) => JSON.stringify(message.content).includes(settledInstruction));
    assert.equal(third.body.messages[reminderIndex - 1].role, "tool", "reminder follows the complete tool call/result pair");
    await wait(() => title(scope) === "工具核验", "generated title was not saved");
    assert.equal(state(scope).titleState, "generated");
    third.finish("读取完成。正文保留 <title>正文标签</title>。");
    await settle(scope, initial + 3);
    const displayed = messages(scope);
    assert.ok(displayed.some((message) => message.role === "user" && message.text === input), "user text and its title markup stay verbatim");
    assert.ok(displayed.some((message) => message.toolName === "read" && message.text.includes("<title>工具原文</title>")), "tool text stays verbatim");
    assert.ok(displayed.some((message) => message.role === "assistant" && message.text === "继续读取。"));
    assert.ok(displayed.some((message) => message.role === "assistant" && message.text.includes("<title>正文标签</title>")), "ordinary body markup is not a leading title");
    assert.ok(displayed.filter((message) => message.role === "assistant").every((message) => !message.text.includes("<title>工具核验</title>")));
    const environment = app!.agents.info(scope).environment!.systemPrompt!;
    assert.ok(environment.includes(systemMarker));
    assert.ok(!environment.includes(instruction));
    const saved = transcript(scope);
    assert.ok(saved.raw.includes("<title>工具核验</title>"), "pi JSONL retains the original assistant title");
    assert.ok(saved.raw.includes(instruction), "title instruction is durable JSONL history");
    const entries = saved.raw.trim().split("\n").map((line) => JSON.parse(line));
    for (const customType of ["axiom-title", "axiom-title-settled"]) {
      const protocol = entries.filter((entry) => entry.type === "custom_message" && entry.customType === customType);
      assert.equal(protocol.length, 1, `${customType} is persisted exactly once`);
      assert.equal(protocol[0].display, false);
    }
    assert.ok(displayed.every((message) => !message.text.includes(instruction) && !message.text.includes(settledInstruction)),
      "title protocol messages stay hidden from chat");
    assert.ok(entries.some((entry) => entry.message?.role === "user" && entry.message.content.some((part: any) => part.text === input)));
    const ids = app!.agents.thread(scope).ids;
    await app!.close(); app = undefined;
    app = await start({ root, port: 0 });
    assert.equal(title(scope), "工具核验");
    assert.equal(state(scope).titleState, "generated");
    assert.deepEqual(app.agents.thread(scope).ids, ids);
    assert.equal(transcript(scope).raw, saved.raw, "restart and projection must not rewrite pi JSONL");
    assert.ok(messages(scope).filter((message) => message.role === "assistant").every((message) => !message.text.includes("<title>工具核验</title>")));
    assert.equal(requests.length, initial + 3, "restart must not replay or generate titles");
    const later = await begin(scope, "后续运行不得再次索要标题");
    requestsTitle(later, false);
    preservesPrefix(third, later);
    assert.ok(JSON.stringify(later.body.messages).includes("<title>工具核验</title>"), "model context still reads the unmodified assistant history");
    later.finish("<title>不应覆盖</title>\n后续完成。");
    await settle(scope, initial + 4);
    assert.equal(title(scope), "工具核验");
  });

  await t.test("missing, misplaced, invalid and length-limited titles remain pending for the next run", async () => {
    const scope = await create();
    const initial = requests.length;
    const cases = [
      { text: "没有标题也能正常完成。", reason: "stop" },
      { text: "先有正文。\n<title>不能采纳</title>", reason: "stop" },
      { text: "<title>一二三四五六七八九十多</title>\n超过十字。", reason: "stop" },
      { text: "<title>截断标题</title>\n尚未完成", reason: "length" },
    ];
    for (const [index, response] of cases.entries()) {
      const request = await begin(scope, index === 0 ? "首条兜底保持不变" : `后续输入 ${index}`);
      requestsTitle(request, true, index + 1);
      request.finish(response.text, response.reason);
      await settle(scope, initial + index + 1, response.reason === "length" ? "failed" : "completed");
      assert.equal(title(scope), "首条兜底保持不变", "later inputs must not replace the first fallback");
      assert.equal(state(scope).titleState, "pending");
    }
    const retry = await begin(scope, "下一次继续索要");
    requestsTitle(retry, true, cases.length + 1);
    retry.finish("<title>终于生成</title>\n完成。");
    await settle(scope, initial + cases.length + 1);
    assert.equal(title(scope), "终于生成");
    assert.equal(state(scope).titleState, "generated");
  });

  await t.test("aborted partial response cannot claim a title and the next run still requests one", async () => {
    const scope = await create(), initial = requests.length;
    const request = await begin(scope, "取消运行兜底");
    requestsTitle(request, true);
    request.chunk({ role: "assistant", content: "<title>取消标题</title>\n尚在生成。" });
    await wait(() => messages(scope).some((message) => message.role === "assistant" && message.text.includes("尚在生成")), "partial assistant response was not projected");
    assert.equal(title(scope), "取消运行兜底", "streaming text is not a successful response");
    await call(scope, "agent.stop", { runId: app!.agents.info(scope).run!.id });
    request.res.destroy();
    await settle(scope, initial + 1, "cancelled");
    assert.equal(state(scope).titleState, "pending");
    const retry = await begin(scope, "取消后继续");
    requestsTitle(retry, true, 2);
    retry.finish("<title>恢复完成</title>\n完成。");
    await settle(scope, initial + 2);
    assert.equal(title(scope), "恢复完成");
  });

  await t.test("WS manual rename wins over an in-flight generated title and stops same-run injection", async () => {
    const scope = await create(), initial = requests.length;
    const first = await begin(scope, "手动命名之前");
    requestsTitle(first, true);
    const ws = new WebSocket(app!.origin.replace("http", "ws") + "/ws", { headers: { Origin: app!.origin } });
    clients.push(ws);
    await once(ws, "open");
    const requestId = randomUUID();
    const receipt = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { ws.off("message", receive); reject(Error("rename receipt timeout")); }, 5000);
      function receive(raw: Buffer) {
        const event = JSON.parse(raw.toString());
        if (event.type !== "receipt" || event.requestId !== requestId) return;
        clearTimeout(timer); ws.off("message", receive); resolve(event);
      }
      ws.on("message", receive);
    });
    ws.send(JSON.stringify({ ...scope, op: "session.rename", requestId, params: { title: "用户指定名称" } }));
    assert.equal((await receipt).ok, true);
    assert.equal(title(scope), "用户指定名称");
    assert.equal(state(scope).titleState, "manual");
    first.tool("<title>迟到模型标题</title>\n继续工作。");
    const second = await next(initial + 1);
    requestsTitle(second, false);
    preservesPrefix(first, second);
    second.finish("<title>再次尝试覆盖</title>\n完成。");
    await settle(scope, initial + 2);
    assert.equal(title(scope), "用户指定名称");
    assert.equal(state(scope).titleState, "manual");
    const later = await begin(scope, "手动命名后的新运行");
    requestsTitle(later, false);
    preservesPrefix(second, later);
    later.finish("完成。");
    await settle(scope, initial + 3);
    assert.equal(title(scope), "用户指定名称");
    ws.close();
    await once(ws, "close");
  });

  await t.test("parallel sessions maintain separate pending/generated states and provider histories", async () => {
    const left = await create(), right = await create(), initial = requests.length;
    const a = await begin(left, "LEFT_ONLY_SESSION_INPUT");
    const b = await begin(right, "RIGHT_ONLY_SESSION_INPUT");
    assert.ok(running(app!.agents.info(left).run) && running(app!.agents.info(right).run));
    requestsTitle(a, true); requestsTitle(b, true);
    assert.equal(title(left), "LEFT_ONLY_SESSION_INPUT");
    assert.equal(title(right), "RIGHT_ONLY_SESSION_INPUT");
    b.finish("<title>右侧标题</title>\n右侧完成。");
    await settle(right, initial + 2);
    assert.equal(title(right), "右侧标题");
    assert.equal(state(left).titleState, "pending");
    assert.ok(running(app!.agents.info(left).run));
    a.tool();
    const continuation = await next(initial + 2);
    requestsTitle(continuation, true);
    assert.ok(!JSON.stringify(continuation.body.messages).includes("RIGHT_ONLY_SESSION_INPUT"));
    assert.ok(!JSON.stringify(b.body.messages).includes("LEFT_ONLY_SESSION_INPUT"));
    continuation.finish("<title>左侧标题</title>\n左侧完成。");
    await settle(left, initial + 3);
    assert.equal(title(left), "左侧标题");
    assert.equal(title(right), "右侧标题");
    assert.ok(!transcript(left).raw.includes("右侧标题"));
    assert.ok(!transcript(right).raw.includes("左侧标题"));
  });
});
