import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createModels } from "@earendil-works/pi-ai";
import { qoderProvider } from "../src/server/providers/qoder.js";
import { qoderOAuth } from "../src/server/providers/qoder-auth.js";
import { decodeQoderBody } from "../src/server/providers/qoder-protocol.js";

// Real fetch and local HTTP receiver: final implicit transport headers, not just constructed objects.
// All credentials and messages are synthetic. No external network, CLI credentials or debug body logs.
test("Qoder final HTTP wire uses CLI header allowlists across auth, catalog and inference", async () => {
  const requests: { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, any> }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const path = new URL(req.url!, "http://fixture").pathname, raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(path.includes("/sse/") ? decodeQoderBody(raw) : raw) : {};
    requests.push({ path, headers: req.headers, body });
    res.setHeader("Content-Type", path.includes("/sse/") ? "text/event-stream" : "application/json");
    if (path.endsWith("poll")) res.end(JSON.stringify({ token: "dt-FIXTURE", refresh_token: "fixture-refresh", user_id: "fixture-user", expires_in: 3600 }));
    else if (path.endsWith("refresh")) res.end(JSON.stringify({ device_token: "dt-NEW", refresh_token: "fixture-new-refresh", expires_at: Date.now() + 3600000 }));
    else if (path.endsWith("exchange")) res.end(JSON.stringify({ token: "jt-FIXTURE", expires_in: 3600 }));
    else if (path.endsWith("userinfo")) res.end(JSON.stringify({ uid: "fixture-user" }));
    else if (path.endsWith("endpoints")) res.end(JSON.stringify({ inferNodes: ["https://gateway.qoder.com.cn"] }));
    else if (path.endsWith("getDataPolicy")) res.end(JSON.stringify({ result: { status: "AGREE" } }));
    else if (path.endsWith("model/list")) res.end(JSON.stringify({ chat: [{ key: "fixture", source: "system", max_output_tokens: 128 }] }));
    else if (path.includes("/sse/")) res.end('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\nevent: finish\ndata: {"firstTokenDuration":10,"totalDuration":20,"serverDuration":15}\n\n');
    else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port, original = globalThis.fetch;
  const transport: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    assert.ok(["openapi.qoder.com.cn", "gateway.qoder.com.cn"].includes(url.hostname));
    return original(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init);
  };
  try {
    const oauth = qoderOAuth("cn", { fetch: transport });
    const signal = new AbortController().signal;
    const credential = await oauth.login({ signal, notify() {}, prompt: async () => { throw Error("unexpected prompt"); } });
    await oauth.refresh!(credential, signal);
    const provider = qoderProvider("cn");
    globalThis.fetch = transport;
    await provider.refreshModels!({ allowNetwork: true, credential: { type: "api_key", key: "pt-FIXTURE" }, signal, publish: async p => { p.update?.(); return true; } });
    const models = createModels(); models.setProvider(provider);
    const model = { ...provider.getModels()[0], headers: { "X-Host-Identity": "PRIVATE", "User-Agent": "Pi/SDK" } };
    const result = await models.completeSimple(model, { systemPrompt: "Retain caller policy", messages: [{ role: "user", content: "hello", timestamp: 1 }] }, {
      apiKey: "pt-FIXTURE", sessionId: "PRIVATE-HOST-SESSION", fetch: transport,
      headers: { "User-Agent": "Axiom injected", "X-Axiom-Identity": "PRIVATE", "Cosy-MachineHostname": "PRIVATE", "x-stainless-lang": "typescript" },
    });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(requests.length, 8);
    const implicit = ["host", "connection", "accept", "accept-encoding", "accept-language", "sec-fetch-mode", "content-length", "user-agent", "content-type"];
    const client = ["cosy-version", "cosy-clienttype", "cosy-machineos"];
    const auth = ["authorization", "cosy-business-product", "cosy-business-type", "cosy-data-policy", "cosy-date", "cosy-key", "cosy-machineid", "cosy-scene", "cosy-user", "login-version"];
    for (const request of requests) {
      const { path, headers } = request;
      const openapi = path.startsWith("/api/v1/");
      const v5 = path.includes("/v5/");
      const infer = path.includes("/sse/");
      const allowed = new Set([...implicit, ...client, ...(openapi ? ["x-request-id", ...(path.endsWith("userinfo") ? ["authorization"] : [])] : v5 ? ["authorization", "cosy-machineid", "cosy-machinetoken", "x-gw-user-id"] : [...auth, ...(infer ? ["cache-control", "x-model-key", "x-model-source"] : ["cosy-clientip", "cosy-machinetoken", "cosy-machinetype"])])]);
      assert.deepEqual(Object.keys(headers).filter(key => !allowed.has(key)), [], path);
      assert.equal(headers["cosy-version"], "1.1.81");
      assert.equal(headers["user-agent"], openapi && !path.endsWith("poll") ? "qoder/1.1.81" : "undici");
      for (const key of ["x-axiom-identity", "x-host-identity", "x-stainless-lang", "cosy-machinehostname", "cosy-bodyhash", "cosy-bodylength", "cosy-sigpath"]) assert.equal(headers[key], undefined);
      if (infer) {
        assert.equal(headers["cosy-data-policy"], "agree");
        assert.equal(headers["cosy-machinetoken"], undefined);
        assert.equal(request.body.system, "Retain caller policy");
        assert.notEqual(request.body.session_id, "PRIVATE-HOST-SESSION");
        assert.match(request.body.session_id, /^[0-9a-f-]{36}$/);
        assert.equal(request.body.business.version, "1.1.81");
      }
    }
  } finally {
    globalThis.fetch = original;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
