import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { WINDOW_TEXT_MAX_JSON_BYTES, WindowTextBudgetError, windowTextChunk } from "../src/shared/window-text-budget.js";

const bytes = (value: string) => Buffer.byteLength(JSON.stringify(value), "utf8");
const codePointBoundary = (value: string, index: number) => !(index > 0 && index < value.length &&
  value.charCodeAt(index - 1) >= 0xd800 && value.charCodeAt(index - 1) <= 0xdbff &&
  value.charCodeAt(index) >= 0xdc00 && value.charCodeAt(index) <= 0xdfff);
const hasCode = (code: WindowTextBudgetError["code"]) => (error: unknown) => error instanceof WindowTextBudgetError && error.code === code;

/** Independent, intentionally exhaustive oracle, used only on small fixtures. */
function check(value: string, budget: number, offset = 0) {
  let expectedEnd = offset;
  for (let end = offset; end <= value.length; end++) {
    if (codePointBoundary(value, end) && bytes(value.slice(offset, end)) <= budget) expectedEnd = end;
  }
  if (expectedEnd === offset && offset < value.length) {
    assert.throws(() => windowTextChunk(value, budget, offset), hasCode("BUDGET_TOO_SMALL"));
    return;
  }
  const chunk = windowTextChunk(value, budget, offset);
  const text = value.slice(offset, expectedEnd);
  assert.deepEqual(chunk, { text, offsetCU: offset, nextOffsetCU: expectedEnd < value.length ? expectedEnd : null, totalLengthCU: value.length, encodedBytes: bytes(text) });
  assert.ok(chunk.encodedBytes <= budget);
  assert.ok(Object.isFrozen(chunk));
}

const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index));
const loneHigh = String.fromCharCode(0xd800);
const loneLow = String.fromCharCode(0xdfff);
const fixtures = ["", "plain ASCII /", '"\\', controls, "中文éÿ߿ࠀ", "😀🚀", "a😀b", loneHigh, loneLow,
  `${loneHigh}x${loneLow}`, `${loneHigh}😀${loneLow}`, String.fromCharCode(0x2028, 0x2029), `${controls}中😀\\\"`];

test("JSON text budgets match real escaping and UTF-8 at every small boundary", () => {
  for (const value of fixtures) for (let budget = 2; budget <= 32; budget++) {
    for (let offset = 0; offset <= value.length; offset++) if (codePointBoundary(value, offset)) check(value, budget, offset);
  }
});

test("valid surrogate pairs stay atomic and isolated surrogates remain lossless", () => {
  assert.throws(() => windowTextChunk("😀", 5), hasCode("BUDGET_TOO_SMALL"));
  assert.equal(windowTextChunk("😀", 6).text, "😀");
  assert.throws(() => windowTextChunk("😀", 8, 1), hasCode("INVALID_OFFSET"));
  for (const value of [loneHigh, loneLow]) {
    assert.throws(() => windowTextChunk(value, 7), hasCode("BUDGET_TOO_SMALL"));
    assert.equal(windowTextChunk(value, 8).text, value);
    assert.equal(windowTextChunk(value, 8).encodedBytes, 8);
  }
  check(`${loneHigh}😀${loneLow}`, 8);
});

test("field chunks reconstruct exact UTF-16 with strictly advancing continuation", () => {
  const source = `${fixtures.join("|")}\n`.repeat(200);
  for (const budget of [8, 9, 16, 29, 257, WINDOW_TEXT_MAX_JSON_BYTES]) {
    const parts: string[] = [];
    let offset = 0;
    do {
      const chunk = windowTextChunk(source, budget, offset);
      assert.equal(chunk.offsetCU, offset);
      assert.equal(chunk.totalLengthCU, source.length);
      assert.equal(chunk.encodedBytes, bytes(chunk.text));
      assert.ok(chunk.encodedBytes <= budget);
      parts.push(chunk.text);
      if (chunk.nextOffsetCU === null) break;
      assert.ok(chunk.nextOffsetCU > offset);
      assert.ok(codePointBoundary(source, chunk.nextOffsetCU));
      offset = chunk.nextOffsetCU;
      assert.ok(parts.length <= source.length);
    } while (true);
    assert.equal(parts.join(""), source);
  }
});

test("empty and completed fields terminate without fabricating a continuation", () => {
  assert.deepEqual(windowTextChunk("", 2), { text: "", offsetCU: 0, nextOffsetCU: null, totalLengthCU: 0, encodedBytes: 2 });
  assert.deepEqual(windowTextChunk("😀x", 2, 3), { text: "", offsetCU: 3, nextOffsetCU: null, totalLengthCU: 3, encodedBytes: 2 });
  assert.throws(() => windowTextChunk("x", 2), hasCode("BUDGET_TOO_SMALL"));
  assert.throws(() => windowTextChunk("中", 4), hasCode("BUDGET_TOO_SMALL"));
  assert.equal(windowTextChunk("中", 5).nextOffsetCU, null);
});

