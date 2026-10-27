import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, Type, type AssistantMessage, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { classifyKiroFailure, kiroFailureMessage, kiroPartialFailure, readKiroErrorBody } from "../src/server/providers/kiro-failure.js";
import { installKiroCompactionUsage } from "../src/server/kiro-compaction-usage.js";
import { projectKiroFailure } from "../src/server/kiro-failure-display.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const errorBody = (code: string, message = "PRIVATE-DATA") => ({ state: "json" as const, data: { __type: code, message } });
const exception = (code: string, data: Record<string, unknown> = {}) => kiroFrame("", data, { ":message-type": "exception", ":exception-type": code });
const success = () => kiroResponse([kiroFrame("assistantResponseEvent", { content: "OWNED_SUCCESS" })]);
const http = (status: number, code?: string, message?: string) => new Response(code ? JSON.stringify(errorBody(code, message).data) : "PRIVATE-DATA", { status });

test("failure categories never infer monthly quota or use arbitrary message/request IDs as recovery hints", () => {
  for (const [status, code, category] of [[429, "ServiceQuotaExceededException", "quota"], [429, "ThrottlingException", "throttle"],
    [400, "ValidationException", "validation"], [503, "InternalServerException", "transient"], [400, "ContextLengthExceededException", "overflow"]] as const) {
    const info = classifyKiroFailure({ stage: "http", status, body: errorBody(code) }); assert.equal(info.category, category);
    assert.doesNotMatch(kiroFailureMessage(info, false), /PRIVATE|monthly|余额不足|HTTP/);
    assert.equal(kiroFailureMessage(info, true), kiroPartialFailure);
  }
  for (const body of [undefined, errorBody("FutureException", "rate limit 503 prompt too long"), errorBody("ValidationException", "Input is too long.")]) {
    const info = classifyKiroFailure({ stage: "http", status: 429, body, requestId: "PRIVATE-503-429" });
    assert.equal(info.category, "unknown"); assert.equal(info.requestId, undefined);
    assert.doesNotMatch(kiroFailureMessage(info, false), /429|503|rate.?limit|too long/);
  }
  const conflict = classifyKiroFailure({ stage: "http", status: 429, codes: ["ThrottlingException"], body: errorBody("ServiceQuotaExceededException") });
  assert.equal(conflict.category, "unknown"); assert.equal(conflict.conflict, true);
  const overflow = classifyKiroFailure({ stage: "http", status: 400, body: errorBody("ValidationException", "Input is too long for requested model.") });
  assert.equal(overflow.category, "overflow"); assert.equal(overflow.evidence, "local-signature");
  assert.equal(classifyKiroFailure({ stage: "stream", status: 200, codes: ["com.amazon.example#ThrottlingException"] }).category, "throttle");
  assert.equal(classifyKiroFailure({ stage: "stream", status: 200, codes: ["not#valid#ThrottlingException"] }).category, "unknown");
  assert.equal(classifyKiroFailure({ stage: "http", status: 503, body: { state: "invalid" } }).evidence, "http-status");
});

test("strict category conflicts survive overflow signature refinement", () => {
  const info = classifyKiroFailure({ stage: "http", status: 400, codes: ["ContextLengthExceededException"], body: errorBody("ValidationException", "Input is too long for requested model.") });
  assert.equal(info.category, "unknown"); assert.equal(info.conflict, true);
  assert.doesNotMatch(kiroFailureMessage(info, false), /context.length.exceeded/i);
});

test("overflow signatures are associated with their own validation object, never unrelated nested text", () => {
  const info = classifyKiroFailure({ stage: "http", status: 400, body: { state: "json", data: {
    __type: "ValidationException", message: "Invalid field", error: { message: "Input is too long for requested model." },
  } } });
  assert.equal(info.category, "validation"); assert.equal(info.evidence, "code");
});

test("non-JSON evidence and malformed namespaces cannot manufacture recognized codes", () => {
  assert.equal(classifyKiroFailure({ stage: "http", status: 429, body: { state: "too-large", data: { __type: "ThrottlingException" } } }).category, "unknown");
  for (const value of ["com..amazon#ThrottlingException", "com.amazon.#ThrottlingException"]) {
    assert.equal(classifyKiroFailure({ stage: "stream", status: 200, codes: [value] }).category, "unknown");
  }
});

