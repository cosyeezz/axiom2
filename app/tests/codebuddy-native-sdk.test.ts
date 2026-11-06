import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore, InMemoryModelsStore, Type } from "@earendil-works/pi-ai";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { codeBuddyNativeFetch } from "../src/native-providers/codebuddy/http.js";
import { codeBuddyHeaders } from "../src/native-providers/codebuddy/identity.js";
import { withCodeBuddyRunIdentity } from "../src/server/codebuddy-run-identity.js";
import { observeProviderRequests, providerRequestDefaultTransport, providerRequestHttpTransport } from "../src/server/provider-request-observer.js";
import { ProviderRequestTracker } from "../src/server/provider-request-statistics.js";
import type { CodeBuddyProvider } from "../src/server/providers/codebuddy-cn.js";

test("real Agent and ModelRuntime keep native sender, tool execution, history, run identity and cancellation", { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "codebuddy-native-sdk-"));
  const originalFetch = globalThis.fetch, originalRequest = https.request;
  const keys = ["no_proxy", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_MANAGED_ACCOUNTS"], saved = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]); process.env.no_proxy = "*";
  globalThis.fetch = async () => { throw Error("Unexpected generic Fetch"); };
  const tracker = new ProviderRequestTracker(), requests: { body: any; session: string; run: string; invocation: string }[] = [], serverErrors: unknown[] = [];
  let toolCalls = 0, responses = 0, approvals = 0, cancelledBodyClosed = false, pendingCancel: http.ServerResponse | undefined;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.url, "/v2/chat/completions"); assert.equal(req.method, "POST"); assert.equal(req.httpVersion, "1.1");
      assert.equal(req.headers["user-agent"], codeBuddyHeaders["User-Agent"]); assert.equal(req.headers.authorization, "Bearer SYNTHETIC");
      assert.equal(req.headers.connection, "close"); assert.equal(tracker.snapshot().providers[0].current, 1);
      assert.deepEqual(Object.keys(req.headers).sort(), [...Object.keys(codeBuddyHeaders).map(key => key.toLowerCase()),
        "authorization", "accept", "content-type", "x-conversation-id", "x-conversation-request-id", "x-request-id", "x-conversation-message-id",
        "x-root-request-id", "x-agent-type", "x-agent-intent", "x-agent-runtime", "x-agent-purpose",
        "host", "content-length", "connection"].sort());
      assert.equal(req.headers.accept, "application/json");
      assert.equal(req.headers["x-root-request-id"], req.headers["x-conversation-request-id"]);
      assert.equal(req.headers["x-agent-type"], "main"); assert.equal(req.headers["x-agent-intent"], "craft");
      assert.equal(req.headers["x-agent-runtime"], "other"); assert.equal(req.headers["x-agent-purpose"], "conversation");
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks); assert.equal(Number(req.headers["content-length"]), bytes.length);
      const body = JSON.parse(bytes.toString()); assert.equal(body.model, "deepseek-v4.1-flash"); assert.equal(body.reasoning_effort, "none");
      assert.equal(body.cache_retention, "long");
      for (const key of Object.keys(body)) assert.ok(["model", "messages", "stream", "stream_options", "tools", "reasoning_effort", "max_tokens", "temperature", "top_p", "cache_retention"].includes(key));
      assert.match(String(req.headers["x-conversation-id"]), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.notEqual(req.headers["x-conversation-id"], "owned-session");
      assert.equal(req.headers["x-axiom-session"], undefined);
      assert.equal(req.headers["traceparent"], undefined);
      assert.ok(body.messages.some((message: any) => message.role === "system" && message.content.includes("CALLER_POLICY")));
      assert.equal(body.tools[0].function.parameters.properties.path.type, "string");
      const foreign = body.messages.find((m: any) => m.tool_calls?.some((c: any) => c.id === "source_call|fc_source"));
      assert.equal(foreign.reasoning_content, "SOURCE_VISIBLE_REASONING");
      assert.equal(foreign.tool_calls[0].id, "source_call|fc_source");
      assert.ok(body.messages.some((m: any) => m.role === "tool" && m.tool_call_id === "source_call|fc_source" && m.content === "SOURCE_TOOL_VALUE"));
      assert.ok(!bytes.toString().includes("SOURCE_OPAQUE_SIGNATURE"));
      requests.push({ body, session: String(req.headers["x-conversation-id"]), run: String(req.headers["x-conversation-request-id"]), invocation: String(req.headers["x-request-id"]) });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const choice = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      if (requests.length === 1) res.end(choice({ tool_calls: [{ index: 0, id: "owned-call", type: "function", function: { name: "read_fixture", arguments: '{"path":"fixture.txt"}' } }] }, "tool_calls") + "data: [DONE]\n\n");
      else if (requests.length <= 3) res.end(choice({ content: requests.length === 2 ? "TOOL_OK" : "NEXT_OK" }, "stop") + "data: [DONE]\n\n");
      else { pendingCancel = res; res.on("close", () => { cancelledBodyClosed = true; }); res.write(choice({ content: "PARTIAL" }, null)); }
    } catch (error) { serverErrors.push(error); res.destroy(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  // Only the final Node socket destination is redirected. Production URL validation,
  // native fetch, request construction and observer remain unchanged. Not a TLS parity test.
  https.request = ((url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    assert.equal(String(url), "https://copilot.tencent.com/v2/chat/completions");
    assert.equal(options.agent, false);
    return http.request(`http://127.0.0.1:${(server.address() as { port: number }).port}${url.pathname}`, options, callback);
  }) as typeof https.request;
  syncBuiltinESMExports();
  let runtime: Awaited<ReturnType<typeof createModelRuntime>> | undefined, agent: Agent | undefined;
  try {
    const credentials = new InMemoryCredentialStore(); await credentials.modify("codebuddy-cn", async () => ({ type: "api_key", key: "SYNTHETIC" }));
    const modelsPath = join(root, "models.json"); writeFileSync(modelsPath, "{}");
    runtime = await createModelRuntime({ providerIds: ["codebuddy-cn"], credentials, modelsStore: new InMemoryModelsStore(), authPath: join(root, "auth.json"), modelsPath, refreshOnCreate: false });
    const model = runtime.getModel("codebuddy-cn", "deepseek-v4.1-flash")!;
    assert.equal(providerRequestDefaultTransport(runtime, model), codeBuddyNativeFetch);
    let continuationId = "first-run";
    const wrapped = observeProviderRequests(runtime.streamSimple.bind(runtime), event => tracker.observe("fixture", event),
      (m, o) => providerRequestHttpTransport(runtime!, m, o), m => providerRequestDefaultTransport(runtime!, m));
    agent = new Agent({ sessionId: "owned-session", initialState: { model, thinkingLevel: "off", systemPrompt: "CALLER_POLICY: use only the declared fixture tool, preserve history.",
      messages: [
        { role: "user", content: "SOURCE_READ", timestamp: 1 },
        { role: "assistant", api: "openai-responses", provider: "openai", model: "source-model", timestamp: 2, stopReason: "toolUse",
          content: [{ type: "thinking", thinking: "SOURCE_VISIBLE_REASONING", thinkingSignature: "SOURCE_OPAQUE_SIGNATURE" },
            { type: "toolCall", id: "source_call|fc_source", name: "read_fixture", arguments: { path: "fixture.txt" } }],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
        { role: "toolResult", toolCallId: "source_call|fc_source", toolName: "read_fixture", content: [{ type: "text", text: "SOURCE_TOOL_VALUE" }], isError: false, timestamp: 3 },
      ],
      tools: [{ name: "read_fixture", label: "Read owned fixture", description: "Read fixture", parameters: Type.Object({ path: Type.String() }),
        execute: async (_id, params) => { toolCalls++; assert.ok(params && typeof params === "object" && "path" in params); assert.equal(params.path, "fixture.txt"); return { content: [{ type: "text", text: "OWNED_TOOL_RESULT" }], details: {} }; } }] },
      beforeToolCall: async () => { approvals++; return undefined; },
      streamFn: (m, c, o) => wrapped(m, c, withCodeBuddyRunIdentity(m, { ...o, maxRetries: 0, maxTokens: 64, timeoutMs: 3000, headers: { "x-axiom-session": "owned-session", traceparent: "private-trace" }, onResponse: () => { responses++; } }, { sessionId: "owned-session", continuationId })) });
    await agent.prompt("ASK_READ"); assert.equal(agent.state.errorMessage, undefined); assert.equal(toolCalls, 1); assert.equal(approvals, 1);
    continuationId = "second-run"; await agent.prompt("ASK_NEXT"); assert.equal(agent.state.errorMessage, undefined);
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map(request => request.session)).size, 1);
    assert.equal(requests[0].run, requests[1].run);
    assert.notEqual(requests[1].run, requests[2].run);
    for (const request of requests) {
      for (const id of [request.session.replaceAll("-", ""), request.run, request.invocation]) assert.match(id, /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
      assert.ok(!["first-run", "second-run", "owned-session"].includes(request.run));
    }
    assert.equal(new Set(requests.map(request => request.invocation)).size, 3);
    const history = requests[2].body.messages;
    assert.ok(history.some((message: any) => message.role === "assistant" && message.tool_calls?.[0].id === "owned-call"));
    assert.ok(history.some((message: any) => message.role === "tool" && message.tool_call_id === "owned-call" && message.content === "OWNED_TOOL_RESULT"));
    assert.ok(history.some((message: any) => message.role === "user" && message.content === "ASK_READ"));
    assert.ok(history.some((message: any) => message.role === "user" && message.content === "ASK_NEXT"));
    continuationId = "cancel-run";
    agent.subscribe(event => { if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta === "PARTIAL") agent!.abort(); });
    await agent.prompt("ASK_CANCEL"); await agent.waitForIdle();
    assert.equal(agent.state.messages.at(-1)?.role, "assistant"); assert.equal((agent.state.messages.at(-1) as any).stopReason, "aborted");
    for (let i = 0; i < 20 && !cancelledBodyClosed; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(cancelledBodyClosed, true); assert.equal(requests.length, 4); assert.equal(responses, 4); assert.equal(toolCalls, 1);
    assert.deepEqual(serverErrors, []); assert.equal(tracker.snapshot().providers[0].current, 0); assert.equal(tracker.snapshot().providers[0].rpm, 4);
  } finally {
    agent?.abort(); await agent?.waitForIdle(); (runtime?.getRegisteredNativeProvider("codebuddy-cn") as CodeBuddyProvider | undefined)?.dispose();
    https.request = originalRequest; syncBuiltinESMExports(); globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
    pendingCancel?.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
