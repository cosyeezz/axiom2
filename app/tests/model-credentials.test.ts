import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ModelService } from "../src/server/model-service.js";

async function fixture(run: (service: ModelService) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "axiom-key-migration-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    await service.raw();
    await run(service);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}
const definition = (apiKey?: string) => ({ api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", ...(apiKey === undefined ? {} : { apiKey }), models: [] });
const config = (service: ModelService, providers: object) => writeFileSync(join(service.dir, "models.json"), JSON.stringify({ providers, preserved: "metadata" }));
const auth = (service: ModelService) => JSON.parse(readFileSync(join(service.dir, "auth.json"), "utf8"));

test("configuration reads migrate legacy expressions, prefer stored credentials, preserve OAuth and are idempotent", async () => {
  await fixture(async service => {
    config(service, { legacy: definition("$AXIOM_MIGRATION_TEST_KEY"), both: definition("OLD"), oauth: definition("OLD-OAUTH-KEY") });
    const oauth = { type: "oauth", access: "OAUTH-ACCESS", refresh: "OAUTH-REFRESH", expires: Date.now() + 3_600_000 };
    writeFileSync(join(service.dir, "auth.json"), JSON.stringify({ both: { type: "api_key", key: "AUTH-WINS", env: { FIXTURE: "kept" } }, oauth }));
    const previous = process.env.AXIOM_MIGRATION_TEST_KEY;
    process.env.AXIOM_MIGRATION_TEST_KEY = "RESOLVED";
    try {
      const [first, second] = await Promise.all([service.read(), service.read()]);
      assert.equal(first.revision, second.revision);
      assert.equal(auth(service).legacy.key, "$AXIOM_MIGRATION_TEST_KEY");
      assert.deepEqual(auth(service).both, { type: "api_key", key: "AUTH-WINS", env: { FIXTURE: "kept" } });
      assert.deepEqual(auth(service).oauth, oauth);
      const saved = JSON.parse(await service.raw());
      for (const p of Object.values(saved.providers) as any[]) assert.equal(p.apiKey, undefined);
      assert.equal(saved.preserved, "metadata");
      assert.equal(first.providers.find(p => p.id === "legacy")?.auth?.configured, true);
      assert.doesNotMatch(JSON.stringify(first), /AUTH-WINS|RESOLVED|OAUTH-ACCESS|OLD-OAUTH-KEY/);
      const raw = await service.raw(), credentialBytes = readFileSync(join(service.dir, "auth.json"), "utf8");
      await service.read();
      assert.equal(await service.raw(), raw);
      assert.equal(readFileSync(join(service.dir, "auth.json"), "utf8"), credentialBytes);
      assert.ok(!readdirSync(service.dir).some(name => name.startsWith("models-credentials-")));
    } finally {
      if (previous === undefined) delete process.env.AXIOM_MIGRATION_TEST_KEY;
      else process.env.AXIOM_MIGRATION_TEST_KEY = previous;
    }
  });
});

test("failed credential persistence or a concurrent models edit never removes the legacy key", async () => {
  await fixture(async service => {
    config(service, { legacy: definition("KEEP-ON-FAILURE") });
    const original = await service.raw(), createRuntime = service.runtime.bind(service);
    service.runtime = async path => {
      const runtime = await createRuntime(path);
      runtime.login = async () => ({ type: "api_key", key: "KEEP-ON-FAILURE" });
      return runtime;
    };
    await assert.rejects(service.read(), { code: "CREDENTIAL_NOT_PERSISTED" });
    assert.equal(await service.raw(), original);
    service.runtime = async path => {
      const runtime = await createRuntime(path), login = runtime.login.bind(runtime);
      runtime.login = async (...args) => {
        const result = await login(...args);
        writeFileSync(join(service.dir, "models.json"), original + " ");
        return result;
      };
      return runtime;
    };
    await assert.rejects(service.read(), { code: "REVISION_CONFLICT" });
    assert.equal(await service.raw(), original + " ");
    assert.equal(auth(service).legacy.key, "KEEP-ON-FAILURE");
    service.runtime = createRuntime;
    await service.read();
    assert.equal(JSON.parse(await service.raw()).providers.legacy.apiKey, undefined);
  });
});

test("missing canonical credentials remain editable, block discovery, and can be repaired by saving", async () => {
  await fixture(async service => {
    config(service, { fixture: definition() });
    const draft = await service.read();
    assert.equal(draft.providers[0].auth?.configured, false);
    assert.match(draft.providers[0].auth?.error ?? "", /API 密钥/);
    await assert.rejects(service.catalog("fixture", draft.revision), { code: "MODEL_AUTH_MISSING" });
    draft.providers[0].key = "REPAIRED";
    await service.save(draft);
    const repaired = await service.read();
    assert.equal(repaired.providers[0].auth?.configured, true);
    assert.equal(repaired.providers[0].auth?.error, undefined);
    assert.equal(auth(service).fixture.key, "REPAIRED");
    assert.equal(JSON.parse(await service.raw()).providers.fixture.apiKey, undefined);
  });
});

test("discovery uses auth.json after migration and preserves an explicit Bearer authHeader", async () => {
  await fixture(async service => {
    const received: { authorization?: string; apiKey?: string }[] = [];
    const server = createServer((req, res) => {
      received.push({ authorization: req.headers.authorization, apiKey: req.headers["x-api-key"] as string | undefined });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "remote-model" }] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      config(service, { fixture: { ...definition("OLD"), api: "anthropic-messages", authHeader: true, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } });
      writeFileSync(join(service.dir, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "AUTH-WINS" } }));
      const draft = await service.read();
      assert.equal((await service.catalog("fixture", draft.revision)).models.length, 1);
      assert.deepEqual(received, [{ authorization: "Bearer AUTH-WINS", apiKey: "AUTH-WINS" }]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

test("whitespace-only legacy keys return a repairable configuration without changing the source", async () => {
  await fixture(async service => {
    config(service, { fixture: definition("   ") });
    const raw = await service.raw();
    const draft = await service.read();
    assert.equal(await service.raw(), raw);
    assert.equal(draft.providers[0].auth?.configured, false);
    assert.match(draft.providers[0].auth?.error ?? "", /API 密钥/);
    await assert.rejects(service.catalog("fixture", draft.revision), { code: "MODEL_AUTH_MISSING" });
    draft.providers[0].key = "FIXED-BLANK";
    await service.save(draft);
    assert.equal(auth(service).fixture.key, "FIXED-BLANK");
    assert.equal(JSON.parse(await service.raw()).providers.fixture.apiKey, undefined);
  });
});

test("saving a legacy draft also normalizes keys without replacing stored auth", async () => {
  await fixture(async service => {
    config(service, { fixture: definition("LEGACY") });
    const draft = await service.read({ normalizeCredentials: false });
    draft.providers[0].name = "Updated";
    const result = await service.save(draft);
    assert.equal(auth(service).fixture.key, "LEGACY");
    const saved = JSON.parse(await service.raw()).providers.fixture;
    assert.equal(saved.apiKey, undefined);
    assert.equal(saved.name, "Updated");
    assert.equal((await service.read()).revision, result.revision);
  });
});
