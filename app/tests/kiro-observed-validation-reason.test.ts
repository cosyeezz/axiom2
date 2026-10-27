import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyKiroFailure, kiroFailureMessage, readKiroErrorBody } from "../src/server/providers/kiro-failure.js";
import { kiroObservedValidationReasons } from "../src/shared/kiro-failure.js";
import { projectKiroFailure } from "../src/server/kiro-failure-display.js";

const token = "INVALID_CONVERSATION_ID";
const observation = { token, contract: "unverified", source: "local-static-allowlist" };
const classify = (data: Record<string, unknown>, codes: unknown[] = []) =>
  classifyKiroFailure({ stage: "http", status: 400, codes, body: { state: "json", data } });

test("local static reason vocabulary is closed and immutable, not an official contract", () => {
  assert.deepEqual(kiroObservedValidationReasons, [
    "CONTENT_LENGTH_EXCEEDS_THRESHOLD", "INVALID_CONVERSATION_ID", "INVALID_MODEL_ID",
    "PROMPT_TOO_LONG", "REQUEST_BODY_INVALID", "REQUEST_BODY_INVALID_JSON",
    "THINKING_SIGNATURE_INVALID", "TOOL_CONFIG_MISSING", "TOOL_DUPLICATE",
    "TOOL_SCHEMA_INVALID", "TOOL_USE_RESULT_MISMATCH",
  ]);
  assert.equal(new Set(kiroObservedValidationReasons).size, 11);
  assert.equal(Object.isFrozen(kiroObservedValidationReasons), true);
  assert.equal(Reflect.set(kiroObservedValidationReasons, "0", "PRIVATE-WIDENED"), false);
  assert.throws(() => Reflect.apply(Array.prototype.push, kiroObservedValidationReasons, ["PRIVATE"]), TypeError);
});

test("exact same-object reason observations do not change classification or recovery messages", async t => {
  const baseline = classify({ __type: "ValidationException", message: "PRIVATE-NOT-A-SIGNATURE" });
  for (const candidate of kiroObservedValidationReasons) await t.test(candidate, () => {
    const info = classify({ __type: "ValidationException", reason: candidate, message: "PRIVATE-NOT-A-SIGNATURE" });
    const { observedValidationReason, ...unchanged } = info;
    assert.deepEqual(unchanged, baseline);
    assert.deepEqual(observedValidationReason, { ...observation, token: candidate });
    assert.equal(info.category, "validation", "PROMPT_TOO_LONG alone is not an overflow signature");
    assert.equal(kiroFailureMessage(info, false), kiroFailureMessage(baseline, false));
    assert.doesNotMatch(JSON.stringify(info), /PRIVATE/);
    assert.equal(kiroFailureMessage(info, false).includes(candidate), false);
  });
});

test("root and direct error objects must each own their recognized code and reason", () => {
  for (const key of ["__type", "code", "type"]) {
    assert.deepEqual(classify({ [key]: "com.example#ValidationException", reason: token }).observedValidationReason, observation);
    assert.deepEqual(classify({ error: { [key]: "ValidationException", reason: token } }).observedValidationReason, observation);
  }
  for (const data of [
    { reason: token },
    { __type: "FutureException", reason: token },
    { __type: "com..bad#ValidationException", reason: token },
    { __type: "ValidationException", error: { reason: token } },
    { reason: token, error: { code: "ValidationException" } },
    { __type: "ValidationException", error: { error: { __type: "ValidationException", reason: token } } },
    { __type: "ValidationException", reasons: [token] },
    { __type: "ValidationException", message: token },
    { __type: "ValidationException", error: [{ __type: "ValidationException", reason: token }] },
  ]) assert.equal(classify(data, ["ValidationException"]).observedValidationReason, undefined);
  const inheritedCode: Record<string, unknown> = { reason: token };
  Object.setPrototypeOf(inheritedCode, { __type: "ValidationException" });
  assert.equal(classify(inheritedCode).observedValidationReason, undefined);
  const inheritedReason: Record<string, unknown> = { __type: "ValidationException" };
  Object.setPrototypeOf(inheritedReason, { reason: token });
  assert.equal(classify(inheritedReason).observedValidationReason, undefined);
});

