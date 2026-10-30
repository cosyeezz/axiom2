import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, linkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CredentialSynchronizationError, readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { Credential, AuthPrompt } from "@earendil-works/pi-ai";
import { kiroLoginPrompt } from "../src/server/model-account-info.js";
import { ModelService } from "../src/server/model-service.js";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { accountBindings, accountDirectory, accountRuntimeStores, privateJson, readAccountIndex, selectedAuthPath } from "../src/server/model-account-storage.js";
import { credentialMetadata } from "../src/server/model-metadata.js";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { ExecutionProfiles } from "../src/server/execution-profile.js";
import { organizerConfigurationKey } from "../src/server/memory-runner.js";
import { configuration } from "../src/server/models.js";
import { Logins } from "../src/server/auth.js";
import { modelNetwork, closeModelNetworks } from "../src/server/model-network.js";

const oauth = (name: string) => ({ type: "oauth" as const, access: `FIXTURE_${name}_ACCESS`, refresh: `FIXTURE_${name}_REFRESH`, expires: Date.now() + 3600000, accountId: name, region: "us-east", nested: { intact: true } });
async function fixture(run: (models: ModelService, accounts: ModelAccountService, root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "axiom-accounts-unit-"));
  // This suite exercises the mutable backend selection, not the parent agent's captured profile.
  const environment = ["AXIOM_PI_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER"];
  const previous = new Map(environment.map(key => [key, process.env[key]]));
  for (const key of environment) delete process.env[key];
  const models = new ModelService(root), accounts = new ModelAccountService(models);
  await models.raw();
  try { await run(models, accounts, root); }
  finally { await closeModelNetworks(root); for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); }
}
async function add(accounts: ModelAccountService, provider: string, label: string, credential: Credential) {
  const staged = accounts.prepare(provider, { label, region: "EU" });
  await accounts.configure(staged);
  privateJson(join(staged.dir, "auth.json"), { [provider]: credential });
  await accounts.commit(staged, credential.type);
  accounts.discard(staged); // registered entries must never be removed by cleanup
  return staged;
}
async function choose(accounts: ModelAccountService, id: string) { return accounts.activate(id, (await accounts.list()).revision); }
async function until(check: () => boolean) { for (let n = 0; n < 400 && !check(); n++) await delay(10); assert.ok(check(), "fixture must settle"); }

test("account cards preserve legacy, add without activating, select per provider and bind rotation to its original store", () => fixture(async (models, accounts) => {
  const auth = join(models.dir, "auth.json"), legacy = { openai: oauth("LEGACY"), anthropic: { type: "api_key", key: "FIXTURE_ANTHROPIC" } };
  privateJson(auth, legacy);
  const original = readFileSync(auth, "utf8"), initial = await accounts.list();
  assert.equal(initial.accounts.length, 2); assert.ok(initial.accounts.every(row => row.active));
  assert.ok(!JSON.stringify(initial).includes("FIXTURE_"));
  const a = await add(accounts, "openai", "账号 A", oauth("A")), b = await add(accounts, "openai", "账号 B", oauth("B"));
  assert.equal((await accounts.list()).accounts.find(row => row.id === a.id)!.active, false);
  assert.equal(readFileSync(auth, "utf8"), original);
  const selected = await choose(accounts, a.id);
  assert.equal(selected.accounts.find(row => row.providerId === "anthropic")!.active, true);
  await assert.rejects(accounts.activate(b.id, initial.revision), { code: "REVISION_CONFLICT" });
  const stores = (await accountRuntimeStores(auth, join(models.dir, "models-store.json")))!;
  await choose(accounts, b.id);
  await stores.credentials.modify("openai", async credential => ({ ...credential!, access: "FIXTURE_A_ROTATED" } as Credential));
  assert.equal((readStoredCredential("openai", join(a.dir, "auth.json")) as ReturnType<typeof oauth>).access, "FIXTURE_A_ROTATED");
  assert.equal((readStoredCredential("openai", join(b.dir, "auth.json")) as ReturnType<typeof oauth>).access, "FIXTURE_B_ACCESS");
  assert.deepEqual((readStoredCredential("openai", join(a.dir, "auth.json")) as ReturnType<typeof oauth>).nested, { intact: true });
  assert.equal(readFileSync(auth, "utf8"), original);
  await stores.modelsStore.write("openai", { models: [], lastChecked: 1 } as any);
  assert.ok(existsSync(join(a.dir, "models-store.json"))); assert.ok(!existsSync(join(b.dir, "models-store.json")));
  const oldLegacy = selected.accounts.find(row => row.providerId === "openai" && row.legacy)!;
  await choose(accounts, oldLegacy.id); assert.deepEqual(accountBindings(models.dir), {});
  assert.equal(readFileSync(auth, "utf8"), original);
}));

