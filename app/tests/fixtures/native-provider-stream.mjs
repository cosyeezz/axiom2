// Plain Node, public component only. A local synthetic upstream; never real OAuth or inference.
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
const { createKiroNativeProvider, kiroNativeFetch, kiroCliUserAgent } = await import(pathToFileURL(process.argv[2]).href);
const fixture = join(dirname(process.argv[2]), "fixture.txt"), marker = "COMPONENT-NO-PI-工具";
await writeFile(fixture, marker);
const account = { type: "oauth", access: "SYNTHETIC-ACCESS", refresh: "SYNTHETIC-REFRESH", expires: Date.now() + 60000, authMethod: "builder-id", authRegion: "us-east-1" };
const context = { systemPrompt: "Keep caller policy.", tools: [{ name: "read", description: "read local fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } }], messages: [{ role: "user", content: "Read the fixture" }] };
const ids = ["506f1108-18b6-4d12-949b-96e85bdfb2a5", "71a85f64-25fe-451d-8647-ac616084ed52"];
let requests = 0, toolRuns = 0, validations = 0, headersSeen = 0, payloads = 0, rawEvents = 0, serverFailure, conversation;
const server = http.createServer(async (req, res) => {
  try {
    requests++; assert.ok(requests <= 3);
    assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/responses"); assert.equal(req.httpVersion, "1.1");
    assert.equal(req.headers["user-agent"], kiroCliUserAgent()); assert.equal(req.headers.connection, "close");
    assert.equal(req.headers.authorization, "Bearer SYNTHETIC-ACCESS");
    assert.equal(req.headers["x-kiro-attempt"], "1;max=1"); assert.equal(req.headers["x-amzn-codewhisperer-optout"], "true");
    for (const name of ["accept", "accept-language", "accept-encoding", "sec-fetch-mode"]) assert.equal(req.headers[name], undefined);
    const chunks = []; for await (const part of req) chunks.push(part);
    const bytes = Buffer.concat(chunks); assert.equal(Number(req.headers["content-length"]), bytes.length);
    const body = JSON.parse(bytes.toString()); assert.equal(body.model, "deepseek-3.2");
    assert.equal(body.metadata["kiro:agent_continuation_id"], ids[requests === 3 ? 1 : 0]);
    conversation ??= body.metadata["kiro:conversation_id"];
    assert.match(conversation, /^[0-9a-f-]{36}$/);
    assert.equal(body.metadata["kiro:conversation_id"], conversation);
    assert.match(body.input[0].content, /Keep caller policy/); assert.equal(body.tools[0].name, "read");
    assert.equal(body.fixture, true);
    if (requests > 1) {
      const call = body.input.find(item => item.type === "function_call"), result = body.input.find(item => item.type === "function_call_output");
      assert.equal(call.call_id, "call1"); assert.equal(result.call_id, call.call_id);
      assert.equal(JSON.parse(result.output).content[0].text, marker);
    }
    if (requests === 3) assert.ok(body.input.some(item => item.role === "assistant"));
    const item = requests === 1 ? { type: "function_call", id: "fc1", call_id: "call1", name: "read", arguments: JSON.stringify({ path: fixture }) }
      : { type: "message", id: "msg" + requests, role: "assistant", content: [{ type: "output_text", text: marker }] };
    const events = [{ type: "response.output_item.added", output_index: 0, item: { ...item, ...(requests === 1 ? { arguments: "" } : { content: [] }) } },
      requests === 1 ? { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: item.arguments }
        : { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: marker },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "resp" + requests, model: "deepseek-3.2", status: requests === 1 ? "requires_action" : "completed", output: [item] } }];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(events.map(event => "data: " + JSON.stringify(event) + "\r\n\r\n").join("") + "data: [DONE]\r\n\r\n");
  } catch (error) { serverFailure = error; res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const localUrl = `http://127.0.0.1:${server.address().port}/v1/responses`;
// Fail closed outside this exact synthetic endpoint, and forbid generic Fetch.
const originalRequest = http.request;
http.request = (...args) => { assert.equal(String(args[0]), localUrl); return originalRequest(...args); };
https.request = () => { throw Error("Unexpected HTTPS"); };
globalThis.fetch = () => { throw Error("Unexpected Fetch"); };
syncBuiltinESMExports();
const provider = createKiroNativeProvider({ fetch: (url, init) => {
  assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/v1/responses");
  return kiroNativeFetch(localUrl, init);
} });
try {
  let final;
  for (let turn = 0; turn < 3; turn++) {
    const received = [];
    for await (const event of provider.stream({ model: { id: "deepseek-3.2" }, account, context, options: {
      signal: AbortSignal.timeout(5000), sessionId: "component-session", continuationId: ids[turn === 2 ? 1 : 0],
      onPayload(payload) { payloads++; return { ...payload, fixture: true }; },
      onResponse(response) { headersSeen++; assert.equal(response.status, 200); },
      onProviderEvent() { rawEvents++; },
      validateToolInput(definition, call) {
        validations++; assert.deepEqual(definition.parameters, context.tools[0].parameters);
        assert.deepEqual(call.arguments, { path: fixture }); return call.arguments;
      },
    } })) received.push(event);
    if (serverFailure) throw serverFailure;
    assert.equal(received.filter(event => event.type === "done").length, 1);
    assert.equal(received.filter(event => event.type === "error").length, 0);
    assert.equal(received.at(-1).reason, turn === 0 ? "toolUse" : "stop");
    if (turn === 0) {
      const call = received.find(event => event.type === "tool-end").call;
      // Host executes only after a successful complete terminal, never on a delta/tool-end.
      const result = await readFile(call.arguments.path, "utf8"); toolRuns++;
      context.messages.push({ role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...call }] },
        { role: "toolResult", toolCallId: call.id, toolName: call.name, isError: false, content: result });
    } else {
      final = received.filter(event => event.type === "text").map(event => event.delta).join("");
      context.messages.push({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: final }] }, { role: "user", content: "Next turn" });
    }
  }
  assert.equal(final, marker); assert.equal(toolRuns, 1); assert.equal(validations, 1);
  assert.equal(payloads, 3); assert.equal(headersSeen, 3); assert.equal(rawEvents, 12);
  console.log(JSON.stringify({ requests, toolRuns, validations, markerMatched: true, hooks: true, nativeHttp: true, piLoaded: false }));
} finally { provider.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
