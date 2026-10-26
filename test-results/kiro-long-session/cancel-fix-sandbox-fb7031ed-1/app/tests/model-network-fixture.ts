import assert from "node:assert/strict";
import type { modelNetwork } from "../src/server/model-network.js";
import type { ModelService } from "../src/server/model-service.js";

// Unit fixtures register provider callbacks in this process. Real IPC coverage
// lives in model-network.test.ts; production always uses the default transport.
export function fixtureLoginNetwork(service: ModelService): typeof modelNetwork {
  return async (...[, , provider, , op, payload = {}, callbacks = {}]) => {
    assert.equal(op, "login");
    const runtime = await service.runtime();
    return runtime.login(provider, payload.type as "api_key" | "oauth", {
      signal: callbacks.signal,
      notify: callbacks.notify ?? (() => {}),
      prompt: callbacks.prompt ?? (async () => { throw Error("Missing fixture prompt"); }),
    }) as any;
  };
}
