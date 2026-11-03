import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Agent, getGlobalDispatcher, install, setGlobalDispatcher } from "undici";
import { createModels, type Context } from "@earendil-works/pi-ai";
import { QoderImages } from "../src/server/providers/qoder-images.js";
import { qoderProvider } from "../src/server/providers/qoder.js";
import { normalizeQoderConfig, qoderDescriptor } from "../src/server/providers/qoder-catalog.js";
import { decodeQoderBody, qoderFailure, qoderSites, type QoderIdentity } from "../src/server/providers/qoder-protocol.js";
import { unwrapQoderSse } from "../src/server/providers/qoder-sse.js";

const identity: QoderIdentity = { token: "dt-FIXTURE", userId: "fixture-user", machineId: "fixture-machine" };
const endpoint = "https://gateway.qoder.com.cn", remote = "https://images.fixture.invalid/image.png?fixture=1";
const png = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } as const;
const inline = `data:${png.mimeType};base64,${png.data}`;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const part = (url = inline) => ({ type: "image_url", image_url: { url } });
const payload = (url = inline) => ({ messages: [{ role: "user", content: [part(url)], contents: [part(url)] }] });
const sse = (delta: unknown, reason = "stop") => new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });

test("Qoder upload accepts all five CLI response envelopes and signs multipart length, not image bytes", async () => {
  for (const envelope of [{ url: remote }, { result: { url: remote } }, { result: { oss_url: remote } }, { data: { url: remote } }, { data: { oss_url: remote } }]) {
    let calls = 0; const input = payload();
    await new QoderImages().prepare(input, endpoint, identity, "agree", async (url, init) => {
      calls++; const parsed = new URL(String(url)), headers = new Headers(init?.headers), bytes = Buffer.from(init?.body as Uint8Array);
      assert.equal(parsed.origin, endpoint); assert.equal(parsed.pathname, "/algo/api/v2/image/upload");
      assert.match(parsed.searchParams.get("request_id")!, /^[a-f0-9]{32}$/);
      assert.equal(init?.method, "PUT"); assert.equal(init?.redirect, "error"); assert.equal(headers.has("content-length"), false);
      assert.match(headers.get("ai-client-timestamp")!, /^\d{10}$/); assert.equal(headers.get("cosy-data-policy"), "agree");
      assert.equal(headers.get("cosy-user"), identity.userId); assert.equal(headers.get("cosy-machinehostname"), null);
      const boundary = headers.get("content-type")!.split("boundary=")[1]; assert.match(boundary, /^----qodercli-[a-f0-9]{32}$/);
      assert.ok(bytes.includes(Buffer.from('name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n')));
      assert.ok(bytes.includes(Buffer.from(png.data, "base64"))); assert.ok(bytes.toString().endsWith(`\r\n--${boundary}--\r\n`));
      const [auth, signature] = headers.get("authorization")!.slice("Bearer COSY.".length).split(".");
      const expected = createHash("md5").update(`${auth}\n${headers.get("cosy-key")}\n${headers.get("cosy-date")}\n${bytes.length}\n/api/v2/image/upload`).digest("hex");
      assert.equal(signature, expected); return json(envelope);
    });
    assert.equal(calls, 1); assert.equal(input.messages[0].content[0].image_url.url, remote);
    assert.deepEqual(input.messages[0].contents, input.messages[0].content);
  }
});

test("Qoder upload deduplicates user/tool projections and isolates completed cache by account, token and endpoint", async () => {
  const images = new QoderImages(); let calls = 0;
  const transport: typeof fetch = async () => { calls++; return json({ result: { url: remote } }); };
  const tool = { role: "tool", tool_call_id: "call-1", is_error: true, content: [part()], contents: [part()] };
  const first = { messages: [...payload().messages, tool] };
  await images.prepare(first, endpoint, identity, "agree", transport);
  assert.equal(calls, 1); assert.equal(tool.content[0].image_url.url, remote);
  assert.equal(tool.tool_call_id, "call-1"); assert.equal(tool.is_error, true);
  await images.prepare(payload(), endpoint, identity, "agree", transport); assert.equal(calls, 1);
  await images.prepare(payload(), endpoint, { ...identity, userId: "other" }, "agree", transport);
  await images.prepare(payload(), endpoint, { ...identity, token: "dt-OTHER" }, "agree", transport);
  await images.prepare(payload(), "https://center.qoder.sh", identity, "agree", transport);
  assert.equal(calls, 4);
});

