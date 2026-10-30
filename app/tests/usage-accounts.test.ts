import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ModelService } from "../src/server/model-service.js";
import { startServer } from "../src/server/index.js";
import type { modelNetwork } from "../src/server/model-network.js";
import { openAIProviderId } from "../src/shared/model-providers.js";
import type { Reply } from "../src/shared/protocol.js";

// Retired independent-account fixtures are intentionally retained, never read by
// production, migrated, refreshed or deleted. All credentials here are invented.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-shared-usage-")), dir = join(root, "primary-pi");
  mkdirSync(dir);
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = dir;
  const auth = join(dir, "auth.json"), config = join(dir, "models.json");
  const credential = { type: "oauth", access: "FIXTURE_CODEX_ACCESS", refresh: "FIXTURE_CODEX_REFRESH", expires: Date.now() + 3600000 };
  writeFileSync(auth, JSON.stringify({ [openAIProviderId]: credential, openai: { type: "api_key", key: "FIXTURE_LEGACY_KEY" } }));
  writeFileSync(config, JSON.stringify({ providers: { [openAIProviderId]: { headers: {}, axiomProxy: { mode: "external", url: "http://127.0.0.1:18511/" } } } }));
  const retired = join(root, "model-usage", "pi"); mkdirSync(retired, { recursive: true });
  const retiredAuth = join(retired, "auth.json"); writeFileSync(retiredAuth, "RETIRED_STORE_MUST_NOT_BE_PARSED");
  const original = [readFileSync(auth, "utf8"), readFileSync(config, "utf8"), readFileSync(retiredAuth, "utf8")];
  return { root, dir, auth, config, retiredAuth, credential, original,
    intact: () => assert.deepEqual([readFileSync(auth, "utf8"), readFileSync(config, "utf8"), readFileSync(retiredAuth, "utf8")], original),
    close: () => { if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); } };
}

test("Codex catalog and quota share the main model provider, storage and proxy; old direct credentials stay separate", async () => {
  const f = fixture(), calls: string[] = [];
  const network: typeof modelNetwork = async (root, dir, provider, path, operation) => {
    assert.equal(root, f.root); assert.equal(dir, f.dir); assert.equal(provider, openAIProviderId);
    const providers = JSON.parse(readFileSync(path, "utf8")).providers;
    assert.deepEqual(providers[provider].axiomProxy, { mode: "external", url: "http://127.0.0.1:18511/" });
    calls.push(operation);
    if (operation === "catalog") return { providerId: provider, models: [], message: "fixture native catalog" } as any;
    assert.equal(operation, "usage"); assert.equal(path, f.config);
    return { providerId: provider, status: "ready", metrics: [] } as any;
  };
  const models = new ModelService(f.root, network);
  try {
    const configuration = await models.read();
    const template = configuration.templates.find(provider => provider.id === openAIProviderId)!;
    assert.equal(template.name, "OpenAI"); assert.deepEqual(template.methods, ["oauth"]);
    const directory = await models.usageProviders();
    assert.deepEqual(directory.find(provider => provider.id === openAIProviderId), {
      id: openAIProviderId, name: "OpenAI", configured: true, query: "shared", revision: directory.find(provider => provider.id === openAIProviderId)!.revision,
    });
    await models.catalog(openAIProviderId, configuration.revision);
    assert.equal((await models.usage(openAIProviderId)).status, "ready");
    assert.deepEqual(calls, ["catalog", "usage"]); f.intact();
    const before = calls.length;
    writeFileSync(f.auth, JSON.stringify({ openai: { type: "api_key", key: "FIXTURE_LEGACY_KEY" } }));
    assert.equal((await models.usage(openAIProviderId)).status, "unavailable");
    assert.equal(calls.length, before, "missing main Codex credential must not use legacy/direct or retired usage auth");
    assert.equal(readFileSync(f.retiredAuth, "utf8"), f.original[2]);
  } finally { f.close(); }
});

test("quota RPC uses main models and rejects every retired login, account and scope route", { timeout: 20000 }, async () => {
  const f = fixture(), app = await startServer({ root: f.root, port: 0, dev: false });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  const calls: unknown[][] = [];
  app.agents.models.usage = async (...args) => { calls.push(args); return { providerId: String(args[0]), status: "ready", metrics: [] }; };
  const request = async (op: string, params = {}): Promise<Reply> => {
    const requestId = crypto.randomUUID();
    const pending = new Promise<Reply>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.off("message", receive); reject(Error(`Receipt timeout: ${op}`)); }, 5000);
      function receive(raw: Buffer) { const reply = JSON.parse(raw.toString()); if (reply.type === "receipt" && reply.requestId === requestId) { clearTimeout(timeout); ws.off("message", receive); resolve(reply); } }
      ws.on("message", receive);
    });
    ws.send(JSON.stringify({ requestId, op, params })); return pending;
  };
  try {
    await once(ws, "open");
    assert.equal((await request("usage.provider", { providerId: openAIProviderId, refresh: true })).ok, true);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], openAIProviderId); assert.equal(calls[0][1], true); assert.ok(calls[0][2] instanceof AbortSignal);
    const directory = await request("usage.providers"); assert.equal(directory.ok, true);
    assert.ok(JSON.stringify(directory).includes('"query":"shared"')); assert.equal(JSON.stringify(directory).includes("FIXTURE_"), false);
    for (const op of ["usage.account.get", "usage.account.proxy", "usage.account.logout", "usage.auth.start", "usage.auth.open", "usage.auth.answer", "usage.auth.cancel"]) {
      const reply = await request(op, { providerId: openAIProviderId, type: "oauth" });
      assert.equal(reply.ok, false); assert.equal(reply.error?.code, "UNKNOWN_OPERATION");
    }
    for (const scope of ["usage:account", "usage:authentication"]) {
      const reply = await request("subscribe", { scope }); assert.equal(reply.ok, false); assert.equal(reply.error?.code, "INVALID_SCOPE");
    }
    assert.equal("usageAccounts" in app, false); f.intact();
  } finally { ws.close(); await app.close(); f.close(); }
});
