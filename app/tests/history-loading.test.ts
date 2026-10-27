import assert from "node:assert/strict";
import { test } from "node:test";
import { HistoryStore, type CachedHistory } from "../src/client/chat/history-store.js";
import { HistoryCache } from "../src/client/chat/history-cache.js";
import { HistoryReadQueue } from "../src/client/chat/history-read-queue.js";
import type { HistoryIndex, HistoryRead } from "../src/shared/history.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const index = (revision = "one", groupRevision = "stable"): HistoryIndex => ({ revision,
  segments: [{ id: "s", revision: groupRevision, compression: {} as any, messageIds: ["body"], groups: [
    { id: "body", ids: ["body"], activity: false, estimatedHeight: 100, revision: groupRevision },
  ] }],
});
const body = (revision = "one"): HistoryRead => ({ revision, messages: [{ id: "body", role: "user", text: "cached original" }] });

test("read admission is bounded, removes cancelled descriptors, and yields even if a cancelled reader completes late", async () => {
  const queue = new HistoryReadQueue(1), a = new AbortController(), b = new AbortController(), c = new AbortController();
  let resolveA!: (value: number) => void, starts = 0;
  const first = queue.run(a.signal, () => { starts++; return new Promise<number>(resolve => { resolveA = resolve; }); }).catch(() => -1);
  const skipped = queue.run(b.signal, async () => { starts++; return 2; }).catch(() => -2);
  const next = queue.run(c.signal, async () => { starts++; return 3; });
  assert.equal(starts, 1);
  b.abort(); a.abort();
  assert.equal(await next, 3); assert.equal(await skipped, -2); assert.equal(await first, -1);
  resolveA(1); await tick(); assert.equal(starts, 2);
});

test("a fast fling drops off-screen queued reads and cancels abandoned in-flight bodies after a recycling grace period", async () => {
  const reads: AbortSignal[] = [];
  const store = new HistoryStore(async () => index(), async (_segment, _group, signal) => {
    reads.push(signal); return new Promise<HistoryRead>(() => {});
  });
  await store.refresh();
  for (let i = 0; i < 200; i++) store.acquire("s", `g${i}`)();
  assert.equal(reads.length, 2, "only the bounded active reads reach transport");
  assert.equal(reads.some(signal => signal.aborted), false);
  await wait(150);
  assert.equal(reads.length, 2, "released queued work is never admitted later");
  assert.equal(reads.every(signal => signal.aborted), true);
  assert.ok(Array.from({ length: 200 }, (_, i) => store.range(store.key("s", `g${i}`))).every(range => !range.loading));
  store.dispose();
});

test("brief row recycling coalesces its active read instead of showing a second request", async () => {
  let reads = 0, signal!: AbortSignal, resolve!: (read: HistoryRead) => void;
  const store = new HistoryStore(async () => index(), async (_segment, _group, current) => {
    reads++; signal = current; return new Promise<HistoryRead>(done => { resolve = done; });
  });
  await store.refresh(); const off = store.acquire("s", "body"); off();
  const again = store.acquire("s", "body"); await wait(140);
  assert.equal(signal.aborted, false); assert.equal(reads, 1);
  resolve(body()); await tick(); assert.equal(store.get("body")?.text, "cached original");
  again(); store.dispose();
});

test("temporary admission errors recover on remount with backoff, permanent failures still require retry", async () => {
  let reads = 0;
  const store = new HistoryStore(async () => index(), async () => {
    if (++reads === 1) throw Error("历史读取队列已满，请稍后重试");
    return body();
  });
  await store.refresh(); store.acquire("s", "body")(); await tick();
  const release = store.acquire("s", "body");
  assert.equal(reads, 1); await wait(330);
  assert.equal(reads, 2); assert.equal(store.range(store.key("s", "body")).ready, true);
  release(); store.dispose();
  let failures = 0;
  const failed = new HistoryStore(async () => index(), async () => { failures++; throw Error("permission denied"); });
  await failed.refresh(); failed.acquire("s", "body")(); await tick(); failed.acquire("s", "body")(); await tick();
  assert.equal(failures, 1); failed.dispose();
});

