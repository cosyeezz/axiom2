import assert from "node:assert/strict";
import test from "node:test";
import type { Reply } from "../src/shared/protocol.js";
import { encode } from "../src/server/outgoing.js";
import {
  WINDOW_FIELD_MAX_FRAME_JSON_BYTES, WINDOW_FIELD_MAX_ERROR_JSON_BYTES,
  WINDOW_FIELD_MAX_REQUEST_ID_CU, WINDOW_FIELD_MAX_TOKEN_CU,
  WindowFrameBudgetError, windowFieldReceipt, windowFieldErrorReceipt,
  type WindowFieldTarget, type WindowFrameErrorCode,
} from "../src/shared/window-frame-budget.js";
import { WINDOW_TEXT_MAX_JSON_BYTES } from "../src/shared/window-text-budget.js";

const target: WindowFieldTarget = { entityRef: "entity_A", field: "text", revision: "revision_1" };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const hasCode = (code: string) => (error: unknown) =>
  error instanceof Error && "code" in error && error.code === code;

function checkWire(result: ReturnType<typeof windowFieldReceipt>, cap = WINDOW_FIELD_MAX_FRAME_JSON_BYTES) {
  const reply: Reply = result.frame;
  assert.equal(reply.type, "receipt");
  assert.equal(result.encodedBytes, bytes(result.frame));
  assert.ok(result.encodedBytes <= cap);
  assert.ok(bytes(result.frame.data.chunk.text) <= WINDOW_TEXT_MAX_JSON_BYTES);
  const wire = encode(result.frame);
  assert.equal(wire.bytes, result.encodedBytes);
  assert.deepEqual(JSON.parse(wire.payload), result.frame);
  assert.equal(encode(result.frame), wire, "immutable frame shares the actual outgoing encoding");
}

test("field receipts use only the actual Reply allowlist and frozen bounded data", () => {
  for (const field of ["text", "thinking", "input", "error", "selection", "metadata"] as const) {
    const result = windowFieldReceipt("request-A", { ...target, field }, "hello");
    assert.deepEqual(result.frame, { type: "receipt", requestId: "request-A", ok: true,
      data: { entityRef: target.entityRef, field, revision: target.revision,
        chunk: { text: "hello", offsetCU: 0, nextOffsetCU: null, totalLengthCU: 5 } } });
    for (const value of [result, result.frame, result.frame.data, result.frame.data.chunk]) assert.ok(Object.isFrozen(value));
    assert.ok(!JSON.stringify(result.frame).includes("encodedBytes"));
    checkWire(result);
  }
});

test("remaining complete receipt bytes shrink text while the default retains its 48KiB string cap", () => {
  const source = "a".repeat(1_000_000);
  const result = windowFieldReceipt("request-B", target, source);
  checkWire(result);
  assert.equal(bytes(result.frame.data.chunk.text), 48 * 1024);
  assert.equal(result.frame.data.chunk.text.length, 48 * 1024 - 2);
  assert.ok(result.encodedBytes > bytes(result.frame.data.chunk.text), "envelope bytes must not disappear");
  for (const cap of [256, 257, 512, 1024, 4096, 48 * 1024, 64 * 1024]) {
    const smaller = windowFieldReceipt("request-B", target, source, cap, 15);
    checkWire(smaller, cap);
    const chunk = smaller.frame.data.chunk;
    assert.equal(chunk.offsetCU, 15);
    assert.equal(chunk.text, source.slice(15, chunk.nextOffsetCU ?? source.length));
    assert.ok(chunk.nextOffsetCU !== null && chunk.nextOffsetCU > 15);
    assert.equal(chunk.totalLengthCU, source.length);
  }
});

