import assert from "node:assert/strict";
import { test } from "node:test";
import { createKiroClient } from "../src/native-providers/kiro/client.js";
import { kiroResponsesReasoning, usesKiroResponses } from "../src/native-providers/kiro/responses.js";
import { kiroThinkingRequest } from "../src/native-providers/kiro/thinking.js";
import type { NativeContext, NativeStreamEvent, NativeStreamOptions } from "../src/native-providers/contracts.js";

const model = { id: "claude-sonnet-5.5" };
const account = { type: "oauth" as const, authMethod: "identity-center" as const, authRegion: "us-east-1", access: "FIXTURE", refresh: "FIXTURE", expires: Date.now() + 3600000, profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test" };
const context: NativeContext = { systemPrompt: "Keep caller safety policy", messages: [{ role: "user", content: "Keep caller question" }] };
type Json = Record<string, any>;
const final = (items: Json[], status = "completed") => ({ type: "response.completed", response: { id: "resp-fixture", model: model.id, status, output: items } });
function textEvents(text = "ok"): Json[] {
  const item = { id: "msg-fixture", type: "message", role: "assistant", content: [{ type: "output_text", text }] };
  return [{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
    { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: text },
    { type: "response.output_text.done", output_index: 0, item_id: item.id, content_index: 0, text },
    { type: "response.output_item.done", output_index: 0, item }, final([item])];
}
function response(events = textEvents()) {
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}
async function run(fetch: typeof globalThis.fetch, options: NativeStreamOptions = {}, ctx = context) {
  const client = createKiroClient(fetch), events: NativeStreamEvent[] = [];
  try { for await (const event of client.stream({ model, account, context: ctx, options })) events.push(event); }
  finally { client.dispose(); }
  return events;
}
const done = (events: NativeStreamEvent[]) => events.filter(e => e.type === "done");

test("Sonnet routing is exact and reasoning matches the public Responses converter", () => {
  assert.equal(usesKiroResponses(model.id), true);
  assert.equal(usesKiroResponses("deepseek-3.2"), true);
  // catalog-metadata-02: exact Opus 5.5 shares the adaptive-only shape, default effort medium.
  assert.equal(usesKiroResponses("claude-opus-5.5"), true);
  for (const options of [{}, { reasoning: undefined }])
    assert.deepEqual(kiroThinkingRequest({ id: "claude-opus-5.5", enabledThinkingLevels: ["off"] }, options), { enabled: true, providerLevel: "medium", additional: { output_config: { effort: "medium" } } });
  assert.deepEqual(kiroThinkingRequest({ id: "claude-opus-5.5", enabledThinkingLevels: ["off", "xhigh"] }, { reasoning: "xhigh" }), { enabled: true, providerLevel: "xhigh", additional: { output_config: { effort: "xhigh" } } });
  for (const id of ["claude-opus-5.50", "claude-opus-5.5-preview", "claude-sonnet-4.6", "claude-sonnet-5.50", "claude-sonnet-5.5-preview", "claude-sonnet-5.5-extra"]) {
    assert.equal(usesKiroResponses(id), false);
    for (const options of [{}, { reasoning: undefined }])
      assert.equal(kiroThinkingRequest({ id, enabledThinkingLevels: ["off"] }, options), undefined);
  }
  assert.deepEqual(kiroResponsesReasoning({ thinking: { type: "adaptive", display: "summarized", budget_tokens: 8000 }, output_config: { effort: "max" }, reasoning: { effort: "low" } }), { type: "adaptive", effort: "max", summary: "summarized" });
  assert.deepEqual(kiroResponsesReasoning({ thinking: { type: "disabled" } }), { type: "disabled" });
  assert.deepEqual(kiroResponsesReasoning({ output_config: { effort: "" }, reasoning: { effort: "high" } }), { effort: "high" });
  for (const x of [undefined, null, [], { thinking: { type: "", display: 3, budget_tokens: 8000 } }]) assert.deepEqual(kiroResponsesReasoning(x), {});
});

test("Sonnet non-toggleable schema uses default effort for absent or SDK off, never a thinking type", async () => {
  for (const options of [{}, { reasoning: undefined }, ...["low", "medium", "high", "xhigh", "max"].map(reasoning => ({ reasoning }))]) {
    let calls = 0;
    const events = await run(async (url, init) => {
      calls++; assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/v1/responses");
      const body = JSON.parse(String(init?.body)), headers = new Headers(init?.headers);
      assert.equal(headers.get("tokentype"), "SSO_OIDC"); assert.equal(headers.get("x-amzn-codewhisperer-optout"), "true");
      assert.equal(body.model, model.id); assert.equal(body.profileArn, account.profileArn);
      assert.match(body.input[0].content, /Keep caller safety policy[\s\S]*Keep caller question/);
      assert.doesNotMatch(body.input[0].content, /thinking_mode|thinking_effort/);
      assert.deepEqual(body.reasoning, { effort: options.reasoning ?? "high" });
      assert.equal(Object.hasOwn(body.reasoning, "type"), false);
      return response();
    }, options);
    assert.deepEqual(done(events), [{ type: "done", reason: "stop" }]); assert.equal(calls, 1);
    assert.deepEqual(events.filter(e => e.type === "thinking-level"), [{ type: "thinking-level", level: options.reasoning ?? "high" }]);
    assert.equal(events.some(e => e.type === "diagnostic" && e.diagnostic.type === "kiro-thinking-off-unavailable"), Object.hasOwn(options, "reasoning") && options.reasoning === undefined);
  }
});

test("Sonnet rejects token budget overrides even on default and SDK off paths before sending", async () => {
  for (const options of [{ thinkingBudgets: { high: 20000 } }, { reasoning: undefined, thinkingBudgets: { high: 20000 } }, { reasoning: "high", thinkingBudgets: { high: 20000 } }]) {
    let calls = 0;
    const events = await run(async () => { calls++; return response(); }, options);
    assert.equal(calls, 0); assert.equal(done(events).length, 0); assert.ok(events.some(e => e.type === "error"));
  }
});

test("native reasoning SSE is separate from literal thinking tags in ordinary Sonnet text", async () => {
  const reasoning = { id: "reason-fixture", type: "reasoning", summary: [] };
  const text = "<thinking>literal caller text</thinking>";
  const base = textEvents(text), item = base.at(-1)!.response.output[0];
  const payload = [{ type: "response.output_item.added", output_index: 0, item: reasoning },
    { type: "response.reasoning_summary_text.delta", output_index: 0, item_id: reasoning.id, delta: "native reasoning" },
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    ...base.slice(0, -1).map(e => ({ ...e, output_index: 1 })), final([reasoning, item])];
  const events = await run(async () => response(payload), { reasoning: "high" });
  assert.deepEqual(done(events), [{ type: "done", reason: "stop" }]);
  assert.equal(events.filter(e => e.type === "text").map(e => e.delta).join(""), text);
  assert.equal(events.filter(e => e.type === "thinking").map(e => e.delta).join(""), "native reasoning");
});

test("Sonnet preserves tool schema, history, failed result and tool-image continuation", async () => {
  const tool = { name: "fixture.verify", description: "Caller tool", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } };
  const ctx: NativeContext = { ...context, tools: [tool] };
  const client = createKiroClient(); let count = 0, name = "";
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    count++; const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools[0].parameters, tool.parameters); name = body.tools[0].name;
    if (count === 1) {
      const item = { id: "fc-fixture", type: "function_call", name, call_id: "call-fixture", arguments: '{"value":"check"}' };
      return response([{ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
        { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments },
        { type: "response.function_call_arguments.done", output_index: 0, item_id: item.id, arguments: item.arguments },
        { type: "response.output_item.done", output_index: 0, item }, final([item], "requires_action")]);
    }
    const call = body.input.find((x: Json) => x.type === "function_call");
    assert.deepEqual(call, { type: "function_call", call_id: "call-fixture", name, arguments: '{"value":"check"}' });
    const result = body.input.find((x: Json) => x.type === "function_call_output");
    assert.equal(result.call_id, "call-fixture"); assert.equal(JSON.parse(result.output).status, "error");
    assert.match(JSON.stringify(JSON.parse(result.output).content), /caller denied/);
    assert.ok(body.input.some((x: Json) => Array.isArray(x.content) && x.content.some((c: Json) => c.type === "input_image" && c.image_url === "data:image/png;base64,aGVsbG8=")));
    assert.match(JSON.stringify(body.input), /Keep caller safety policy/);
    return response(textEvents("continued"));
  };
  const options: NativeStreamOptions = { fetch, reasoning: undefined, validateToolInput: (_definition, call) => { assert.deepEqual(call.arguments, { value: "check" }); return call.arguments; } };
  try {
    const first: NativeStreamEvent[] = [];
    for await (const e of client.stream({ model, account, context: ctx, options })) first.push(e);
    assert.deepEqual(done(first), [{ type: "done", reason: "toolUse" }]);
    const call = first.find(e => e.type === "tool-end"); assert.ok(call?.type === "tool-end");
    const next: NativeContext = { ...ctx, messages: [...ctx.messages, { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...call.call }] },
      { role: "toolResult", toolCallId: call.call.id, toolName: call.call.name, isError: true, content: [{ type: "text", text: "caller denied" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }] }] };
    const second: NativeStreamEvent[] = [];
    for await (const e of client.stream({ model, account, context: next, options })) second.push(e);
    assert.deepEqual(done(second), [{ type: "done", reason: "stop" }]); assert.equal(count, 2);
  } finally { client.dispose(); }
});

test("Sonnet 403, truncated SSE and cancellation never retry or fallback to GAR", async () => {
  for (const mode of ["403", "truncated", "cancel"]) {
    let calls = 0; const controller = new AbortController();
    const events = await run(async (url) => {
      calls++; assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/v1/responses");
      return mode === "403" ? new Response('{"__type":"AccessDeniedException","message":"PRIVATE"}', { status: 403 }) : response(mode === "truncated" ? textEvents().slice(0, -1) : textEvents());
    }, { signal: controller.signal, onProviderEvent: () => { if (mode === "cancel") controller.abort(); } });
    assert.equal(calls, 1); assert.equal(done(events).length, 0); assert.ok(events.some(e => e.type === "error"));
    assert.ok(!JSON.stringify(events).includes("PRIVATE"));
  }
});
