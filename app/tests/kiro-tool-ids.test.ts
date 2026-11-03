import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore, normalizeContext, Type, type AssistantMessage, type Context, type Message, type Model } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Agent } from "@earendil-works/pi-agent-core";
import { normalizeKiroToolIds } from "../src/server/providers/kiro-tool-ids.js";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import { kiroResponsesRequest } from "../src/server/providers/kiro-responses.js";
import { kiroProvider } from "../src/server/providers/kiro.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const account: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" };
const target: Model<"kiro-chat"> = { id: "claude-opus-5.5", name: "Fixture", api: "kiro-chat", provider: "kiro", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: zero.cost };
const tool = { name: "read", description: "Fixture read", parameters: Type.Object({ path: Type.String() }) };
const id = (index = 0) => `call_${index.toString(16).padStart(32, "a")}|fc_${index.toString(16).padStart(50, "b")}`;
function assistant(ids: string[], api = "openai-codex-responses", provider = "openai-codex"): AssistantMessage {
  return { role: "assistant", api, provider, model: "source-model", usage: zero, stopReason: "toolUse", timestamp: 1,
    content: ids.map(id => ({ type: "toolCall", id, name: tool.name, arguments: { path: "fixture.txt" } })) };
}
const result = (toolCallId: string): Message => ({ role: "toolResult", toolCallId, toolName: tool.name, content: [{ type: "text", text: "Fixture output" }], isError: false, timestamp: 2 });
const user = (): Message => ({ role: "user", content: "Continue fixture", timestamp: 3 });
const context = (messages: Message[]): Context => ({ systemPrompt: "Caller policy stays intact", tools: [tool], messages });
function payload(messages: Message[], model = target) { return kiroChatRequest(model, normalizeContext(context(messages)), account); }
function callIds(messages: Message[]) {
  return messages.flatMap(message => message.role === "assistant" ? message.content.flatMap(block => block.type === "toolCall" ? [block.id] : []) : []);
}
function wire(messages: Message[]) {
  const request = payload(messages), response = kiroResponsesRequest(request.payload);
  const calls = response.input.filter(item => item.type === "function_call");
  const results = response.input.filter(item => item.type === "function_call_output");
  return { request, response, calls, results };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
}

test("Pi Responses composite IDs are decoded as pairs without altering frozen caller history", () => {
  assert.equal(id().length, 91);
  for (const api of ["openai-responses", "openai-codex-responses"]) {
    const messages = [user(), assistant([id()], api, "source-provider"), result(id()), user()];
    const before = structuredClone(messages); freeze(messages);
    const first = wire(messages), second = wire(messages);
    assert.equal(first.calls[0].call_id, id().split("|")[0]); assert.equal(first.results[0].call_id, first.calls[0].call_id);
    assert.deepEqual(first.response.input, second.response.input); assert.deepEqual(first.response.tools, second.response.tools); assert.deepEqual(messages, before);
    assert.equal(first.calls[0].arguments, '{"path":"fixture.txt"}');
    assert.deepEqual(JSON.parse(String(first.results[0].output)), { status: "success", content: [{ text: "Fixture output" }] });
    assert.match(JSON.stringify(first.response), /Caller policy stays intact/);
    assert.ok(first.request.seenCalls.has(String(first.calls[0].call_id))); assert.ok(!first.request.seenCalls.has(id()));
  }
});

test("native, foreign opaque and malformed composite IDs are not rewritten", () => {
  for (const [value, api, provider] of [
    ["native-call", "kiro-chat", "kiro"], [id(), "kiro-chat", "kiro"], [id(), "anthropic-messages", "other"],
    ["plain-call", "openai-responses", "other"], ["call|item|extra", "openai-responses", "other"],
    ["call|item\n", "openai-responses", "other"], ["call|", "openai-responses", "other"],
  ]) {
    const messages = [assistant([value], api, provider), result(value)];
    assert.equal(normalizeKiroToolIds(messages), messages);
  }
  const custom = [user(), assistant(["call_custom|ctc_fixture"], "openai-responses", "other"), result("call_custom|ctc_fixture")];
  assert.equal(wire(custom).calls[0].call_id, "call_custom");
});

