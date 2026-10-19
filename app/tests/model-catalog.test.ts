import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { authBrowserCommand } from "../src/server/auth-browser.js";
import { ModelService } from "../src/server/model-service.js";

test("OAuth opener passes authorization URLs as data on every platform", () => {
  const url = "https://example.invalid/auth?state=a&code=';$(echo SECRET)#";
  const windows = authBrowserCommand(url, "win32");
  assert.equal(windows.env.AXIOM_AUTH_URL, url);
  assert.ok(!windows.args.join(" ").includes(url));
  assert.match(Buffer.from(windows.args.at(-1)!, "base64").toString("utf16le"), /\$env:AXIOM_AUTH_URL/);
  for (const platform of ["darwin", "linux"] as const) assert.deepEqual(authBrowserCommand(url, platform).args, [url]);
  for (const invalid of ["file:///tmp/file", "javascript:alert(1)", "https://user:password@example.invalid", "https://example.invalid/" + "x".repeat(16000)])
    assert.throws(() => authBrowserCommand(invalid));
});

test("catalog fetches the configured baseUrl with pi auth and imports only upstream IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-catalog-endpoint-"));
  const previous = process.env.AXIOM_PI_DIR;
  const previousHeader = process.env.AXIOM_CATALOG_TEST_HEADER;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  process.env.AXIOM_CATALOG_TEST_HEADER = "resolved-header";
  let status = 200, body = "", requests = 0, drift = false;
  let expectedKey: string | undefined = "Bearer EXPLICIT";
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.url, "/proxy/v1/models");
    assert.equal(req.headers.authorization, expectedKey);
    assert.equal(req.headers["x-fixture"], "resolved-header");
    if (drift) writeFileSync(join(root, "pi", "models.json"), readFileSync(join(root, "pi", "models.json"), "utf8") + " ");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const service = new ModelService(root);
    await service.read();
    const known = (await service.runtime()).getModels("openai")[0];
    const raw = JSON.stringify({ providers: { openai: {
      api: known.api, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/proxy/v1/`, apiKey: "TEST-KEY",
      headers: { "X-Fixture": "$AXIOM_CATALOG_TEST_HEADER", Authorization: "Bearer EXPLICIT" }, authHeader: true,
      models: [{ id: "local-only", name: "Only in target" }],
      modelOverrides: { [known.id]: { name: "Local override", contextWindow: 1234 } },
    } } });
    writeFileSync(join(service.dir, "models.json"), raw);
    let draft = await service.read();
    const migratedRaw = await service.raw();
    assert.equal(JSON.parse(migratedRaw).providers.openai.apiKey, undefined);
    body = JSON.stringify({ data: [{ id: known.id, name: "Upstream name" }, { id: "upstream-only" }] });
    const catalog = await service.catalog("openai", draft.revision);
    assert.equal(catalog.source, "endpoint");
    assert.equal(requests, 1);
    assert.deepEqual(new Set(catalog.models.map((model) => model.id)), new Set([known.id, "upstream-only"]));
    const native = catalog.models.find((model) => model.id === known.id)!;
    assert.equal(native.name, "Upstream name");
    assert.equal(native.contextWindow, known.contextWindow, "target overrides are never discovery metadata");
    const chosen = catalog.models.find((model) => model.id === "upstream-only")!;
    assert.equal(chosen.contextWindow, undefined);
    assert.equal(chosen.levels, undefined);
    assert.equal(await service.raw(), migratedRaw, "fetching does not publish config after credential normalization");
    draft.providers[0].models.push({ key: chosen.id, id: chosen.id, name: chosen.name, levels: chosen.levels ?? ["none"], input: chosen.input ?? ["text"], headers: [], body: [] });
    await service.save(draft);
    draft = await service.read();
    assert.ok(draft.providers[0].models.some((model) => model.id === chosen.id));
    assert.equal(requests, 1, "reads and saves never fetch the endpoint");
    await assert.rejects(service.catalog("openai", "stale"), { code: "REVISION_CONFLICT" });
    await assert.rejects(service.catalog("missing", draft.revision), { code: "NOT_FOUND" });
    service.authActive = true;
    await assert.rejects(service.catalog("openai", draft.revision), { code: "AUTH_BUSY" });
    service.authActive = false;
    for (const failure of [401, 403, 404, 500]) {
      status = failure;
      body = "PRIVATE-SECRET";
      await assert.rejects(service.catalog("openai", draft.revision), (error: any) => error.code === "MODEL_DISCOVERY_FAILED" && !error.message.includes("PRIVATE-SECRET"));
    }
    status = 200;
    body = JSON.stringify({ data: [] });
    assert.deepEqual((await service.catalog("openai", draft.revision)).models, [], "empty upstream never falls back to target or public catalog");
    body = JSON.stringify({ data: [{ id: "upstream-only" }] });
    drift = true;
    await assert.rejects(service.catalog("openai", draft.revision), { code: "REVISION_CONFLICT" });
    assert.ok(!readdirSync(service.dir).some((name) => name.startsWith("models-catalog-")));

    // A custom header is not a substitute for the canonical API-key configuration.
    drift = false;
    expectedKey = undefined;
    const config = JSON.parse(raw);
    const custom = config.providers.openai;
    delete custom.apiKey;
    delete custom.headers.Authorization;
    config.providers = { "header-only-fixture": custom };
    writeFileSync(join(service.dir, "models.json"), JSON.stringify(config));
    draft = await service.read();
    await assert.rejects(service.catalog("header-only-fixture", draft.revision), { code: "MODEL_AUTH_MISSING" });

    // The endpoint protocol wins over a same-ID native model with another protocol.
    expectedKey = "Bearer TEST-KEY";
    custom.api = "openai-completions";
    custom.models = [];
    custom.modelOverrides = {};
    config.providers = { openai: custom };
    body = JSON.stringify({ data: [{ id: known.id }] });
    assert.notEqual(known.api, custom.api);
    for (const input of [["text"], ["text", "image"]] as const) {
      writeFileSync(join(service.dir, "models.json"), JSON.stringify(config));
      draft = await service.read();
      const imported = (await service.catalog("openai", draft.revision)).models[0];
      assert.equal(imported.api, "openai-completions");
      assert.equal(imported.levels, undefined);
      draft.providers[0].models.push({ key: imported.id, id: imported.id, name: imported.name, levels: ["none"], input: [...input], headers: [], body: [] });
      await service.save(draft);
      const saved = JSON.parse(await service.raw()).providers.openai;
      assert.equal(saved.models[0].id, known.id);
      assert.deepEqual(saved.modelOverrides, {});
      const model = (await service.runtime()).getModel("openai", known.id)!;
      assert.equal(model.api, "openai-completions");
      assert.deepEqual(model.input, [...input]);
      assert.equal(model.reasoning, false);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    if (previousHeader === undefined) delete process.env.AXIOM_CATALOG_TEST_HEADER;
    else process.env.AXIOM_CATALOG_TEST_HEADER = previousHeader;
    rmSync(root, { recursive: true, force: true });
  }
});

test("OAuth without a custom endpoint keeps native discovery but never falls back on refresh failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-catalog-oauth-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    await service.raw();
    writeFileSync(join(service.dir, "models.json"), JSON.stringify({ providers: { openai: {
      headers: {}, models: [{ id: "local-only", api: "openai-responses", baseUrl: "https://example.invalid" }],
    } } }));
    const createRuntime = service.runtime.bind(service);
    let fail = false, refreshed = 0;
    service.runtime = async (path) => {
      const runtime = await createRuntime(path);
      runtime.listCredentials = async () => [{ providerId: "openai", type: "oauth" }];
      runtime.checkAuth = async () => ({ type: "oauth", source: "fixture" });
      const refresh = runtime.refresh.bind(runtime);
      runtime.refresh = async (options) => {
        if (!options?.allowNetwork) return refresh(options);
        refreshed++;
        assert.deepEqual(options.providers, ["openai"]);
        return { aborted: false, errors: fail ? new Map([["openai", Error("PRIVATE-SECRET")]]) : new Map() };
      };
      return runtime;
    };
    const draft = await service.read();
    const catalog = await service.catalog("openai", draft.revision);
    assert.equal(catalog.source, "native");
    assert.match(catalog.message, /可能包含内置或缓存项/);
    assert.equal(refreshed, 1);
    assert.ok(catalog.models.length);
    assert.ok(!catalog.models.some((model) => model.id === "local-only"));
    fail = true;
    await assert.rejects(service.catalog("openai", draft.revision), { code: "MODEL_DISCOVERY_FAILED" });
    assert.ok(!readdirSync(service.dir).some((name) => name.startsWith("models-catalog-")));
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
