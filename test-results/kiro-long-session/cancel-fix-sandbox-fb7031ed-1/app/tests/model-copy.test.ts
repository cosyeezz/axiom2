import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ModelService } from "../src/server/model-service.js";
import { copyModelDraft } from "../src/client/models/copy-model.js";
import type { ProviderDraft } from "../src/shared/models.js";

const provider = (): ProviderDraft => ({
  id: "copy-test", providerId: "copy-test", name: "复制测试", api: "openai-responses", url: "http://127.0.0.1:1/v1", key: "TEST-ONLY", headers: [], body: [],
  models: [{ key: "original", id: "upstream-model", name: "原模型", levels: ["none"], input: ["text", "image"], cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 }, headers: [{ id: "h", key: "X-Copy-Test", value: "PRIVATE-MODEL-HEADER" }], body: [{ id: "b", key: "service_tier", value: "fast", valueType: "string" }], bodyVersion: 2 }],
});

test("copies have unique identities/names and independent nested configuration, including unsaved copies", () => {
  const p = provider(), source = p.models[0];
  const first = copyModelDraft(source, p.models);
  p.models.push(first);
  const second = copyModelDraft(source, p.models);
  p.models.push(second);
  const third = copyModelDraft(first, p.models);
  assert.deepEqual([first.name, second.name, third.name], ["原模型（复制）", "原模型（复制 2）", "原模型（复制 3）"]);
  assert.equal(new Set([source.key, first.key, second.key, third.key]).size, 4);
  assert.equal(new Set([first.configId, second.configId, third.configId]).size, 3);
  assert.ok([first, second, third].every(m => m.id === source.id && !m.originalId));
  first.headers[0].value = "changed";
  first.cost!.input = 99;
  assert.equal(source.headers[0].value, "PRIVATE-MODEL-HEADER");
  assert.equal(source.cost!.input, 1);
  source.name = "长".repeat(160);
  assert.equal(copyModelDraft(source, p.models).name.length, 160);
});

test("saved copies preserve hidden configuration, headers and upstream requests across save/reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-copy-")), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  const requests: { body: Record<string, unknown>; header: string | undefined }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), header: req.headers["x-copy-test"] as string | undefined });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_copy", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\ndata: [DONE]\n\n`);
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const service = new ModelService(root, null), path = join(service.dir, "models.json");
    let draft = await service.read();
    const p = provider();
    p.url = endpoint + "/v1";
    draft.providers = [p];
    await service.save(draft);
    const config = JSON.parse(readFileSync(path, "utf8"));
    Object.assign(config.providers[p.providerId].models[0], {
      contextWindow: 64000, maxTokens: 1234, inputLimits: { images: { maxPerRequest: 3 } },
      samplingParamsByThinkingLevel: { off: { temperature: 0.3 } },
      samplingParams: { service_tier: "fast", hidden: { enabled: true } },
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, tiers: [{ input: 3, output: 4, cacheRead: 1, cacheWrite: 2, inputTokensAbove: 32000 }] },
    });
    config.providers[p.providerId].modelOverrides = { "upstream-model": { contextWindow: 96000, maxTokens: 2345, compat: { supportsStore: false }, futureSetting: { enabled: true } } };
    writeFileSync(path, JSON.stringify(config));
    draft = await service.read();
    const original = draft.providers[0].models[0];
    assert.ok(!JSON.stringify(draft).includes("PRIVATE-MODEL-HEADER"));
    const copy = copyModelDraft(original, draft.providers[0].models);
    draft.providers[0].models.push(copy);
    draft.providers[0].models.push(copyModelDraft(copy, draft.providers[0].models));
    await service.save(draft);
    const disk = () => JSON.parse(readFileSync(path, "utf8")).providers[p.providerId];
    const saved = disk().models.find((m: { id: string }) => m.id === copy.configId);
    assert.equal(saved.axiomRequestModelId, "upstream-model");
    assert.equal(saved.headers["X-Copy-Test"], "PRIVATE-MODEL-HEADER");
    assert.equal(saved.contextWindow, 96000);
    assert.equal(saved.maxTokens, 2345);
    assert.equal(saved.compat.supportsStore, false);
    assert.deepEqual(saved.input, ["text", "image"]);
    assert.deepEqual(saved.samplingParams.hidden, { enabled: true });
    assert.deepEqual(saved.samplingParamsByThinkingLevel, { off: { temperature: 0.3 } });
    assert.deepEqual(saved.futureSetting, { enabled: true });
    assert.ok(saved.cost.tiers.length);
    draft = await service.read();
    const reloaded = draft.providers[0].models.find(m => m.configId === copy.configId)!;
    assert.equal(reloaded.id, "upstream-model");
    assert.equal(reloaded.originalId, copy.configId);
    const third = copyModelDraft(reloaded, draft.providers[0].models);
    assert.equal(third.name, "原模型（复制 3）");
    draft.providers[0].models.push(third);
    reloaded.headers = []; // Removing a copy's header must not resurrect the source header at request time.
    await service.save(draft);
    assert.equal(disk().models.find((m: { id: string }) => m.id === "upstream-model").headers["X-Copy-Test"], "PRIVATE-MODEL-HEADER");
    const runtime = await service.runtime();
    for (const [identity, expectedHeader] of [[copy.configId!, undefined], [third.configId!, "PRIVATE-MODEL-HEADER"], ["upstream-model", "PRIVATE-MODEL-HEADER"]] as const) {
      const model = runtime.getModel(p.providerId, identity)!;
      const result = await runtime.completeSimple(model, { messages: [{ role: "user", content: "local copy test", timestamp: 1 }] }, {
        transport: "sse", maxRetries: 0, signal: AbortSignal.timeout(10000), fetch: (input, init) => {
          assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, endpoint);
          return fetch(input, init);
        },
      });
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.equal(result.model, identity);
      assert.equal(requests.at(-1)!.body.model, "upstream-model");
      assert.equal(requests.at(-1)!.body.service_tier, "fast");
      assert.equal(requests.at(-1)!.header, expectedHeader);
    }
    assert.equal(requests.length, 3);
    const forged = await service.read();
    const invalid = copyModelDraft(forged.providers[0].models[0], forged.providers[0].models);
    invalid.copyFromId = "missing-source";
    forged.providers[0].models.push(invalid);
    await assert.rejects(service.save(forged), { code: "INVALID_CONFIG" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
