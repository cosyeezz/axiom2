import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WebReadService, safeLocation, redactLinks } from "../src/server/web-access/service.js";
import { extractPage } from "../src/server/web-access/extractor.js";
import { WebReadClient, WebReadHost } from "../src/server/web-access/rpc.js";
import { webReadTool } from "../src/server/web-read-tool.js";
import { webReadLimits as limits } from "../src/shared/web-read.js";
import type { LeaseRef } from "../src/server/execution-protocol.js";
import { Check } from "typebox/value";
import { Compile } from "typebox/compile";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { kiroNativeChatRequest } from "../src/native-providers/kiro/protocol.js";
import { kiroResponsesRequest } from "../src/native-providers/kiro/responses.js";

const owner = { workspaceId: "w", sessionId: "s", runId: "r" };
const signal = () => new AbortController().signal;
const plain = (text: string) => ({ url: "https://example.com/article", text, contentType: "text/plain" });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("object-root web_read preserves union validation in TypeBox, compiled and SDK validators", () => {
  const tool = webReadTool(async () => { throw Error("must not execute"); });
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  const { type, ...previousUnion } = schema;
  assert.equal(type, "object"); assert.equal(schema.anyOf.length, 3);
  assert.ok(schema.anyOf.every((branch: any) => branch.type === "object" && branch.additionalProperties === false));
  const compiled = Compile(schema), previous = Compile(previousUnion);
  const valid = [{ urls: ["https://example.com"] }, { urls: ["a", "b", "c", "d"], maxChars: 500 },
    { targetRefs: ["ref"], maxChars: 20000 }, { sourceId: "source", cursor: "cursor" }];
  const invalid = [null, [], "text", 1, true, {}, { urls: [] }, { urls: Array(5).fill("a") },
    { urls: [""] }, { urls: ["x".repeat(4097)] }, { targetRefs: [] }, { targetRefs: ["x".repeat(201)] },
    { sourceId: "source" }, { cursor: "cursor" }, { sourceId: "", cursor: "c" },
    { sourceId: "s", cursor: "x".repeat(201) }, { urls: ["a"], targetRefs: ["ref"] },
    { urls: ["a"], sourceId: "s", cursor: "c" }, { targetRefs: ["ref"], sourceId: "s", cursor: "c" },
    { urls: ["a"], workspaceId: "injected" }, { urls: ["a"], maxChars: 499 },
    { urls: ["a"], maxChars: 20001 }, { urls: ["a"], maxChars: 500.5 }];
  for (const [accepted, values] of [[true, valid], [false, invalid]] as const) for (const value of values) {
    assert.equal(Check(previousUnion, value), accepted);
    assert.equal(Check(schema, value), accepted);
    assert.equal(previous.Check(value), accepted); assert.equal(compiled.Check(value), accepted);
    const validate = () => validateToolArguments(tool, { type: "toolCall", id: "fixture", name: tool.name, arguments: value as any });
    if (accepted) assert.deepEqual(validate(), value); else assert.throws(validate);
  }
});

