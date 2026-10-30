import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "../src/shared/agent.js";
import { createCanonicalOverlayHolder, type CanonicalOverlayHolder,
  type CanonicalOverlayWriter, type CanonicalOverlayReceipt } from "../src/shared/canonical-overlay-holder.js";

const message = (id: string, text = id): ChatMessage => ({ id, role: "assistant", text });
const ids = (holder: CanonicalOverlayHolder) => holder.snapshot().map(receipt => receipt.message.id);
function put(writer: CanonicalOverlayWriter, value: ChatMessage) {
  const receipt = writer.write(value);
  assert.ok(receipt);
  return receipt;
}

// Static-only contracts: these statements are never executed.
function readonlyContracts(holder: CanonicalOverlayHolder, writer: CanonicalOverlayWriter, receipt: CanonicalOverlayReceipt) {
  // @ts-expect-error public begin is a readonly function property
  holder.begin = () => writer;
  // @ts-expect-error public close is a readonly function property
  holder.close = () => true;
  // @ts-expect-error public snapshot is a readonly function property
  holder.snapshot = () => [];
  // @ts-expect-error public write is a readonly function property
  writer.write = () => undefined;
  // @ts-expect-error public release is a readonly function property
  writer.release = () => false;
  // @ts-expect-error snapshot has a readonly array surface
  holder.snapshot().push(receipt);
  // @ts-expect-error receipt body is deeply readonly
  receipt.message.text = "changed";
  if (receipt.message.calls?.[0]) {
    // @ts-expect-error nested inputs are readonly too
    receipt.message.calls[0].input = "changed";
  }
  if (receipt.message.selectionChange) {
    // @ts-expect-error nested model selections are readonly too
    receipt.message.selectionChange.to.id = "changed";
  }
  // Positive: already deeply readonly owned values remain valid write inputs.
  writer.write(receipt.message);
}
void readonlyContracts;

test("empty holder exposes frozen local capabilities and fresh readonly arrays", () => {
  const holder = createCanonicalOverlayHolder();
  assert.equal(Object.isFrozen(holder), true);
  assert.deepEqual(holder.snapshot(), []);
  assert.equal(Reflect.apply(holder.close, undefined, [undefined]), false);
  assert.equal(Object.isFrozen(holder.snapshot()), true);
  assert.notStrictEqual(holder.snapshot(), holder.snapshot());
  const writer = holder.begin();
  assert.equal(Object.isFrozen(writer), true);
  assert.deepEqual(holder.snapshot(), []);
});

test("each accepted write owns complete long fields and nested display data", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin();
  const original: ChatMessage = { ...message("long", "正文😀".repeat(6000)), thinking: "思考".repeat(1500),
    calls: [{ id: "call", name: "read", input: "参数😀".repeat(6000), taskPreview: { titles: ["original"] } }],
    selectionChange: { from: { provider: "p", id: "old", thinking: "low" }, to: { provider: "p", id: "new", thinking: "high" } },
    inputIds: ["input"], attachments: [{ id: "file", name: "name", kind: "file", path: "/ordinary" }] };
  const expected = JSON.parse(JSON.stringify(original));
  const receipt = put(writer, original);
  assert.deepEqual(receipt.message, expected);
  assert.notStrictEqual(receipt.message, original);
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.message), true);
  assert.equal(Object.isFrozen(receipt.message.calls), true);
  assert.equal(Object.isFrozen(receipt.message.calls![0]), true);
  assert.equal(Object.isFrozen(receipt.message.calls![0].taskPreview!.titles), true);
  assert.equal(Object.isFrozen(receipt.message.selectionChange!.from), true);
  assert.equal(Object.isFrozen(receipt.message.selectionChange!.to), true);
  assert.equal(Object.isFrozen(original), false);
  assert.equal(Object.isFrozen(original.calls), false);
  original.text = "caller changed"; original.thinking = "caller changed";
  original.calls![0].input = "caller changed"; original.calls![0].taskPreview!.titles![0] = "caller changed";
  original.selectionChange!.to.id = "caller changed"; original.inputIds!.push("late");
  original.attachments![0].name = "caller changed";
  assert.deepEqual(receipt.message, expected);
  assert.throws(() => Object.assign(receipt.message, { text: "illegal" }), TypeError);
});

