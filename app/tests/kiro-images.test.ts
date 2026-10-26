import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { createModels, InMemoryCredentialStore, normalizeContext, Type, type AssistantMessage, type Context, type ImageContent, type Model } from "@earendil-works/pi-ai";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroChat } from "../src/server/providers/kiro-chat.js";
import { kiroOAuth } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const png: ImageContent = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=" };
const account = { type: "oauth" as const, access: "SYNTHETIC-ACCESS", refresh: "SYNTHETIC-REFRESH", expires: 4102444800000, authMethod: "builder-id" as const, authRegion: "us-east-1" };
const model: Model<"kiro-chat"> = { id: "synthetic-vision", name: "Vision", provider: "kiro", api: "kiro-chat", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const tool = { name: "capture", description: "Synthetic screenshot", parameters: Type.Object({}) };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 2, usage, stopReason, content });
const request = (messages: Context["messages"]) => kiroChatRequest(model, normalizeContext({ systemPrompt: "Axiom image test", tools: [tool], messages }), account, "image-session").payload.conversationState;
const user = (content: string | ImageContent[] = "hello") => ({ role: "user" as const, content, timestamp: 1 });
const wireImage = (image: ImageContent = png, format = "png") => ({ format, source: { bytes: image.data } });

test("Kiro sends current user images in native AWS blob JSON, without mutating the transcript", () => {
  const messages: Context["messages"] = [{ role: "user", content: [{ type: "text", text: "look" }, png, { type: "text", text: "closely" }, png], timestamp: 1 }];
  const before = structuredClone(messages), state = request(messages), current = state.currentMessage.userInputMessage;
  assert.equal(current.modelId, model.id); assert.equal(current.origin, "KIRO_CLI");
  assert.equal(current.content, "<axiom_system>\nAxiom image test\n</axiom_system>\n\nlook\nclosely");
  assert.deepEqual(current.images, [wireImage(), wireImage()]);
  assert.deepEqual(messages, before); assert.equal(state.history, undefined);
  assert.ok(!JSON.stringify(current.images).includes("data:image/"));
});

test("Kiro preserves image order through adjacent users, current image-only input and historical replay", () => {
  const second = { ...png, data: Buffer.from("synthetic second image bytes").toString("base64") };
  const state = request([user([png]), user([second]), assistant([{ type: "text", text: "seen" }]), user([png])]);
  const history = state.history!;
  assert.ok("userInputMessage" in history[0]);
  assert.deepEqual(history[0].userInputMessage.images, [wireImage(), wireImage(second)]);
  assert.equal(history[0].userInputMessage.modelId, undefined);
  assert.equal(history[0].userInputMessage.userInputMessageContext?.tools, undefined);
  assert.equal(state.currentMessage.userInputMessage.content, "");
  assert.deepEqual(state.currentMessage.userInputMessage.images, [wireImage()]);
  assert.equal(request([user()]).currentMessage.userInputMessage.images, undefined);
});

test("Kiro serializes all CLI image formats as unchanged base64 bytes, including JPEG alias", () => {
  // Synthetic byte strings exercise the serializer, not image decoding or service acceptance.
  for (const [mimeType, format] of [["image/png", "png"], ["image/jpeg", "jpeg"], ["image/jpg", "jpeg"], ["image/gif", "gif"], ["image/webp", "webp"]]) {
    const image: ImageContent = { type: "image", mimeType, data: Buffer.from(`synthetic ${format} bytes`).toString("base64") };
    assert.deepEqual(request([user([image])]).currentMessage.userInputMessage.images, [wireImage(image, format)]);
  }
});

test("Kiro lifts parallel tool images beside native toolResults and preserves IDs, status and text blocks", () => {
  const state = request([user(), assistant([
    { type: "toolCall", id: "a", name: tool.name, arguments: {} },
    { type: "toolCall", id: "b", name: tool.name, arguments: {} },
  ], "toolUse"),
  { role: "toolResult", toolCallId: "a", toolName: tool.name, isError: false, content: [png], timestamp: 3 },
  { role: "toolResult", toolCallId: "b", toolName: tool.name, isError: true, content: [{ type: "text", text: "first" }, png, { type: "text", text: "" }, { type: "text", text: "last" }], timestamp: 4 },
  ]);
  const current = state.currentMessage.userInputMessage;
  assert.deepEqual(current.images, [wireImage(), wireImage()]);
  assert.deepEqual(current.userInputMessageContext!.toolResults, [
    { toolUseId: "a", status: "success", content: [{ text: "See images data supplied" }] },
    { toolUseId: "b", status: "error", content: [{ text: "first" }, { text: "" }, { text: "last" }] },
  ]);
  assert.ok(!JSON.stringify(current.userInputMessageContext!.toolResults).includes(png.data));
  const next = request([user(), assistant([{ type: "toolCall", id: "a", name: tool.name, arguments: {} }], "toolUse"),
    { role: "toolResult", toolCallId: "a", toolName: tool.name, isError: false, content: [png], timestamp: 3 },
    assistant([{ type: "text", text: "done" }]), user("compare")]);
  const resultHistory = next.history![2]; assert.ok("userInputMessage" in resultHistory);
  assert.deepEqual(resultHistory.userInputMessage.images, [wireImage()]);
  assert.deepEqual(resultHistory.userInputMessage.userInputMessageContext!.toolResults, [{ toolUseId: "a", status: "success", content: [{ text: "See images data supplied" }] }]);
});

