import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptSnapshot, scopeOrder, scopeSnapshot, subscribeScope } from "../src/client/transport.js";
import { browserLatency, commitDelivery } from "../src/client/latency.js";
import { optimisticStart, pendingMessages } from "../src/client/chat/optimistic.js";
import type { ChatMessage, ThreadIndex } from "../src/shared/agent.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const messages = (): ChatMessage[] => [
  { id: "a", role: "user", text: "unchanged", inputIds: ["request"] },
  { id: "b", role: "assistant", text: "answer", calls: [{ id: "call", name: "delegate", input: "{}", taskPreview: { titles: ["before"] } }] },
  { id: "c", role: "user", text: "removed later" },
];
const thread = (): ThreadIndex => ({ ids: ["a", "b", "c"], groups: [{ id: "group", ids: ["a", "b", "c"], activity: true }], contextRevision: 1 });

function fixture(sessionId: string) {
  const suffix = `sharing:${sessionId}`, collection = `messages:${suffix}`, index = `thread:${suffix}`;
  const off = [subscribeScope(collection, () => {}), subscribeScope(index, () => {})];
  const read = (id: string) => scopeSnapshot<ChatMessage>(`message:${suffix}:${id}`);
  const send = (seq: number, data: ChatMessage[], value = thread(), streamId = "sharing") =>
    acceptSnapshot({ type: "snapshot", scope: collection, streamId, seq, data, thread: value });
  return { suffix, collection, index, read, send, close: () => off.forEach(fn => fn()) };
}

test("newer equal collection snapshots share complete message and thread data, but still advance delivery", t => {
  const f = fixture("equal"); t.after(f.close);
  f.send(1, messages());
  const first = [f.read("a"), f.read("b"), f.read("c")], originalThread = scopeSnapshot(f.index);
  const order = [scopeOrder(f.collection), scopeOrder(f.index)];
  let notifications = 0;
  t.after(subscribeScope(`message:${f.suffix}:b`, () => notifications++));
  const next = clone(messages());
  // JSON object key order has no display meaning, unlike array order.
  next[0] = { inputIds: next[0].inputIds, text: next[0].text, role: next[0].role, id: next[0].id };
  f.send(2, next, clone(thread()));
  for (const [i, id] of ["a", "b", "c"].entries()) assert.equal(f.read(id), first[i], `${id}: unchanged data must retain identity at a higher seq`);
  assert.equal(scopeSnapshot(f.index), originalThread);
  assert.ok(scopeOrder(f.collection) > order[0] && scopeOrder(f.index) > order[1], "sharing must not hide authoritative delivery");
  assert.equal(notifications, 1, "freshness observers still receive the new snapshot");
  f.send(1, [{ id: "old", role: "user", text: "stale" }]);
  assert.equal(f.read("old"), undefined, "older collections cannot resurrect members");
  assert.equal(f.read("a"), first[0]);
});

test("shared snapshots still commit nested changes and collection removals atomically", t => {
  const f = fixture("changes"); t.after(f.close);
  f.send(1, messages());
  const a = f.read("a"), b = f.read("b"), oldThread = scopeSnapshot(f.index);
  const observations: unknown[] = [];
  t.after(subscribeScope(f.collection, () => observations.push({ a: f.read("a"), b: f.read("b"), c: f.read("c"), index: scopeSnapshot(f.index) })));
  const next = clone(messages()).slice(0, 2);
  next[1].calls![0].taskPreview!.titles = ["after"];
  const nextThread: ThreadIndex = { ids: ["a", "b"], groups: [{ id: "group", ids: ["b", "a"], activity: true }], contextRevision: 2 };
  f.send(2, next, nextThread);
  assert.equal(f.read("a"), a);
  assert.notEqual(f.read("b"), b);
  assert.deepEqual(f.read("b")?.calls?.[0].taskPreview?.titles, ["after"]);
  assert.equal(f.read("c"), undefined);
  assert.notEqual(scopeSnapshot(f.index), oldThread);
  assert.deepEqual(observations, [{ a, b: next[1], c: undefined, index: nextThread }]);
  const withOptional = clone(next); withOptional[1].streaming = false;
  f.send(3, withOptional, nextThread);
  const present = f.read("b");
  f.send(4, clone(next), nextThread);
  assert.notEqual(f.read("b"), present, "removing a field must not be mistaken for equality");
  assert.equal(Object.hasOwn(f.read("b")!, "streaming"), false);
});