test("real web_read schema reaches GAR and Responses without a top-level combinator, keeping local constraints", () => {
  const tool = webReadTool(async () => { throw Error("must not execute"); });
  const before = JSON.stringify(tool.parameters);
  const original = JSON.parse(before);
  const expected = { type: "object", additionalProperties: false, properties: Object.assign({}, ...original.anyOf.map((branch: any) => branch.properties)) };
  for (const id of ["claude-sonnet-4.5", "claude-sonnet-5.5", "deepseek-3.2"]) {
    const { payload } = kiroNativeChatRequest(id, { tools: [tool], messages: [{ role: "user", content: "hello" }] }, {});
    const wire = payload.conversationState.currentMessage.userInputMessage.userInputMessageContext!.tools![0] as any;
    const json = wire.toolSpecification.inputSchema.json;
    assert.deepEqual(json, expected);
    assert.ok(!["anyOf", "oneOf", "allOf", "required"].some(key => key in json));
    assert.match(wire.toolSpecification.description, /Provide one argument group: urls \| targetRefs \| sourceId\+cursor\.$/);
    assert.ok(wire.toolSpecification.description.startsWith(tool.description));
    const responses = kiroResponsesRequest(payload).tools[0];
    assert.deepEqual(responses.parameters, expected);
    assert.equal(responses.description, wire.toolSpecification.description);
  }
  // Local schema and SDK validation are untouched by the wire projection.
  assert.equal(JSON.stringify(tool.parameters), before);
  assert.throws(() => validateToolArguments(tool, { type: "toolCall", id: "f", name: tool.name, arguments: { urls: ["a"], sourceId: "s", cursor: "c" } as any }));
  const call = (parameters: unknown) => () => kiroNativeChatRequest("claude-sonnet-5.5", {
    tools: [{ name: "fixture", description: "Fixture", parameters: parameters as any }],
    messages: [{ role: "user", content: "hello" }],
  }, {});
  assert.throws(call({ type: "string" }), /object JSON Schema/);
  const branch = (properties: object, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
  const wireJson = (result: ReturnType<ReturnType<typeof call>>) => (result.payload.conversationState.currentMessage.userInputMessage.userInputMessageContext!.tools![0] as any).toolSpecification;
  for (const unsafe of [
    { type: "object", allOf: [branch({ a: { type: "string" } }, ["a"])] },
    { type: "object", anyOf: [branch({ a: { type: "string" } }, ["a"])], oneOf: [branch({ b: { type: "string" } }, ["b"])] },
    { type: "object", anyOf: [branch({ a: { type: "string" } }, ["a"]), branch({ a: { type: "number" } }, ["a"])] },
    { type: "object", anyOf: [{ type: "string" }] },
    { type: "object", anyOf: [] },
    { type: "object", properties: { a: { type: "string" } }, anyOf: [branch({ a: { type: "string" } }, ["a"])] },
    // Open branch: merging would let another branch's `a:string` reject `{b:1,a:2}`.
    { type: "object", anyOf: [{ type: "object", properties: { b: { type: "number" } }, required: ["b"] }, branch({ a: { type: "string" } }, ["a"])] },
    { type: "object", anyOf: [{ ...branch({ a: { type: "string" } }, ["a"]), patternProperties: { "^x": {} } }] },
    { type: "object", anyOf: [{ ...branch({ a: { type: "string" } }, ["a"]), $defs: { s: { type: "string" } } }] },
    { type: "object", anyOf: [branch({ a: { type: "string" } }, ["a"]), branch({ b: { $ref: "#/anyOf/0/properties/a" } }, ["b"])] },
    { type: "object", anyOf: [branch({ a: { type: "string" } }, ["a", "missing"])] },
  ]) assert.throws(call(unsafe), /无法安全转换/);
  const shared = call({ type: "object", oneOf: [branch({ id: { type: "string" }, a: { type: "string" } }, ["id", "a"]), branch({ id: { type: "string" } }, ["id"])] })();
  assert.deepEqual(wireJson(shared).inputSchema.json, { type: "object", properties: { id: { type: "string" }, a: { type: "string" } }, required: ["id"], additionalProperties: false });
  assert.match(wireJson(shared).description, /Provide exactly one argument group: id\+a \| id\.$/);
  // MCP adapters add an empty root `properties`; inherited names and key order are not conflicts; root $defs refs survive.
  const mcp = call({ type: "object", properties: {}, $defs: { s: { type: "string" } }, anyOf: [
    branch({ toString: { type: "string", minLength: 1 }, constructor: { $ref: "#/$defs/s" } }, ["toString"]),
    branch({ toString: { minLength: 1, type: "string" } }, []),
  ] })();
  assert.deepEqual(wireJson(mcp).inputSchema.json, { type: "object", $defs: { s: { type: "string" } }, properties: { toString: { type: "string", minLength: 1 }, constructor: { $ref: "#/$defs/s" } }, additionalProperties: false });
  const plain = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  const passthrough = call(plain)();
  assert.deepEqual(wireJson(passthrough), { name: "fixture", description: "Fixture", inputSchema: { json: plain } });
});

test("schema rejects mixed modes, injected identity and oversized bounds before I/O", async () => {
  const service = new WebReadService({ download: async () => { throw Error("must not fetch"); } });
  for (const input of [{ urls: [] }, { urls: ["https://example.com"], workspaceId: "other" }, { urls: ["a"], sourceId: "x", cursor: "c" }, { urls: ["a"], maxChars: 20001 }, { urls: ["a"], maxChars: 499 }, { urls: Array(5).fill("a") }]) {
    const result = await service.read(owner, input, signal());
    assert.equal(result.items[0].error?.code, "INVALID_INPUT");
  }
  assert.equal((await service.read(owner, { targetRefs: ["unknown"] }, signal())).items[0].error?.code, "TARGET_EXPIRED");
  service.close();
});
test("immutable evidence pages never refetch; cursor and workspace/session isolation, TTL and restart", async () => {
  let calls = 0, now = Date.now();
  const service = new WebReadService({ download: async () => { calls++; return plain("A".repeat(499) + "😀" + "B".repeat(800)); }, now: () => now });
  const first = (await service.read(owner, { urls: ["https://example.com"], maxChars: 500 }, signal())).items[0];
  assert.equal(first.content?.length, 499); assert.equal(first.truncated, true);
  const next = { sourceId: first.sourceId!, cursor: first.cursor!, maxChars: 500 };
  const second = (await service.read({ ...owner, runId: "r2" }, next, signal())).items[0];
  assert.equal(second.content?.startsWith("😀"), true); assert.equal(second.start, 499); assert.equal(calls, 1);
  for (const other of [{ ...owner, sessionId: "s2" }, { ...owner, workspaceId: "w2" }])
    assert.equal((await service.read(other, next, signal())).items[0].error?.code, "SOURCE_EXPIRED");
  assert.equal((await service.read(owner, { ...next, cursor: "tampered" }, signal())).items[0].error?.code, "INVALID_CURSOR");
  now += limits.retentionMs;
  assert.equal((await service.read(owner, next, signal())).items[0].error?.code, "SOURCE_EXPIRED");
  const restart = new WebReadService();
  assert.equal((await restart.read(owner, next, signal())).items[0].error?.code, "SOURCE_EXPIRED");
  service.close(); restart.close();
});
test("bounded snapshots evict old evidence; partial batches retain successful entries", async () => {
  const service = new WebReadService({ download: async url => { if (url.includes("fail")) throw Error("secret URL"); return plain("x".repeat(501)); } });
  const result = await service.read(owner, { urls: ["https://example.com", "https://fail.com"], maxChars: 500 }, signal());
  assert.equal(result.status, "partial"); assert.equal(result.items[1].error?.code, "NETWORK_ERROR");
  assert.ok(!JSON.stringify(result).includes("secret URL"));
  for (let i = 0; i < limits.snapshots; i++) await service.read({ ...owner, runId: `run${i}` }, { urls: ["https://example.com"] }, signal());
  assert.equal((await service.read(owner, { sourceId: result.items[0].sourceId, cursor: result.items[0].cursor }, signal())).items[0].error?.code, "SOURCE_EXPIRED");
  service.close();
});
test("late download cannot commit after abort, authorization revocation or close", async () => {
  for (const mode of ["abort", "revoke", "close"]) {
    let deliver!: (value: ReturnType<typeof plain>) => void, active = true;
    const service = new WebReadService({ download: async () => new Promise(resolve => { deliver = resolve; }) });
    const controller = new AbortController();
    const pending = service.read(owner, { urls: ["https://example.com"] }, controller.signal, () => active);
    if (mode === "abort") controller.abort(); else if (mode === "close") service.close(); else active = false;
    deliver(plain("late evidence"));
    const result = await pending;
    assert.equal(result.status, "error"); assert.equal(result.items[0].sourceId, undefined);
    assert.equal((service as any).snapshots.size, 0);
    service.close();
  }
});
test("concurrency and per-run request budgets fail closed", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const service = new WebReadService({ download: async () => { await pending; return plain("text"); } });
  const jobs = Array.from({ length: limits.concurrent }, () => service.read(owner, { urls: ["https://example.com"] }, signal()));
  assert.equal((await service.read(owner, { urls: ["https://example.com"] }, signal())).items[0].error?.code, "BUSY");
  release(); await Promise.all(jobs);
  for (let i = 0; i < 16; i++) await service.read(owner, { urls: ["https://example.com"] }, signal());
  assert.equal((await service.read(owner, { urls: ["https://example.com"] }, signal())).items[0].error?.code, "BUDGET_EXCEEDED");
  service.close();
});
test("sensitive URL display is not offered as a clickable equivalent", () => {
  for (const url of ["https://example.com/a?token=abc", "https://user:pass@example.com", "https://example.com/%74oken/abc", "https://example.com/" + "x".repeat(49)]) assert.equal(safeLocation(url).citationUrl, undefined);
  assert.equal(safeLocation("https://example.com/docs").citationUrl, "https://example.com/docs");
  assert.ok(!redactLinks("[x](https://example.com/path?token=first)SECRET_TAIL)").includes("SECRET_TAIL"));
});
test("local worker extracts headings, prose, code and links without script execution", async () => {
  const page = await extractPage(`<html><head><title>Fixture</title></head><body><article><h1>Useful title</h1><p>${"Public documented evidence with enough prose to keep extraction stable. ".repeat(15)}</p><pre><code>const answer = 42;\nconsole.log(answer);</code></pre><p><a href="/docs">Read documentation</a></p><script>throw Error('MUST NOT EXECUTE')</script></article></body></html>`, "https://example.com/article", AbortSignal.timeout(15000));
  assert.match(page.content, /Public documented evidence/); assert.match(page.content, /const answer = 42/);
  assert.match(page.content, /https:\/\/example.com\/docs/); assert.ok(!page.content.includes("MUST NOT EXECUTE"));
});
test("worker diagnostics and pre-aborted work have controlled errors", async () => {
  await assert.rejects(extractPage("<html><head><title>Just a moment...</title></head><body>Wait</body></html>", "https://example.com", signal()), { code: "VERIFICATION_REQUIRED" });
  await assert.rejects(extractPage('<html><body><input type="password"></body></html>', "https://example.com", signal()), { code: "AUTH_REQUIRED" });
  await assert.rejects(extractPage("<html><body>Please enable JavaScript to continue.</body></html>", "https://example.com", signal()), { code: "NEEDS_BROWSER" });
  await assert.rejects(extractPage("<html></html>", "https://example.com", AbortSignal.abort()), { code: "CANCELLED" });
  const controller = new AbortController();
  const parsing = extractPage("<html><body>" + "<div>text</div>".repeat(100000) + "</body></html>", "https://example.com", controller.signal);
  controller.abort(); await assert.rejects(parsing, { code: "CANCELLED" });
});
test("independent client RPC cleans up cancellation, timeout and late replies", async () => {
  const client = new WebReadClient(), events: any[] = [], controller = new AbortController();
  const pending = client.call(event => { events.push(event); }, "call", { urls: ["x"] }, controller.signal);
  controller.abort(); await assert.rejects(pending); assert.equal(client.size, 0); assert.equal(events[1].type, "web-cancel");
  client.reply({ key: events[0].key, ok: true, data: "late" }); assert.equal(client.size, 0);
  await assert.rejects(client.call(() => {}, "call", {}, undefined, 5)); assert.equal(client.size, 0);
  const ended = client.call(() => {}, "call", {}); client.clear(); await assert.rejects(ended);
});
test("host binds scope/lease and blocks old replies or post-end evidence", async () => {
  const lease: LeaseRef = { instanceId: "i", generation: 1, leaseId: "l" };
  let active: LeaseRef | undefined = lease, deliver!: (value: ReturnType<typeof plain>) => void, calls = 0;
  const replies: unknown[] = [];
  const service = new WebReadService({ download: async () => { calls++; return new Promise(resolve => { deliver = resolve; }); } });
  const host = new WebReadHost(() => active, (_owner, reply) => { replies.push(reply); }, service);
  const event = { type: "web-call", key: "k", lease, params: { urls: ["https://example.com"] } };
  host.handle(owner, { ...event, lease: { ...lease, generation: 0 } }); assert.equal(calls, 0);
  host.handle(owner, event); assert.equal(calls, 1);
  host.handle({ ...owner, sessionId: "other" }, { ...event, type: "web-cancel" });
  active = undefined; host.end(owner); deliver(plain("late")); await tick(); await tick();
  assert.equal(replies.length, 0); assert.equal((service as any).snapshots.size, 0);
  host.close();
});
test("native tool, independent RPC and host service complete a successful evidence round trip", async () => {
  const lease: LeaseRef = { instanceId: "worker", generation: 4, leaseId: "lease" };
  const client = new WebReadClient();
  const service = new WebReadService({ download: async () => plain("public evidence ".repeat(100)) });
  const host = new WebReadHost(() => lease, (_owner, value) => client.reply(value as any), service);
  const tool = webReadTool((id, params, signal) => client.call(value => host.handle(owner, { ...(value as object), lease }), id, params, signal));
  try {
    const first = await tool.execute("first", { urls: ["https://example.com"], maxChars: 500 }, undefined, undefined, {} as any);
    assert.equal(first.isError, false); assert.equal(first.details?.status, "success");
    const source = first.details!.items[0];
    const next = await tool.execute("next", { sourceId: source.sourceId!, cursor: source.cursor!, maxChars: 500 }, undefined, undefined, {} as any);
    assert.equal(next.details!.items[0].start, 500); assert.equal(next.details!.items[0].sourceId, source.sourceId);
    assert.equal(client.size, 0);
  } finally { client.clear(); host.close(); }
});
test("tool carries structured evidence and true failure flag; main-only registration remains explicit", async () => {
  const data = { schemaVersion: 1, requestId: "r", status: "error", items: [], warnings: [] };
  const tool = webReadTool(async () => data);
  const result = await tool.execute("id", { urls: ["https://example.com"] }, undefined, undefined, {} as any);
  assert.equal(result.isError, true); assert.equal(result.details, data);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(data) }]);
  assert.equal(tool.description, "Read public HTTP(S) pages for their content. Use urls for a new read, or sourceId and cursor to continue. Browser login and JavaScript are not supported.");
  const source = readFileSync(new URL("../src/server/agent-worker.ts", import.meta.url), "utf8");
  assert.match(source, /customTools: input.task \? \[\] : \[.*webReadTool\(callWeb\)/);
  assert.match(source, /pendingCalls.size === 0 && webCalls.size === 0/);
});
