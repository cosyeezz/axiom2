import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { hasQuotaRecord, type SessionAccountTarget } from "../src/shared/session-account-usage.js";
import type { ProviderUsage, ProviderUsageMetric as UsageMetric } from "../src/shared/provider-usage.js";
import { ProviderUsageService } from "../src/server/provider-usage.js";
import { ProviderUsageCache } from "../src/server/provider-usage-cache.js";
import { ModelService } from "../src/server/model-service.js";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { modelCredentialRevision, privateJson, readAccountIndex, accountDirectory } from "../src/server/model-account-storage.js";
import { proxyRuntimePath } from "../src/server/integrations/model-proxy-config.js";
import { dirname } from "node:path";

const provider = "openai-codex";
const oauth = (id: string) => ({ type: "oauth" as const, access: `FIXTURE_ACCESS_${id}`, refresh: `FIXTURE_REFRESH_${id}`, accountId: id, email: `${id.toLowerCase()}@example.test`, expires: Date.now() + 86400000 });
const ready = (balance = "0"): ProviderUsage => ({ providerId: provider, status: "ready", accountStatus: { state: "active", checkedAt: Date.now() }, updatedAt: Date.now(), metrics: [{ id: "balance", label: "剩余点数", kind: "balance", balance }] });
function files(root: string): Record<string, { bytes: string; mtime: number }> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath, entry.name); return [relative(root, path), { bytes: readFileSync(path).toString("base64"), mtime: statSync(path).mtimeMs }];
  }));
}
async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-session-quota-")), dir = join(root, "pi"); mkdirSync(dir);
  const env = ["AXIOM_PI_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER"];
  const previous = new Map(env.map(key => [key, process.env[key]])); for (const key of env) delete process.env[key];
  process.env.AXIOM_PI_DIR = dir;
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); });
  t.mock.method(globalThis, "fetch", async () => assert.fail("cache-only fixture cannot use network"));
  const models = new ModelService(root, null, dir); privateJson(join(dir, "models.json"), { providers: {} });
  let queries = 0;
  const accounts = new ModelAccountService(models, async (_root, directory, id) => {
    queries++; const credential = readStoredCredential(id, join(directory, "auth.json"));
    return ready(credential?.type === "oauth" && credential.accountId === "A" ? "11" : "22") as any;
  });
  const add = async (id: string) => {
    const staged = accounts.prepare(provider, { label: id }); await accounts.configure(staged);
    const credential = oauth(id); privateJson(join(staged.dir, "auth.json"), { [provider]: credential }); await accounts.commit(staged, "oauth");
    return { ...staged, credential };
  };
  const target = (accountId: string | null | undefined, credential = oauth("unused"), source: SessionAccountTarget["source"] = "execution"): SessionAccountTarget =>
    ({ providerId: provider, accountId, credentialKey: modelCredentialRevision(credential), source, identity: "fixture-request" });
  return { root, dir, models, accounts, add, target, queries: () => queries };
}

test("quota eligibility includes known zero only, rejects empty/unknown/invalid/future records", () => {
  const now = Date.now(), metric = (value: Partial<UsageMetric>) => ({ id: "fixture", label: "fixture", ...value } as UsageMetric);
  const valid = [metric({ kind: "window", usedPercent: 0 }), metric({ kind: "window", usedPercent: 100 }), metric({ kind: "tokens", remaining: 0 }),
    metric({ kind: "count", count: 0 }), metric({ kind: "balance", balance: "0.0000" }), metric({ kind: "balance", balance: "-1e-99" }),
    metric({ kind: "balance", balance: null, hasCredits: false }), metric({ kind: "balance", balance: null, unlimited: true })];
  const invalid = [metric({ kind: "window", usedPercent: null }), metric({ kind: "window", usedPercent: 101 }), metric({ kind: "tokens", remaining: null }),
    metric({ kind: "count", count: .5 }), metric({ kind: "balance", balance: null, hasCredits: true }), metric({ kind: "balance", balance: "NaN" })];
  for (const value of valid) assert.equal(hasQuotaRecord({ ...ready(), metrics: [value], updatedAt: now }, now), true);
  for (const value of invalid) assert.equal(hasQuotaRecord({ ...ready(), metrics: [value], updatedAt: now }, now), false);
  for (const value of [{ ...ready(), metrics: [] }, { ...ready(), updatedAt: undefined }, { ...ready(), updatedAt: now + 1 }, { ...ready(), updatedAt: 0 }, { ...ready(), status: "unsupported" as const }]) assert.equal(hasQuotaRecord(value, now), false);
});

