import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, InMemoryCredentialStore, normalizeContext, Type, type AssistantMessageEvent, type Context, type Model, type StreamOptions } from "@earendil-works/pi-ai";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroChat } from "../src/server/providers/kiro-chat.js";
import { kiroOAuth, type KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import { kiroCrc32 } from "../src/server/providers/kiro-eventstream.js";
import { kiroFrame, kiroResponse, fixtureCrc } from "./fixtures/kiro-eventstream.js";
const account = (patch: Partial<KiroCredential> = {}): KiroCredential => ({ type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1", ...patch });
const model = (): Model<"kiro-chat"> => ({ id: "account-selected-model", name: "Selected", provider: "kiro", api: "kiro-chat", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
const user = (content = "你好"): Context => ({ systemPrompt: "You are Axiom. Keep its policies.", messages: [{ role: "user", content, timestamp: 1 }] });
const tool = { name: "namespace.read", description: "Read safely", parameters: Type.Object({ path: Type.String() }) };
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
async function run(context: Context, fetch: typeof globalThis.fetch, options: StreamOptions = {}, credential = account(), target = model()) {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => credential);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  const stream = models.stream(target, context, { ...options, fetch });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { result: await stream.result(), events, credentials, models };
}

test("Kiro native chat sends selected model and full system prompt, uses fixed AWS protocol and hooks", async () => {
  let payload = false, response = false, observed = 0;
  const { result, events } = await run(user(), async (input, init) => {
    assert.equal(String(input), "https://runtime.us-east-1.kiro.dev/"); assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer PRIVATE-ACCESS");
    assert.equal(headers.get("x-amz-target"), "AmazonCodeWhispererStreamingService.GenerateAssistantResponse");
    assert.equal(headers.get("x-amzn-codewhisperer-optout"), "true"); assert.equal(headers.get("x-fixture"), "safe");
    assert.equal(headers.get("Content-Type"), "application/x-amz-json-1.0"); assert.equal(headers.get("User-Agent"), null);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.conversationState.currentMessage.userInputMessage.modelId, model().id);
    assert.equal(body.conversationState.currentMessage.userInputMessage.origin, "KIRO_CLI");
    assert.match(body.conversationState.currentMessage.userInputMessage.content, /You are Axiom[\s\S]*你好/);
    assert.equal(body.fixture, "replacement"); assert.ok(!String(init?.body).includes("PRIVATE-REFRESH"));
    return kiroResponse([kiroFrame("assistantResponseEvent", { content: "你好🌏", messageId: "message-1" }), kiroFrame("metadataEvent", { tokenUsage: { uncachedInputTokens: 12, outputTokens: 4, cacheReadInputTokens: 3, cacheWriteInputTokens: 2, totalTokens: 21 } })], 1);
  }, { sessionId: "PRIVATE-SESSION", headers: { Authorization: "MALICIOUS", "Content-Type": "wrong", "x-amz-target": "wrong", "User-Agent": "Axiom injected", "x-fixture": "safe" },
    onPayload: p => { payload = true; return { ...p as object, fixture: "replacement" }; },
    onResponse: r => { response = true; assert.equal(r.status, 200); }, onProviderStreamEvent: () => { observed++; } });
  assert.equal(result.stopReason, "stop"); assert.deepEqual(result.content, [{ type: "text", text: "你好🌏" }]); assert.equal(result.responseId, "message-1");
  assert.deepEqual(result.usage, { ...zero, input: 12, output: 4, cacheRead: 3, cacheWrite: 2, totalTokens: 21,
    axiomKiro: { version: 1, scope: "request", state: "complete", pricing: { kind: "unknown", rates: model().cost } } });
  assert.ok(payload && response); assert.equal(observed, 2); assert.deepEqual(events.map(e => e.type), ["start", "text_start", "text_delta", "text_end", "done"]);
  assert.equal(kiroCrc32(Buffer.from("123456789")), 0xcbf43926); assert.equal(fixtureCrc(Buffer.from("123456789")), 0xcbf43926);
});

test("neutral system framing preserves caller-owned Axiom system, messages, tools and results exactly", () => {
  const context: Context = { systemPrompt: "User Axiom system policy", tools: [{ ...tool, description: "User Axiom tool description" }],
    messages: [
      { role: "user", content: "User Axiom input <axiom_system>literal</axiom_system>", timestamp: 1 },
      { role: "assistant", api: "kiro-chat", provider: "kiro", model: model().id, stopReason: "toolUse", usage: zero, timestamp: 2,
        content: [{ type: "text", text: "Assistant Axiom text" },
          { type: "toolCall", id: "preserved-call", name: tool.name, arguments: { path: "Axiom.txt" } }] },
      { role: "toolResult", toolCallId: "preserved-call", toolName: tool.name, isError: false, timestamp: 3,
        content: [{ type: "text", text: "Axiom KiroChat/1.0 is user-owned tool output" }] },
      { role: "user", content: "Axiom follow-up", timestamp: 4 },
    ] };
  const normalized = normalizeContext(context), before = structuredClone(normalized);
  const { payload } = kiroChatRequest(model(), normalized, account(), "preserved-session");
  const wire = JSON.stringify(payload);
  for (const text of ["User Axiom system policy", "User Axiom input <axiom_system>literal</axiom_system>",
    "Assistant Axiom text", "User Axiom tool description", "Axiom.txt", "Axiom KiroChat/1.0 is user-owned tool output", "Axiom follow-up"])
    assert.ok(wire.includes(text), text);
  const first = payload.conversationState.history![0];
  assert.ok("userInputMessage" in first);
  assert.ok(first.userInputMessage.content.startsWith("<system_prompt>\n"));
  assert.deepEqual(normalized, before);
});

test("Kiro tool JSON chunks map names back, validate schema and round-trip results without history model/tools", async () => {
  const ctx = { ...user("read"), tools: [tool] };
  const { payload, names } = kiroChatRequest(model(), normalizeContext(ctx), account(), "stable");
  const wireName = [...names.keys()][0]; assert.match(wireName, /^[a-zA-Z0-9_-]{1,64}$/); assert.notEqual(wireName, tool.name);
  const first = await run(ctx, async () => kiroResponse([
    kiroFrame("toolUseEvent", { toolUseId: "call-1", name: wireName, input: '{"path":' }),
    kiroFrame("toolUseEvent", { toolUseId: "call-1", input: '"docs/说明.md"}', stop: true }),
  ], 3));
  assert.equal(first.result.stopReason, "toolUse"); assert.deepEqual(first.result.content, [{ type: "toolCall", id: "call-1", name: tool.name, arguments: { path: "docs/说明.md" } }]);
  assert.deepEqual(first.events.map(e => e.type), ["start", "toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_end", "done"]);
  const continuation: Context = { ...ctx, messages: [...ctx.messages, first.result, { role: "toolResult", toolCallId: "call-1", toolName: tool.name, content: [{ type: "text", text: "file contents" }], isError: false, timestamp: 2 }] };
  const next = await run(continuation, async (_url, init) => {
    const request = JSON.parse(String(init?.body)), state = request.conversationState;
    assert.equal(state.history[0].userInputMessage.modelId, undefined);
    assert.equal(state.history[0].userInputMessage.userInputMessageContext?.tools, undefined);
    assert.equal(state.history[1].assistantResponseMessage.toolUses[0].toolUseId, "call-1");
    assert.deepEqual(state.currentMessage.userInputMessage.userInputMessageContext.toolResults, [{ toolUseId: "call-1", status: "success", content: [{ text: "file contents" }] }]);
    return kiroResponse([kiroFrame("assistantResponseEvent", { content: "done" })]);
  }, { sessionId: "stable" });
  assert.equal(next.result.stopReason, "stop"); assert.ok(!JSON.stringify(payload).includes("PRIVATE-"));
});

test("Kiro handles interleaved tools but rejects unended, repeated, unknown and invalid-schema calls", async () => {
  const ctx = { ...user(), tools: [tool] }, wireName = [...kiroChatRequest(model(), normalizeContext(ctx), account()).names.keys()][0];
  const ok = await run(ctx, async () => kiroResponse([
    kiroFrame("toolUseEvent", { toolUseId: "a", name: wireName, input: '{"path":' }),
    kiroFrame("toolUseEvent", { toolUseId: "b", name: wireName, input: '{"path":"b"}', stop: true }),
    kiroFrame("toolUseEvent", { toolUseId: "a", input: '"a"}', stop: true }),
  ]));
  assert.equal(ok.result.stopReason, "toolUse"); assert.equal(ok.result.content.length, 2);
  for (const frames of [
    [kiroFrame("toolUseEvent", { toolUseId: "a", name: wireName, input: "{}" })],
    [kiroFrame("toolUseEvent", { toolUseId: "a", name: "unknown", input: "{}", stop: true })],
    [kiroFrame("toolUseEvent", { toolUseId: "a", name: wireName, input: '{"path":', stop: true })],
    [kiroFrame("toolUseEvent", { toolUseId: "a", name: wireName, input: "[]", stop: true })],
    [kiroFrame("toolUseEvent", { toolUseId: "a", name: wireName, input: '{"path":1}', stop: true })],
    [kiroFrame("toolUseEvent", { toolUseId: "a", name: wireName, input: '{"path":"ok"}', stop: true }), kiroFrame("toolUseEvent", { toolUseId: "a", stop: true })],
  ]) {
    const fail = await run(ctx, async () => kiroResponse(frames));
    assert.equal(fail.result.stopReason, "error"); assert.match(fail.result.errorMessage!, /工具/); assert.equal(fail.events.at(-1)?.type, "error");
  }
});

test("Kiro rejects corrupted CRC, incomplete prelude/frame, wrong media and empty streams", async () => {
  const frame = kiroFrame("assistantResponseEvent", { content: "text" });
  const corrupt = Buffer.from(frame); corrupt[corrupt.length - 5] ^= 1;
  const badPrelude = Buffer.from(frame); badPrelude[8] ^= 1;
  for (const bytes of [corrupt, badPrelude, frame.subarray(0, 10), frame.subarray(0, -1), Buffer.alloc(0)]) {
    const fail = await run(user(), async () => kiroResponse([bytes]));
    assert.equal(fail.result.stopReason, "error"); assert.match(fail.result.errorMessage!, /帧/);
  }
  const wrong = await run(user(), async () => new Response('PRIVATE-SERVER-BODY', { headers: { "content-type": "application/json" } }));
  assert.equal(wrong.result.stopReason, "error"); assert.ok(!wrong.result.errorMessage?.includes("PRIVATE"));
  for (const events of [[kiroFrame("unknownFutureEvent", { something: true })], [kiroFrame("assistantResponseEvent", { content: "" })]]) {
    const empty = await run(user(), async () => kiroResponse(events));
    assert.equal(empty.result.stopReason, "error"); assert.match(empty.result.errorMessage!, /空回复/);
  }
});

test("Kiro preserves native reasoning, separate credits and usage absence, rejects filtered responses", async () => {
  const ok = await run(user(), async () => kiroResponse([
    kiroFrame("reasoningContentEvent", { text: "consider", signature: "signature" }),
    kiroFrame("assistantResponseEvent", { content: "answer" }),
    kiroFrame("contextUsageEvent", { contextUsagePercentage: 25 }), kiroFrame("meteringEvent", { usage: 0.5, unit: "credit" }),
  ]));
  assert.equal(ok.result.stopReason, "stop"); assert.deepEqual(ok.result.content[0], { type: "thinking", thinking: "consider", thinkingSignature: "signature" });
  assert.deepEqual(ok.result.usage, { ...zero,
    axiomKiro: { version: 1, scope: "request", state: "unknown", pricing: { kind: "unknown", rates: model().cost } } });
  assert.equal(ok.result.diagnostics?.length, 4);
  assert.equal(ok.result.diagnostics?.find(item => item.type === "kiro-completion-inferred")?.details?.policy, "local-eof-policy");
  const filtered = await run(user(), async () => kiroResponse([kiroFrame("metadataEvent", { stopReason: "CONTENT_FILTERED", stopDetails: { refusal: { explanation: "PRIVATE-SERVICE" } } })]));
  assert.equal(filtered.result.stopReason, "error"); assert.match(filtered.result.errorMessage!, /拦截/); assert.ok(!filtered.result.errorMessage?.includes("PRIVATE"));
});

test("Kiro sanitizes failures and publishes no replay hint after partial output", async () => {
  for (const status of [400, 401, 403, 429, 503]) {
    let calls = 0;
    const result = await run(user(), async () => { calls++; return new Response("PRIVATE-SERVICE", { status }); });
    assert.equal(result.result.stopReason, "error"); assert.equal(calls, 1); assert.ok(!result.result.errorMessage?.includes("PRIVATE"));
  }
  const partial = await run(user(), async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "partial" }), kiroFrame("", { message: "PRIVATE" }, { ":message-type": "exception", ":exception-type": "ThrottlingException" })]));
  assert.equal(partial.result.stopReason, "error"); assert.doesNotMatch(partial.result.errorMessage!, /429|500|rate.?limit|context.length.exceeded/i);
  const failure = partial.result.diagnostics?.find(item => item.type === "kiro-failure");
  assert.equal(failure?.details?.category, "throttle"); assert.equal(failure?.details?.status, 200); assert.equal(failure?.details?.partial, true);
  const transport = await run(user(), async () => { throw Error("PRIVATE-ACCESS PRIVATE-URL"); });
  assert.ok(!transport.result.errorMessage?.includes("PRIVATE"));
});