test("Kiro validates image formats and canonical base64 without fetching URLs or dropping unknown content", () => {
  for (const image of [
    { ...png, mimeType: "image/svg+xml" }, { ...png, mimeType: "__proto__" }, { ...png, mimeType: "constructor" },
    { ...png, data: "" }, { ...png, data: "data:image/png;base64," + png.data }, { ...png, data: "https://example.invalid/a.png" },
    { ...png, data: "AA=" }, { ...png, data: "AB==" }, { ...png, data: "AA==\n" }, { ...png, data: "a".repeat(10 * 1024 * 1024 + 4) },
  ]) assert.throws(() => request([user([image])]), /Kiro 图片/);
  assert.throws(() => request([{ role: "user", content: [{ type: "audio", data: "AA==" }], timestamp: 1 }] as unknown as Context["messages"]), /不支持的内容块/);
});

test("Kiro runs a Pi Agent image prompt and screenshot tool loop, then replays both images on a later turn", async () => {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  let requests = 0, executions = 0;
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const state = JSON.parse(String(init?.body)).conversationState; requests++;
    if (requests === 1) {
      assert.deepEqual(state.currentMessage.userInputMessage.images, [wireImage()]);
      return kiroResponse([kiroFrame("toolUseEvent", { toolUseId: "screenshot", name: tool.name, input: "{}", stop: true })]);
    }
    if (requests === 2) {
      assert.deepEqual(state.history[0].userInputMessage.images, [wireImage()]);
      assert.deepEqual(state.currentMessage.userInputMessage.images, [wireImage()]);
      assert.deepEqual(state.currentMessage.userInputMessage.userInputMessageContext.toolResults, [{ toolUseId: "screenshot", status: "success", content: [{ text: "See images data supplied" }] }]);
    } else {
      assert.equal(requests, 3);
      assert.deepEqual(state.history[0].userInputMessage.images, [wireImage()]);
      assert.deepEqual(state.history[2].userInputMessage.images, [wireImage()]);
      assert.equal(state.currentMessage.userInputMessage.images, undefined);
    }
    return kiroResponse([kiroFrame("assistantResponseEvent", { content: "Images received by offline fixture" })]);
  };
  const agent = new Agent({ initialState: { model, systemPrompt: "Axiom", tools: [{ ...tool, label: "screenshot", execute: async () => { executions++; return { content: [png], details: {} }; } }] },
    streamFn: (target, context, options) => models.streamSimple(target, context, { ...options, fetch }) });
  await agent.prompt("compare this image with screenshot", [png]);
  assert.equal(requests, 2); assert.equal(executions, 1);
  await agent.prompt("compare again");
  assert.equal(requests, 3); assert.equal(executions, 1);
  const last = agent.state.messages.at(-1)!; assert.equal(last.role, "assistant");
  if (last.role === "assistant") assert.equal(last.stopReason, "stop", last.errorMessage);
});

test("Kiro sends Pi read-tool image output through the same native image path", async () => {
  const read = createReadTool(process.cwd(), { autoResizeImages: false, operations: {
    access: async () => {}, readFile: async () => Buffer.from(png.data, "base64"), detectImageMimeType: async () => "image/png",
  } });
  const output = await read.execute("read-image", { path: "synthetic.png" });
  assert.ok(output.content.some(block => block.type === "image"));
  const state = request([user(), assistant([{ type: "toolCall", id: "read-image", name: "read", arguments: { path: "synthetic.png" } }], "toolUse"),
    { role: "toolResult", toolCallId: "read-image", toolName: "read", content: output.content, isError: false, timestamp: 3 }]);
  const current = state.currentMessage.userInputMessage;
  assert.deepEqual(current.images, [wireImage()]);
  assert.deepEqual(current.userInputMessageContext!.toolResults, [{ toolUseId: "read-image", status: "success", content: output.content.filter(block => block.type === "text").map(block => ({ text: block.text })) }]);
});

test("Kiro rejects an over-budget image request before transport and still aborts image requests", async () => {
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  let calls = 0;
  const large: ImageContent = { ...png, data: Buffer.alloc(4 * 1024 * 1024).toString("base64") };
  const failed = await models.complete(model, { messages: [user([large, large])] }, { fetch: async () => { calls++; throw Error("MUST NOT FETCH"); } });
  assert.equal(failed.stopReason, "error"); assert.match(failed.errorMessage!, /10 MiB/); assert.equal(calls, 0);
  const controller = new AbortController(); controller.abort();
  // Exercise the native adapter: Pi's generic pre-auth path maps a pre-abort to
  // an error before the provider is entered; that unrelated SDK behavior is unchanged.
  const chat = kiroChat(kiroOAuth()), auth = await chat.auth.toAuth(account);
  const aborted = await chat.stream(model, normalizeContext({ messages: [user([png])] }), { apiKey: auth.apiKey, signal: controller.signal, fetch: async () => { calls++; throw Error("MUST NOT FETCH"); } }).result();
  assert.equal(aborted.stopReason, "aborted"); assert.equal(calls, 0);
});