test("unknown, non-string, normalized and accessor reasons are never copied or converted", () => {
  let touched = 0;
  for (const reason of [undefined, null, 0, true, [], {}, [token], token.toLowerCase(), " " + token, token + "\n",
    "PRIVATE " + token, "InvalidConversationId", { toString() { touched++; throw Error("PRIVATE"); } }]) {
    assert.equal(classify({ __type: "ValidationException", reason }).observedValidationReason, undefined);
  }
  const data = { __type: "ValidationException" };
  Object.defineProperty(data, "reason", { get() { touched++; throw Error("PRIVATE-GETTER"); } });
  assert.equal(classify(data).observedValidationReason, undefined);
  assert.equal(touched, 0);
});

test("multiple object reasons require one exact token and no unknown or unassociated alternative", () => {
  const root = { __type: "ValidationException", reason: token };
  assert.deepEqual(classify({ ...root, error: { ...root } }).observedValidationReason, observation);
  for (const error of [
    { __type: "ValidationException", reason: "INVALID_MODEL_ID" },
    { __type: "ValidationException", reason: "PRIVATE" },
    { __type: "ValidationException", reason: null },
    { reason: token },
    { reason: "PRIVATE" },
  ]) assert.equal(classify({ ...root, error }).observedValidationReason, undefined);
});

test("raw category and real HTTP status conflicts suppress observation after classification", () => {
  const body = { state: "json" as const, data: { __type: "ValidationException", reason: token } };
  for (const other of ["ThrottlingException", "ServiceQuotaExceededException", "ContextLengthExceededException"]) {
    const info = classifyKiroFailure({ stage: "http", status: 400, codes: [other], body });
    assert.equal(info.conflict, true); assert.equal(info.category, "unknown"); assert.equal(info.observedValidationReason, undefined);
  }
  for (const status of [200, 401, 429, 503]) {
    const info = classifyKiroFailure({ stage: "http", status, body });
    assert.equal(info.conflict, true); assert.equal(info.observedValidationReason, undefined);
  }
  const streamed = classifyKiroFailure({ stage: "stream", status: 200, body });
  assert.equal(streamed.status, 200); assert.deepEqual(streamed.observedValidationReason, observation);
});

test("non-JSON body states cannot manufacture an observation even with injected data", () => {
  for (const state of ["empty", "invalid", "too-large", "timeout", "aborted", "unreadable"] as const) {
    const info = classifyKiroFailure({ stage: "http", status: 400, body: { state, data: { __type: "ValidationException", reason: token } } });
    assert.equal(info.observedValidationReason, undefined);
  }
});

test("existing local signature refinement is unchanged, independent of fixed-token observation", () => {
  const data = { __type: "ValidationException", reason: token, message: "Input is too long for requested model." };
  const info = classify(data);
  assert.equal(info.category, "overflow"); assert.equal(info.evidence, "local-signature");
  assert.deepEqual(info.observedValidationReason, observation);
  assert.equal(kiroFailureMessage(info, false), kiroFailureMessage(classify({ ...data, reason: "PRIVATE" }), false));
});

const displayBase = { stage: "http", category: "validation", partial: false, status: 400, code: "ValidationException" };
const nativeBase = { ...displayBase, conflict: false, bodyState: "json" };
const display = (details: Record<string, unknown>) => projectKiroFailure({
  role: "assistant", provider: "kiro", api: "kiro-chat", stopReason: "error",
  diagnostics: [{ type: "kiro-failure", details }],
});

test("display reconstructs only a fixed-token unverified observation, not private metadata", () => {
  for (const candidate of kiroObservedValidationReasons) {
    const projected = display({ ...nativeBase, observedValidationReason: { ...observation, token: candidate, body: "PRIVATE", headers: "PRIVATE" } });
    assert.deepEqual(projected, { ...displayBase, observedValidationReason: { ...observation, token: candidate } });
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|bodyState|conflict|headers/);
  }
  assert.deepEqual(display({ ...nativeBase, stage: "stream", status: 200, partial: true, observedValidationReason: observation }),
    { ...displayBase, stage: "stream", status: 200, partial: true, observedValidationReason: observation });
  assert.deepEqual(display({ ...nativeBase, category: "overflow", observedValidationReason: observation }),
    { ...displayBase, category: "overflow", observedValidationReason: observation });
});

