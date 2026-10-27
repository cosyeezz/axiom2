import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore, type Credential, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { fetchKiroCatalog, kiroCatalogInput, kiroCatalogScope, restoreKiroCatalog } from "../src/server/providers/kiro-catalog.js";
import { kiroProvider } from "../src/server/providers/kiro.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";

const credential = (patch: Partial<KiroCredential> = {}): KiroCredential => ({
  type: "oauth", access: "ACCESS-PRIVATE", refresh: "REFRESH-PRIVATE", expires: Date.now() + 3600_000,
  authMethod: "builder-id", authRegion: "us-east-1", ...patch,
});
const model = (id = "upstream-model") => ({ modelId: id, modelName: `Name ${id}`, tokenLimits: { maxInputTokens: 123456, maxOutputTokens: 8192 } });
const page = (models: unknown[] = [model()], extra = {}) => ({ models, defaultModel: model(), ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signal = () => new AbortController().signal;

test("Kiro uses the CLI AWS JSON POST, origin, and double-serialized pagination", async () => {
  const calls: URL[] = [];
  const result = await fetchKiroCatalog(credential(), signal(), async (input, init) => {
    const url = new URL(String(input)), body = JSON.parse(String(init?.body)), headers = new Headers(init?.headers);
    calls.push(url);
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.ok(init.signal);
    assert.equal(url.origin, "https://q.us-east-1.amazonaws.com"); assert.equal(url.pathname, "/");
    assert.equal(headers.get("authorization"), "Bearer ACCESS-PRIVATE");
    assert.equal(headers.get("content-type"), "application/x-amz-json-1.0");
    assert.equal(headers.get("x-amz-target"), "AmazonCodeWhispererService.ListAvailableModels");
    assert.equal(headers.get("amz-sdk-request"), "attempt=1; max=1");
    assert.deepEqual(Object.fromEntries(url.searchParams), body);
    assert.equal(body.origin, "KIRO_CLI"); assert.equal(body.profileArn, undefined);
    if (calls.length === 1) return json(page([model("a")], { nextToken: "opaque +/?=& token" }));
    assert.equal(body.nextToken, "opaque +/?=& token");
    return json(page([model("a"), model("b")], { ignoredSecret: "NOT-PERSISTED" }));
  });
  assert.equal(calls.length, 2); assert.deepEqual(result.map(item => item.id), ["a", "b"]);
  assert.equal(result[0].contextWindow, 123456); assert.equal(result[0].maxTokens, 8192);
  assert.deepEqual(result[0].input, ["text"]); assert.equal(result[0].api, "kiro-chat");
  assert.ok(!JSON.stringify(result).includes("PRIVATE")); assert.ok(!JSON.stringify(result).includes("NOT-PERSISTED"));
});

test("Kiro preserves declared image capability, distinguishes unknown input types and validates metadata", async () => {
  const entries = [
    { ...model("vision"), supportedInputTypes: ["TEXT", "IMAGE", "FUTURE"] },
    { ...model("text"), supportedInputTypes: ["TEXT"] },
    model("unknown"), { ...model("null"), supportedInputTypes: null },
    { ...model("future"), supportedInputTypes: ["FUTURE"] },
    { ...model("empty"), supportedInputTypes: [] },
    { ...model("image-only"), supportedInputTypes: ["IMAGE"] },
  ];
  const models = await fetchKiroCatalog(credential(), signal(), async () => json(page(entries)));
  assert.deepEqual(models.map(item => item.input), [["text", "image"], ["text"], ["text"], ["text"], ["text"], ["text"], ["text", "image"]]);
  assert.deepEqual(models.map(kiroCatalogInput), [["text", "image"], ["text"], undefined, undefined, undefined, undefined, ["text", "image"]]);
  const restored = restoreKiroCatalog(JSON.parse(JSON.stringify(models)))!;
  assert.deepEqual(restored, models); assert.deepEqual(restored.map(kiroCatalogInput), models.map(kiroCatalogInput));
  assert.equal(restoreKiroCatalog([{ ...models[0], input: ["text"] }]), undefined);
  assert.equal(restoreKiroCatalog([{ ...models[1], input: ["text", "image"] }]), undefined);
  assert.equal(restoreKiroCatalog([{ ...models[0], input: ["text", "image", "image"] }]), undefined);
  assert.equal(restoreKiroCatalog([{ ...models[0], kiroSupportedInputTypes: "IMAGE" }]), undefined);
  for (const supportedInputTypes of ["IMAGE", [true], [null], [{}]])
    await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => json(page([{ ...model(), supportedInputTypes }]))), /输入能力/);
});

