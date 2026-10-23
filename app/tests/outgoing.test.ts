import assert from "node:assert/strict";
import { test } from "node:test";
import { OutgoingQueue, encode } from "../src/server/outgoing.js";

test("blocked current-state history lets ready frames through and captures the latest terminal state", async () => {
  const callbacks: (() => void)[] = [], sent: any[] = [];
  let constructed = 0, state = "running";
  const queue = new OutgoingQueue((payload, done) => { sent.push(JSON.parse(payload)); callbacks.push(done); }, () => assert.fail("unexpected overflow"), 1024);
  const release = await queue.reserveRead(new AbortController().signal);
  queue.lazy(() => { constructed++; return { snapshot: "y".repeat(8000), state }; });
  state = "done";
  queue.send({ terminal: true }); queue.send({ ping: true });
  assert.equal(constructed, 0); assert.equal(sent[0].terminal, true);
  queue.send({ result: "x".repeat(8000) }, undefined, release, true);
  callbacks.shift()!(); assert.equal(sent[1].ping, true); assert.equal(constructed, 0);
  callbacks.shift()!(); assert.equal(sent[2].result.length, 8000); assert.equal(constructed, 0);
  callbacks.shift()!(); assert.equal(constructed, 1); assert.equal(sent[3].state, "done");
  callbacks.shift()!();
  assert.equal(queue.queuedBytes + queue.inFlightBytes, 0);
});
test("queued reads acquire the slot between writes without waiting for a continuous stream to empty", async () => {
  const callbacks: (() => void)[] = [];
  const queue = new OutgoingQueue((_payload, done) => callbacks.push(done), () => assert.fail("overflow"));
  queue.send({ n: 0 }); queue.send({ n: 1 });
  let admitted = false;
  const waiting = queue.reserveRead(new AbortController().signal).then(release => { admitted = true; return release; });
  callbacks.shift()!(); queue.send({ n: 2 });
  await Promise.resolve();
  assert.equal(admitted, true, "read is admitted despite a queued and an in-flight frame");
  const release = await waiting;
  release(); release();
  while (callbacks.length) callbacks.shift()!();
  queue.close();
});

test("read response cannot overtake a ready terminal behind a lazy barrier", async () => {
  const callbacks: (() => void)[] = [], sent: any[] = [];
  const queue = new OutgoingQueue((payload, done) => { sent.push(JSON.parse(payload)); callbacks.push(done); }, () => assert.fail("overflow"));
  const release = await queue.reserveRead(new AbortController().signal);
  queue.send({ first: true }); queue.lazy(() => ({ snapshot: true }));
  queue.send({ terminal: true }); queue.send({ response: true }, undefined, release, true);
  while (callbacks.length) callbacks.shift()!();
  assert.deepEqual(sent, [{ first: true }, { terminal: true }, { response: true }, { snapshot: true }]);
});

test("an existing large frame is drained before another read or lazy materialization", async () => {
  const callbacks: (() => void)[] = [], sent: any[] = [];
  let constructed = 0, admitted = false;
  const queue = new OutgoingQueue((payload, done) => { sent.push(JSON.parse(payload)); callbacks.push(done); }, () => assert.fail("overflow"), 1024);
  queue.send({ first: true });
  queue.lazy(() => { constructed++; return { snapshot: "x".repeat(8000) }; });
  queue.send({ large: "x".repeat(8000) });
  const waiting = queue.reserveRead(new AbortController().signal).then(release => { admitted = true; return release; });
  callbacks.shift()!(); await Promise.resolve();
  assert.equal(constructed, 0); assert.equal(admitted, false); assert.equal(sent[1].large.length, 8000);
  callbacks.shift()!(); const release = await waiting;
  assert.equal(constructed, 0);
  queue.send({ subscription: "x".repeat(8000) }, undefined, undefined, true);
  queue.send({ receipt: true }, undefined, release, true);
  callbacks.shift()!(); assert.equal(constructed, 0, "receipt still owns the read slot");
  callbacks.shift()!(); assert.equal(constructed, 1);
  callbacks.shift()!(); assert.equal(queue.queuedBytes + queue.inFlightBytes, 0);
});

test("lazy remains a merge barrier and observer failures cannot break delivery", async () => {
  const sent: any[] = [], callbacks: (() => void)[] = [];
  const queue = new OutgoingQueue((payload, done) => { sent.push(JSON.parse(payload)); callbacks.push(done); }, () => assert.fail("overflow"));
  const release = await queue.reserveRead(new AbortController().signal);
  queue.send({ n: 0 }); queue.send({ n: 1 }, "delta");
  queue.lazy(() => ({ snapshot: true })); queue.send({ n: 2 }, "delta");
  queue.send({ receipt: true }, undefined, release, true, () => { throw Error("observer"); });
  while (callbacks.length) callbacks.shift()!();
  assert.deepEqual(sent, [{ n: 0 }, { n: 1 }, { n: 2 }, { receipt: true }, { snapshot: true }]);
});