test("a mounted range recovers repeated temporary admission failures without requiring remount", async () => {
  let reads = 0;
  const store = new HistoryStore(async () => index(), async () => {
    if (++reads <= 2) throw Error("历史读取队列已满，请稍后重试");
    return body();
  });
  await store.refresh(); const off = store.acquire("s", "body");
  await wait(710);
  assert.equal(reads, 3); assert.equal(store.range(store.key("s", "body")).ready, true);
  off(); store.dispose();
});

test("pause cancels automatic retries and ignores a late catalogue; reconnect resumes mounted bodies", async () => {
  let reads = 0;
  const store = new HistoryStore(async () => index(), async () => {
    if (++reads === 1) throw Error("历史读取队列已满");
    return body();
  });
  await store.refresh(); const off = store.acquire("s", "body"); await tick();
  store.pause(); await wait(340); assert.equal(reads, 1);
  await store.refresh(); await tick(); assert.equal(reads, 2); assert.equal(store.get("body")?.text, "cached original");
  off(); store.dispose();
  let resolve!: (value: HistoryIndex) => void;
  const paused = new HistoryStore(() => new Promise(done => { resolve = done; }), async () => body());
  const pending = paused.refresh(); paused.pause(); resolve(index()); await pending;
  assert.equal(paused.snapshot().index, null);
  const before = paused.snapshot(); paused.dispose(); await paused.refresh();
  assert.equal(paused.snapshot(), before, "a disposed store cannot restart or change its snapshot");
});

test("budget eviction notifies message and range subscribers after removing their data", async () => {
  const store = new HistoryStore(async () => index(), async () => body(), 1);
  await store.refresh(); const off = store.acquire("s", "body"); await tick();
  let messages = 0, ranges = 0;
  const unMessage = store.subscribeMessage("body", () => { messages++; assert.equal(store.get("body"), null); });
  const unRange = store.subscribeRange(store.key("s", "body"), () => { ranges++; assert.equal(store.range(store.key("s", "body")).ready, false); });
  off(); assert.equal(messages, 1); assert.equal(ranges, 1);
  unMessage(); unRange(); store.dispose();
});

test("returning sessions hydrate successful data into a fresh view, then invalidate only changed archive revisions", async () => {
  const cache = new HistoryCache(); let reads = 0, current = index();
  const create = (key: string) => new HistoryStore(async () => current, async () => { reads++; return body(current.revision); }, undefined, cache.get(key));
  const a = create("workspace:A"); await a.refresh(); a.acquire("s", "body")(); await tick();
  cache.set("workspace:A", a.cached()); a.dispose();
  const b = create("workspace:B"); assert.equal(b.get("body"), null); b.dispose();
  const returned = create("workspace:A");
  assert.equal(returned.get("body")?.text, "cached original", "no loading-only render on return");
  assert.equal(returned.range(returned.key("s", "body")).ready, true);
  await returned.refresh(); const off = returned.acquire("s", "body"); await tick(); assert.equal(reads, 1);
  current = index("two"); await returned.refresh(); assert.equal(returned.get("body")?.text, "cached original");
  current = index("three", "edited"); await returned.refresh(); assert.equal(returned.get("body"), null);
  off(); returned.dispose();
});

test("a displayed live body survives archive promotion without pretending its validating range is ready", async () => {
  let current: HistoryIndex = { revision: "live", segments: [] }, resolve!: (read: HistoryRead) => void;
  const store = new HistoryStore(async () => current, () => new Promise(done => { resolve = done; }));
  await store.refresh();
  const displayed = { id: "body", role: "assistant" as const, text: "already displayed long delivery" };
  store.remember(displayed);
  current = index(); await store.refresh();
  const off = store.acquire("s", "body");
  assert.equal(store.get("body"), displayed, "handoff keeps the same source while the archive read waits");
  assert.equal(store.range(store.key("s", "body")).ready, false, "a preview is not a successful archive read");
  assert.deepEqual(store.cached()?.ranges, [], "unvalidated previews do not leak into detached successful cache");
  resolve(body()); await tick();
  assert.equal(store.get("body")?.text, "cached original", "the validated archive replaces the handoff preview");
  assert.equal(store.range(store.key("s", "body")).ready, true);
  off(); store.dispose(); assert.equal(store.get("body"), null);
});

