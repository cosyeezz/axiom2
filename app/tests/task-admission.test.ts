import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskAdmission } from "../src/server/tasks/admission.js";

test("admission preserves reservations despite out-of-order preparation", async () => {
  const queue = new TaskAdmission(), turns = [queue.reserve(), queue.reserve(), queue.reserve()];
  const order: number[] = [], signal = new AbortController().signal;
  const third = turns[2].wait(signal).then(() => { order.push(3); turns[2].release(); });
  const second = turns[1].wait(signal).then(() => { order.push(2); turns[1].release(); });
  await turns[0].wait(signal);
  order.push(1);
  turns[0].release();
  await Promise.all([second, third]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("cancelled admission does not wait for its predecessor or strand its successor", async () => {
  const queue = new TaskAdmission(), head = queue.reserve(), middle = queue.reserve(), tail = queue.reserve();
  const controller = new AbortController();
  const waiting = middle.wait(controller.signal).finally(() => middle.release());
  controller.abort();
  await assert.rejects(waiting, { code: "AGENT_STOPPED" });
  let entered = false;
  const next = tail.wait(new AbortController().signal).then(() => { entered = true; tail.release(); });
  assert.equal(entered, false);
  head.release();
  await next;
  assert.equal(entered, true);
});

test("preparation failure can release an unused admission without blocking later work", async () => {
  const queue = new TaskAdmission(), failed = queue.reserve(), next = queue.reserve();
  failed.release();
  await next.wait(new AbortController().signal);
  next.release();
});

test("a revision retry takes a fresh turn after existing reservations", async () => {
  const queue = new TaskAdmission(), first = queue.reserve(), second = queue.reserve();
  const signal = new AbortController().signal, order: string[] = [];
  await first.wait(signal);
  first.release();
  const retry = queue.reserve();
  const retried = retry.wait(signal).then(() => { order.push("retry"); retry.release(); });
  await second.wait(signal);
  order.push("second");
  second.release();
  await retried;
  assert.deepEqual(order, ["second", "retry"]);
});

test("repeated release cannot let a successor bypass an unreleased predecessor", async () => {
  const queue = new TaskAdmission(), head = queue.reserve(), middle = queue.reserve(), tail = queue.reserve();
  middle.release();
  middle.release();
  let entered = false;
  const next = tail.wait(new AbortController().signal).then(() => { entered = true; tail.release(); });
  await Promise.resolve();
  assert.equal(entered, false);
  head.release();
  await next;
  assert.equal(entered, true);
});

test("already cancelled admission is rejected and can be released without a wait", async () => {
  const queue = new TaskAdmission(), cancelled = queue.reserve(), next = queue.reserve(), controller = new AbortController();
  controller.abort();
  await assert.rejects(cancelled.wait(controller.signal), { code: "AGENT_STOPPED" });
  cancelled.release();
  await next.wait(new AbortController().signal);
  next.release();
});