test("snapshots never alias the holder's growing or shrinking pending collection", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin();
  const before = holder.snapshot(), a = put(writer, message("a")), first = holder.snapshot();
  const b = put(writer, message("b")), second = holder.snapshot();
  assert.equal(writer.release(a), true);
  assert.deepEqual(before, []);
  assert.deepEqual(first, [a]);
  assert.deepEqual(second, [a, b]);
  assert.deepEqual(holder.snapshot(), [b]);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => Reflect.apply(Array.prototype.push, first, [b]), TypeError);
});

test("same-ID updates preserve insertion order and release plus reinsert moves to the tail", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin();
  put(writer, message("a")); const b = put(writer, message("b")); put(writer, message("c"));
  const a2 = put(writer, message("a", "new a"));
  assert.deepEqual(ids(holder), ["a", "b", "c"]);
  assert.equal(writer.release(b), true); put(writer, message("b", "new b"));
  assert.deepEqual(ids(holder), ["a", "c", "b"]);
  assert.equal(writer.release(a2), true); put(writer, message("a", "third a"));
  assert.deepEqual(ids(holder), ["c", "b", "a"]);
});

test("identical full values still receive distinct versions and stale release cannot clear latest", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin(), body = message("same", "identical");
  const first = put(writer, body), second = put(writer, body);
  assert.notStrictEqual(first, second); assert.notStrictEqual(first.message, second.message);
  assert.deepEqual(first.message, second.message);
  assert.equal(writer.release(first), false);
  assert.deepEqual(holder.snapshot(), [second]);
  assert.equal(writer.release(second), true);
  assert.equal(writer.release(second), false);
  assert.deepEqual(holder.snapshot(), []);
});

test("terminal failures cancellations and tool partials are retained without streaming filters", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin();
  put(writer, { ...message("final"), phase: "final_answer", status: "completed", streaming: false });
  put(writer, { ...message("failed"), status: "failed", streaming: false, error: "safe error" });
  put(writer, { ...message("cancelled"), status: "cancelled", streaming: false });
  const partial = put(writer, { id: "tool", role: "toolResult", text: "partial", status: "running", streaming: true });
  const prior = holder.snapshot();
  const terminal = put(writer, { id: "tool", role: "toolResult", text: "full result", status: "completed", streaming: false });
  assert.deepEqual(ids(holder), ["final", "failed", "cancelled", "tool"]);
  assert.equal(prior[3], partial); assert.equal(partial.message.text, "partial");
  assert.equal(holder.snapshot()[3], terminal); assert.equal(terminal.message.text, "full result");
  assert.equal(writer.release(partial), false);
});

test("begin revokes prior writer and stale close cannot clear the new lifecycle", () => {
  const holder = createCanonicalOverlayHolder(), old = holder.begin(), oldReceipt = put(old, message("a", "old"));
  const oldSnapshot = holder.snapshot(), current = holder.begin(), currentReceipt = put(current, message("a", "current"));
  assert.equal(old.write(message("a", "stale overwrite")), undefined);
  assert.equal(old.release(oldReceipt), false); assert.equal(old.release(currentReceipt), false);
  assert.equal(current.release(oldReceipt), false);
  assert.equal(holder.close(old), false);
  assert.deepEqual(holder.snapshot(), [currentReceipt]);
  assert.deepEqual(oldSnapshot, [oldReceipt]); assert.equal(oldSnapshot[0].message.text, "old");
});

test("close revokes current capabilities and remains idempotent across later begin", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin(), receipt = put(writer, message("a"));
  const old = holder.snapshot();
  assert.equal(holder.close(writer), true); assert.deepEqual(holder.snapshot(), []);
  assert.equal(holder.close(writer), false); assert.equal(writer.write(message("late")), undefined);
  assert.equal(writer.release(receipt), false); assert.deepEqual(old, [receipt]);
  const next = holder.begin(), nextReceipt = put(next, message("next"));
  assert.equal(holder.close(writer), false); assert.deepEqual(holder.snapshot(), [nextReceipt]);
});

