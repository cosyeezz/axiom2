import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { ProviderUsageService } from "../src/server/provider-usage.js";
import { ProviderUsageCache } from "../src/server/provider-usage-cache.js";
import { proxyRuntimePath } from "../src/server/integrations/model-proxy-config.js";
import { usageRefreshMinimum, usageRefreshJitter, type ProviderUsage } from "../src/shared/provider-usage.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-usage-cache-")), dir = join(root, "pi"); mkdirSync(dir);
  const credential = { type: "oauth", access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", accountId: "PRIVATE_ACCOUNT", expires: Date.now() + 86400000 };
  const auth = join(dir, "auth.json"), models = join(dir, "models.json");
  writeFileSync(auth, JSON.stringify({ openai: credential })); writeFileSync(models, '{"providers":{}}');
  return { root, dir, auth, models, credential, close: () => rmSync(root, { recursive: true, force: true }) };
}
const ready = (): ProviderUsage => ({ providerId: "openai", status: "ready", accountStatus: { state: "active", checkedAt: Date.now() }, updatedAt: Date.now(), metrics: [{ id: "balance", label: "剩余点数", kind: "balance", balance: "1.2500" }] });
const cacheFiles = (root: string) => { const base = join(root, "model-usage-cache"); return readdirSync(base).flatMap(name => readdirSync(join(base, name)).map(file => join(base, name, file))).filter(path => path.endsWith(".json")); };
const cachedFile = (root: string) => cacheFiles(root)[0]!;

test("automatic deadlines include both random boundaries, are stable on cached reads and survive service reconstruction", async t => {
  for (const [random, jitter] of [[0, 0], [1 - Number.EPSILON, usageRefreshJitter]] as const) {
    const f = fixture(); t.after(f.close); let now = Date.now(), calls = 0, samples = 0;
    t.mock.method(Date, "now", () => now); t.mock.method(Math, "random", () => { samples++; return random; });
    const query = async () => { calls++; return ready(); };
    const service = new ProviderUsageService(f.root, f.dir, query), initial = await service.read("openai");
    assert.equal(initial.nextRefreshAt, now + usageRefreshMinimum + jitter); assert.equal(samples, 1);
    now = initial.nextRefreshAt! - 1;
    assert.deepEqual(await service.read("openai"), initial); assert.equal(calls, 1); assert.equal(samples, 1);
    const restored = new ProviderUsageService(f.root, f.dir, query);
    assert.deepEqual(await restored.read("openai"), initial); assert.equal(calls, 1); assert.equal(samples, 1);
    now++;
    const [a, b] = await Promise.all([restored.read("openai"), restored.read("openai")]);
    assert.deepEqual(a, b); assert.equal(calls, 2); assert.equal(samples, 2);
    assert.equal(a.nextRefreshAt, now + usageRefreshMinimum + jitter);
    t.mock.restoreAll();
  }
});

test("manual refresh retains the five second guard, resets the automatic deadline and does not turn normal reads into force", async t => {
  const f = fixture(); t.after(f.close); let now = Date.now(), calls = 0;
  t.mock.method(Date, "now", () => now); t.mock.method(Math, "random", () => 0);
  const service = new ProviderUsageService(f.root, f.dir, async () => { calls++; return ready(); });
  const initial = await service.read("openai"); now += 4999;
  assert.deepEqual(await service.read("openai", true), initial); assert.equal(calls, 1);
  now++;
  const manual = await service.read("openai", true); assert.equal(calls, 2); assert.equal(manual.nextRefreshAt, now + usageRefreshMinimum);
  now = initial.nextRefreshAt!;
  assert.deepEqual(await service.read("openai"), manual); assert.equal(calls, 2);
  const fresh = new ProviderUsageService(f.root, f.dir, async () => { calls++; return ready(); });
  assert.deepEqual(await fresh.read("openai"), manual); assert.equal(calls, 2);
});

test("preferCache returns any same-identity cache regardless of age, queries only when missing and still honours explicit refresh", async t => {
  const f = fixture(); t.after(f.close); let now = Date.now(), calls = 0;
  t.mock.method(Date, "now", () => now); t.mock.method(Math, "random", () => 0);
  const query = async () => { calls++; return ready(); };
  const first = await new ProviderUsageService(f.root, f.dir, query).read("openai", false, undefined, true); assert.equal(calls, 1);
  now = first.nextRefreshAt! + 3600000;
  assert.deepEqual(await new ProviderUsageService(f.root, f.dir, query).read("openai", false, undefined, true), first); assert.equal(calls, 1);
  const service = new ProviderUsageService(f.root, f.dir, query);
  await service.read("openai", true, undefined, true); assert.equal(calls, 2);
  writeFileSync(f.auth, "{}");
  const signedOut = await service.read("openai", false, undefined, true); assert.deepEqual(signedOut.metrics, []); assert.equal(calls, 2);
});

