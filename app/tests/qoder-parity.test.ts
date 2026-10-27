import assert from "node:assert/strict";
import { test } from "node:test";
import { Socket } from "node:net";
import { createModels, Type, normalizeContext, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { qoderProvider } from "../src/server/providers/qoder.js";
import { normalizeQoderConfig, qoderContext, qoderDescriptor, qoderFeatureSelections, qoderReasoning } from "../src/server/providers/qoder-catalog.js";
import { buildQoderRequest, qoderBudgetEffort, qoderGeneration, qoderMessages, qoderReplaySignature } from "../src/server/providers/qoder-client.js";
import { QoderCredentials, qoderExpiry, qoderOAuth } from "../src/server/providers/qoder-auth.js";
import { decodeQoderBody, qoderHeaders, qoderJson } from "../src/server/providers/qoder-protocol.js";
import { unwrapQoderSse } from "../src/server/providers/qoder-sse.js";

Socket.prototype.connect = function () { throw Error("Real sockets forbidden in Qoder parity tests"); } as typeof Socket.prototype.connect;
const json = (body: unknown) => new Response(JSON.stringify(body));
const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
const delta = (value: unknown, finish_reason?: string) => ({ choices: [{ index: 0, delta: value, ...(finish_reason ? { finish_reason } : {}) }] });
const response = (chunks: unknown[] = [delta({ content: "ok" }, "stop")]) => new Response(chunks.map(frame).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const config = { key: "fixture", source: "system", is_vl: true, is_reasoning: true, max_input_tokens: 200000, max_output_tokens: 1024,
  thinking_config: { enabled: { efforts: { low: {}, high: { is_default: true }, max: {} } }, disabled: {} },
  context_config: { a: { token_count: 32000, is_default: true }, b: { token_count: 128000 } },
  function_switches: [{ key: "fast", type: "boolean", options: { true: {}, false: { is_default: true } } }] };
const context: Context = { systemPrompt: "Keep system policies", messages: [{ role: "user", content: "hello", timestamp: 1 }], tools: [{ name: "read", description: "read", parameters: Type.Object({ path: Type.String() }) }] };
async function fixture(raw: Record<string, unknown>[] = [config]) {
  const provider = qoderProvider(), models = createModels();
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("exchange")) return json({ token: "jt-MOCK", expires_in: 3600 });
    if (url.pathname.endsWith("userinfo")) return json({ uid: "mock-user" });
    if (url.pathname.endsWith("endpoints")) return json({ inferNodes: ["https://api2.qoder.sh"] });
    if (url.pathname.endsWith("model/list")) return json({ chat: raw });
    throw Error("Unexpected fixture endpoint");
  };
  const old = globalThis.fetch; globalThis.fetch = transport;
  try { await provider.refreshModels!({ allowNetwork: true, signal: new AbortController().signal, credential: { type: "api_key", key: "pt-MOCK" }, publish: async publication => { publication.update?.(); return true; } }); }
  finally { globalThis.fetch = old; }
  models.setProvider(provider);
  return { provider, models, model: provider.getModels()[0] };
}
test("Qoder catalog publishes actual vision, thinking, default context and output limits without secrets", async () => {
  const { provider, model } = await fixture([config, { key: "off", enable: 0 }, { key: "off2", enable: false }, { key: "external", source: "user", byok_parameters: { api_key: "SECRET" }, url: "https://private.invalid" }]);
  assert.deepEqual(provider.getModels().map(model => model.id), ["fixture", "external"]);
  assert.deepEqual(model.input, ["text", "image"]); assert.equal(model.reasoning, true); assert.equal(model.contextWindow, 32000);
  assert.deepEqual(model.thinkingLevelMap, { off: "none", minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" });
  assert.equal(JSON.stringify(provider.getModels()).includes("SECRET"), false); assert.equal(JSON.stringify(provider.getModels()).includes("private.invalid"), false);
  const fallback = qoderDescriptor("intl", normalizeQoderConfig({ model_key: "other", max_output_tokens: "9000" })!);
  assert.equal(fallback.maxTokens, 9000); assert.equal(fallback.contextWindow, 200000);
  assert.equal(qoderDescriptor("intl", normalizeQoderConfig({ key: "other" })!).maxTokens, 32000);
  assert.deepEqual(qoderReasoning(config), { efforts: ["low", "high", "max"], supportsDisabled: true, defaultEffort: "high" });
  assert.deepEqual(qoderContext({ available_context_tokens: {}, context_config: { a: { token_count: 32000, is_default: "1" }, b: { token_count: 64000, is_default: 1 } } }), { windows: [32000, 64000], defaultWindow: 64000 });
  assert.deepEqual(qoderFeatureSelections(config, { fast: "bad" }), { fast: "false" }); assert.equal(qoderFeatureSelections(config, undefined), undefined);
});
test("Qoder generation validation and budget thresholds follow the published contract", () => {
  assert.deepEqual(qoderGeneration({ temperature: 4, topP: 1, topK: 4, maxTokens: 2000, reasoning: { thinking: { type: "enabled", budgetTokens: 8192 }, preserve: false } }), { temperature: 4, top_p: 1, top_k: 4, max_tokens: 2000, reasoning_effort: "medium", enable_thinking: true, reasoning_budget_tokens: 8192, preserve_thinking: false });
  assert.deepEqual(qoderGeneration({ temperature: -1, topP: 1.1, topK: "2", maxTokens: 1.5 }), {});
  assert.deepEqual(qoderGeneration({ reasoning: { enabled: true, effort: "high", thinking: { type: "disabled" } } }), { reasoning_effort: "none", enable_thinking: false });
  assert.deepEqual([-1, 0, 1024, 1025, 8192, 8193, 24576, 24577, 49152, 49153].map(qoderBudgetEffort), ["none", "none", "low", "medium", "medium", "high", "high", "xhigh", "xhigh", "max"]);
  const normalized = normalizeQoderConfig(config)!, model = qoderDescriptor("intl", normalized);
  const payload = buildQoderRequest({ temperature: -1, top_p: 4, top_k: -2 }, normalized, "intl", model, normalizeContext(context), { generation: { temperature: 2, maxTokens: 3000 } });
  assert.equal(payload.parameters.temperature, 2); assert.equal(payload.parameters.top_p, undefined); assert.equal(payload.parameters.top_k, undefined); assert.equal(payload.parameters.max_tokens, 3000);
});
test("Qoder final wire honors Pi thinking, explicit none, context, tool choice, features and native onPayload", async () => {
  const { models, model } = await fixture();
  for (const reasoning of [undefined, "off", "high"] as const) {
    let hooks = 0;
    const options: SimpleStreamOptions = { apiKey: "pt-MOCK", maxTokens: 3000, ...(reasoning !== undefined ? { reasoning: reasoning === "off" ? undefined : reasoning } : {}), toolChoice: "none", sessionId: "session-fixture",
      samplingParams: { temperature: 2, top_p: 0.7, top_k: 5, qoder: { contextWindow: 128000, functionSwitchSelections: { fast: "true" } } },
      onPayload(value) { const payload = value as Record<string, any>; hooks++; assert.equal(payload.model_config.key, "fixture"); payload.patches = { fixture: "native" }; return payload; },
      fetch: async (_url, init) => {
        const body = JSON.parse(decodeQoderBody(String(init?.body)));
        assert.equal(body.parameters.reasoning_effort, reasoning === "off" ? "none" : "high");
        assert.equal(body.model_config.is_reasoning, reasoning !== "off");
        assert.deepEqual([body.parameters.temperature, body.parameters.top_p, body.parameters.top_k, body.parameters.max_tokens], [2, 0.7, 5, 3000]);
        assert.equal(body.parameters.tool_choice, "none"); assert.equal(body.parameters.context_length, 128000);
        assert.deepEqual(body.business.feature_switches, { fast: "true" }); assert.deepEqual(body.patches, { fixture: "native" });
        assert.equal(body.session_id, "session-fixture"); assert.equal(body.request_id, body.chat_record_id); assert.equal(body.request_set_id, body.request_id);
        assert.equal(body.system, context.systemPrompt); assert.equal(body.messages[0].content, context.systemPrompt);
        return response();
      } };
    const result = await models.completeSimple(model, context, options); assert.equal(result.stopReason, "stop", result.errorMessage); assert.equal(hooks, 1);
  }
});
test("Qoder invalid context is omitted and explicit budget/none changes final reasoning parameters", () => {
  const normalized = normalizeQoderConfig(config)!, model = qoderDescriptor("intl", normalized), transcript = normalizeContext(context);
  const base = { reasoning_budget_tokens: 500, max_tokens: 300 };
  const high = buildQoderRequest(base, normalized, "intl", model, transcript, { thinkingBudget: 9000, contextWindow: 64000 });
  assert.equal(high.parameters.reasoning_effort, "high"); assert.equal(high.parameters.reasoning_budget_tokens, 9000); assert.equal(high.parameters.context_length, undefined);
  const off = buildQoderRequest(base, normalized, "intl", model, transcript, { reasoningEffort: "none", thinkingBudget: 9000 });
  assert.equal(off.parameters.reasoning_budget_tokens, undefined); assert.equal(off.parameters.enable_thinking, false); assert.equal(off.model_config.is_reasoning, false);
  const noExplicit = buildQoderRequest({}, normalized, "intl", model, transcript);
  assert.equal(noExplicit.parameters.context_length, undefined); assert.equal(noExplicit.business.feature_switches, undefined);
});
test("Qoder vision sends user and tool images as image_url arrays and retains tool errors", async () => {
  const { models, model } = await fixture(), image = { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };
  const vision: Context = { messages: [{ role: "user", content: [{ type: "text", text: "look" }, image], timestamp: 1 }, { role: "toolResult", toolCallId: "one", toolName: "read", isError: true, timestamp: 2, content: [image] }] };
  const result = await models.completeSimple(model, vision, { apiKey: "pt-MOCK", fetch: async (_url, init) => {
    const body = JSON.parse(decodeQoderBody(String(init?.body)));
    assert.equal(body.messages[0].content[1].image_url.url, `data:image/png;base64,${image.data}`); assert.deepEqual(body.messages[0].content, body.messages[0].contents);
    assert.equal(body.messages[1].tool_call_id, "one"); assert.equal(body.messages[1].is_error, true); assert.equal(body.messages[1].content[0].type, "image_url"); return response();
  } }); assert.equal(result.stopReason, "stop", result.errorMessage);
  const nonVision = normalizeQoderConfig({ ...config, is_vl: false })!;
  assert.throws(() => qoderMessages(normalizeContext(vision), qoderDescriptor("intl", nonVision), false), /不支持图片/);
});
test("Qoder thinking signature/encrypted item survives response to next request, preserve=false and cross-model replay is suppressed", async () => {
  const { models, model } = await fixture(), item = { id: "rs_fixture", type: "reasoning", summary: [{ type: "summary_text", text: "summary" }], encrypted_content: "OPAQUE" };
  const first = await models.completeSimple(model, context, { apiKey: "pt-MOCK", fetch: async () => response([delta({ reasoning_content: "analysis", reasoning_item: item, signature: "SIG" }), delta({ content: "answer" }, "stop")]) });
  assert.equal(first.stopReason, "stop", first.errorMessage);
  const thinking = first.content.find(block => block.type === "thinking"); assert.ok(thinking?.thinkingSignature);
  assert.deepEqual(qoderReplaySignature(thinking.thinkingSignature)?.entries, [{ signature: "SIG", item }]);
  const next = normalizeContext({ ...context, messages: [...context.messages, first] });
  const same = qoderMessages(next, model, true).messages.find(message => message.role === "assistant")!;
  assert.deepEqual(same.reasoning_item, item); assert.equal(same.reasoning_content_signature, "SIG");
  const stripped = qoderMessages(next, model, true, false).messages.find(message => message.role === "assistant")!;
  assert.equal(stripped.reasoning_item, undefined); assert.equal(stripped.reasoning_content, undefined); assert.equal(stripped.reasoning_content_signature, undefined);
  const foreign = qoderMessages(next, { ...model, id: "other" }, true).messages.find(message => message.role === "assistant")!;
  assert.equal((foreign.reasoning_item as any)?.encrypted_content, undefined); assert.equal(foreign.reasoning_content_signature, undefined);
});
test("Qoder BYOK projection keeps private keys out of model_config, override does not inherit catalog routing", () => {
  const raw = normalizeQoderConfig({ ...config, key: "byok", source: "user", provider: "Named", type: "kind", model: "upstream", url: "https://catalog.invalid", byok_parameters: { api_key: "CATALOG_SECRET" } })!, model = qoderDescriptor("intl", raw);
  const native = buildQoderRequest({}, raw, "intl", model, normalizeContext(context));
  assert.equal(native.model_config.key, "custom_model"); assert.equal(native.chat_context.extra.modelConfig.key, "byok");
  assert.equal(native.model_config.api_key, ""); assert.equal(native.custom_model?.model, "upstream"); assert.deepEqual(native.custom_model?.parameters, { api_key: "CATALOG_SECRET" }); assert.equal(native.custom_model?.url, undefined);
  const override = buildQoderRequest({}, raw, "intl", model, normalizeContext(context), { customModelOverride: { url: "https://override.invalid", api_key: "OVERRIDE_SECRET", style: "responses" } });
  assert.equal(override.custom_model?.provider, undefined); assert.equal(override.custom_model?.type, undefined); assert.equal(override.custom_model?.url, "https://override.invalid"); assert.equal(override.custom_model?.model, "byok");
  assert.equal(JSON.stringify(override.model_config).includes("SECRET"), false);
});
test("Qoder SSE controls, event finish envelopes and malformed post-finish frames", async () => {
  const notifications: unknown[][] = [];
  const text = "data: [NOT_EXCEED_QUOTA]\n\ndata: [EXCEED_QUOTA]suffix\n\ndata: [NOTIFICATIONS]#{\"notifications\":[\"notice\"]}\n\n" + frame({ statusCodeValue: 403, body: '[NOTIFICATIONS]#{"notifications":["wrapped"]}' }) + frame(delta({ content: "ok" })) + "event: finish\n" + frame({ statusCodeValue: 500, body: JSON.stringify(delta({}, "sensitive")) });
  const output = await unwrapQoderSse(new Response(text, { headers: { "content-type": "text/event-stream" } }), undefined, { onNotification: values => notifications.push(values) }).text();
  assert.deepEqual(notifications, [["notice"], ["wrapped"]]); assert.match(output, /content_filter/); assert.doesNotMatch(output, /EXCEED_QUOTA/);
  for (const bad of [delta({ content: "late" }), delta({}, "length"), { code: 10605 }]) await assert.rejects(unwrapQoderSse(response([delta({}, "stop"), bad])).text(), /Qoder /);
});
test("Qoder SSE legacy function_call becomes a stable Pi tool, malformed fragments never execute", async () => {
  const { models, model } = await fixture();
  const result = await models.completeSimple(model, context, { apiKey: "pt-MOCK", fetch: async () => response([delta({ function_call: { name: "read", arguments: '{"path":' } }), delta({ function_call: { arguments: '"a"}' } }, "function_call")]) });
  assert.equal(result.stopReason, "toolUse", result.errorMessage); assert.deepEqual(result.content.find(block => block.type === "toolCall")?.arguments, { path: "a" });
  for (const call of [{ index: 0, function: { arguments: "{}" } }, { index: 0, id: "bad", function: { name: "read", arguments: '{"path":' } }]) await assert.rejects(unwrapQoderSse(response([delta({ tool_calls: [call] }, "tool_calls")])).text(), /MALFORMED/);
});
test("Qoder PAT aliases, shared exchange and cancellation preserve a stable Axiom identity", async () => {
  const store = new QoderCredentials("cn"), calls: string[] = [], ids: unknown[] = [];
  const transport: typeof fetch = async (input, init) => { const url = String(input); calls.push(url); if (url.endsWith("exchange")) { const body = JSON.parse(String(init?.body)); ids.push(body.machine_id); assert.equal(body.machine_token, undefined); await new Promise(resolve => setTimeout(resolve, 5)); return json({ access_token: "jt-ALIAS", expiresAt: "", expire_time: Date.now() + 3600000, expires_in: 3600 }); } return json({ uid: "fixture" }); };
  const controller = new AbortController();
  const aborted = store.resolve("pt-ONE", transport, controller.signal); const rejected = assert.rejects(aborted, { name: "AbortError" }); controller.abort();
  const successes = await Promise.all([store.resolve("pt-ONE", transport), store.resolve("pt-ONE", transport)]);
  await rejected; assert.deepEqual(successes[0], successes[1]); assert.equal(calls.length, 2);
  const other = await store.resolve("pt-TWO", transport); assert.equal(other.machineId, successes[0].machineId); assert.equal(ids[0], ids[1]);
  assert.ok(qoderExpiry({ expires_at: "bad", expires_in: 3600 }, "pat") > Date.now());
  await assert.rejects(qoderOAuth("cn").refresh({ type: "oauth", access: "dt-X", refresh: "R", userId: "U", machineId: "M", region: "cn", expires: 1, refreshExpires: 1 }, new AbortController().signal), /过期/);
});
test("Qoder cleanup never awaits an uncooperative cancellation; UMID headers are absent", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
  await assert.rejects(qoderJson(async () => new Response(body, { status: 403 }), "https://fixture.invalid", {}), /权限/); assert.equal(cancelled, true);
  const headers = qoderHeaders("body", "https://api2.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation", { token: "dt-X", userId: "U", machineId: "M" });
  assert.equal(headers["Cosy-Machinetoken"], undefined); assert.equal(headers["Cosy-Machinetype"], undefined); assert.equal(headers["Cosy-Version"], "1.1.78"); assert.match(headers["Cosy-Machineos"], new RegExp(`_${process.platform}$`));
});
