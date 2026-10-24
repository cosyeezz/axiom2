import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ModelService } from "../src/server/model-service.js";
import { prepareDraft, levelsOf } from "../src/server/models/draft.js";
import { assignModelConfigIds, type ModelDraft, type ProviderDraft } from "../src/shared/models.js";

const row = (id: string, tier: string): ModelDraft => ({ key: crypto.randomUUID(), id, name: tier,
  levels: ["none"], headers: [{ id: "h", key: "X-Variant", value: tier }],
  body: [{ id: "tier", key: "service_tier", value: tier, valueType: "string" }], bodyVersion: 2 });

async function fixture(run: (service: ModelService, path: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-variants-")), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try { const service = new ModelService(root, null); await run(service, join(service.dir, "models.json")); }
  finally { if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); }
}

test("duplicate upstream IDs preserve saved identities regardless of row order", () => {
  const saved = { ...row("upstream", "default"), originalId: "upstream" };
  const fresh = row("upstream", "fast");
  const assigned = assignModelConfigIds([fresh, saved, row("upstream", "ultrafast")]);
  assert.equal(assigned[1].configId, undefined);
  assert.equal(assigned[1].originalId, "upstream");
  assert.equal(new Set(assigned.map(m => m.configId ?? m.id)).size, 3);
  assert.deepEqual(assignModelConfigIds(assigned), assigned, "normalization is stable across staging/save retries");
  assert.equal(fresh.configId, undefined, "editor input is not mutated");
  const explicit = { ...row("other", "copy"), configId: "upstream" };
  for (const inputs of [[fresh, explicit], [explicit, fresh]]) {
    const result = assignModelConfigIds(inputs);
    assert.equal(result.find(m => m.id === "other")!.configId, "upstream");
    assert.notEqual(result.find(m => m.id === "upstream")!.configId, "upstream");
    assert.equal(new Set(result.map(m => m.configId ?? m.id)).size, 2);
  }
});

