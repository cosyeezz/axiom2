import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, getSupportedThinkingLevels, InMemoryCredentialStore, InMemoryModelsStore, normalizeContext, Type, type AssistantMessageEvent, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import { kiroThinkingModel, kiroThinkingRequest } from "../src/server/providers/kiro-thinking.js";
import { KiroThinkingStream } from "../src/server/providers/kiro-thinking-stream.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const account = (): KiroCredential => ({ type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" });
const model = (id = "claude-opus-4.6"): Model<"kiro-chat"> => ({ id, name: id, provider: "kiro", api: "kiro-chat", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text", "image"], ...kiroThinkingModel(id), contextWindow: 200000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
const context = (systemPrompt?: string): Context => ({ systemPrompt, messages: [{ role: "user", content: "hello", timestamp: 1 }] });
const answer = () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" })]);
async function setup() {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account());
  const models = createModels({ credentials }); models.setProvider(kiroProvider()); return models;
}
async function run(target: Model<"kiro-chat">, options: SimpleStreamOptions = {}, ctx = context(), fetch: typeof globalThis.fetch = async () => answer()) {
  const models = await setup(), stream = models.streamSimple(target, ctx, { ...options, fetch });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { result: await stream.result(), events };
}
const combine = (parts: ReturnType<KiroThinkingStream["push"]>) => ({
  thinking: parts.filter(part => part.type === "thinking").map(part => part.text).join(""),
  text: parts.filter(part => part.type === "text").map(part => part.text).join(""),
});

test("Kiro compatibility profiles expose only implemented levels, not generic name guesses", () => {
  for (const id of ["claude-sonnet-4.5", "claude-opus-4.5", "claude-haiku-4.5"])
    assert.deepEqual(getSupportedThinkingLevels(model(id)), ["off", "minimal", "low", "medium", "high"]);
  assert.deepEqual(getSupportedThinkingLevels(model("claude-sonnet-4.6")), ["off", "low", "medium", "high"]);
  assert.deepEqual(getSupportedThinkingLevels(model()), ["off", "low", "medium", "high", "max"]);
  for (const id of ["claude-opus-4.7", "claude-opus-4.8", "claude-fable-5", "gpt-5.6-sol"])
    assert.deepEqual(getSupportedThinkingLevels(model(id)), ["off", "low", "medium", "high", "xhigh", "max"]);
  for (const id of ["auto", "claude-unknown-9", "untrusted-claude-opus-4.6", "claude-opus-4.6-thinking", "gpt-5.6-unknown"])
    assert.deepEqual(getSupportedThinkingLevels(model(id)), ["off"]);
});

test("Kiro adaptive levels reach real root output_config and control tags, including empty system prompts", async () => {
  for (const id of ["claude-opus-4.6", "claude-sonnet-4.6", "claude-opus-4.7"]) {
    for (const level of getSupportedThinkingLevels(model(id)).filter(level => level !== "off")) {
      for (const system of [undefined, "", "Full Axiom policy"]) {
        const target = model(id), ctx = context(system), before = JSON.stringify(ctx);
        let calls = 0;
        const { result } = await run(target, { reasoning: level }, ctx, async (_url, init) => {
          calls++; const payload = JSON.parse(String(init?.body)), user = payload.conversationState.currentMessage.userInputMessage;
          assert.deepEqual(payload.additionalModelRequestFields, { output_config: { effort: level } });
          assert.ok(user.content.startsWith(`<thinking_mode>adaptive</thinking_mode><thinking_effort>${level}</thinking_effort>\n`));
          assert.equal(user.modelId, id); assert.equal(payload.conversationState.history, undefined, "no fake assistant acknowledgement");
          if (system) assert.ok(user.content.includes(system));
          return answer();
        });
        assert.equal(calls, 1); assert.equal(result.stopReason, "stop", result.errorMessage);
        assert.equal(result.providerThinkingLevel, level); assert.equal(JSON.stringify(ctx), before);
        assert.ok(!result.diagnostics?.some(d => d.type === "kiro-unsupported-controls"));
      }
    }
  }
});

test("Kiro budget grades are distinct requests and an explicit budget is sent exactly, without native effort", async () => {
  for (const [reasoning, budget] of Object.entries({ minimal: 1024, low: 4000, medium: 16000, high: 20000 }) as ["minimal" | "low" | "medium" | "high", number][]) {
    const { result } = await run(model("claude-sonnet-4.5"), { reasoning }, context(), async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.additionalModelRequestFields, undefined);
      assert.ok(payload.conversationState.currentMessage.userInputMessage.content.startsWith(`<thinking_mode>enabled</thinking_mode><max_thinking_length>${budget}</max_thinking_length>\n`));
      return answer();
    });
    assert.equal(result.stopReason, "stop", result.errorMessage); assert.equal(result.providerThinkingLevel, String(budget));
  }
  const { result } = await run(model("claude-sonnet-4.5"), { reasoning: "high", thinkingBudgets: { high: 24576 } }, context(), async (_url, init) => {
    assert.match(String(init?.body), /<max_thinking_length>24576<\/max_thinking_length>/); return answer();
  });
  assert.equal(result.stopReason, "stop"); assert.equal(result.providerThinkingLevel, "24576");
});

