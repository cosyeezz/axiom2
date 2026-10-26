import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelService } from "../src/server/model-service.js";
import { configuration } from "../src/server/models.js";

test("OAuth imports credentials in default storage and saves mixed native model protocols without endpoint or key fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-oauth-config-"));
  const previous = process.env.AXIOM_PI_DIR;
  delete process.env.AXIOM_PI_DIR;
  try {
    const service = new ModelService(root);
    const createRuntime = service.runtime.bind(service);
    const native = (await createRuntime()).getProvider("github-copilot")!;
    service.runtime = async (path) => {
      const runtime = await createRuntime(path);
      runtime.registerNativeProvider({ ...native, auth: { ...native.auth, oauth: {
        name: "OAuth fixture",
        async login() { return { type: "oauth", access: "TEST-ACCESS", refresh: "TEST-REFRESH", expires: Date.now() + 3600000 }; },
        async refresh(credential) { return credential; },
        async toAuth(credential) { return { apiKey: credential.access }; },
      } } });
      return runtime;
    };
    const runtime = await service.runtime();
    await runtime.login(native.id, "oauth", { signal: AbortSignal.timeout(5000), notify() {}, async prompt() { throw Error("not needed"); } });
    const draft = await service.read();
    const provider = draft.providers.find((p) => p.providerId === native.id)!;
    assert.equal(provider.connectionType, "oauth");
    assert.equal(provider.hasConnectionOverrides, false);
    const nativeModels = [...new Map(runtime.getModels(native.id).map((model) => [model.api, model])).values()];
    assert.ok(nativeModels.length > 1, "Copilot exposes several native protocols");
    const { levelsOf } = await import("../src/server/models/draft.js");
    provider.models = nativeModels.map((m) => ({ key: m.id, id: m.id, name: m.name, levels: levelsOf(m), headers: [], body: [] }));
    provider.api = "";
    provider.url = "";
    await service.save(draft);
    const onDisk = JSON.parse(readFileSync(join(service.dir, "models.json"), "utf8")).providers[native.id];
    for (const key of ["api", "baseUrl", "apiKey", "connectionType"])
      assert.equal(onDisk[key], undefined, `OAuth must not write ${key}`);
    assert.equal(Object.keys(onDisk.modelOverrides).length, nativeModels.length);
    const saved = await service.read();
    assert.equal(saved.providers[0].connectionType, "oauth");
    const restored = await service.runtime();
    for (const model of nativeModels) {
      const actual = restored.getModel(native.id, model.id)!;
      assert.equal(actual.api, model.api);
      assert.deepEqual(actual.cost, model.cost);
      assert.equal(actual.contextWindow, model.contextWindow);
    }
    // The default app directory must expose logged-in native providers to the session picker too.
    const available = await configuration(root);
    assert.equal(available.error, undefined);
    for (const model of nativeModels) assert.ok(available.available.some((m) => m.provider === native.id && m.id === model.id));
    saved.providers[0].key = "SHOULD-NOT-BE-ACCEPTED";
    await assert.rejects(service.save(saved), { code: "INVALID_CONFIG" });

    const authPath = join(service.dir, "auth.json");
    const credentials = readFileSync(authPath, "utf8");
    const shrink = await service.read();
    shrink.providers[0].models = shrink.providers[0].models.slice(0, 1);
    assert.deepEqual((await service.save(shrink)).loggedOut, []);
    assert.equal(readFileSync(authPath, "utf8"), credentials);

    const rename = await service.read();
    rename.providers[0].models[0].id = "renamed-oauth-model";
    assert.deepEqual((await service.save(rename)).loggedOut, []);
    assert.equal(readFileSync(authPath, "utf8"), credentials);
    assert.equal((await service.read()).providers[0].auth?.configured, true);

    const removeLast = await service.read();
    removeLast.providers[0].models = [];
    assert.deepEqual((await service.save(removeLast)).loggedOut, []);
    assert.equal(readFileSync(authPath, "utf8"), credentials);
    const empty = await service.read();
    assert.equal(empty.providers[0].connectionType, "oauth");
    assert.equal(empty.providers[0].auth?.configured, true);
    assert.deepEqual(empty.providers[0].models, []);

    // Re-adding a model must not require another login.
    empty.providers[0].models = [provider.models[0]];
    await service.save(empty);
    const logout = await service.read();
    logout.providers[0].clearKey = true;
    await assert.rejects(service.save(logout), { code: "LOGOUT_CONFIRMATION_REQUIRED" });
    assert.equal(readFileSync(authPath, "utf8"), credentials);
    const modelConfig = JSON.parse(readFileSync(join(service.dir, "models.json"), "utf8")).providers[native.id];
    assert.deepEqual((await service.save({ ...logout, confirmLogout: true })).loggedOut, [native.id]);
    assert.equal(JSON.parse(readFileSync(authPath, "utf8"))[native.id], undefined);
    const loggedOut = await service.read();
    assert.equal(loggedOut.providers[0].connectionType, "oauth");
    assert.equal(loggedOut.providers[0].auth?.configured, false);
    const afterLogout = JSON.parse(readFileSync(join(service.dir, "models.json"), "utf8")).providers[native.id];
    assert.deepEqual(afterLogout.models, modelConfig.models);
    assert.deepEqual(afterLogout.modelOverrides, modelConfig.modelOverrides);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