test("metadata and model discovery use only active independent credentials without creating auth/cache files", () => fixture(async (models, accounts, root) => {
  const staged = await add(accounts, "openai", "新账号", oauth("ONLY"));
  await choose(accounts, staged.id);
  const before = readdirSync(staged.dir), auth = join(models.dir, "auth.json");
  const metadata = credentialMetadata(auth);
  assert.deepEqual(await metadata.list(), [{ providerId: "openai", type: "oauth" }]);
  await assert.rejects(metadata.modify("openai", async () => undefined), /read-only/);
  const runtime = await createModelRuntime({ authPath: auth, modelsPath: join(models.dir, "models.json"), modelsStorePath: join(models.dir, "models-store.json"), metadataOnly: true });
  assert.ok(runtime.getModels("openai").length > 0);
  const config = await configuration(root);
  assert.ok(config.available.some(row => row.provider === "openai"), "only-new-account provider must enter the directory");
  assert.deepEqual(readdirSync(staged.dir), before);
  assert.equal(existsSync(auth), false);
}));

test("usage reads the requested account including legacy rather than the active pointer and keeps caches isolated", () => fixture(async (models, original, root) => {
  privateJson(join(models.dir, "auth.json"), { openai: oauth("LEGACY") });
  const a = await add(original, "openai", "A", oauth("A")), b = await add(original, "openai", "B", oauth("B"));
  const queried: string[] = [];
  const accounts = new ModelAccountService(models, async (_root, dir, provider, _path, op, payload) => {
    assert.equal(op, "usage"); assert.equal(payload?.accountDirect, true);
    const credential = readStoredCredential(provider, join(dir, "auth.json")) as ReturnType<typeof oauth>;
    queried.push(credential.accountId);
    return { providerId: provider, status: "ready", metrics: [{ id: "balance", label: "余额", kind: "balance", balance: credential.accountId === "A" ? "11" : "22" }], updatedAt: Date.now() } as any;
  });
  const legacy = (await accounts.list()).accounts.find(row => row.legacy)!;
  await choose(accounts, b.id);
  const result = await accounts.usage(a.id, false), legacyResult = await accounts.usage(legacy.id, false);
  assert.equal((result.metrics[0] as any).balance, "11"); assert.equal(legacyResult.status, "ready");
  assert.deepEqual(queried, ["A", "LEGACY"]);
  assert.ok(result.nextRefreshAt! - Date.now() >= 59000 && result.nextRefreshAt! - Date.now() <= 70000);
  assert.equal(readdirSync(join(root, "model-usage-cache")).length, 2);
}));

test("stored account keys override legacy inline keys and normalize without touching other account credentials", () => fixture(async (models, accounts) => {
  privateJson(join(models.dir, "models.json"), { providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKey: "FIXTURE_INLINE_OLD", models: [] } } });
  const staged = await add(accounts, "fixture", "API account", { type: "api_key", key: "FIXTURE_SELECTED_KEY", env: { FIXTURE_ENV: "preserved" } });
  await choose(accounts, staged.id);
  const runtime = await models.runtime();
  assert.equal((await runtime.getAuth("fixture"))?.auth.apiKey, "FIXTURE_SELECTED_KEY");
  await models.read({ normalizeCredentials: true });
  assert.equal(Object.hasOwn(JSON.parse(await models.raw()).providers.fixture, "apiKey"), false);
  assert.deepEqual(readStoredCredential("fixture", join(staged.dir, "auth.json")), { type: "api_key", key: "FIXTURE_SELECTED_KEY", env: { FIXTURE_ENV: "preserved" } });
}));

