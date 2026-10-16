import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { discoverModels } from "../src/server/model-discovery.js";

test("endpoint discovery preserves prefixes, applies protocol auth, and follows bounded pagination", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture");
    seen.push(req.url!);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/proxy/v1/models") {
      assert.equal(req.headers.authorization, "Bearer OVERRIDE");
      res.end(JSON.stringify({ data: [{ id: "remote-model" }, { id: "remote-model" }] }));
    } else if (url.pathname === "/v1/models" || url.pathname === "/anthropic/v1/models") {
      assert.equal(req.headers["x-api-key"], "KEY");
      assert.equal(req.headers["anthropic-version"], "2023-06-01");
      assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify(url.searchParams.has("after_id")
        ? { data: [{ id: "claude-b", display_name: "Claude B" }], has_more: false }
        : { data: [{ id: "claude-a", display_name: "Claude A" }], has_more: true, last_id: "claude-a" }));
    } else if (url.pathname === "/proxy/v1beta/models") {
      assert.equal(req.headers["x-goog-api-key"], "KEY");
      assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify(url.searchParams.has("pageToken")
        ? { models: [{ name: "models/gemini-b", displayName: "Gemini B" }] }
        : { models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "next" }));
    } else {
      res.statusCode = 404;
      res.end("unexpected path");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const api of ["openai-completions", "openai-responses"]) {
      const models = await discoverModels({ baseUrl: origin + "/proxy/v1/", api, auth: { apiKey: "KEY", headers: { Authorization: "Bearer OVERRIDE" } }, signal: AbortSignal.timeout(5000) });
      assert.deepEqual(models, [{ id: "remote-model", name: "remote-model" }]);
    }
    const anthropic = await discoverModels({ baseUrl: origin, api: "anthropic-messages", auth: { apiKey: "KEY" }, signal: AbortSignal.timeout(5000) });
    assert.deepEqual(anthropic.map((m) => m.id), ["claude-a", "claude-b"]);
    assert.ok(seen.includes("/v1/models?after_id=claude-a"));
    for (const suffix of ["/anthropic/", "/anthropic/v1/"]) {
      assert.equal((await discoverModels({ baseUrl: origin + suffix, api: "anthropic-messages", auth: { apiKey: "KEY" }, signal: AbortSignal.timeout(5000) })).length, 2);
    }
    assert.ok(seen.includes("/anthropic/v1/models?after_id=claude-a"));
    const google = await discoverModels({ baseUrl: origin + "/proxy/v1beta/", api: "google-generative-ai", auth: { apiKey: "KEY" }, signal: AbortSignal.timeout(5000) });
    assert.deepEqual(new Set(google.map((m) => m.id)), new Set(["gemini-a", "gemini-b"]));
    assert.ok(seen.includes("/proxy/v1beta/models?pageToken=next"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("discovery rejects failures, redirects, malformed/oversized results, cursor loops and cancellation", async () => {
  let mode = "status", redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === "/leak") redirected++;
    if (mode === "status") { res.writeHead(401); res.end("PRIVATE-SECRET"); }
    else if (mode === "redirect") { res.writeHead(302, { location: "/leak" }); res.end(); }
    else if (mode === "json") res.end("PRIVATE-SECRET not JSON");
    else if (mode === "shape") res.end(JSON.stringify({ error: "PRIVATE-SECRET" }));
    else if (mode === "id") res.end(JSON.stringify({ data: [{ id: "bad\nid" }] }));
    else if (mode === "size") res.end("x".repeat(2_000_001));
    else if (mode === "count") res.end(JSON.stringify({ data: Array.from({ length: 1001 }, (_, i) => ({ id: `id-${i}` })) }));
    else if (mode === "cursor") res.end(JSON.stringify({ data: [{ id: "a" }], has_more: true, last_id: "same" }));
    else if (mode === "empty") res.end(JSON.stringify({ data: [] }));
    else { res.writeHead(200); res.write('{"data":['); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const failure of ["status", "redirect", "json", "shape", "id", "size", "count", "cursor"]) {
      mode = failure;
      await assert.rejects(discoverModels({ baseUrl, api: "openai-completions", auth: { apiKey: "PRIVATE-SECRET" }, signal: AbortSignal.timeout(5000) }),
        (error: any) => error.code === "MODEL_DISCOVERY_FAILED" && !error.message.includes("PRIVATE-SECRET"), failure);
    }
    assert.equal(redirected, 0);
    mode = "empty";
    assert.deepEqual(await discoverModels({ baseUrl, api: "openai-completions", signal: AbortSignal.timeout(5000) }), []);
    mode = "timeout";
    await assert.rejects(discoverModels({ baseUrl, api: "openai-completions", signal: AbortSignal.timeout(50) }));
    await assert.rejects(discoverModels({ baseUrl, api: "unsupported", signal: AbortSignal.timeout(5000) }), { code: "MODEL_DISCOVERY_FAILED" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
