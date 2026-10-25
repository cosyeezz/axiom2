import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModelService } from "../src/server/model-service.js";
import { ExecutionProfiles } from "../src/server/execution-profile.js";
import { modelNetwork, closeModelNetworks } from "../src/server/model-network.js";

const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-auth-preparation-")), pi = join(root, "pi"), cwd = join(root, "project");
  mkdirSync(pi); mkdirSync(cwd);
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  const raw = JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture" }] } } });
  const modelsPath = join(pi, "models.json"), authPath = join(pi, "auth.json");
  writeFileSync(modelsPath, raw);
  const credential = (value: unknown) => writeFileSync(authPath, JSON.stringify({ fixture: value }));
  return { root, pi, cwd, raw, modelsPath, authPath, credential, close() {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  } };
}

test("public Pi getAuth completes OAuth persistence before a fresh execution snapshot; later identity changes still reject", async t => {
  const f = fixture(); t.after(() => f.close());
  let fetches = 0, refreshes = 0, inference = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches++; throw Error("No network in this test"); });
  f.credential({ type: "oauth", access: "fake-old", refresh: "fake-refresh", expires: Date.now() + 60_000 });
  const runtime = await ModelRuntime.create({ authPath: f.authPath, modelsPath: f.modelsPath, modelsStorePath: join(f.pi, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false });
  const model = runtime.getModel("fixture", "fixture")!;
  assert.ok(model);
  runtime.registerNativeProvider({ id: "fixture", name: "Offline OAuth fixture", getModels: () => [model],
    auth: { oauth: {
      async login() { throw Error("No login"); },
      async refresh() { refreshes++; return { type: "oauth", access: "fake-new", refresh: "fake-next", expires: Date.now() + 3_600_000 }; },
      async toAuth(value: any) { return { apiKey: value.access }; },
    } }, stream() { inference++; throw Error("No inference"); }, streamSimple() { inference++; throw Error("No inference"); },
  } as any);
  const service = new ModelService(f.root, null);
  service.runtime = async () => runtime;
  const profiles = new ExecutionProfiles(f.root), input = { entry: "agent" as const, cwd: f.cwd, modelDir: f.pi, modelsRaw: f.raw, mode: "managed" as const, selection };
  const stale = profiles.prepare(input);
  const fresh: ReturnType<ExecutionProfiles["prepare"]>[] = [];
  try {
    await runtime.checkAuth("fixture");
    assert.equal(refreshes, 0, "checkAuth stays a read-only availability check");
    await service.prepareAuth(selection, f.modelsPath, new AbortController().signal);
    assert.equal(refreshes, 1);
    assert.equal(JSON.parse(readFileSync(f.authPath, "utf8")).fixture.access, "fake-new");
    assert.equal(stale.current(false), false);
    fresh.push(await profiles.prepareAsync(input));
    assert.equal(await fresh[0].currentAsync!(), true);
    await service.prepareAuth(selection, f.modelsPath, new AbortController().signal);
    assert.equal(refreshes, 1, "fresh credentials do not start another refresh");
    for (const identity of [{ type: "oauth", access: "other-account", refresh: "other-refresh", expires: Date.now() + 3_600_000 }, { type: "api_key", key: "manual-key" }, undefined]) {
      if (identity) f.credential(identity); else writeFileSync(f.authPath, "{}");
      const rejected: any[] = [];
      assert.equal(fresh[0].current(false, value => rejected.push(value)), false);
      assert.deepEqual(rejected, [{ check: "auth" }]);
    }
    assert.equal(fetches, 0); assert.equal(inference, 0);
  } finally { stale.release(); for (const environment of fresh) environment.release(); }
});

test("auth preparation uses the provider-network operation, contains credentials, and honors missing auth/cancellation", async t => {
  const f = fixture(); t.after(() => f.close());
  const calls: any[] = [];
  let ready = true;
  const network = (async (...args: any[]) => { calls.push(args); return ready; }) as typeof modelNetwork;
  const service = new ModelService(f.root, network), controller = new AbortController();
  f.credential({ type: "api_key", key: "PRIVATE_KEY" });
  await service.prepareAuth(selection, f.modelsPath, controller.signal);
  assert.equal(calls.length, 0);
  f.credential({ type: "oauth", access: "PRIVATE_TOKEN", refresh: "PRIVATE_REFRESH", expires: Date.now() + 60_000 });
  await service.prepareAuth(selection, f.modelsPath, controller.signal);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 6), [f.root, f.pi, "fixture", f.modelsPath, "prepareAuth", { modelId: "fixture" }]);
  assert.equal(calls[0][6].signal, controller.signal);
  assert.equal(JSON.stringify(calls).includes("PRIVATE"), false);
  ready = false;
  await assert.rejects(service.prepareAuth(selection, f.modelsPath, controller.signal), { code: "MODEL_UNAVAILABLE" });
  const before = calls.length;
  controller.abort();
  await assert.rejects(service.prepareAuth(selection, f.modelsPath, controller.signal), { name: "AbortError" });
  assert.equal(calls.length, before);
});

test("real model-network auth preparation returns a boolean only and makes no inference request", { timeout: 15_000 }, async t => {
  const f = fixture();
  t.after(async () => { await closeModelNetworks(f.root); f.close(); });
  f.credential({ type: "api_key", key: "PRIVATE_KEY_NEVER_RETURNED" });
  assert.equal(await modelNetwork(f.root, f.pi, "fixture", f.modelsPath, "prepareAuth", { modelId: "fixture" }), true);
  writeFileSync(f.authPath, "{}");
  assert.equal(await modelNetwork(f.root, f.pi, "fixture", f.modelsPath, "prepareAuth", { modelId: "fixture" }), false);
});
