import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, getSupportedThinkingLevels, Type, type Context, type AssistantMessage, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import { codeBuddyProvider } from "../src/server/providers/codebuddy-cn.js";

function fixture() {
  const provider = codeBuddyProvider();
  const models = createModels();
  models.setProvider(provider);
  return { models, model: provider.getModels()[0] };
}
const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: "chat-fixture", choices: [{ index: 0, delta, finish_reason }] });
const sse = (chunks: unknown[]) => new Response(chunks.map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const context: Context = { systemPrompt: "Keep all tool constraints. ".repeat(150), messages: [{ role: "user", content: "Read the fixture", timestamp: 1 }], tools: [{ name: "read", description: "Read file", parameters: Type.Object({ path: Type.String() }) }] };

test("CodeBuddy exposes per-model effort choices and sends each supported effort without clamping", async () => {
  const provider = codeBuddyProvider();
  const models = createModels();
  models.setProvider(provider);
  const expected: Record<string, ModelThinkingLevel[]> = {
    "glm-5.2": ["off", "high", "xhigh"],
    "glm-5.1": ["minimal", "low", "medium", "high", "xhigh"],
    "minimax-m3": ["minimal", "low", "medium", "high", "xhigh"],
    "hy3": ["low", "high"],
    "hy4-preview": ["high"],
    "glm-5.3": ["off", "low", "high", "max"],
    "glm-5.3-flash": ["off", "low", "high", "max"],
    "kimi-k3-1": ["minimal", "low", "medium", "high", "xhigh"],
    "kimi-k2.8-preview": ["off", "low", "high", "max"],
    "deepseek-v4-pro": ["off", "low", "high", "xhigh"],
    "deepseek-v4.1-flash": ["off", "low", "high", "max"],
  };
  for (const model of provider.getModels()) {
    assert.deepEqual(getSupportedThinkingLevels(model), expected[model.id], model.id);
    for (const reasoning of expected[model.id]) {
      if (reasoning === "off") continue;
      let sent = false;
      const result = await models.completeSimple(model, context, {
        apiKey: "FIXTURE", reasoning, maxRetries: 0,
        fetch: async (_input, init) => {
          sent = true;
          const body = JSON.parse(String(init?.body));
          assert.equal(body.reasoning_effort, reasoning, model.id);
          assert.equal(body.reasoning_summary, "auto");
          return sse([chunk({ content: "done" }, "stop")]);
        },
      });
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.ok(sent, model.id);
    }
  }
});

test("CodeBuddy conservative catalog limits follow the matching official CLI product entries", async () => {
  const provider = codeBuddyProvider();
  const models = createModels();
  models.setProvider(provider);
  for (const [id, limit] of Object.entries({ "glm-5.2": 64000, "glm-5.3": 64000, "kimi-k2.8-preview": 64000, "deepseek-v4-pro": 128000, "deepseek-v4.1-flash": 128000 })) {
    const model = provider.getModels().find(item => item.id === id)!;
    const result = await models.completeSimple(model, context, { apiKey: "FIXTURE", maxRetries: 0, fetch: async (_input, init) => {
      assert.equal(JSON.parse(String(init?.body)).max_tokens, limit, id);
      return sse([chunk({ content: "done" }, "stop")]);
    } });
    assert.equal(result.stopReason, "stop", result.errorMessage);
  }
  assert.deepEqual(provider.getModels().find(model => model.id === "glm-5.2")!.input, ["text"]);
  assert.deepEqual(provider.getModels().find(model => model.id === "glm-5.1")!.input, ["text"]);
});

test("CodeBuddy native stream preserves prompts and hooks, parses simultaneous text/reasoning and empty tool arrays", async () => {
  const { models, model } = fixture();
  let payloads = 0, responses = 0, events = 0;
  const result = await models.completeSimple(model, context, {
    apiKey: "FIXTURE", reasoning: "high", maxRetries: 0,
    onPayload(payload) { payloads++; return { ...(payload as object), stream: false, temperature: 0.2 }; },
    onResponse(response) { responses++; assert.equal(response.status, 200); },
    onProviderStreamEvent() { events++; },
    fetch: async (input, init) => {
      assert.equal(String(input), "https://copilot.tencent.com/v2/chat/completions");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer FIXTURE");
      assert.equal(headers.get("x-product"), "SaaS");
      assert.equal(headers.get("x-ide-type"), "CLI");
      assert.equal(headers.get("user-agent"), "CLI/2.173.0 CodeBuddy/2.173.0");
      assert.equal(headers.get("x-ide-version"), "2.173.0");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, true);
      assert.equal(body.reasoning_effort, "high");
      assert.equal(body.reasoning_summary, "auto");
      assert.equal(body.temperature, 0.2);
      assert.equal(body.store, undefined);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[0].content, context.systemPrompt);
      assert.equal(body.tools[0].function.name, "read");
      assert.equal(body.max_completion_tokens, undefined);
      assert.equal(body.max_tokens, 64000, "GLM-5.2 must not exceed the shipped CLI output ceiling");
      assert.deepEqual(body.stream_options, { include_usage: true });
      return sse([
        chunk({ reasoning_content: "Think ", content: "Hello ", tool_calls: [] }),
        chunk({ reasoning_content: "twice", content: "world", tool_calls: [] }),
        { ...chunk({}, "stop"), usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112, prompt_tokens_details: { cached_tokens: 20 } } },
      ]);
    },
  });
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(result.content.find(block => block.type === "text")?.text, "Hello world");
  assert.equal(result.content.find(block => block.type === "thinking")?.thinking, "Think twice");
  assert.equal(result.usage.output, 12);
  assert.equal(result.usage.cacheRead, 20);
  assert.equal(result.usage.totalTokens, 112);
  assert.deepEqual([payloads, responses, events], [1, 1, 3]);
});

