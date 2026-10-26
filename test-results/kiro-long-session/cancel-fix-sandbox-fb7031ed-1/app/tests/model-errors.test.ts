import assert from "node:assert/strict";
import { test } from "node:test";
import { chatMessage } from "../src/server/transcript.js";
import { errorMessage } from "../src/server/error-message.js";

const failed = (errorMessage?: unknown) => ({
  role: "assistant", content: [], stopReason: "error", errorMessage,
});

test("model failures show the actual cause consistently in live and historical messages", () => {
  for (const cause of [
    "401 Invalid API key",
    "429 insufficient_quota: account balance exhausted",
    "400 Unsupported parameter: temperature",
    "Connection error: ECONNRESET",
    "请求超时\nrequest_id=req-123",
  ]) {
    const history = chatMessage(failed(cause), "message")!;
    const live = chatMessage(failed(cause), "message", true)!;
    assert.equal(history.status, "failed");
    assert.equal(history.error, `模型请求失败：${cause}`);
    assert.equal(live.error, history.error);
  }
});

test("only missing diagnostics use the unknown fallback; unrelated provider fields stay private", () => {
  for (const cause of [undefined, null, " \n ", {}]) {
    const message = chatMessage({ ...failed(cause), details: { secret: "private-detail" } }, "message")!;
    assert.equal(message.error, "模型请求失败：未收到具体错误原因。");
    assert.doesNotMatch(JSON.stringify(message), /private-detail/);
  }
  for (const stopReason of ["stop", "aborted"]) {
    assert.equal(chatMessage({ ...failed("stale error"), stopReason }, "message")!.error, undefined);
  }
});

test("displayed failures redact credentials, bound long messages and omit exception stacks", () => {
  const diagnostic = 'HTTP 401: invalid credential; Authorization: Bearer bearer-secret; {"api_key":"json-secret"} https://user:url-secret@example.com/v1?token=query-secret sk-provider-secret';
  const view = chatMessage(failed(diagnostic), "message")!;
  assert.match(view.error!, /HTTP 401: invalid credential/);
  assert.match(view.error!, /已隐藏/);
  assert.doesNotMatch(view.error!, /bearer-secret|json-secret|url-secret|query-secret|sk-provider-secret/);
  assert.match(chatMessage(failed("x".repeat(3000)), "message")!.error!, /错误信息已截断/);
  const error = new Error("ENOENT: missing model resource");
  error.stack = "private-stack";
  assert.equal(errorMessage(error, "unknown"), "ENOENT: missing model resource");
});
