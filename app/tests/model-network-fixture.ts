import assert from "node:assert/strict";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { privateJson } from "../src/server/model-account-storage.js";
import { createModelRuntime } from "../src/server/model-runtime.js";
import type { modelNetwork } from "../src/server/model-network.js";
import type { ModelService } from "../src/server/model-service.js";

// Unit fixtures register provider callbacks in this process. Real IPC coverage
// lives in model-network.test.ts; production always uses the default transport.
export function fixtureLoginNetwork(service: ModelService): typeof modelNetwork {
  return async (...[, dir, provider, , op, payload = {}, callbacks = {}]) => {
    assert.equal(op, "login");
    const source = await service.runtime();
    const runtime = await createModelRuntime({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json"), modelsStorePath: join(dir, "models-store.json"), allowModelNetwork: false });
    const definition = source.getRegisteredNativeProvider(provider);
    if (definition) runtime.registerNativeProvider(definition);
    await runtime.refresh({ allowNetwork: false });
    return runtime.login(provider, payload.type as "api_key" | "oauth", {
      signal: callbacks.signal,
      notify: callbacks.notify ?? (() => {}),
      prompt: callbacks.prompt ?? (async () => { throw Error("Missing fixture prompt"); }),
    }) as any;
  };
}

/** Local setup for configuration tests; login interaction tests use fixtureLoginNetwork. */
export async function fixtureAccount(service: ModelService, provider: string, credential: Credential) {
  const accounts = new ModelAccountService(service);
  const staged = accounts.prepare(provider, { label: "Fixture account" });
  await accounts.configure(staged);
  privateJson(join(staged.dir, "auth.json"), { [provider]: credential });
  await accounts.commit(staged, credential.type, true);
  return { accounts, staged, authPath: join(staged.dir, "auth.json") };
}