test("continuous reads and lazy refreshes alternate materialization turns", async () => {
  const callbacks: (() => void)[] = [], order: string[] = [];
  const queue = new OutgoingQueue((_payload, done) => callbacks.push(done), () => assert.fail("overflow"));
  const first = await queue.reserveRead(new AbortController().signal);
  const second = queue.reserveRead(new AbortController().signal).then(release => { order.push("read"); return release; });
  queue.lazy(() => { order.push("lazy-1"); return { snapshot: 1 }; });
  queue.lazy(() => { order.push("lazy-2"); return { snapshot: 2 }; });
  first();
  assert.deepEqual(order, ["lazy-1"]);
  callbacks.shift()!(); const release = await second;
  assert.deepEqual(order, ["lazy-1", "read"]);
  const third = queue.reserveRead(new AbortController().signal);
  release(); assert.deepEqual(order, ["lazy-1", "read", "lazy-2"]);
  callbacks.shift()!(); (await third)(); queue.close();
});

test("lazy factory errors close safely and discarded subscriptions materialize no body", () => {
  let closed = 0, writes = 0;
  const queue = new OutgoingQueue((_payload, done) => { writes++; done(); }, () => closed++);
  queue.lazy(() => undefined); assert.equal(writes, 0);
  queue.lazy(() => { throw Error("history unavailable"); });
  assert.equal(closed, 1); assert.equal(writes, 0); assert.equal(queue.inFlightBytes + queue.queuedBytes, 0);
});

test("outgoing counts UTF-8 queued and in-flight bytes, permits one large history and serializes shared events once", () => {
  const callbacks: ((error?: Error) => void)[] = [], sent: string[] = [];
  let overflows = 0, serializations = 0;
  const queue = new OutgoingQueue((payload, done) => { sent.push(payload); callbacks.push(done); }, () => overflows++, 1024);
  const large = { text: "中文🙂".repeat(1000), toJSON() { serializations++; return { text: this.text }; } };
  const payload = encode(large); assert.equal(encode(large), payload); assert.equal(serializations, 1);
  queue.send(large); assert.equal(queue.inFlightBytes, payload.bytes); assert.equal(queue.queuedBytes, 0);
  const receipt = { type: "receipt", ok: true };
  queue.send(receipt); assert.equal(queue.queuedBytes, encode(receipt).bytes); assert.equal(overflows, 0);
  callbacks.shift()!(); assert.equal(queue.inFlightBytes, encode(receipt).bytes); callbacks.shift()!();
  assert.equal(queue.inFlightBytes, 0); assert.equal(queue.queuedBytes, 0);
  assert.equal(sent.length, 2);
});
test("slow history reads are admitted one at a time and queued cancellation avoids materializing another body", async () => {
  const callbacks: ((error?: Error) => void)[] = [];
  const queue = new OutgoingQueue((_payload, done) => callbacks.push(done), () => assert.fail("unexpected overflow"), 1024);
  const release = await queue.reserveRead(new AbortController().signal);
  const cancelled = new AbortController();
  const pending = queue.reserveRead(cancelled.signal); const rejection = assert.rejects(pending, /取消/);
  cancelled.abort(); await rejection;
  let admitted = false;
  const next = queue.reserveRead(new AbortController().signal).then((done) => { admitted = true; return done; });
  queue.send({ history: "x".repeat(8000) }, undefined, release);
  await Promise.resolve(); assert.equal(admitted, false);
  callbacks.shift()!(); const finish = await next; assert.equal(admitted, true); finish(); queue.close();
});
test("only intermediate frames merge, barriers and terminal frames keep their order; close releases accounting", () => {
  const callbacks: ((error?: Error) => void)[] = [], delivered: any[] = [];
  const queue = new OutgoingQueue((payload, done) => { delivered.push(JSON.parse(payload)); callbacks.push(done); }, () => {}, 1024);
  queue.send({ n: 0 }); queue.send({ n: 1 }, "message"); queue.send({ n: 2 }, "message");
  queue.send({ receipt: true }); queue.send({ n: 3 }, "message"); queue.send({ final: true });
  while (callbacks.length) callbacks.shift()!();
  assert.deepEqual(delivered, [{ n: 0 }, { n: 2 }, { receipt: true }, { n: 3 }, { final: true }]);
  queue.send({ history: "x".repeat(8000) }); queue.close(); assert.equal(queue.inFlightBytes + queue.queuedBytes, 0);
  callbacks.shift()!(); assert.equal(queue.inFlightBytes + queue.queuedBytes, 0);
});
