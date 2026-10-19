import assert from "node:assert/strict";
import { test } from "node:test";
import { OutgoingQueue, encode } from "../src/server/outgoing.js";

test("lazy current-state history waits for an admitted large read and keeps later reliable frames", async () => {
  const callbacks: (() => void)[] = [], sent: any[] = [];
  let constructed = 0;
  const queue = new OutgoingQueue((payload, done) => { sent.push(JSON.parse(payload)); callbacks.push(done); }, () => assert.fail("unexpected overflow"), 1024);
  const release = await queue.reserveRead(new AbortController().signal);
  queue.lazy(() => { constructed++; return { snapshot: "y".repeat(8000) }; });
  queue.send({ terminal: true });
  assert.equal(constructed, 0);
  queue.send({ result: "x".repeat(8000) }, undefined, release, true);
  assert.equal(constructed, 0); assert.equal(sent.length, 1);
  callbacks.shift()!(); assert.equal(constructed, 1); assert.ok(queue.inFlightBytes > 8000);
  callbacks.shift()!(); callbacks.shift()!();
  assert.equal(sent[2].terminal, true); assert.equal(queue.queuedBytes + queue.inFlightBytes, 0);
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