test("display drops malformed observations while retaining the legacy base fields", () => {
  for (const observedValidationReason of [undefined, null, [], token, {}, { token }, { ...observation, token: "PRIVATE" },
    { ...observation, token: token + "\n" }, { ...observation, contract: "verified" }, { ...observation, source: "official-chat-enum" },
    { token, contract: "unverified" }, { contract: "unverified", source: "local-static-allowlist" }]) {
    assert.deepEqual(display({ ...nativeBase, observedValidationReason }), displayBase);
  }
});

test("display observation requires consistent original service provenance", () => {
  for (const patch of [{ conflict: true }, { conflict: undefined }, { bodyState: "invalid" }, { bodyState: undefined },
    { stage: "transport" }, { stage: "request" }, { stage: "response" }, { category: "auth" }, { code: "ThrottlingException" },
    { code: "FutureException" }, { status: 429 }, { status: NaN }, { stage: "stream", status: 400 }]) {
    const projected = display({ ...nativeBase, ...patch, observedValidationReason: observation });
    assert.ok(projected); assert.equal(projected.observedValidationReason, undefined);
  }
});

test("observation fields must be own data properties and never invoke getters", () => {
  let touched = 0;
  const getter = () => { touched++; throw Error("PRIVATE-GETTER"); };
  for (const key of ["token", "contract", "source"] as const) {
    const value: Record<string, unknown> = { ...observation };
    Object.defineProperty(value, key, { get: getter });
    assert.deepEqual(display({ ...nativeBase, observedValidationReason: value }), displayBase);
    const inherited: Record<string, unknown> = { ...observation };
    delete inherited[key]; Object.setPrototypeOf(inherited, { [key]: observation[key] });
    assert.deepEqual(display({ ...nativeBase, observedValidationReason: inherited }), displayBase);
  }
  const details = { ...nativeBase };
  Object.defineProperty(details, "observedValidationReason", { get: getter });
  assert.deepEqual(display(details), displayBase);
  const privateGetter = { ...observation }; Object.defineProperty(privateGetter, "body", { get: getter });
  assert.deepEqual(display({ ...nativeBase, observedValidationReason: privateGetter }), { ...displayBase, observedValidationReason: observation });
  assert.equal(touched, 0);
});

test("observed token projection is independent in both mutation directions", () => {
  const original = { ...observation };
  const projected = display({ ...nativeBase, observedValidationReason: original });
  assert.ok(projected?.observedValidationReason);
  original.token = "INVALID_MODEL_ID"; assert.equal(projected.observedValidationReason.token, token);
  projected.observedValidationReason.token = "REQUEST_BODY_INVALID";
  assert.equal(original.token, "INVALID_MODEL_ID");
});

test("only a whole bounded fatal-UTF8 JSON body supplies reason evidence", async () => {
  const controller = new AbortController();
  const data = { __type: "ValidationException", reason: token, private: "PRIVATE" };
  const complete = await readKiroErrorBody(new Response(JSON.stringify(data), { status: 400 }), controller.signal);
  const observed = classifyKiroFailure({ stage: "http", status: 400, body: complete });
  assert.deepEqual(observed.observedValidationReason, observation); assert.doesNotMatch(JSON.stringify(observed), /PRIVATE/);
  for (const bytes of [Buffer.from(JSON.stringify(data).slice(0, -1)), Buffer.concat([Buffer.from(JSON.stringify(data)), Buffer.from([0xc3, 0x28])]),
    Buffer.from(JSON.stringify({ ...data, padding: "x".repeat(16384) }))]) {
    const body = await readKiroErrorBody(new Response(bytes, { status: 400 }), controller.signal);
    assert.notEqual(body.state, "json");
    assert.equal(classifyKiroFailure({ stage: "http", status: 400, body }).observedValidationReason, undefined);
  }
});
