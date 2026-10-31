import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { test, type TestContext } from "node:test";
import { codeBuddyNativeFetch, codeBuddyNativeHttp, codeBuddyProxy } from "../src/native-providers/codebuddy/http.js";
import { codeBuddyHeaders } from "../src/native-providers/codebuddy/identity.js";
import { createCodeBuddyClient } from "../src/native-providers/codebuddy/client.js";
import { codeBuddyBuiltinModels } from "../src/native-providers/codebuddy/models.js";
import type { NativeContext, NativeTool, NativeToolCall } from "../src/native-providers/contracts.js";
async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []; for await (const event of events) result.push(event); return result;
}
async function loopback(t: TestContext, listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  return new URL(`http://127.0.0.1:${address.port}/fixture`);
}

test("CodeBuddy actual Node sender uses exact UTF8 content length, UA and one HTTP1.1 request", async t => {
  const body = JSON.stringify({ text: "中文🙂" }); let requests = 0;
  const url = await loopback(t, (request, response) => {
    requests++; assert.equal(request.method, "POST"); assert.equal(request.httpVersion, "1.1");
    assert.equal(request.headers["user-agent"], "CLI/2.179.0 CodeBuddy/2.179.0");
    assert.equal(request.headers["content-length"], String(Buffer.byteLength(body)));
    assert.equal(request.headers["authorization"], "Bearer FIXTURE"); assert.equal(request.headers["connection"], "close");
    const parts: Buffer[] = [];
    request.on("data", part => parts.push(part)); request.on("end", () => {
      assert.equal(Buffer.concat(parts).toString("utf8"), body);
      response.writeHead(200, { "content-type": "text/event-stream" }); response.end("data: fixture\n\n");
    });
  });
  const response = await codeBuddyNativeHttp(url, new Headers({ ...codeBuddyHeaders, Authorization: "Bearer FIXTURE" }), body, new AbortController().signal, {});
  assert.equal(response.status, 200); assert.equal(await response.text(), "data: fixture\n\n"); assert.equal(requests, 1);
});

test("native sender does not follow redirects or retry server errors", async t => {
  for (const status of [302, 429, 500]) {
    let requests = 0;
    const url = await loopback(t, (_request, response) => { requests++; response.writeHead(status, { location: "http://127.0.0.1:1/never" }); response.end("fixture"); });
    const response = await codeBuddyNativeHttp(url, new Headers(), "{}", new AbortController().signal, {});
    assert.equal(response.status, status); await response.text(); assert.equal(requests, 1);
  }
});

test("native request cancellation closes an active response stream", async t => {
  const url = await loopback(t, (_request, response) => { response.writeHead(200); response.write("first"); });
  const controller = new AbortController();
  const response = await codeBuddyNativeHttp(url, new Headers(), "{}", controller.signal, {});
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
  controller.abort(); await assert.rejects(reader.read()); reader.releaseLock();
});

test("proxy resolution uses lowercase precedence, NO_PROXY matching and fail-closed validation", () => {
  const url = new URL("https://copilot.tencent.com/v2/chat/completions");
  assert.equal(codeBuddyProxy(url, { https_proxy: "http://lower:8080", HTTPS_PROXY: "http://upper:8080" })?.hostname, "lower");
  for (const no_proxy of ["*", "copilot.tencent.com", ".tencent.com", "*.tencent.com", "copilot.tencent.com:443"])
    assert.equal(codeBuddyProxy(url, { no_proxy, https_proxy: "http://proxy:8080" }), undefined);
  assert.equal(codeBuddyProxy(url, { no_proxy: "copilot.tencent.com:80", https_proxy: "http://proxy:8080" })?.hostname, "proxy");
  for (const https_proxy of ["socks5://proxy", "http://proxy/path", "SECRET"]) assert.throws(() => codeBuddyProxy(url, { https_proxy }), error => !String(error).includes("SECRET"));
});

test("independent client uses actual Node sender for a bounded tool-result roundtrip", async t => {
  const model = codeBuddyBuiltinModels().find(model => model.id === "deepseek-v4.1-flash")!;
  let requests = 0, executions = 0;
  const ids: string[] = [];
  const context: NativeContext = { systemPrompt: "Only the declared fixture tool may run.", messages: [{ role: "user", content: "Read fixture" }],
    tools: [{ name: "read", description: "Fixture only", parameters: { type: "object", properties: { path: { const: "fixture" } }, required: ["path"], additionalProperties: false } }] };
  const url = await loopback(t, (request, response) => {
    const parts: Buffer[] = []; request.on("data", part => parts.push(part)); request.on("end", () => {
      const body = JSON.parse(Buffer.concat(parts).toString("utf8")); requests++;
      assert.equal(body.model, model.id); assert.equal(body.reasoning_effort, "none"); assert.equal(body.messages[0].content, context.systemPrompt);
      assert.equal(request.headers["x-conversation-id"], "session"); assert.equal(request.headers["x-conversation-request-id"], "run"); ids.push(String(request.headers["x-request-id"]));
      if (requests === 2) { assert.equal(body.messages.at(-1).tool_call_id, "call-local"); assert.equal(body.messages.at(-1).content, "FIXTURE-RESULT"); }
      const delta = requests === 1 ? { tool_calls: [{ index: 0, id: "call-local", type: "function", function: { name: "read", arguments: '{"path":"fixture"}' } }] } : { content: "ROUNDTRIP-OK" };
      const event = { id: `response-${requests}`, model: model.id, choices: [{ index: 0, delta, finish_reason: requests === 1 ? "tool_calls" : "stop" }] };
      response.writeHead(200, { "content-type": "text/event-stream" }); response.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    });
  });
  const client = createCodeBuddyClient(async (input, init) => {
    assert.equal(String(input), "https://copilot.tencent.com/v2/chat/completions");
    return codeBuddyNativeHttp(url, new Headers(init?.headers), String(init?.body), init!.signal!, {});
  });
  t.after(() => client.dispose());
  const options = { sessionId: "session", continuationId: "run", reasoning: "off", validateToolInput(_definition: NativeTool, call: NativeToolCall) { assert.deepEqual(call.arguments, { path: "fixture" }); return call.arguments; } };
  const first = await collect(client.stream({ model, access: "FIXTURE", context, options }));
  assert.deepEqual(first.at(-1), { type: "done", reason: "toolUse" });
  const tool = first.find(event => event.type === "tool-end"); assert.ok(tool?.type === "tool-end");
  // This fixture host approves and executes only after a successful complete turn; the core never executes.
  executions++;
  const continued: NativeContext = { ...context, messages: [...context.messages, { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...tool.call }] },
    { role: "toolResult", toolCallId: tool.call.id, toolName: tool.call.name, isError: false, content: "FIXTURE-RESULT" }] };
  const second = await collect(client.stream({ model, access: "FIXTURE", context: continued, options }));
  assert.deepEqual(second.at(-1), { type: "done", reason: "stop" }); assert.equal(executions, 1); assert.equal(requests, 2); assert.notEqual(ids[0], ids[1]);
});

test("production fetch rejects foreign targets and query/fragment redirects before any send", async () => {
  for (const input of ["http://127.0.0.1:1", "https://evil.invalid/v2/chat/completions", "https://copilot.tencent.com/v2/chat/completions?override=1",
    "https://copilot.tencent.com/v2/chat/completions#fragment", "https://u:p@copilot.tencent.com/v2/chat/completions", "https://copilot.tencent.com/v3/config"])
    await assert.rejects(codeBuddyNativeFetch(input, { method: "POST", body: "{}" }), /目标或正文无效/);
});