test("Kiro service region follows explicit profile, never the authentication region", async () => {
  for (const authMethod of ["builder-id", "social", "identity-center"] as const) {
    const account = credential({ authMethod, authRegion: authMethod === "identity-center" ? "ap-southeast-2" : "us-east-1" });
    await fetchKiroCatalog(account, signal(), async input => {
      assert.equal(new URL(String(input)).hostname, "q.us-east-1.amazonaws.com"); return json(page());
    });
  }
  const profileArn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/test-profile";
  await fetchKiroCatalog(credential({ authMethod: "identity-center", authRegion: "us-west-2", profileArn }), signal(), async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "q.eu-central-1.amazonaws.com"); assert.equal(url.searchParams.get("profileArn"), profileArn);
    assert.equal(JSON.parse(String(init?.body)).profileArn, profileArn); return json(page());
  });
});

test("Kiro rejects invalid or expired credentials before issuing a request", async () => {
  const transport: typeof fetch = async () => { throw Error("NETWORK MUST NOT RUN"); };
  for (const patch of [{ access: "token\r\ninjected" }, { refresh: "" }, { expires: 1 }, { authRegion: "evil.example/" },
    { authRegion: "cn-north-1" }, { authMethod: "other" }, { profileArn: "https://evil.example" },
    { profileArn: "arn:aws:codewhisperer:ap-south-1:123456789012:profile/test" }]) {
    await assert.rejects(fetchKiroCatalog(credential(patch as any), signal(), transport), /Kiro/);
  }
  await assert.rejects(fetchKiroCatalog(undefined, signal(), transport), /凭据/);
});

test("Kiro errors are sanitized and never retried across profiles or regions", async () => {
  for (const status of [400, 401, 403, 429, 500, 302]) {
    let calls = 0;
    await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => {
      calls++; return json({ error: "ACCESS-PRIVATE REFRESH-PRIVATE private-profile" }, status);
    }), error => error instanceof Error && !/PRIVATE|private-profile/.test(error.message) && /Kiro/.test(error.message));
    assert.equal(calls, 1);
  }
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => { throw Error("PRIVATE network URL"); }), /网络请求失败/);
});

test("Kiro rejects incomplete, malformed and non-finite catalog metadata", async () => {
  for (const body of [{ models: [] }, { defaultModel: model() }, page([{ modelId: "" }]), page([{ modelId: "x", tokenLimits: { maxInputTokens: -2 } }]),
    page([{ modelId: "x", tokenLimits: { maxOutputTokens: 1.5 } }]), page([model()], { nextToken: 3 }), page([null])]) {
    await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => json(body)), /Kiro/);
  }
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => new Response("not json")), /响应格式/);
  const [unknown] = await fetchKiroCatalog(credential(), signal(), async () => json(page([{ modelId: "unknown" }])));
  assert.equal(unknown.contextWindow, 0); assert.equal(unknown.maxTokens, 0);
  for (const item of [{ modelId: "nullable", modelName: null, tokenLimits: null }, { modelId: "nullable", tokenLimits: { maxInputTokens: null, maxOutputTokens: 0 } }]) {
    const [nullable] = await fetchKiroCatalog(credential(), signal(), async () => json(page([item])));
    assert.equal(nullable.name, "nullable"); assert.equal(nullable.contextWindow, 0); assert.equal(nullable.maxTokens, 0);
  }
  assert.deepEqual(await fetchKiroCatalog(credential(), signal(), async () => json(page([]))), []);
});

test("Kiro rejects repeated pagination, excessive pages and excessive model counts", async () => {
  let count = 0;
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => { count++; return json(page([], { nextToken: "repeat" })); }), /分页标记/);
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => json(page([], { nextToken: String(++count) }))), /20 页/);
  assert.equal(count, 20);
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => json(page(Array.from({ length: 1001 }, (_, i) => model(String(i)))))), /models 数组/);
});