test("invalid budgets, text and offsets produce fixed bounded errors", () => {
  for (const budget of [-1, 0, 1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, WINDOW_TEXT_MAX_JSON_BYTES + 1])
    assert.throws(() => windowTextChunk("private-field", budget), hasCode("INVALID_BUDGET"));
  for (const offset of [-1, 0.5, NaN, Infinity, 4, Number.MAX_SAFE_INTEGER])
    assert.throws(() => windowTextChunk("abc", 16, offset), hasCode("INVALID_OFFSET"));
  for (const value of [null, undefined, 123, {}, []])
    assert.throws(() => windowTextChunk(value as unknown as string), hasCode("INVALID_TEXT"));
  try { windowTextChunk("private-field", 1); assert.fail("must reject"); }
  catch (error) {
    assert.ok(error instanceof WindowTextBudgetError);
    assert.ok(error.message.length < 128);
    assert.ok(!error.message.includes("private-field"));
  }
});

test("million-character fields have bounded default chunks and a real oversize control", () => {
  for (const unit of ["a", "\0", "中", "😀", loneHigh]) {
    const source = unit.repeat(1_000_000);
    assert.ok(bytes(source) > WINDOW_TEXT_MAX_JSON_BYTES, "full-field encoding must actually exceed the cap");
    const chunk = windowTextChunk(source);
    assert.equal(chunk.encodedBytes, bytes(chunk.text));
    assert.ok(chunk.encodedBytes <= WINDOW_TEXT_MAX_JSON_BYTES);
    assert.ok(chunk.nextOffsetCU !== null && chunk.nextOffsetCU > 0);
    assert.ok(chunk.text.length <= WINDOW_TEXT_MAX_JSON_BYTES - 2);
    assert.equal(chunk.totalLengthCU, source.length);
  }
  assert.equal(windowTextChunk("a".repeat(1_000_000)).text.length, WINDOW_TEXT_MAX_JSON_BYTES - 2);
  assert.equal(windowTextChunk("\0".repeat(1_000_000)).text.length, Math.floor((WINDOW_TEXT_MAX_JSON_BYTES - 2) / 6));
});

test("prefix inspection is independent of an unselected million-character suffix", () => {
  const original = String.prototype.charCodeAt;
  const prefix = "a😀\0中".repeat(500);
  const budget = 97;
  const observations: number[] = [];
  for (const suffix of ["", "z".repeat(1_000_000)]) {
    let reads = 0;
    String.prototype.charCodeAt = function (this: string, index: number) { reads++; return original.call(this, index); };
    try { windowTextChunk(prefix + suffix, budget); }
    finally { String.prototype.charCodeAt = original; }
    assert.ok(reads > 0 && reads <= 2 * budget + 4, `bounded code-unit inspections: ${reads}`);
    observations.push(reads);
  }
  assert.equal(observations[0], observations[1]);
  assert.equal(String.prototype.charCodeAt, original);
});

test("fixed-seed mixed Unicode agrees with an exhaustive maximal-prefix oracle", () => {
  const alphabet = [..."a中😀\"\\/", ...Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)),
    loneHigh, loneLow, String.fromCharCode(0x7ff, 0x800, 0xd7ff, 0xffff, 0x2028, 0x2029)];
  let seed = 0x5a17e;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let trial = 0; trial < 1000; trial++) {
    let value = "";
    const length = random(48);
    for (let i = 0; i < length; i++) value += alphabet[random(alphabet.length)];
    const offsets = Array.from({ length: value.length + 1 }, (_, index) => index).filter(index => codePointBoundary(value, index));
    check(value, 2 + random(63), offsets[random(offsets.length)]);
  }
});

test("slicing and native encoders never process an unselected full-field suffix", () => {
  const source = "a😀\0中".repeat(500) + "z".repeat(1_000_000);
  const budget = 97;
  const originals = { slice: String.prototype.slice, stringify: JSON.stringify,
    byteLength: Buffer.byteLength, from: Buffer.from, encode: TextEncoder.prototype.encode };
  const operations: { kind: string; length: number }[] = [];
  function guarded<T extends (...args: never[]) => unknown>(original: T, kind: string): T {
    return new Proxy(original, { apply(target, receiver: unknown, args: unknown[]) {
      if (typeof args[0] === "string") operations.push({ kind, length: args[0].length });
      return Reflect.apply(target, receiver, args);
    } });
  }
  String.prototype.slice = function (this: string, start = 0, end = this.length) {
    const boundary = (index: number) => index < 0 ? Math.max(this.length + index, 0) : Math.min(index, this.length);
    operations.push({ kind: "slice", length: Math.max(0, boundary(end) - boundary(start)) });
    return originals.slice.call(this, start, end);
  };
  JSON.stringify = guarded(originals.stringify, "JSON.stringify");
  Buffer.byteLength = guarded(originals.byteLength, "Buffer.byteLength");
  Buffer.from = guarded(originals.from, "Buffer.from");
  TextEncoder.prototype.encode = guarded(originals.encode, "TextEncoder.encode");
  try { windowTextChunk(source, budget, 15); }
  finally {
    String.prototype.slice = originals.slice;
    JSON.stringify = originals.stringify;
    Buffer.byteLength = originals.byteLength;
    Buffer.from = originals.from;
    TextEncoder.prototype.encode = originals.encode;
  }
  assert.ok(operations.some(operation => operation.kind === "slice"), "selected-prefix allocation must be observed");
  for (const operation of operations)
    assert.ok(operation.length <= budget, `${operation.kind} processed ${operation.length} unbounded code units`);
  assert.equal(String.prototype.slice, originals.slice);
  assert.equal(JSON.stringify, originals.stringify);
  assert.equal(Buffer.byteLength, originals.byteLength);
  assert.equal(Buffer.from, originals.from);
  assert.equal(TextEncoder.prototype.encode, originals.encode);
});
