import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ModelService } from "../src/server/model-service.js";
import { prepareDraft } from "../src/server/models/draft.js";
import type { BodyOverrideType, OverrideRow, ProviderDraft } from "../src/shared/models.js";

const row = (key: string, value: string, valueType?: BodyOverrideType): OverrideRow => ({ id: key, key, value, ...(valueType ? { valueType } : {}) });
const provider = (): ProviderDraft => ({
  id: "draft", providerId: "override-test", name: "覆盖测试", api: "openai-responses", url: "http://127.0.0.1:1/v1", key: "", headers: [], body: [],
  models: ["one", "two"].map(id => ({ key: id, id, name: id, levels: ["none"], headers: [], body: [] })),
});
const runtime = { getModels: () => [], getModel: () => undefined } as unknown as ModelRuntime;

test("body text stays verbatim; numeric defaults and validation remain compatible", () => {
  const p = provider();
  p.models[0].body = [row("service_tier", "fast"), row("custom", "  中文 001\nfalse  "), row("empty", ""), row("numeric_text", "001", "string"), row("temperature", "0.5"), row("custom_number", "12.5", "number")];
  const prepare = () => prepareDraft({ providers: [p] }, { providers: {} }, runtime);
  assert.deepEqual(prepare().providers[p.providerId].models[0].samplingParams, {
    service_tier: "fast", custom: "  中文 001\nfalse  ", empty: "", numeric_text: "001", temperature: 0.5, custom_number: 12.5,
  });
  for (const bad of [row("__proto__", "x"), row("constructor", "x"), row("bad key", "x"), row("temperature", "3"), row("top_p", "-1"), row("max_tokens", "1.2"), row("custom_number", "NaN", "number"), row("custom_number", "", "number"), row("custom", "x".repeat(8193)), { ...row("custom", "x"), valueType: "object" }]) {
    p.models[0].body = [bad as OverrideRow];
    assert.throws(prepare, { code: "INVALID_CONFIG" });
  }
  p.models[0].body = [row("service_tier", "fast"), row("service_tier", "ultrafast")];
  assert.throws(prepare, { code: "INVALID_CONFIG" });
});

test("legacy drafts preserve previously hidden fields; typed drafts delete editable fields only", () => {
  const p = provider();
  p.originalId = p.providerId;
  p.models[0].originalId = "one";
  const hidden = { nested: { enabled: true }, enabled: false, values: ["x"], nullable: null };
  const config = { providers: { [p.providerId]: { api: p.api, baseUrl: p.url, models: [{ id: "one", samplingParams: { temperature: 1, service_tier: "fast", custom_number: 2, ...hidden } }] } } };
  const prepare = () => prepareDraft({ providers: [p] }, config, runtime).providers[p.providerId].models[0].samplingParams;
  assert.deepEqual(prepare(), { service_tier: "fast", custom_number: 2, ...hidden });
  p.models[0].bodyVersion = 2;
  assert.deepEqual(prepare(), hidden);
});

test("saved overrides round-trip, merge, reach HTTP with correct types, and can be deleted", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-body-overrides-")), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  const requests: { body: Record<string, unknown>; headers: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), headers: req.headers });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_mock", status: "completed", service_tier: "fast", output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\ndata: [DONE]\n\n`);
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const service = new ModelService(root, null), path = join(service.dir, "models.json");
    let draft = await service.read();
    const p = provider();
    p.url = endpoint + "/v1";
    p.key = "TEST-ONLY-NOT-A-REAL-KEY";
    p.headers = [row("X-Test", "PRIVATE-HEADER"), row("Accept", "text/event-stream")];
    p.body = [row("service_tier", "ultrafast"), row("custom_number", "7", "number")];
    p.models[0].headers = [row("X-Test", "MODEL-HEADER")];
    p.models[0].body = [row("service_tier", "fast"), row("model", "upstream-model"), row("temperature", "0.5"), row("user", "001", "string"), row("custom_text", " 中文 "), row("empty", "")];
    draft.providers = [p];
    await service.save(draft);
    const disk = () => JSON.parse(readFileSync(path, "utf8")).providers[p.providerId];
    assert.equal(disk().models[0].samplingParams.service_tier, "fast");
    assert.equal(disk().models[1].samplingParams.service_tier, "ultrafast");
    draft = await service.read();
    assert.ok(!JSON.stringify(draft).includes("PRIVATE-HEADER"));
    assert.ok(!JSON.stringify(draft).includes("MODEL-HEADER"));
    assert.equal(draft.providers[0].models[0].bodyVersion, 2);
    assert.equal(draft.providers[0].models[0].body.find(r => r.key === "user")?.valueType, "string");
    assert.equal(draft.providers[0].models[0].body.find(r => r.key === "custom_number")?.valueType, "number");
    await service.save(draft);
    assert.equal(disk().headers["X-Test"], "PRIVATE-HEADER");
    const actual = await service.runtime();
    const result = await actual.completeSimple(actual.getModel(p.providerId, "one")!, {
      messages: [{ role: "user", content: "local mock only", timestamp: 1 }],
    }, { transport: "sse", maxRetries: 0, signal: AbortSignal.timeout(10000), fetch: (input, init) => {
      assert.equal(new URL(input instanceof Request ? input.url : String(input)).origin, endpoint);
      return fetch(input, init);
    } });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers["x-test"], "MODEL-HEADER");
    assert.equal(requests[0].body.model, "upstream-model");
    assert.equal(requests[0].body.service_tier, "fast");
    assert.equal(requests[0].body.temperature, 0.5);
    assert.equal(requests[0].body.custom_number, 7);
    assert.equal(requests[0].body.user, "001");
    assert.equal(requests[0].body.custom_text, " 中文 ");
    assert.equal(requests[0].body.empty, "");
    // Unsupported value types remain on the server; layered overrides must not resurrect deleted text.
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.providers[p.providerId].models[0].samplingParams.hidden = { enabled: true };
    config.providers[p.providerId].modelOverrides = { one: { samplingParams: { service_tier: "priority" } } };
    writeFileSync(path, JSON.stringify(config));
    draft = await service.read();
    assert.equal(draft.providers[0].models[0].body.find(r => r.key === "service_tier")?.value, "priority");
    draft.providers[0].models[0].body = [];
    await service.save(draft);
    assert.deepEqual(disk().models[0].samplingParams, { hidden: { enabled: true } });
    const reloaded = await service.read();
    assert.deepEqual(reloaded.providers[0].models[0].body, []);
    assert.equal((await service.runtime()).getModel(p.providerId, "one")?.samplingParams?.service_tier, undefined);
    const forged = await service.read();
    forged.providers[0].headers[0].source = "missing";
    await assert.rejects(service.save(forged), { code: "INVALID_CONFIG" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
