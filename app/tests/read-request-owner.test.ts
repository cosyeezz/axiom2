import assert from "node:assert/strict";
import test from "node:test";
import { assertReadRequestAvailable, claimReadRequest, releaseReadRequest } from "../src/server/read-request-owner.js";
import { validRequestId, windowFieldErrorReceipt } from "../src/shared/window-frame-budget.js";

test("duplicate read IDs cannot overwrite or release the original cancellation owner", () => {
  const reads = new Map<string, AbortController>();
  const first = claimReadRequest(reads, "same");
  assert.throws(() => assertReadRequestAvailable(reads, "same"), { code: "DUPLICATE_REQUEST" });
  assert.throws(() => claimReadRequest(reads, "same"), { code: "DUPLICATE_REQUEST" });
  releaseReadRequest(reads, "same", undefined); // rejected duplicate's finally
  assert.equal(reads.get("same"), first);
  reads.get("same")!.abort(); assert.equal(first.signal.aborted, true);
  releaseReadRequest(reads, "same", first); assert.equal(reads.size, 0);
});

test("an old finally cannot release a later owner reusing a completed correlation ID", () => {
  const reads = new Map<string, AbortController>(), first = claimReadRequest(reads, "same");
  releaseReadRequest(reads, "same", first);
  const next = claimReadRequest(reads, "same");
  releaseReadRequest(reads, "same", first);
  assert.equal(reads.get("same"), next);
  reads.get("same")!.abort(); assert.equal(next.signal.aborted, true);
  releaseReadRequest(reads, "same", next); assert.equal(reads.size, 0);
});

test("window ingress correlation rejects normalization and its error factory never echoes malformed IDs", () => {
  for (const id of [" id ", "\0id", "x".repeat(201), undefined, 42, "", " \n "]) {
    assert.equal(validRequestId(id), false);
    const { frame, encodedBytes } = windowFieldErrorReceipt(id, "UNAVAILABLE");
    assert.equal(frame.requestId, ""); assert.equal(frame.error.code, "INVALID_REQUEST_ID");
    assert.ok(encodedBytes <= 2048);
  }
  for (const id of ["id", "\u0001".repeat(200), "汉".repeat(200)]) {
    assert.equal(validRequestId(id), true);
    for (const code of ["STALE", "INVALID_REQUEST_ID", "UNAVAILABLE"] as const) {
      const { frame, encodedBytes } = windowFieldErrorReceipt(id, code);
      assert.equal(frame.requestId, id); assert.equal(frame.error.code, code); assert.ok(encodedBytes <= 2048);
    }
  }
});
