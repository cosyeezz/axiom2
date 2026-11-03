import assert from "node:assert/strict";
import { test } from "node:test";
import { freshKiroRunIdentity, withKiroRunIdentity } from "../src/server/kiro-run-identity.js";
import { createKiroNativeRequest, prepareKiroNativeRequest, type KiroNativeContext, type KiroNativeAccount } from "../src/server/providers/kiro-native.js";
import { KIRO_CONTINUATION_METADATA as key, validateKiroContinuationId } from "../src/server/providers/kiro-responses.js";

const firstId = "8420ed5f-25e6-4a8c-881a-cf56ae36ef80", nextId = "506f1108-18b6-4d12-949b-96e85bdfb2a5";
const model = { api: "kiro-chat", id: "deepseek-3.2" }, sessionId = "fixture-session";
const auth: KiroNativeAccount = { access: "SYNTHETIC", expires: Date.now() + 60000 };
const context: KiroNativeContext = { systemPrompt: "Full caller security policy",
  tools: [{ name: "read", description: "Original schema", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
  messages: [{ role: "user", content: "Original user content" }] };
const metadata = (payload: Record<string, unknown>) => payload.metadata as Record<string, unknown>;

test("fresh runs supply their durable UUID, not the session or physical request identity", () => {
  const first = freshKiroRunIdentity({ runId: firstId }, sessionId)!;
  const next = freshKiroRunIdentity({ runId: nextId }, sessionId)!;
  assert.equal(first.continuationId, firstId); assert.equal(next.continuationId, nextId);
  for (let i = 0; i < 3; i++) {
    const options = withKiroRunIdentity(model, { sessionId, metadata: { physicalRequest: String(i) } }, first);
    assert.equal((options.metadata as Record<string, unknown>)[key], firstId);
  }
  assert.equal(withKiroRunIdentity(model, { sessionId, metadata: {} as Record<string, unknown> }, next).metadata[key], nextId);
});

test("unknown resume and synthetic modes do not invent inherited continuation IDs", () => {
  for (const mode of [{ resume: true }, { memoryContinuation: true }, { notification: {} }, { reloadId: "reload" }, { compressionPreparation: "prepare" }])
    assert.equal(freshKiroRunIdentity({ runId: firstId, ...mode }, sessionId), undefined);
});

test("identity injection is scoped, immutable and preserves all existing hooks and metadata", () => {
  const identity = freshKiroRunIdentity({ runId: firstId }, sessionId)!;
  const onPayload = () => {}, fetch = async () => new Response();
  const options = { sessionId, metadata: { caller: "kept" }, onPayload, fetch };
  const changed = withKiroRunIdentity(model, options, identity);
  assert.notEqual(changed, options); assert.deepEqual(options.metadata, { caller: "kept" });
  assert.deepEqual(changed.metadata, { caller: "kept", [key]: firstId });
  assert.equal(changed.onPayload, onPayload); assert.equal(changed.fetch, fetch);
  assert.equal(withKiroRunIdentity(model, options), options);
  assert.equal(withKiroRunIdentity({ ...model, api: "other-api" }, options, identity), options);
  assert.equal(withKiroRunIdentity({ ...model, id: "claude-sonnet" }, options, identity), options);
  const auxiliary = { ...options, sessionId: "other-session" };
  assert.equal(withKiroRunIdentity(model, auxiliary, identity), auxiliary);
  assert.equal(withKiroRunIdentity(model, undefined, identity), undefined);
});

test("native callers retain one continuation through tool history and change it only explicitly", () => {
  const before = JSON.stringify(context), identity = { continuationId: firstId };
  const initial = createKiroNativeRequest(model.id, context, auth, sessionId, identity).payload;
  const tools: KiroNativeContext = { ...context, messages: [...context.messages,
    { role: "assistant", content: [{ type: "toolCall", id: "call-fixture", name: "read", arguments: { path: "/fixture" } }], stopReason: "toolUse" },
    { role: "toolResult", toolCallId: "call-fixture", toolName: "read", isError: false, content: "Original result" }] };
  const continuation = createKiroNativeRequest(model.id, tools, auth, sessionId, identity).payload;
  const next = createKiroNativeRequest(model.id, context, auth, sessionId, { continuationId: nextId }).payload;
  assert.equal(metadata(initial)[key], firstId); assert.equal(metadata(continuation)[key], firstId); assert.equal(metadata(next)[key], nextId);
  assert.equal(metadata(initial)["kiro:conversation_id"], metadata(next)["kiro:conversation_id"]);
  assert.notEqual(metadata(initial)["kiro:conversation_id"], firstId);
  assert.equal(JSON.stringify(context), before);
  const plain = createKiroNativeRequest(model.id, context, auth, sessionId).payload;
  assert.deepEqual(initial, { ...plain, metadata: { ...metadata(plain), [key]: firstId } });
  assert.match(JSON.stringify(continuation), /Original result/);
  assert.match(JSON.stringify(continuation), /Full caller security policy/);
  assert.match(JSON.stringify(continuation), /call-fixture/);
});

test("missing identity stays omitted and legacy AWS requests remain unchanged", () => {
  assert.equal(metadata(createKiroNativeRequest(model.id, context, auth, sessionId).payload)[key], undefined);
  const plain = createKiroNativeRequest("claude-sonnet", context, auth, sessionId).payload;
  assert.deepEqual(createKiroNativeRequest("claude-sonnet", context, auth, sessionId, { continuationId: firstId }).payload, plain);
});

test("invalid caller or hook identities fail locally, without echoing values", () => {
  for (const value of [null, "", "not-a-uuid-secret", firstId + "\n", 12, {}, "8420ed5f-25e6-1a8c-881a-cf56ae36ef80"]) {
    assert.throws(() => validateKiroContinuationId(value), error => error instanceof Error && !error.message.includes("not-a-uuid-secret"));
    const { payload } = createKiroNativeRequest(model.id, context, auth, sessionId);
    assert.throws(() => prepareKiroNativeRequest(model.id, auth, { ...payload, metadata: { ...metadata(payload), [key]: value } }));
  }
  assert.equal(validateKiroContinuationId(firstId), firstId);
  assert.equal(validateKiroContinuationId(undefined), undefined);
});