test("Kiro honors abort and timeout, including transport ignoring an abort and stalled body", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const pending = run(user(), async () => {
    setTimeout(() => controller.abort(), 10);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
  }, { signal: controller.signal });
  assert.equal((await pending).result.stopReason, "aborted"); assert.ok(cancelled);
  const late = new AbortController(); let lateCancel = false;
  const result = await run(user(), async () => {
    late.abort(); return new Response(new ReadableStream({ cancel() { lateCancel = true; } }));
  }, { signal: late.signal });
  assert.equal(result.result.stopReason, "aborted"); assert.ok(lateCancel);
  // The fake body has no socket; AbortSignal.timeout does not keep Node alive.
  const keepAlive = setInterval(() => {}, 100);
  try {
    const timed = await run(user(), async () => new Response(new ReadableStream(), { headers: { "content-type": "application/vnd.amazon.eventstream" } }), { timeoutMs: 10 });
    assert.equal(timed.result.stopReason, "error"); assert.match(timed.result.errorMessage!, /超时/);
  } finally { clearInterval(keepAlive); }
});

test("Kiro rejects malformed images, orphan tool results and payload identity changes before network", async () => {
  let count = 0; const fetch: typeof globalThis.fetch = async () => { count++; throw Error("MUST NOT FETCH"); };
  const image: Context = { messages: [{ role: "user", timestamp: 1, content: [{ type: "image", data: "not-base64", mimeType: "image/png" }] }] };
  const orphan: Context = { messages: [{ role: "toolResult", toolCallId: "orphan", toolName: "read", isError: false, content: [], timestamp: 1 }] };
  for (const ctx of [image, orphan]) assert.equal((await run(ctx, fetch)).result.stopReason, "error");
  const changed = await run(user(), fetch, { onPayload: p => ({ ...p as object, profileArn: "fake" }) });
  assert.equal(changed.result.stopReason, "error"); assert.equal(count, 0);
});

