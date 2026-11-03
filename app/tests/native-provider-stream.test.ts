import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createKiroNativeProvider, type KiroCredential, type NativeContext, type NativeStreamOptions, type NativeStreamEvent } from "../src/native-providers/index.js";
import { nativeProviderBundle } from "./fixtures/native-provider-bundle.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const account = (patch: Partial<KiroCredential> = {}): KiroCredential => ({ type: "oauth", access: "SYNTHETIC-ACCESS", refresh: "SYNTHETIC-REFRESH", expires: Date.now() + 60000, authMethod: "builder-id", authRegion: "us-east-1", ...patch });
const context = (): NativeContext => ({ systemPrompt: "Keep caller policy", messages: [{ role: "user", content: "hello" }] });
const tool = { name: "read", description: "read fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } };
const toolContext = (): NativeContext => ({ ...context(), tools: [tool] });
function sse(tool = false, complete = true, args = '{"path":"fixture"}') {
  const item = tool ? { type: "function_call", id: "fc1", call_id: "call1", name: "read", arguments: args }
    : { type: "message", id: "msg1", role: "assistant", content: [{ type: "output_text", text: "ok" }] };
  const events: object[] = [{ type: "response.output_item.added", output_index: 0, item: { ...item, ...(tool ? { arguments: "" } : { content: [] }) } },
    tool ? { type: "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: args }
      : { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "ok" },
    { type: "response.output_item.done", output_index: 0, item }];
  if (complete) events.push({ type: "response.completed", response: { id: "resp1", model: "deepseek-3.2", status: tool ? "requires_action" : "completed", output: [item] } });
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}
async function collect(events: AsyncIterable<NativeStreamEvent>) { const result: NativeStreamEvent[] = []; for await (const event of events) result.push(event); return result; }
const terminal = (events: NativeStreamEvent[]) => events.filter(event => event.type === "done" || event.type === "error");
const signal = () => AbortSignal.timeout(5000);

// These tests invoke the SDK-independent orchestration, not only its serializer/parser.
test("native component requires an explicit validator and never adopts coerced or rejected tool arguments", async () => {
  let requests = 0;
  const provider = createKiroNativeProvider({ fetch: async () => { requests++; return sse(true); } });
  try {
    const missing = await collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account(), context: toolContext() }));
    assert.equal(requests, 0); assert.equal(terminal(missing)[0].type, "error");
    const validators: NonNullable<NativeStreamOptions["validateToolInput"]>[] = [() => { throw Error("SENSITIVE-ERROR"); }, () => ({ path: "repaired" }), (_definition, call) => { call.arguments.path = "mutated"; return call.arguments; }];
    for (const validateToolInput of validators) {
      const events = await collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account(), context: toolContext(), options: { validateToolInput } }));
      assert.equal(terminal(events).length, 1); assert.equal(terminal(events)[0].type, "error");
      assert.ok(!events.some(event => event.type === "tool-end")); assert.doesNotMatch(JSON.stringify(events), /SENSITIVE/);
    }
    assert.equal(requests, 3);
  } finally { provider.dispose(); }
});

test("validated tool candidate is not execution permission when the Responses terminal is missing", async () => {
  const provider = createKiroNativeProvider({ fetch: async () => sse(true, false) });
  try {
    const events = await collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account(), context: toolContext(), options: { validateToolInput: (_definition, call) => call.arguments } }));
    assert.ok(events.some(event => event.type === "tool-end")); assert.deepEqual(terminal(events).map(event => event.type), ["error"]);
    const failure = events.find(event => event.type === "diagnostic" && event.diagnostic.type === "kiro-failure");
    assert.ok(failure?.type === "diagnostic" && failure.diagnostic.details.partial === true);
  } finally { provider.dispose(); }
});

test("cancellation while an uncooperative validator waits returns without a tool-end or retry", async () => {
  const controller = new AbortController(); let entered!: () => void, release!: (value: unknown) => void, calls = 0;
  const ready = new Promise<void>(yes => { entered = yes; }), pending = new Promise<unknown>(yes => { release = yes; });
  const provider = createKiroNativeProvider({ fetch: async () => { calls++; return sse(true); } });
  try {
    const result = collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account(), context: toolContext(), options: {
      signal: controller.signal, validateToolInput() { entered(); return pending; },
    } }));
    await ready; controller.abort(); const events = await result;
    assert.equal(terminal(events)[0].type, "error"); assert.equal((terminal(events)[0] as { reason: string }).reason, "aborted");
    assert.ok(!events.some(event => event.type === "tool-end")); release({ path: "fixture" }); assert.equal(calls, 1);
  } finally { provider.dispose(); }
});