test("HTTP error evidence is bounded by declared and actual bytes with fatal UTF8 and whole JSON", async () => {
  const signal = new AbortController().signal;
  assert.equal((await readKiroErrorBody(http(400, "ValidationException"), signal)).state, "json");
  for (const body of [Buffer.from([0xc3, 0x28]), Buffer.from("[1]"), Buffer.from('{"__type":"ThrottlingException"')]) {
    assert.equal((await readKiroErrorBody(new Response(body), signal)).state, "invalid");
  }
  for (const declared of [false, true]) {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(16385)); }, cancel() { cancelled = true; } }),
      { headers: declared ? { "content-length": "16385" } : {} });
    assert.equal((await readKiroErrorBody(response, signal)).state, "too-large"); assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
  }
  // Derive the exact byte boundary rather than relying on JSON field overhead.
  const base = JSON.stringify({ padding: "" }), exact = JSON.stringify({ padding: "x".repeat(16384 - Buffer.byteLength(base)) });
  assert.equal(Buffer.byteLength(exact), 16384); assert.equal((await readKiroErrorBody(new Response(exact), signal)).state, "json");
});

test("stalled reads and noncooperative cancel are bounded, and buffered empty chunks yield to abort", async t => {
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  let cancelled = false;
  const stalled = new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }));
  const before = performance.now(); assert.equal((await readKiroErrorBody(stalled, new AbortController().signal, 25)).state, "timeout");
  assert.ok(performance.now() - before < 1000); assert.equal(cancelled, true);
  const controller = new AbortController(); let pulls = 0;
  const buffered = new Response(new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array()); } }));
  setTimeout(() => controller.abort(), 0);
  assert.equal((await readKiroErrorBody(buffered, controller.signal)).state, "aborted"); assert.ok(pulls <= 1024);
});

test("default and clamped error-body deadlines release locks without waiting for cancel", async t => {
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  for (const timeout of [undefined, 60000]) await t.test(timeout ? "clamped" : "default", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }));
    const start = performance.now(); const result = await readKiroErrorBody(response, new AbortController().signal, timeout);
    assert.deepEqual(result, { state: "timeout" }); assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
    assert.ok(performance.now() - start >= 800 && performance.now() - start < 3000);
  });
});

test("preabort and external abort interrupt real pending error reads, not just buffered loops", async t => {
  for (const preabort of [false, true]) {
    const controller = new AbortController(); let cancelled = false;
    if (preabort) controller.abort(new Error("PRIVATE rate limit 503")); else { const timer = setTimeout(() => controller.abort(), 10); t.after(() => clearTimeout(timer)); }
    const response = new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }));
    assert.deepEqual(await readKiroErrorBody(response, controller.signal), { state: "aborted" });
    assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
  }
});

test("error-body buffering copies mutable chunks and counts UTF8 bytes rather than string units", async () => {
  const bytes = Buffer.from(JSON.stringify({ __type: "ThrottlingException", message: "中文" })), one = new Uint8Array(1); let at = 0;
  const response = new Response(new ReadableStream({ pull(c) { if (at === bytes.length) c.close(); else { one[0] = bytes[at++]; c.enqueue(one); } } }, { highWaterMark: 0 }));
  const result = await readKiroErrorBody(response, new AbortController().signal); assert.equal(result.data?.__type, "ThrottlingException");
  const available = 16384 - Buffer.byteLength(JSON.stringify({ padding: "" }));
  const padding = "中".repeat(Math.floor(available / 3)) + "x".repeat(available % 3), exact = JSON.stringify({ padding });
  assert.equal(Buffer.byteLength(exact), 16384);
  assert.equal((await readKiroErrorBody(new Response(exact), new AbortController().signal)).state, "json");
  assert.equal((await readKiroErrorBody(new Response(JSON.stringify({ padding: padding + "中" })), new AbortController().signal)).state, "too-large");
});