test("all metadata and Unicode escaping are charged to the complete field receipt", () => {
  const maximal = { entityRef: "e".repeat(WINDOW_FIELD_MAX_TOKEN_CU), field: "thinking" as const,
    revision: "r".repeat(WINDOW_FIELD_MAX_TOKEN_CU) };
  for (const requestId of ["q\"\\x", "\u0001".repeat(200), "中".repeat(200), "😀".repeat(100), "\ud800".repeat(200)]) {
    assert.ok(requestId.length <= WINDOW_FIELD_MAX_REQUEST_ID_CU);
    for (const source of ['a"\\\b\t\n\f\r\0中😀\ud800x\udc00'.repeat(500), "z".repeat(10000)]) {
      for (const cap of [2048, 4096, 65536]) {
        const result = windowFieldReceipt(requestId, maximal, source, cap);
        checkWire(result, cap);
        assert.equal(result.frame.requestId, requestId, "legal normalized non-ASCII correlation is not a UUID-only input");
        assert.equal(result.frame.data.chunk.text, source.slice(0, result.frame.data.chunk.nextOffsetCU ?? source.length));
      }
    }
  }
});

test("empty and EOF slots fit their exact frame boundary and nonempty first points cannot stall", () => {
  const large = "z".repeat(1_000_000);
  for (const [value, offset] of [["", 0], [large, large.length]] as const) {
    const baseline = windowFieldReceipt("r", target, value, 65536, offset);
    const exact = windowFieldReceipt("r", target, value, baseline.encodedBytes, offset);
    checkWire(exact, baseline.encodedBytes);
    assert.deepEqual(exact.frame.data.chunk, { text: "", offsetCU: offset, nextOffsetCU: null, totalLengthCU: value.length });
    assert.throws(() => windowFieldReceipt("r", target, value, baseline.encodedBytes - 1, offset), hasCode("FRAME_BUDGET_TOO_SMALL"));
  }
  for (const value of ["a", "中", "😀", "\0", "\ud800", "\udc00"]) {
    const full = windowFieldReceipt("r", target, value);
    checkWire(windowFieldReceipt("r", target, value, full.encodedBytes), full.encodedBytes);
    assert.throws(() => windowFieldReceipt("r", target, value, full.encodedBytes - 1), hasCode("BUDGET_TOO_SMALL"));
  }
});

test("repeated bounded receipts reconstruct UTF16 without breaking pairs or losing the field identity", () => {
  const source = "a😀\0中\"\\\ud800x\udc00".repeat(60) + "\ud800";
  const chunks: string[] = [];
  let offset = 0;
  for (let page = 0; page < 1000; page++) {
    const result = windowFieldReceipt(`request-${page}`, target, source, 300, offset);
    checkWire(result, 300);
    const data = result.frame.data;
    assert.equal(data.entityRef, target.entityRef); assert.equal(data.revision, target.revision);
    assert.equal(data.chunk.offsetCU, offset); assert.equal(data.chunk.totalLengthCU, source.length);
    chunks.push(data.chunk.text);
    if (data.chunk.nextOffsetCU === null) { assert.equal(chunks.join(""), source); return; }
    assert.ok(data.chunk.nextOffsetCU > offset, "a continuation must advance");
    offset = data.chunk.nextOffsetCU;
  }
  assert.fail("bounded field traversal failed to reach EOF");
});

test("unknown source extras and changing known getters cannot enter the immutable frame", () => {
  let extrasRead = 0, enumerations = 0, refReads = 0, fieldReads = 0, revisionReads = 0;
  let current = target;
  const candidate: WindowFieldTarget = {
    get entityRef() { refReads++; return current.entityRef; },
    get field() { fieldReads++; return current.field; },
    get revision() { revisionReads++; return current.revision; },
  };
  Object.defineProperty(candidate, "provider", { enumerable: true, get() { extrasRead++; return { base64: "private".repeat(1_000_000) }; } });
  Object.defineProperty(candidate, "toJSON", { enumerable: true, get() { extrasRead++; return () => "private-source"; } });
  Object.defineProperty(candidate, "raw-native-id".repeat(100000), { enumerable: true, get() { extrasRead++; return []; } });
  const source = new Proxy(candidate, { ownKeys(value) { enumerations++; return Reflect.ownKeys(value); } });
  const result = windowFieldReceipt("request-C", source, "visible");
  assert.deepEqual([extrasRead, enumerations, refReads, fieldReads, revisionReads], [0, 0, 1, 1, 1]);
  current = { entityRef: "changed", field: "input", revision: "changed" };
  assert.equal(result.frame.data.entityRef, target.entityRef);
  assert.equal(result.frame.data.field, target.field);
  assert.equal(result.frame.data.revision, target.revision);
  checkWire(result);
});