test("Kiro opaque auth capabilities contain no tokens, are isolated and one-use", async () => {
  const chat = kiroChat(kiroOAuth()), second = kiroChat(kiroOAuth());
  const auth = await chat.auth.toAuth(account()); assert.match(auth.apiKey!, /^axiom-kiro-native:/); assert.ok(!JSON.stringify(auth).includes("PRIVATE"));
  const options = { apiKey: auth.apiKey, fetch: async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" })]) };
  assert.equal((await second.stream(model(), normalizeContext(user()), options).result()).stopReason, "error");
  assert.equal((await chat.stream(model(), normalizeContext(user()), options).result()).stopReason, "stop");
  assert.equal((await chat.stream(model(), normalizeContext(user()), options).result()).stopReason, "error");
  let requests = 0;
  for (const target of [{ ...model(), api: "openai-completions" }, { ...model(), baseUrl: "https://untrusted.invalid" }]) {
    const result = await run(user(), async () => { requests++; throw Error("MUST NOT FETCH"); }, {}, account(), target as Model<"kiro-chat">);
    assert.equal(result.result.stopReason, "error");
  }
  assert.equal(requests, 0);
});

test("Kiro cancels permanently stalled hooks and transports, and releases responses arriving after cancellation", async () => {
  const never = () => new Promise<never>(() => {});
  for (const stage of ["payload", "response", "event", "fetch"] as const) {
    const controller = new AbortController(); let cancelled = false;
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      const { result } = await run(user(), async () => {
        if (stage === "fetch") return never();
        const frame = kiroFrame("assistantResponseEvent", { content: "late" });
        return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(frame); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
      }, { signal: controller.signal, ...(stage === "payload" ? { onPayload: never } : {}), ...(stage === "response" ? { onResponse: never } : {}), ...(stage === "event" ? { onProviderStreamEvent: never } : {}) });
      assert.equal(result.stopReason, "aborted", stage); if (stage === "response" || stage === "event") assert.ok(cancelled, stage);
    } finally { clearTimeout(timer); }
  }
  let deliver!: (response: Response) => void, released = false;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10);
  const aborted = await run(user(), () => new Promise(resolve => { deliver = resolve; }), { signal: controller.signal });
  clearTimeout(timer); assert.equal(aborted.result.stopReason, "aborted");
  deliver(new Response(new ReadableStream({ cancel() { released = true; } })));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.ok(released);
  const keepAlive = setInterval(() => {}, 100);
  try {
    const timed = await run(user(), never, { timeoutMs: 10 });
    assert.equal(timed.result.stopReason, "error"); assert.match(timed.result.errorMessage!, /超时/);
  } finally { clearInterval(keepAlive); }
});

