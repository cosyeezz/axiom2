import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { privateJson } from "../src/server/model-account-storage.js";
import { ModelService } from "../src/server/model-service.js";

const model = { id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 4096, maxTokens: 1024 };
async function fixture(run: (dir: string, config: (extra: Record<string, unknown>) => void, runtime: () => ReturnType<typeof createModelRuntime>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "axiom-account-headers-"));
  const names = ["AXIOM_PI_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER"];
  const previous = names.map(name => process.env[name]);
  names.forEach(name => delete process.env[name]);
  privateJson(join(dir, "auth.json"), { fixture: { type: "api_key", key: "FIXTURE_SELECTED" } });
  const config = (extra: Record<string, unknown>) => privateJson(join(dir, "models.json"), { providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [model], ...extra } } });
  config({});
  const runtime = () => createModelRuntime({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json"), modelsStorePath: join(dir, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  try { await run(dir, config, runtime); }
  finally { names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); rmSync(dir, { recursive: true, force: true }); }
}

test("account key references bind after SDK auth resolution while ordinary request headers survive", () => fixture(async (_dir, config, create) => {
  config({ headers: { Authorization: "Bearer {{account.key}}", "X-Business": "preserved" },
    models: [{ ...model, headers: { "X-Custom-Key": "{{account.key}}" } }] });
  const runtime = await create(), auth = await runtime.getAuth(runtime.getModel("fixture", "fixture")!);
  assert.equal(auth?.auth.headers?.Authorization, "Bearer FIXTURE_SELECTED");
  assert.equal(auth?.auth.headers?.["X-Custom-Key"], "FIXTURE_SELECTED");
  assert.equal(auth?.auth.headers?.["X-Business"], "preserved");
}));

test("legacy literal authentication headers fail closed at every configuration level and native refresh entry", () => fixture(async (_dir, config, create) => {
  for (const headers of [{ aUtHoRiZaTiOn: "Bearer OTHER_ACCOUNT" }, { "X-API-Key": "OTHER_ACCOUNT" }, { "x-goog-api-key": "OTHER_ACCOUNT" }]) {
    for (const extra of [{ headers }, { models: [{ ...model, headers }] }, { modelOverrides: { fixture: { headers } } }]) {
      config(extra);
      const runtime = await create();
      await assert.rejects(runtime.getAuth(runtime.getModel("fixture", "fixture")!), { code: "ACCOUNT_HEADER_CONFLICT" });
      await assert.rejects(runtime.refresh({ allowNetwork: true, providers: ["fixture"] }), { code: "ACCOUNT_HEADER_CONFLICT" });
    }
  }
  config({});
  const runtime = await create();
  await assert.rejects(runtime.getAuth({ ...runtime.getModel("fixture", "fixture")!, headers: { authorization: "OTHER_ACCOUNT" } }), { code: "ACCOUNT_HEADER_CONFLICT" });
}));

test("OAuth and missing account credentials cannot expose a packed token through generic header references", () => fixture(async (dir, config, create) => {
  config({ headers: { authorization: "Bearer {{account.key}}" } });
  for (const auth of [{ fixture: { type: "oauth", access: "PRIVATE", refresh: "PRIVATE", expires: Date.now() + 3600000 } }, {}]) {
    privateJson(join(dir, "auth.json"), auth);
    const runtime = await create();
    await assert.rejects(runtime.getAuth(runtime.getModel("fixture", "fixture")!), { code: "ACCOUNT_HEADER_UNSUPPORTED" });
  }
}));

test("literal authentication edits are rejected but existing masked headers stay editable and removable", () => fixture(async (dir, config) => {
  process.env.AXIOM_PI_DIR = dir;
  config({ headers: { Authorization: "Bearer FIXTURE_OLD", "X-Business": "preserved" } });
  const service = new ModelService(dir, null), draft = await service.read();
  await service.save(draft); // Keeping a legacy field is not permission to send it.
  draft.revision = (await service.read()).revision;
  draft.providers[0].headers = [{ id: "h", key: "Authorization", value: "Bearer OTHER_ACCOUNT" }];
  await assert.rejects(service.save(draft), { code: "ACCOUNT_HEADER_REQUIRED" });
  draft.providers[0].headers = [{ id: "h", key: "Authorization", value: "Bearer {{account.key}}" }];
  await service.save(draft);
  const runtime = await service.runtime();
  assert.equal((await runtime.getAuth("fixture"))?.auth.headers?.Authorization, "Bearer FIXTURE_SELECTED");
}));

test("resolved account references reach the wire, not literal model headers, including copied model identities", () => fixture(async (_dir, config, create) => {
  const received: { auth?: string; key?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    received.push({ auth: request.headers.authorization, key: request.headers["x-custom-key"] as string, body });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"upstream","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"upstream","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    config({ baseUrl: `http://127.0.0.1:${port}/v1`, headers: { Authorization: "Bearer {{account.key}}" },
      models: [{ ...model, axiomRequestModelId: "upstream", headers: { "X-Custom-Key": "{{account.key}}" } }] });
    const runtime = await create(), selected = runtime.getModel("fixture", "fixture")!;
    const result = await runtime.completeSimple(selected, { messages: [{ role: "user", content: "fixture", timestamp: Date.now() }] }, { maxTokens: 8 });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(received.length, 1);
    assert.equal(received[0].auth, "Bearer FIXTURE_SELECTED");
    assert.equal(received[0].key, "FIXTURE_SELECTED");
    assert.equal(JSON.parse(received[0].body).model, "upstream");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}));
