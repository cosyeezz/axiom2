import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ModelService } from "../src/server/model-service.js";
import { UsageAccounts } from "../src/server/usage-accounts.js";
import { Logins } from "../src/server/auth.js";
import type { modelNetwork } from "../src/server/model-network.js";
import { usageProviderId } from "../src/shared/model-usage.js";
import type { AuthState } from "../src/shared/models.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-accounts-")), mainDir = join(root, "primary-pi");
  mkdirSync(mainDir);
  const mainAuth = join(mainDir, "auth.json"), mainConfig = join(mainDir, "models.json");
  writeFileSync(mainAuth, JSON.stringify({ openai: { type: "oauth", access: "PRIVATE_MODEL_ACCESS", refresh: "PRIVATE_MODEL_REFRESH", expires: Date.now() + 3600000 } }));
  writeFileSync(mainConfig, '{"providers":{"openai":{"headers":{}}}}');
  const before = [readFileSync(mainAuth, "utf8"), readFileSync(mainConfig, "utf8")];
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = mainDir;
  const main = new ModelService(root, null), events: { owner: object; state: AuthState }[] = [], calls: string[] = [];
  let usage!: UsageAccounts, changed = 0, opened = 0;
  const network: typeof modelNetwork = async (requestRoot, dir, provider, path, operation, payload = {}, callbacks = {}) => {
    assert.equal(requestRoot, root); assert.equal(dir, join(root, "model-usage", "pi")); assert.notEqual(dir, mainDir);
    assert.equal(path, join(dir, "models.json")); assert.equal(provider, usageProviderId); calls.push(operation);
    if (operation === "login") {
      assert.equal(payload.type, "oauth");
      callbacks.notify?.({ type: "auth_url", url: "https://fixture.invalid/authorize" });
      const answer = await callbacks.prompt!({ type: "manual_code", message: "Fixture code", signal: callbacks.signal });
      assert.equal(answer, "FIXTURE_CODE");
      writeFileSync(join(dir, "auth.json"), JSON.stringify({ [provider]: { type: "oauth", access: "PRIVATE_USAGE_ACCESS", refresh: "PRIVATE_USAGE_REFRESH", expires: Date.now() + 3600000 } }));
      return undefined as any;
    }
    if (operation === "logout") { writeFileSync(join(dir, "auth.json"), "{}"); return undefined as any; }
    assert.equal(operation, "usage");
    return { providerId: provider, status: "ready", updatedAt: Date.now(), metrics: [{ id: "points", kind: "balance", label: "剩余点数", balance: "12.5000" }] } as any;
  };
  usage = new UsageAccounts(root, main, (owner, state) => events.push({ owner, state }), async () => { changed++; }, {
    network, openBrowser: async () => { opened++; },
  });
  const intact = () => {
    assert.deepEqual([readFileSync(mainAuth, "utf8"), readFileSync(mainConfig, "utf8")], before);
    assert.equal(process.env.AXIOM_PI_DIR, mainDir);
  };
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 200 && !predicate(); i++) await delay(5); assert.ok(predicate()); };
  return { root, mainDir, mainAuth, main, usage, calls, events, intact, until, counts: () => ({ changed, opened }),
    close: async () => { await usage.close(); intact(); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); } };
}

test("Codex usage login/proxy/query/logout use independent storage without touching model auth or environment", async () => {
  const f = fixture(), owner = {};
  try {
    let state = await f.usage.state(); assert.equal(state.configured, false);
    assert.equal((await f.usage.query()).status, "unavailable"); assert.deepEqual(f.calls, []);
    const login = await f.usage.start(owner, usageProviderId, "oauth", state.revision, { mode: "external", url: "http://127.0.0.1:18511" });
    await f.until(() => !!f.usage.logins.get(owner, login.id).state.prompt);
    assert.throws(() => f.usage.logins.get({}, login.id), { code: "AUTH_SCOPE_MISMATCH" });
    assert.throws(() => f.usage.logins.open({}, login.id), { code: "AUTH_SCOPE_MISMATCH" });
    await assert.rejects(f.usage.logins.cancel({}, login.id), { code: "AUTH_SCOPE_MISMATCH" });
    await f.usage.logins.open(owner, login.id); assert.equal(f.counts().opened, 1);
    const prompt = f.usage.logins.get(owner, login.id).state.prompt!;
    f.usage.logins.answer(owner, login.id, prompt.id, "FIXTURE_CODE");
    await f.until(() => !f.usage.authActive);
    assert.equal(f.usage.logins.get(owner, login.id).state.status, "completed");
    state = await f.usage.state(); assert.equal(state.configured, true); assert.equal(state.expired, false);
    assert.deepEqual(state.proxy, { mode: "external", url: "http://127.0.0.1:18511/" });
    assert.equal(JSON.stringify([state, f.events]).includes("PRIVATE_"), false);
    assert.equal(f.counts().changed, 1);
    assert.equal((await f.usage.query()).status, "ready");
    assert.deepEqual(f.calls, ["login", "usage"]);
    f.intact();
    await assert.rejects(f.usage.logout(state.revision, "old-generation"), { code: "REVISION_CONFLICT" });
    assert.deepEqual(f.calls, ["login", "usage"]);
    const gone = await f.usage.logout(state.revision, state.generation);
    assert.equal(gone.configured, false); assert.notEqual(gone.generation, state.generation);
    assert.equal((await f.usage.query()).status, "unavailable", "no stale quota from the logged-out identity");
    assert.deepEqual(f.calls, ["login", "usage", "logout"]); f.intact();
  } finally { await f.close(); }
});