test("Kiro off does not inject Claude controls or override literal user tags; GPT explicit off uses native none", async () => {
  for (const id of ["claude-sonnet-4.5", "claude-opus-4.6", "claude-opus-4.6-thinking"]) {
    const ctx = context("Literal <thinking_mode>enabled</thinking_mode> quoted by user"), target = model(id);
    const expected = kiroChatRequest(target, normalizeContext(ctx), account(), "stable").payload;
    const { result } = await run(target, { reasoning: undefined, sessionId: "stable" }, ctx, async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), expected); return answer();
    });
    assert.equal(result.stopReason, "stop"); assert.equal(result.providerThinkingLevel, undefined);
  }
  const gpt = model("gpt-5.6-sol");
  assert.equal(kiroThinkingRequest(gpt, {}), undefined);
  const { result } = await run(gpt, { reasoning: undefined }, context(), async (_url, init) => {
    const p = JSON.parse(String(init?.body)); assert.deepEqual(p.additionalModelRequestFields, { reasoning: { effort: "none" } });
    assert.equal(p.conversationState.currentMessage.userInputMessage.content, "hello"); return answer();
  });
  assert.equal(result.providerThinkingLevel, "none");
});

test("Kiro GPT profiles use reasoning.effort, never Claude output_config or XML budget tags", async () => {
  for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    for (const reasoning of ["low", "medium", "high", "xhigh", "max"] as const) {
      const { result } = await run(model(id), { reasoning }, context(), async (_url, init) => {
        const p = JSON.parse(String(init?.body)); assert.deepEqual(p.additionalModelRequestFields, { reasoning: { effort: reasoning } });
        assert.equal(p.conversationState.currentMessage.userInputMessage.content, "hello"); return answer();
      });
      assert.equal(result.stopReason, "stop", result.errorMessage); assert.equal(result.providerThinkingLevel, reasoning);
    }
  }
});

test("Kiro rejects unsupported grades and invalid budgets before fetch, never silently defaults high", async () => {
  const invalid = [
    [model(), { reasoning: "minimal" }], [model(), { reasoning: "xhigh" }], [model(), { reasoning: "extreme" }],
    [model("claude-sonnet-4.6"), { reasoning: "max" }], [model("claude-sonnet-4.5"), { reasoning: "max" }],
    [model("unknown"), { reasoning: "high" }], [model(), { reasoning: "high", thinkingBudgets: { high: 20000 } }],
    ...[null, [], 1000, { high: NaN }, { high: Infinity }, { high: 0 }, { high: -1 }, { high: 1023 }, { high: 24577 }, { high: 1024.5 }, { high: "20000" }, { xhigh: 20000 }].map(thinkingBudgets => [model("claude-sonnet-4.5"), { reasoning: "high", thinkingBudgets }]),
  ] as [Model<"kiro-chat">, SimpleStreamOptions][];
  for (const [target, options] of invalid) {
    let calls = 0;
    const { result } = await run(target, options, context(), async () => { calls++; return answer(); });
    assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /Kiro/); assert.equal(calls, 0);
    assert.ok(!/PRIVATE/.test(result.errorMessage!));
  }
});

