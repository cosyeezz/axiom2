import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, Type, type Context } from "@earendil-works/pi-ai";
import { qoderProvider } from "../src/server/providers/qoder.js";
import type { QoderStreamOptions } from "../src/server/providers/qoder-client.js";
import { qoderFailure, type QoderRegion } from "../src/server/providers/qoder-protocol.js";
import { unwrapQoderSse } from "../src/server/providers/qoder-sse.js";

delete process.env.AXIOM_EXPERIMENTAL_QODER;

function decode(text: string) {
  const from = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$", to = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const rearranged = [...text].map(char => to[from.indexOf(char)]).join(""), n = rearranged.length, third = Math.floor(n / 3);
  return JSON.parse(Buffer.from(rearranged.slice(n - third) + rearranged.slice(third, n - third) + rearranged.slice(0, third), "base64").toString("utf8"));
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const chunk = (delta: unknown, finish_reason?: string) => ({ choices: [{ index: 0, delta, ...(finish_reason ? { finish_reason } : {}) }] });
const envelope = (body: unknown, statusCodeValue = 200) => `data: ${JSON.stringify({ statusCodeValue, body: typeof body === "string" ? body : JSON.stringify(body) })}\n\n`;
const sse = (chunks: unknown[]) => new Response(chunks.map(value => envelope(value)).join("") + envelope("[DONE]"), { headers: { "content-type": "text/event-stream" } });
const context: Context = { systemPrompt: "保留所有工具和安全要求。".repeat(100), messages: [{ role: "user", content: "读取测试文件", timestamp: 1 }], tools: [{ name: "read", description: "读取", parameters: Type.Object({ path: Type.String() }) }] };
const modelConfig = { key: "auto", display_name: "Auto fixture", max_input_tokens: 64000, max_output_tokens: 1024, is_reasoning: true, is_vl: true, source: "system", unknown_field: { retain: true } };
async function fixture(region: QoderRegion = "cn", config: Record<string, unknown> = modelConfig) {
  const provider = qoderProvider(region), models = createModels(), calls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.href);
    if (url.pathname.endsWith("endpoints")) return json({ inferNodes: [region === "cn" ? "https://gateway.qoder.com.cn" : "https://api1.qoder.sh"] });
    if (url.pathname.endsWith("exchange")) return json({ token: "jt-FIXTURE", expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (url.pathname.endsWith("userinfo")) return json({ id: "fixture-user" });
    if (url.pathname.endsWith("model/list")) {
      assert.match(new Headers(init?.headers).get("authorization")!, /^Bearer COSY\./);
      return json({ chat: [config, { key: "hidden", enable: false }] });
    }
    throw Error("Unexpected fixture endpoint");
  };
  assert.equal(provider.name, region === "cn" ? "Qoder 国内版" : "Qoder");
  assert.equal(provider.getModels().length, 0);
  const previous = globalThis.fetch; globalThis.fetch = transport;
  try {
    await provider.refreshModels!({ allowNetwork: true, signal: new AbortController().signal, credential: { type: "api_key", key: "pt-FIXTURE" }, publish: async publication => { publication.update?.(); return true; } });
  } finally { globalThis.fetch = previous; }
  models.setProvider(provider);
  const model = provider.getModels()[0];
  assert.equal(provider.getModels().length, 1); assert.deepEqual(model.input, config.is_vl === true ? ["text", "image"] : ["text"]);
  assert.equal(model.reasoning, config.is_reasoning === true);
  return { provider, models, model, calls, transport };
}

test("Qoder preserves system/tools and projects dynamic model_config, signs encoded body, parses text/reasoning/late usage", async () => {
  for (const region of ["cn", "intl"] as const) {
    const { models, model } = await fixture(region);
    let payloads = 0, responses = 0, events = 0;
    const result = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", maxTokens: 512,
      onPayload(payload) { payloads++; return payload; }, onResponse() { responses++; }, onProviderStreamEvent() { events++; },
      fetch: async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, region === "cn" ? "https://gateway.qoder.com.cn" : "https://api1.qoder.sh");
        assert.equal(url.pathname, "/algo/api/v2/service/pro/sse/agent_chat_generation"); assert.equal(url.searchParams.get("Encode"), "1");
        assert.equal(init?.redirect, "error"); assert.match(new Headers(init?.headers).get("authorization")!, /^Bearer COSY\./);
        const body = decode(String(init?.body));
        assert.equal(body.system, context.systemPrompt); assert.equal(body.messages.find((message: any) => message.role === "system").content, context.systemPrompt);
        assert.equal(body.tools[0].function.name, "read"); assert.equal(body.model_config.key, modelConfig.key); assert.equal(body.model_config.is_reasoning, modelConfig.is_reasoning);
        assert.equal(body.model_config.unknown_field, undefined); assert.equal(body.model_config.url, "");
        assert.equal(body.parameters.max_tokens, 512); assert.equal(body.stream, true);
        return sse([chunk({ content: "你好🙂", reasoning_content: "分析" }), chunk({ finish_reason: "stop" }),
          { choices: [], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10 } }]);
      },
    });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(result.content.find(block => block.type === "text")?.text, "你好🙂");
    assert.equal(result.content.find(block => block.type === "thinking")?.thinking, "分析");
    assert.equal(result.usage.totalTokens, 120); assert.equal(result.usage.cacheRead, 10);
    assert.deepEqual([payloads, responses, events], [1, 1, 3]);
  }
});
test("Qoder SSE accepts bounded auxiliary metadata and wrapped controls without losing text or late usage", async () => {
  const metadata = [{}, { id: "aux", object: "chat.completion.chunk", created: 1, model: "fixture", system_fingerprint: null, service_tier: "default", choices: null, usage: null }, { code: 200, queue: { isQueued: false } }, { choices: [], usage: null }];
  for (const wrap of [(value: unknown) => `data: ${JSON.stringify(value)}\n\n`, envelope]) {
    const auxiliary = metadata.map(value => wrap(value)).join("");
    const controls = ["   ", "[NOT_EXCEED_QUOTA]", "[EXCEED_QUOTA]notice", "[NOTIFICATIONS]", " [NOTIFICATIONS]#{} "].map(value => envelope(value)).join("");
    const text = auxiliary + controls + wrap(chunk({ reasoning_content: "thinking", content: "323" })) + auxiliary
      + wrap(chunk({}, "stop")) + "event: finish\n" + envelope({}) + controls + auxiliary
      + wrap({ usage: { prompt_tokens: 3, completion_tokens: 2 } }) + "data: [DONE]\n\n";
    const output = await unwrapQoderSse(new Response(text, { headers: { "content-type": "text/event-stream" } })).text();
    assert.match(output, /323/); assert.match(output, /thinking/); assert.match(output, /"total_tokens":5/);
    assert.doesNotMatch(output, /NOTIFICATIONS|EXCEED_QUOTA|"id":"aux"/);
  }
});
test("Qoder auxiliary frames cannot hide errors, malformed choices, unknown content or missing finish", async () => {
  const usage = { prompt_tokens: 1, completion_tokens: 1 };
  const invalid = [{ error: { code: 112, message: "SECRET" } }, { code: 112 }, { queue: { isQueued: true } }, { content: "SECRET" }, { status: "error" }, { choices: {} }, { choices: "SECRET", usage },
    { usage, content: "SECRET" }, { choices: [], usage, content: "SECRET" }, { usage, queue: { isQueued: false, message: "SECRET" } },
    { queue: { isQueued: "false" } }, { queue: {} }, { queue: { isQueued: false, message: "SECRET" } }];
  for (const body of invalid) for (const finished of [false, true]) {
    const prefix = chunk({ content: "partial" }, finished ? "stop" : undefined);
    await assert.rejects(unwrapQoderSse(sse([prefix, body, ...(finished ? [] : [chunk({}, "stop")])])).text(), error => error instanceof Error && error.message.startsWith("Qoder ") && !error.message.includes("SECRET"));
  }
  for (const text of [envelope({}), "event: finish\n" + envelope({}), envelope("   ") + envelope("[NOT_EXCEED_QUOTA]"), envelope(chunk({ content: "partial" })) + envelope({})]) {
    await assert.rejects(unwrapQoderSse(new Response(text, { headers: { "content-type": "text/event-stream" } })).text(), /缺少结束状态/);
  }
  for (const control of ["[NOT_EXCEED_QUOTA]", "[NOTIFICATIONS]"]) for (const prefix of ["", envelope(chunk({}, "stop"))]) {
    await assert.rejects(unwrapQoderSse(new Response(prefix + envelope(control, 403), { headers: { "content-type": "text/event-stream" } })).text(), /权限/);
  }
  for (const body of [{ code: 105, message: "SECRET" }, JSON.stringify({ code: "105", message: "SECRET" }), "SECRET"]) {
    const text = "event: SECRET\n" + envelope(body, 403);
    await assert.rejects(unwrapQoderSse(new Response(text, { headers: { "content-type": "text/event-stream" } })).text(), error => error instanceof Error && error.message.includes("[sse_wrapper status=403 event=other body=") && error.message.includes(`code=${body === "SECRET" ? "none" : "105"}]`) && !error.message.includes("SECRET"));
  }
});
test("Qoder fragmented parallel tools and tool results survive round-trip", async () => {
  const { models, model } = await fixture();
  const first = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", fetch: async () => sse([
    {},
    chunk({ tool_calls: [{ index: 0, id: "one", type: "function", function: { name: "read", arguments: '{"path":' } }, { index: 1, id: "two", type: "function", function: { name: "read", arguments: '{"path":"b"}' } }] }),
    {},
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }], finish_reason: "tool_calls" }),
    { id: "aux", choices: null },
  ]) });
  assert.equal(first.stopReason, "toolUse", first.errorMessage);
  assert.deepEqual(first.content.filter(block => block.type === "toolCall").map(block => block.arguments), [{ path: "a" }, { path: "b" }]);
  const next: Context = { ...context, messages: [...context.messages, first,
    { role: "toolResult", toolCallId: "one", toolName: "read", content: [{ type: "text", text: "FILE-A" }], isError: false, timestamp: 2 },
    { role: "toolResult", toolCallId: "two", toolName: "read", content: [{ type: "text", text: "FILE-B" }], isError: false, timestamp: 2 },
  ] };
  const result = await models.completeSimple(model, next, { apiKey: "pt-FIXTURE", fetch: async (_input, init) => {
    const body = decode(String(init?.body)); assert.equal(body.system, context.systemPrompt);
    assert.equal(body.messages.find((message: any) => message.role === "tool" && message.tool_call_id === "one").content, "FILE-A");
    return sse([chunk({ content: "done" }, "stop")]);
  } });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});
