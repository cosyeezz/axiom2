// Plain Node synthetic-only public component fixture. No Pi, TS loader or real credentials.
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
let network = 0, authRequests = 0, catalogRequests = 0, modelRequests = 0, toolRuns = 0, notices = 0, serverError;
const forbidden = () => { network++; throw Error("External network forbidden"); };
globalThis.fetch = forbidden;
https.request = forbidden;
const originalHttp = http.request;
let localUrl;
http.request = (...args) => { assert.equal(String(args[0]), localUrl); return originalHttp(...args); };
syncBuiltinESMExports();
const component = await import(pathToFileURL(process.argv[2]).href);
assert.equal(network, 0);
const { createCodeBuddyNativeProvider, createNativeAccount, codeBuddyNativeFetch, codeBuddyHeaders } = component;
const context = { systemPrompt: "OWNED_CALLER_POLICY", tools: [{ name: "read_fixture", description: "Read fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }], messages: [{ role: "user", content: "OWNED_READ" }] };
const invocations = new Set();
const server = http.createServer(async (req, res) => {
  try {
    modelRequests++; assert.ok(modelRequests <= 3); assert.equal(req.url, "/v2/chat/completions");
    assert.equal(req.headers["user-agent"], codeBuddyHeaders["User-Agent"]); assert.equal(req.headers.authorization, "Bearer SYNTHETIC-REFRESHED");
    assert.equal(req.headers["x-conversation-id"], "owned-session"); assert.equal(req.headers["x-conversation-request-id"], modelRequests === 3 ? "next-run" : "first-run");
    assert.ok(!invocations.has(req.headers["x-request-id"])); invocations.add(req.headers["x-request-id"]);
    const chunks = []; for await (const part of req) chunks.push(part); const bytes = Buffer.concat(chunks);
    assert.equal(Number(req.headers["content-length"]), bytes.length); const body = JSON.parse(bytes.toString());
    assert.equal(body.model, "deepseek-v4.1-flash"); assert.equal(body.reasoning_effort, "none"); assert.equal(body.max_tokens, 64);
    assert.equal(body.messages[0].content, context.systemPrompt); assert.deepEqual(body.tools[0].function.parameters, context.tools[0].parameters);
    if (modelRequests > 1) {
      assert.ok(body.messages.some(message => message.role === "assistant" && message.tool_calls?.[0].id === "owned-call"));
      assert.ok(body.messages.some(message => message.role === "tool" && message.tool_call_id === "owned-call" && message.content === "OWNED_RESULT"));
    }
    if (modelRequests === 3) assert.ok(body.messages.some(message => message.role === "user" && message.content === "OWNED_NEXT"));
    const delta = modelRequests === 1 ? { tool_calls: [{ index: 0, id: "owned-call", type: "function", function: { name: "read_fixture", arguments: '{"path":"owned"}' } }] } : { content: "OWNED_OK" };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: modelRequests === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) { serverError = error; res.destroy(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
localUrl = `http://127.0.0.1:${server.address().port}/v2/chat/completions`;
https.request = (url, options, callback) => { assert.equal(String(url), "https://copilot.tencent.com/v2/chat/completions"); return http.request(localUrl, options, callback); };
syncBuiltinESMExports();
const provider = createCodeBuddyNativeProvider({ pollIntervalMs: 1, requestTimeoutMs: 1000, fetch: async (url, init) => {
  const target = new URL(url); assert.equal(target.origin, "https://copilot.tencent.com");
  if (target.pathname === "/v2/chat/completions") return codeBuddyNativeFetch(url, init);
  assert.equal(init.redirect, "error"); let data;
  if (target.pathname === "/v3/config") { catalogRequests++; assert.equal(init.method, "GET"); assert.equal(new Headers(init.headers).get("authorization"), "Bearer SYNTHETIC-REFRESHED"); data = { models: [], availableModels: ["deepseek-v4.1-flash"] }; }
  else {
    authRequests++;
    if (target.pathname === "/v2/plugin/auth/state") data = { state: "fixture", authUrl: "https://fixture.invalid/authorize" };
    else if (target.pathname === "/v2/plugin/auth/token") data = { accessToken: "SYNTHETIC", refreshToken: "SYNTHETIC-REFRESH", expiresIn: 3600 };
    else { assert.equal(target.pathname, "/v2/plugin/auth/token/refresh"); assert.equal(new Headers(init.headers).get("x-refresh-token"), "SYNTHETIC-REFRESH"); data = { accessToken: "SYNTHETIC-REFRESHED", refreshToken: "SYNTHETIC-ROTATED", expiresIn: 3600 }; }
  }
  return Response.json({ code: 0, data });
} });
let credential, revision = 0, queue = Promise.resolve();
const snapshot = () => structuredClone({ revision: String(revision), credential });
const store = { async read(signal) { signal.throwIfAborted(); return snapshot(); }, transaction(update, signal) {
  const work = queue.then(async () => { signal.throwIfAborted(); const next = await update(snapshot()); signal.throwIfAborted(); if (next !== undefined) { credential = next === null ? undefined : structuredClone(next); revision++; } return snapshot(); });
  queue = work.then(() => {}, () => {}); return work;
} };
const account = createNativeAccount(provider.auth, store), signal = AbortSignal.timeout(10000);
try {
  await account.login({ signal, prompt: async () => { throw Error("unexpected prompt"); }, notify(notice) { assert.equal(notice.type, "auth_url"); notices++; } });
  await store.transaction(async current => ({ ...current.credential, expires: 0 }), signal);
  const current = await account.resolve(signal); assert.equal(current.refresh, "SYNTHETIC-ROTATED");
  const catalog = await provider.catalog(current, signal); assert.equal(catalog.permissionsVerified, false); assert.equal(catalog.models.length, 1);
  const model = catalog.models[0]; assert.equal(model.id, "deepseek-v4.1-flash");
  for (let turn = 0; turn < 3; turn++) {
    const events = [];
    for await (const event of provider.stream({ model, access: current.access, context, options: { signal, sessionId: "owned-session", continuationId: turn === 2 ? "next-run" : "first-run", reasoning: "off", maxTokens: 64,
      validateToolInput(definition, call) { assert.deepEqual(definition.parameters, context.tools[0].parameters); assert.deepEqual(call.arguments, { path: "owned" }); return call.arguments; } } })) events.push(event);
    if (serverError) throw serverError;
    assert.equal(events.some(event => event.type === "error"), false); assert.equal(events.at(-1).type, "done");
    if (turn === 0) {
      assert.equal(events.at(-1).reason, "toolUse"); const call = events.find(event => event.type === "tool-end").call;
      // Host approval/execution only after complete success, never a fragment.
      toolRuns++; context.messages.push({ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...call }] }, { role: "toolResult", toolName: call.name, toolCallId: call.id, content: "OWNED_RESULT", isError: false });
    } else {
      const text = events.filter(event => event.type === "text").map(event => event.delta).join(""); assert.equal(text, "OWNED_OK");
      context.messages.push({ role: "assistant", stopReason: "stop", content: [{ type: "text", text }] }, { role: "user", content: "OWNED_NEXT" });
    }
  }
  await account.logout(signal); assert.equal((await store.read(signal)).credential, undefined);
  provider.dispose(); assert.throws(() => provider.getCatalog(current)); await assert.rejects(async () => provider.auth.refresh(current, signal));
  const rejected = []; for await (const event of provider.stream({ model, access: current.access, context })) rejected.push(event);
  assert.equal(rejected.at(-1).reason, "aborted"); assert.equal(authRequests, 3); assert.equal(catalogRequests, 1); assert.equal(modelRequests, 3); assert.equal(toolRuns, 1); assert.equal(notices, 1); assert.equal(network, 0);
  console.log(JSON.stringify({ login: true, refresh: true, logout: true, disposal: true, authRequests, catalogRequests, modelRequests, toolRuns, network, piLoaded: false }));
} finally { account.dispose(); provider.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