test("standalone thread sharing includes metadata and respects stream boundaries", t => {
  const f = fixture("thread"); t.after(f.close);
  f.send(1, messages());
  const original = scopeSnapshot(f.index), order = scopeOrder(f.index);
  acceptSnapshot({ type: "snapshot", scope: f.index, streamId: "sharing", seq: 2, data: clone(thread()) });
  assert.equal(scopeSnapshot(f.index), original);
  assert.ok(scopeOrder(f.index) > order);
  const reordered = clone(thread()); reordered.groups![0].ids = ["b", "a", "c"];
  acceptSnapshot({ type: "snapshot", scope: f.index, streamId: "sharing", seq: 3, data: reordered });
  assert.notEqual(scopeSnapshot(f.index), original, "only a nested array order changed");
  assert.deepEqual(scopeSnapshot<ThreadIndex>(f.index)?.groups?.[0].ids, ["b", "a", "c"]);
  const shortened = clone(reordered); shortened.groups![0].ids.pop();
  acceptSnapshot({ type: "snapshot", scope: f.index, streamId: "sharing", seq: 4, data: shortened });
  assert.notEqual(scopeSnapshot(f.index), reordered, "only a nested array length changed");
  assert.deepEqual(scopeSnapshot<ThreadIndex>(f.index)?.groups?.[0].ids, ["b", "a"]);
  const metadata = { ...clone(shortened), resultVersion: 2 };
  acceptSnapshot({ type: "snapshot", scope: f.index, streamId: "sharing", seq: 5, data: metadata });
  const changed = scopeSnapshot<ThreadIndex>(f.index);
  assert.notEqual(changed, shortened);
  assert.equal(changed?.resultVersion, 2, "same ids cannot conceal a new read/result watermark");
  const message = f.read("a");
  f.send(1, clone(messages()), clone(metadata), "new-server");
  assert.notEqual(f.read("a"), message, "a new server stream starts a new data identity");
  assert.notEqual(scopeSnapshot(f.index), changed, "equal thread data must not share across streams");
  assert.deepEqual(scopeSnapshot(f.index), changed);
});

test("equal authoritative collections still reconcile optimistic inputs", t => {
  const f = fixture("optimistic"); t.after(f.close);
  f.send(1, messages());
  const original = f.read("a"), scope = { workspaceId: "sharing", sessionId: "optimistic" };
  optimisticStart(scope, "request", { text: "unchanged", attachment: null });
  assert.equal(pendingMessages(scope).length, 1);
  f.send(2, clone(messages()));
  assert.equal(f.read("a"), original);
  assert.equal(pendingMessages(scope).length, 0, "reference reuse must not skip reconciliation");
});

test("single-message latency deliveries keep their incoming object and commit evidence", t => {
  const f = fixture("latency"); t.after(f.close);
  f.send(1, messages());
  const original = f.read("a"), incoming = clone(original!);
  const latency = { runId: "sharing-latency", requestId: "request", updateId: 1, workerAt: 1 };
  acceptSnapshot({ type: "snapshot", scope: `message:${f.suffix}:a`, streamId: "sharing", seq: 2, data: incoming, latency });
  assert.equal(f.read("a"), incoming, "streaming delivery path is deliberately outside collection sharing");
  assert.notEqual(f.read("a"), original);
  commitDelivery(f.read("a"));
  assert.deepEqual(browserLatency.snapshot(latency.runId).map(record => record.stage), ["browser.receive", "browser.commit"]);
});