test("handoff snapshots are bounded, exclude streaming data, and invalidate changed archive revisions", async () => {
  let current = index();
  const store = new HistoryStore(async () => current, async () => body());
  await store.refresh(); store.remember({ id: "body", role: "user", text: "shown before archive" });
  current = index("two"); await store.refresh(); assert.ok(store.get("body"), "unchanged group preserves the handoff");
  current = index("three", "edited"); await store.refresh(); assert.equal(store.get("body"), null);
  store.remember({ id: "stream", role: "assistant", text: "unfinished", streaming: true }); assert.equal(store.get("stream"), null);
  for (let i = 0; i < 130; i++) store.remember({ id: `m${i}`, role: "user", text: "small" });
  assert.equal(store.get("m0"), null); assert.ok(store.get("m129")); store.dispose();
  const tiny = new HistoryStore(async () => index(), async () => body(), 512);
  tiny.remember({ id: "first", role: "user", text: "x".repeat(120) });
  tiny.remember({ id: "second", role: "user", text: "x".repeat(120) });
  assert.equal(tiny.get("first"), null); assert.ok(tiny.get("second"));
  tiny.remember({ id: "oversized", role: "user", text: "x".repeat(512) }); assert.equal(tiny.get("oversized"), null); tiny.dispose();
});

test("uncachable newer handoffs invalidate old bodies, including changed compression summaries", async () => {
  let current = index();
  const store = new HistoryStore(async () => current, async () => body(), 512);
  store.remember({ id: "body", role: "user", text: "old" });
  store.remember({ id: "body", role: "user", text: "x".repeat(512) });
  assert.equal(store.get("body"), null, "rejecting a large replacement must not expose its old text");
  store.remember({ id: "body", role: "user", text: "old" });
  store.remember({ id: "body", role: "assistant", text: "streaming replacement", streaming: true });
  assert.equal(store.get("body"), null);
  await store.refresh(); store.remember({ id: "s", role: "assistant", text: "old summary" });
  current = index("two", "changed"); await store.refresh();
  assert.equal(store.get("s"), null, "compression summary uses the segment revision too");
  store.dispose();
});

test("late live snapshots cannot resurrect stale handoffs after authoritative archive eviction", async () => {
  const store = new HistoryStore(async () => index(), async () => ({ ...body(), messages: [{ id: "body", role: "user", text: "new".repeat(1000) }] }), 512);
  await store.refresh(); const off = store.acquire("s", "body"); await tick();
  assert.equal(store.get("body")?.text, "new".repeat(1000));
  store.remember({ id: "body", role: "user", text: "old live snapshot" });
  off(); assert.equal(store.get("body"), null, "evicting validated data must not reveal an old live snapshot");
  store.dispose();
});

test("detached history is LRU-bounded by entries and total bytes and never saves loading/error state", async () => {
  const cache = new HistoryCache(100, 2);
  const entry = (revision: string): CachedHistory => ({ index: { revision, segments: [] }, ranges: [], bytes: 40 });
  cache.set("a", entry("a")); cache.set("b", entry("b")); cache.get("a"); cache.set("c", entry("c"));
  assert.equal(cache.get("b"), undefined); assert.equal(cache.bytes, 80);
  cache.set("a", { ...entry("too large"), bytes: 101 }); assert.equal(cache.get("a"), undefined); assert.equal(cache.bytes, 40);
  const store = new HistoryStore(async () => index(), async () => { throw Error("failed"); });
  await store.refresh(); store.acquire("s", "body")(); await tick();
  assert.deepEqual(store.cached()?.ranges, []); store.dispose();
});
