import assert from "node:assert/strict";
import { test } from "node:test";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import type { ModelsStore, ModelsStoreEntry } from "@earendil-works/pi-ai";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModelService } from "../src/server/model-service.js";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { credentialMetadata } from "../src/server/model-metadata.js";
import { fetchKiroCatalog, kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";

async function fixture(run: (service: ModelService) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-metadata-")), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root, async () => assert.fail("display invoked the network worker"));
    await service.raw();
    await run(service);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}
const definition = (apiKey?: string) => ({ api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey, models: [{ id: "fixture" }] });

// If any SDK auth/availability path regresses into the editor these fail immediately,
// rather than merely relying on the fixture having a fast network or valid token.
test("configuration display is local, lock-free and never migrates or checks credentials", async t => {
  for (const method of ["refresh", "checkAuth", "getAvailable", "getAuth", "login"] as const)
    t.mock.method(ModelRuntime.prototype, method, () => assert.fail(`display invoked ${method}`));
  await fixture(async service => {
    const marker = join(service.dir, "command-ran"), command = `!touch '${marker}'; sleep 5`;
    const models = JSON.stringify({ providers: { legacy: definition(command), stored: definition(), "codebuddy-cn": { headers: {} } } });
    const auth = JSON.stringify({ stored: { type: "api_key", key: command }, "codebuddy-cn": { type: "oauth", access: "SECRET-ACCESS", refresh: "SECRET-REFRESH", expires: 1 } });
    writeFileSync(join(service.dir, "models.json"), models);
    writeFileSync(join(service.dir, "auth.json"), auth);
    mkdirSync(join(service.dir, "auth.json.lock"));
    const start = performance.now();
    assert.equal((await service.runtime(undefined, true)).getError(), undefined);
    const view = await service.read();
    assert.ok(performance.now() - start < 1500, "display waited for a credential lock or command");
    assert.equal(view.providers.length, 3);
    for (const provider of view.providers) assert.equal(provider.auth?.configured, true);
    assert.equal(view.providers.find(item => item.providerId === "codebuddy-cn")?.auth?.type, "oauth");
    assert.doesNotMatch(JSON.stringify(view), /SECRET-ACCESS|SECRET-REFRESH|command-ran/);
    assert.equal(readFileSync(join(service.dir, "models.json"), "utf8"), models);
    assert.equal(readFileSync(join(service.dir, "auth.json"), "utf8"), auth);
    assert.equal(existsSync(join(service.dir, "models-store.json")), false);
    assert.equal(existsSync(marker), false);
  });
});

test("configuration display bypasses a pending configuration writer", async () => {
  await fixture(async service => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writer = service.serial(() => gate);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const view = await Promise.race([
        service.read(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error("display waited behind writer")), 1000); }),
      ]);
      assert.deepEqual(view.providers, []);
      assert.equal(existsSync(join(service.dir, "auth.json")), false);
      assert.equal(existsSync(join(service.dir, "models-store.json")), false);
    } finally { clearTimeout(timeout); release(); await writer; }
  });
});

test("metadata store rejects malformed auth safely and refuses writes without invoking callbacks", async () => {
  await fixture(async service => {
    const path = join(service.dir, "auth.json");
    for (const value of ['{"SECRET-TOKEN":', '[]', '{"fixture":{"type":"oauth","access":"SECRET-TOKEN"}}']) {
      writeFileSync(path, value);
      assert.throws(() => credentialMetadata(path), error => error instanceof Error && !error.message.includes("SECRET-TOKEN"));
      assert.equal(readFileSync(path, "utf8"), value);
    }
    writeFileSync(path, '{"fixture":{"type":"api_key","key":"$UNRESOLVED"}}');
    const store = credentialMetadata(path);
    assert.equal((await store.read("fixture"))?.type, "api_key");
    await assert.rejects(store.modify("fixture", async () => assert.fail("write callback ran")), /read-only/);
    await assert.rejects(store.delete("fixture"), /read-only/);
  });
});

test("broken optional dynamic catalogs cannot hide the editable configuration or rewrite the cache", async () => {
  await fixture(async service => {
    writeFileSync(join(service.dir, "models.json"), '{"providers":{"qoder-cn":{"headers":{}}}}');
    const path = join(service.dir, "models-store.json");
    for (const value of ['not json', '{"qoder-cn":{"models":null}}', '{"qoder-cn":{"models":[null]}}']) {
      writeFileSync(path, value);
      const view = await service.read();
      assert.equal(view.providers[0].providerId, "qoder-cn");
      assert.equal(readFileSync(path, "utf8"), value);
      assert.equal(existsSync(join(service.dir, "auth.json")), false);
    }
  });
});

