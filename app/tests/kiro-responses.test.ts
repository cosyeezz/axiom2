import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, InMemoryCredentialStore, normalizeContext, Type, type Context, type Model, type StreamOptions, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import { kiroResponsesRequest, readKiroSse } from "../src/server/providers/kiro-responses.js";
import { kiroCliUserAgent } from "../src/server/providers/kiro-native.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";

const model: Model<"kiro-chat"> = { id: "deepseek-3.2", name: "Deepseek", api: "kiro-chat", provider: "kiro", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const account: KiroCredential = { type: "oauth", access: "FIXTURE-SECRET", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" };
const context = (): Context => ({ systemPrompt: "Keep Axiom custom safety policy.", messages: [{ role: "user", content: "你好", timestamp: 1 }] });
const tool = { name: "namespace.read", description: "Axiom caller-owned tool", parameters: Type.Object({ path: Type.String() }) };
type Json = Record<string, any>;
const completed = (output: Json[], patch: Json = {}): Json => ({ type: "response.completed", response: { id: "resp-1", status: "completed", model: model.id, output, usage: { "kiro:credits": 0.1 }, ...patch } });
const textItem = (text = "你好🌏") => ({ type: "message", id: "msg-1", role: "assistant", status: "completed", content: [{ type: "output_text", text }] });
function textEvents(text = "你好🌏"): Json[] {
  const item = textItem(text);
  return [
    { type: "response.created", response: { id: "resp-1", model: model.id } },
    { type: "response.in_progress", response: { id: "resp-1", model: model.id } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
    { type: "response.content_part.added", output_index: 0, item_id: item.id, content_index: 0, part: { type: "output_text", text: "" } },
    { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: text },
    { type: "response.output_text.done", output_index: 0, item_id: item.id, content_index: 0, text },
    { type: "response.content_part.done", output_index: 0, item_id: item.id, content_index: 0, part: item.content[0] },
    { type: "response.output_item.done", output_index: 0, item }, completed([item]),
  ];
}
function response(events: Json[], chunk = 11) {
  const bytes = new TextEncoder().encode(events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  let cursor = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (cursor === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(cursor, cursor += Math.min(chunk, bytes.length - cursor)));
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
async function run(fetch: typeof globalThis.fetch, ctx = context(), options: StreamOptions = {}) {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  const stream = models.stream(model, ctx, { fetch, ...options }), events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { result: await stream.result(), events };
}
// Captured live shape: tool turns end with status requires_action (responses-live-02).
function toolEvents(name: string, args = '{"path":"文件.md"}', status = "requires_action"): Json[] {
  const item = { type: "function_call", id: "fc-1", call_id: "call-1", name, arguments: args };
  return [{ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
    { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: args.slice(0, 8) },
    { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: args.slice(8) },
    { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: args },
    { type: "response.output_item.done", output_index: 0, item }, completed([item], { status })];
}

test("captured Responses shape routes deepseek with native auth, full context, privacy and raw hooks", async () => {
  const observed: string[] = []; let payloadHook = false, responseHook = false;
  const { result, events } = await run(async (url, init) => {
    assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/v1/responses");
    const headers = new Headers(init?.headers), body = JSON.parse(String(init?.body));
    assert.equal(headers.get("authorization"), "Bearer FIXTURE-SECRET");
    assert.equal(headers.get("user-agent"), kiroCliUserAgent());
    assert.equal(headers.get("x-kiro-injected"), null);
    assert.equal(headers.get("content-type"), "application/json"); assert.equal(headers.get("accept"), null);
    assert.equal(headers.get("x-amz-target"), null); assert.equal(headers.get("x-amzn-codewhisperer-optout"), "true");
    assert.equal(headers.get("x-amzn-kiro-origin"), "KIRO_CLI"); assert.equal(headers.get("x-kiro-attempt"), "1;max=1");
    assert.equal(body.model, model.id); assert.equal(body.stream, true); assert.equal(body.origin, "KIRO_CLI");
    assert.match(body.input[0].content, /Keep Axiom custom safety policy[\s\S]*你好/);
    assert.equal(body.fixture, true); assert.ok(!JSON.stringify(body).includes("FIXTURE-"));
    return response(textEvents(), 1);
  }, context(), { headers: { "User-Agent": "Pi injected", "x-kiro-injected": "not-native" }, onPayload: payload => { payloadHook = true; return { ...payload as object, fixture: true }; },
    onResponse: () => { responseHook = true; }, onProviderStreamEvent: event => { observed.push((event as Json).type); } });
  assert.equal(result.stopReason, "stop"); assert.deepEqual(result.content, [{ type: "text", text: "你好🌏" }]);
  assert.equal(result.responseId, "resp-1"); assert.equal(observed.length, 9); assert.ok(payloadHook && responseHook);
  assert.equal(events.filter(e => e.type === "done").length, 1); assert.equal(events.filter(e => e.type === "start").length, 1);
  assert.ok(result.diagnostics?.some(d => d.type === "kiro-usage-unavailable"));
  assert.ok(result.diagnostics?.some(d => d.type === "kiro-responses-completed"));
});

test("Responses parameter failures are explicit across HTTP and SSE while partial replies stay non-replayable", async () => {
  const error = { type: "invalid_request", code: "invalid_value", param: "input.0.call_id", message: "PRIVATE must not leak" };
  for (const variant of ["http", "response.failed", "error", "partial"] as const) {
    let calls = 0;
    const { result, events } = await run(async url => {
      calls++; assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/v1/responses");
      if (variant === "http") return new Response(JSON.stringify({ error }), { status: 400 });
      const failure = variant === "error" ? { ...error, type: "error" } : { type: "response.failed", response: { error } };
      return response([...(variant === "partial" ? textEvents().slice(0, 5) : []), failure]);
    });
    assert.equal(calls, 1); assert.equal(result.stopReason, "error");
    assert.equal(events.filter(event => event.type === "error").length, 1); assert.ok(!events.some(event => event.type === "done"));
    assert.equal(result.diagnostics?.find(item => item.type === "kiro-failure")?.details?.category, "validation");
    assert.match(result.errorMessage!, variant === "partial" ? /已收到部分内容.*未重放请求/ : /请求参数验证失败/);
    assert.doesNotMatch(JSON.stringify(result.diagnostics) + result.errorMessage, /PRIVATE/);
    assert.doesNotMatch(result.errorMessage!, /input\.0\.call_id/);
  }
});

test("Responses validates separate text content parts without dropping either", async () => {
  const item = { ...textItem(), content: [{ type: "output_text", text: "first" }, { type: "output_text", text: "second" }] };
  const events: Json[] = [{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } }];
  for (let content_index = 0; content_index < 2; content_index++) {
    const text = item.content[content_index].text;
    events.push({ type: "response.output_text.delta", output_index: 0, content_index, delta: text }, { type: "response.output_text.done", output_index: 0, content_index, text });
  }
  events.push({ type: "response.output_item.done", output_index: 0, item }, completed([item]));
  const { result } = await run(async () => response(events));
  assert.equal(result.stopReason, "stop"); assert.deepEqual(result.content, [{ type: "text", text: "firstsecond" }]);
});

// Event name captured live on claude-opus-5.5 high (chat-live-10). KAS 0.66.70 JOo ignores reasoning_part.* entirely
// and reads reasoning text only from reasoning_text.delta / reasoning.delta; part payload shape is not captured.
function reasoningEvents(partAdded: Json = { type: "reasoning_text", text: "" }, target = 0, delta = "response.reasoning_text.delta"): Json[] {
  const reasoning = { type: "reasoning", id: "rs-1", summary: [] }, item = { ...textItem(), id: "msg-2" };
  const text = textEvents().filter(e => e.output_index === 0 && e.type !== "response.completed").map(e => ({ ...e, output_index: 1, ...(e.item_id ? { item_id: item.id } : {}), ...(e.item ? { item: { ...e.item, id: item.id } } : {}) }));
  return [
    { type: "response.created", response: { id: "resp-1", model: model.id } },
    { type: "kiro:keep_alive" },
    { type: "response.output_item.added", output_index: 0, item: reasoning },
    ...text.slice(0, 1),
    { type: "response.reasoning_part.added", output_index: target, item_id: target ? item.id : reasoning.id, content_index: 0, part: partAdded },
    { type: delta, output_index: 0, item_id: reasoning.id, content_index: 0, delta: "思考" },
    { type: "response.reasoning_text.done", output_index: 0, item_id: reasoning.id, content_index: 0, text: "思考" },
    { type: "response.reasoning_part.done", output_index: 0, item_id: reasoning.id, content_index: 0, part: { type: "reasoning_text", text: "思考" } },
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    ...text.slice(1), completed([reasoning, item]),
  ];
}

test("Responses ignores reasoning part boundaries like KAS and keeps reasoning and text", async () => {
  for (const fixture of [reasoningEvents(), reasoningEvents({ type: "reasoning_text", text: "part-only" }), reasoningEvents(undefined, 1), reasoningEvents(undefined, 0, "response.reasoning.delta")]) {
    const { result } = await run(async () => response(fixture));
    assert.equal(result.stopReason, "stop");
    assert.equal(result.content.filter(c => c.type === "text").map(c => (c as { text: string }).text).join(""), "你好🌏");
    const thinking = result.content.filter(c => c.type === "thinking").map(c => (c as { thinking: string }).thinking).join("");
    assert.equal(thinking, "思考");
  }
});

test("Responses tools preserve aliases, schema, call IDs and error results across turns", async () => {
  const ctx = { ...context(), tools: [tool] };
  const original = kiroChatRequest(model, normalizeContext(ctx), account);
  const name = [...original.names.keys()][0];
  const { result } = await run(async (_url, init) => {
    const b = JSON.parse(String(init?.body));
    assert.deepEqual(b.tools, [{ type: "function", name, description: tool.description, parameters: tool.parameters }]);
    return response(toolEvents(name));
  }, ctx);
  assert.equal(result.stopReason, "toolUse");
  assert.deepEqual(result.content, [{ type: "toolCall", id: "call-1", name: tool.name, arguments: { path: "文件.md" } }]);
  const next: Context = { ...ctx, messages: [...ctx.messages, result, { role: "toolResult", toolCallId: "call-1", toolName: tool.name, isError: true, timestamp: 3, content: [{ type: "text", text: "permission denied" }] }] };
  const again = await run(async (_url, init) => {
    const b = JSON.parse(String(init?.body));
    assert.equal(b.input[1].type, "function_call"); assert.equal(b.input[1].call_id, "call-1");
    assert.equal(b.input[2].type, "function_call_output"); assert.equal(b.input[2].call_id, "call-1");
    assert.deepEqual(JSON.parse(b.input[2].output), { status: "error", content: [{ text: "permission denied" }] });
    return response(textEvents("done"));
  }, next);
  assert.equal(again.result.stopReason, "stop");
});

test("Responses rejects bad tool schema, unknown tools and truncated or inconsistent lifecycle", async () => {
  const ctx = { ...context(), tools: [tool] }, name = [...kiroChatRequest(model, normalizeContext(ctx), account).names.keys()][0];
  const badFinal = textEvents(); badFinal.at(-1)!.response.output[0].content[0].text = "changed";
  for (const fixture of [toolEvents(name, '{"path":12}'), toolEvents("unregistered"), toolEvents(name, '{"path":'), textEvents().slice(0, -1), badFinal,
    [completed([])], [...textEvents(), ...textEvents()], [{ type: "response.incomplete", response: {} }]]) {
    const { result, events } = await run(async () => response(fixture), ctx);
    assert.equal(result.stopReason, "error"); assert.equal(events.filter(e => e.type === "done").length, 0);
    assert.ok(!result.errorMessage?.includes("FIXTURE-SECRET"));
  }
});

test("Responses accepts requires_action only for tool turns, and completed tool turns", async () => {
  const ctx = { ...context(), tools: [tool] }, name = [...kiroChatRequest(model, normalizeContext(ctx), account).names.keys()][0];
  for (const status of ["requires_action", "completed"]) {
    const { result } = await run(async () => response(toolEvents(name, undefined, status)), ctx);
    assert.equal(result.stopReason, "toolUse");
  }
  const text = textEvents(); text.at(-1)!.response.status = "requires_action";
  const { result } = await run(async () => response(text), ctx);
  assert.equal(result.stopReason, "error");
  assert.equal((result.diagnostics?.find(d => d.type === "kiro-failure")?.details as Json).protocolCode, "response-terminal-mismatch");
  for (const status of ["in_progress", "failed", "incomplete"]) {
    const { result: bad } = await run(async () => response(toolEvents(name, undefined, status)), ctx);
    assert.equal(bad.stopReason, "error");
  }
});

test("Responses failures carry a fixed local protocol code without provider text", async () => {
  const ctx = { ...context(), tools: [tool] }, name = [...kiroChatRequest(model, normalizeContext(ctx), account).names.keys()][0];
  const mismatch = toolEvents(name); mismatch.at(-1)!.response.output = [];
  for (const [fixture, code] of [[toolEvents(name).slice(0, -1), "missing-completed"], [mismatch, "response-terminal-mismatch"]] as const) {
    const { result } = await run(async () => response(fixture as Json[]), ctx);
    const details = result.diagnostics?.find(d => d.type === "kiro-failure")?.details as Json;
    assert.equal(result.stopReason, "error"); assert.equal(details.protocolCode, code);
    assert.ok(!JSON.stringify(result).includes("FIXTURE-SECRET"));
  }
});

// KAS 0.66.70 JOo returns early for every event it does not handle; we ignore too but record the filtered type name.
test("Responses ignores unknown events like KAS and reports only filtered type names", async () => {
  const events = textEvents();
  events.splice(2, 0, { type: "response.surprise", detail: "FIXTURE-SECRET" }, { type: "response.SECRET text" }, { type: "x".repeat(81) }, { type: "response.surprise" });
  const { result } = await run(async () => response(events));
  assert.equal(result.stopReason, "stop"); assert.deepEqual(result.content, [{ type: "text", text: "你好🌏" }]);
  const details = result.diagnostics?.find(d => d.type === "kiro-responses-completed")?.details as Json;
  assert.deepEqual(details.ignoredEventTypes, { "response.surprise": 2, unsafe: 2 });
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  const many = textEvents(); many.splice(2, 0, ...Array.from({ length: 20 }, (_, i) => ({ type: `response.extra_${i}` })));
  const capped = (await run(async () => response(many))).result.diagnostics?.find(d => d.type === "kiro-responses-completed")?.details as Json;
  assert.equal(Object.keys(capped.ignoredEventTypes).length, 16);
  assert.equal((await run(async () => response([{ type: "response.surprise" }]))).result.stopReason, "error");
});

const incomplete = (reason?: string, output: Json[] = []): Json => ({ type: "response.incomplete", response: { id: "resp-1", status: "incomplete", model: model.id, output, ...(reason ? { incomplete_details: { reason } } : {}) } });
test("Responses maps incomplete reasons like KAS T2u and never executes held tools", async () => {
  const text = textEvents().slice(0, -1), item = textItem();
  for (const [fixture, stop, reason] of [[[...text, incomplete("max_output_tokens", [item])], "length", "MAX_TOKENS"], [[...text, incomplete("content_filter", [item])], "stop", "CONTENT_FILTERED"],
    [[...text, incomplete("new_reason", [item])], "stop", "END_TURN"], [[...text, incomplete(undefined, [item])], "stop", "END_TURN"],
    [[...text, completed([item], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })], "length", "MAX_TOKENS"],
    [textEvents().slice(0, 5).concat(incomplete("max_output_tokens")), "length", "MAX_TOKENS"]] as const) {
    const { result } = await run(async () => response(fixture as Json[]));
    assert.equal(result.stopReason, stop); assert.equal(result.content.map(c => (c as { text: string }).text).join(""), "你好🌏");
    assert.equal((result.diagnostics?.find(d => d.type === "kiro-responses-incomplete")?.details as Json).stopReason, reason);
  }
  const handoff = (await run(async () => response([...text, incomplete("compaction_required_for_model_handoff", [item])]))).result;
  assert.equal(handoff.stopReason, "error"); assert.match(handoff.errorMessage ?? "", /context length exceeded/);
  assert.equal((await run(async () => response([incomplete("content_filter")]))).result.stopReason, "error");
  const ctx = { ...context(), tools: [tool] }, name = [...kiroChatRequest(model, normalizeContext(ctx), account).names.keys()][0];
  const tools = toolEvents(name), call = tools.at(-1)!.response.output;
  assert.equal((await run(async () => response([...tools.slice(0, -1), incomplete("content_filter", call)]), ctx)).result.stopReason, "error");
  assert.equal((await run(async () => response([...tools.slice(0, -1), incomplete("max_output_tokens", call)]), ctx)).result.stopReason, "length");
  // Real Agent: a length stop fails the tool call instead of executing it.
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  let executions = 0;
  const agent = new Agent({ initialState: { model, systemPrompt: "s", tools: [{ ...tool, label: "fixture", execute: async () => { executions++; return { content: [], details: {} }; } }] },
    streamFn: (target, c, options) => models.streamSimple(target, c, { ...options, fetch: async (_u, init) => response([...toolEvents(JSON.parse(String(init?.body)).tools[0].name).slice(0, 3), incomplete("max_output_tokens")]) }) });
  await agent.prompt("Use the fixture tool");
  assert.equal(executions, 0);
});

test("Responses shows refusal text like KAS and deduplicates refusal.done", async () => {
  const item = { ...textItem(), content: [{ type: "refusal", refusal: "不能帮忙" }] };
  const start: Json[] = [{ type: "response.created", response: { id: "resp-1", model: model.id } }, { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } }];
  const done = { type: "response.refusal.done", output_index: 0, item_id: item.id, content_index: 0, refusal: "不能帮忙" };
  for (const middle of [[{ type: "response.refusal.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "不能" }, { type: "response.refusal.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "帮忙" }, done], [done]]) {
    const { result } = await run(async () => response([...start, ...middle, { type: "response.output_item.done", output_index: 0, item }, completed([item])]));
    assert.equal(result.stopReason, "stop"); assert.deepEqual(result.content, [{ type: "text", text: "不能帮忙" }]);
  }
  const wrong = { ...item, content: [{ type: "refusal", refusal: "其他" }] };
  assert.equal((await run(async () => response([...start, done, { type: "response.output_item.done", output_index: 0, item: wrong }, completed([wrong])]))).result.stopReason, "error");
});

// KAS 0.66.70 MOo: reasoning encrypted_content is a JSON envelope with redactedContent or reasoningText.signature.
test("Responses decodes reasoning encrypted_content like KAS", async () => {
  const withEncrypted = (encrypted: string) => reasoningEvents().map(e => e.type === "response.output_item.done" && e.item.type === "reasoning" ? { ...e, item: { ...e.item, encrypted_content: encrypted } } : e);
  const thinking = async (encrypted: string) => (await run(async () => response(withEncrypted(encrypted)))).result.content.filter(c => c.type === "thinking") as Json[];
  const signed = await thinking(JSON.stringify({ reasoningText: { text: "思考", signature: "sig-1" } }));
  assert.equal(signed.map(c => c.thinking).join(""), "思考"); assert.equal(signed.at(-1)!.thinkingSignature, "sig-1"); assert.ok(!signed.some(c => c.redacted));
  const redacted = await thinking(JSON.stringify({ redactedContent: "opaque" }));
  assert.ok(redacted.some(c => c.redacted === true && c.thinkingSignature === "opaque"));
  for (const bad of ["not-json", "[]", JSON.stringify({ other: 1 })]) {
    const plain = await thinking(bad);
    assert.equal(plain.map(c => c.thinking).join(""), "思考"); assert.ok(!plain.some(c => c.redacted || c.thinkingSignature));
  }
});

test("Responses observes failure events, sanitizes provider errors and never retries", async () => {
  let requests = 0, observed = 0;
  const { result } = await run(async () => { requests++; return response([{ type: "response.failed", response: { error: { code: "throttlingException", message: "FIXTURE-SECRET" } } }]); }, context(), { onProviderStreamEvent: () => { observed++; } });
  assert.equal(result.stopReason, "error"); assert.equal(requests, 1); assert.equal(observed, 1);
  assert.ok(!result.errorMessage?.includes("FIXTURE-SECRET"));
});

test("Responses cancellation bounds hooks and cancels body without terminal success", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const result = await run(async () => new Response(new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(textEvents()[2])}\n\n`));
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } }), context(),
  { signal: controller.signal, onProviderStreamEvent: () => { controller.abort(); return new Promise(() => {}); } });
  assert.equal(result.result.stopReason, "aborted"); assert.equal(cancelled, true);
  assert.equal(result.events.filter(e => e.type === "done").length, 0);
});

test("Responses payload guard rejects identity/model/stream substitution before sending", async () => {
  for (const patch of [{ model: "auto" }, { profileArn: "other" }, { origin: "other" }, { stream: false }]) {
    let calls = 0;
    const { result } = await run(async () => { calls++; return response(textEvents()); }, context(), { onPayload: p => ({ ...p as object, ...patch }) });
    assert.equal(calls, 0); assert.equal(result.stopReason, "error");
  }
});

test("Responses preserves images and caller context without mutation", () => {
  const ctx = normalizeContext({ ...context(), messages: [{ role: "user", timestamp: 1, content: [{ type: "text", text: "keep" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }] }] });
  const copy = structuredClone(ctx), { payload } = kiroChatRequest(model, ctx, account, "session");
  const request = kiroResponsesRequest(payload);
  const content = request.input[0].content as Json[];
  assert.match(content[0].text, /safety policy/); assert.equal(content[1].image_url, "data:image/png;base64,aGVsbG8=");
  assert.deepEqual(ctx, copy);
});

test("real Agent runs a complete Responses tool loop, never a truncated call", async () => {
  for (const truncated of [false, true]) {
    const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
    const models = createModels({ credentials }); models.setProvider(kiroProvider());
    let requests = 0, executions = 0;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      requests++;
      const b = JSON.parse(String(init?.body));
      if (requests === 1) {
        const events = toolEvents(b.tools[0].name);
        return response(truncated ? events.slice(0, -1) : events);
      }
      const output = b.input.find((item: Json) => item.type === "function_call_output");
      assert.equal(output.call_id, "call-1"); assert.equal(JSON.parse(output.output).content[0].text, "tool result");
      return response(textEvents("Agent completed"));
    };
    const agent = new Agent({ initialState: { model, systemPrompt: "Keep safety policy", tools: [{ ...tool, label: "fixture", execute: async (_id, args) => {
      executions++; assert.deepEqual(args, { path: "文件.md" });
      return { content: [{ type: "text", text: "tool result" }], details: {} };
    } }] }, streamFn: (target, ctx, options) => models.streamSimple(target, ctx, { ...options, fetch }) });
    await agent.prompt("Use the fixture tool");
    assert.equal(requests, truncated ? 1 : 2); assert.equal(executions, truncated ? 0 : 1);
    const last = agent.state.messages.at(-1)!; assert.equal(last.role, "assistant");
    if (last.role === "assistant") assert.equal(last.stopReason, truncated ? "error" : "stop");
  }
});

test("Responses times out a silent body, and rejects unexpected model or id at finish", async () => {
  let cancelled = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const { result } = await run(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } }), context(), { timeoutMs: 20 });
    assert.equal(result.stopReason, "error"); assert.ok(cancelled);
  } finally { clearTimeout(keepAlive); }
  for (const patch of [{ model: "auto" }, { id: "other" }]) {
    const events = textEvents(); Object.assign(events.at(-1)!.response, patch);
    const { result } = await run(async () => response(events)); assert.equal(result.stopReason, "error");
  }
});

test("Responses standard token counters are checked; credit-only usage is not token usage", async () => {
  const events = textEvents(); events.at(-1)!.response.usage = { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { cached_tokens: 3 } };
  const { result } = await run(async () => response(events));
  assert.equal(result.stopReason, "stop"); assert.equal(result.usage.input, 9); assert.equal(result.usage.cacheRead, 3); assert.equal(result.usage.output, 4); assert.equal(result.usage.totalTokens, 16);
  events.at(-1)!.response.usage.input_tokens_details.cached_tokens = 99;
  assert.equal((await run(async () => response(events))).result.stopReason, "error");
});

test("SSE rejects invalid UTF8, unframed JSON and truncated data", async () => {
  for (const bytes of [new Uint8Array([255]), new TextEncoder().encode('data: {"type":"unfinished"}'), new TextEncoder().encode('data: not-json\n\n')]) {
    await assert.rejects(async () => { for await (const _ of readKiroSse(new Response(bytes).body!, new AbortController().signal)) { /* consume */ } });
  }
});
