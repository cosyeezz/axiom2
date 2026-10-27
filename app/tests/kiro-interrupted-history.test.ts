import assert from "node:assert/strict";
import { test } from "node:test";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { createModels, InMemoryCredentialStore, normalizeContext, Type, type Context, type AssistantMessage, type Message, type Model } from "@earendil-works/pi-ai";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const model: Model<"kiro-chat"> = { id: "account-selected-model", name: "Selected", provider: "kiro", api: "kiro-chat", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const account: KiroCredential = { type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" };
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });
const assistant = (ids: string[], text = ""): AssistantMessage => ({ role: "assistant", api: "kiro-chat", provider: "kiro", model: model.id, timestamp: 2, usage: zero, stopReason: "toolUse", content: [
  ...(text ? [{ type: "text" as const, text }] : []), ...ids.map(id => ({ type: "toolCall" as const, id, name: "read", arguments: {} })),
] });
const result = (id: string, isError = false): Message => ({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: isError ? "Actual tool failed" : "Actual successful result" }], isError, timestamp: 3 });
const context = (messages: Message[]): Context => ({ systemPrompt: "Full Axiom policy", tools: [{ name: "read", description: "Read", parameters: Type.Object({}) }], messages });
const request = (messages: Message[]) => kiroChatRequest(model, normalizeContext(context(messages)), account, "interruption-test");

test("Kiro a new user input can recover an unfinished tool call without inventing a result", () => {
  const messages = [user("Original data ORBIT-K7"), assistant(["cancelled-call"]), user("Continue after cancellation")];
  const before = structuredClone(messages);
  const { payload, interruptionNotice, seenCalls } = request(messages);
  assert.equal(interruptionNotice.omittedToolCalls, 1);
  assert.doesNotMatch(JSON.stringify(payload), /cancelled-call|toolResults/);
  assert.match(payload.conversationState.currentMessage.userInputMessage.content, /Original data ORBIT-K7[\s\S]*Continue after cancellation/);
  assert.equal(payload.conversationState.history, undefined);
  assert.ok(seenCalls.has("cancelled-call"), "do not allow a service response to reuse a historical call ID");
  assert.deepEqual(messages, before, "local native history must not be edited");
});

test("Kiro interruption cleanup preserves the assistant's ordinary text", () => {
  const { payload, interruptionNotice } = request([user("Read"), assistant(["cancelled-call"], "Starting the long read"), user("New input")]);
  const prior = payload.conversationState.history?.[1];
  assert.ok(prior && "assistantResponseMessage" in prior);
  assert.deepEqual(prior.assistantResponseMessage, { content: "Starting the long read" });
  assert.equal(interruptionNotice.omittedToolCalls, 1);
});

test("Kiro partially completed parallel tools retain their actual paired results and drop only outstanding calls", () => {
  for (const error of [false, true]) {
    const { payload, interruptionNotice } = request([user("Two reads"), assistant(["finished", "interrupted"], "Checking both"), result("finished", error), user("Stop waiting and continue")]);
    const prior = payload.conversationState.history?.[1];
    assert.ok(prior && "assistantResponseMessage" in prior);
    assert.deepEqual(prior.assistantResponseMessage.toolUses?.map(t => t.toolUseId), ["finished"]);
    assert.equal(prior.assistantResponseMessage.content, "Checking both");
    assert.deepEqual(payload.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults, [{
      toolUseId: "finished", status: error ? "error" : "success", content: [{ text: error ? "Actual tool failed" : "Actual successful result" }],
    }]);
    assert.equal(interruptionNotice.omittedToolCalls, 1);
    assert.doesNotMatch(JSON.stringify(payload), /interrupted/);
  }
});

test("Kiro drops all unfinished calls at a new user boundary without losing that user's image", () => {
  const { payload, interruptionNotice } = request([user("Start"), assistant(["a", "b"]), { role: "user", content: [
    { type: "text", text: "Inspect new image" }, { type: "image", mimeType: "image/png", data: "AA==" },
  ], timestamp: 4 }]);
  assert.equal(interruptionNotice.omittedToolCalls, 2);
  assert.deepEqual(payload.conversationState.currentMessage.userInputMessage.images, [{ format: "png", source: { bytes: "AA==" } }]);
  assert.match(payload.conversationState.currentMessage.userInputMessage.content, /Start[\s\S]*Inspect new image/);
});

