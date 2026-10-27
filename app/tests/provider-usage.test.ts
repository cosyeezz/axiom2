import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ProviderUsageService, queryProviderUsage, supportsProviderUsage } from "../src/server/provider-usage.js";
import { queryOpenAIUsage, parseOpenAIResetCredits } from "../src/server/providers/openai-usage.js";
import { usageMetricValue, type ProviderUsage } from "../src/shared/provider-usage.js";
import { ModelService } from "../src/server/model-service.js";
import { modelNetwork, closeModelNetworks } from "../src/server/model-network.js";

const credential = { type: "oauth" as const, access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", accountId: "PRIVATE_ACCOUNT", expires: Date.now() + 3_600_000 };
const signal = () => new AbortController().signal;
const ready = (providerId = "openai"): ProviderUsage => ({ providerId, status: "ready", metrics: [{ id: "credits", kind: "balance", label: "剩余点数", balance: "1.2500" }], updatedAt: Date.now() });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-provider-usage-")), dir = join(root, "pi");
  mkdirSync(dir);
  const authPath = join(dir, "auth.json"), modelsPath = join(dir, "models.json");
  writeFileSync(authPath, JSON.stringify({ openai: credential }));
  writeFileSync(modelsPath, '{"providers":{}}');
  return { root, dir, authPath, modelsPath, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("OpenAI adapter uses only wham GETs, derives JWT account, preserves decimals and normalizes windows/cards", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const access = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "PRIVATE_ACCOUNT" } })).toString("base64url")}.signature`;
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.endsWith("/usage") ? {
      rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: 1900000000 }, secondary_window: { used_percent: 99.99, limit_window_seconds: 604800 } },
      additional_rate_limits: [{ metered_feature: "codex_spark", rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 3600 } } }],
      credits: { has_credits: true, balance: "123.4500" }, rate_limit_reset_credits: { available_count: 1 },
    } : { available_count: "3", credits: [{ id: "PRIVATE_CARD", status: "available", reset_type: "codex_rate_limits", expires_at: "2099-01-01T00:00:00Z" }] }));
  }) as typeof fetch;
  const result = await queryOpenAIUsage("openai", { ...credential, accountId: undefined, access }, signal(), fetcher);
  assert.equal(result.status, "ready"); assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.method, "GET"); assert.equal(call.init.redirect, "error");
    assert.equal(new Headers(call.init.headers).get("chatgpt-account-id"), "PRIVATE_ACCOUNT");
    assert.equal(new Headers(call.init.headers).get("authorization"), `Bearer ${access}`);
    assert.match(call.url, /^https:\/\/chatgpt\.com\/backend-api\/wham\//);
  }
  assert.equal(usageMetricValue(result.metrics.find(m => m.id === "credits")!), "123.4500");
  assert.equal(usageMetricValue(result.metrics.find(m => m.id === "reset_credits")!), "3 次");
  assert.equal(result.metrics[0].label, "5小时已用"); assert.equal(usageMetricValue(result.metrics[0]), "0%");
  assert.ok(result.metrics.some(m => m.label === "Spark 1小时已用"));
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

test("unknown, zero, unlimited, partial failure and malformed responses stay distinct and redact upstream errors", async () => {
  const fetcher = (usage: unknown, status = 200) => (async (url: string) => url.endsWith("/usage") ? new Response(JSON.stringify(usage), { status }) : new Response("PRIVATE_ERROR_BODY", { status: 403 })) as typeof fetch;
  const result = await queryOpenAIUsage("openai", credential, signal(), fetcher({ credits: { has_credits: false }, rate_limit_reset_credits: { available_count: 0 } }));
  assert.equal(result.status, "ready"); assert.ok(result.message);
  assert.deepEqual(result.metrics.map(usageMetricValue), ["0", "0 次"]);
  const unknown = await queryOpenAIUsage("openai", credential, signal(), fetcher({ credits: { has_credits: true, balance: null } }));
  assert.equal(unknown.status, "unavailable"); assert.deepEqual(unknown.metrics.map(usageMetricValue), ["—", "—"]);
  const unlimited = await queryOpenAIUsage("openai", credential, signal(), fetcher({ credits: { unlimited: true } }));
  assert.equal(usageMetricValue(unlimited.metrics[0]), "无限");
  const failed = await queryOpenAIUsage("openai", credential, signal(), fetcher({}, 401));
  assert.equal(failed.status, "unavailable"); assert.match(failed.message!, /HTTP 401/);
  assert.equal(JSON.stringify(failed).includes("PRIVATE"), false);
});

test("unknown opaque OAuth without account metadata still queries upstream, omitting only the optional routing header", async () => {
  let calls = 0;
  const direct = { ...credential, accountId: undefined, access: "opaque-direct-access", clientId: "fixture-client", scopes: ["openid"] };
  const fetcher = (async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(new Headers(init.headers).has("chatgpt-account-id"), false);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer opaque-direct-access");
    return new Response(JSON.stringify(_url.endsWith("/usage") ? { credits: { balance: "12.3400" } } : { available_count: 2 }));
  }) as typeof fetch;
  for (const providerId of ["openai", "openai-codex"]) {
    const result = await queryOpenAIUsage(providerId, direct, signal(), fetcher);
    assert.equal(result.status, "ready");
    assert.deepEqual(result.metrics.map(usageMetricValue), ["12.3400", "2 次"]);
    assert.equal(JSON.stringify(result).includes("opaque-direct-access"), false);
  }
  assert.equal(calls, 4);
});

test("known direct grants use the official management link without network, credential interpretation or refresh", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw Error("network forbidden"); });
  const direct = { ...credential, scopes: ["openid", "resource.invoke", "chatgpt.tokens.use.direct"],
    get access(): string { throw Error("direct auth metadata must remain opaque"); },
    get accountId(): string { throw Error("direct account metadata must not be interpreted"); } };
  for (const providerId of ["openai", "openai-codex"]) {
    const value = await queryOpenAIUsage(providerId, direct, signal());
    assert.equal(value.providerId, providerId); assert.equal(value.status, "unavailable");
    assert.equal(value.refreshable, false); assert.deepEqual(value.metrics, []);
    assert.equal(value.management?.url, "https://chatgpt.com/settings/usage");
    assert.match(value.message!, /direct/); assert.equal(value.updatedAt, undefined);
    assert.deepEqual(await queryProviderUsage(providerId, direct, signal()), value);
  }
  assert.equal((await queryProviderUsage("anthropic", direct, signal())).status, "unsupported");
  await assert.rejects(queryProviderUsage("openai", direct, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("direct capability is local, never invokes worker, and replaces previously cached numbers", async t => {
  const f = fixture(); t.after(f.close);
  let calls = 0;
  const service = new ProviderUsageService(f.root, f.dir, async () => { calls++; return ready(); });
  assert.equal((await service.read("openai")).status, "ready"); assert.equal(calls, 1);
  writeFileSync(f.authPath, JSON.stringify({ openai: { ...credential, scopes: ["chatgpt.tokens.use.direct"] } }));
  const raw = readFileSync(f.authPath, "utf8");
  for (const refresh of [false, true, false]) {
    const value = await service.read("openai", refresh);
    assert.equal(value.refreshable, false); assert.equal(value.stale, undefined);
    assert.equal(value.updatedAt, undefined); assert.deepEqual(value.metrics, []);
    assert.equal(value.management?.url, "https://chatgpt.com/settings/usage");
  }
  assert.equal(calls, 1); assert.equal(readFileSync(f.authPath, "utf8"), raw);
  assert.equal(JSON.stringify(await service.read("openai")).includes("PRIVATE"), false);
});

test("upstream authorization, rate limits, network failures and malformed JSON have safe actionable reasons", async () => {
  for (const status of [401, 403, 429, 503]) {
    const result = await queryOpenAIUsage("openai", credential, signal(), (async () => new Response("PRIVATE_UPSTREAM_BODY", { status })) as typeof fetch);
    assert.equal(result.status, "unavailable"); assert.match(result.message!, new RegExp(`HTTP ${status}`));
    assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
  const invalid = await queryOpenAIUsage("openai", credential, signal(), (async () => new Response("PRIVATE_INVALID_JSON")) as typeof fetch);
  assert.equal(invalid.status, "unavailable"); assert.match(invalid.message!, /JSON|数据/);
  assert.equal(JSON.stringify(invalid).includes("PRIVATE"), false);
  for (const response of [() => new Response(null, { status: 204 }), () => new Response("x".repeat(1_000_001))]) {
    const result = await queryOpenAIUsage("openai", credential, signal(), (async () => response()) as typeof fetch);
    assert.equal(result.status, "unavailable"); assert.match(result.message!, /数据/);
  }
  const network = await queryOpenAIUsage("openai", credential, signal(), (async () => { throw new Error("PRIVATE_PROXY_ADDRESS"); }) as typeof fetch);
  assert.equal(network.status, "unavailable"); assert.match(network.message!, /网络|代理/);
  assert.equal(JSON.stringify(network).includes("PRIVATE"), false);
});

test("card parsing accepts known envelopes/camelCase, filters unrelated/redeemed/expired cards, never invents zero", () => {
  for (const key of ["credits", "rate_limit_reset_credits", "items", "data"]) {
    assert.equal(parseOpenAIResetCredits({ [key]: [
      { status: "available", resetType: "codex_rate_limits", expiresAt: "2099-01-01T00:00:00Z" },
      { status: "redeemed" }, { reset_type: "other" }, { expires_at: "2000-01-01T00:00:00Z" },
    ] }).count, 1);
  }
  assert.equal(parseOpenAIResetCredits([]).count, 0);
  assert.equal(parseOpenAIResetCredits([null, 42, "invalid", [], { status: "available" }]).count, 1);
  assert.equal(parseOpenAIResetCredits({ unknown: [] }).count, null);
  assert.equal(parseOpenAIResetCredits({ availableCount: "0" }).count, 0);
  assert.equal(parseOpenAIResetCredits({ available_count: -1 }).count, null);
  assert.equal(parseOpenAIResetCredits({ available_count: "NaN" }).count, null);
});

test("supported OAuth only; expired/API key/unsupported queries never refresh credentials or use the network", async t => {
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches++; throw Error("forbidden"); });
  assert.ok(supportsProviderUsage("openai")); assert.ok(supportsProviderUsage("openai-codex"));
  assert.equal((await queryProviderUsage("anthropic", credential, signal())).status, "unsupported");
  assert.equal((await queryProviderUsage("openai", { type: "api_key", key: "PRIVATE_KEY" }, signal())).status, "unavailable");
  assert.equal((await queryProviderUsage("openai", { ...credential, expires: 1 }, signal())).status, "unavailable");
  assert.equal(fetches, 0);
});

test("cache is single-flight, rate limited, stale on failure, and invalidated by account/config/logout", async t => {
  const f = fixture(); t.after(f.close);
  let now = Date.now(), calls = 0, fail = false;
  t.mock.method(Date, "now", () => now);
  const service = new ProviderUsageService(f.root, f.dir, async () => { calls++; if (fail) throw Error("PRIVATE_NETWORK_ERROR"); return ready(); });
  const values = await Promise.all([service.read("openai"), service.read("openai")]);
  assert.equal(calls, 1); assert.deepEqual(values[0], values[1]);
  await service.read("openai", true); assert.equal(calls, 1);
  now += 6000; fail = true;
  const stale = await service.read("openai", true); assert.equal(calls, 2); assert.equal(stale.stale, true); assert.equal(stale.updatedAt, values[0].updatedAt);
  writeFileSync(f.authPath, JSON.stringify({ openai: { ...credential, access: "DIFFERENT_ACCOUNT" } }));
  const other = await service.read("openai"); assert.equal(calls, 3); assert.deepEqual(other.metrics, []); assert.equal(other.stale, undefined);
  fail = false; writeFileSync(f.modelsPath, '{"providers":{"openai":{}}}');
  assert.equal((await service.read("openai")).status, "ready"); assert.equal(calls, 4);
  writeFileSync(f.authPath, "{}"); assert.equal((await service.read("openai")).status, "unavailable"); assert.equal(calls, 4);
  assert.equal((await service.read("qoder")).status, "unsupported"); assert.equal(calls, 4);
});

test("usage timeouts have an explicit safe reason without changing stored auth", async t => {
  const f = fixture(); t.after(f.close);
  const raw = readFileSync(f.authPath, "utf8");
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("PRIVATE_TIMEOUT", "TimeoutError")));
  const service = new ProviderUsageService(f.root, f.dir, async (_provider, abort) => { abort.throwIfAborted(); return ready(); });
  const result = await service.read("openai");
  assert.equal(result.status, "unavailable"); assert.match(result.message!, /超时/);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false); assert.equal(readFileSync(f.authPath, "utf8"), raw);
});

test("an in-flight result is discarded if logout/account change wins, and canceled reads start no query", async t => {
  const f = fixture(); t.after(f.close);
  let release!: (value: ProviderUsage) => void, calls = 0;
  const service = new ProviderUsageService(f.root, f.dir, () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const pending = service.read("openai");
  writeFileSync(f.authPath, "{}"); release(ready());
  assert.deepEqual((await pending).metrics, []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.read("openai", false, controller.signal), { name: "AbortError" }); assert.equal(calls, 1);
});

test("configuration stays network-free and usage is isolated from the configuration writer and IPC credentials", async t => {
  const f = fixture(), previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = f.dir;
  t.after(() => { if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; f.close(); });
  const calls: any[] = [];
  const service = new ModelService(f.root, (async (...args: any[]) => { calls.push(args); return ready(); }) as typeof modelNetwork);
  const raw = readFileSync(f.authPath, "utf8");
  const config = await service.read({ normalizeCredentials: false });
  assert.equal(Object.hasOwn(config.providers.find(p => p.providerId === "openai")?.auth ?? {}, "usageSupported"), false); assert.equal(calls.length, 0);
  let release!: () => void;
  const writer = service.serial(() => new Promise<void>(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal((await service.usage("openai")).status, "ready");
    assert.equal(calls[0][4], "usage"); assert.deepEqual(calls[0][5], {}); assert.equal(JSON.stringify(calls).includes("PRIVATE"), false);
    assert.equal(readFileSync(f.authPath, "utf8"), raw);
  } finally { release(); await writer; }
});

test("real usage IPC keeps provider proxy routes and credentials inside the worker without mutating auth", { timeout: 20000 }, async t => {
  const f = fixture(), previous = { NODE_OPTIONS: process.env.NODE_OPTIONS, AXIOM_USAGE_FIXTURE_DIR: process.env.AXIOM_USAGE_FIXTURE_DIR };
  process.env.NODE_OPTIONS = `${previous.NODE_OPTIONS ?? ""} --require=${resolve("tests/fixtures/provider-usage-network.cjs")}`;
  process.env.AXIOM_USAGE_FIXTURE_DIR = f.root;
  t.after(async () => { await closeModelNetworks(f.root); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } f.close(); });
  writeFileSync(f.authPath, JSON.stringify({ openai: credential, "openai-codex": credential }));
  writeFileSync(f.modelsPath, JSON.stringify({ providers: { openai: { axiomProxy: { mode: "external", url: "http://first.invalid:8080" } }, "openai-codex": { axiomProxy: { mode: "external", url: "http://second.invalid:8080" } } } }));
  const raw = readFileSync(f.authPath, "utf8");
  const results = await Promise.all(["openai", "openai-codex"].map(provider => modelNetwork<ProviderUsage>(f.root, f.dir, provider, f.modelsPath, "usage")));
  assert.ok(results.every(result => result.status === "ready")); assert.equal(JSON.stringify(results).includes("PRIVATE"), false);
  assert.equal(readFileSync(f.authPath, "utf8"), raw);
  const requests = readFileSync(join(f.root, "usage-requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(requests.length, 4); assert.ok(requests.every(row => row.worker === "1"));
  assert.deepEqual(new Set(requests.map(row => row.proxy)), new Set(["http://first.invalid:8080/", "http://second.invalid:8080/"]));
});
