// Actual production compression worker; only auth and HTTP are synthetic.
import assert from "node:assert/strict";
import { Socket } from "node:net";
import { join } from "node:path";
import { kiroFrame, kiroResponse } from "./kiro-eventstream.js";

Socket.prototype.connect = function () { throw Error("Socket forbidden in isolated Kiro compression fixture"); } as typeof Socket.prototype.connect;
const variant = process.env.AXIOM_FIXTURE_USAGE_CASE;
let requests = 0, successful = 0;
const fetcher: typeof fetch = async (input, init) => {
  assert.equal(String(input), "https://runtime.us-east-1.kiro.dev/");
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer FIXTURE-ACCESS");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.conversationState.currentMessage.userInputMessage.modelId, "compression-fixture");
  requests++;
  process.send?.({ type: "fixture_request", count: requests });
  if (variant === "cancel") return new Promise<Response>(() => {});
  if (variant === "auth") return new Response("fixture unauthorized", { status: 401 });
  if (variant === "retry" && requests === 1) return new Response("fixture unavailable", { status: 503 });
  successful++;
  const tokens = variant === "zero" || variant === "aborted-result" ? { uncachedInputTokens: 0, outputTokens: 0,
    cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 0 }
    : { uncachedInputTokens: successful === 1 ? 100 : 101, outputTokens: 2,
      cacheReadInputTokens: 3, cacheWriteInputTokens: 4, totalTokens: successful === 1 ? 109 : 110 };
  return kiroResponse([
    kiroFrame("assistantResponseEvent", { content: `OWNED_SUMMARY_${successful}` }),
    ...(variant === "missing" ? [] : [kiroFrame("metadataEvent", { tokenUsage: tokens })]),
    ...(variant === "partial" && successful === 1 ? [kiroFrame("metadataEvent", { tokenUsage: {} })] : []),
  ]);
};
Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => fetcher, set() {} });
const { InMemoryCredentialStore, InMemoryModelsStore } = await import("@earendil-works/pi-ai");
const { ModelService } = await import("../../src/server/model-service.js");
const { createModelRuntime } = await import("../../src/server/model-runtime.js");
const { kiroCatalogScope } = await import("../../src/server/providers/kiro-catalog.js");
ModelService.prototype.runtime = async function (this: InstanceType<typeof ModelService>, path = join(this.dir, "models.json")) {
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  const credential = { type: "oauth" as const, access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH",
    expires: Date.now() + 3_600_000, authMethod: "builder-id" as const, authRegion: "us-east-1" };
  await credentials.modify("kiro", async () => credential);
  const cached = { checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential), models: [] };
  await modelsStore.write("kiro", cached);
  const runtime = await createModelRuntime({ providerIds: ["kiro"], modelsPath: path, credentials, modelsStore, refreshOnCreate: false });
  if (variant === "aborted-result") {
    // Synthetic provider result, not a claimed Kiro wire terminal: exercise the
    // SDK gap where stopReason=aborted is returned without an aborted signal.
    const native = runtime.getRegisteredNativeProvider("kiro")!, stream = native.streamSimple.bind(native);
    native.streamSimple = (...args) => {
      const output = stream(...args), original = output.result.bind(output);
      let result: ReturnType<typeof original> | undefined;
      output.result = () => result ??= original().then(message => {
        assert.equal(args[2]?.signal?.aborted, false);
        message.stopReason = "aborted"; message.errorMessage = "Owned synthetic provider cancellation"; return message;
      });
      return output;
    };
  }
  return runtime;
};
await import("../../src/server/compression-worker.js");
export {};
