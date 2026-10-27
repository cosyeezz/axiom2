import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { normalizeContext, type Api, type AssistantMessage, type Model, type Usage } from "@earendil-works/pi-ai";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { installKiroCompactionUsage } from "../src/server/kiro-compaction-usage.js";
import { kiroRequestUsage } from "../src/server/providers/kiro-usage.js";
import { kiroCompactionAttemptKind, kiroUsageInfo } from "../src/shared/kiro-usage.js";

// Narrow public-instance guard tests. Actual SDK compaction/worker integration is
// exercised separately in kiro-compaction.test and kiro-compression-worker.test.
const model: Model<Api> = { api: "kiro-chat", provider: "kiro", id: "owned", name: "owned", baseUrl: "https://q.us-east-1.amazonaws.com",
  reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 2, output: 8, cacheRead: .5, cacheWrite: 3 } };
const context = normalizeContext({ messages: [] });
const message = (stopReason: AssistantMessage["stopReason"] = "stop", zero = false): AssistantMessage => {
  const measurement = kiroRequestUsage(model);
  if (stopReason !== "error") measurement.accept({ uncachedInputTokens: zero ? 0 : 10, outputTokens: zero ? 0 : 3,
    cacheReadInputTokens: zero ? 0 : 2, cacheWriteInputTokens: zero ? 0 : 1, totalTokens: zero ? 0 : 16 });
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1,
    content: [{ type: "text", text: "OWNED_SUMMARY" }], stopReason, usage: measurement.usage };
};
type Stream = AgentSession["agent"]["streamFunction"];
type Output = Awaited<ReturnType<Stream>>;
function fixture(outputs: (AssistantMessage | Promise<AssistantMessage>)[], asynchronous = false) {
  const manager = SessionManager.inMemory(tmpdir()), appends: Parameters<typeof manager.appendCompaction>[] = [];
  const originalAppend = manager.appendCompaction.bind(manager);
  manager.appendCompaction = (...args) => { appends.push(args); return originalAppend(...args); };
  let reads = 0, invocations = 0;
  const raw = outputs.map(response => ({ result: () => { reads++; return Promise.resolve(response); } }) as Output);
  const stream: Stream = () => {
    const output = raw[invocations++]; if (!output) throw Error("Unexpected extra model invocation");
    return asynchronous ? Promise.resolve(output) : output;
  };
  let listener: Parameters<AgentSession["subscribe"]>[0] | undefined;
  const session = { sessionManager: manager, agent: { streamFunction: stream }, subscribe(callback: NonNullable<typeof listener>) {
    listener = callback; return () => {};
  } } as unknown as AgentSession;
  const guard = installKiroCompactionUsage(session);
  const installed = session.agent.streamFunction, append = manager.appendCompaction;
  assert.equal(installKiroCompactionUsage(session, { externalBilling: true }), guard);
  assert.equal(session.agent.streamFunction, installed); assert.equal(manager.appendCompaction, append);
  const emit = (type: "compaction_start" | "compaction_end") => listener!({ type } as Parameters<NonNullable<typeof listener>>[0]);
  const checkpoint = (usage?: Usage, fromHook = false) => manager.appendCompaction("OWNED_SUMMARY", null, 16, undefined, fromHook, usage);
  const attempts = () => manager.getEntries().filter((entry): entry is Extract<typeof entry, { type: "usage" }> =>
    entry.type === "usage" && entry.kind === kiroCompactionAttemptKind);
  return { session, manager, guard, raw, appends, emit, checkpoint, attempts, reads: () => reads, invocations: () => invocations };
}

