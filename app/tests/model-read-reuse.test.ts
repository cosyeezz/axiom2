import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelService } from "../src/server/model-service.js";

test("configuration reads reuse metadata once per config ID without caching across reads", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-read-reuse-"));
  const service = new ModelService(root, async () => assert.fail("configuration read invoked network"), join(root, "pi"));
  try {
    await service.raw();
    const prices = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0.5 };
    const tier = { inputTokensAbove: 1000, input: 3, output: 4, cacheRead: 0, cacheWrite: 1 };
    const config = { providers: {
      "reuse-a": {
        api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
        models: [
          { id: "shared", name: "Model A", input: ["text", "image"], cost: prices },
          { id: "copy-config", axiomRequestModelId: "shared", name: "Copy A", cost: { ...prices, input: 0 } },
        ],
        modelOverrides: {
          shared: { cost: { tiers: [tier] } },
          missing: { name: "Fallback", input: ["text", "image"], cost: prices },
        },
      },
      "reuse-b": {
        api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
        models: [{ id: "shared", name: "Model B", input: ["text"], cost: { ...prices, input: 8 } }],
      },
    } };
    const path = join(service.dir, "models.json");
    writeFileSync(path, JSON.stringify(config));
    const calls: string[] = [];
    const original = service.runtime.bind(service);
    t.mock.method(service, "runtime", async (...args: Parameters<typeof service.runtime>) => {
      const runtime = await original(...args);
      const getModel = runtime.getModel.bind(runtime);
      t.mock.method(runtime, "getModel", (provider: string, id: string) => {
        calls.push(`${provider}/${id}`);
        return getModel(provider, id);
      });
      return runtime;
    });
    const first = await service.read();
    const expected = ["reuse-a/shared", "reuse-a/missing", "reuse-a/copy-config", "reuse-b/shared"];
    assert.deepEqual(calls.toSorted(), expected.toSorted(), "one lookup per configuration ID, including copies and missing metadata");
    const nativeTemplate = first.templates.find(template => template.id === "kiro")!;
    assert.deepEqual(nativeTemplate.methods, ["oauth"]);
    nativeTemplate.name = "Changed by consumer";
    nativeTemplate.methods!.push("api_key");
    const [a, b] = first.providers;
    const modelA = a.models.find(model => model.key === "shared")!;
    const copy = a.models.find(model => model.key === "copy-config")!;
    const fallback = a.models.find(model => model.key === "missing")!;
    assert.deepEqual(a.models.map(model => model.name).toSorted(), ["Copy A", "Fallback", "Model A"]);
    assert.deepEqual(modelA.input, ["text", "image"]);
    assert.deepEqual(modelA.cost, prices);
    assert.equal(modelA.costTiered, true);
    assert.deepEqual(modelA.levels, ["none"]);
    assert.equal(copy.id, "shared");
    assert.equal(copy.configId, "copy-config");
    assert.equal(copy.cost!.input, 0, "explicit zero price is not replaced by a fallback");
    assert.deepEqual(fallback.input, ["text", "image"]);
    assert.deepEqual(fallback.cost, prices, "unknown runtime model retains editable metadata");
    assert.equal(fallback.costTiered, false);
    assert.equal(b.models[0].name, "Model B");
    assert.equal(b.models[0].cost!.input, 8, "same ID on another provider stays independent");
    modelA.input!.push("text");
    modelA.cost!.input = 99;
    assert.equal(copy.cost!.input, 0);
    assert.deepEqual(b.models[0].input, ["text"]);
    calls.length = 0;
    config.providers["reuse-a"].models[0].name = "Updated A";
    config.providers["reuse-a"].models[0].cost.input = 5;
    writeFileSync(path, JSON.stringify(config));
    const second = await service.read();
    assert.deepEqual(calls.toSorted(), expected.toSorted(), "every read resolves current metadata anew");
    const freshNativeTemplate = second.templates.find(template => template.id === "kiro")!;
    assert.equal(freshNativeTemplate.name, "kiro");
    assert.deepEqual(freshNativeTemplate.methods, ["oauth"], "native templates remain isolated without a redundant second clone");
    assert.notStrictEqual(freshNativeTemplate, nativeTemplate);
    assert.notStrictEqual(freshNativeTemplate.methods, nativeTemplate.methods);
    const updated = second.providers[0].models.find(model => model.key === "shared")!;
    assert.equal(updated.name, "Updated A");
    assert.equal(updated.cost!.input, 5);
    assert.deepEqual(updated.input, ["text", "image"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