async function fixture(t: TestContext, options: { auto?: boolean; cancelHook?: boolean; timeout?: number; thinking?: boolean;
  streamHook?: () => void | Promise<void>; payloadHook?: () => unknown; responseHook?: () => void | Promise<void> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-recovery-")), agentDir = join(root, "pi"); mkdirSync(agentDir);
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  const credential: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" };
  await credentials.modify("kiro", async () => credential);
  await modelsStore.write("kiro", { checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential), models: [] } as ModelsStoreEntry);
  const modelsPath = join(root, "models.json"); writeFileSync(modelsPath, JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{ id: "recovery-fixture", baseUrl: "https://q.us-east-1.amazonaws.com", contextWindow: 8192, maxTokens: 1024, ...(options.thinking ? { reasoning: true, thinkingLevelMap: { off: "none", low: "1024" } } : {}) }] } } }));
  const runtime = await createModelRuntime({ providerIds: ["kiro"], credentials, modelsStore, modelsPath, refreshOnCreate: false });
  assert.equal(runtime.getError(), undefined);
  const model = runtime.getModel("kiro", "recovery-fixture"), manager = SessionManager.create(root, root); assert.ok(model);
  const old: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "OWNED_HISTORY" }], api: "kiro-chat", provider: "kiro", model: model.id, timestamp: 1, stopReason: "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  manager.appendMessage({ role: "user", content: "OWNED_OLD_REQUEST", timestamp: 1 }); manager.appendMessage(old);
  manager.appendMessage({ role: "user", content: "OWNED_CURRENT_REQUEST", timestamp: 1 }); manager.appendMessage({ ...old, content: [{ type: "text", text: "OWNED_PREFIX".repeat(20) }] });
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: options.auto ?? true, reserveTokens: 1024, keepRecentTokens: 1 }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 } });
  let hookCalls = 0, executions = 0; const preparedRequests: number[] = [];
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, systemPrompt: "", appendSystemPrompt: [],
    extensionFactories: [pi => { pi.on("session_before_compact", event => {
      if (options.cancelHook) { hookCalls++; return { cancel: true }; }
      preparedRequests.push(event.preparation.isSplitTurn ? 2 : 1);
    }); }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, settingsManager, resourceLoader: loader, sessionManager: manager,
    thinkingLevel: options.thinking ? "low" : "off", tools: ["owned_safe"], noTools: "builtin", customTools: [{ name: "owned_safe", label: "Owned safe counter", description: "Increment only a fixture counter", parameters: Type.Object({}),
      async execute() { executions++; return { content: [{ type: "text", text: "OWNED_TOOL_RESULT" }], details: undefined }; } }] });
  t.after(() => session.dispose());
  if (options.timeout || options.streamHook || options.payloadHook || options.responseHook) {
    const stream = session.agent.streamFunction!;
    session.agent.streamFunction = (m, c, o) => stream(m, c, { ...o, ...(options.timeout ? { timeoutMs: options.timeout } : {}),
      // Inject the public callback directly so a synchronous throw stays synchronous.
      ...(options.streamHook ? { onProviderStreamEvent: options.streamHook } : {}),
      ...(options.payloadHook ? { onPayload: async (payload, model) => { const current = await o?.onPayload?.(payload, model); await options.payloadHook!(); return current; } } : {}),
      ...(options.responseHook ? { onResponse: async (response, model) => { await o?.onResponse?.(response, model); await options.responseHook!(); } } : {}) });
  }
  installKiroCompactionUsage(session);
  const tickets: string[] = [], results: AssistantMessage[] = [], events: string[] = []; let summarizing = false, calls = 0;
  const native = runtime.getRegisteredNativeProvider("kiro")!, stream = native.streamSimple.bind(native);
  t.mock.method(native, "streamSimple", (...args: Parameters<typeof stream>) => { tickets.push(args[2]!.apiKey!); const response = stream(...args); void response.result().then(result => results.push(result)); return response; });
  session.subscribe(event => { events.push(event.type); if (event.type === "compaction_start") summarizing = true; if (event.type === "compaction_end") summarizing = false; });
  return { session, manager, results, events, preparedRequests, get executions() { return executions; }, get calls() { return calls; }, get hookCalls() { return hookCalls; },
    install(respond: (call: number, summarizing: boolean) => Response | Promise<Response>) { t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/"); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer FIXTURE-ACCESS");
      return respond(++calls, summarizing);
    }); },
    verifyFresh(invocations = calls) { assert.equal(tickets.length, invocations); assert.equal(new Set(tickets).size, tickets.length); },
    reopened() { return SessionManager.open(manager.getSessionFile()!); } };
}