test("CodeBuddy tools aggregate fragmented arguments and replay tool results with full system context", async () => {
  const { models, model } = fixture();
  const first = await models.completeSimple(model, context, {
    apiKey: "FIXTURE", maxRetries: 0,
    fetch: async () => sse([
      chunk({ tool_calls: [{ index: 0, id: "call-one", type: "function", function: { name: "read", arguments: '{"path":' } }, { index: 1, id: "call-two", type: "function", function: { name: "read", arguments: '{"path":"b"}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] }, "tool_calls"),
    ]),
  });
  assert.equal(first.stopReason, "toolUse", first.errorMessage);
  assert.deepEqual(first.content.filter(block => block.type === "toolCall").map(block => block.arguments), [{ path: "a" }, { path: "b" }]);
  const next: Context = { ...context, messages: [...context.messages, first,
    { role: "toolResult", toolCallId: "call-one", toolName: "read", content: [{ type: "text", text: "FILE-A" }], isError: false, timestamp: 2 },
    { role: "toolResult", toolCallId: "call-two", toolName: "read", content: [{ type: "text", text: "FILE-B" }], isError: false, timestamp: 2 },
  ] };
  const result = await models.completeSimple(model, next, { apiKey: "FIXTURE", maxRetries: 0, fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.messages[0].content, context.systemPrompt);
    assert.equal(body.messages.find((m: any) => m.role === "tool" && m.tool_call_id === "call-one").content, "FILE-A");
    return sse([chunk({ content: "done" }, "stop")]);
  } });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});

test("CodeBuddy reasoning is opt-in and none/off are omitted even after a payload hook", async () => {
  const { models, model } = fixture();
  for (const effort of [undefined, "none", "off"]) {
    const result = await models.completeSimple(model, context, {
      apiKey: "FIXTURE", maxRetries: 0,
      onPayload: payload => ({ ...(payload as object), reasoning_effort: effort, reasoning_summary: "auto" }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.reasoning_effort, undefined);
        assert.equal(body.reasoning_summary, undefined);
        return sse([chunk({ content: "done" }, "stop")]);
      },
    });
    assert.equal(result.stopReason, "stop", result.errorMessage);
  }
  // The non-simple API must use the same protocol adapter.
  const result = await models.complete(model, context, { apiKey: "FIXTURE", maxRetries: 0, reasoningEffort: "low", fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.reasoning_summary, "auto");
    return sse([chunk({ content: "done" }, "stop")]);
  } });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});

test("CodeBuddy surfaces HTTP-200 business errors, stream errors and incomplete streams", async () => {
  const { models, model } = fixture();
  for (const [response, pattern] of [
    [new Response(JSON.stringify({ code: 6004, msg: "SECRET" }), { headers: { "content-type": "application/json" } }), /429|6004/],
    [new Response("SECRET", { status: 401 }), /401.*重新登录/],
    [new Response(JSON.stringify({ code: 11102 }), { headers: { "content-type": "application/json" } }), /11102/],
    [sse([{ code: 6004, msg: "SECRET" }]), /6004/],
    [sse([chunk({ content: "partial" })]), /finish_reason/],
  ] as const) {
    const result = await models.completeSimple(model, context, { apiKey: "FIXTURE", maxRetries: 0, fetch: async () => response });
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage!, pattern);
    assert.ok(!result.errorMessage?.includes("SECRET"));
  }
});

test("CodeBuddy cancellation reaches the transport and produces an aborted result", async () => {
  const { models, model } = fixture();
  const controller = new AbortController();
  let transportAborted = false;
  const result: AssistantMessage = await models.completeSimple(model, context, { apiKey: "FIXTURE", signal: controller.signal, maxRetries: 0, fetch: async (_input, init) => {
    controller.abort();
    transportAborted = init?.signal?.aborted === true;
    init?.signal?.throwIfAborted();
    throw new Error("unreachable");
  } });
  assert.ok(transportAborted);
  assert.equal(result.stopReason, "aborted");
});