test("peek reads memory/disk, marks overdue records stale, and never queries or writes on miss or hit", async t => {
  const f = await fixture(t); privateJson(join(f.dir, "auth.json"), { [provider]: oauth("A") });
  let now = Date.now(), queries = 0; t.mock.method(Date, "now", () => now); t.mock.method(Math, "random", () => 0);
  const query = async () => { queries++; return ready(); }, service = new ProviderUsageService(f.root, f.dir, query);
  const empty = files(f.root); assert.equal(service.peekCached(provider), undefined); assert.deepEqual(files(f.root), empty); assert.equal(queries, 0);
  const saved = await service.read(provider), before = files(f.root);
  assert.equal(service.peekCached(provider)?.metrics[0].kind, "balance");
  assert.deepEqual(new ProviderUsageService(f.root, f.dir, query).peekCached(provider), service.peekCached(provider));
  now = saved.nextRefreshAt! + 1; assert.equal(service.peekCached(provider)?.stale, true);
  for (let n = 0; n < 3; n++) service.peekCached(provider);
  assert.equal(queries, 1); assert.deepEqual(files(f.root), before);
});

test("credential/config/proxy changes and expiry hide cache without deleting or rewriting it", async t => {
  const f = await fixture(t), auth = join(f.dir, "auth.json"), credential = oauth("A"); privateJson(auth, { [provider]: credential });
  let calls = 0; const service = new ProviderUsageService(f.root, f.dir, async () => { calls++; return ready(); }); await service.read(provider);
  const cache = () => Object.fromEntries(Object.entries(files(f.root)).filter(([path]) => path.startsWith("model-usage-cache/"))), original = cache();
  for (const replacement of [oauth("B"), { ...credential, expires: 1 }, { ...credential, scopes: ["chatgpt.tokens.use.direct"] }]) {
    privateJson(auth, { [provider]: replacement }); assert.equal(service.peekCached(provider), undefined); assert.deepEqual(cache(), original);
  }
  privateJson(auth, { [provider]: credential }); privateJson(join(f.dir, "models.json"), { providers: { [provider]: { headers: {} } } });
  assert.equal(service.peekCached(provider), undefined); assert.deepEqual(cache(), original);
  privateJson(join(f.dir, "models.json"), { providers: {} });
  const proxy = proxyRuntimePath(f.root); mkdirSync(dirname(proxy), { recursive: true }); privateJson(proxy, { fixtureProxyRevision: 1 });
  assert.equal(service.peekCached(provider), undefined); assert.deepEqual(cache(), original); assert.equal(calls, 1);
});

test("peek rejects a credential overwritten during its disk read and checks the caller's expected revision", async t => {
  const f = await fixture(t), auth = join(f.dir, "auth.json"), a = oauth("A"), b = oauth("B"); privateJson(auth, { [provider]: a });
  const service = new ProviderUsageService(f.root, f.dir, async () => ready()); await service.read(provider);
  const fresh = new ProviderUsageService(f.root, f.dir, async () => assert.fail("peek must not query"));
  const read = ProviderUsageCache.prototype.read; let reads = 0;
  t.mock.method(ProviderUsageCache.prototype, "read", function (this: ProviderUsageCache, ...args: Parameters<typeof read>) {
    reads++; const record = read.apply(this, args); privateJson(auth, { [provider]: b }); return record;
  });
  assert.equal(fresh.peekCached(provider, modelCredentialRevision(a)), undefined); assert.equal(reads, 1);
  assert.equal(fresh.peekCached(provider, modelCredentialRevision(a)), undefined); assert.equal(reads, 1, "expected revision fails before cache access");
});

