import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore, Type, type AssistantMessageEvent, type Context, type Model, type StreamOptions } from "@earendil-works/pi-ai";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { KiroToolInput } from "../src/server/providers/kiro-tool-input.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const LIMIT = 1024 * 1024;
const model: Model<"kiro-chat"> = { id: "fixture", name: "Fixture", provider: "kiro", api: "kiro-chat", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const tool = { name: "read", description: "Fixture read", parameters: Type.Object({ path: Type.String() }) };
const context: Context = { tools: [tool], messages: [{ role: "user", content: "Read fixture", timestamp: 1 }] };
async function run(fetch: typeof globalThis.fetch, options: StreamOptions = {}) {
  const account: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" };
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => account);
  const models = createModels({ credentials }); models.setProvider(kiroProvider());
  const stream = models.stream(model, context, { ...options, fetch });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { result: await stream.result(), events };
}

test("Kiro tool accumulation scans each fragment once and geometrically bounds all preview input", t => {
  const raw = JSON.stringify({ path: "a".repeat(LIMIT - 11) });
  assert.equal(Buffer.byteLength(raw), LIMIT);
  const input = new KiroToolInput(), original = Buffer.byteLength;
  let scannedUnits = 0, previewUnits = 0, previews = 0, now = 0;
  t.mock.method(Buffer, "byteLength", (value: Parameters<typeof Buffer.byteLength>[0], encoding?: BufferEncoding) => {
    if (typeof value === "string") scannedUnits += value.length;
    return original(value, encoding);
  });
  for (let offset = 0; offset < raw.length; offset += 11) {
    input.append(raw.slice(offset, offset + 11));
    const preview = input.preview(now += 50);
    if (preview !== undefined) { previews++; previewUnits += preview.length; }
  }
  assert.equal(scannedUnits, raw.length, "no full accumulated byteLength rescans");
  assert.ok(previews > 0 && previews <= 9, `preview count ${previews}`);
  assert.ok(previewUnits < 2 * raw.length, `preview scan units ${previewUnits}`);
  assert.equal(input.byteLength, LIMIT);
  assert.equal(input.complete(), raw);
  assert.throws(() => input.append(""), /已结束/);
  assert.throws(() => input.complete(), /重复结束/);
});

test("Kiro tool UTF-8 accounting handles split surrogate pairs, empties and arbitrary UTF-16 cuts", () => {
  const examples = [
    JSON.stringify({ path: "ASCII中文😀🦊\\u0041\\\"" }),
    '{"path":"\ud83d\ud83d\ude00\ude00"}',
  ];
  for (const raw of examples) {
    for (const width of [1, 2, 3, 7]) {
      const input = new KiroToolInput(); let accumulated = "";
      for (let offset = 0; offset < raw.length; offset += width) {
        const part = raw.slice(offset, offset + width); input.append(part); input.append(""); accumulated += part;
        assert.equal(input.byteLength, Buffer.byteLength(accumulated, "utf8"));
      }
      assert.equal(input.complete(), raw);
      assert.deepEqual(JSON.parse(raw), JSON.parse(accumulated));
    }
  }
  const input = new KiroToolInput(); input.append("\ud83d"); input.append(""); input.append("\ude00");
  assert.equal(input.byteLength, 4); assert.equal(input.complete(), "😀");
});

test("Kiro tool byte boundary is exact for CJK and for a surrogate pair spanning the final bytes", () => {
  const raw = JSON.stringify({ path: "中".repeat(Math.floor((LIMIT - 11) / 3)) + "a".repeat((LIMIT - 11) % 3) });
  const input = new KiroToolInput(); input.append(raw);
  assert.equal(input.byteLength, LIMIT); assert.throws(() => input.append(" "), /1 MiB/); assert.equal(input.complete(), raw);
  const splitPair = new KiroToolInput(); splitPair.append("a".repeat(LIMIT - 5)); splitPair.append("\ud83d"); splitPair.append(""); splitPair.append("\ude00"); splitPair.append("a");
  assert.equal(splitPair.byteLength, LIMIT); assert.throws(() => splitPair.append("a"), /1 MiB/);
});

test("Kiro tool preview is rate-limited as well as geometrically bounded", () => {
  const input = new KiroToolInput(); input.append("a".repeat(4096));
  assert.equal(input.preview(0)?.length, 4096);
  input.append("b".repeat(4096)); assert.equal(input.preview(49), undefined);
  assert.equal(input.preview(50)?.length, 8192);
  input.append("c".repeat(4095)); assert.equal(input.preview(1000), undefined);
  input.append("c".repeat(4097)); assert.equal(input.preview(1001)?.length, 16384);
});

