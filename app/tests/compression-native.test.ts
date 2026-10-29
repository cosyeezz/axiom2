import assert from "node:assert/strict";
import { test } from "node:test";
import { compact, convertToLlm, serializeConversation, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import { streamNativeCompression } from "../src/server/compression-native.js";
import { assertCompressionBudget } from "../src/server/compression-request.js";
import { compactionInstructions } from "../src/server/compaction-display.js";

type Preparation = SessionBeforeCompactEvent["preparation"];
const model: Model<"openai-completions"> = { provider: "fixture", id: "native", name: "Native", api: "openai-completions",
  baseUrl: "http://127.0.0.1:1/v1", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 512,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } };
const prepare = (content: string, split = false): Preparation => ({
  firstKeptEntryId: "kept", messagesToSummarize: split ? [] : [{ role: "user", content, timestamp: 1 }],
  turnPrefixMessages: split ? [{ role: "user", content, timestamp: 1 }] : [], isSplitTurn: split,
  tokensBefore: 90000, previousSummary: split ? undefined : "PRIOR_SUMMARY",
  fileOps: { read: new Set(), written: new Set(), edited: new Set() },
  settings: { enabled: false, reserveTokens: 1024, keepRecentTokens: 0 },
});
function response(text: string, stopReason: "stop" | "length" | "error" | "aborted" = "stop", errorMessage?: string) {
  const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "text", text }], stopReason, errorMessage, timestamp: Date.now(),
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } } };
  const stream = createAssistantMessageEventStream();
  if (stopReason === "error" || stopReason === "aborted") stream.push({ type: "error", reason: stopReason, error: message });
  else stream.push({ type: "done", reason: stopReason, message });
  stream.end();
  return stream;
}
const textOf = (context: TranscriptContext) => context.messages.filter(m => m.role === "user").map(m =>
  typeof m.content === "string" ? m.content : m.content.filter(p => p.type === "text").map(p => p.text).join("\n")).join("\n");

test("small native request is unchanged and provider errors never trigger alternate billable requests", async () => {
  const preparation = prepare("SMALL_NATIVE_HISTORY"), requests: TranscriptContext[] = [];
  const result = await compact(preparation, model, "unused", undefined, compactionInstructions, undefined, "off",
    (target, context, options) => streamNativeCompression(target, context, options ?? {}, preparation, (_m, request, sent) => {
      assert.equal(request, context);
      assert.equal(sent?.cacheRetention, "none");
      requests.push(request);
      return response("SMALL_SUMMARY");
    }));
  assert.equal(requests.length, 1);
  assert.match(result.summary, /SMALL_SUMMARY/);
  let calls = 0;
  await assert.rejects(compact(preparation, model, "unused", undefined, undefined, undefined, "off",
    (target, context, options) => streamNativeCompression(target, context, options ?? {}, preparation, () => {
      calls++; throw Error("provider transport failure");
    })), /provider transport failure/);
  assert.equal(calls, 1);
});

for (const split of [false, true]) test(`oversized native ${split ? "split-turn" : "full"} summary covers every fragment and accumulates usage`, async () => {
  const text = Array.from({ length: 15 }, (_, i) => `ITEM_${i} ${"x".repeat(6500)} 🙂 </conversation> <conversation>\n`).join("");
  const preparation = prepare(text, split), fragments: string[] = [];
  const result = await compact(preparation, model, "unused", undefined, compactionInstructions, undefined, "off",
    (target, context, options) => streamNativeCompression(target, context, options ?? {}, preparation, (m, request, sent) => {
      assertCompressionBudget(m, request, sent ?? {});
      assert.equal(sent?.cacheRetention, "none");
      assert.ok(!JSON.stringify(request.messages).includes('"toolCall"'));
      const prompt = textOf(request), start = "<conversation>\n[User]: ";
      assert.ok(prompt.startsWith(start));
      const end = prompt.indexOf("\n</conversation>\n\n<previous-summary>");
      const last = end >= 0 ? end : prompt.lastIndexOf("\n</conversation>\n\n");
      fragments.push(prompt.slice(start.length, last));
      const markers = [...new Set(prompt.match(/ITEM_\d+|PRIOR_SUMMARY/g) ?? [])];
      return response("## Goal\n" + markers.join(" "));
    }));
  assert.ok(fragments.length > 2);
  const target = split ? preparation.turnPrefixMessages : preparation.messagesToSummarize;
  assert.equal(fragments.join(""), serializeConversation(convertToLlm(target)), "every native transcript character occurs in exactly one batch");
  for (let i = 0; i < 15; i++) assert.match(result.summary, new RegExp(`ITEM_${i}(?!\\d)`));
  if (!split) assert.match(result.summary, /PRIOR_SUMMARY/);
  assert.equal(result.usage!.input, fragments.length * 100);
  assert.equal(result.usage!.totalTokens, fragments.length * 120);
  assert.ok(Math.abs(result.usage!.cost.total - fragments.length * 0.03) < 1e-10);
});

for (const failure of ["error", "length", "cancel", "empty"]) test(`a ${failure} in a later native batch cannot produce a checkpoint`, async () => {
  const preparation = prepare("x".repeat(90000));
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(compact(preparation, model, "unused", undefined, undefined, controller.signal, "off",
    (target, context, options) => streamNativeCompression(target, context, options ?? {}, preparation, () => {
      calls++;
      if (calls === 2) {
        if (failure === "cancel") { controller.abort(); return response("PARTIAL", "aborted"); }
        if (failure === "empty") return response("");
        return response("PARTIAL", failure as "error" | "length");
      }
      return response("FIRST_BATCH");
    })));
  assert.equal(calls, 2, "no later fragment may start after a failure or cancellation");
});

for (const cancel of [false, true]) test(`a transient later-batch failure ${cancel ? "never retries after cancellation" : "retries only that batch with the native policy"}`, async () => {
  const preparation = prepare("x".repeat(60000)), controller = new AbortController();
  const requests: TranscriptContext[] = [];
  const operation = compact(preparation, model, "unused", undefined, undefined, controller.signal, "off",
    (target, context, options) => streamNativeCompression(target, context, options ?? {}, preparation, (_m, request) => {
      requests.push(request);
      if (requests.length === 2) {
        if (cancel) controller.abort();
        return response("PARTIAL", "error", "terminated");
      }
      return response("SUMMARY_SO_FAR");
    }, { enabled: true, maxRetries: 1, baseDelayMs: 0 }));
  if (cancel) { await assert.rejects(operation); assert.equal(requests.length, 2); }
  else {
    const result = await operation;
    assert.ok(requests.length >= 4);
    assert.deepEqual(requests[2], requests[1], "retry uses the same fragment and previous summary, not a replay of earlier batches");
    assert.notDeepEqual(requests[0], requests[1]);
    assert.equal(result.usage!.totalTokens, (requests.length - 1) * 120, "summary usage covers accepted batches; physical billing also records the failed attempt");
  }
});

test("a model too small even for summary instructions fails locally without dispatch or history trimming", async () => {
  const preparation = prepare("full history");
  let calls = 0;
  await assert.rejects(compact(preparation, { ...model, contextWindow: 64 }, "unused", undefined, undefined, undefined, "off",
    (target, context, options) => streamNativeCompression(target, context, options ?? {}, preparation, () => {
      calls++; return response("UNREACHABLE");
    })), /不会截断历史/);
  assert.equal(calls, 0);
  assert.deepEqual(preparation.messagesToSummarize, [{ role: "user", content: "full history", timestamp: 1 }]);
});