test("Kiro interruption cleanup does not remove an earlier completed tool cycle", () => {
  const { payload, interruptionNotice } = request([user("Start"), assistant(["done"]), result("done"), assistant(["cancelled"], "Need one more"), user("Continue")]);
  const text = JSON.stringify(payload);
  assert.match(text, /done/); assert.match(text, /Actual successful result/); assert.match(text, /Need one more/);
  assert.doesNotMatch(text, /cancelled/); assert.equal(interruptionNotice.omittedToolCalls, 1);
});

test("Kiro partial interruption retains completed tool images alongside the new user's image", () => {
  const messages: Message[] = [user("Start"), assistant(["done", "cancelled"]), {
    role: "toolResult", toolCallId: "done", toolName: "read", isError: false, timestamp: 3,
    content: [{ type: "text", text: "Actual successful image result" }, { type: "image", mimeType: "image/png", data: "AA==" }],
  }, { role: "user", timestamp: 4, content: [
    { type: "text", text: "Compare new image" }, { type: "image", mimeType: "image/png", data: "AQ==" },
  ] }];
  const { payload, interruptionNotice } = request(messages), current = payload.conversationState.currentMessage.userInputMessage;
  assert.equal(interruptionNotice.omittedToolCalls, 1);
  assert.deepEqual(current.images, [{ format: "png", source: { bytes: "AA==" } }, { format: "png", source: { bytes: "AQ==" } }]);
  assert.equal((current.userInputMessageContext?.toolResults?.[0] as any).toolUseId, "done");
  assert.match(JSON.stringify(payload), /Actual successful image result/);
  assert.doesNotMatch(JSON.stringify(payload), /cancelled/);
});

test("Kiro still rejects unresolved continuation, assistant-crossing, orphan results and call ID reuse", () => {
  for (const messages of [
    [user("Start"), assistant(["a"])],
    [user("Start"), assistant(["a"]), { ...assistant([], "Unpaired assistant"), stopReason: "stop" as const }, user("Continue")],
    [user("Start"), assistant(["a"]), user("Continue"), result("a")],
    [user("Start"), assistant(["a"]), user("Continue"), assistant(["a"]), result("a")],
    [user("Start"), result("no-call")],
  ]) assert.throws(() => request(messages), /工具/);
});

test("Kiro complete tool histories are unchanged and do not claim interruption cleanup", () => {
  const { payload, interruptionNotice } = request([user("Start"), assistant(["done"]), result("done")]);
  assert.equal(interruptionNotice.omittedToolCalls, 0);
  assert.match(JSON.stringify(payload), /done/);
  assert.deepEqual(payload.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults?.[0], {
    toolUseId: "done", status: "success", content: [{ text: "Actual successful result" }],
  });
});

test("Kiro streaming continuation reports omission diagnostics and only sends valid tool pairs", async () => {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  let sent = 0;
  const stream = models.stream(model, context([user("Start"), assistant(["interrupted"], "Starting"), user("Recover")]), { fetch: async (_url, init) => {
    sent++; const body = JSON.parse(String(init?.body));
    assert.doesNotMatch(JSON.stringify(body), /interrupted|toolResults/);
    assert.equal(body.conversationState.history?.[1].assistantResponseMessage.content, "Starting");
    assert.equal(body.conversationState.currentMessage.userInputMessage.content, "Recover");
    return kiroResponse([kiroFrame("assistantResponseEvent", { content: "Recovered" })]);
  } });
  const events = []; for await (const event of stream) events.push(event.type);
  const response = await stream.result();
  assert.equal(response.stopReason, "stop", response.errorMessage);
  assert.equal(sent, 1); assert.equal(events.at(-1), "done");
  const diagnostic = response.diagnostics?.find(d => d.type === "kiro-interrupted-tools-omitted");
  assert.deepEqual(diagnostic?.details, { omittedToolCalls: 1, executionState: "unknown", userBoundaryProvenance: "unverified", policy: "verify-before-repeating-side-effects" });
});

