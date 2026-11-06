import assert from "node:assert/strict";
import { test } from "node:test";
import type { NativeContext, NativeInputContent } from "../src/native-providers/contracts.js";
import { codeBuddyBuiltinModels } from "../src/native-providers/codebuddy/models.js";
import { prepareCodeBuddyRequest } from "../src/native-providers/codebuddy/request.js";

const model = codeBuddyBuiltinModels().find(model => model.id === "deepseek-v4.1-flash")!;
const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };
const signal = new AbortController().signal;
function context(result: NativeInputContent): NativeContext {
  return { systemPrompt: "Caller policy /real/path Axiom must stay.", messages: [
    { role: "user", content: "Look at the file." },
    { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "call-image", name: "read", arguments: { path: "fixture.png" } }] },
    { role: "toolResult", toolCallId: "call-image", toolName: "read", isError: false, content: result },
    { role: "user", content: "Recall the picture." },
  ] };
}

test("CN product gateway preserves image tool-result role, text, bytes and next-turn history", async () => {
  for (const result of [[image], [{ type: "text" as const, text: "Image read successfully" }, image, image]]) {
    const input = context(result), before = structuredClone(input);
    const prepared = await prepareCodeBuddyRequest(model, "FIXTURE", input, {}, signal);
    const { messages } = JSON.parse(prepared.body);
    assert.deepEqual(input, before);
    assert.equal(messages[0].content, input.systemPrompt);
    assert.equal(messages[3].role, "tool");
    assert.equal(messages[3].tool_call_id, "call-image");
    assert.deepEqual(messages[3].content, result.map(part => part.type === "image"
      ? { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
      : part));
    assert.equal(messages[4].role, "user");
    assert.equal(messages[4].content, "Recall the picture.");
    assert.equal(messages.length, 5, "product gateway must not use custom-model image hoist");
  }
});

test("consecutive image and text tool results keep call IDs and later-turn history", async () => {
  const input = context([image]);
  const assistant = input.messages[1];
  assert.equal(assistant.role, "assistant");
  if (assistant.role !== "assistant") throw Error("fixture");
  assert.ok(Array.isArray(assistant.content));
  if (!Array.isArray(assistant.content)) throw Error("fixture");
  assistant.content.push({ type: "toolCall", id: "call-text", name: "read", arguments: { path: "fixture.txt" } });
  input.messages = [...input.messages.slice(0, 3), { role: "toolResult", toolCallId: "call-text", toolName: "read", isError: false, content: "TEXT RESULT" }, ...input.messages.slice(3)];
  const { messages } = JSON.parse((await prepareCodeBuddyRequest(model, "FIXTURE", input, {}, signal)).body);
  assert.deepEqual(messages.slice(3, 5).map((m: any) => [m.role, m.tool_call_id]), [["tool", "call-image"], ["tool", "call-text"]]);
  assert.equal(messages[4].content, "TEXT RESULT");
  assert.equal(messages[5].content, "Recall the picture.");
  assert.equal(messages[3].content[0].image_url.url, "data:image/png;base64,aW1hZ2U=");
});

test("image support never strips unsupported or invalid images and retains tool pairing", async () => {
  await assert.rejects(prepareCodeBuddyRequest({ ...model, input: ["text"] }, "FIXTURE", context([image]), {}, signal));
  await assert.rejects(prepareCodeBuddyRequest(model, "FIXTURE", context([{ ...image, mimeType: "text/plain" }]), {}, signal));
  const input = context([image]);
  input.messages = input.messages.filter(message => message.role !== "assistant");
  await assert.rejects(prepareCodeBuddyRequest(model, "FIXTURE", input, {}, signal));
});

test("composite tool ID support does not broaden protocol identity headers", async () => {
  for (const options of [
    { sessionId: "invalid|identity" }, { continuationId: "invalid|identity" },
    { identity: { invocationId: "invalid|identity" } }, { identity: { rootRequestId: "invalid|identity" } },
  ]) await assert.rejects(prepareCodeBuddyRequest(model, "FIXTURE", { messages: [{ role: "user", content: "Continue" }] }, options, signal));
});

test("caller identity and arbitrary SDK headers cannot expand the protocol header allowlist", async () => {
  const prepared = await prepareCodeBuddyRequest(model, "FIXTURE", { messages: [{ role: "user", content: "Axiom caller content stays." }] }, {
    headers: { "x-axiom-session": "local-id", "x-sdk-version": "pi", "traceparent": "local-trace", "Accept-Language": "private" },
  }, signal);
  for (const key of ["x-axiom-session", "x-sdk-version", "traceparent", "accept-language"]) assert.equal(prepared.headers.has(key), false);
  assert.match(prepared.body, /Axiom caller content stays/);
});
