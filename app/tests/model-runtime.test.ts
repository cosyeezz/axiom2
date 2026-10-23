import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createModelRuntime, ensureModelProvider, nativeProviderTemplates } from "../src/server/model-runtime.js";
import { ModelService } from "../src/server/model-service.js";
import { ExecutionProfiles } from "../src/server/execution-profile.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-runtime-init-")), cwd = join(root, "project"), modelDir = join(root, "pi");
  mkdirSync(cwd); mkdirSync(modelDir);
  const modelsPath = join(modelDir, "models.json"), authPath = join(modelDir, "auth.json"), modelsStorePath = join(modelDir, "models-store.json");
  const raw = JSON.stringify({ providers: { "codebuddy-cn": { modelOverrides: { "glm-5.2": { name: "Snapshot model", contextWindow: 64000 } } } } });
  writeFileSync(modelsPath, raw); writeFileSync(authPath, "{}");
  return { root, cwd, modelDir, raw, options: { providerIds: ["codebuddy-cn"], modelsPath, authPath, modelsStorePath, allowModelNetwork: false, signal: AbortSignal.timeout(10000) } };
}

test("unused native providers remain unregistered while their add-provider templates stay visible", async t => {
  const f = fixture();
  writeFileSync(f.options.modelsPath, '{"providers":{}}');
  t.mock.method(ModelRuntime.prototype, "registerNativeProvider", () => assert.fail("unused native provider was registered"));
  try {
    const runtime = await createModelRuntime({ ...f.options, providerIds: [], refreshOnCreate: false });
    assert.equal(runtime.getRegisteredNativeProvider("codebuddy-cn"), undefined);
    assert.equal(runtime.getModel("codebuddy-cn", "glm-5.2"), undefined);
    assert.equal(existsSync(f.options.modelsStorePath), false);
    assert.equal(readFileSync(f.options.authPath, "utf8"), "{}");
    const template = nativeProviderTemplates().find(p => p.id === "codebuddy-cn")!;
    assert.equal(template.name, "CodeBuddy 国内版");
    assert.deepEqual(template.methods, ["api_key", "oauth"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("an unrelated configured provider does not initialize CodeBuddy", async t => {
  const f = fixture(), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = f.modelDir;
  writeFileSync(f.options.modelsPath, JSON.stringify({ providers: { fixture: {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture" }],
  } } }));
  t.mock.method(ModelRuntime.prototype, "registerNativeProvider", () => assert.fail("unrelated provider initialization"));
  try {
    const runtime = await new ModelService(f.root).runtime();
    assert.equal(runtime.getError(), undefined);
    assert.ok(runtime.getModel("fixture", "fixture"));
    assert.equal(runtime.getRegisteredNativeProvider("codebuddy-cn"), undefined);
    assert.equal(existsSync(f.options.modelsStorePath), false);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("credential-only native providers restore their catalog without a background refresh", async () => {
  const f = fixture();
  writeFileSync(f.options.modelsPath, '{"providers":{}}');
  const auth = JSON.stringify({ "codebuddy-cn": { type: "oauth", access: "FIXTURE", refresh: "FIXTURE", expires: Date.now() + 3600000 } });
  writeFileSync(f.options.authPath, auth);
  try {
    const runtime = await createModelRuntime({ ...f.options, providerIds: [], refreshOnCreate: false });
    assert.equal(runtime.getModels("codebuddy-cn").length, 11);
    assert.ok(runtime.getProvider("codebuddy-cn")?.auth.oauth?.login);
    assert.equal(existsSync(f.options.modelsStorePath), false);
    assert.equal(readFileSync(f.options.authPath, "utf8"), auth);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("first explicit native-provider use loads it once without changing model files", async t => {
  const f = fixture();
  writeFileSync(f.options.modelsPath, '{"providers":{}}');
  const registration = t.mock.method(ModelRuntime.prototype, "registerNativeProvider");
  try {
    const runtime = await createModelRuntime({ ...f.options, providerIds: [], refreshOnCreate: false });
    assert.equal(registration.mock.callCount(), 0);
    await Promise.all([ensureModelProvider(runtime, "codebuddy-cn"), ensureModelProvider(runtime, "codebuddy-cn")]);
    assert.equal(registration.mock.callCount(), 1);
    assert.ok(runtime.getProvider("codebuddy-cn")?.auth.oauth?.login);
    assert.equal(existsSync(f.options.modelsStorePath), false);
    assert.equal(readFileSync(f.options.modelsPath, "utf8"), '{"providers":{}}');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("runtime creation without refresh preserves a cold execution profile; explicit refresh still invalidates it", async t => {
  const f = fixture(), profiles = new ExecutionProfiles(f.root);
  const environment = profiles.prepare({ entry: "memory", cwd: f.cwd, modelDir: f.modelDir, modelsRaw: f.raw, mode: "D" });
  const refresh = ModelRuntime.prototype.refresh, pending: ReturnType<ModelRuntime["refresh"]>[] = [];
  // Drain any refresh started by creation before checking disk, so this regression
  // fails deterministically even if an implicit refresh is still awaiting I/O.
  t.mock.method(ModelRuntime.prototype, "refresh", function (this: ModelRuntime, options: Parameters<ModelRuntime["refresh"]>[0]) {
    const work = refresh.call(this, options); pending.push(work); return work;
  });
  try {
    assert.equal(existsSync(f.options.modelsStorePath), false);
    const runtime = await createModelRuntime({ ...f.options, refreshOnCreate: false });
    await Promise.all(pending);
    assert.equal(existsSync(f.options.modelsStorePath), false, "registration must not create the cache in the background");
    assert.equal(readFileSync(f.options.authPath, "utf8"), "{}");
    assert.equal(readFileSync(f.options.modelsPath, "utf8"), f.raw);
    assert.equal(environment.current(), true);
    assert.equal(pending.length, 0);
    assert.equal(runtime.getModel("codebuddy-cn", "glm-5.2")?.name, "Snapshot model");
    assert.equal(runtime.getModel("codebuddy-cn", "glm-5.2")?.contextWindow, 64000);
    assert.equal(runtime.getProvider("codebuddy-cn")?.auth.oauth !== undefined, true);

    const result = await runtime.refresh({ allowNetwork: false, signal: f.options.signal });
    assert.equal(result.aborted, false);
    assert.equal(pending.length, 1, "the normal refresh method is restored");
    assert.equal(existsSync(f.options.modelsStorePath), true);
    assert.equal(environment.current(), false, "real cache changes still invalidate captured profiles");
  } finally { await Promise.allSettled(pending); environment.release(); rmSync(f.root, { recursive: true, force: true }); }
});

test("a cold dynamic native provider must not create a models store during snapshot initialization", async t => {
  const f = fixture();
  writeFileSync(f.options.modelsPath, '{"providers":{"qoder-cn":{"headers":{}}}}');
  t.mock.method(ModelRuntime.prototype, "refresh", () => assert.fail("cold dynamic runtime must not refresh"));
  try {
    const runtime = await createModelRuntime({ ...f.options, providerIds: ["qoder-cn"], refreshOnCreate: false });
    assert.ok(runtime.getRegisteredNativeProvider("qoder-cn"));
    assert.equal(runtime.getError(), undefined);
    assert.equal(existsSync(f.options.modelsStorePath), false);
    assert.equal(readFileSync(f.options.authPath, "utf8"), "{}");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const offline of ["", "1"]) test(`PI_OFFLINE=${JSON.stringify(offline)} prevents network refresh even when requested`, async t => {
  const f = fixture(), previous = process.env.PI_OFFLINE;
  let refreshes = 0;
  process.env.PI_OFFLINE = offline;
  // Intercept before invoking any refresh so a regression cannot access the network.
  t.mock.method(ModelRuntime.prototype, "refresh", async function (this: ModelRuntime, options: Parameters<ModelRuntime["refresh"]>[0]) {
    refreshes++;
    assert.ok(this.getProvider("codebuddy-cn"));
    assert.equal(options?.allowNetwork, false);
    assert.equal(options?.signal, f.options.signal, "offline refresh must not add a network timeout");
    return { aborted: false, errors: new Map() };
  });
  try {
    await createModelRuntime({ ...f.options, allowModelNetwork: true, modelRefreshTimeoutMs: 1000 });
    assert.equal(refreshes, 1);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("default runtime creation awaits one explicit local refresh with the native provider registered", async t => {
  const f = fixture(), refresh = ModelRuntime.prototype.refresh, pending: ReturnType<ModelRuntime["refresh"]>[] = [];
  t.mock.method(ModelRuntime.prototype, "refresh", function (this: ModelRuntime, options: Parameters<ModelRuntime["refresh"]>[0]) {
    assert.ok(this.getProvider("codebuddy-cn"));
    assert.equal(options?.allowNetwork, false);
    const work = refresh.call(this, options); pending.push(work); return work;
  });
  try {
    const runtime = await createModelRuntime(f.options);
    await Promise.all(pending);
    assert.equal(pending.length, 1, "registration must not race a second refresh");
    assert.equal(existsSync(f.options.modelsStorePath), true);
    assert.equal(runtime.getError(), undefined);
    assert.equal(runtime.getModel("codebuddy-cn", "glm-5.2")?.name, "Snapshot model");
  } finally { await Promise.allSettled(pending); rmSync(f.root, { recursive: true, force: true }); }
});