test("running A ignores global B, idle names next default B, zero cache qualifies and public projection excludes proof/secrets", async t => {
  const f = await fixture(t), a = await f.add("A"), b = await f.add("B");
  await f.accounts.usage(a.id, false); await f.accounts.usage(b.id, false);
  await f.accounts.activate(b.id, (await f.accounts.list()).revision); const before = files(f.root);
  const running = f.accounts.cachedBinding(f.target(a.id, a.credential))!, idle = f.accounts.cachedBinding(f.target(undefined, b.credential, "next-execution"))!;
  assert.equal(running.account.label, "A"); assert.equal((running.usage.metrics[0] as any).balance, "11"); assert.equal(running.source, "execution");
  assert.equal(idle.account.label, "B"); assert.equal((idle.usage.metrics[0] as any).balance, "22"); assert.equal(idle.source, "next-execution");
  assert.doesNotMatch(JSON.stringify(running), /FIXTURE_|credentialKey|accountId|AXIOM_|refresh|Bearer/);
  assert.equal(f.accounts.cachedBinding({ ...f.target(a.id, a.credential), credentialKey: undefined }), null);
  assert.equal(f.queries(), 2); assert.deepEqual(files(f.root), before);
});

test("cached binding cannot switch to a freshly cached replacement credential between metadata and peek", async t => {
  const f = await fixture(t), a = await f.add("A"), auth = join(a.dir, "auth.json"), b = oauth("B");
  privateJson(auth, { [provider]: b }); await f.accounts.usage(a.id, false); privateJson(auth, { [provider]: a.credential });
  const peek = ProviderUsageService.prototype.peekCached;
  t.mock.method(ProviderUsageService.prototype, "peekCached", function (this: ProviderUsageService, ...args: Parameters<typeof peek>) {
    privateJson(auth, { [provider]: b }); return peek.apply(this, args);
  });
  const fresh = new ModelAccountService(f.models, async () => assert.fail("cached binding cannot query"));
  assert.equal(fresh.cachedBinding(f.target(a.id, a.credential)), null); assert.equal(f.queries(), 1);
});

test("legacy/root fallback is exact-identity and read-only; no legacy index is imported", async t => {
  const f = await fixture(t), credential = oauth("LEGACY"); privateJson(join(f.dir, "auth.json"), { [provider]: credential });
  const service = new ProviderUsageService(f.root, f.dir, async () => ready("0"), join(f.dir, "models.json"), true); await service.read(provider);
  const before = files(f.root), value = f.accounts.cachedBinding(f.target(null, credential))!;
  assert.equal(value.account.label, "原有账号"); assert.equal(value.account.id, undefined); assert.equal((value.usage.metrics[0] as any).balance, "0");
  assert.deepEqual(readAccountIndex(f.dir).accounts, []); assert.deepEqual(files(f.root), before);
  const a = await f.add("A"), direct = new ProviderUsageService(f.root, a.dir, async () => ready("7"), join(f.dir, "models.json"), true, { cacheDir: f.dir }); await direct.read(provider);
  const fresh = new ModelAccountService(f.models, async () => assert.fail("cache fallback cannot query"));
  assert.equal((fresh.cachedBinding(f.target(a.id, a.credential))!.usage.metrics[0] as any).balance, "7");
  assert.equal(fresh.cachedBinding(f.target(null, credential)), null, "root record for A is never lent to legacy");
  assert.equal(accountDirectory(f.dir, a.id), a.dir);
});

test("custom auth, endpoint, API or header configuration conservatively hides the optional shortcut", async t => {
  const f = await fixture(t), a = await f.add("A"); await f.accounts.usage(a.id, false);
  for (const override of [{ apiKey: "FIXTURE_OTHER" }, { baseUrl: "https://fixture.invalid" }, { api: "openai-completions" }, { oauth: "radius" }, { authHeader: true }, { headers: { Authorization: "FIXTURE_OTHER" } },
    { modelOverrides: { ["fixture"]: { headers: { "chatgpt-account-id": "OTHER" } } } }]) {
    privateJson(join(f.dir, "models.json"), { providers: { [provider]: override } }); assert.equal(f.accounts.cachedBinding(f.target(a.id, a.credential)), null);
  }
  assert.equal(f.queries(), 1);
});
