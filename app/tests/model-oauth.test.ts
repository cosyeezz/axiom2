import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ModelService } from "../src/server/model-service.js";
import { Logins } from "../src/server/auth.js";

test("OAuth automatic callback cancels manual prompt; device flow needs no code submission", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-oauth-callback-"));
  const previous = process.env.AXIOM_PI_DIR;
  delete process.env.AXIOM_PI_DIR;
  const service = new ModelService(root);
  const owner = {};
  let changed = 0;
  const logins = new Logins(service, () => {}, async () => { changed++; }, async () => {});
  const until = async (predicate: () => boolean) => {
    for (let n = 0; n < 100 && !predicate(); n++) await delay(10);
    assert.ok(predicate());
  };
  try {
    assert.equal((await service.read()).providers.length, 0);
    const runtime = await service.runtime();
    const native = runtime.getProvider("openai")!;
    let mode: "callback" | "device" = "callback";
    let complete!: () => void;
    runtime.registerNativeProvider({
      ...native,
      auth: { ...native.auth, oauth: {
        name: "OAuth fixture",
        async login(interaction) {
          if (mode === "callback") {
            interaction.notify({ type: "auth_url", url: "https://example.invalid/authorize" });
            const promptController = new AbortController();
            const manual = interaction.prompt({ type: "manual_code", message: "Full redirect URL", signal: promptController.signal }).catch((error) => {
              assert.equal(error.name, "AbortError");
            });
            await new Promise<void>((resolve) => { complete = resolve; });
            promptController.abort();
            await manual;
          } else {
            interaction.notify({ type: "device_code", userCode: "FIXTURE-DEVICE", verificationUri: "https://example.invalid/device" });
            await new Promise<void>((resolve) => { complete = resolve; });
          }
          return { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3600000 };
        },
        async refresh(credential) { return credential; },
        async toAuth(credential) { return { apiKey: credential.access }; },
      } },
    });
    await runtime.refresh({ allowNetwork: false });
    service.runtime = async () => runtime;
    const { revision } = await service.load();
    const first = await logins.start(owner, "openai", "oauth", revision);
    await until(() => !!logins.get(owner, first.id).state.prompt);
    const promptId = logins.get(owner, first.id).state.prompt!.id;
    complete();
    await until(() => !service.authActive);
    const done = logins.get(owner, first.id).state;
    assert.equal(done.status, "completed");
    const imported = (await service.read()).providers.find((p) => p.providerId === "openai")!;
    assert.equal(imported.connectionType, "oauth");
    assert.equal(imported.auth?.type, "oauth");
    assert.equal(imported.hasConnectionOverrides, false);
    assert.equal(await service.raw(), '{"providers":{}}', "direct login does not create a custom endpoint");
    assert.equal(done.prompt, undefined);
    assert.equal(done.url, undefined);
    assert.throws(() => logins.answer(owner, first.id, promptId, "LATE-INPUT"), { code: "AUTH_STALE_PROMPT" });
    mode = "device";
    const second = await logins.start(owner, "openai", "oauth", revision);
    await until(() => !!logins.get(owner, second.id).state.userCode);
    assert.equal(logins.get(owner, second.id).state.userCode, "FIXTURE-DEVICE");
    assert.equal(logins.get(owner, second.id).state.prompt, undefined);
    complete();
    await until(() => !service.authActive);
    assert.equal(logins.get(owner, second.id).state.status, "completed");
    assert.equal(logins.get(owner, second.id).state.userCode, undefined);
    assert.equal(changed, 2);
  } finally {
    await logins.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