test("Kiro limits declared and streamed response size and aborts stalled bodies", async () => {
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => new Response("{}", { headers: { "content-length": "2097153" } })), /2 MiB/);
  await assert.rejects(fetchKiroCatalog(credential(), signal(), async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2097153)); controller.close(); } }))), /2 MiB/);
  const controller = new AbortController();
  let cancelled = false;
  const pending = fetchKiroCatalog(credential(), controller.signal, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /abort/i); assert.equal(cancelled, true);
  const already = new AbortController(); already.abort();
  await assert.rejects(fetchKiroCatalog(credential(), already.signal, async () => { throw Error("MUST NOT FETCH"); }), /abort/i);
});

async function setup(account: Credential = credential(), transport: typeof fetch = async () => json(page())) {
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  await credentials.modify("kiro", async () => account);
  const provider = kiroProvider({ fetch: transport }), models = createModels({ credentials, modelsStore });
  models.setProvider(provider);
  return { credentials, modelsStore, provider, models };
}

test("Kiro caches only normalized catalog fields and restores the same credential offline", async () => {
  let calls = 0;
  const { models, modelsStore, credentials } = await setup(credential(), async () => { calls++; return json(page([model()], { accessToken: "UPSTREAM-SECRET" })); });
  assert.equal((await models.refresh({ providers: ["kiro"] })).errors.size, 0);
  const stored = await modelsStore.read("kiro"); assert.ok(stored); assert.equal(calls, 1);
  assert.ok(!/PRIVATE|UPSTREAM-SECRET/.test(JSON.stringify(stored)));
  const reopened = createModels({ credentials, modelsStore });
  reopened.setProvider(kiroProvider({ fetch: async () => { throw Error("OFFLINE"); } }));
  assert.equal((await reopened.refresh({ allowNetwork: false })).errors.size, 0);
  assert.deepEqual(reopened.getModels("kiro").map(item => item.id), ["upstream-model"]);
  assert.deepEqual(restoreKiroCatalog(stored.models), reopened.getModels("kiro"));
  assert.equal(restoreKiroCatalog([{ ...stored.models[0], baseUrl: "https://evil.example" }]), undefined);
  assert.equal(restoreKiroCatalog([{ ...stored.models[0], contextWindow: -1 }]), undefined);
});

test("Kiro image catalog survives offline reopen and V1 text-only caches migrate as unknown without network", async () => {
  const { models, modelsStore, credentials } = await setup(credential(), async () => json(page([{ ...model(), supportedInputTypes: ["TEXT", "IMAGE"] }])));
  await models.refresh();
  const stored = (await modelsStore.read("kiro"))!;
  assert.equal((stored as ModelsStoreEntry & { cacheVersion: number }).cacheVersion, 2);
  const reopened = createModels({ credentials, modelsStore });
  reopened.setProvider(kiroProvider({ fetch: async () => { throw Error("NO NETWORK"); } }));
  await reopened.refresh({ allowNetwork: false });
  assert.deepEqual(reopened.getModels("kiro")[0].input, ["text", "image"]);
  assert.deepEqual(kiroCatalogInput(reopened.getModels("kiro")[0]), ["text", "image"]);
  const legacy = { ...stored, cacheVersion: 1, models: stored.models.map(item => ({ ...item, input: ["text" as const] })) };
  await modelsStore.write("kiro", legacy);
  await reopened.refresh({ allowNetwork: false });
  assert.deepEqual(reopened.getModels("kiro")[0].input, ["text"]);
  assert.equal(kiroCatalogInput(reopened.getModels("kiro")[0]), undefined);
  assert.deepEqual(await modelsStore.read("kiro"), legacy, "offline migration does not rewrite persisted cache");
});