test("Kiro never replays hidden reasoning as assistant prose and rejects old call IDs before completion", async () => {
  const ctx: Context = { ...user(), tools: [tool], messages: [
    ...user().messages,
    { role: "assistant", api: "kiro-chat", provider: "kiro", model: model().id, usage: zero, timestamp: 2, stopReason: "toolUse", content: [
      { type: "thinking", thinking: "historical derivation", thinkingSignature: "OPAQUE-SIGNATURE" },
      { type: "thinking", thinking: "", redacted: true, thinkingSignature: "OPAQUE-REDACTED" },
      { type: "toolCall", id: "old-call", name: tool.name, arguments: { path: "old" } },
    ] },
    { role: "toolResult", toolCallId: "old-call", toolName: tool.name, content: [{ type: "text", text: "old result" }], isError: false, timestamp: 3 },
    { role: "user", content: "again", timestamp: 4 },
  ] };
  const request = kiroChatRequest(model(), normalizeContext(ctx), account());
  assert.doesNotMatch(JSON.stringify(request.payload), /historical derivation|axiom_prior_reasoning|OPAQUE/);
  assert.deepEqual(request.historyNotice, { omittedReasoningTextBlocks: 1, opaqueReasoningBlocks: 1, omittedSignatures: 2 });
  const prior = request.payload.conversationState.history?.[1];
  assert.ok(prior && "assistantResponseMessage" in prior);
  assert.equal(prior.assistantResponseMessage.toolUses?.[0].toolUseId, "old-call");
  const wireName = [...request.names.keys()][0];
  const result = await run(ctx, async () => kiroResponse([kiroFrame("toolUseEvent", { toolUseId: "old-call", name: wireName, input: '{"path":"again"}', stop: true })]));
  assert.equal(result.result.stopReason, "error"); assert.match(result.result.errorMessage!, /既有历史重复/);
  assert.equal(result.events.filter(event => event.type === "toolcall_end").length, 0);
  assert.equal(result.result.diagnostics?.[0].type, "kiro-reasoning-history-omitted");
});