test("invalid scalars and offsets fail with short fixed errors and never truncate an identity", () => {
  const privateValue = "PRIVATE-FIELD-".repeat(100000);
  for (const requestId of ["", " ", " r", "r ", "r\0", privateValue, 12, null, {}])
    assert.throws(() => windowFieldReceipt(requestId as string, target, privateValue), hasCode("INVALID_REQUEST_ID"));
  for (const bad of [null, [], "target"])
    assert.throws(() => windowFieldReceipt("r", bad as unknown as WindowFieldTarget, privateValue), hasCode("INVALID_REFERENCE"));
  for (const bad of ["", "非ASCII", "raw:id", privateValue, 12, null]) {
    for (const key of ["entityRef", "revision"] as const)
      assert.throws(() => windowFieldReceipt("r", { ...target, [key]: bad } as WindowFieldTarget, privateValue), hasCode("INVALID_REFERENCE"));
  }
  assert.throws(() => windowFieldReceipt("r", { ...target, field: "body" as never }, privateValue), hasCode("INVALID_FIELD"));
  for (const cap of [0, 1, -1, 2.5, NaN, Infinity, 65537, Number.MAX_SAFE_INTEGER])
    assert.throws(() => windowFieldReceipt("r", target, privateValue, cap), hasCode("INVALID_FRAME_BUDGET"));
  for (const value of [null, {}, ["text"], 12])
    assert.throws(() => windowFieldReceipt("r", target, value as string), hasCode("INVALID_TEXT"));
  for (const offset of [-1, 1.5, NaN, Infinity, 5, Number.MAX_SAFE_INTEGER])
    assert.throws(() => windowFieldReceipt("r", target, "a😀z", 1024, offset), hasCode("INVALID_OFFSET"));
  assert.throws(() => windowFieldReceipt("r", target, "a😀z", 1024, 2), hasCode("INVALID_OFFSET"));
  assert.throws(() => windowFieldReceipt("r", { ...target, entityRef: privateValue }, privateValue), (error: unknown) => {
    assert.ok(error instanceof WindowFrameBudgetError);
    assert.ok(error.message.length < 128); assert.ok(!error.message.includes("PRIVATE-FIELD"));
    return true;
  });
});

test("metadata rejection happens before any source character read", () => {
  const source = "private".repeat(200000);
  const original = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = new Proxy(original, { apply(fn, receiver: unknown, args: unknown[]) {
    if (receiver === source) reads++;
    return Reflect.apply(fn, receiver, args);
  } });
  try {
    assert.throws(() => windowFieldReceipt("r".repeat(201), target, source), hasCode("INVALID_REQUEST_ID"));
    assert.throws(() => windowFieldReceipt("r", { ...target, revision: "r".repeat(129) }, source), hasCode("INVALID_REFERENCE"));
    assert.throws(() => windowFieldReceipt("r", { ...target, field: "wrong" as never }, source), hasCode("INVALID_FIELD"));
    assert.throws(() => windowFieldReceipt("r", target, source, 2), hasCode("FRAME_BUDGET_TOO_SMALL"));
  } finally { String.prototype.charCodeAt = original; }
  assert.equal(reads, 0);
  assert.equal(String.prototype.charCodeAt, original);
});