test("manual same-ID configurations save, reload, and send independent parameters and headers", async () => fixture(async (service, path) => {
  const requests: { model: unknown; tier: unknown; header: unknown }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ model: body.model, tier: body.service_tier, header: req.headers["x-variant"] });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "variant", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\ndata: [DONE]\n\n`);
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let draft = await service.read();
    const native = (await service.runtime()).getModels("openai").find(m => m.api === "openai-responses")!;
    const p: ProviderDraft = { id: "openai", providerId: "openai", name: "Variants", api: "openai-responses", url: endpoint + "/v1", key: "TEST-ONLY", headers: [], body: [],
      models: [row(native.id, "default"), row(native.id, "fast"), row(native.id, "ultrafast")].map(m => ({ ...m, levels: levelsOf(native) })) };
    draft.providers = [p];
    await service.save(draft);
    const disk = () => JSON.parse(readFileSync(path, "utf8")).providers.openai;
    const ids = (await service.read()).providers[0].models.map(m => m.configId ?? m.id);
    assert.equal(new Set(ids).size, 3);
    draft = await service.read();
    assert.deepEqual(draft.providers[0].models.map(m => m.id), [native.id, native.id, native.id]);
    draft.providers[0].models.reverse();
    draft.providers[0].models.find(m => m.name === "fast")!.name = "Fast renamed";
    await service.save(draft);
    assert.deepEqual(new Set((await service.read()).providers[0].models.map(m => m.configId ?? m.id)), new Set(ids));
    assert.ok(disk().models.every((m: { baseUrl?: string }) => m.baseUrl === undefined), "derived custom variants inherit the selected provider endpoint");
    const runtime = await service.runtime();
    for (const identity of ids) {
      const model = runtime.getModel("openai", identity)!;
      assert.equal(model.baseUrl, endpoint + "/v1");
      const tier = model.samplingParams!.service_tier;
      const result = await runtime.completeSimple(model, { messages: [{ role: "user", content: "local mock", timestamp: 1 }] }, {
        transport: "sse", maxRetries: 0, signal: AbortSignal.timeout(10000), fetch: (input, init) => {
          assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, endpoint);
          return fetch(input, init);
        },
      });
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.equal(result.model, identity);
      assert.deepEqual(requests.at(-1), { model: native.id, tier, header: tier });
    }
    // Explicit internal identity collisions still cannot merge configurations silently.
    const forged = await service.read();
    forged.providers[0].models[0].configId = ids[0];
    forged.providers[0].models[1].configId = ids[0];
    await assert.rejects(service.save(forged), /配置标识重复/);
    assert.equal(requests.length, 3);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test("OAuth aliases inherit the body target protocol and metadata; duplicate native IDs survive runtime reload", async () => fixture(async (service, path) => {
  const runtime = await service.runtime();
  const native = runtime.getModels("openai").find(m => m.api === "openai-responses")!;
  assert.ok(native, "offline native catalog contains a Responses model");
  const model = (id: string, name: string): ModelDraft => ({ ...row(id, name), headers: [], levels: levelsOf(native), input: [...native.input] });
  const alias = model("local-fast-alias", "Fast");
  alias.body.push({ id: "model", key: "model", value: native.id, valueType: "string" });
  let draft = await service.read();
  draft.providers = [{ id: "openai", providerId: "openai", name: "OpenAI", connectionType: "oauth", api: "", url: "", key: "", headers: [], body: [],
    models: [model(native.id, "default"), model(native.id, "fast"), alias] }];
  await service.save(draft);
  const stored = JSON.parse(readFileSync(path, "utf8")).providers.openai;
  assert.equal(stored.api, undefined, "provider protocol remains native and per-model");
  const savedAlias = stored.models.find((m: { id: string }) => m.id === alias.id);
  assert.equal(savedAlias.api, native.api);
  assert.equal(savedAlias.baseUrl, native.baseUrl);
  assert.equal(savedAlias.contextWindow, native.contextWindow);
  assert.equal(savedAlias.maxTokens, native.maxTokens);
  assert.deepEqual(savedAlias.input, native.input);
  assert.deepEqual(savedAlias.cost, native.cost);
  const loaded = await service.runtime();
  assert.equal(loaded.getModel("openai", alias.id)!.api, native.api);
  const copy = stored.models.find((m: { axiomRequestModelId?: string }) => m.axiomRequestModelId === native.id);
  assert.equal(loaded.getModel("openai", copy.id)!.api, native.api);
  draft = await service.read();
  const savedIds = draft.providers[0].models.map(m => m.configId ?? m.id);
  await service.save(draft);
  assert.deepEqual((await service.read()).providers[0].models.map(m => m.configId ?? m.id), savedIds);
  // A mixed-protocol target cannot silently reuse this alias's existing transport.
  const changed = await service.read();
  changed.providers[0].models.find(m => m.id === alias.id)!.body.find(r => r.key === "model")!.value = "other-protocol";
  const current = await service.runtime();
  const mixed = Object.create(current);
  mixed.getModel = (provider: string, id: string) => provider === "openai" && id === "other-protocol"
    ? { ...native, id, api: "openai-completions" } : current.getModel(provider, id);
  assert.throws(() => prepareDraft(changed, JSON.parse(readFileSync(path, "utf8")), mixed), /目标模型的接口协议与当前配置不同/);
  changed.providers[0].models.find(m => m.id === alias.id)!.body.find(r => r.key === "model")!.value = "unknown-target";
  await assert.rejects(service.save(changed), /请求体 model.*有效的原生模型 ID/);
  // Unknown targets get an actionable error, without guessing another model's transport.
  const bad = await service.read();
  bad.providers[0].models.push(model("missing-native-model", "Unknown"));
  await assert.rejects(service.save(bad), error => {
    assert.match((error as Error).message, /无法识别此模型的原生协议/);
    assert.doesNotMatch((error as Error).message, /undefined/); return true;
  });
  // Renaming an existing native override must materialize metadata as a custom definition too.
  const rename = await service.read();
  const original = rename.providers[0].models.find(m => m.originalId === native.id)!;
  original.id = "renamed-native-alias";
  const prepared = prepareDraft({ ...rename, confirmLogout: true }, JSON.parse(readFileSync(path, "utf8")), await service.runtime());
  const renamed = prepared.providers.openai.models.find((m: { id: string }) => m.id === original.id);
  assert.equal(renamed.api, native.api);
  assert.equal(renamed.baseUrl, native.baseUrl);
  assert.equal(renamed.contextWindow, native.contextWindow);
}));

test("same-ID custom endpoint variants retain their chosen protocol instead of the native protocol", async () => fixture(async (service) => {
  const runtime = await service.runtime();
  const native = runtime.getModels("openai").find(m => m.api === "openai-responses")!;
  const draft = await service.read();
  draft.providers = [{ id: "openai", providerId: "openai", name: "Custom OpenAI", api: "openai-completions", url: "http://127.0.0.1:1/v1", key: "", headers: [], body: [],
    models: [row(native.id, "fast"), row(native.id, "ultrafast")] }];
  await service.save(draft);
  const saved = await service.read(), loaded = await service.runtime();
  assert.equal(saved.providers[0].models.length, 2);
  for (const model of saved.providers[0].models) {
    const actual = loaded.getModel("openai", model.configId ?? model.id)!;
    assert.equal(actual.api, "openai-completions");
    assert.equal(actual.baseUrl, "http://127.0.0.1:1/v1");
  }
}));
