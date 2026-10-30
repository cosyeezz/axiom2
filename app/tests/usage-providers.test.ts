import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelService } from "../src/server/model-service.js";

test("usage directory is read-only metadata, preserves connection names and shares only supported OAuth", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-directory-")), dir = join(root, "pi"); mkdirSync(dir);
  try {
    const auth = JSON.stringify({ openai: { type: "oauth", access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", expires: Date.now() + 3600000 },
      "openai-codex": { type: "oauth", access: "PRIVATE_CODEX_ACCESS", refresh: "PRIVATE_CODEX_REFRESH", expires: Date.now() + 3600000 },
      anthropic: { type: "api_key", key: "PRIVATE_KEY" }, "stored-only": { type: "api_key", key: "PRIVATE_STORED" } });
    const config = JSON.stringify({ providers: { openai: { name: "My OpenAI", models: [{ id: "large-model", name: "NO_MODEL_CATALOG" }] }, anthropic: { name: "My Anthropic" },
      legacy: { apiKey: "!NEVER_EXECUTE", name: "Custom route", headers: { authorization: "PRIVATE_HEADER" } } } });
    writeFileSync(join(dir, "auth.json"), auth); writeFileSync(join(dir, "models.json"), config);
    const models = new ModelService(root, null, dir);
    (models as unknown as { runtime: () => never }).runtime = () => { throw Error("directory must not initialize SDK runtime"); };
    const directory = await models.usageProviders();
    assert.equal(directory.find(row => row.id === "openai")!.name, "My OpenAI");
    assert.equal(directory.find(row => row.id === "openai")!.query, "shared");
    assert.equal(directory.find(row => row.id === "openai-codex")!.name, "OpenAI");
    assert.equal(directory.find(row => row.id === "openai-codex")!.query, "shared");
    assert.equal(directory.find(row => row.id === "anthropic")!.query, "unsupported");
    assert.equal(directory.find(row => row.id === "stored-only")!.configured, true);
    assert.equal(directory.find(row => row.id === "legacy")!.configured, true);
    assert.doesNotMatch(JSON.stringify(directory), /PRIVATE_|NEVER_EXECUTE|NO_MODEL_CATALOG|auth\.json|authorization/);
    assert.equal(readFileSync(join(dir, "auth.json"), "utf8"), auth); assert.equal(readFileSync(join(dir, "models.json"), "utf8"), config);
    writeFileSync(join(dir, "auth.json"), auth.replace("PRIVATE_ACCESS", "ROTATED_ACCESS"));
    assert.notEqual((await models.usageProviders())[0].revision, directory[0].revision);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("usage directory never creates missing files and safely reports malformed configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-directory-")), dir = join(root, "not-created");
  try {
    const models = new ModelService(root, null, dir);
    assert.deepEqual(await models.usageProviders(), []); assert.equal(existsSync(dir), false);
    mkdirSync(dir); writeFileSync(join(dir, "models.json"), '{"PRIVATE_BROKEN');
    await assert.rejects(models.usageProviders(), error => error instanceof Error && !error.message.includes("PRIVATE_BROKEN"));
    assert.equal(readFileSync(join(dir, "models.json"), "utf8"), '{"PRIVATE_BROKEN'); assert.equal(existsSync(join(dir, "auth.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
