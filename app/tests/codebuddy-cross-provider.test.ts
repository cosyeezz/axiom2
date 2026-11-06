import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { codeBuddyProvider } from "../src/server/providers/codebuddy-cn.js";

const foreign = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
  role: "assistant", api: "openai-responses", provider: "openai", model: "foreign-model", content, stopReason, timestamp: 2,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});
const response = () => new Response('data: {"choices":[{"index":0,"delta":{"content":"CONTINUED"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
async function continueHistory(messages: Context["messages"], expectedStop: "stop" | "error" = "stop") {
  const provider = codeBuddyProvider(), models = createModels(); models.setProvider(provider);
  let payload: any, sent = 0;
  try {
    const result = await models.streamSimple(provider.getModels().find(m => m.id === "deepseek-v4.1-flash")!, {
      systemPrompt: "CALLER_SECURITY", messages,
    }, { apiKey: "SYNTHETIC", reasoning: "high", maxRetries: 0, fetch: async (_url, init) => { sent++; payload = JSON.parse(String(init?.body)); return response(); } }).result();
    assert.equal(result.stopReason, expectedStop, result.errorMessage);
    assert.equal(sent, expectedStop === "stop" ? 1 : 0);
    if (expectedStop === "error") return;
    assert.equal(payload.reasoning_effort, "high");
    assert.ok(payload.messages.some((m: any) => m.role === "system" && m.content.includes("CALLER_SECURITY")));
    return payload;
  } finally { provider.dispose(); }
}

test("foreign signed thinking retains visible history without replaying opaque signature", async () => {
  const messages: Context["messages"] = [
    { role: "user", content: "Remember VALUE_5832", timestamp: 1 },
    foreign([{ type: "thinking", thinking: "VISIBLE_REASONING", thinkingSignature: "OPAQUE_FOREIGN_STATE" }, { type: "text", text: "VISIBLE_ANSWER" }]),
    { role: "user", content: "Continue with the remembered value", timestamp: 3 },
  ];
  const original = structuredClone(messages), body = await continueHistory(messages);
  const serialized = JSON.stringify(body);
  assert.ok(serialized.includes("VISIBLE_REASONING")); assert.ok(serialized.includes("VISIBLE_ANSWER"));
  assert.ok(!serialized.includes("OPAQUE_FOREIGN_STATE")); assert.deepEqual(messages, original);
});

test("foreign composite tool IDs retain call result association when switching to CodeBuddy", async () => {
  const id = "call_owned|fc_owned";
  const messages: Context["messages"] = [
    { role: "user", content: "Read fixture", timestamp: 1 },
    foreign([{ type: "toolCall", id, name: "read", arguments: { path: "fixture.txt" } }], "toolUse"),
    { role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "TOOL_VALUE_5832" }], isError: false, timestamp: 3 },
    foreign([{ type: "text", text: "Recorded fixture" }]),
    { role: "user", content: "Continue from tool result", timestamp: 4 },
  ];
  const original = structuredClone(messages), body = await continueHistory(messages);
  const call = body.messages.find((m: any) => m.tool_calls)?.tool_calls[0];
  const result = body.messages.find((m: any) => m.role === "tool");
  assert.equal(call.id, id); assert.equal(result.tool_call_id, id);
  assert.equal(call.function.name, "read"); assert.equal(result.content, "TOOL_VALUE_5832");
  assert.deepEqual(messages, original);
});

test("empty foreign signature state creates neither opaque replay nor empty assistant entries", async () => {
  const body = await continueHistory([
    { role: "user", content: "First input", timestamp: 1 },
    foreign([{ type: "thinking", thinking: "", thinkingSignature: "EMPTY_OPAQUE_STATE" }]),
    foreign([{ type: "text", text: "" }]),
    foreign([{ type: "thinking", thinking: "VISIBLE_ONLY", thinkingSignature: "SECOND_OPAQUE_STATE" }]),
    { role: "user", content: "Continue", timestamp: 3 },
  ]);
  const assistants = body.messages.filter((m: any) => m.role === "assistant");
  assert.equal(assistants.length, 1); assert.equal(assistants[0].reasoning_content, "VISIBLE_ONLY");
  assert.equal(assistants[0].content, ""); assert.ok(!JSON.stringify(body).includes("OPAQUE_STATE"));
});

test("distinct composite IDs sharing the call prefix cannot collide or become falsely paired", async () => {
  const one = "call_shared|fc_one", two = "call_shared|fc_two";
  const body = await continueHistory([
    { role: "user", content: "Read two fixtures", timestamp: 1 },
    foreign([one, two].map(id => ({ type: "toolCall" as const, id, name: "read", arguments: { path: "fixture" } })), "toolUse"),
    ...[one, two].map((id, i) => ({ role: "toolResult" as const, toolCallId: id, toolName: "read", content: [{ type: "text" as const, text: `VALUE_${i}` }], isError: false, timestamp: 3 })),
    { role: "user", content: "Continue", timestamp: 4 },
  ]);
  assert.deepEqual(body.messages.find((m: any) => m.tool_calls).tool_calls.map((c: any) => c.id), [one, two]);
  assert.deepEqual(body.messages.filter((m: any) => m.role === "tool").map((m: any) => m.tool_call_id), [one, two]);
});

test("cross-model compatibility never manufactures missing results or repairs duplicate calls", async () => {
  const call = { type: "toolCall" as const, id: "call_owned|fc_owned", name: "read", arguments: { path: "fixture" } };
  const result = { role: "toolResult" as const, toolCallId: call.id, toolName: "read", content: [{ type: "text" as const, text: "VALUE" }], isError: false, timestamp: 3 };
  for (const middle of [
    [foreign([call], "toolUse")],
    [foreign([call, call], "toolUse"), result],
    [result],
    ...(["aborted", "error", "length"] as const).map(stop => [foreign([call], stop), result]),
  ]) {
    const messages: Context["messages"] = [{ role: "user", content: "First input", timestamp: 1 }, ...middle, { role: "user", content: "Continue", timestamp: 4 }];
    const original = structuredClone(messages); await continueHistory(messages, "error"); assert.deepEqual(messages, original);
  }
});

test("unsupported redacted and namespaced histories still fail before send", async () => {
  for (const block of [
    { type: "thinking" as const, thinking: "", thinkingSignature: "UNSUPPORTED_REDACTED", redacted: true },
    { type: "toolCall" as const, id: "call_owned|fc_owned", name: "read", namespace: "unsupported", arguments: {} },
    { type: "toolCall" as const, id: "call_owned|fc_owned", name: "read", argumentsError: "invalid", arguments: {} },
  ]) await continueHistory([
    { role: "user", content: "First input", timestamp: 1 }, foreign([block]), { role: "user", content: "Continue", timestamp: 3 },
  ], "error");
});