test("Qoder upload cache evicts beyond 512 entries and batch concurrency never exceeds three", async () => {
  const images = new QoderImages(); let calls = 0, active = 0, maximum = 0;
  const transport: typeof fetch = async () => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return json({ url: remote }); };
  const sources = Array.from({ length: 513 }, (_, i) => `data:image/png;base64,${Buffer.from(`fixture-${i}`).toString("base64")}`);
  await images.prepare({ messages: [{ content: sources.map(url => part(url)) }] }, endpoint, identity, "agree", transport);
  assert.equal(calls, 513); assert.equal(maximum, 3);
  await images.prepare(payload(sources[0]), endpoint, identity, "agree", transport); assert.equal(calls, 514);
});

test("Qoder upload failure preserves inline data without retry, leaked error or failed cache entry", async () => {
  const failures = [
    () => new Response("SECRET", { status: 401 }), () => new Response("SECRET", { status: 403 }),
    () => new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } }),
    () => new Response("not json"), () => json({ success: true }), () => json({ url: "http://untrusted.invalid" }),
    () => json({ url: "https://user:password@untrusted.invalid" }), () => { throw Error("SECRET"); },
  ];
  for (const fail of failures) {
    const images = new QoderImages(); let calls = 0;
    const transport: typeof fetch = async () => { calls++; return fail(); };
    for (let i = 0; i < 2; i++) { const input = payload(); await images.prepare(input, endpoint, identity, "disagree", transport); assert.equal(input.messages[0].content[0].image_url.url, inline); }
    assert.equal(calls, 2, "each invocation attempts once; failed uploads are not cached");
  }
});

test("Qoder upload cancellation never caches a late URL or replaces inline data", async () => {
  const images = new QoderImages(), controller = new AbortController(), input = payload(); let calls = 0;
  controller.abort(); await assert.rejects(images.prepare(input, endpoint, identity, "agree", async () => { calls++; return json({ url: remote }); }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
  const next = new AbortController();
  await assert.rejects(images.prepare(input, endpoint, identity, "agree", async () => { calls++; next.abort(); return json({ url: remote }); }, next.signal), { name: "AbortError" });
  assert.equal(input.messages[0].content[0].image_url.url, inline);
  await images.prepare(payload(), endpoint, identity, "agree", async () => { calls++; return json({ url: remote }); }); assert.equal(calls, 2);
});

test("Qoder SDK uploads before final hook, retains original user/tool history and caches the next replay", async () => {
  for (const region of ["cn", "intl"] as const) {
    const provider = qoderProvider(region), models = createModels(); models.setProvider(provider);
    const config = normalizeQoderConfig({ key: "fixture", source: "system", is_vl: true })!, model = qoderDescriptor(region, config);
    const apiKey = JSON.stringify({ ...identity, region }); let uploads = 0, inference = 0, hooks = 0;
    const transport: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("endpoints")) return json({ inferNodes: [region === "cn" ? endpoint : "https://api2.qoder.sh"] });
      if (path.endsWith("getDataPolicy")) return json({ result: { status: "AGREE" } });
      if (path.endsWith("model/list")) return json({ chat: [config] });
      if (path.endsWith("image/upload")) { uploads++; assert.equal(new URL(String(url)).origin, qoderSites[region].center); return json({ result: { url: remote } }); }
      assert.ok(path.includes("/sse/")); inference++; const body = JSON.parse(decodeQoderBody(String(init?.body)));
      if (inference === 1) return sse({ tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "read", arguments: '{"path":"fixture.png"}' } }] }, "tool_calls");
      const tool = body.messages.find((message: any) => message.role === "tool");
      assert.equal(body.system, "Keep real caller policy"); assert.equal(tool.tool_call_id, "call-1"); assert.equal(tool.is_error, undefined, "non-error tool results omit the optional is_error flag");
      assert.deepEqual(tool.content, [{ type: "text", text: "actual image" }, part(remote)]); assert.deepEqual(tool.contents, tool.content);
      assert.deepEqual(body.messages.at(-1).content, [{ type: "text", text: "compare" }, part(remote)]);
      return sse({ content: "fixture response" });
    };
    const initial: Context = { systemPrompt: "Keep real caller policy", messages: [{ role: "user", content: "read the fixture", timestamp: 1 }] };
    const first = await models.completeSimple(model, initial, { apiKey, fetch: transport }); assert.equal(first.stopReason, "toolUse", first.errorMessage);
    const context: Context = { ...initial, messages: [...initial.messages, first,
      { role: "toolResult", toolCallId: "call-1", toolName: "read", isError: false, timestamp: 2, content: [{ type: "text", text: "actual image" }, png] },
      { role: "user", timestamp: 3, content: [{ type: "text", text: "compare" }, png] },
    ] };
    const before = JSON.stringify(context);
    for (let i = 0; i < 2; i++) {
      const result = await models.completeSimple(model, context, { apiKey, fetch: transport, onPayload(value) { hooks++; assert.equal((value as any).messages.find((message: any) => message.role === "tool").content[1].image_url.url, remote); } });
      assert.equal(result.stopReason, "stop", result.errorMessage);
    }
    assert.deepEqual([uploads, inference, hooks], [1, 3, 2]); assert.equal(JSON.stringify(context), before);
  }
});