test("real AgentSession retries only confirmed zero-output throttle/transient, never quota or unknown429", async t => {
  for (const variant of ["throttle", "transient", "quota", "unknown429", "quoted", "stream-transient"] as const) await t.test(variant, async t => {
    const f = await fixture(t); const retry = ["throttle", "transient", "stream-transient"].includes(variant);
    f.install(call => call > 1 ? success() : variant === "throttle" ? http(429, "ThrottlingException") : variant === "transient" ? http(503)
      : variant === "quota" ? http(429, "ServiceQuotaExceededException") : variant === "quoted" ? http(400, "ValidationException", "PRIVATE rate limit / prompt too long 503")
      : variant === "stream-transient" ? kiroResponse([exception("InternalServerException")]) : http(429));
    await f.session.prompt("OWNED_QUERY"); f.verifyFresh(); assert.equal(f.calls, retry ? 2 : 1); assert.equal(f.executions, 0);
    assert.equal(f.events.filter(type => type === "auto_retry_start").length, retry ? 1 : 0);
    assert.equal(f.events.includes("compaction_start"), false); assert.equal(f.events.at(-1), "agent_settled");
    assert.ok(f.results.every(result => !/PRIVATE/.test(result.errorMessage ?? "")));
    assert.equal(f.reopened().getEntries().some(entry => entry.type === "context_edit"), retry);
  });
});

test("real AgentSession never replays or omits partial text, thinking, tag-buffer, tool or timeout attempts", async t => {
  for (const variant of ["text", "empty-text", "thinking", "tool", "tool-end", "crc", "tag-buffer", "timeout", "usage-inconsistent", "empty-response"] as const) await t.test(variant, async t => {
    const f = await fixture(t, { timeout: variant === "timeout" ? 25 : undefined, thinking: variant === "tag-buffer" });
    const first = variant === "thinking" ? kiroFrame("reasoningContentEvent", { signature: "OWNED_SIGNATURE" })
      : variant.startsWith("tool") ? kiroFrame("toolUseEvent", { toolUseId: "owned-call", name: "owned_safe", input: "{}", ...(variant === "tool-end" ? { stop: true } : {}) })
      : kiroFrame("assistantResponseEvent", { content: variant === "empty-text" || variant === "empty-response" ? "" : variant === "tag-buffer" ? "<thinking>" : "OWNED_PARTIAL" });
    const last = variant === "usage-inconsistent" ? kiroFrame("metadataEvent", { tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 1 } })
      : variant === "empty-response" ? kiroFrame("unknown", {}) : variant === "crc" ? Buffer.from(kiroFrame("assistantResponseEvent", { content: "OWNED_BAD" })) : exception("ContextLengthExceededException", { message: "PRIVATE rate limit 503", requestId: "00000503-0000-0000-0000-000000000429" });
    if (variant === "crc") last[last.length - 1] ^= 1;
    f.install(() => variant === "timeout" ? new Response(new ReadableStream({ start(c) { c.enqueue(first); } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } }) : kiroResponse([first, last]));
    await f.session.prompt("OWNED_QUERY"); f.verifyFresh(); assert.equal(f.calls, 1); assert.equal(f.executions, 0);
    assert.equal(f.events.includes("auto_retry_start"), false); assert.equal(f.events.includes("compaction_start"), false);
    assert.ok(f.results[0].errorMessage?.startsWith(kiroPartialFailure)); assert.equal(f.results[0].stopReason, "error");
    assert.doesNotMatch(f.results[0].errorMessage!, /rate.?limit|503|429|context.length.exceeded|too long|timeout/i);
    if (variant === "usage-inconsistent" || variant === "empty-response") assert.equal(f.results[0].diagnostics?.find(item => item.type === "kiro-failure")?.details?.localCode, variant);
    if (variant === "tag-buffer") assert.equal(f.results[0].content.length, 0, "the actual thinking tag remains unpublished, but upstream progress still blocks replay");
    assert.equal(f.reopened().getEntries().some(entry => entry.type === "context_edit" || entry.type === "compaction"), false);
    assert.ok(f.reopened().buildSessionProjection().messages.some(message => message.role === "assistant" && message.stopReason === "error"));
    assert.doesNotMatch(JSON.stringify(f.results[0].diagnostics), /PRIVATE/);
  });
});