test("Kiro preserves literal reasoning-like tags in user and final answer text without exposing thinking blocks", () => {
  const literal = "<axiom_prior_reasoning>literal quoted data</axiom_prior_reasoning>";
  const ctx: Context = { messages: [
    { role: "user", content: literal, timestamp: 1 },
    { role: "assistant", api: "kiro-chat", provider: "kiro", model: model().id, usage: zero, timestamp: 2, stopReason: "stop", content: [
      { type: "thinking", thinking: "PRIVATE DERIVATION", thinkingSignature: "PRIVATE SIGNATURE" },
      { type: "text", text: `The literal is ${literal}` },
    ] },
    { role: "user", content: "Continue", timestamp: 3 },
  ] };
  const { payload } = kiroChatRequest(model(), normalizeContext(ctx), account());
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /PRIVATE DERIVATION|PRIVATE SIGNATURE/);
  assert.ok(serialized.includes(literal));
  assert.ok(serialized.includes(`The literal is ${literal}`), "no regex stripping of ordinary answer text");
});

test("Kiro partial usage cannot erase a complete snapshot or pretend missing counters are exact", async () => {
  const complete = { uncachedInputTokens: 10, outputTokens: 3, cacheReadInputTokens: 2, cacheWriteInputTokens: 1, totalTokens: 16 };
  for (const partial of [{}, { outputTokens: 4 }, { uncachedInputTokens: 10, outputTokens: 4 }, { uncachedInputTokens: 10, outputTokens: 4, totalTokens: 17 }]) {
    const result = await run(user(), async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" }), kiroFrame("metadataEvent", { tokenUsage: complete }), kiroFrame("metadataEvent", { tokenUsage: partial })]));
    assert.equal(result.result.stopReason, "stop"); assert.equal(result.result.usage.totalTokens, 16);
    assert.ok(result.result.diagnostics?.some(item => item.type === "kiro-usage-incomplete"));
  }
  const empty = await run(user(), async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" }), kiroFrame("metadataEvent", { tokenUsage: {} })]));
  assert.ok(empty.result.diagnostics?.some(item => item.type === "kiro-usage-unavailable"));
  const inconsistent = await run(user(), async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" }), kiroFrame("metadataEvent", { tokenUsage: { ...complete, totalTokens: 1 } })]));
  assert.equal(inconsistent.result.stopReason, "error"); assert.match(inconsistent.result.errorMessage!, /不一致/);
});

test("Kiro explicit European profile selects runtime EU, not its SSO authentication region", async () => {
  const profileArn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/enterprise";
  const result = await run(user(), async (input, init) => {
    assert.equal(String(input), "https://runtime.eu-central-1.kiro.dev/"); assert.equal(JSON.parse(String(init?.body)).profileArn, profileArn);
    return kiroResponse([kiroFrame("assistantResponseEvent", { content: "EU" })]);
  }, {}, account({ authRegion: "ap-northeast-1", authMethod: "identity-center", profileArn }));
  assert.equal(result.result.stopReason, "stop");
});

test("Kiro drives a real Pi Agent tool loop and never executes a tool from an errored stream", async () => {
  for (const damaged of [false, true]) {
    const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account());
    const models = createModels({ credentials }); models.setProvider(kiroProvider());
    let requests = 0, executions = 0;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const state = JSON.parse(String(init?.body)).conversationState; requests++;
      if (requests === 1) {
        const name = state.currentMessage.userInputMessage.userInputMessageContext.tools[0].toolSpecification.name;
        const frames = [kiroFrame("toolUseEvent", { toolUseId: "agent-call", name, input: '{"path":"fixture"}', stop: true })];
        if (damaged) frames.push(kiroFrame("metadataEvent", {}).subarray(0, 15));
        return kiroResponse(frames, 2);
      }
      assert.equal(state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].toolUseId, "agent-call");
      assert.equal(state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].content[0].text, "tool result");
      return kiroResponse([kiroFrame("assistantResponseEvent", { content: "Completed through Agent" })]);
    };
    const agent = new Agent({ initialState: { model: model(), systemPrompt: "You are Axiom", tools: [{ ...tool, label: "fixture tool", execute: async (_id, args) => {
      executions++; assert.deepEqual(args, { path: "fixture" }); return { content: [{ type: "text", text: "tool result" }], details: {} };
    } }] }, streamFn: (target, context, options) => models.streamSimple(target, context, { ...options, fetch }) });
    await agent.prompt("Use the fixture tool");
    assert.equal(executions, damaged ? 0 : 1); assert.equal(requests, damaged ? 1 : 2);
    const last = agent.state.messages.at(-1)!; assert.equal(last.role, "assistant");
    if (last.role === "assistant") assert.equal(last.stopReason, damaged ? "error" : "stop");
  }
});