test("display restores scoped Kiro cache and overrides without auth checks or writes", async t => {
  for (const method of ["refresh", "checkAuth", "getAvailable", "getAuth"] as const)
    t.mock.method(ModelRuntime.prototype, method, () => assert.fail(`metadata invoked ${method}`));
  await fixture(async service => {
    const credential = { type: "oauth" as const, access: "ACCESS", refresh: "REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id" as const, authRegion: "us-east-1" };
    const models = await fetchKiroCatalog(credential, new AbortController().signal, async () => new Response(JSON.stringify({ models: [{ modelId: "upstream", tokenLimits: { maxInputTokens: 1000, maxOutputTokens: 100 } }], defaultModel: { modelId: "upstream" } })));
    const cache = JSON.stringify({ kiro: { models, checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential) } });
    const modelsPath = join(service.dir, "models.json"), authPath = join(service.dir, "auth.json"), modelsStorePath = join(service.dir, "models-store.json");
    writeFileSync(modelsPath, JSON.stringify({ providers: { kiro: { modelOverrides: { upstream: { name: "My cached model" } } } } }));
    writeFileSync(authPath, JSON.stringify({ kiro: credential })); writeFileSync(modelsStorePath, cache);
    const runtime = await createModelRuntime({ providerIds: ["kiro"], modelsPath, authPath, modelsStorePath, metadataOnly: true });
    assert.equal(runtime.getModel("kiro", "upstream")?.name, "My cached model");
    const view = await service.read();
    assert.equal(view.providers[0].models.find(model => model.id === "upstream")?.name, "My cached model");
    assert.ok(view.providers[0].notices?.some(notice => notice.includes("已恢复同账号目录缓存")));
    writeFileSync(authPath, JSON.stringify({ kiro: { ...credential, refresh: "OTHER-ACCOUNT" } }));
    const other = await service.read();
    const otherRuntime = await createModelRuntime({ providerIds: ["kiro"], modelsPath, authPath, modelsStorePath, metadataOnly: true });
    assert.equal(otherRuntime.getModel("kiro", "upstream"), undefined, "another account must not restore the cached catalog");
    // Explicit models.json rows stay editable even when their native metadata is unavailable.
    assert.equal(other.providers[0].models[0].name, "My cached model");
    assert.ok(other.providers[0].notices?.some(notice => notice.includes("不匹配")));
    assert.equal(readFileSync(modelsStorePath, "utf8"), cache);
  });
});