test("collisions with native IDs, shared call IDs and hash fallback IDs never merge calls", () => {
  const a = "call_shared|fc_first", b = "call_shared|fc_second";
  const hash = `call_${createHash("sha256").update(a).digest("hex").slice(0, 40)}`;
  const pairs = [[assistant([a]), result(a)], [assistant([b]), result(b)],
    [assistant(["call_shared", hash], "kiro-chat", "kiro"), result("call_shared"), result(hash)]];
  for (const ordered of [pairs, [...pairs].reverse()]) {
    const messages = [user(), ...ordered.flat(), user()], mapped = normalizeKiroToolIds(messages);
    const ids = callIds(mapped);
    assert.equal(new Set(ids).size, 4); assert.ok(ids.includes("call_shared")); assert.ok(ids.includes(hash)); assert.ok(ids.includes(`${hash}_1`));
    for (const value of ids) assert.match(value, /^[a-zA-Z0-9_-]{1,64}$/);
    const converted = wire(messages);
    assert.deepEqual(converted.calls.map(c => c.call_id), converted.results.map(r => r.call_id));
  }
  const forward = callIds(normalizeKiroToolIds(pairs.flat())).sort();
  assert.deepEqual(callIds(normalizeKiroToolIds([...pairs].reverse().flat())).sort(), forward);
});

test("pre-reserving orphan and failed IDs cannot manufacture a valid tool result", () => {
  const composite = "call_orphan|fc_item";
  const orphan = [user(), assistant([composite]), result("call_orphan")];
  assert.notEqual(callIds(normalizeKiroToolIds(orphan))[0], "call_orphan");
  assert.throws(() => payload(orphan), /缺少匹配/);
  for (const stopReason of ["error", "aborted"] as const) {
    const skipped = { ...assistant(["call_orphan"]), stopReason };
    const messages = [user(), skipped, assistant([composite]), result(composite), user()];
    const converted = wire(messages);
    assert.notEqual(converted.calls[0].call_id, "call_orphan");
    assert.ok(!converted.request.seenCalls.has("call_orphan"));
    assert.throws(() => payload([user(), { ...assistant([composite]), stopReason }, result(composite)]), /缺少匹配/);
    const repeatedAfterSkip = wire([user(), { ...assistant([composite]), stopReason }, assistant([composite]), result(composite)]);
    assert.equal(repeatedAfterSkip.calls.length, 1); assert.equal(repeatedAfterSkip.calls[0].call_id, "call_orphan");
  }
});

test("duplicate original IDs, mismatched names and incomplete pairs still fail closed", () => {
  assert.throws(() => payload([user(), assistant([id()]), result(id()), assistant([id()]), result(id())]), /无效或重复/);
  assert.throws(() => payload([user(), assistant([id()], "kiro-chat", "kiro"), result(id()), assistant([id()]), result(id())]), /无效或重复/);
  assert.throws(() => payload([user(), assistant([id()]), { ...result(id()), toolName: "wrong" } as Message]), /名称不一致/);
  assert.throws(() => payload([user(), assistant([id()])]), /尚未收到全部结果/);
  assert.throws(() => payload([user(), assistant([id()]), user(), result(id())]), /缺少匹配/);
});

test("partial results at a user interruption preserve native omission and safety policy", () => {
  const messages = [user(), assistant([id(1), id(2)]), result(id(1)), user()];
  const converted = wire(messages);
  assert.equal(converted.calls.length, 1); assert.equal(converted.results.length, 1);
  assert.equal(converted.calls[0].call_id, id(1).split("|")[0]);
  assert.equal(converted.request.interruptionNotice.omittedToolCalls, 1);
  assert.ok(converted.request.seenCalls.has(id(2).split("|")[0]));
  assert.match(JSON.stringify(converted.response), /execution outcome is unknown/);
  assert.equal(messages.filter(m => m.role === "toolResult").length, 1);
});