test("fixed error receipts budget legal Unicode correlation and never echo invalid correlation or error values", () => {
  const codes: WindowFrameErrorCode[] = ["INVALID_REQUEST_ID", "INVALID_REFERENCE", "INVALID_FIELD", "INVALID_FRAME_BUDGET",
    "FRAME_BUDGET_TOO_SMALL", "INVALID_TEXT", "INVALID_OFFSET", "BUDGET_TOO_SMALL", "INTERNAL_FRAME_BUDGET", "STALE", "UNAVAILABLE"];
  for (const requestId of ["r", "\u0001".repeat(200), "中".repeat(200), "😀".repeat(100), "\ud800".repeat(200)]) {
    for (const code of codes) {
      const result = windowFieldErrorReceipt(requestId, code);
      const reply: Reply = result.frame;
      assert.equal(reply.type, "receipt"); assert.equal(result.frame.requestId, requestId);
      assert.equal(result.frame.error.code, code);
      assert.equal(result.encodedBytes, bytes(result.frame));
      assert.ok(result.encodedBytes <= WINDOW_FIELD_MAX_ERROR_JSON_BYTES);
      assert.deepEqual(JSON.parse(encode(result.frame).payload), result.frame);
      for (const value of [result, result.frame, result.frame.error]) assert.ok(Object.isFrozen(value));
    }
  }
  const secret = "PRIVATE-CORRELATION-".repeat(100000);
  for (const requestId of [secret, " r ", "r\0", null, {}, ""]) {
    const result = windowFieldErrorReceipt(requestId, secret as WindowFrameErrorCode);
    assert.equal(result.frame.requestId, "");
    assert.equal(result.frame.error.code, "INVALID_REQUEST_ID");
    assert.ok(!JSON.stringify(result.frame).includes("PRIVATE-CORRELATION"));
  }
  for (const code of [secret, "__proto__", "constructor", {}, Symbol("private")]) {
    const result = windowFieldErrorReceipt("r", code as WindowFrameErrorCode);
    assert.equal(result.frame.error.code, "UNAVAILABLE");
    assert.equal(result.encodedBytes, bytes(result.frame));
    assert.ok(result.encodedBytes <= 2048);
  }
});

test("field construction and outgoing encoding never process an unselected full-field suffix", () => {
  const source = "a😀\0中".repeat(500) + "z".repeat(1_000_000);
  const budget = 1024;
  const originals = { slice: String.prototype.slice, stringify: JSON.stringify,
    byteLength: Buffer.byteLength, from: Buffer.from, encode: TextEncoder.prototype.encode };
  const operations: { kind: string; length: number }[] = [];
  function guarded<T extends (...args: never[]) => unknown>(original: T, kind: string): T {
    return new Proxy(original, { apply(fn, receiver: unknown, args: unknown[]) {
      if (typeof args[0] === "string") operations.push({ kind, length: args[0].length });
      const result = Reflect.apply(fn, receiver, args);
      if (kind === "JSON.stringify" && typeof result === "string") operations.push({ kind: "JSON.stringify output", length: result.length });
      return result;
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
  try {
    const result = windowFieldReceipt("bounded-r", target, source, budget, 15);
    encode(result.frame);
  } finally {
    String.prototype.slice = originals.slice; JSON.stringify = originals.stringify;
    Buffer.byteLength = originals.byteLength; Buffer.from = originals.from; TextEncoder.prototype.encode = originals.encode;
  }
  assert.ok(operations.some(operation => operation.kind === "slice"), "selected-prefix allocation must be observed");
  assert.ok(operations.some(operation => operation.kind === "TextEncoder.encode"), "complete frame encoding must be observed");
  assert.ok(operations.some(operation => operation.kind === "JSON.stringify output"), "actual encoded objects must be observed");
  for (const operation of operations)
    assert.ok(operation.length <= budget, `${operation.kind} processed ${operation.length} unbounded code units`);
  assert.equal(String.prototype.slice, originals.slice); assert.equal(JSON.stringify, originals.stringify);
  assert.equal(Buffer.byteLength, originals.byteLength); assert.equal(Buffer.from, originals.from);
  assert.equal(TextEncoder.prototype.encode, originals.encode);
});