test("Qoder SDK cancellation during upload sends no inference or final hook and never reuses the late result", async () => {
  const provider = qoderProvider("cn"), models = createModels(); models.setProvider(provider);
  const config = normalizeQoderConfig({ key: "fixture", is_vl: true })!, model = qoderDescriptor("cn", config);
  const apiKey = JSON.stringify({ ...identity, region: "cn" }), controller = new AbortController(); let inference = 0, uploads = 0, hooks = 0;
  const context: Context = { messages: [{ role: "user", timestamp: 1, content: [png] }] };
  const transport: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("endpoints")) return json({ inferNodes: [endpoint] });
    if (path.endsWith("getDataPolicy")) return json({ result: { status: "AGREE" } });
    if (path.endsWith("model/list")) return json({ chat: [config] });
    if (path.endsWith("image/upload")) { uploads++; if (uploads === 1) controller.abort(); return json({ url: remote }); }
    assert.ok(path.includes("/sse/")); inference++; return sse({ content: "ok" });
  };
  const aborted = await models.completeSimple(model, context, { apiKey, fetch: transport, signal: controller.signal, onPayload() { hooks++; } });
  assert.equal(aborted.stopReason, "aborted"); assert.deepEqual([uploads, inference, hooks], [1, 0, 0]);
  const next = await models.completeSimple(model, context, { apiKey, fetch: transport }); assert.equal(next.stopReason, "stop", next.errorMessage);
  assert.deepEqual([uploads, inference], [2, 1]);
});

test("Qoder business code 406 is a sanitized non-replayed content-safety error, not a generic HTTP 406 assumption", async () => {
  for (const detail of [{ code: "406", message: "SECRET" }, { code: 403, message: JSON.stringify({ code: 406, message: "SECRET" }) }]) {
    const error = qoderFailure(406, detail, "sse"); assert.match(error.message, /内容安全.*406.*未自动重放/); assert.doesNotMatch(error.message, /SECRET|签名|重新登录/);
  }
  assert.doesNotMatch(qoderFailure(406).message, /内容安全/);
  const response = new Response(`data: ${JSON.stringify({ statusCodeValue: 406, body: JSON.stringify({ code: "406", message: "SECRET" }) })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  await assert.rejects(unwrapQoderSse(response).text(), error => error instanceof Error && /内容安全.*406.*未自动重放/.test(error.message) && !error.message.includes("SECRET"));
});

test("Qoder multipart final local wire has one exact Content-Length with builtin and installed Undici Fetch", async () => {
  const names = ["fetch", "Headers", "Response", "Request", "FormData", "WebSocket", "CloseEvent", "ErrorEvent", "MessageEvent", "EventSource"] as const;
  const globals = Object.fromEntries(names.map(name => [name, (globalThis as any)[name]])), originalDispatcher = getGlobalDispatcher(), dispatcher = new Agent();
  const requests: { length: number; declared: string | undefined; headerCount: number }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ length: Buffer.concat(chunks).length, declared: req.headers["content-length"], headerCount: req.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === "content-length").length });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ url: remote }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    setGlobalDispatcher(dispatcher); install(); const port = (server.address() as { port: number }).port;
    for (const sender of [globals.fetch as typeof fetch, globalThis.fetch]) {
      const input = payload();
      await new QoderImages().prepare(input, endpoint, identity, "agree", (url, init) => {
        const parsed = new URL(String(url)); assert.equal(parsed.origin, endpoint); assert.equal(parsed.pathname, "/algo/api/v2/image/upload");
        return sender(`http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`, init);
      });
      assert.equal(input.messages[0].content[0].image_url.url, remote);
    }
    assert.equal(requests.length, 2); for (const request of requests) { assert.equal(request.headerCount, 1); assert.equal(request.declared, String(request.length)); }
  } finally {
    Object.assign(globalThis, globals); setGlobalDispatcher(originalDispatcher); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); await dispatcher.close();
  }
});