test("Kiro unknown models require explicit user reasoning capability, retain native IDs and never guess effort support", async () => {
  const target = { ...model("future-private-model"), reasoning: true };
  const { result } = await run(target, { reasoning: "high" }, context(), async (_url, init) => {
    const p = JSON.parse(String(init?.body)); assert.equal(p.additionalModelRequestFields, undefined);
    assert.equal(p.conversationState.currentMessage.userInputMessage.modelId, target.id);
    assert.match(p.conversationState.currentMessage.userInputMessage.content, /<max_thinking_length>20000<\/max_thinking_length>/);
    return answer();
  });
  assert.equal(result.stopReason, "stop", result.errorMessage);
});

test("Kiro leading thinking tags split at every boundary preserve Unicode and balanced thought/text events", async () => {
  const wire = " \n<thinking>\n推理🌏步骤</thinking>\n\n正文🌟 <thinking>literal</thinking>";
  for (let split = 0; split <= wire.length; split++) {
    const parser = new KiroThinkingStream();
    const parts = [...parser.push(wire.slice(0, split)), ...parser.push(wire.slice(split)), ...parser.finish()];
    assert.deepEqual(combine(parts), { thinking: "推理🌏步骤", text: "正文🌟 <thinking>literal</thinking>" }, `split ${split}`);
    assert.equal(parser.unclosed, false);
  }
  const { result, events } = await run(model(), { reasoning: "high" }, context(), async () => kiroResponse(Array.from(wire).map(content => kiroFrame("assistantResponseEvent", { content })), 1));
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.deepEqual(result.content, [{ type: "thinking", thinking: "推理🌏步骤" }, { type: "text", text: "正文🌟 <thinking>literal</thinking>" }]);
  for (const type of ["text", "thinking"]) {
    assert.equal(events.filter(e => e.type === `${type}_start`).length, 1);
    assert.equal(events.filter(e => e.type === `${type}_end`).length, 1);
  }
});

test("Kiro tag parsing preserves ordinary quotes/code, CRLF, partial tags and malformed closing text", () => {
  for (const wire of ["plain answer", "`<thinking>quoted</thinking>`", '"<thinking>quoted</thinking>"', "```xml\n<thinking>example</thinking>\n```", "Explain <thinking> inline", "<thin", " ".repeat(1025) + "<thinking>literal"]) {
    const parser = new KiroThinkingStream(), parts = [...wire].flatMap(c => parser.push(c)); parts.push(...parser.finish());
    assert.deepEqual(combine(parts), { thinking: "", text: wire });
  }
  const parser = new KiroThinkingStream(), wire = "<thinking>\r\n😀 literal </thinking>inside, then end</thinking>\r\n\r\nanswer";
  const parts = [...wire].flatMap(c => parser.push(c)); parts.push(...parser.finish());
  assert.deepEqual(combine(parts), { thinking: "😀 literal </thinking>inside, then end", text: "answer" });
  const quoted = new KiroThinkingStream(), input = '<thinking>quote "</thinking>\n\nstill thought"; done</thinking>\n\nanswer';
  const quotedParts = [...input].flatMap(c => quoted.push(c)); quotedParts.push(...quoted.finish());
  assert.deepEqual(combine(quotedParts), { thinking: 'quote "</thinking>\n\nstill thought"; done', text: "answer" });
});

test("Kiro tag whitespace limits and candidate EOF are invariant across every split", () => {
  for (const count of [1023, 1024, 1025]) {
    const wire = " ".repeat(count) + "<thinking>abc</thinking>\n\nanswer";
    const expected = count <= 1024 ? { thinking: "abc", text: "answer" } : { thinking: "", text: wire };
    for (let split = 0; split <= wire.length; split++) {
      const parser = new KiroThinkingStream();
      assert.deepEqual(combine([...parser.push(wire.slice(0, split)), ...parser.push(wire.slice(split)), ...parser.finish()]), expected);
    }
  }
  for (const count of [5, 100, 1024]) {
    const wire = "<thinking>abc</thinking>" + " ".repeat(count);
    for (let split = 0; split <= wire.length; split++) {
      const parser = new KiroThinkingStream();
      assert.deepEqual(combine([...parser.push(wire.slice(0, split)), ...parser.push(wire.slice(split)), ...parser.finish()]), { thinking: "abc", text: "" });
      assert.equal(parser.unclosed, false);
    }
  }
  for (const after of [" ".repeat(1025), " ".repeat(1025) + "literal"]) {
    const whole = new KiroThinkingStream(); assert.throws(() => whole.push("<thinking>abc</thinking>" + after), /1024/);
    const chunks = new KiroThinkingStream(); chunks.push("<thinking>abc</thinking>");
    assert.throws(() => { for (const c of after) chunks.push(c); }, /1024/);
  }
});

