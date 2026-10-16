import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { authBrowserCommand } from "../src/server/auth-browser.js";
import { ModelService } from "../src/server/model-service.js";
import type { ProviderDraft } from "../src/shared/models.js";

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

test("pi fetches a catalog over HTTP and preserves newly discovered metadata across save/reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-catalog-http-"));
  const previous = process.env.AXIOM_PI_DIR;
  const piDir = join(root, "pi");
  process.env.AXIOM_PI_DIR = piDir;
  let body = "[]", requests = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.match(req.url!, /^\/api\/models\/providers\/openai\?types=/);
    assert.equal(req.headers.authorization, undefined, "public pi catalog must not receive provider credentials");
    res.writeHead(200, { "content-type": "application/json", "last-modified": "Thu, 01 Jan 2099 00:00:00 GMT" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const service = new ModelService(root);
    service.runtime = async (path = join(piDir, "models.json")) => ModelRuntime.create({
      modelsPath: path, authPath: join(piDir, "auth.json"), modelsStorePath: join(piDir, "models-store.json"),
      catalogBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, allowModelNetwork: false, refreshOnCreate: false,
    });
    let draft = await service.read();
    const template = draft.templates.find((p) => p.id === "openai")!;
    const base = (await service.runtime()).getModels("openai").find((model) => model.api === template.api)!;
    const discovered = { ...base, id: "new-catalog-fixture", name: "Discovered model", contextWindow: 654321, maxTokens: 12345 };
    body = JSON.stringify([discovered]);
    await service.save({ ...draft, providers: [{ ...template, providerId: template.id, key: "TEST-ONLY", models: [], headers: [], body: [] }] });
    assert.equal(requests, 0, "normal reads and saves must remain offline");
    draft = await service.read();
    const catalog = await service.catalog("openai", draft.revision);
    assert.equal(catalog.source, "refreshed");
    assert.equal(requests, 1);
    const chosen = catalog.models.find((model) => model.id === discovered.id)!;
    assert.ok(chosen);
    assert.deepEqual(chosen.input, discovered.input);
    draft.providers[0].models.push({ key: chosen.id, id: chosen.id, name: chosen.name, levels: chosen.levels, input: [...chosen.input], headers: [], body: [] });
    await service.save(draft);
    const saved = JSON.parse(readFileSync(join(piDir, "models.json"), "utf8"));
    assert.ok(saved.providers.openai.modelOverrides[chosen.id]);
    assert.equal(saved.providers.openai.models.length, 0);
    const { runtime } = await new ModelService(root).load();
    const restored = runtime.getModel("openai", chosen.id)!;
    assert.equal(restored.contextWindow, discovered.contextWindow);
    assert.equal(restored.maxTokens, discovered.maxTokens);
    assert.deepEqual(restored.cost, discovered.cost);
    assert.deepEqual(restored.input, discovered.input);
    assert.equal(requests, 1, "saving and reloading use the native disk cache without fetching again");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("model catalog: native refresh, local fallback, revision checks and metadata-preserving selection", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-catalog-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    let draft = await service.read();
    const template = draft.templates.find((p) => p.id === "openai")!;
    const provider: ProviderDraft = { id: "openai", providerId: "openai", name: template.name, url: template.url, api: template.api, key: "", models: [], headers: [], body: [] };
    await service.save({ ...draft, providers: [provider] });
    draft = await service.read();
    const original = await service.raw();
    let catalog = await service.catalog("openai", draft.revision);
    assert.equal(catalog.source, "local");
    assert.match(catalog.message, /OAuth/);
    assert.ok(catalog.models.length);
    assert.equal(await service.raw(), original, "listing must not publish configuration");
    await assert.rejects(service.catalog("openai", "stale"), { code: "REVISION_CONFLICT" });
    await assert.rejects(service.catalog("missing", draft.revision), { code: "NOT_FOUND" });
    service.authActive = true;
    await assert.rejects(service.catalog("openai", draft.revision), { code: "AUTH_BUSY" });
    service.authActive = false;
    const chosen = catalog.models.find((model) => model.api === template.api)!;
    const before = (await service.runtime()).getModel("openai", chosen.id)!;
    draft.providers[0].models = [{ key: "chosen", id: chosen.id, name: chosen.name, levels: chosen.levels, headers: [], body: [] }];
    await service.save(draft);
    const after = (await service.runtime()).getModel("openai", chosen.id)!;
    for (const field of ["cost", "input", "contextWindow", "maxTokens", "api"] as const) assert.deepEqual(after[field], before[field]);
    assert.ok(JSON.parse(readFileSync(join(service.dir, "models.json"), "utf8")).providers.openai.modelOverrides[chosen.id]);

    // Native network refresh is a fixture: exercise the service contract without a real account or network.
    draft = await service.read();
    const createRuntime = service.runtime.bind(service);
    let requested = 0;
    let fail = false;
    let drift = false;
    service.runtime = async (path) => {
      const runtime = await createRuntime(path);
      runtime.checkAuth = async () => ({ type: "api_key", source: "fixture" });
      const refresh = runtime.refresh.bind(runtime);
      runtime.refresh = async (options) => {
        if (!options?.allowNetwork) return refresh(options);
        requested++;
        assert.deepEqual(options.providers, ["openai"]);
        assert.equal(options.force, true);
        assert.ok(options.signal);
        if (drift) {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(join(service.dir, "models.json"), (await service.raw()) + " ");
        }
        return { aborted: false, errors: fail ? new Map([["openai", Error("PRIVATE-SECRET")]]) : new Map() };
      };
      return runtime;
    };
    catalog = await service.catalog("openai", draft.revision);
    assert.equal(catalog.source, "refreshed");
    assert.equal(requested, 1);
    fail = true;
    catalog = await service.catalog("openai", draft.revision);
    assert.equal(catalog.source, "local");
    assert.match(catalog.message, /未完成/);
    assert.ok(!JSON.stringify(catalog).includes("PRIVATE-SECRET"));
    drift = true;
    await assert.rejects(service.catalog("openai", draft.revision), { code: "REVISION_CONFLICT" });
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