test("Kiro never restores a different login, profile, or unscoped legacy cache", async () => {
  const { models, credentials, modelsStore } = await setup(); await models.refresh();
  const stored = await modelsStore.read("kiro");
  await credentials.modify("kiro", async () => credential({ refresh: "OTHER-ACCOUNT" }));
  assert.deepEqual(await models.getAvailable("kiro"), [], "availability rejects changed credentials even before refresh");
  await models.refresh({ allowNetwork: false }); assert.deepEqual(models.getModels("kiro"), []);
  await credentials.delete("kiro");
  assert.equal(await credentials.read("kiro"), undefined, "modify(undefined) would keep the old credential; logout must really delete it");
  await models.refresh({ allowNetwork: false }); assert.deepEqual(models.getModels("kiro"), []);
  assert.deepEqual(await modelsStore.read("kiro"), stored, "offline initialization never rewrites storage");
  assert.notEqual(kiroCatalogScope(credential()), kiroCatalogScope(credential({ profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/other" })));
  await credentials.modify("kiro", async () => credential());
  await modelsStore.write("kiro", { models: stored!.models });
  await models.refresh({ allowNetwork: false }); assert.deepEqual(models.getModels("kiro"), []);
});

test("Kiro invalidates warm catalogs when same-scope storage is missing or invalid", async () => {
  const { models, modelsStore } = await setup();
  for (const invalid of [undefined, { models: [] }, { cacheVersion: 1, cacheScope: kiroCatalogScope(credential()), models: [{ id: "bad" }] }]) {
    await models.refresh({ force: true }); assert.equal(models.getModels("kiro").length, 1);
    if (invalid === undefined) await modelsStore.delete("kiro");
    // Deliberately malformed persisted data exercises catalog validation.
    else await modelsStore.write("kiro", invalid as ModelsStoreEntry);
    await models.refresh({ allowNetwork: false }); assert.deepEqual(models.getModels("kiro"), []);
  }
});

test("Kiro refresh failure retains only same-scope cache and never publishes partial pages", async () => {
  let fail = false;
  const { models, provider } = await setup(credential(), async (_input, init) => {
    if (!fail) return json(page());
    if (!JSON.parse(String(init?.body)).nextToken) return json(page([model("partial")], { nextToken: "page2" }));
    return json({ secret: "PRIVATE" }, 403);
  });
  await models.refresh(); fail = true;
  const result = await models.refresh({ force: true });
  assert.match(result.errors.get("kiro")!.message, /无权/);
  assert.deepEqual(provider.getModels().map(item => item.id), ["upstream-model"]);
});

test("Kiro rotated OAuth credentials are re-scoped before network access", async () => {
  let failing = false;
  const { models, credentials, provider } = await setup(credential(), async (_input, init) => {
    if (!failing) return json(page());
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ROTATED");
    return json({}, 403);
  });
  await models.refresh(); failing = true;
  models.setProvider({ ...provider, auth: { oauth: { ...provider.auth.oauth!, refresh: async current => ({ ...current, access: "ROTATED", refresh: "ROTATED-REFRESH", expires: Date.now() + 3600000 }) } } });
  await credentials.modify("kiro", async () => credential({ expires: 1 }));
  const result = await models.refresh();
  assert.match(result.errors.get("kiro")!.message, /无权/);
  assert.deepEqual(provider.getModels(), [], "rotation clears old scope even if network fails");
  const rotated = await credentials.read("kiro");
  assert.equal(rotated?.type, "oauth"); assert.ok(rotated?.type === "oauth");
  assert.equal(rotated.refresh, "ROTATED-REFRESH");
  assert.notEqual(kiroCatalogScope(credential()), kiroCatalogScope(await credentials.read("kiro")));
  await models.refresh({ allowNetwork: false }); assert.deepEqual(provider.getModels(), []);
});

test("Kiro cancelled late responses cannot publish models or write a cache", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let cancelled = false;
  const { models, modelsStore } = await setup(credential(), async () => {
    await waiting;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(page()))); },
      cancel() { cancelled = true; },
    }));
  });
  const abort = new AbortController(), pending = models.refresh({ signal: abort.signal });
  await new Promise(resolve => setTimeout(resolve, 10)); abort.abort();
  assert.equal((await pending).aborted, true); release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(models.getModels("kiro"), []); assert.equal(await modelsStore.read("kiro"), undefined);
  assert.equal(cancelled, true, "late response bodies must be cancelled, not leaked");
});