test("real AgentSession partial guard precedes raw text, thinking and tool hooks that throw, reject or stall", async t => {
  for (const kind of ["assistantResponseEvent", "reasoningContentEvent", "toolUseEvent"]) for (const mode of ["throw", "reject", "stall"]) await t.test(`${kind}-${mode}`, async t => {
    const f = await fixture(t, { timeout: 25, streamHook: () => {
      if (mode === "throw") throw new Error("PRIVATE rate limit 503 context length exceeded");
      return mode === "reject" ? Promise.reject(new Error("PRIVATE prompt is too long")) : new Promise(() => {});
    } });
    f.install(() => kiroResponse([kiroFrame(kind, kind === "assistantResponseEvent" ? { content: "OWNED_PARTIAL" } : kind === "reasoningContentEvent" ? { redactedContent: "OWNED_SIGNATURE" }
      : { toolUseId: "owned-call", name: "owned_safe", input: "{}", stop: true })]));
    await f.session.prompt("OWNED_QUERY"); f.verifyFresh(); assert.equal(f.calls, 1); assert.equal(f.executions, 0);
    assert.equal(f.results[0].errorMessage, kiroPartialFailure); assert.deepEqual(f.results[0].content, []);
    assert.equal(f.results[0].diagnostics?.find(item => item.type === "kiro-failure")?.details?.partial, true);
    assert.equal(f.events.includes("auto_retry_start") || f.events.includes("compaction_start"), false);
    assert.equal(f.reopened().getEntries().some(entry => entry.type === "context_edit" || entry.type === "compaction"), false);
  });
});

test("real AgentSession bounds fetch and hooks, cancels late bodies and honors abort-response races", async t => {
  for (const mode of ["fetch-late", "payload", "response", "abort-before-response"] as const) await t.test(mode, async t => {
    const f = await fixture(t, { timeout: 25, ...(mode === "payload" ? { payloadHook: () => new Promise(() => {}) } : {}),
      ...(mode === "response" ? { responseHook: () => new Promise(() => {}) } : {}) });
    let finish: ((response: Response) => void) | undefined, cancelled = false;
    const late = () => new Response(new ReadableStream({ start(c) { c.enqueue(kiroFrame("toolUseEvent", { toolUseId: "owned-call", name: "owned_safe", input: "{}", stop: true })); },
      cancel() { cancelled = true; } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
    f.install(() => { if (mode === "fetch-late") return new Promise(resolve => { finish = resolve; });
      if (mode === "abort-before-response") { queueMicrotask(() => void f.session.abort()); return late(); }
      return success(); });
    await f.session.prompt("OWNED_QUERY"); f.verifyFresh(1); assert.equal(f.calls, mode === "payload" ? 0 : 1); assert.equal(f.executions, 0);
    assert.equal(f.results[0].stopReason, mode === "abort-before-response" ? "aborted" : "error");
    assert.equal(f.events.includes("auto_retry_start") || f.events.includes("compaction_start"), false);
    assert.equal(f.reopened().getEntries().some(entry => entry.type === "context_edit" || entry.type === "compaction"), false);
    if (mode === "fetch-late") { const events = [...f.events], response = late(); assert.ok(finish); finish(response);
      await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
      assert.deepEqual(f.events, events); assert.equal(f.results.length, 1); assert.equal(f.calls, 1); }
    if (mode === "abort-before-response") { assert.equal(cancelled, true); assert.deepEqual(f.results[0].content, []); }
  });
});

test("HTTP error-body local deadline stays unknown rather than becoming a request timeout or a replay hint", async t => {
  const f = await fixture(t, { timeout: 2000 }); let cancelled = false;
  f.install(() => new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }), { status: 429 }));
  await f.session.prompt("OWNED_QUERY"); f.verifyFresh(); assert.equal(f.calls, 1); assert.equal(cancelled, true);
  const info = f.results[0].diagnostics?.find(item => item.type === "kiro-failure")?.details;
  assert.equal(info?.bodyState, "timeout"); assert.equal(info?.category, "unknown"); assert.equal(info?.stage, "http"); assert.equal(info?.status, 429);
  assert.doesNotMatch(f.results[0].errorMessage!, /timeout|超时|429|rate.?limit/i);
  assert.equal(f.events.includes("auto_retry_start") || f.events.includes("compaction_start"), false);
});