test("receipt identity rejects cross-holder copied shapes and ID-only release", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin(), other = createCanonicalOverlayHolder(), otherWriter = other.begin();
  const receipt = put(writer, message("same")), foreign = put(otherWriter, message("same"));
  assert.equal(writer.release(foreign), false);
  assert.equal(otherWriter.release(receipt), false);
  assert.equal(writer.release({ message: receipt.message }), false);
  assert.equal(holder.close(otherWriter), false);
  assert.equal(holder.close({ write: writer.write, release: writer.release }), false);
  assert.equal(Reflect.apply(writer.release, undefined, ["same"]), false);
  let reads = 0;
  const forged = { message: receipt.message };
  Object.defineProperty(forged, "message", { get: () => { reads++; throw Error("forged properties must not be read"); } });
  assert.doesNotThrow(() => assert.equal(writer.release(forged), false)); assert.equal(reads, 0);
  assert.deepEqual(holder.snapshot(), [receipt]); assert.deepEqual(other.snapshot(), [foreign]);
});

test("a captured asynchronous release never resolves the latest receipt by ID", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin(), old = put(writer, message("m", "before"));
  const late = () => writer.release(old), latest = put(writer, message("m", "after"));
  assert.equal(late(), false); assert.deepEqual(holder.snapshot(), [latest]);
  assert.equal(latest.message.text, "after");
});

test("explicitly truncated or inconsistent lengths reject without replacing or reordering pending", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin(), original = put(writer, message("a", "original"));
  const b = put(writer, message("b"));
  const invalid: ChatMessage[] = [
    { ...message("a"), truncated: true },
    { ...message("a"), textLength: 999 },
    { ...message("a"), thinking: "full", thinkingLength: 1 },
    { ...message("a"), calls: [{ id: "c", name: "read", input: "full", inputLength: 1 }] },
    { ...message("new"), truncated: true },
    { ...message("new"), textLength: 999 },
    { ...message("new"), thinking: "full", thinkingLength: 1 },
    { ...message("new"), calls: [{ id: "first", name: "read", input: "ok", inputLength: 2 },
      { id: "second", name: "read", input: "full", inputLength: 1 }] },
  ];
  for (const value of invalid) {
    assert.throws(() => writer.write(value), { name: "TypeError", message: "Canonical capture requires complete display messages" });
    assert.deepEqual(holder.snapshot(), [original, b]);
  }
  assert.equal(writer.release(original), true);
  const next = put(writer, message("a", "valid after failure"));
  assert.deepEqual(holder.snapshot(), [b, next]);
});

test("stale writers reject before reading an input body", () => {
  const holder = createCanonicalOverlayHolder(), old = holder.begin(); holder.begin();
  let reads = 0; const late = message("late");
  Object.defineProperty(late, "id", { get: () => { reads++; throw Error("stale body must not be read"); } });
  assert.doesNotThrow(() => assert.equal(old.write(late), undefined)); assert.equal(reads, 0);
  assert.deepEqual(holder.snapshot(), []);
});

test("unmarked normalized values are trusted inputs not proof of native completeness", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin();
  const receipt = put(writer, message("ordinary", "unmarked short value"));
  assert.equal(receipt.message.text, "unmarked short value");
  assert.deepEqual(holder.snapshot(), [receipt]);
});

test("declared complete UTF-16 lengths and empty fields remain accepted", () => {
  const holder = createCanonicalOverlayHolder(), writer = holder.begin();
  const full: ChatMessage = { ...message("complete", "😀"), textLength: 2, thinking: "", thinkingLength: 0,
    calls: [{ id: "empty", name: "read", input: "", inputLength: 0 },
      { id: "unicode", name: "read", input: "😀", inputLength: 2 }] };
  const receipt = put(writer, full), empty = put(writer, message("empty", ""));
  assert.deepEqual(receipt.message, full); assert.equal(empty.message.text, "");
  assert.deepEqual(holder.snapshot(), [receipt, empty]);
});
