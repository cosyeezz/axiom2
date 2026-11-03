import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeContext, type Model } from "@earendil-works/pi-ai";
import { kiroChatRequest } from "../src/server/providers/kiro-chat-protocol.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";

const model: Model<"kiro-chat"> = { id: "fixture", name: "Fixture", api: "kiro-chat", provider: "kiro", baseUrl: "https://q.us-east-1.amazonaws.com", reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const account: KiroCredential = { type: "oauth", access: "FIXTURE", refresh: "FIXTURE", expires: 2e12, authMethod: "builder-id", authRegion: "us-east-1" };
const context = normalizeContext({ messages: [{ role: "user", content: "fixture", timestamp: 1 }] });
const id = (sessionId?: string) => kiroChatRequest(model, context, account, sessionId).payload.conversationState.conversationId;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("Kiro session-derived conversation IDs have RFC UUID version and variant bits", () => {
  // Both real diagnostic scopes formerly generated non-RFC variants (0 and 2).
  for (const session of ["48c70fd3-2bb8-4c73-8c86-2bdd2b6038a1", "2b4ec727-41ed-47f2-b5ce-cea20533b174", "stable", "你好", ...Array.from({ length: 256 }, (_, i) => `fixture-${i}`)]) {
    assert.match(id(session), uuid, session);
    assert.equal(id(session), id(session));
  }
});

test("Kiro stable IDs match independent Python uuid5 URL-namespace golden vectors", () => {
  // Independently generated with uuid.uuid5(uuid.NAMESPACE_URL, domain + session).
  assert.equal(id("48c70fd3-2bb8-4c73-8c86-2bdd2b6038a1"), "9ec2287f-378f-553d-9425-487c18177d60");
  assert.equal(id("2b4ec727-41ed-47f2-b5ce-cea20533b174"), "5f18c942-a05f-5db5-b87a-ebeb866b05bc");
  assert.equal(id("stable"), "3ca408db-e96b-566e-9bc7-a03a85f968a0");
  assert.equal(id("你好"), "d3cf826d-0638-5e75-9285-a4230df2be39");
});

test("Kiro unrelated sessions remain isolated and absent session IDs use fresh UUIDv4", () => {
  const ids = Array.from({ length: 256 }, (_, i) => id(`fixture-${i}`));
  assert.equal(new Set(ids).size, ids.length);
  const first = id(), second = id();
  assert.match(first, uuid); assert.match(second, uuid);
  assert.equal(first[14], "4"); assert.notEqual(first, second);
});