test("single-summary alias is copied and repeated result calls share one observation", async t => {
  for (const asynchronous of [false, true]) await t.test(asynchronous ? "async stream" : "sync stream", async () => {
    const response = message(), f = fixture([response], asynchronous), physical = JSON.stringify(response.usage);
    f.emit("compaction_start");
    const output = await f.session.agent.streamFunction(model, context);
    assert.equal(output.result(), output.result()); assert.equal(await output.result(), response); assert.equal(f.reads(), 1);
    f.checkpoint(response.usage); f.emit("compaction_end"); f.emit("compaction_end");
    assert.equal(f.appends.length, 1); assert.notEqual(f.appends[0][5], response.usage);
    assert.equal(kiroUsageInfo(f.appends[0][5])?.scope, "summary");
    assert.equal(JSON.stringify(response.usage), physical); assert.equal(f.attempts().length, 0);
  });
});

test("inactive and nonKiro streams keep the original stream and result identity", async () => {
  const response = message(), f = fixture([response, response]);
  assert.equal(f.session.agent.streamFunction(model, context), f.raw[0]);
  f.emit("compaction_start");
  const control = { ...model, api: "openai-completions", provider: "control" };
  assert.equal(f.session.agent.streamFunction(control, context), f.raw[1]);
  f.checkpoint(response.usage); f.emit("compaction_end");
  assert.equal(f.appends[0][5], response.usage); assert.equal(f.attempts().length, 0); assert.equal(f.reads(), 0);
});

test("custom, mixed, missing and unmatched aggregates never acquire invented summary provenance", async t => {
  for (const variant of ["fromHook", "mixed", "different-model", "foreign-response", "missing", "unmatched", "invalid-marker"] as const) await t.test(variant, async () => {
    const response = message(), f = fixture([response, response]);
    if (variant === "invalid-marker") (response.usage as Usage & { axiomKiro: unknown }).axiomKiro = { version: 999 };
    if (variant === "foreign-response") response.api = "openai-completions";
    f.emit("compaction_start");
    await (await f.session.agent.streamFunction(model, context)).result();
    if (variant === "mixed") f.session.agent.streamFunction({ ...model, api: "openai-completions", provider: "control" }, context);
    if (variant === "different-model") f.session.agent.streamFunction({ ...model, id: "other" }, context);
    const usage = variant === "missing" ? undefined : variant === "unmatched" ? { ...response.usage, totalTokens: 17 } : response.usage;
    f.checkpoint(usage, variant === "fromHook"); f.emit("compaction_end");
    assert.equal(f.appends.length, 1); assert.equal(f.appends[0][5], usage); assert.equal(f.attempts().length, 0);
    assert.notEqual(kiroUsageInfo(f.appends[0][5])?.scope, "summary");
  });
});

test("a late prior generation result cannot change a later summary or retrospectively reprice its unknown ledger", async () => {
  let resolve!: (message: AssistantMessage) => void;
  const pending = new Promise<AssistantMessage>(done => { resolve = done; }), current = message(), f = fixture([pending, current]);
  f.emit("compaction_start"); const oldResult = (await f.session.agent.streamFunction(model, context)).result();
  f.emit("compaction_end"); assert.equal(f.attempts().length, 1); assert.equal(kiroUsageInfo(f.attempts()[0].usage)?.state, "unknown");
  const oldLedger = JSON.stringify(f.attempts()[0]);
  f.emit("compaction_start"); await (await f.session.agent.streamFunction(model, context)).result();
  f.checkpoint(current.usage); f.emit("compaction_end"); resolve(message()); await oldResult;
  assert.equal(JSON.stringify(f.attempts()[0]), oldLedger);
  const info = kiroUsageInfo(f.appends[0][5]); if (info?.scope !== "summary") throw Error("Missing current summary");
  assert.equal(info.requests.length, 1); assert.equal(f.attempts().length, 1); assert.equal(f.invocations(), 2);
});