test("unsafe account paths, hard-linked credentials, corrupt and dangling indexes fail closed without overwriting", () => fixture(async (models, accounts, root) => {
  const folder = join(models.dir, "model-accounts"), outside = join(root, "outside"); mkdirSync(outside);
  symlinkSync(outside, folder); assert.throws(() => readAccountIndex(models.dir), { code: "ACCOUNT_STORAGE_INVALID" });
  assert.throws(() => accounts.prepare("openai", { label: "unsafe" }), { code: "ACCOUNT_STORAGE_INVALID" });
  rmSync(folder); mkdirSync(folder); const index = join(folder, "index.json");
  symlinkSync(join(root, "absent"), index); assert.throws(() => readAccountIndex(models.dir), { code: "ACCOUNT_STORAGE_INVALID" }); rmSync(index);
  writeFileSync(index, "{broken"); await assert.rejects(accounts.list(), { code: "ACCOUNT_STORAGE_INVALID" }); assert.equal(readFileSync(index, "utf8"), "{broken"); rmSync(index);
  const staged = await add(accounts, "openai", "safe", oauth("SAFE")), auth = join(staged.dir, "auth.json");
  linkSync(auth, join(root, "hardlink")); assert.throws(() => accountDirectory(models.dir, staged.id), { code: "ACCOUNT_STORAGE_INVALID" }); rmSync(join(root, "hardlink"));
  rmSync(auth); symlinkSync(join(root, "absent"), auth); assert.throws(() => selectedAuthPath("openai", join(models.dir, "auth.json"), { openai: staged.id }), { code: "ACCOUNT_STORAGE_INVALID" });
}));

test("execution profiles and organizer recovery keys change with account selection, captured mappings remain fixed", () => fixture(async (models, accounts, root) => {
  const a = await add(accounts, "openai", "A", oauth("A")), b = await add(accounts, "openai", "B", oauth("B"));
  const profiles = new ExecutionProfiles(root), selection = { provider: "openai", id: "gpt-5.4", thinking: "off" as const };
  await choose(accounts, a.id); const key = organizerConfigurationKey(models.dir, selection);
  const input = { entry: "memory" as const, cwd: root, modelDir: models.dir, modelsRaw: await models.raw(), selection, mode: "D" as const };
  const first = profiles.prepare(input);
  await choose(accounts, b.id); const second = profiles.prepare(input);
  assert.notEqual(first.profileHash, second.profileHash);
  assert.notEqual(key, organizerConfigurationKey(models.dir, selection));
  assert.equal(JSON.parse(first.env.AXIOM_MODEL_ACCOUNT_BINDINGS!).openai, a.id);
  assert.equal(JSON.parse(second.env.AXIOM_MODEL_ACCOUNT_BINDINGS!).openai, b.id);
  first.release(); second.release();
}));