test("Kiro tag parser emits well-formed Unicode deltas and rejects genuinely isolated surrogates", () => {
  for (const wire of ["🌏正文", "<thinking>🌏推理</thinking>\n\n🌟正文"]) {
    const parser = new KiroThinkingStream(), parts = wire.split("").flatMap(c => parser.push(c)); parts.push(...parser.finish());
    assert.ok(parts.every(part => Buffer.from(part.text, "utf8").toString("utf8") === part.text));
    assert.equal(parts.map(part => part.text).join(""), wire.startsWith("<thinking>") ? "🌏推理🌟正文" : wire);
  }
  for (const wire of ["\uD83C", "\uDF0D", "<thinking>bad\uD83C"]) {
    const parser = new KiroThinkingStream();
    assert.throws(() => { parser.push(wire); parser.finish(); }, /Unicode/);
  }
});

test("Kiro native reasoning events still preserve signatures, and off leaves XML text unparsed", async () => {
  const frames = [kiroFrame("reasoningContentEvent", { text: "native thought", signature: "opaque" }), kiroFrame("assistantResponseEvent", { content: "native answer" })];
  const enabled = await run(model(), { reasoning: "high" }, context(), async () => kiroResponse(frames, 1));
  assert.deepEqual(enabled.result.content, [{ type: "thinking", thinking: "native thought", thinkingSignature: "opaque" }, { type: "text", text: "native answer" }]);
  const off = await run(model(), {}, context(), async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "<thinking>literal</thinking>\n\nanswer" })]));
  assert.deepEqual(off.result.content, [{ type: "text", text: "<thinking>literal</thinking>\n\nanswer" }]);
});

test("Kiro tag EOF and tool boundaries never invent an answer or a max_tokens stop reason", async () => {
  const only = await run(model(), { reasoning: "high" }, context(), async () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "<thinking>unfinished thought" })]));
  assert.equal(only.result.stopReason, "error"); assert.match(only.result.errorMessage!, /有效文本/);
  assert.deepEqual(only.result.content, [{ type: "thinking", thinking: "unfinished thought" }]);
  assert.ok(only.result.diagnostics?.some(d => d.type === "kiro-thinking-tag-unclosed"));
  const tool = { name: "read", description: "read", parameters: Type.Object({}) };
  for (const suffix of ["</thinking>", "</thinking>\n", "</thinking>" + " ".repeat(1024), ""]) {
    const boundary = await run(model(), { reasoning: "high" }, { ...context(), tools: [tool] }, async () => kiroResponse([
      kiroFrame("assistantResponseEvent", { content: "<thinking>tool reasoning" + suffix }),
      kiroFrame("toolUseEvent", { toolUseId: "call", name: "read", input: "{}", stop: true }),
    ], 1));
    assert.equal(boundary.result.stopReason, "toolUse", boundary.result.errorMessage);
    assert.equal(boundary.result.content[0].type, "thinking");
    if (boundary.result.content[0].type === "thinking") assert.equal(boundary.result.content[0].thinking, "tool reasoning");
    assert.equal(boundary.events.filter(e => e.type === "thinking_end").length, 1);
    assert.equal(boundary.result.diagnostics?.some(d => d.type === "kiro-thinking-tag-unclosed") ?? false, suffix === "");
  }
});