test("a persisted 106-call fork and its parent map identically without rewriting their transcripts", t => {
  const root = mkdtempSync(join(tmpdir(), "kiro-id-fork-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, root);
  manager.appendMessage(user());
  for (let i = 0; i < 106; i++) { manager.appendMessage(assistant([id(i)])); manager.appendMessage(result(id(i))); }
  const leaf = manager.appendMessage(user()), parentPath = manager.getSessionFile()!;
  const parent = readFileSync(parentPath, "utf8"), parentMessages = manager.buildSessionProjection().messages as Message[];
  const forkPath = manager.createBranchedSession(leaf)!; assert.notEqual(forkPath, parentPath);
  const fork = readFileSync(forkPath, "utf8"), forked = SessionManager.open(forkPath);
  const sourceWire = wire(parentMessages), forkWire = wire(forked.buildSessionProjection().messages as Message[]);
  assert.equal(forkWire.calls.length, 106); assert.equal(forkWire.results.length, 106);
  assert.deepEqual(forkWire.response.input, sourceWire.response.input); assert.deepEqual(forkWire.response.tools, sourceWire.response.tools);
  assert.ok(forkWire.calls.every(c => typeof c.call_id === "string" && c.call_id.length === 37 && !c.call_id.includes("|")));
  assert.equal(readFileSync(parentPath, "utf8"), parent); assert.equal(readFileSync(forkPath, "utf8"), fork);
});

test("Agent resumes foreign history but executes only a newly returned tool, once", async () => {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  const history = [user(), assistant([id()]), result(id())], before = structuredClone(history);
  let sends = 0, executions = 0;
  const agent = new Agent({ initialState: { model: { ...target, id: "native-fixture" }, systemPrompt: "Caller policy stays intact", messages: history,
    tools: [{ ...tool, label: "Fixture", execute: async (callId, args) => {
      executions++; assert.equal(callId, "new-call"); assert.deepEqual(args, { path: "new.txt" });
      return { content: [{ type: "text", text: "New result" }], details: {} };
    } }] }, streamFn: (model, context, options) => models.streamSimple(model, context, { ...options, fetch: async (_url, init) => {
      sends++; const body = JSON.parse(String(init?.body));
      assert.equal(body.conversationState.history[1].assistantResponseMessage.toolUses[0].toolUseId, id().split("|")[0]);
      if (sends === 1) return kiroResponse([kiroFrame("toolUseEvent", { toolUseId: "new-call", name: "read", input: '{"path":"new.txt"}', stop: true })]);
      assert.equal(sends, 2);
      assert.equal(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].toolUseId, "new-call");
      return kiroResponse([kiroFrame("assistantResponseEvent", { content: "done" })]);
    } }) });
  await agent.prompt("Continue fixture");
  assert.equal(sends, 2); assert.equal(executions, 1); assert.deepEqual(history, before);
  const final = agent.state.messages.at(-1); assert.equal(final?.role, "assistant");
  if (final?.role === "assistant") assert.equal(final.stopReason, "stop");
});

test("actual SDK sends normalized history on both Kiro routes and rejects reused mapped IDs", async () => {
  const messages = [user(), assistant([id()]), result(id()), user()], before = structuredClone(messages);
  for (const route of ["claude-opus-5.5", "native-fixture"]) for (const reuse of [false, true]) {
    const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
    const models = createModels({ credentials }); models.setProvider(kiroProvider());
    let sends = 0;
    const stream = models.stream({ ...target, id: route }, context(messages), { fetch: async (url, init) => {
      sends++; const body = JSON.parse(String(init?.body)); const call = id().split("|")[0];
      if (route === "claude-opus-5.5") {
        assert.match(String(url), /\/v1\/responses$/);
        assert.equal(body.input.find((i: { type: string }) => i.type === "function_call").call_id, call);
        assert.equal(body.input.find((i: { type: string }) => i.type === "function_call_output").call_id, call);
        const item = reuse ? { type: "function_call", id: "fc_fixture", call_id: call, name: "read", arguments: '{"path":"fixture.txt"}' }
          : { type: "message", id: "msg_fixture", role: "assistant", content: [{ type: "output_text", text: "done" }] };
        const events = reuse ? [
          { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
          { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: item.arguments },
        ] : [
          { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
          { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "done" },
          { type: "response.output_text.done", output_index: 0, item_id: item.id, content_index: 0, text: "done" },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: "resp_fixture", status: "completed", model: route, output: [item] } },
        ];
        return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
      }
      assert.ok(!String(url).endsWith("/v1/responses"));
      assert.equal(body.conversationState.history[1].assistantResponseMessage.toolUses[0].toolUseId, call);
      assert.equal(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].toolUseId, call);
      return kiroResponse([reuse ? kiroFrame("toolUseEvent", { toolUseId: call, name: "read", input: '{"path":"fixture.txt"}', stop: true })
        : kiroFrame("assistantResponseEvent", { content: "done" })]);
    } });
    const output = await stream.result();
    assert.equal(sends, 1); assert.equal(output.stopReason, reuse ? "error" : "stop");
    if (reuse) assert.match(output.errorMessage!, /历史重复/);
  }
  assert.deepEqual(messages, before);
});