test("Qoder missing models, custom endpoint, invalid images and HTTP errors fail without fallback, leakage or replay", async () => {
  const { models, model } = await fixture();
  let calls = 0;
  const fail: typeof fetch = async () => { calls++; return new Response("SECRET provider body", { status: 503 }); };
  const missing = await models.completeSimple({ ...model, id: "missing" }, context, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(missing.stopReason, "error"); assert.equal(calls, 0);
  const custom = await models.completeSimple({ ...model, baseUrl: "https://not-qoder.invalid" }, context, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(custom.stopReason, "error"); assert.equal(calls, 0);
  const image = await models.completeSimple(model, { messages: [{ role: "user", content: [{ type: "image", mimeType: "application/pdf", data: "aGVsbG8=" }], timestamp: 1 }] }, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(image.stopReason, "error"); assert.equal(calls, 0, "images must fail before any inference");
  const toolImage = await models.completeSimple(model, { messages: [...context.messages,
    { role: "toolResult", toolCallId: "image", toolName: "read", content: [{ type: "image", mimeType: "application/pdf", data: "aGVsbG8=" }], timestamp: 2, isError: false },
  ] }, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(toolImage.stopReason, "error"); assert.equal(calls, 0);
  const error = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", maxRetries: 4, fetch: fail });
  assert.equal(error.stopReason, "error"); assert.equal(calls, 1); assert.ok(!error.errorMessage?.includes("SECRET"));
});
const png = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } as const;
const pngUrl = `data:${png.mimeType};base64,${png.data}`;
test("Qoder catalog vision capability preserves ordered multi-turn images and official content/contents fields", async () => {
  for (const region of ["cn", "intl"] as const) {
    const { models, model } = await fixture(region);
    const initial: Context = { ...context, messages: [{ role: "user", timestamp: 1, content: [
      { type: "text", text: "before" }, png, { type: "text", text: "between" }, png, { type: "text", text: "after" },
    ] }] };
    let payloads = 0;
    const first = await models.completeSimple(model, initial, { apiKey: "pt-FIXTURE", onPayload() { payloads++; }, fetch: async (_input, init) => {
      const body = decode(String(init?.body)), user = body.messages.find((message: any) => message.role === "user");
      assert.deepEqual(user.content, [{ type: "text", text: "before" }, { type: "image_url", image_url: { url: pngUrl } },
        { type: "text", text: "between" }, { type: "image_url", image_url: { url: pngUrl } }, { type: "text", text: "after" }]);
      assert.deepEqual(user.contents, user.content); assert.equal(body.model_config.is_vl, true);
      assert.equal(body.chat_context.text, "before\nbetween\nafter"); assert.equal(body.chat_context.extra.originalContent, body.chat_context.text);
      assert.equal(body.chat_context.imageUrls, null); assert.ok(!("image_urls" in body));
      return sse([chunk({ content: "seen", reasoning_content: "compare" }, "stop")]);
    } });
    assert.equal(first.stopReason, "stop", first.errorMessage); assert.equal(payloads, 1);
    const next: Context = { ...initial, messages: [...initial.messages, first, { role: "user", content: [{ type: "text", text: "recall" }, png], timestamp: 2 }] };
    const result = await models.complete(model, next, { apiKey: "pt-FIXTURE", fetch: async (_input, init) => {
      const body = decode(String(init?.body));
      const messages = body.messages.filter((message: any) => message.role !== "system");
      assert.equal(messages.length, 3); assert.deepEqual(messages[0].contents, messages[0].content);
      assert.equal(messages[1].content, "seen"); assert.equal(messages[1].reasoning_content, "compare");
      assert.deepEqual(messages[2].content, [{ type: "text", text: "recall" }, { type: "image_url", image_url: { url: pngUrl } }]);
      assert.deepEqual(messages[2].contents, messages[2].content); assert.equal(body.chat_context.text, "recall");
      return sse([chunk({ content: "recalled" }, "stop")]);
    } });
    assert.equal(result.stopReason, "stop", result.errorMessage);
  }
});
test("Qoder native tool-result image projection preserves tool IDs, images and following user turn", async () => {
  const { models, model } = await fixture();
  const first = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", fetch: async () => sse([
    chunk({ reasoning_content: "inspect", tool_calls: [{ index: 0, id: "image-read", type: "function", function: { name: "read", arguments: '{"path":"probe.png"}' } }] }, "tool_calls"),
  ]) });
  assert.equal(first.stopReason, "toolUse", first.errorMessage);
  const next: Context = { ...context, messages: [...context.messages, first,
    { role: "toolResult", toolCallId: "image-read", toolName: "read", isError: false, timestamp: 2,
      content: [{ type: "text", text: "image from read" }, png] },
    { role: "user", timestamp: 3, content: [{ type: "text", text: "Attached image(s) from tool result:" }, png] },
  ] };
  const result = await models.completeSimple(model, next, { apiKey: "pt-FIXTURE", fetch: async (_input, init) => {
    const body = decode(String(init?.body)), tool = body.messages.findIndex((message: any) => message.role === "tool");
    assert.equal(body.messages[tool].tool_call_id, "image-read");
    assert.deepEqual(body.messages[tool].content, [{ type: "text", text: "image from read" }, { type: "image_url", image_url: { url: pngUrl } }]);
    assert.deepEqual(body.messages[tool].contents, body.messages[tool].content);
    assert.equal(body.messages[tool - 1].reasoning_content, "inspect");
    assert.equal(body.messages[tool + 1].role, "user"); assert.deepEqual(body.messages[tool + 1].content[1], { type: "image_url", image_url: { url: pngUrl } });
    assert.deepEqual(body.messages[tool + 1].contents, body.messages[tool + 1].content);
    assert.equal(body.messages.length, tool + 2, "native tool images must not synthesize or remove a real user turn");
    return sse([chunk({ content: "image read" }, "stop")]);
  } });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});