test("new login isolation, normal login replacement, failure and cancellation cleanup work across real worker IPC", { timeout: 60000 }, () => fixture(async (models, accounts, root) => {
  // Generic API login and fixed local definitions never contact a paid model or OAuth service.
  privateJson(join(models.dir, "models.json"), { providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture-model", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 4096, maxTokens: 1024 }] } } });
  privateJson(join(models.dir, "auth.json"), { fixture: { type: "api_key", key: "FIXTURE_LEGACY_KEY" } });
  const original = readFileSync(join(models.dir, "auth.json"), "utf8"), owner = {};
  const logins = new Logins(models, () => {}, async () => {}, async () => {}, modelNetwork, accounts);
  try {
    const revision = (await models.load()).revision;
    const first = await logins.start(owner, "fixture", "api_key", revision, undefined, { label: "独立 API" });
    await until(() => !!logins.get(owner, first.id).state.prompt);
    logins.answer(owner, first.id, logins.get(owner, first.id).state.prompt!.id, "FIXTURE_NEW_KEY");
    await until(() => !models.authActive);
    assert.equal(logins.get(owner, first.id).state.status, "completed");
    const list = await accounts.list(), independent = list.accounts.find(row => !row.legacy)!;
    assert.equal(list.accounts.length, 2); assert.equal(independent.active, false); assert.equal(readFileSync(join(models.dir, "auth.json"), "utf8"), original);
    assert.equal(statSync(join(accountDirectory(models.dir, independent.id), "auth.json")).mode & 0o077, 0);
    await choose(accounts, independent.id);
    const replaced = await logins.start(owner, "fixture", "api_key", (await models.load()).revision);
    await until(() => !!logins.get(owner, replaced.id).state.prompt);
    logins.answer(owner, replaced.id, logins.get(owner, replaced.id).state.prompt!.id, "FIXTURE_REPLACED_KEY");
    await until(() => !models.authActive); assert.equal(logins.get(owner, replaced.id).state.status, "completed");
    assert.equal((readStoredCredential("fixture", join(accountDirectory(models.dir, independent.id), "auth.json")) as any).key, "FIXTURE_REPLACED_KEY");
    assert.equal(readFileSync(join(models.dir, "auth.json"), "utf8"), original);
    const cancel = await logins.start(owner, "fixture", "api_key", (await models.load()).revision, undefined, { label: "cancel" });
    await until(() => !!logins.get(owner, cancel.id).state.prompt); logins.cancel(owner, cancel.id); await until(() => !models.authActive);
    assert.equal((await accounts.list()).accounts.length, 2);
    assert.equal(readdirSync(join(models.dir, "model-accounts")).filter(name => name !== "index.json").length, 1);
    // Real IPC must return a receipt, not the key returned by Pi runtime.login.
    const staged = accounts.prepare("fixture", { label: "IPC" }); await accounts.configure(staged);
    const receipt = await modelNetwork(root, staged.dir, "fixture", join(staged.dir, "models.json"), "login", { type: "api_key" }, { prompt: async () => "FIXTURE_IPC_KEY" });
    assert.deepEqual(receipt, { saved: true });
    assert.throws(() => accounts.discard(staged), { code: "ACCOUNT_RECOVERY_REQUIRED" });
    assert.ok(existsSync(join(staged.dir, "auth.json")), "unregistered committed credentials must survive cleanup");
    const failedNetwork: typeof modelNetwork = async () => { throw Error("fixture failure"); };
    const failing = new Logins(models, () => {}, async () => {}, async () => {}, failedNetwork, accounts);
    const failed = await failing.start(owner, "fixture", "api_key", (await models.load()).revision, undefined, { label: "failure" });
    await until(() => !models.authActive); assert.equal(failing.get(owner, failed.id).state.status, "failed"); await failing.close();
    assert.equal((await accounts.list()).accounts.length, 2);
  } finally { await logins.close(); }
}));

test("first successful provider login is usable; later additions preserve selection and share edited model definitions", { timeout: 60000 }, () => fixture(async (models, accounts) => {
  const path = join(models.dir, "models.json"), provider = { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "shared-first", name: "Shared first", reasoning: false, input: ["text"], contextWindow: 4096, maxTokens: 1024 }] };
  privateJson(path, { providers: { fresh: provider } });
  const owner = {}, logins = new Logins(models, () => {}, async () => {}, async () => {}, modelNetwork, accounts);
  const login = async (label: string, key: string) => {
    const flow = await logins.start(owner, "fresh", "api_key", (await models.load()).revision, undefined, { label });
    await until(() => !!logins.get(owner, flow.id).state.prompt);
    logins.answer(owner, flow.id, logins.get(owner, flow.id).state.prompt!.id, key);
    await until(() => !models.authActive);
    assert.equal(logins.get(owner, flow.id).state.status, "completed");
    return (await accounts.list()).accounts.find(row => row.label === label)!;
  };
  try {
    const first = await login("first", "FIXTURE_FIRST_KEY");
    assert.equal(first.active, true);
    assert.equal((await (await models.runtime()).getAuth("fresh"))?.auth.apiKey, "FIXTURE_FIRST_KEY");
    const second = await login("second", "FIXTURE_SECOND_KEY");
    assert.equal(second.active, false);
    assert.equal((await accounts.list()).accounts.find(row => row.id === first.id)!.active, true);
    // Configure snapshots are not long-lived per-account model definitions.
    assert.equal(JSON.parse(readFileSync(join(accountDirectory(models.dir, first.id), "models.json"), "utf8")).providers.fresh.models[0].id, "shared-first");
    privateJson(path, { providers: { fresh: { ...provider, models: [{ ...provider.models[0], id: "shared-edited", name: "Shared edited" }] } } });
    for (const row of [first, second]) {
      await choose(accounts, row.id);
      const runtime = await models.runtime();
      assert.deepEqual(runtime.getModels("fresh").map(model => model.id), ["shared-edited"]);
      assert.equal((await models.read()).providers.find(p => p.providerId === "fresh")!.models[0].id, "shared-edited");
      assert.equal((await runtime.getAuth("fresh"))?.auth.apiKey, row.id === first.id ? "FIXTURE_FIRST_KEY" : "FIXTURE_SECOND_KEY");
    }
    const legacyAuth = join(models.dir, "auth.json");
    assert.equal(existsSync(legacyAuth) ? JSON.parse(readFileSync(legacyAuth, "utf8")).fresh : undefined, undefined, "no credential is mirrored into the legacy store");
  } finally { await logins.close(); }
}));

