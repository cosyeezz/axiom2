import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyKiroFailure, kiroFailureMessage } from "../src/server/providers/kiro-failure.js";
import { projectKiroFailure } from "../src/server/kiro-failure-display.js";

// Historical official SDK commit 15cc8f3, streaming shape_generate_assistant_response
// matches ValidationError; shape_validation_error models only message and reason.
// This is a compatibility fixture, not a captured current-service response.
const reason = "INVALID_CONVERSATION_ID";
const observed = { token: reason, contract: "unverified", source: "local-static-allowlist" };
const classify = (codes: unknown[], data: Record<string, unknown>) => classifyKiroFailure({ stage: "http", status: 400, codes, body: { state: "json", data } });

test("official historical streaming ValidationError is validation, with safe raw code projection", () => {
  for (const name of ["ValidationError", "ValidationException"]) {
    const info = classify([name], { message: "PRIVATE-DO-NOT-COPY", reason });
    assert.equal(info.category, "validation"); assert.equal(info.code, name);
    assert.deepEqual(info.observedValidationReason, observed);
    assert.equal(kiroFailureMessage(info, false), "Kiro 请求验证失败，请检查消息、所选模型及 profile。");
    const display = projectKiroFailure({ role: "assistant", api: "kiro-chat", provider: "kiro", stopReason: "error", diagnostics: [{ type: "kiro-failure", details: { ...info, partial: false } }] });
    assert.equal(display?.code, name); assert.deepEqual(display?.observedValidationReason, observed);
    assert.doesNotMatch(JSON.stringify({ info, display }), /PRIVATE/);
  }
});

test("header-only validation reason is accepted only on the sole code-free root body", () => {
  for (const name of ["ValidationError", "ValidationException"]) {
    assert.deepEqual(classify([`com.example#${name}`], { reason }).observedValidationReason, observed);
    for (const data of [
      { code: "FutureException", reason },
      { code: null, reason },
      { __type: "PrivateException", reason },
      { error: { reason } },
      { reason, error: { code: "ValidationException" } },
      { reason, error: {} },
      { reason: "PRIVATE" },
      { reason: reason + "\n" },
    ]) assert.equal(classify([name], data).observedValidationReason, undefined);
    assert.equal(classify([name, "FutureException"], { reason }).observedValidationReason, undefined);
    assert.equal(classify([name, "ThrottlingException"], { reason }).observedValidationReason, undefined);
  }
});

test("both official validation names work on self-coded root or direct error bodies", () => {
  for (const name of ["ValidationError", "ValidationException"]) {
    for (const data of [{ __type: name, reason }, { error: { code: name, reason } }]) {
      const info = classify([], data);
      assert.equal(info.category, "validation"); assert.equal(info.code, name);
      assert.deepEqual(info.observedValidationReason, observed);
    }
  }
});
