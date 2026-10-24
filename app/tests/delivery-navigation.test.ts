import assert from "node:assert/strict";
import { test } from "node:test";
import { nextDelivery } from "../src/client/chat/delivery-navigation.js";
import { threadDelivery, threadGroups } from "../src/shared/thread-layout.js";
import type { ChatMessage } from "../src/shared/agent.js";

const answer: ChatMessage = { id: "answer", role: "assistant", phase: "final_answer", text: "交付正文", status: "completed" };
test("delivery anchors only identify finished final-answer bodies", () => {
  assert.equal(threadDelivery(answer), true);
  assert.equal(threadDelivery({ ...answer, status: undefined }), true, "legacy completed snapshots");
  assert.equal(threadDelivery({ ...answer, text: "", images: [{ id: "image", name: "diagram.png", mimeType: "image/png" }] }), true);
  for (const patch of [
    { role: "user" }, { role: "notice" }, { phase: "commentary" }, { phase: undefined },
    { streaming: true }, { status: "running" }, { status: "failed" }, { status: "cancelled" },
    { text: " \n " }, { error: "failure" }, { calls: [{ id: "call", name: "read", input: "{}" }] },
  ] as Partial<ChatMessage>[]) assert.equal(threadDelivery({ ...answer, ...patch }), false, JSON.stringify(patch));
});
test("live and archive catalogues expose a delivery once, never on its folded thinking/process row", () => {
  const source: ChatMessage[] = [{ id: "user", role: "user", text: "问题" },
    { id: "process", role: "assistant", text: "执行说明", phase: "commentary" }, { ...answer, thinking: "最终核对" }];
  for (const archived of [false, true]) {
    const groups = threadGroups(source, { archived });
    assert.deepEqual(groups.filter(group => group.delivery).map(group => group.id), ["answer"]);
    assert.equal(groups.find(group => group.folded)?.delivery, undefined);
  }
});
const first = { key: "first", start: 100 }, middle = { key: "middle", start: 500 }, last = { key: "last", start: 1500 };
const starts = [first, middle, last];
test("arrows select the next start in their direction, relative to the reading line", () => {
  assert.equal(nextDelivery(starts, 350, "down"), middle);
  assert.equal(nextDelivery(starts, 350, "up"), first);
  assert.equal(nextDelivery(starts, 650, "up"), middle, "inside a body, up returns to its own start");
  assert.equal(nextDelivery(starts, 650, "down"), last, "down skips the rest of the current body");
  assert.equal(nextDelivery(starts, 0, "up"), undefined);
  assert.equal(nextDelivery(starts, 2000, "down"), undefined);
  assert.equal(nextDelivery([], 0, "down"), undefined);
});
test("an aligned start is skipped with a small subpixel tolerance", () => {
  for (const reading of [499, 500, 501]) {
    assert.equal(nextDelivery(starts, reading, "up"), first);
    assert.equal(nextDelivery(starts, reading, "down"), last);
  }
});
test("successive and rapidly repeated clicks advance in order, including clamped edge starts", () => {
  assert.equal(nextDelivery(starts, 0, "down", first.key), middle);
  assert.equal(nextDelivery(starts, 0, "down", middle.key), last);
  assert.equal(nextDelivery(starts, 0, "down", last.key), undefined, "edge fallback, never wrap around");
  assert.equal(nextDelivery(starts, 2000, "up", last.key), middle);
  assert.equal(nextDelivery(starts, 2000, "up", middle.key), first);
  assert.equal(nextDelivery(starts, 2000, "up", first.key), undefined);
  assert.equal(nextDelivery(starts, 0, "up", middle.key), first, "direction reversal is relative to the selected start");
  assert.equal(nextDelivery(starts, 650, "down", "removed"), last, "a removed cursor resumes at the actual position");
  assert.equal(nextDelivery([first], 0, "down"), first);
  assert.equal(nextDelivery([first], 0, "down", first.key), undefined);
});
