import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateCost, type Usage } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { createServer } from "node:http";
import { ModelService } from "../src/server/model-service.js";
import { usageCost } from "../src/server/usage-cost.js";
import { emptyModelPricing, type ModelPricing, type ProviderDraft } from "../src/shared/models.js";

const prices: ModelPricing = { input: 2, output: 8, cacheRead: .5, cacheWrite: 3 };
async function fixture(run: (service: ModelService, path: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-pricing-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    await run(service, join(service.dir, "models.json"));
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}
function provider(url = "http://127.0.0.1:1/v1"): ProviderDraft {
  return { id: "pricing-test", providerId: "pricing-test", name: "计费测试", api: "openai-completions", url,
    key: "", headers: [], body: [], models: [{ key: "priced", id: "priced", name: "计费模型", levels: ["none"], cost: prices, headers: [], body: [] }] };
}

test("pricing survives save/reload and legacy drafts; invalid prices never publish", () => fixture(async (service, path) => {
  await service.save({ ...await service.read(), providers: [provider()] });
  assert.deepEqual((await service.read()).providers[0].models[0].cost, prices);
  assert.deepEqual((await service.runtime()).getModel("pricing-test", "priced")!.cost, prices);
  let draft = await service.read();
  delete draft.providers[0].models[0].cost;
  await service.save(draft);
  assert.deepEqual((await service.read()).providers[0].models[0].cost, prices);
  for (const invalid of [null, [], {}, "2", { ...prices, input: -1 }, { ...prices, output: Infinity }, { ...prices, cacheRead: NaN }, { ...prices, cacheWrite: "3" }]) {
    draft = await service.read();
    draft.providers[0].models[0].cost = invalid as ModelPricing;
    const before = readFileSync(path, "utf8");
    await assert.rejects(service.save(draft), (error: any) => error.code === "INVALID_CONFIG" && /计费模型.*计费设置/.test(error.message));
    assert.equal(readFileSync(path, "utf8"), before);
  }
  draft = await service.read();
  draft.providers[0].models[0].cost = emptyModelPricing();
  await service.save(draft);
  assert.deepEqual((await service.runtime()).getModel("pricing-test", "priced")!.cost, emptyModelPricing());
}));

test("overlapping price overrides and tiers survive edits and model rename", () => fixture(async (service, path) => {
  await service.save({ ...await service.read(), providers: [provider()] });
  const config = JSON.parse(readFileSync(path, "utf8"));
  const tier = { inputTokensAbove: 1000, input: 4, output: 16, cacheRead: 1, cacheWrite: 6 };
  config.providers["pricing-test"].modelOverrides.priced = { cost: { input: 5, tiers: [tier] }, contextWindow: 123456 };
  writeFileSync(path, JSON.stringify(config));
  let draft = await service.read();
  assert.equal(draft.providers[0].models[0].cost!.input, 5);
  assert.equal(draft.providers[0].models[0].costTiered, true);
  draft.providers[0].models[0].cost!.input = 7;
  await service.save(draft);
  let actual = (await service.runtime()).getModel("pricing-test", "priced")!;
  assert.deepEqual(actual.cost, { ...prices, input: 7, tiers: [tier] });
  assert.equal(actual.contextWindow, 123456);
  const usage: Usage = { input: 1001, output: 10, cacheRead: 20, cacheWrite: 30, totalTokens: 1061, cost: { ...emptyModelPricing(), total: 0 } };
  assert.equal(calculateCost(actual, usage).input, 1001 * 4 / 1_000_000);
  draft = await service.read();
  delete draft.providers[0].models[0].cost;
  draft.providers[0].models[0].id = "renamed";
  await service.save({ ...draft, confirmLogout: true });
  actual = (await service.runtime()).getModel("pricing-test", "renamed")!;
  assert.deepEqual(actual.cost, { ...prices, input: 7, tiers: [tier] });
}));

test("native prices remain inherited until edited and are preserved on rename", () => fixture(async (service, path) => {
  const native = (await service.runtime()).getModels("openai").find(model => !model.reasoning && model.cost.input > 0)!;
  assert.ok(native);
  const p = provider(native.baseUrl);
  p.id = p.providerId = "openai";
  p.api = native.api;
  p.models[0] = { key: native.id, id: native.id, name: native.name, levels: ["none"], cost: { input: native.cost.input, output: native.cost.output, cacheRead: native.cost.cacheRead, cacheWrite: native.cost.cacheWrite }, headers: [], body: [] };
  await service.save({ ...await service.read(), providers: [p] });
  assert.equal(JSON.parse(readFileSync(path, "utf8")).providers.openai.modelOverrides[native.id].cost, undefined);
  let draft = await service.read();
  await service.save(draft);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).providers.openai.modelOverrides[native.id].cost, undefined);
  draft = await service.read();
  delete draft.providers[0].models[0].cost;
  draft.providers[0].models[0].id = "renamed-native";
  await service.save({ ...draft, confirmLogout: true });
  assert.deepEqual((await service.runtime()).getModel("openai", "renamed-native")!.cost, native.cost);
}));

test("saved prices calculate actual adapter usage; subsequent edits do not reprice recorded requests", () => fixture(async (service) => {
  const endpoint = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "priced-response", object: "chat.completion.chunk", model: "priced", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "priced-response", object: "chat.completion.chunk", model: "priced", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 400 } } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => endpoint.listen(0, "127.0.0.1", resolve));
  try {
    const address = endpoint.address() as { port: number };
    await service.save({ ...await service.read(), providers: [provider(`http://127.0.0.1:${address.port}/v1`)] });
    const model = (await service.runtime()).getModel("pricing-test", "priced")!;
    const reply = await complete(model, { messages: [{ role: "user", content: "fixture", timestamp: Date.now() }] }, { apiKey: "fixture-only", maxRetries: 0 });
    assert.equal(reply.stopReason, "stop", reply.errorMessage);
    assert.equal(reply.usage.input, 600);
    assert.equal(reply.usage.cacheRead, 400);
    assert.ok(Math.abs(reply.usage.cost.total - .0022) < 1e-10);
    const recorded = structuredClone(reply.usage);
    const draft = await service.read();
    draft.providers[0].models[0].cost = { ...prices, input: 20 };
    await service.save(draft);
    assert.equal((await service.runtime()).getModel("pricing-test", "priced")!.cost.input, 20);
    assert.equal(usageCost(recorded).unknownCost, 0);
    assert.ok(Math.abs(usageCost(recorded).knownCost - .0022) < 1e-10);
  } finally { await new Promise<void>(resolve => endpoint.close(() => resolve())); }
}));
