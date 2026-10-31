import assert from "node:assert/strict";
import { test } from "node:test";
import type { NativeContext, NativeStreamEvent, NativeTool, NativeToolCall } from "../src/native-providers/contracts.js";
import { createCodeBuddyClient, type CodeBuddyStreamInput } from "../src/native-providers/codebuddy/client.js";
import { codeBuddyBuiltinModels } from "../src/native-providers/codebuddy/models.js";
import { codeBuddyFailure } from "../src/native-providers/codebuddy/failure.js";
import { codeBuddyUsage } from "../src/native-providers/codebuddy/usage.js";
const model = codeBuddyBuiltinModels().find(model => model.id === "deepseek-v4.1-flash")!;
const context: NativeContext = { systemPrompt: "Caller security policy stays intact.", messages: [{ role: "user", content: "Read only the fixture." }],
  tools: [{ name: "read", description: "Read fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }] };
const validate = (_definition: NativeTool, call: NativeToolCall) => { assert.equal(typeof call.arguments.path, "string"); assert.deepEqual(Object.keys(call.arguments), ["path"]); return call.arguments; };
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: "response-fixture", model: model.id, choices: [{ index: 0, delta, finish_reason }] });
const encode = (items: unknown[], done = true) => items.map(item => `data: ${JSON.stringify(item)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
const sse = (items: unknown[], done = true) => new Response(encode(items, done), { headers: { "content-type": "text/event-stream" } });
async function drain(events: AsyncIterable<NativeStreamEvent>): Promise<NativeStreamEvent[]> {
  const result: NativeStreamEvent[] = []; for await (const event of events) result.push(event); return result;
}
async function collect(transport: typeof fetch, overrides: Partial<CodeBuddyStreamInput> = {}): Promise<NativeStreamEvent[]> {
  const client = createCodeBuddyClient(transport);
  try { return await drain(client.stream({ model, access: "FIXTURE", context, options: { reasoning: "off", validateToolInput: validate }, ...overrides })); }
  finally { client.dispose(); }
}
const success = (events: NativeStreamEvent[], reason = "stop") => { assert.deepEqual(events.at(-1), { type: "done", reason }); };
const failed = (events: NativeStreamEvent[]) => { assert.equal(events.at(-1)?.type, "error"); assert.ok(!events.some(event => event.type === "done" || event.type === "tool-end")); };

test("native request keeps caller policy and off, emits distinct trusted identities and upstream usage facts", async () => {
  let calls = 0, hooks = 0;
  const events = await collect(async (input, init) => {
    calls++; assert.equal(String(input), "https://copilot.tencent.com/v2/chat/completions");
    const body = JSON.parse(String(init?.body)), headers = new Headers(init?.headers);
    assert.equal(body.messages[0].content, context.systemPrompt); assert.equal(body.tools[0].function.name, "read");
    assert.equal(body.reasoning_effort, "none"); assert.equal(body.reasoning_summary, undefined); assert.equal(body.temperature, 0.2);
    assert.equal(headers.get("user-agent"), "CLI/2.179.0 CodeBuddy/2.179.0"); assert.equal(headers.get("authorization"), "Bearer FIXTURE");
    assert.equal(headers.get("x-conversation-id"), "session-fixture"); assert.equal(headers.get("x-conversation-request-id"), "run-fixture");
    assert.equal(headers.get("x-request-id"), "invocation-fixture"); assert.equal(headers.get("x-conversation-message-id"), "invocation-fixture");
    assert.equal(headers.get("x-agent-runtime"), null); assert.equal(init?.redirect, "error");
    return sse([chunk({ reasoning_content: "Do not hide noncompliance.", content: "完成", tool_calls: [] }, "stop"),
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112, prompt_tokens_details: { cached_tokens: 20 } } }]);
  }, { options: { reasoning: "off", validateToolInput: validate, sessionId: "session-fixture", continuationId: "run-fixture", identity: { invocationId: "invocation-fixture" },
    onPayload(payload) { return { ...(payload as object), temperature: 0.2 }; }, onProviderEvent() { hooks++; } } });
  success(events); assert.equal(calls, 1); assert.equal(hooks, 2);
  assert.ok(events.some(event => event.type === "thinking"));
  assert.deepEqual(events.find(event => event.type === "usage" && event.state === "complete"), { type: "usage", state: "complete", counts: { input: 80, output: 12, cacheRead: 20, cacheWrite: 0, totalTokens: 112 } });
});

test("tool fragments are candidates until clean terminal and strict schema, then replay paired results", async () => {
  let validations = 0;
  const first = await collect(async () => sse([
    chunk({ tool_calls: [{ index: 0, id: "call-one", type: "function", function: { name: "read", arguments: '{"path":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"fixture"}' } }] }, "tool_calls"),
  ]), { options: { validateToolInput(definition, call) { validations++; return validate(definition, call); } } });
  success(first, "toolUse"); assert.equal(validations, 1);
  const end = first.find(event => event.type === "tool-end"); assert.ok(end?.type === "tool-end");
  const next: NativeContext = { ...context, messages: [...context.messages,
    { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...end.call }] },
    { role: "toolResult", toolCallId: "call-one", toolName: "read", isError: false, content: "RESULT" }, { role: "user", content: "Next turn" }] };
  const result = await collect(async (_input, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.messages[0].content, context.systemPrompt);
    assert.equal(body.messages[3].tool_call_id, "call-one"); assert.equal(body.messages[3].content, "RESULT");
    return sse([chunk({ content: "NEXT" }, "stop")]);
  }, { context: next }); success(result);
});

test("empty tool-name continuation is a no-op only after a valid declared tool", async () => {
  let validations = 0;
  const events = await collect(async () => sse([
    chunk({ function_call: null, tool_calls: [{ index: 0, id: "empty-name-call", type: "function", function: { name: "read", arguments: "" } }] }, ""),
    chunk({ function_call: null, tool_calls: [{ index: 0, function: { name: "", arguments: '{"' } }] }, ""),
    chunk({ function_call: null, tool_calls: [{ index: 0, function: { name: "", arguments: 'path":"fixture"}' } }] }, ""),
    chunk({ function_call: { name: "", arguments: "" }, tool_calls: [] }, "tool_calls"),
  ]), { options: { toolChoice: "required", validateToolInput(definition, call) { validations++; return validate(definition, call); } } });
  success(events, "toolUse"); assert.equal(validations, 1);
  assert.equal(events.filter(event => event.type === "tool-start").length, 1);
  assert.deepEqual(events.find(event => event.type === "tool-end"), { type: "tool-end", call: { id: "empty-name-call", name: "read", arguments: { path: "fixture" } } });
});

test("empty tool-name continuation never weakens initial identity schema or terminal checks", async () => {
  const first = chunk({ tool_calls: [{ index: 0, id: "empty-name-call", type: "function", function: { name: "read", arguments: "" } }] }, "");
  const final = chunk({ tool_calls: [] }, "tool_calls");
  for (const override of [{ id: "" }, { id: "other-call" }, { type: "other" }, { type: null }, { function: { name: "other", arguments: '{}' } }, { function: { name: null, arguments: '{}' } }]) {
    const fragment = { index: 0, function: { name: "", arguments: '{"path":"fixture"}' }, ...override };
    failed(await collect(async () => sse([first, chunk({ tool_calls: [fragment] }, ""), final])));
  }
  for (const name of ["", null, "unknown"]) failed(await collect(async () => sse([
    chunk({ tool_calls: [{ index: 0, id: "first-call", type: "function", function: { name, arguments: '{"path":"fixture"}' } }] }, "tool_calls"),
  ])));
  const continuation = (args: string) => chunk({ tool_calls: [{ index: 0, function: { name: "", arguments: args } }] }, "");
  failed(await collect(async () => sse([first, continuation('{"path":1}'), final])));
  failed(await collect(async () => sse([first, continuation('{"path":"fixture"}')])));
  failed(await collect(async () => sse([first, continuation('{"path":"fixture"}'), final], false)));
});

test("official nullable deltas and empty nonterminal finish preserve text without legacy tool execution", async () => {
  for (const placeholder of [undefined, null, {}, { name: "", arguments: "" }, { name: null, arguments: null }]) {
    const events = await collect(async () => sse([
      chunk({ role: "assistant", content: "", reasoning_content: "", tool_calls: [], function_call: null, refusal: "" }, ""),
      chunk({ content: "EXACT", function_call: null, tool_calls: null }, ""),
      chunk({ role: "assistant", content: "", function_call: placeholder, tool_calls: [] }, "stop"),
    ]));
    success(events);
    assert.equal(events.filter(event => event.type === "text").map(event => event.delta).join(""), "EXACT");
    assert.equal(events.some(event => event.type.startsWith("tool-")), false);
  }
});

test("nullable defaults do not weaken required tool completion or allow empty finish as a terminal", async () => {
  const defaults = { function_call: null, reasoning_content: "", refusal: "" };
  let validations = 0;
  const tool = { ...defaults, tool_calls: [{ index: 0, id: "nullable-tool", type: "function", function: { name: "read", arguments: '{"path":"fixture"}' } }] };
  success(await collect(async () => sse([
    chunk({ ...defaults, role: "assistant", content: "", tool_calls: null }, ""),
    chunk(tool, ""), chunk({ ...defaults, function_call: { name: "", arguments: "" }, tool_calls: [] }, "tool_calls"),
  ]), { options: { toolChoice: "required", validateToolInput(definition, call) { validations++; return validate(definition, call); } } }), "toolUse");
  assert.equal(validations, 1);
  for (const items of [[chunk({ ...defaults, content: "EXACT", tool_calls: null }, "")], [chunk(tool, "")]]) {
    failed(await collect(async () => sse(items)));
    failed(await collect(async () => sse(items, false)));
  }
});

test("nonempty or malformed legacy function calls remain rejected including unknown placeholder keys", async () => {
  for (const legacy of [{ name: "read", arguments: "" }, { name: "", arguments: "{}" }, { extra: null }, { name: false }, { arguments: 0 }, [], false, 0, ""]) {
    failed(await collect(async () => sse([chunk({ content: "EXACT", function_call: legacy }, "stop")])));
  }
  for (const tools of [{}, "", 0, false]) failed(await collect(async () => sse([chunk({ content: "EXACT", tool_calls: tools }, "stop")])));
});

test("bad terminal, incomplete tool JSON and schema coercion never publish complete tool candidates", async () => {
  const tool = { tool_calls: [{ index: 0, id: "call-one", type: "function", function: { name: "read", arguments: '{"path":"fixture"}' } }] };
  for (const [items, done] of [[ [chunk(tool, "tool_calls")], false ], [ [chunk(tool)], true ], [ [chunk(tool, "stop")], true ],
    [ [chunk(tool, "length")], true ], [ [chunk(tool, "content_filter")], true ], [ [chunk(tool, "tool_calls"), chunk({ content: "late" })], true ]] as [unknown[], boolean][]) {
    let validated = 0;
    const events = await collect(async () => sse(items, done), { options: { validateToolInput() { validated++; return {}; } } });
    failed(events); assert.equal(validated, 0);
  }
  for (const args of ['{"path":', '{"path":42}', '{"path":"ok","extra":true}', '[]']) {
    const events = await collect(async () => sse([chunk({ tool_calls: [{ index: 0, id: "call-one", function: { name: "read", arguments: args } }] }, "tool_calls")]));
    failed(events);
  }
  const coercion = await collect(async () => sse([chunk({ tool_calls: [{ index: 0, id: "call-one", function: { name: "read", arguments: '{"path":42}' } }] }, "tool_calls")]),
    { options: { validateToolInput(_definition, call) { return { path: String(call.arguments.path) }; } } }); failed(coercion);
});

test("protected hooks and headers reject before IO, as do missing validators and bad tool history", async () => {
  let sent = 0;
  const transport: typeof fetch = async () => { sent++; return sse([chunk({ content: "NO" }, "stop")]); };
  for (const patch of [{ model: "another-model" }, { stream: false }, { reasoning_effort: "high" }, { messages: [] }, { tools: [] }]) {
    failed(await collect(transport, { options: { reasoning: "off", validateToolInput: validate, onPayload: payload => ({ ...(payload as object), ...patch }) } }));
  }
  for (const headers of [{ Authorization: "Bearer OTHER" }, { Host: "evil.invalid" }, { "X-Agent-Runtime": "fake" }, { "User-Agent": "fake" }] as Record<string, string | null>[])
    failed(await collect(transport, { options: { validateToolInput: validate, headers } }));
  failed(await collect(transport, { options: { validateToolInput: validate, onPayload: payload => ({ ...(payload as object), toJSON: () => ({ model: "wrong", messages: [], stream: false }) }) } }));
  for (const toolChoice of [["none"], ["required"], ["auto"]]) failed(await collect(transport, { options: { validateToolInput: validate, toolChoice } }));
  failed(await collect(transport, { options: {} }));
  failed(await collect(transport, { context: { ...context, messages: [{ role: "toolResult", toolCallId: "orphan", toolName: "read", isError: false, content: "fake" }] } }));
  assert.equal(sent, 0);
});

test("payload hooks cannot remove or raise caller budgets or bypass sampling and privacy guards", async () => {
  let sent = 0;
  const transport: typeof fetch = async () => { sent++; return sse([chunk({ content: "OK" }, "stop")]); };
  for (const patch of [{ max_tokens: 17 }, { max_tokens: undefined }, { temperature: "1" }, { top_p: 2 }, { seed: 0.5 },
    { stop: [42] }, { store: "true" }, { stream_options: {} }, { reasoning: { enabled: true } }]) {
    failed(await collect(transport, { options: { maxTokens: 16, validateToolInput: validate, onPayload: payload => ({ ...(payload as object), ...patch }) } }));
  }
  assert.equal(sent, 0);
  success(await collect(transport, { options: { maxTokens: 16, validateToolInput: validate, onPayload: payload => ({ ...(payload as object), max_tokens: 8, temperature: 0.2, top_p: 0.9 }) } }));
  assert.equal(sent, 1);
});

test("tool identity changes, duplicate IDs, undeclared functions and disabled tools fail closed", async () => {
  const first = chunk({ tool_calls: [{ index: 0, id: "one", function: { name: "read", arguments: '{"path":"ok"}' } }] });
  for (const second of [{ index: 0, id: "different", function: {} }, { index: 0, function: { name: "write" } }, { index: 1, id: "one", function: { name: "read", arguments: "{}" } }])
    failed(await collect(async () => sse([first, chunk({ tool_calls: [second] }, "tool_calls")])));
  failed(await collect(async () => sse([chunk({ tool_calls: [{ index: 0, id: "one", function: { name: "exec", arguments: "{}" } }] }, "tool_calls")])));
  failed(await collect(async () => sse([first, chunk({}, "tool_calls")]), { options: { validateToolInput: validate, toolChoice: "none" } }));
});

test("UTF8 split at every byte and CRLF multiline data remain incremental and lossless", async () => {
  const source = ': heartbeat\r\n\r\ndata: ' + JSON.stringify(chunk({ content: "中文🙂", reasoning_content: "思考" }, "stop")).replace(',"choices"', ',\r\ndata: "choices"') + '\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(source); let position = 0;
  const events = await collect(async () => new Response(new ReadableStream({ pull(controller) { if (position < bytes.length) controller.enqueue(bytes.slice(position, ++position)); else controller.close(); } }), { headers: { "content-type": "text/event-stream" } }));
  success(events); assert.equal(events.filter(event => event.type === "text").map(event => event.delta).join(""), "中文🙂");
});

test("unknown finish, invalid UTF8, wrong model and event-error DONE cannot become success", async () => {
  const responses = [sse([{ ...chunk({ content: "partial" }), choices: [{ index: 0, delta: { content: "bad" }, finish_reason: ["stop"] }] }]), sse([chunk({ content: "partial" }, "unknown")]), sse([{ ...chunk({ content: "partial" }, "stop"), model: "wrong-model" }]),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "text/event-stream" } }),
    new Response(encode([chunk({ content: "partial" }, "stop")], false) + 'event: error\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })];
  for (const response of responses) failed(await collect(async () => response));
});

test("HTTP and SSE failures preserve quota/auth precedence and never echo upstream secrets", async () => {
  for (const response of [new Response(JSON.stringify({ code: 6004, msg: "SECRET" }), { status: 500 }),
    sse([{ code: "11102", error: { code: "context_length_exceeded", message: "SECRET" } }]),
    new Response('event: error\ndata: SECRET\n\n', { headers: { "content-type": "text/event-stream" } })]) {
    let calls = 0;
    const events = await collect(async () => { calls++; return response; }); failed(events); assert.equal(calls, 1); assert.ok(!JSON.stringify(events).includes("SECRET"));
  }
  assert.equal(codeBuddyFailure(500, { code: 6004 }).status, 429);
  assert.equal(codeBuddyFailure(200, { code: 11102, error: { code: "context_length_exceeded" } }).category, "permission");
});

test("usage rejects strings, negatives, overflow and inconsistent cache snapshots", () => {
  for (const usage of [{ prompt_tokens: "1", completion_tokens: 1 }, { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 }, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 99 },
    { prompt_tokens: 2, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 3 } }]) assert.throws(() => codeBuddyUsage(usage));
  assert.equal(codeBuddyUsage({ prompt_tokens: 3 }), undefined);
});

test("caller cancel releases an uncooperative acquisition and closes its late response", async () => {
  let resolve!: (response: Response) => void, canceled = 0;
  const controller = new AbortController();
  const pending = collect(() => new Promise<Response>(done => { resolve = done; }), { options: { validateToolInput: validate, signal: controller.signal } });
  while (!resolve) await new Promise(done => setImmediate(done));
  controller.abort(); const events = await pending;
  const last = events.at(-1); assert.equal(last?.type === "error" && last.reason, "aborted");
  resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await new Promise(done => setImmediate(done)); assert.equal(canceled, 1);
});

test("cancel after the final diagnostic cannot produce a successful done", async () => {
  const controller = new AbortController(), client = createCodeBuddyClient(async () => sse([chunk({ content: "partial" }, "stop")]));
  const events: NativeStreamEvent[] = [];
  for await (const event of client.stream({ model, access: "FIXTURE", context, options: { validateToolInput: validate, signal: controller.signal } })) {
    events.push(event);
    if (event.type === "diagnostic" && event.diagnostic.type === "codebuddy-usage-incomplete") controller.abort();
  }
  failed(events); client.dispose();
});

test("lifetime dispose and bounded timeout stop a hanging body without late tool validation", async () => {
  let canceled = 0, validated = 0;
  const events = await collect(async () => new Response(new ReadableStream({ cancel() { canceled++; } }), { headers: { "content-type": "text/event-stream" } }),
    { options: { timeoutMs: 10, validateToolInput() { validated++; return {}; } } });
  failed(events); assert.equal(validated, 0); assert.equal(canceled, 1);
  const client = createCodeBuddyClient(async () => { throw Error("must not send"); }); client.dispose();
  const disposed = await drain(client.stream({ model, access: "FIXTURE", context }));
  const last = disposed.at(-1); assert.equal(last?.type === "error" && last.reason, "aborted");
});