test("Kiro native OAuth refresh remains serialized and opaque capabilities expire", async () => {
  let count = 0;
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("kiro", async () => account({ expires: 1, startUrl: "https://view.awsapps.com/start", clientId: "CLIENT", clientSecret: "SECRET", clientSecretExpiresAt: Date.now() + 86400000 }));
  const models = createModels({ credentials }); models.setProvider(kiroProvider({ fetch: async (input, init) => {
    count++; assert.equal(String(input), "https://oidc.us-east-1.amazonaws.com/token");
    assert.equal(JSON.parse(String(init?.body)).refreshToken, "PRIVATE-REFRESH");
    return new Response(JSON.stringify({ accessToken: "NEW-PRIVATE", refreshToken: "ROTATED-PRIVATE", expiresIn: 3600 }), { headers: { "content-type": "application/json" } });
  } }));
  const results = await Promise.all(Array.from({ length: 6 }, () => models.getAuth("kiro")));
  assert.equal(count, 1); assert.equal(new Set(results.map(result => result!.auth.apiKey)).size, 6);
  assert.ok(results.every(result => !JSON.stringify(result).includes("PRIVATE")));
  const chat = kiroChat(kiroOAuth()), auth = await chat.auth.toAuth(account()), originalNow = Date.now;
  let calls = 0;
  try {
    const now = Date.now(); Date.now = () => now + 61000;
    const result = await chat.stream(model(), normalizeContext(user()), { apiKey: auth.apiKey, fetch: async () => { calls++; throw Error("MUST NOT FETCH"); } }).result();
    assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /过期/); assert.equal(calls, 0);
  } finally { Date.now = originalNow; }
});