test("Qoder rejects nonvision catalogs, stale image metadata and invalid image data before inference", async () => {
  for (const is_vl of [false, undefined, "true", "false", 1]) {
    const { models, model } = await fixture("cn", { ...modelConfig, is_vl });
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; throw Error("must not infer"); };
    const imageContext: Context = { messages: [{ role: "user", timestamp: 1, content: [png] }] };
    for (const selected of [model, { ...model, input: ["text", "image"] as ("text" | "image")[] }]) {
      const result = await models.completeSimple(selected, imageContext, { apiKey: "pt-FIXTURE", fetch });
      assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /图片/); assert.equal(calls, 0);
    }
  }
  const { models, model } = await fixture();
  const invalid = [
    { ...png, data: "" }, { ...png, data: "!!!!" }, { ...png, data: "aGVsbG8=" }, { ...png, data: png.data.replace(/=$/, "") },
    { ...png, mimeType: "image/svg+xml" }, { ...png, mimeType: "image/jpeg" },
    { ...png, data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") },
  ];
  for (const content of [...invalid.map(image => [image]), Array.from({ length: 5 }, () => png)]) {
    let calls = 0;
    const result = await models.completeSimple(model, { messages: [{ role: "user", timestamp: 1, content }] }, {
      apiKey: "pt-FIXTURE", fetch: async () => { calls++; throw Error("must not infer"); },
    });
    assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /图片/); assert.equal(calls, 0);
  }
  const stale = await models.completeSimple({ ...model, input: ["text"] }, { messages: [{ role: "toolResult", toolCallId: "image", toolName: "read", isError: false, timestamp: 1, content: [png] }] }, {
    apiKey: "pt-FIXTURE", fetch: async () => { throw Error("must not infer"); },
  });
  assert.equal(stale.stopReason, "error"); assert.match(stale.errorMessage!, /重新拉取目录/);
});
test("Qoder explicit BYOK vision overrides work through provider option paths without reviving old user text", async () => {
  const { models, model } = await fixture("cn", { ...modelConfig, is_vl: false });
  const imageContext: Context = { messages: [...context.messages, { role: "user", timestamp: 2, content: [png] }] };
  const customModelOverride = { api_key: "sk-FIXTURE", isVl: true };
  for (const path of ["direct", "metadata", "sampling", "model"] as const) {
    let calls = 0;
    const options: QoderStreamOptions = {
      apiKey: "pt-FIXTURE",
      ...(path === "direct" ? { customModelOverride } : path === "metadata" ? { metadata: { qoder: { customModelOverride } } }
        : path === "sampling" ? { samplingParams: { qoder: { customModelOverride } } } : {}),
      fetch: async (_input, init) => {
        calls++;
        const body = decode(String(init?.body));
        assert.equal(body.model_config.is_vl, true); assert.equal(body.model_config.key, "custom_model");
        assert.equal(body.custom_model.parameters.api_key, "sk-FIXTURE");
        assert.deepEqual(body.messages.at(-1).content, [{ type: "image_url", image_url: { url: pngUrl } }]);
        assert.equal(body.chat_context.text, ""); assert.equal(body.chat_context.extra.originalContent, "");
        return sse([chunk({ content: "custom image seen" }, "stop")]);
      },
    };
    const selected = path === "model" ? { ...model, samplingParams: { qoder: { customModelOverride } } } : model;
    const result = await models.completeSimple(selected, imageContext, options);
    assert.equal(result.stopReason, "stop", `${path}: ${result.errorMessage}`); assert.equal(calls, 1);
  }
  let calls = 0;
  const result = await models.completeSimple({ ...model, input: ["text", "image"] }, imageContext, {
    apiKey: "pt-FIXTURE", metadata: { qoder: { customModelOverride: { ...customModelOverride, isVl: false } } },
    samplingParams: { qoder: { customModelOverride } },
    fetch: async () => { calls++; throw Error("must not infer"); },
  });
  assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /图片/); assert.equal(calls, 0);
});
test("Qoder accepts supported MIME headers and preserves image-only input without claiming full decoding", async () => {
  const { models, model } = await fixture();
  const images = [png, { type: "image", mimeType: "image/jpeg", data: Buffer.from([255, 216, 255, 224]).toString("base64") },
    { type: "image", mimeType: "image/gif", data: Buffer.from("GIF89a").toString("base64") },
    { type: "image", mimeType: "image/webp", data: Buffer.from("RIFF0000WEBP").toString("base64") }] as const;
  const result = await models.completeSimple(model, { messages: [{ role: "user", timestamp: 1, content: [...images] }] }, {
    apiKey: "pt-FIXTURE", fetch: async (_input, init) => {
      const body = decode(String(init?.body));
      assert.deepEqual(body.messages[0].content, images.map(image => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } })));
      assert.deepEqual(body.messages[0].contents, body.messages[0].content); assert.equal(body.chat_context.text, "");
      return sse([chunk({ content: "headers accepted" }, "stop")]);
    },
  });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});