test("Logins publishes only selected Kiro non-secret preferences as editable prompt defaults", () => fixture(async (models, accounts) => {
  const credential = { ...oauth("KIRO"), authMethod: "identity-center", startUrl: "https://org.awsapps.com/start", authRegion: "eu-west-1", authFlow: "device", clientSecret: "FIXTURE_PRIVATE_CLIENT" };
  privateJson(join(models.dir, "auth.json"), { kiro: { ...credential, authRegion: "us-west-2" } });
  const selected = await add(accounts, "kiro", "selected", credential); await choose(accounts, selected.id);
  const prompts: [AuthPrompt, string | undefined, string][] = [
    [kiroLoginPrompt("method", { type: "select", message: "method", options: [{ id: "identity-center", label: "Enterprise" }] }), "identity-center", "identity-center"],
    [kiroLoginPrompt("startUrl", { type: "text", message: "start URL" }), credential.startUrl, credential.startUrl],
    [kiroLoginPrompt("authRegion", { type: "text", message: "region" }), "eu-west-1", "eu-west-1"],
    [kiroLoginPrompt("flow", { type: "select", message: "flow", options: [{ id: "device", label: "Device" }] }), "device", "device"],
    [kiroLoginPrompt("startUrl", { type: "secret", message: "secret" }), undefined, "FIXTURE_NEW_SECRET"],
    [{ type: "text", message: "not an app preference" }, undefined, "answer"],
  ];
  const owner = {}, network: typeof modelNetwork = async (_root, dir, provider, _path, _op, _payload, callbacks) => {
    for (const [prompt, , answer] of prompts) assert.equal(await callbacks!.prompt!(prompt), answer);
    privateJson(join(dir, "auth.json"), { [provider]: credential }); return { saved: true } as any;
  };
  const logins = new Logins(models, () => {}, async () => {}, async () => {}, network, accounts);
  try {
    const flow = await logins.start(owner, "kiro", "oauth", (await models.load()).revision, undefined, { label: "added" });
    for (const [prompt, defaultValue, answer] of prompts) {
      await until(() => logins.get(owner, flow.id).state.prompt?.message === prompt.message);
      const state = logins.get(owner, flow.id).state;
      assert.equal(state.prompt!.defaultValue, defaultValue);
      assert.ok(!JSON.stringify(state).includes("FIXTURE_"), "published state must not contain saved secrets");
      logins.answer(owner, flow.id, state.prompt!.id, answer);
    }
    await until(() => !models.authActive);
    assert.equal(logins.get(owner, flow.id).state.status, "completed");
    assert.equal((await accounts.list()).accounts.find(row => row.id === selected.id)!.active, true);
  } finally { await logins.close(); }
}));