test("Kiro parses every AWS header type and rejects malformed, duplicate pseudoheaders and oversized preludes", async () => {
  const original = kiroFrame("assistantResponseEvent", { content: "ok" });
  const append = (name: string, type: number, value: Uint8Array) => {
    const key = Buffer.from(name), header = Buffer.concat([Buffer.from([key.length]), key, Buffer.from([type]), value]);
    const oldLength = original.readUInt32BE(4), frame = Buffer.concat([original.subarray(0, 12 + oldLength), header, original.subarray(12 + oldLength)]);
    frame.writeUInt32BE(frame.length); frame.writeUInt32BE(oldLength + header.length, 4); frame.writeUInt32BE(fixtureCrc(frame.subarray(0, 8)), 8); frame.writeUInt32BE(fixtureCrc(frame.subarray(0, -4)), frame.length - 4);
    return frame;
  };
  for (const [type, value] of [[0, Buffer.alloc(0)], [1, Buffer.alloc(0)], [2, Buffer.alloc(1)], [3, Buffer.alloc(2)], [4, Buffer.alloc(4)], [5, Buffer.alloc(8)], [6, Buffer.from([0, 2, 1, 2])], [7, Buffer.from([0, 2, 97, 98])], [8, Buffer.alloc(8)], [9, Buffer.alloc(16)]] as const) {
    assert.equal((await run(user(), async () => kiroResponse([append("extension", type, value)]))).result.stopReason, "stop");
  }
  for (const frame of [append(":event-type", 7, Buffer.from([0, 1, 97])), append(":extra", 0, Buffer.alloc(0)), append("extension", 7, Buffer.from([0, 9, 97])), append("extension", 10, Buffer.alloc(0))]) {
    assert.equal((await run(user(), async () => kiroResponse([frame]))).result.stopReason, "error");
  }
  const huge = Buffer.alloc(12); huge.writeUInt32BE(16 * 1024 * 1024 + 1); huge.writeUInt32BE(fixtureCrc(huge.subarray(0, 8)), 8);
  assert.equal((await run(user(), async () => kiroResponse([huge]))).result.stopReason, "error");
});

test("Kiro enforces request and argument limits, and does not silently override tool choice", async () => {
  let count = 0; const noFetch: typeof globalThis.fetch = async () => { count++; throw Error("MUST NOT FETCH"); };
  const oversized = await run(user("a".repeat(10 * 1024 * 1024)), noFetch);
  assert.equal(oversized.result.stopReason, "error"); assert.match(oversized.result.errorMessage!, /10 MiB/); assert.equal(count, 0);
  const choice = await run(user(), noFetch, { toolChoice: "none" } as StreamOptions);
  assert.equal(choice.result.stopReason, "error"); assert.match(choice.result.errorMessage!, /工具选择/); assert.equal(count, 0);
  const ctx = { ...user(), tools: [tool] }, name = [...kiroChatRequest(model(), normalizeContext(ctx), account()).names.keys()][0];
  const large = await run(ctx, async () => kiroResponse([kiroFrame("toolUseEvent", { name, toolUseId: "large", input: JSON.stringify({ path: "a".repeat(1024 * 1024) }), stop: true })]));
  assert.equal(large.result.stopReason, "error"); assert.match(large.result.errorMessage!, /1 MiB/);
});
