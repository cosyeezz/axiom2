import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { observeProviderRequests, providerRequestDefaultTransport, providerRequestHttpTransport } from "../src/server/provider-request-observer.js";
import { ProviderRequestTracker } from "../src/server/provider-request-statistics.js";
import { kiroCliUserAgent, kiroNativeFetch } from "../src/server/providers/kiro-native.js";
import { withKiroRunIdentity } from "../src/server/kiro-run-identity.js";

// Uses the real SDK runtime + Axiom provider registration and statistics wrapper.
// Only the destination URL is mapped to a local synthetic upstream; no model request is sent remotely.
test("SDK request observer preserves Kiro native HTTP and statistics instead of injecting generic Fetch", async () => {
  const root = mkdtempSync(join(tmpdir(), "kiro-native-observer-"));
  const oldFetch = globalThis.fetch, oldNoProxy = process.env.no_proxy;
  process.env.no_proxy = "*";
  globalThis.fetch = async () => { throw Error("Unexpected generic Fetch: instrumentation replaced the native sender"); };
  const tracker = new ProviderRequestTracker(); let requests = 0, hookCalls = 0;
  const identity = { sessionId: "local-session", continuationId: "bb20d85e-4717-4cd1-97ec-81865c9d7496" };
  const server = createServer(async (req, res) => {
    try {
      requests++;
      assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/responses"); assert.equal(req.httpVersion, "1.1");
      assert.equal(req.headers["user-agent"], kiroCliUserAgent()); assert.equal(req.headers.connection, "close");
      for (const name of ["accept", "accept-language", "accept-encoding", "sec-fetch-mode"]) assert.equal(req.headers[name], undefined);
      assert.equal(tracker.snapshot().providers[0].current, 1, "statistics remain active through native dispatch");
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks); assert.equal(Number(req.headers["content-length"]), bytes.length);
      const body = JSON.parse(bytes.toString()); assert.equal(body.model, "deepseek-3.2");
      assert.equal(body.metadata["kiro:agent_continuation_id"], identity.continuationId);
      assert.match(body.input[0].content, /caller policy/); assert.match(body.input[0].content, /test input/);
      const item = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "LOCAL_NATIVE_OK" }] };
      const events = [
        { type: "response.created", response: { id: "r1", model: "deepseek-3.2" } },
        { type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
        { type: "response.output_text.delta", output_index: 0, item_id: "m1", content_index: 0, delta: "LOCAL_NATIVE_OK" },
        { type: "response.output_text.done", output_index: 0, item_id: "m1", content_index: 0, text: "LOCAL_NATIVE_OK" },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id: "r1", model: "deepseek-3.2", status: "completed", output: [item] } },
      ];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
    } catch (error) { res.destroy(error as Error); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("kiro", async () => ({ type: "oauth", access: "SYNTHETIC", refresh: "UNUSED", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" }));
    const modelsPath = join(root, "models.json");
    writeFileSync(modelsPath, JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{ id: "deepseek-3.2", baseUrl: "https://q.us-east-1.amazonaws.com", contextWindow: 100000, maxTokens: 8192 }] } } }));
    const runtime = await createModelRuntime({ providerIds: ["kiro"], credentials, modelsStore: new InMemoryModelsStore(), modelsPath, refreshOnCreate: false });
    assert.equal(runtime.getError(), undefined);
    const model = runtime.getModel("kiro", "deepseek-3.2")!; assert.ok(model);
    assert.equal(providerRequestDefaultTransport(runtime, model), kiroNativeFetch, "production registry selects the provider sender");
    const native = runtime.getRegisteredNativeProvider("kiro")!, saved = native.streamSimple;
    native.streamSimple = () => { throw Error("extension"); };
    assert.equal(providerRequestDefaultTransport(runtime, model), undefined, "extension replacement invalidates native transport identity");
    native.streamSimple = saved;
    const wrapped = observeProviderRequests(runtime.stream.bind(runtime), event => tracker.observe("test-worker", event),
      (m, o) => providerRequestHttpTransport(runtime, m, o), m => {
        const transport = providerRequestDefaultTransport(runtime, m)!;
        assert.equal(transport, kiroNativeFetch);
        return (url, init) => {
          assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/v1/responses");
          return transport(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/responses`, init);
        };
      });
    const stream = wrapped(model, { systemPrompt: "caller policy", messages: [{ role: "user", content: "test input", timestamp: 1 }] }, withKiroRunIdentity(model, { sessionId: identity.sessionId, onResponse: () => { hookCalls++; }, signal: AbortSignal.timeout(5000) }, identity));
    const result = await stream.result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.deepEqual(result.content, [{ type: "text", text: "LOCAL_NATIVE_OK" }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 1); assert.equal(hookCalls, 1);
    assert.deepEqual(tracker.snapshot().providers, [{ providerId: "kiro", current: 0, peak: 1, rpm: 1, callLevel: false }]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldNoProxy === undefined) delete process.env.no_proxy; else process.env.no_proxy = oldNoProxy;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
