import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, Type, type Context } from "@earendil-works/pi-ai";
import { qoderProvider } from "../src/server/providers/qoder.js";
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
async function fixture(region: QoderRegion = "cn") {
  const provider = qoderProvider(region), models = createModels(), calls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.href);
    if (url.pathname.endsWith("endpoints")) return json({ inferNodes: [region === "cn" ? "https://gateway.qoder.com.cn" : "https://api1.qoder.sh"] });
    if (url.pathname.endsWith("exchange")) return json({ token: "jt-FIXTURE", expires_at: new Date(Date.now() + 3600000).toISOString() });
    if (url.pathname.endsWith("userinfo")) return json({ id: "fixture-user" });
    if (url.pathname.endsWith("model/list")) {
      assert.match(new Headers(init?.headers).get("authorization")!, /^Bearer COSY\./);
      return json({ chat: [modelConfig, { key: "hidden", enable: false }] });
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
  assert.equal(provider.getModels().length, 1); assert.deepEqual(model.input, ["text"]);
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
        assert.equal(body.system, context.systemPrompt); assert.ok(!body.messages.some((message: any) => message.role === "system"));
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
test("Qoder fragmented parallel tools and tool results survive round-trip", async () => {
  const { models, model } = await fixture();
  const first = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", fetch: async () => sse([
    chunk({ tool_calls: [{ index: 0, id: "one", type: "function", function: { name: "read", arguments: '{"path":' } }, { index: 1, id: "two", type: "function", function: { name: "read", arguments: '{"path":"b"}' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"a"}' } }], finish_reason: "tool_calls" }),
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
test("Qoder missing models, custom endpoint, images and HTTP errors fail without fallback, leakage or replay", async () => {
  const { models, model } = await fixture();
  let calls = 0;
  const fail: typeof fetch = async () => { calls++; return new Response("SECRET provider body", { status: 503 }); };
  const missing = await models.completeSimple({ ...model, id: "missing" }, context, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(missing.stopReason, "error"); assert.equal(calls, 0);
  const custom = await models.completeSimple({ ...model, baseUrl: "https://not-qoder.invalid" }, context, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(custom.stopReason, "error"); assert.equal(calls, 0);
  const image = await models.completeSimple(model, { messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }], timestamp: 1 }] }, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(image.stopReason, "error"); assert.equal(calls, 0, "images must fail before any inference");
  const toolImage = await models.completeSimple(model, { messages: [...context.messages,
    { role: "toolResult", toolCallId: "image", toolName: "read", content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }], timestamp: 2, isError: false },
  ] }, { apiKey: "pt-FIXTURE", fetch: fail });
  assert.equal(toolImage.stopReason, "error"); assert.equal(calls, 0);
  const error = await models.completeSimple(model, context, { apiKey: "pt-FIXTURE", maxRetries: 4, fetch: fail });
  assert.equal(error.stopReason, "error"); assert.equal(calls, 1); assert.ok(!error.errorMessage?.includes("SECRET"));
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