test("component disposal aborts a pending send and cleans a late response without publishing it", async () => {
  let entered!: () => void, release!: (response: Response) => void, cancelled = false, calls = 0;
  const ready = new Promise<void>(yes => { entered = yes; });
  const provider = createKiroNativeProvider({ fetch: () => { calls++; entered(); return new Promise<Response>(yes => { release = yes; }); } });
  const result = collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account(), context: context() }));
  await ready; provider.dispose();
  const events = await result; assert.deepEqual(terminal(events).map(event => event.type), ["error"]);
  assert.equal((terminal(events)[0] as { reason: string }).reason, "aborted");
  release(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
  const again = await collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account(), context: context() }));
  assert.equal(terminal(again)[0].type, "error"); assert.equal(calls, 1);
  assert.throws(() => provider.catalog(account(), signal()), { name: "AbortError" });
});

test("native profile cache isolates credentials and exposes catalog facts without SDK routing or prices", async () => {
  let discoveries = 0;
  const provider = createKiroNativeProvider({ fetch: async (_url, init) => {
    const headers = new Headers(init?.headers), target = headers.get("x-amz-target") ?? "";
    if (target.endsWith("ListAvailableProfiles")) {
      discoveries++; const name = headers.get("authorization")?.endsWith("OTHER") ? "other" : "first";
      return Response.json({ profiles: [{ arn: `arn:aws:codewhisperer:eu-central-1:123456789012:profile/${name}` }] });
    }
    if (target.endsWith("ListAvailableModels")) {
      const item = { modelId: "deepseek-3.2", supportedInputTypes: ["TEXT", "IMAGE"] };
      return Response.json({ models: [item], defaultModel: item });
    }
    const expected = headers.get("authorization")?.endsWith("OTHER") ? "other" : "first";
    assert.match(headers.get("x-amzn-kiro-profile")!, new RegExp(`:profile/${expected}$`)); return sse();
  } });
  try {
    for (const access of ["SYNTHETIC-ACCESS", "SYNTHETIC-ACCESS", "SYNTHETIC-OTHER"]) {
      const events = await collect(provider.stream({ model: { id: "deepseek-3.2" }, account: account({ access, authMethod: "identity-center" }), context: context() }));
      assert.deepEqual(terminal(events), [{ type: "done", reason: "stop" }]);
    }
    assert.equal(discoveries, 2);
    const [model] = await provider.catalog(account(), signal());
    assert.equal(model.id, "deepseek-3.2"); assert.equal(model.contextWindow, undefined); assert.equal(model.maxOutputTokens, undefined);
    assert.deepEqual(model.input, ["text", "image"]); assert.equal(model.thinking.supported, false);
    for (const key of ["api", "baseUrl", "provider", "cost", "maxTokens", "reasoning"]) assert.ok(!Object.hasOwn(model, key));
  } finally { provider.dispose(); }
});

test("usage emits invalidation before each snapshot, including malformed snapshots after complete counts", async () => {
  const complete = { uncachedInputTokens: 3, outputTokens: 2, cacheReadInputTokens: 1, cacheWriteInputTokens: 0, totalTokens: 6 };
  for (const next of [{ outputTokens: 1 }, { ...complete, totalTokens: 99 }]) {
    const provider = createKiroNativeProvider({ fetch: async () => kiroResponse([
      kiroFrame("assistantResponseEvent", { content: "ok" }), kiroFrame("metadataEvent", { tokenUsage: complete }), kiroFrame("metadataEvent", { tokenUsage: next }),
    ]) });
    try {
      const events = await collect(provider.stream({ model: { id: "selected-aws-model" }, account: account(), context: context() }));
      assert.deepEqual(events.filter(event => event.type === "usage").map(event => event.state), ["partial", "complete", "partial"]);
      assert.equal(terminal(events)[0].type, "totalTokens" in next ? "error" : "done");
    } finally { provider.dispose(); }
  }
});

test("plain Node public provider completes native HTTP tool round-trip and a new logical turn without Pi", async () => {
  const bundle = await nativeProviderBundle(), dir = await mkdtemp(join(tmpdir(), "kiro-component-stream-"));
  try {
    const path = join(dir, "component.mjs"); await writeFile(path, bundle);
    const env: NodeJS.ProcessEnv = { ...process.env, NO_PROXY: "*", no_proxy: "*" }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const { stdout } = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/native-provider-stream.mjs"), path], { cwd: dir, env, timeout: 15000 });
    assert.deepEqual(JSON.parse(stdout), { requests: 3, toolRuns: 1, validations: 1, markerMatched: true, hooks: true, nativeHttp: true, piLoaded: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