test("credentials committed before synchronization failure, cancellation or disconnect survive and register without activation", () => fixture(async (models, accounts) => {
  for (const mode of ["sync", "cancel", "disconnect"]) {
    const owner = {};
    let saved = false;
    const network: typeof modelNetwork = async (_root, dir, provider, _path, _op, _payload, callbacks) => {
      privateJson(join(dir, "auth.json"), { [provider]: oauth(`SAVED_${mode}`) }); saved = true;
      if (mode === "sync") throw new CredentialSynchronizationError(provider, "login", undefined, {});
      await new Promise<void>(resolve => callbacks?.signal?.addEventListener("abort", () => resolve(), { once: true }));
      throw Error("fixture cancellation after credential commit");
    };
    const logins = new Logins(models, () => {}, async () => {}, async () => {}, network, accounts);
    try {
      const flow = await logins.start(owner, "openai", "oauth", (await models.load()).revision, undefined, { label: mode });
      await until(() => saved);
      if (mode === "cancel") await logins.cancel(owner, flow.id);
      if (mode === "disconnect") logins.disconnect(owner);
      await until(() => !models.authActive);
      const row = (await accounts.list()).accounts.find(row => row.label === mode)!;
      assert.ok(row && !row.active, "saved account must be registered without changing selection");
      assert.equal((readStoredCredential("openai", join(accountDirectory(models.dir, row.id), "auth.json")) as any).access, `FIXTURE_SAVED_${mode}_ACCESS`);
      if (mode !== "disconnect") {
        assert.equal(logins.get(owner, flow.id).state.status, "failed", "do not claim catalog synchronization succeeded");
        assert.match(logins.get(owner, flow.id).state.message, /保存为独立账号/);
      }
    } finally { await logins.close(); }
  }
  assert.equal((await accounts.list()).accounts.length, 3);
}));

test("index corruption after credential commit releases authActive and preserves an account recoverable after index repair", () => fixture(async (models, accounts) => {
  const owner = {};
  let savedDir = "";
  const network: typeof modelNetwork = async (_root, dir, provider) => {
    savedDir = dir;
    privateJson(join(dir, "auth.json"), { [provider]: oauth("RECOVER_INDEX") });
    writeFileSync(join(models.dir, "model-accounts", "index.json"), "{broken");
    throw Error("fixture failure after credential commit");
  };
  const logins = new Logins(models, () => {}, async () => {}, async () => {}, network, accounts);
  try {
    const flow = await logins.start(owner, "openai", "oauth", (await models.load()).revision, undefined, { label: "recoverable" });
    await until(() => !models.authActive);
    assert.equal(logins.get(owner, flow.id).state.status, "failed");
    assert.ok(logins.get(owner, flow.id).state.message.includes("清理失败"));
    assert.equal(readFileSync(join(models.dir, "model-accounts", "index.json"), "utf8"), "{broken");
    assert.equal((readStoredCredential("openai", join(savedDir, "auth.json")) as any).access, "FIXTURE_RECOVER_INDEX_ACCESS");
    // A maintainer can re-register preserved credentials once the index is repaired.
    rmSync(join(models.dir, "model-accounts", "index.json"));
    const staged = { id: basename(savedDir) as ReturnType<ModelAccountService["prepare"]>["id"], dir: savedDir, providerId: "openai", draft: { label: "recoverable", region: "" } };
    assert.equal(await accounts.recover(staged, "oauth"), true);
    assert.equal(await accounts.recover(staged, "oauth"), true, "recovery is idempotent");
    const list = await accounts.list();
    assert.equal(list.accounts.length, 1); assert.equal(list.accounts[0].active, false);
  } finally { await logins.close(); }
}));
