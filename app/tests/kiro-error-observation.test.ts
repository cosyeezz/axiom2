import test from "node:test";
import assert from "node:assert/strict";
import { observeKiroError } from "../src/native-providers/kiro/error-observation.js";
import { classifyKiroFailure, kiroFailureMessage } from "../src/native-providers/kiro/failure.js";

const observe = (data: Record<string, unknown>) => observeKiroError({ state: "json", data })!;
test("unknown HTTP error observations keep root and nested evidence separate without changing classification", () => {
  const body = { state: "json" as const, data: { code: "PRIVATE_CODE", message: "PRIVATE tool schema anyOf top level", error: { type: "invalid_request_error", param: "reasoning.effort", message: "Unsupported reasoning effort." } } };
  const info = classifyKiroFailure({ stage: "http", status: 400, body });
  assert.equal(info.category, "unknown"); assert.equal(info.evidence, "none");
  const result = observeKiroError(body)!;
  assert.deepEqual(result.observations[0].mentions, ["anyOf", "schema", "tool", "top level"]);
  assert.deepEqual(result.observations[0].parameters, []);
  assert.deepEqual(result.observations[1].parameters, ["reasoning.effort"]);
  assert.deepEqual(result.observations[1].codes, ["invalid_request_error"]);
  assert.deepEqual(result.observations[1].signatures, ["unsupported-effort-v1"]);
  assert.equal(result.observations[0].unknownCode, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.match(kiroFailureMessage(info, false), /原因未确认/);
});
test("strict signatures reject private suffixes and token boundaries avoid embedded words", () => {
  for (const message of ["Invalid tool schema. PRIVATE", "PRIVATE Invalid tool schema.", "Invalid tool schema.\n", "invalid tool schema."])
    assert.deepEqual(observe({ message }).observations[0].signatures, []);
  assert.deepEqual(observe({ message: "notools tools_private reasoning_private PRIVATE" }).observations[0].mentions, []);
  assert.deepEqual(observe({ message: "Invalid tool schema." }).observations[0].signatures, ["invalid-tool-schema-v1"]);
});
test("parameter paths are closed and bounded, never copy unknown property names", () => {
  assert.deepEqual(observe({ param: "tools[10].function.parameters.anyOf.0.type" }).observations[0].parameters, ["tools.10.function.parameters.anyOf.0.type"]);
  for (const param of ["tools.1.PRIVATE", "tools.1024.parameters", "tools.-1.parameters", "tools.1e2.parameters", "tools.01.parameters", "tools.1.parameters\n", "tools." + "x".repeat(300),
    "reasoning.1023", "tools[1][2].effort", "model.properties.anyOf", "tools[01]", "tools..parameters"]) {
    const result = observe({ param });
    assert.deepEqual(result.observations[0].parameters, []); assert.equal(result.observations[0].unknownParameter, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});
test("Responses call_id parameter observations retain only a bounded fixed field path", () => {
  for (const param of ["input.0.call_id", "input[12].call_id", "input.1023.call_id"]) {
    const observation = observe({ param }).observations[0];
    assert.deepEqual(observation.parameters, [param.replace(/\[(\d+)\]/g, ".$1")]);
    assert.equal(observation.unknownParameter, false);
  }
  for (const param of ["input.1024.call_id", "input.01.call_id", "input.-1.call_id", "input.0.call_id.PRIVATE", "input.0.PRIVATE", "input.0.content", "input.0.call_id\n"]) {
    const observation = observe({ param }).observations[0];
    assert.deepEqual(observation.parameters, []); assert.equal(observation.unknownParameter, true);
    assert.doesNotMatch(JSON.stringify(observation), /PRIVATE/);
  }
});

test("observer ignores getters, inherited fields, arrays, deep data and non-JSON", () => {
  const root = Object.create({ message: "Invalid tool schema." });
  Object.defineProperty(root, "code", { get() { throw Error("must not access"); } });
  root.error = { error: { message: "Invalid tool schema." }, headers: { secret: "PRIVATE" } };
  const result = observe(root);
  assert.deepEqual(result.observations.map(item => item.fields), [[], []]);
  assert.equal(observe({ error: [{ message: "Invalid tool schema." }] }).observations.length, 1);
  for (const state of ["empty", "invalid", "too-large", "timeout", "aborted", "unreadable"] as const)
    assert.equal(observeKiroError({ state, data: { message: "Invalid tool schema." } }), undefined);
});
test("oversized messages are not scanned and projection remains bounded", () => {
  const result = observe({ message: "Invalid tool schema." + "x".repeat(2048) });
  assert.equal(result.observations[0].truncated, true);
  assert.deepEqual(result.observations[0].mentions, []);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 4096);
  assert.deepEqual(observe({ message: "x".repeat(2040) + " web_read" }).observations[0].mentions, []);
  assert.deepEqual(observe({ message: "x".repeat(2039) + " web_read" }).observations[0].mentions, ["web_read"]);
  assert.deepEqual(observe({ param: "tools[1023].parameters" }).observations[0].parameters, ["tools.1023.parameters"]);
});