test("automatic failure preserves only same-identity old numbers and persists a full retry interval, including after restart", async t => {
  const f = fixture(); t.after(f.close); let now = Date.now(), calls = 0, fail = false;
  t.mock.method(Date, "now", () => now); t.mock.method(Math, "random", () => 0);
  const originalAuth = readFileSync(f.auth, "utf8"), query = async (): Promise<ProviderUsage> => { calls++; return fail
    ? { providerId: "openai", status: "unavailable", accountStatus: { state: "active", checkedAt: now }, metrics: [], message: "状态检查通过，额度查询暂不可用。" }
    : ready(); };
  const service = new ProviderUsageService(f.root, f.dir, query), initial = await service.read("openai");
  now = initial.nextRefreshAt!; fail = true;
  const stale = await service.read("openai"); assert.equal(stale.stale, true); assert.equal(stale.updatedAt, initial.updatedAt); assert.equal(calls, 2);
  assert.equal(stale.nextRefreshAt, now + usageRefreshMinimum);
  now += 15000;
  assert.deepEqual(await new ProviderUsageService(f.root, f.dir, query).read("openai"), stale); assert.equal(calls, 2);
  writeFileSync(f.models, '{"providers":{"openai":{"axiomProxy":{"mode":"external","url":"http://PRIVATE_PROXY.invalid:1"}}}}');
  const changed = await new ProviderUsageService(f.root, f.dir, query).read("openai");
  assert.equal(changed.status, "unavailable"); assert.deepEqual(changed.metrics, []); assert.equal(changed.stale, undefined); assert.equal(calls, 3);
  const proxy = proxyRuntimePath(f.root); mkdirSync(dirname(proxy), { recursive: true }); writeFileSync(proxy, '{"PRIVATE_PROXY_RUNTIME":1}');
  await service.read("openai"); assert.equal(calls, 4);
  assert.equal(readFileSync(f.auth, "utf8"), originalAuth); assert.doesNotMatch(readFileSync(cachedFile(f.root), "utf8"), /PRIVATE/);
});

test("a first failed attempt is also cached and throttled after restart without inventing a successful update time", async t => {
  const f = fixture(); t.after(f.close); let now = Date.now(), calls = 0;
  t.mock.method(Date, "now", () => now); t.mock.method(Math, "random", () => 0);
  const query = async (): Promise<ProviderUsage> => { calls++; throw Error("PRIVATE_FAILURE"); };
  const first = await new ProviderUsageService(f.root, f.dir, query).read("openai");
  assert.equal(first.status, "unavailable"); assert.equal(first.updatedAt, undefined); assert.equal(first.stale, undefined); assert.deepEqual(first.metrics, []);
  now += 15000;
  assert.deepEqual(await new ProviderUsageService(f.root, f.dir, query).read("openai"), first); assert.equal(calls, 1);
  assert.doesNotMatch(readFileSync(cachedFile(f.root), "utf8"), /PRIVATE/);
});

test("direct grants query normally; expired, logged out and mid-flight expired credentials hide persisted numbers", async t => {
  const f = fixture(); t.after(f.close); let now = Date.now(), calls = 0;
  t.mock.method(Date, "now", () => now);
  const query = async () => { calls++; return ready(); }, first = new ProviderUsageService(f.root, f.dir, query);
  await first.read("openai");
  writeFileSync(f.auth, JSON.stringify({ openai: { ...f.credential, scopes: ["chatgpt.tokens.use.direct"] } }));
  const direct = await new ProviderUsageService(f.root, f.dir, query).read("openai");
  assert.equal(direct.status, "ready"); assert.notEqual(direct.refreshable, false); assert.equal(calls, 2);
  assert.equal(cacheFiles(f.root).length, 1);
  writeFileSync(f.auth, JSON.stringify({ openai: { ...f.credential, expires: now + 1 } }));
  let release!: (value: ProviderUsage) => void;
  const pending = new ProviderUsageService(f.root, f.dir, async () => { calls++; return new Promise(resolve => { release = resolve; }); }).read("openai");
  now += 2; release(ready()); const expired = await pending;
  assert.match(expired.message!, /过期/); assert.deepEqual(expired.metrics, []); assert.equal(expired.updatedAt, undefined);
  writeFileSync(f.auth, "{}");
  const logout = await first.read("openai"); assert.deepEqual(logout.metrics, []); assert.equal(logout.stale, undefined); assert.equal(calls, 3);
});