test("Kiro real Agent forwards each grade through an image/tool loop, with no tool execution from damaged streams", async () => {
  for (const damaged of [false, true]) {
    const models = await setup(), target = model(); let requests = 0, executions = 0;
    const image = { type: "image" as const, mimeType: "image/png", data: "AA==" };
    const agent = new Agent({ initialState: { model: target, thinkingLevel: "high", systemPrompt: "Keep the entire policy", tools: [{ name: "read", label: "read", description: "read", parameters: Type.Object({}), execute: async () => {
      executions++; return { content: [{ type: "text" as const, text: "tool result" }, image], details: {} };
    } }] }, streamFn: (m, c, options) => models.streamSimple(m, c, { ...options, fetch: async (_url, init) => {
      const p = JSON.parse(String(init?.body)), s = p.conversationState; requests++;
      assert.deepEqual(p.additionalModelRequestFields, { output_config: { effort: "high" } });
      const first = s.history?.[0]?.userInputMessage ?? s.currentMessage.userInputMessage;
      assert.match(first.content, /<thinking_effort>high<\/thinking_effort>[\s\S]*Keep the entire policy/);
      assert.equal((JSON.stringify(s).match(/<thinking_mode>/g) ?? []).length, 1, "control injection does not mutate/replay the transcript");
      if (requests === 1) {
        assert.deepEqual(s.currentMessage.userInputMessage.images, [{ format: "png", source: { bytes: "AA==" } }]);
        const frames = [kiroFrame("assistantResponseEvent", { content: "<thinking>inspect image</thinking>" }), kiroFrame("toolUseEvent", { toolUseId: "call", name: "read", input: "{}", stop: true })];
        if (damaged) frames.push(kiroFrame("metadataEvent", {}).subarray(0, 15));
        return kiroResponse(frames, 1);
      }
      assert.deepEqual(s.currentMessage.userInputMessage.images, [{ format: "png", source: { bytes: "AA==" } }]);
      assert.equal(s.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].toolUseId, "call");
      assert.match(s.history[1].assistantResponseMessage.content, /inspect image/);
      return kiroResponse([kiroFrame("assistantResponseEvent", { content: "<thinking>checked</thinking>\n\nDone" })], 1);
    } }) });
    await agent.prompt("Inspect", [image]);
    assert.equal(executions, damaged ? 0 : 1); assert.equal(requests, damaged ? 1 : 2);
    const last = agent.state.messages.at(-1)!; assert.equal(last.role, "assistant");
    if (last.role === "assistant") { assert.equal(last.stopReason, damaged ? "error" : "stop"); assert.equal(last.thinkingLevel, "high"); }
  }
});

test("Kiro catalog/cache restoration upgrades adapter thinking metadata without changing vision or issuing offline requests", async () => {
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  await credentials.modify("kiro", async () => account());
  const models = createModels({ credentials, modelsStore });
  models.setProvider(kiroProvider({ fetch: async () => new Response(JSON.stringify({ models: [{ modelId: "claude-opus-4.6", supportedInputTypes: ["TEXT", "IMAGE"] }, { modelId: "unknown-model" }], defaultModel: { modelId: "claude-opus-4.6" } })) }));
  assert.equal((await models.refresh()).errors.size, 0);
  assert.deepEqual(getSupportedThinkingLevels(models.getModel("kiro", "claude-opus-4.6")!), ["off", "low", "medium", "high", "max"]);
  const stored = (await modelsStore.read("kiro"))!, before = JSON.stringify(stored);
  for (const cacheVersion of [1, 2]) {
    const old = { ...stored, cacheVersion, models: stored.models.map(m => ({ ...m, reasoning: false, thinkingLevelMap: undefined, ...(cacheVersion === 1 ? { input: ["text" as const], kiroSupportedInputTypes: undefined } : {}) })) };
    await modelsStore.write("kiro", old);
    const reopened = createModels({ credentials, modelsStore }); reopened.setProvider(kiroProvider({ fetch: async () => { throw Error("NO NETWORK"); } }));
    assert.equal((await reopened.refresh({ allowNetwork: false })).errors.size, 0);
    const restored = reopened.getModel("kiro", "claude-opus-4.6")!;
    assert.deepEqual(getSupportedThinkingLevels(restored), ["off", "low", "medium", "high", "max"]);
    assert.deepEqual(restored.input, cacheVersion === 1 ? ["text"] : ["text", "image"]);
    assert.equal(reopened.getModel("kiro", "unknown-model")!.reasoning, false);
    assert.equal(JSON.stringify(await modelsStore.read("kiro")), JSON.stringify(old), "offline metadata normalization is not a cache write");
  }
  assert.ok(!/PRIVATE/.test(before));
});
