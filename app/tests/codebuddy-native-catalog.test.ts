import assert from "node:assert/strict";
import { test } from "node:test";
import { codeBuddyBuiltinModels, parseCodeBuddyConfiguration } from "../src/native-providers/codebuddy/models.js";
import { createCodeBuddyCatalog, fetchCodeBuddyCatalog } from "../src/native-providers/codebuddy/catalog.js";
import { createCodeBuddyJsonRequest } from "../src/native-providers/codebuddy/json.js";
const signal = () => new AbortController().signal;
const json = (data: unknown) => new Response(JSON.stringify(data));

test("CodeBuddy pure catalog preserves builtin limits and explicit off without SDK types", () => {
  const models = codeBuddyBuiltinModels();
  assert.equal(models.length, 11);
  const flash = models.find(model => model.id === "deepseek-v4.1-flash")!;
  assert.equal(flash.contextWindow, 1_000_000); assert.equal(flash.maxOutputTokens, 128_000);
  assert.equal(flash.thinking.levels?.off, "none"); assert.equal(flash.thinking.levels?.max, "max");
  models[0].name = "mutated";
  assert.notEqual(codeBuddyBuiltinModels()[0].name, "mutated");
});

test("remote config merges by ID, whitelists metadata and treats visibility as non-authoritative", () => {
  const parsed = parseCodeBuddyConfiguration({ endpoint: "https://evil.invalid", headers: { authorization: "SECRET" },
    models: [{ id: "deepseek-v4.1-flash", maxInputTokens: 64000, supportsImages: false },
      { id: "new-model", maxInputTokens: 32000, maxOutputTokens: 4096, supportsReasoning: true, reasoning: { effort: "high" }, systemPrompt: "SECRET" }],
    availableModels: ["new-model", "deepseek-v4.1-flash"],
  });
  assert.equal(parsed.length, 2);
  const flash = parsed.find(model => model.id === "deepseek-v4.1-flash")!;
  assert.equal(flash.contextWindow, 64000); assert.equal(flash.maxOutputTokens, 128000); assert.deepEqual(flash.input, ["text"]);
  const added = parsed.find(model => model.id === "new-model")!;
  assert.equal(added.thinking.levels?.high, "high"); assert.equal(added.thinking.levels?.max, null);
  assert.ok(!JSON.stringify(parsed).includes("SECRET")); assert.ok(!JSON.stringify(parsed).includes("evil.invalid"));
  assert.equal(parseCodeBuddyConfiguration({ availableModels: [] }).length, 11);
});

test("invalid catalog cannot publish partial metadata or coercible limits", () => {
  for (const value of [null, [], { models: {} }, { models: [{ id: "" }] }, { models: [{ id: "same" }, { id: "same" }] },
    { models: [{ id: "m", maxInputTokens: "32000" }] }, { models: [{ id: "m", maxOutputTokens: -1 }] }, { availableModels: [1] }])
    assert.throws(() => parseCodeBuddyConfiguration(value));
});

test("directory request uses fixed authenticated CN URL with no repository payload or redirects", async () => {
  let calls = 0;
  const result = await fetchCodeBuddyCatalog("FIXTURE", signal(), async (input, init) => {
    calls++;
    assert.equal(String(input), "https://copilot.tencent.com/v3/config"); assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined); assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer FIXTURE"); assert.equal(headers.get("connection"), "close");
    assert.equal(headers.get("user-agent"), "CLI/2.179.0 CodeBuddy/2.179.0");
    return json({ code: 0, data: { availableModels: ["deepseek-v4.1-flash"] } });
  });
  assert.equal(calls, 1); assert.deepEqual(result.map(model => model.id), ["deepseek-v4.1-flash"]);
  await assert.rejects(fetchCodeBuddyCatalog("BAD\r\n", signal(), async () => { throw new Error("must not send"); }));
  await assert.rejects(fetchCodeBuddyCatalog("FIXTURE", signal(), async () => json({ code: 401, msg: "SECRET", data: {} })), error => !String(error).includes("SECRET"));
});

test("JSON helper rejects other endpoints before sending", async () => {
  let calls = 0;
  const request = createCodeBuddyJsonRequest({ fetch: async () => { calls++; return json({}); } }, "目录");
  for (const path of ["https://evil.invalid", "//evil.invalid", "/v3/config?repo=private", "/v2/chat/completions"])
    await assert.rejects(request(path, {}, signal()), /目标无效/);
  assert.equal(calls, 0);
});

test("RAM catalog isolates accounts, clones reads and invalidates on logout/dispose", async () => {
  const catalog = createCodeBuddyCatalog(async () => json({ data: { availableModels: ["deepseek-v4.1-flash"] } }));
  assert.equal(catalog.get("A", "account-a").source, "builtin");
  const refreshed = await catalog.refresh("A", signal(), "account-a");
  assert.equal(refreshed.source, "network"); assert.equal(refreshed.permissionsVerified, false);
  refreshed.models.length = 0;
  assert.equal(catalog.get("ROTATED", "account-a").models.length, 1);
  assert.equal(catalog.get("B", "account-b").source, "builtin");
  catalog.invalidate(); assert.equal(catalog.get("A", "account-a").source, "builtin");
  catalog.dispose(); assert.throws(() => catalog.get("A"), /关闭/);
});

test("late directory responses cannot publish into another account and their body is closed", async () => {
  let resolve!: (value: Response) => void, canceled = 0;
  const catalog = createCodeBuddyCatalog(() => new Promise<Response>(done => { resolve = done; }));
  const pending = catalog.refresh("A", signal(), "account-a");
  const rejected = assert.rejects(pending, { name: "AbortError" });
  catalog.get("B", "account-b");
  await rejected;
  resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await new Promise(done => setImmediate(done));
  assert.equal(canceled, 1); assert.equal(catalog.get("B", "account-b").source, "builtin");
  catalog.dispose();
});

test("canceling a directory refresh retains only same-account last-good metadata", async () => {
  let calls = 0;
  const catalog = createCodeBuddyCatalog(async () => { if (++calls === 1) return json({ data: { availableModels: ["deepseek-v4.1-flash"] } }); return new Promise<Response>(() => {}); });
  await catalog.refresh("A", signal());
  const controller = new AbortController();
  const pending = catalog.refresh("A", controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort(); await rejected;
  assert.equal(catalog.get("A").models.length, 1);
  assert.equal(catalog.get("B").source, "builtin");
  catalog.dispose();
});