test("Qoder preserves adjacent tool-result IDs and ordered grouped images", async () => {
  const { models, model } = await fixture();
  const first = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", fetch: async () => sse([chunk({ tool_calls: [
    { index: 0, id: "left", type: "function", function: { name: "read", arguments: '{"path":"left.png"}' } },
    { index: 1, id: "right", type: "function", function: { name: "read", arguments: '{"path":"right.gif"}' } },
  ] }, "tool_calls")]) });
  const gif = { type: "image", mimeType: "image/gif", data: Buffer.from("GIF89a").toString("base64") } as const;
  const next: Context = { ...context, messages: [...context.messages, first,
    { role: "toolResult", toolCallId: "left", toolName: "read", isError: false, timestamp: 2, content: [png] },
    { role: "toolResult", toolCallId: "right", toolName: "read", isError: false, timestamp: 2, content: [{ type: "text", text: "right" }, gif] },
  ] };
  const result = await models.completeSimple(model, next, { apiKey: "pt-FIXTURE", fetch: async (_input, init) => {
    const body = decode(String(init?.body)), tools = body.messages.filter((message: any) => message.role === "tool");
    assert.deepEqual(tools.map((message: any) => message.tool_call_id), ["left", "right"]);
    assert.deepEqual(tools[0].content, [{ type: "image_url", image_url: { url: pngUrl } }]);
    assert.deepEqual(tools[1].content, [{ type: "text", text: "right" }, { type: "image_url", image_url: { url: `data:${gif.mimeType};base64,${gif.data}` } }]);
    for (const tool of tools) assert.deepEqual(tool.contents, tool.content);
    assert.equal(body.messages.at(-1).role, "tool");
    return sse([chunk({ content: "both" }, "stop")]);
  } });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});