test("measured zero aborted without a signal is never adopted or followed by another native summary", async () => {
  const first = message(), aborted = message("aborted", true), f = fixture([first, aborted]);
  f.emit("compaction_start");
  await (await f.session.agent.streamFunction(model, context)).result();
  assert.equal(await (await f.session.agent.streamFunction(model, context)).result(), aborted);
  assert.equal(f.guard.isCancelled(), true);
  assert.throws(() => f.checkpoint(first.usage), /取消/);
  assert.throws(() => f.session.agent.streamFunction(model, context), /取消/);
  f.emit("compaction_end"); assert.equal(f.guard.isCancelled(), false);
  assert.equal(f.appends.length, 0); assert.equal(f.invocations(), 2); assert.equal(f.attempts().length, 2);
  assert.equal(f.manager.getEntries().some(entry => entry.type === "compaction"), false);
});

test("an already aborted dispatch is delegated unchanged and never creates a physical charge", () => {
  const f = fixture([message("aborted", true)]), controller = new AbortController(); controller.abort();
  f.emit("compaction_start");
  assert.equal(f.session.agent.streamFunction(model, context, { signal: controller.signal }), f.raw[0]);
  f.emit("compaction_end"); assert.equal(f.attempts().length, 0); assert.equal(f.reads(), 0);
});

test("rejected streams and results retain one unknown invocation, without inventing measured zero", async t => {
  for (const resultRejects of [false, true]) await t.test(resultRejects ? "result rejects" : "stream throws", async () => {
    const f = fixture(resultRejects ? [Promise.reject(Error("Owned result rejection"))] : []);
    f.emit("compaction_start");
    await assert.rejects(async () => (await f.session.agent.streamFunction(model, context)).result(), /Owned result rejection|Unexpected extra/);
    f.emit("compaction_end"); f.emit("compaction_end");
    assert.equal(f.attempts().length, 1); assert.equal(kiroUsageInfo(f.attempts()[0].usage)?.state, "unknown");
    assert.equal(f.appends.length, 0);
  });
});

test("same-window unrelated zero usage is not adopted by a real single-summary usage alias", async () => {
  const unrelated = message("stop", true), used = message(), f = fixture([unrelated, used]);
  f.emit("compaction_start");
  await (await f.session.agent.streamFunction(model, context)).result();
  await (await f.session.agent.streamFunction(model, context)).result();
  f.checkpoint(used.usage); f.emit("compaction_end");
  const info = kiroUsageInfo(f.appends[0][5]); if (info?.scope !== "summary") throw Error("Missing summary");
  assert.equal(info.requests.length, 1, "exact physical usage identity excludes an incidental zero-count call");
  assert.equal(f.attempts().length, 0, "do not claim ownership of unrelated same-window calls");
});

test("a zero-count extra success makes a two-part aggregate ambiguous rather than a three-request summary", async () => {
  const first = message(), second = message(), unrelated = message("stop", true), f = fixture([first, unrelated, second]);
  f.emit("compaction_start");
  for (let index = 0; index < 3; index++) await (await f.session.agent.streamFunction(model, context)).result();
  // Pi combines standard fields into a new unmarked object only for two parts.
  const { axiomKiro: _marker, ...usage } = structuredClone(first.usage) as Usage & { axiomKiro?: unknown };
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) usage[key] += second.usage[key];
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) usage.cost[key] += second.usage.cost[key];
  f.checkpoint(usage); f.emit("compaction_end");
  assert.equal(f.appends[0][5], usage); assert.equal(kiroUsageInfo(f.appends[0][5]), undefined);
  assert.equal(f.attempts().length, 0);
});

test("retry failure is kept outside its successful single-summary checkpoint", async () => {
  const failed = message("error"), success = message(), f = fixture([failed, success]);
  f.emit("compaction_start");
  await (await f.session.agent.streamFunction(model, context)).result();
  await (await f.session.agent.streamFunction(model, context)).result();
  f.checkpoint(success.usage); f.emit("compaction_end");
  assert.equal(f.appends.length, 1); assert.equal(f.attempts().length, 1);
  assert.deepEqual(f.attempts()[0].usage, failed.usage);
  const info = kiroUsageInfo(f.appends[0][5]); if (info?.scope !== "summary") throw Error("Missing summary");
  assert.equal(info.requests.length, 1);
});