test("usage account enforces Codex/OAuth, shared auth admission, owner scope, cancellation and stale proxy revisions", async () => {
  const f = fixture(), owner = {};
  const primaryLogins = new Logins(f.main, () => {}, async () => {}, async () => {}, undefined,
    () => { if (f.usage.authActive) throw Object.assign(Error("Usage auth busy"), { code: "AUTH_BUSY" }); });
  try {
    const state = await f.usage.state();
    await assert.rejects(async () => f.usage.start(owner, "openai", "oauth", state.revision), { code: "AUTH_UNSUPPORTED" });
    await assert.rejects(async () => f.usage.start(owner, usageProviderId, "api_key", state.revision), { code: "AUTH_UNSUPPORTED" });
    f.main.authActive = true;
    await assert.rejects(f.usage.start(owner, usageProviderId, "oauth", state.revision), { code: "AUTH_BUSY" });
    assert.equal(f.usage.authActive, false); f.main.authActive = false;
    await assert.rejects(f.usage.configureProxy({ mode: "direct" }, "old-revision"), { code: "REVISION_CONFLICT" });
    const flow = await f.usage.start(owner, usageProviderId, "oauth", state.revision);
    await f.until(() => !!f.usage.logins.get(owner, flow.id).state.prompt);
    await assert.rejects(primaryLogins.start({}, "openai", "oauth", state.revision), { code: "AUTH_BUSY" });
    assert.equal(f.main.authActive, false);
    await assert.rejects(f.usage.configureProxy({ mode: "direct" }, state.revision), { code: "AUTH_BUSY" });
    f.usage.disconnect(owner);
    await f.until(() => !f.usage.authActive);
    assert.equal((await f.usage.state()).configured, false);
    assert.throws(() => f.usage.logins.get(owner, flow.id), { code: "AUTH_SCOPE_MISMATCH" });
    const other = {}, second = await f.usage.start(other, usageProviderId, "oauth", state.revision);
    await f.until(() => !!f.usage.logins.get(other, second.id).state.prompt);
    await f.usage.close(); assert.equal(f.usage.authActive, false);
    assert.equal((await f.usage.state()).configured, false); f.intact();
  } finally { await primaryLogins.close(); await f.close(); }
});

test("usage storage rejects reverse primary aliases even before the usage credential exists", async () => {
  const f = fixture(), original = readFileSync(f.mainAuth, "utf8");
  try {
    await f.usage.state();
    const target = join(f.usage.models.dir, "auth.json");
    rmSync(f.mainAuth); symlinkSync(target, f.mainAuth);
    await assert.rejects(f.usage.state(), { code: "USAGE_STORAGE_INVALID" });
    assert.throws(() => f.usage.start({}, usageProviderId, "oauth", "unused"), { code: "USAGE_STORAGE_INVALID" });
    writeFileSync(target, "{}");
    await assert.rejects(f.usage.state(), { code: "USAGE_STORAGE_INVALID" });
    await assert.rejects(f.usage.logout("unused", "unused"), { code: "USAGE_STORAGE_INVALID" });
    assert.deepEqual(f.calls, []);
  } finally { rmSync(f.mainAuth); writeFileSync(f.mainAuth, original); await f.close(); }
});

test("usage storage rejects symlink/hardlink credential aliases instead of reading or deleting primary auth", async () => {
  const f = fixture();
  try {
    await f.usage.state();
    const target = join(f.usage.models.dir, "auth.json");
    symlinkSync(f.mainAuth, target);
    await assert.rejects(f.usage.state(), { code: "USAGE_STORAGE_INVALID" });
    assert.throws(() => f.usage.query(), { code: "USAGE_STORAGE_INVALID" });
    rmSync(target); linkSync(f.mainAuth, target);
    await assert.rejects(f.usage.logout("any", "any"), { code: "USAGE_STORAGE_INVALID" });
    rmSync(target); rmSync(f.usage.models.dir, { recursive: true }); symlinkSync(f.mainDir, f.usage.models.dir);
    await assert.rejects(f.usage.state(), { code: "USAGE_STORAGE_INVALID" });
    assert.deepEqual(f.calls, []); f.intact();
  } finally { await f.close(); }
});