test("Qoder rejects single and replay-aggregate oversized images before hooks, serialization or transport, including concurrent requests", async () => {
  const { models, model } = await fixture();
  const image = (size: number) => {
    const bytes = Buffer.alloc(size); Buffer.from(png.data, "base64").copy(bytes);
    return { ...png, data: bytes.toString("base64") };
  };
  const large = image(2 * 1024 * 1024), small = image(1024 * 1024);
  let calls = 0, hooks = 0;
  const options = { apiKey: "pt-FIXTURE", onPayload() { hooks++; }, fetch: async () => { calls++; return sse([chunk({ content: "must not infer" }, "stop")]); } };
  const transcripts: Context[] = [
    { messages: [{ role: "user", timestamp: 1, content: [large] }] },
    { messages: [{ role: "user", timestamp: 1, content: [small] }, { role: "user", timestamp: 2, content: [small] }] },
    { messages: [{ role: "user", timestamp: 1, content: [small] }, { role: "toolResult", toolName: "read", toolCallId: "image", isError: false, timestamp: 2, content: [small] }] },
  ];
  const results = await Promise.all([...transcripts, ...transcripts].map(transcript => models.completeSimple(model, transcript, options)));
  for (const result of results) { assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /6 MiB/); }
  assert.deepEqual([calls, hooks], [0, 0]);
});
test("Qoder accounts for text escaping, final chat_context duplication and post-hook replacement before transport", async () => {
  const { models, model } = await fixture();
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw Error("must not infer"); };
  const escaped = await models.completeSimple(model, { messages: [{ role: "user", timestamp: 1, content: "\u0000".repeat(800000) }] }, { apiKey: "pt-FIXTURE", fetch });
  assert.equal(escaped.stopReason, "error"); assert.match(escaped.errorMessage!, /6 MiB/);
  const duplicate = await models.completeSimple(model, { messages: [{ role: "user", timestamp: 1, content: "x".repeat(2 * 1024 * 1024) }] }, { apiKey: "pt-FIXTURE", fetch });
  assert.equal(duplicate.stopReason, "error"); assert.match(duplicate.errorMessage!, /6 MiB/);
  const replacement = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", fetch, onPayload: () => ({ messages: [{ role: "user", content: "x".repeat(5 * 1024 * 1024) }] }) });
  assert.equal(replacement.stopReason, "error"); assert.match(replacement.errorMessage!, /6 MiB/); assert.equal(calls, 0);
});
test("Qoder rejects callable serialization hooks returned by onPayload without executing them or reaching transport", async () => {
  const { models, model } = await fixture();
  let hooks = 0, calls = 0, getters = 0;
  const replacements = [
    { toJSON() { hooks++; return { messages: [{ role: "user", content: "x".repeat(8 * 1024 * 1024) }] }; } },
    { get messages() { getters++; return []; } },
    { model: model.id, messages: [{ role: "user", content: Object.assign(function () {}, { toJSON() { hooks++; return "injected"; } }) }], stream: true },
    { model: model.id, messages: [{ role: "user", content: Object.defineProperty(function () {}, "toJSON", { get() { getters++; return () => "injected"; } }) }], stream: true },
  ];
  for (const replacement of replacements) {
    const result = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", onPayload: () => replacement,
      fetch: async () => { calls++; throw Error("must not infer"); } });
    assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /序列化钩子|访问器/);
  }
  assert.deepEqual([hooks, getters, calls], [0, 0, 0]);
});
test("Qoder HTTP error cleanup never blocks on body cancellation and preserves caller abort", { timeout: 2000 }, async () => {
  const { models, model } = await fixture();
  let cancelled = 0, calls = 0;
  const response = (reject = false) => new Response(new ReadableStream({ cancel() {
    cancelled++;
    return reject ? Promise.reject(Error("SECRET cancellation failure")) : new Promise<void>(() => {});
  } }), { status: 503 });
  for (const reject of [false, true]) {
    const result = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", maxRetries: 4,
      fetch: async () => { calls++; return response(reject); } });
    assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /HTTP 503/); assert.doesNotMatch(result.errorMessage!, /SECRET/);
  }
  const controller = new AbortController();
  const aborted = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", signal: controller.signal,
    fetch: async () => { calls++; controller.abort(); return response(); } });
  assert.equal(aborted.stopReason, "aborted"); assert.deepEqual([cancelled, calls], [3, 3]);
});
test("Qoder keeps sanitized auth, catalog and network diagnostics without replay and preserves caller cancellation", async () => {
  const { models, model } = await fixture();
  let calls = 0;
  const fail: typeof fetch = async () => { calls++; throw Error("Qoder SECRET-token"); };
  const network = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", maxRetries: 4, fetch: fail });
  assert.equal(network.stopReason, "error"); assert.match(network.errorMessage!, /网络请求失败.*未自动重放/); assert.equal(calls, 1);
  const invalid = await models.completeSimple(model, context, { apiKey: "dt-SECRET-token", fetch: fail });
  assert.equal(invalid.stopReason, "error"); assert.match(invalid.errorMessage!, /Personal Access Token/); assert.equal(calls, 1);
  const exchange = await models.completeSimple(model, context, { apiKey: "pt-UNSEEN", fetch: fail });
  assert.equal(exchange.stopReason, "error"); assert.match(exchange.errorMessage!, /网络或响应异常/); assert.equal(calls, 2);
  const fresh = createModels(); fresh.setProvider(qoderProvider("cn"));
  const catalog = await fresh.completeSimple(model, context, {
    apiKey: JSON.stringify({ region: "cn", token: "dt-FIXTURE", userId: "fixture-user", machineId: "fixture-machine" }),
    fetch: async input => { calls++; return String(input).includes("endpoints") ? json({ inferNodes: ["https://gateway.qoder.com.cn"] }) : json({ chat: [] }); },
  });
  assert.equal(catalog.stopReason, "error"); assert.match(catalog.errorMessage!, /账号没有可用模型/); assert.equal(calls, 4);
  for (const result of [network, invalid, exchange, catalog]) assert.doesNotMatch(result.errorMessage!, /SECRET|Connection error/);
  const controller = new AbortController(); let inference = 0;
  const cancelled = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", signal: controller.signal, fetch: async (_input, init) => {
    inference++; controller.abort(); init?.signal?.throwIfAborted(); throw Error("unreachable");
  } });
  assert.equal(cancelled.stopReason, "aborted"); assert.equal(inference, 1);
});
test("Qoder forced catalog refresh revokes stale vision capability without fallback", async () => {
  const { provider, models, model, transport } = await fixture();
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("model/list") ? json({ chat: [{ ...modelConfig, is_vl: false }] }) : transport(input, init);
  try {
    await provider.refreshModels!({ allowNetwork: true, force: true, signal: new AbortController().signal,
      credential: { type: "api_key", key: "pt-FIXTURE" }, publish: async publication => { publication.update?.(); return true; } });
  } finally { globalThis.fetch = previous; }
  assert.deepEqual(provider.getModels()[0].input, ["text"]);
  let calls = 0;
  const result = await models.completeSimple(model, { messages: [{ role: "user", timestamp: 1, content: [png] }] }, {
    apiKey: "pt-FIXTURE", fetch: async () => { calls++; throw Error("must not infer"); },
  });
  assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /所选模型不支持图片/); assert.equal(calls, 0);
});
test("Qoder SSE handles bytewise Unicode and stops terminal keepalive", async () => {
  const bytes = new TextEncoder().encode(envelope(chunk({ content: "中文🙂" })) + envelope(chunk({ finish_reason: "stop" })) + envelope({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  let offset = 0, cancelled = false;
  const upstream = new Response(new ReadableStream({ pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
  const text = await unwrapQoderSse(upstream).text();
  assert.match(text, /中文🙂/); assert.match(text, /\[DONE\]/); assert.equal(cancelled, true);
});
test("Qoder nested resource-limit errors override SSE 403 without leaking upstream messages or retrying", async () => {
  // Observed live: HTTP 200 → SSE 403 → JSON body code 403 → message JSON code 10605.
  const resourceLimit = { code: "403", message: JSON.stringify({ code: "10605", message: JSON.stringify({ isQueued: true, retryAfterSeconds: 30, subCode: "RESOURCE_LIMIT", secret: "SECRET" }), subCode: "RESOURCE_LIMIT" }) };
  const { models, model } = await fixture();
  let calls = 0;
  const result = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", maxRetries: 4, fetch: async () => {
    calls++;
    return new Response(envelope(chunk({ content: "partial" })) + envelope(resourceLimit, 403), { headers: { "content-type": "text/event-stream" } });
  } });
  assert.equal(result.stopReason, "error"); assert.equal(calls, 1);
  assert.match(result.errorMessage!, /资源繁忙.*10605/); assert.match(result.errorMessage!, /未自动重放/);
  assert.doesNotMatch(result.errorMessage!, /认证|重新登录|HTTP 403|SECRET/);
  for (const body of [{ code: 10605 }, { error: { code: "10605", message: "SECRET" } }, { code: 403, message: JSON.stringify({ code: 112, message: "SECRET" }) }]) {
    const response = new Response(envelope(body), { headers: { "content-type": "text/event-stream" } });
    await assert.rejects(unwrapQoderSse(response).text(), error => error instanceof Error && /资源繁忙|额度不足/.test(error.message) && !error.message.includes("SECRET"));
  }
});
test("Qoder unknown denials retain HTTP versus SSE stage and bound nested error inspection", async () => {
  assert.match(qoderFailure(403).message, /HTTP 403/);
  assert.doesNotMatch(qoderFailure(403).message, /重新登录/);
  for (const detail of ["SECRET", '{"code":"SECRET"', [10605], { message: "SECRET 10605" }, JSON.stringify({ code: "10605", message: "SECRET".repeat(2000) })]) {
    const error = qoderFailure(403, detail, "sse");
    assert.match(error.message, /事件流状态 403/); assert.doesNotMatch(error.message, /HTTP 403|SECRET|资源繁忙/);
  }
  let deep: unknown = { code: 10605 };
  for (let i = 0; i < 10; i++) deep = { body: deep };
  assert.doesNotMatch(qoderFailure(403, deep, "sse").message, /资源繁忙/);
  const response = new Response(envelope({ code: 403, message: "SECRET" }, 403), { headers: { "content-type": "text/event-stream" } });
  await assert.rejects(unwrapQoderSse(response).text(), error => error instanceof Error && /事件流状态 403/.test(error.message) && !error.message.includes("SECRET"));
});
test("Qoder SSE malformed, truncated and mid-stream business errors never become a successful response", async () => {
  for (const text of [envelope(chunk({ content: "partial" })), 'data: not-json\n\n', envelope(chunk({ content: "partial" })) + envelope({ code: 112, message: "SECRET" }), envelope("SECRET", 403)]) {
    const response = new Response(text, { headers: { "content-type": "text/event-stream" } });
    await assert.rejects(unwrapQoderSse(response).text(), error => error instanceof Error && error.message.startsWith("Qoder ") && !error.message.includes("SECRET"));
  }
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
  const promise = unwrapQoderSse(response, controller.signal).text(); controller.abort();
  await assert.rejects(promise, { name: "AbortError" }); assert.equal(cancelled, true);
});
test("Qoder SSE enforces size before parsing and sanitizes upstream errors", async () => {
  const oversized = new TextEncoder().encode(envelope(chunk({ content: "中".repeat(2 * 1024 * 1024) })));
  for (const size of [oversized.length, 65536]) {
    let offset = 0;
    const response = new Response(new ReadableStream({ pull(controller) {
      if (offset === oversized.length) controller.close();
      else { controller.enqueue(oversized.slice(offset, offset + size)); offset = Math.min(oversized.length, offset + size); }
    } }), { headers: { "content-type": "text/event-stream" } });
    await assert.rejects(unwrapQoderSse(response).text(), /大小限制/);
  }
  const failed = new Response(new ReadableStream({ pull() { throw Error("Qoder SECRET-token"); } }), { headers: { "content-type": "text/event-stream" } });
  await assert.rejects(unwrapQoderSse(failed).text(), error => error instanceof Error && !error.message.includes("SECRET"));
  await assert.rejects(unwrapQoderSse(sse([])).text(), /缺少结束状态/);
});
test("Qoder SSE ignores interim usage for termination and does not await uncooperative cancellation", async () => {
  const text = envelope({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }) + envelope(chunk({ content: "done" }, "stop"))
    + envelope({ choices: [], usage: { prompt_tokens: 99, completion_tokens: 9 } });
  let sent = false, cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) {
    if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(text)); }
  }, cancel() { cancelled = true; return new Promise<void>(() => {}); } }), { headers: { "content-type": "text/event-stream" } });
  const result = await unwrapQoderSse(response).text();
  assert.match(result, /"prompt_tokens":99/); assert.equal(cancelled, true);
});