test("Kiro rejects service reuse of an omitted interrupted call ID before any tool-call event", async () => {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  let sent = 0;
  const stream = models.stream(model, context([user("Start"), assistant(["interrupted-id"]), user("Recover")]), { fetch: async () => {
    sent++;
    return kiroResponse([kiroFrame("toolUseEvent", { toolUseId: "interrupted-id", name: "read", input: "{}", stop: true })]);
  } });
  const events = []; for await (const event of stream) events.push(event.type);
  const response = await stream.result();
  assert.equal(sent, 1); assert.equal(response.stopReason, "error");
  assert.match(response.errorMessage ?? "", /工具调用 ID.*重复/);
  assert.equal(events.includes("toolcall_start"), false);
  assert.equal(events.at(-1), "error");
});

test("Kiro recovery uses a normalized user role, including converted non-displayed custom input", () => {
  const synthetic = user("Synthetic input; no human or cancellation provenance");
  const converted = convertToLlm([{ role: "custom", customType: "fixture", content: "Synthetic custom boundary", display: false, timestamp: 4 }]);
  assert.equal(converted.length, 1); assert.equal(converted[0].role, "user");
  for (const boundary of [synthetic, converted[0]]) {
    const { payload, interruptionNotice } = request([user("Start"), assistant(["unfinished"]), boundary]);
    assert.equal(interruptionNotice.omittedToolCalls, 1); assert.doesNotMatch(JSON.stringify(payload), /unfinished/);
  }
  const normalized = normalizeContext(context([user("Start"), assistant(["unfinished"])]));
  normalized.messages.push({ role: "custom", customType: "unconverted", content: "Not a normalized user", display: false, timestamp: 4 } as any);
  assert.throws(() => kiroChatRequest(model, normalized, account), /不支持的消息角色/);
});

test("Kiro unknown tool outcomes constrain side-effect replay even for synthetic input or no original system", () => {
  const converted = convertToLlm([{ role: "custom", customType: "fixture", content: "Synthetic boundary", display: false, timestamp: 4 }]);
  for (const boundary of [user("Human asks to continue; no execution receipt"), converted[0]]) {
    const ctx = context([user("Start"), assistant(["unknown-call"]), boundary]);
    delete ctx.systemPrompt;
    const normalized = normalizeContext(ctx), before = structuredClone(normalized);
    const first = kiroChatRequest(model, normalized, account, "unknown-state");
    const second = kiroChatRequest(model, normalized, account, "unknown-state");
    const wire = JSON.stringify(first.payload);
    assert.match(wire, /execution outcome is unknown, not confirmed as unexecuted/);
    assert.match(wire, /Do not blindly repeat operations with side effects/);
    assert.match(wire, /verify the current state or ask the user/);
    assert.match(wire, /normalized user message does not prove/);
    assert.equal(wire.match(/Axiom recovery safety/g)?.length, 1);
    assert.doesNotMatch(wire, /unknown-call|toolResults/);
    assert.equal(first.seenCalls.has("unknown-call"), true);
    assert.deepEqual(first.payload, second.payload); assert.deepEqual(normalized, before);
  }
  const paired = request([user("Start"), assistant(["done"]), result("done")]);
  assert.doesNotMatch(JSON.stringify(paired.payload), /Axiom recovery safety/);
});

test("Kiro system updates do not close pending calls and remain part of the full policy", () => {
  const system: Message = { role: "system", content: "LATE_SYSTEM_POLICY", timestamp: 4 };
  const start = [user("Start"), assistant(["pending-system"]), system];
  const paired = request([...start, result("pending-system")]);
  assert.equal(paired.interruptionNotice.omittedToolCalls, 0);
  assert.match(JSON.stringify(paired.payload), /LATE_SYSTEM_POLICY/);
  assert.match(JSON.stringify(paired.payload), /pending-system/);
  assert.throws(() => request(start), /尚未收到全部结果/);
  const closed = request([...start, user("Normalized boundary")]);
  assert.equal(closed.interruptionNotice.omittedToolCalls, 1);
  assert.match(JSON.stringify(closed.payload), /LATE_SYSTEM_POLICY/);
  assert.doesNotMatch(JSON.stringify(closed.payload), /pending-system/);
});