test("metadata loads the file catalog only for dynamic consumers and shares one snapshot", async t => {
  await fixture(async service => {
    const modelsPath = join(service.dir, "models.json"), authPath = join(service.dir, "auth.json");
    const cachePath = join(service.dir, "models-store.json");
    const ids = ["fixture-cache-a", "fixture-cache-b"];
    const cacheData = (checkedAt: number): Record<string, ModelsStoreEntry> =>
      Object.fromEntries(ids.map(id => [id, { models: [], checkedAt }]));
    writeFileSync(cachePath, JSON.stringify(cacheData(1)));
    let fileReads = 0, replaceCache = false;
    const catalogFileReads = { empty: 0, static: 0, dynamic: 0, explicitStore: 0 };
    const seen: [string, number | undefined][] = [];
    const events: string[] = [], defaultSignals: AbortSignal[] = [];
    const observedSignals: (AbortSignal | undefined)[] = [], credentialSignals: (AbortSignal | undefined)[] = [];
    const storeSignals: (AbortSignal | undefined)[] = [];
    let cancelDuringRefresh: AbortController | undefined;
    let failFirst = false;
    const timeout = AbortSignal.timeout;
    t.mock.method(AbortSignal, "timeout", (ms: number) => {
      const signal = timeout.call(AbortSignal, ms);
      defaultSignals.push(signal);
      events.push("timeout");
      return signal;
    });
    const read = fs.readFileSync;
    t.mock.method(fs, "readFileSync", ((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === cachePath) fileReads++;
      const result = Reflect.apply(read, fs, args);
      if (args[0] === cachePath) events.push("file");
      return result;
    }) as typeof fs.readFileSync);
    type Native = NonNullable<ReturnType<ModelRuntime["getRegisteredNativeProvider"]>>;
    type Context = Parameters<NonNullable<Native["refreshModels"]>>[0];
    const dynamic = new Map(ids.map(id => [id, {
      id,
      async refreshModels(context: Context) {
        seen.push([id, context.stored?.checkedAt]);
        observedSignals.push(context.signal);
        if (failFirst && id === ids[0]) throw Error("optional provider failure");
        if (cancelDuringRefresh) {
          cancelDuringRefresh.abort();
          await context.publish({ update: () => assert.fail("cancelled metadata published an update") });
        }
        if (replaceCache && id === ids[0]) writeFileSync(cachePath, JSON.stringify(cacheData(2)));
      },
    } as Native]));
    const getNative = ModelRuntime.prototype.getRegisteredNativeProvider;
    t.mock.method(ModelRuntime.prototype, "getRegisteredNativeProvider", function (this: ModelRuntime, id: string) {
      return dynamic.get(id) ?? getNative.call(this, id);
    });
    syncBuiltinESMExports();
    try {
      await service.read();
      catalogFileReads.empty = fileReads;
      assert.equal(fileReads, 0, "empty configuration does not read an unused catalog");
      fileReads = 0;
      writeFileSync(modelsPath, JSON.stringify({ providers: { "cache-static": definition() } }));
      await service.read();
      catalogFileReads.static = fileReads;
      assert.equal(fileReads, 0, "static providers do not read an unused catalog");
      assert.equal(defaultSignals.length, 0, "no dynamic consumer needs a fallback timeout");
      fileReads = 0;
      replaceCache = true;
      const credentials = credentialMetadata(authPath), readCredential = credentials.read.bind(credentials);
      credentials.read = async (id, options) => {
        if (ids.includes(id)) credentialSignals.push(options?.signal);
        return readCredential(id, options);
      };
      const options = { providerIds: ids, modelsPath, authPath, modelsStorePath: cachePath, metadataOnly: true, credentials };
      const sameSignal = (expected: AbortSignal) => {
        assert.equal(observedSignals.length, 2);
        assert.equal(credentialSignals.length, 2);
        for (const signal of [...observedSignals, ...credentialSignals]) assert.strictEqual(signal, expected);
      };
      const resetSignals = () => {
        defaultSignals.length = observedSignals.length = credentialSignals.length = storeSignals.length = events.length = 0;
      };
      await createModelRuntime(options);
      catalogFileReads.dynamic = fileReads;
      assert.equal(fileReads, 1, "dynamic providers share one file read");
      assert.deepEqual(seen, ids.map(id => [id, 1]), "later providers retain the first cache snapshot despite a disk change");
      assert.deepEqual(events, ["file", "timeout"], "the default budget begins after optional file loading");
      assert.equal(defaultSignals.length, 1);
      sameSignal(defaultSignals[0]);
      resetSignals();
      fileReads = 0;
      replaceCache = false;
      seen.length = 0;
      const storeReads: string[] = [];
      const explicit = cacheData(7);
      const modelsStore: ModelsStore = {
        async read(id, options) { storeReads.push(id); storeSignals.push(options?.signal); return explicit[id]; },
        async write() { assert.fail("metadata wrote the explicit store"); },
        async delete() { assert.fail("metadata deleted from the explicit store"); },
      };
      await createModelRuntime({ ...options, modelsStore });
      catalogFileReads.explicitStore = fileReads;
      assert.equal(fileReads, 0, "explicit store does not read the unused file catalog");
      assert.deepEqual(storeReads, ids);
      assert.deepEqual(seen, ids.map(id => [id, 7]), "explicit store retains precedence over file metadata");
      assert.equal(defaultSignals.length, 1);
      sameSignal(defaultSignals[0]);
      assert.equal(storeSignals.length, 2);
      for (const signal of storeSignals) assert.strictEqual(signal, defaultSignals[0]);
      resetSignals();
      const external = new AbortController();
      await createModelRuntime({ ...options, modelsStore, signal: external.signal });
      assert.equal(defaultSignals.length, 0, "an external signal does not create a fallback timeout");
      sameSignal(external.signal);
      assert.equal(storeSignals.length, 2);
      for (const signal of storeSignals) assert.strictEqual(signal, external.signal);
      assert.equal(fileReads, 0);
      seen.length = 0;
      cancelDuringRefresh = new AbortController();
      await assert.rejects(createModelRuntime({ ...options, modelsStore, signal: cancelDuringRefresh.signal }), { name: "AbortError" });
      assert.deepEqual(seen.map(([id]) => id), [ids[0]], "cancellation escapes provider isolation");
      cancelDuringRefresh = undefined;
      failFirst = true;
      seen.length = 0;
      await createModelRuntime(options);
      assert.deepEqual(seen.map(([id]) => id), ids, "an ordinary provider failure remains isolated");
      console.log(JSON.stringify({ catalogFileReads, sharedSignal: true, externalSignal: true, cancellation: true, providerIsolation: true }));
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
});