test("persistent cache is private, whitelisted, bounded and rejects identity, time, file-link and directory-link confusion", t => {
  const f = fixture(); t.after(f.close);
  const disk = new ProviderUsageCache(f.root, f.dir), now = Date.now(), key = "a".repeat(64);
  const value = { ...ready(), updatedAt: now, access: "PRIVATE_TOKEN", accountId: "PRIVATE_ACCOUNT", metrics: [{ id: "balance", label: "剩余点数", kind: "balance" as const, balance: "1.2500", headers: "PRIVATE_HEADERS" }] };
  const entry = { key, value, checkedAt: now, nextRefreshAt: now + usageRefreshMinimum };
  disk.write("openai", entry); const path = cachedFile(f.root), original = readFileSync(path, "utf8"), auth = readFileSync(f.auth, "utf8");
  if (process.platform !== "win32") {
    assert.equal(lstatSync(path).mode & 0o077, 0); assert.equal(lstatSync(dirname(path)).mode & 0o077, 0);
  }
  assert.doesNotMatch(original, /PRIVATE/);
  assert.equal(disk.read("openai", key, now)?.value.metrics.length, 1); assert.equal(disk.read("openai", "b".repeat(64), now), undefined);
  assert.equal(new ProviderUsageCache(f.root, join(f.root, "other-pi")).read("openai", key, now), undefined);
  for (const edit of [ { version: 2 }, { checkedAt: now + 1 }, { nextRefreshAt: now + usageRefreshMinimum - 1 }, { nextRefreshAt: now + usageRefreshMinimum + usageRefreshJitter + 1 }, { value: { ...ready(), metrics: [null] } } ]) {
    writeFileSync(path, JSON.stringify({ ...JSON.parse(original), ...edit })); assert.equal(disk.read("openai", key, now), undefined);
  }
  writeFileSync(path, " ".repeat(256 * 1024 + 1)); assert.equal(disk.read("openai", key, now), undefined);
  writeFileSync(path, original);
  if (process.platform !== "win32") {
    chmodSync(path, 0o644); assert.equal(disk.read("openai", key, now), undefined); chmodSync(path, 0o600);
  }
  for (const link of [symlinkSync, linkSync]) {
    unlinkSync(path); link(f.auth, path);
    assert.equal(disk.read("openai", key, now), undefined); disk.write("openai", entry); disk.delete("openai");
    assert.equal(existsSync(path), true); assert.equal(readFileSync(f.auth, "utf8"), auth);
    unlinkSync(path); writeFileSync(path, original, { mode: 0o600 });
  }
  rmSync(join(f.root, "model-usage-cache"), { recursive: true }); symlinkSync(f.dir, join(f.root, "model-usage-cache"), "dir");
  const files = readdirSync(f.dir); disk.write("openai", entry); assert.equal(disk.read("openai", key, now), undefined); assert.deepEqual(readdirSync(f.dir), files);
  assert.equal(readFileSync(f.auth, "utf8"), auth);
});

test("absolute Token metrics round-trip only whitelisted model, amount and category fields", t => {
  const f = fixture(); t.after(f.close);
  const disk = new ProviderUsageCache(f.root, f.dir), now = Date.now(), key = "a".repeat(64);
  const metric = { id: "tokens", label: "额度", kind: "tokens" as const, model: "local", used: 100, remaining: 1_000_000, part: "input" as const, secret: "PRIVATE_METRIC_SECRET" };
  const entry = { key, value: { ...ready(), metrics: [metric] }, checkedAt: now, nextRefreshAt: now + usageRefreshMinimum };
  disk.write("openai", entry);
  assert.deepEqual(disk.read("openai", key, now)?.value.metrics, [{ id: "tokens", label: "额度", kind: "tokens", model: "local", used: 100, remaining: 1_000_000, part: "input" }]);
  const file = cachedFile(f.root), original = readFileSync(file, "utf8"); assert.doesNotMatch(original, /PRIVATE/);
  for (const invalid of [{ part: "credit" }, { remaining: -1 }, { model: "" }, { used: "100" }]) {
    const parsed = JSON.parse(original); parsed.value.metrics[0] = { ...parsed.value.metrics[0], ...invalid };
    writeFileSync(file, JSON.stringify(parsed)); assert.equal(disk.read("openai", key, now), undefined);
  }
});