for (const stopReason of ["error", "aborted"] as const) test(`Kiro skips ${stopReason} assistant content without registering its calls or closing earlier pending`, () => {
  const failed = { ...assistant(["ignored-failed-call"], "SKIPPED_ASSISTANT_TEXT"), stopReason };
  const start = [user("Start"), assistant(["earlier-pending"]), failed];
  const paired = request([...start, result("earlier-pending")]);
  assert.equal(paired.interruptionNotice.omittedToolCalls, 0);
  assert.equal(paired.seenCalls.has("earlier-pending"), true); assert.equal(paired.seenCalls.has("ignored-failed-call"), false);
  assert.doesNotMatch(JSON.stringify(paired.payload), /ignored-failed-call|SKIPPED_ASSISTANT_TEXT/);
  const closed = request([...start, user("Continue")]);
  assert.equal(closed.interruptionNotice.omittedToolCalls, 1);
  assert.equal(closed.seenCalls.has("ignored-failed-call"), false);
  assert.throws(() => request(start), /尚未收到全部结果/);
  assert.throws(() => request([...start, result("ignored-failed-call")]), /缺少匹配的调用或名称不一致/);
});

test("Kiro rejects a late result after its call was omitted at a normalized user boundary", () => {
  assert.throws(() => request([user("Start"), assistant(["late-call"]), user("Continue"), result("late-call")]), /缺少匹配的调用或名称不一致/);
  assert.throws(() => request([user("Start"), assistant(["done", "late-call"]), result("done"), user("Continue"), result("late-call")]), /缺少匹配的调用或名称不一致/);
});

test("Kiro repeatedly builds the same frozen normalized context without mutation or system-prefix accumulation", () => {
  const messages: Message[] = [user("Start"), assistant(["paired-image", "unfinished"], "Ordinary assistant text"), {
    role: "toolResult", toolCallId: "paired-image", toolName: "read", isError: false, timestamp: 3,
    content: [{ type: "text", text: "Image result" }, { type: "image", mimeType: "image/png", data: "AA==" }],
  }, { role: "system", content: "LATE_FROZEN_POLICY", timestamp: 4 }, { role: "user", timestamp: 5,
    content: [{ type: "text", text: "Continue with a new image" }, { type: "image", mimeType: "image/png", data: "AQ==" }] }];
  const normalized = normalizeContext(context(messages)), before = structuredClone(normalized);
  function freeze(value: unknown) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) freeze(item); }
  }
  freeze(normalized);
  const first = kiroChatRequest(model, normalized, account, "frozen-context");
  const second = kiroChatRequest(model, normalized, account, "frozen-context");
  assert.deepEqual(first.payload, second.payload); assert.deepEqual(first.historyNotice, second.historyNotice);
  assert.deepEqual(first.interruptionNotice, { omittedToolCalls: 1 }); assert.deepEqual(first.interruptionNotice, second.interruptionNotice);
  assert.deepEqual([...first.seenCalls], [...second.seenCalls]); assert.deepEqual(normalized, before);
  const wire = JSON.stringify(second.payload);
  assert.equal(wire.match(/Full Axiom policy/g)?.length, 1); assert.equal(wire.match(/LATE_FROZEN_POLICY/g)?.length, 1);
  const prior = second.payload.conversationState.history?.find(message => "assistantResponseMessage" in message);
  assert.ok(prior && "assistantResponseMessage" in prior);
  assert.equal(prior.assistantResponseMessage.content, "Ordinary assistant text");
  assert.deepEqual(prior.assistantResponseMessage.toolUses?.map(call => call.toolUseId), ["paired-image"]);
  const pairedResults = second.payload.conversationState.currentMessage.userInputMessage.userInputMessageContext?.toolResults;
  assert.deepEqual(pairedResults, [{ toolUseId: "paired-image", status: "success", content: [{ text: "Image result" }] }]);
  assert.doesNotMatch(wire, /unfinished/);
  assert.deepEqual(second.payload.conversationState.currentMessage.userInputMessage.images, [{ format: "png", source: { bytes: "AA==" } }, { format: "png", source: { bytes: "AQ==" } }]);
});