test("user abort after a real text delta remains aborted, cancels the stream and persists without omission", async t => {
  const f = await fixture(t); let cancelled = false;
  f.session.subscribe(event => { if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") void f.session.abort(); });
  f.install(() => new Response(new ReadableStream({ start(c) { c.enqueue(kiroFrame("assistantResponseEvent", { content: "OWNED_PARTIAL" })); }, cancel() { cancelled = true; } }),
    { headers: { "content-type": "application/vnd.amazon.eventstream" } }));
  await f.session.prompt("OWNED_QUERY"); f.verifyFresh(); assert.equal(f.calls, 1); assert.equal(cancelled, true); assert.equal(f.executions, 0);
  assert.equal(f.results[0].stopReason, "aborted"); assert.match(f.results[0].errorMessage!, /取消/);
  assert.equal(f.events.includes("auto_retry_start") || f.events.includes("compaction_start"), false);
  const reopened = f.reopened(); assert.equal(reopened.getEntries().some(entry => entry.type === "context_edit" || entry.type === "compaction"), false);
  assert.ok(reopened.buildSessionProjection().messages.some(message => message.role === "assistant" && message.stopReason === "aborted"));
});

test("real AgentSession overflow recovery is explicit and bounded, with disabled and cancelling-hook projections reopened", async t => {
  for (const observed of [false, true]) for (const variant of ["success", "persistent", "disabled", "cancel-hook"] as const) await t.test((observed ? "observed-" : "legacy-") + variant, async t => {
    const f = await fixture(t, { auto: variant !== "disabled", cancelHook: variant === "cancel-hook" }); let normal = 0, summaries = 0;
    const observation = { token: "PROMPT_TOO_LONG", contract: "unverified", source: "local-static-allowlist" } as const;
    f.install((_call, summarizing) => summarizing ? (summaries++, success()) : ++normal > 1 && variant === "success" ? success()
      : observed ? new Response(JSON.stringify({ __type: "ValidationException", reason: observation.token, message: "Input is too long for requested model." }), { status: 400 })
      : http(400, "ValidationException", "Input is too long for requested model."));
    await f.session.prompt("OWNED_QUERY"); f.verifyFresh(); assert.equal(f.executions, 0);
    assert.equal(normal, variant === "disabled" || variant === "cancel-hook" ? 1 : 2);
    assert.equal(summaries, f.preparedRequests.reduce((sum, requests) => sum + requests, 0), "match the public SDK preparation, not a guessed split count");
    assert.equal(f.calls, normal + summaries); assert.equal(f.preparedRequests.length, variant === "success" || variant === "persistent" ? 1 : 0);
    assert.equal(f.results.at(-1)?.stopReason, variant === "success" ? "stop" : "error");
    assert.equal(f.events.includes("auto_retry_start"), false);
    const entries = f.reopened().getEntries(); assert.equal(entries.some(entry => entry.type === "context_edit"), variant !== "disabled");
    assert.equal(entries.some(entry => entry.type === "compaction"), variant === "success" || variant === "persistent");
    assert.equal(f.hookCalls, variant === "cancel-hook" ? 1 : 0);
    const failure = projectKiroFailure(f.results[0]);
    assert.ok(failure); assert.equal(failure.category, "overflow");
    assert.deepEqual(failure.observedValidationReason, observed ? observation : undefined);
  });
});

test("real AgentSession persists fixed-token observations without new retry, compaction or partial-tool execution", async t => {
  for (const variant of ["http", "text", "thinking", "tool"] as const) await t.test(variant, async t => {
    const f = await fixture(t);
    const observation = { token: "PROMPT_TOO_LONG", contract: "unverified", source: "local-static-allowlist" } as const;
    const data = { __type: "ValidationException", reason: observation.token, message: "PRIVATE rate limit 503 context length exceeded" };
    const first = variant === "thinking" ? kiroFrame("reasoningContentEvent", { signature: "OWNED_SIGNATURE" })
      : variant === "tool" ? kiroFrame("toolUseEvent", { toolUseId: "owned-observed-call", name: "owned_safe", input: "{}" })
      : kiroFrame("assistantResponseEvent", { content: "OWNED_PARTIAL" });
    f.install(() => variant === "http" ? new Response(JSON.stringify(data), { status: 400 }) : kiroResponse([first, exception("ValidationException", data)]));
    await f.session.prompt("OWNED_OBSERVATION_QUERY"); f.verifyFresh();
    assert.equal(f.calls, 1); assert.equal(f.executions, 0);
    assert.equal(f.events.includes("auto_retry_start") || f.events.includes("compaction_start"), false);
    const result = f.results[0]; assert.equal(result.stopReason, "error");
    if (variant === "http") assert.match(result.errorMessage!, /Kiro 请求验证失败/);
    else assert.equal(result.errorMessage, kiroPartialFailure);
    assert.doesNotMatch(result.errorMessage!, /PRIVATE|PROMPT_TOO_LONG|rate.?limit|context.length.exceeded/i);
    const expected = { stage: variant === "http" ? "http" : "stream", status: variant === "http" ? 400 : 200,
      category: "validation", partial: variant !== "http", code: "ValidationException", observedValidationReason: observation };
    assert.deepEqual(projectKiroFailure(result), expected);
    const reopened = f.reopened();
    assert.equal(reopened.getEntries().some(entry => entry.type === "context_edit" || entry.type === "compaction"), false);
    const persisted = reopened.buildSessionProjection().messages.find(message => message.role === "assistant" && message.stopReason === "error");
    assert.ok(persisted); assert.deepEqual(projectKiroFailure(persisted), expected);
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE/);
  });
});

test("real AgentSession still executes a complete safe tool, and EOF success records only local inference", async t => {
  const f = await fixture(t);
  f.install(call => call === 1 ? kiroResponse([kiroFrame("toolUseEvent", { toolUseId: "owned-call", name: "owned_safe", input: "{}", stop: true }), kiroFrame("futurePrivateEvent", { private: "PRIVATE-DATA" })])
    : kiroResponse([kiroFrame("assistantResponseEvent", { content: "OWNED_DONE" }), kiroFrame("metadataEvent", { stopReason: "PRIVATE-STOP" })]));
  await f.session.prompt("OWNED_QUERY"); assert.equal(f.executions, 1); assert.equal(f.calls, 2); f.verifyFresh();
  assert.equal(f.results[0].stopReason, "toolUse"); assert.equal(f.results[1].stopReason, "stop");
  for (const [index, result] of f.results.entries()) { const info = result.diagnostics?.find(item => item.type === "kiro-completion-inferred");
    assert.equal(info?.details?.terminalContract, "unverified"); assert.equal(info?.details?.policy, "local-eof-policy");
    assert.equal(info?.details?.unknownEvents, index === 0 ? 1 : 0); assert.equal(info?.details?.unrecognizedStopReasons, index === 1 ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/); }
  assert.equal(f.reopened().getEntries().filter(entry => entry.type === "message" && entry.message.role === "toolResult").length, 1);
});
