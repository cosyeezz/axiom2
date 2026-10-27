// Offline wrapper: production worker/SDK/native provider, synthetic in-memory auth.
import assert from "node:assert/strict";
import { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { kiroFrame, kiroResponse } from "./kiro-eventstream.js";

Socket.prototype.connect = function () { throw Error("Socket forbidden in isolated Kiro worker fixture"); } as typeof Socket.prototype.connect;
let requests = 0;
const fetcher: typeof fetch = async (input, init) => {
  assert.equal(String(input), "https://runtime.us-east-1.kiro.dev/");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.conversationState.currentMessage.userInputMessage.modelId, "cache-worker-fixture");
  requests++;
  if (process.connected) process.send?.({ type: "fixture_request", count: requests });
  return kiroResponse([
    kiroFrame("assistantResponseEvent", { content: "ISOLATED_WORKER_REPLY" }),
    kiroFrame("metadataEvent", { tokenUsage: { uncachedInputTokens: 100_000, outputTokens: 1,
      cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 100_001 } }),
  ]);
};
// configureModelNetwork/undici.install cannot replace this all-intercepting mock.
Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => fetcher, set() {} });

const { InMemoryCredentialStore, InMemoryModelsStore } = await import("@earendil-works/pi-ai");
const { ModelService } = await import("../../src/server/model-service.js");
const { createModelRuntime } = await import("../../src/server/model-runtime.js");
const { kiroCatalogScope } = await import("../../src/server/providers/kiro-catalog.js");

// Test-only public seam; no disk auth, login, credential extraction, or SDK patch.
ModelService.prototype.runtime = async function (this: InstanceType<typeof ModelService>, path = join(this.dir, "models.json")) {
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  const credential = { type: "oauth" as const, access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH",
    expires: Date.now() + 3_600_000, authMethod: "builder-id" as const, authRegion: "us-east-1" };
  await credentials.modify("kiro", async () => credential);
  const cached = { checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential), models: [] };
  await modelsStore.write("kiro", cached);
  return createModelRuntime({ providerIds: ["kiro"], modelsPath: path, credentials, modelsStore, refreshOnCreate: false });
};
assert.ok(process.env.AXIOM_FIXTURE_WORKER_ENTRY);
await import(pathToFileURL(process.env.AXIOM_FIXTURE_WORKER_ENTRY).href);
export {};
