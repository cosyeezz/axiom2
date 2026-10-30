// Executed by plain Node against a temporary standalone bundle. No Pi or TS loader.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
const { createKiroNativeRequest, prepareKiroNativeRequest, sendKiroNativeRequest, readKiroResponses, kiroCliUserAgent } = await import(pathToFileURL(process.argv[2]).href);
const fixture = join(dirname(process.argv[2]), "fixture.txt"), marker = "NATIVE-NO-PI-工具";
await writeFile(fixture, marker);
let requests = 0, toolRuns = 0;
const account = { access: "SYNTHETIC-ACCESS", expires: Date.now() + 60000, profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/fixture" };
const context = { systemPrompt: "Caller policy stays intact.", tools: [{ name: "read", description: "read fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }], messages: [{ role: "user", content: "Read the fixture" }] };
const args = JSON.stringify({ path: fixture });
let serverFailure;
const server = createServer(async (req, res) => {
  try {
    requests++;
    assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/responses");
    assert.equal(req.headers["user-agent"], kiroCliUserAgent());
    assert.equal(req.headers.authorization, "Bearer SYNTHETIC-ACCESS");
    assert.equal(req.headers["x-amzn-kiro-profile"], account.profileArn);
    assert.equal(req.headers["content-type"], "application/json");
    for (const name of ["accept", "accept-language", "accept-encoding", "sec-fetch-mode"]) assert.equal(req.headers[name], undefined);
    assert.equal(req.httpVersion, "1.1");
    assert.equal(req.headers["x-amz-target"], undefined);
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    assert.equal(body.model, "deepseek-3.2");
    assert.match(body.input[0].content, /Caller policy stays intact/);
    assert.equal(body.tools[0].name, "read");
    const item = requests === 1
      ? { type: "function_call", id: "fc1", call_id: "call1", name: "read", arguments: args }
      : { type: "message", id: "msg2", content: [{ type: "output_text", text: marker }] };
    if (requests === 2) {
      const call = body.input.find(i => i.type === "function_call"), output = body.input.find(i => i.type === "function_call_output");
      assert.equal(output.call_id, call.call_id);
      assert.equal(JSON.parse(output.output).content[0].text, marker);
    }
    assert.ok(requests <= 2);
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { ...item, ...(requests === 1 ? { arguments: "" } : { content: [] }) } },
      requests === 1 ? { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: args }
        : { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: marker },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "resp" + requests, model: "deepseek-3.2", status: requests === 1 ? "requires_action" : "completed", output: [item] } },
    ];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(events.map(event => "data: " + JSON.stringify(event) + "\r\n\r\n").join("") + "data: [DONE]\r\n\r\n");
  } catch (error) { serverFailure = error; res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
// Remap only this synthetic destination; exercise the real native HTTP sender, not Fetch.
const localUrl = "http://127.0.0.1:" + server.address().port + "/v1/responses";
try {
  let final = "";
  for (let turn = 0; turn < 2; turn++) {
    const { payload } = createKiroNativeRequest("deepseek-3.2", context, account, "standalone-session");
    const prepared = prepareKiroNativeRequest("deepseek-3.2", account, payload);
    assert.equal(prepared.url, "https://runtime.us-east-1.kiro.dev/v1/responses");
    const signal = AbortSignal.timeout(5000), response = await sendKiroNativeRequest({ ...prepared, url: localUrl }, signal);
    if (serverFailure) throw serverFailure;
    assert.equal(response.status, 200);
    let callId, name, rawArgs = "", completed = false;
    for await (const event of readKiroResponses(response.body, signal, "deepseek-3.2")) {
      if (event.headers[":event-type"] === "toolUseEvent") {
        callId = event.data.toolUseId;
        name ??= event.data.name; rawArgs += event.data.input ?? "";
      }
      if (event.headers[":event-type"] === "assistantResponseEvent") final += event.data.content;
      if (event.providerEvent.type === "response.completed") completed = true;
    }
    assert.ok(completed);
    if (turn === 0) {
      assert.equal(name, "read"); assert.deepEqual(JSON.parse(rawArgs), { path: fixture });
      // Execute only after validated response.completed and stream end.
      const result = await readFile(fixture, "utf8"); toolRuns++;
      context.messages.push({ role: "assistant", content: [{ type: "toolCall", id: callId, name, arguments: JSON.parse(rawArgs) }], stopReason: "toolUse" },
        { role: "toolResult", toolCallId: callId, toolName: name, isError: false, content: [{ type: "text", text: result }] });
    }
  }
  if (serverFailure) throw serverFailure;
  assert.equal(final, marker); assert.equal(requests, 2); assert.equal(toolRuns, 1);
  console.log(JSON.stringify({ requests, toolRuns, markerMatched: true, piLoaded: false }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