test("Kiro real stream preserves original deltas across provider surrogate cuts and network byte cuts", async () => {
  const value = "中文😀\\u0041\\\"", raw = JSON.stringify({ path: value }), at = raw.indexOf("😀") + 1;
  const parts = [raw.slice(0, at), "", raw.slice(at)];
  const frames = parts.map((input, index) => kiroFrame("toolUseEvent", { toolUseId: "split", ...(index === 0 ? { name: "read" } : {}), input, ...(index === parts.length - 1 ? { stop: true } : {}) }));
  const { result, events } = await run(async () => kiroResponse(frames, 1));
  assert.equal(result.stopReason, "toolUse", result.errorMessage);
  assert.deepEqual(result.content, [{ type: "toolCall", id: "split", name: "read", arguments: { path: value } }]);
  assert.deepEqual(events.filter(event => event.type === "toolcall_delta").map(event => event.delta), parts);
  assert.equal(events.filter(event => event.type === "toolcall_end").length, 1);
});

test("Kiro real stream accepts exactly 1 MiB of JSON and rejects one extra byte without tool end", async () => {
  const raw = JSON.stringify({ path: "a".repeat(LIMIT - 11) });
  for (const extra of [false, true]) {
    const frames = [kiroFrame("toolUseEvent", { toolUseId: "limit", name: "read", input: raw }), kiroFrame("toolUseEvent", { toolUseId: "limit", input: extra ? " " : "", stop: true })];
    const { result, events } = await run(async () => kiroResponse(frames));
    assert.equal(result.stopReason, extra ? "error" : "toolUse", result.errorMessage);
    assert.equal(events.filter(event => event.type === "toolcall_end").length, extra ? 0 : 1);
    if (extra) assert.match(result.errorMessage!, /1 MiB/);
    else assert.equal(result.content[0].type === "toolCall" && result.content[0].arguments.path, "a".repeat(LIMIT - 11));
  }
});

test("Kiro a large unfinished frame in immediately-readable one-byte chunks yields to cancel timers", async t => {
  const frame = kiroFrame("assistantResponseEvent", { content: "a".repeat(128 * 1024) });
  const controller = new AbortController(); let pulled = 0, cancelled = false, started = 0, aborted = 0;
  const { result, events } = await run(async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ pull(c) {
      if (pulled < frame.length) c.enqueue(frame.subarray(pulled, ++pulled));
      else c.close();
    }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
    started = performance.now(); setTimeout(() => { aborted = performance.now(); controller.abort(); }, 0);
    return response;
  }, { signal: controller.signal });
  const settled = performance.now();
  assert.equal(result.stopReason, "aborted", result.errorMessage);
  assert.ok(pulled > 0 && pulled < frame.length, `must yield before completing the large frame: ${pulled}/${frame.length}`);
  assert.ok(cancelled); assert.equal(events.some(event => event.type === "text_delta" || event.type === "toolcall_end" || event.type === "done"), false);
  t.diagnostic(`tiny-chunk cancel: pulled=${pulled}/${frame.length}; timer_ms=${(aborted - started).toFixed(3)}; settle_ms=${(settled - aborted).toFixed(3)}`);
});

test("Kiro buffered micro-fragments yield to cancellation before final JSON or tool execution", async t => {
  const start = kiroFrame("toolUseEvent", { toolUseId: "dense", name: "read", input: '{"path":"' });
  const delta = kiroFrame("toolUseEvent", { toolUseId: "dense", input: "a" });
  const end = kiroFrame("toolUseEvent", { toolUseId: "dense", input: '"}', stop: true });
  // Construct all fixture bytes before starting the timer: generation is not the
  // cancellation latency being measured. Keep the reader open to verify cancel.
  const bytes = Buffer.concat([start, ...Array<Buffer>(20000).fill(delta), end]);
  const controller = new AbortController(); let cancelled = false, started = 0, aborted = 0, observed = 0, afterAbort = 0;
  const { result, events } = await run(async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
    started = performance.now(); setTimeout(() => { aborted = performance.now(); controller.abort(); }, 0);
    return response;
  }, { signal: controller.signal, onProviderStreamEvent: () => { observed++; if (controller.signal.aborted) afterAbort++; } });
  const settled = performance.now();
  assert.equal(result.stopReason, "aborted", result.errorMessage); assert.ok(cancelled);
  assert.ok(observed > 0 && observed < 20000, `events before cancel ${observed}`); assert.equal(afterAbort, 0);
  assert.equal(events.some(event => event.type === "toolcall_end" || event.type === "done"), false);
  assert.ok(settled - aborted < 1000, "generous loaded-CI bound; not a hard realtime guarantee");
  t.diagnostic(`buffered cancel: observed=${observed}; timer_ms=${(aborted - started).toFixed(3)}; settle_ms=${(settled - aborted).toFixed(3)}`);
});
