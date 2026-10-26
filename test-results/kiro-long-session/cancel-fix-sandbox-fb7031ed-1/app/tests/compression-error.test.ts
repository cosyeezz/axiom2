import assert from "node:assert/strict";
import { test } from "node:test";
import { compressionError } from "../src/server/compression-error.js";

test("compression errors retain the cause without serializing stacks or credentials", () => {
  assert.equal(compressionError(new Error("HTTP 429: quota exhausted")), "HTTP 429: quota exhausted");
  assert.equal(compressionError("连接超时 ECONNRESET"), "连接超时 ECONNRESET");
  for (const value of [null, {}, new Error(), " \n "]) {
    assert.equal(compressionError(value), "压缩失败，未收到具体错误原因。");
  }
  const error = new Error('HTTP 401: Authorization: Bearer bearer-secret; x-api-key: header-secret; {"api_key":"json-secret", "password":"password-secret"} https://user:url-secret@example.com/v1?token=query-secret&api_key=query-key sk-provider-secret');
  const safe = compressionError(error);
  assert.match(safe, /HTTP 401/);
  assert.doesNotMatch(safe, /bearer-secret|header-secret|json-secret|password-secret|url-secret|query-secret|query-key|sk-provider-secret|at TestContext/);
  assert.match(safe, /已隐藏/);
  const escaped = compressionError(JSON.stringify({ key: 'secret"tail', token: "token-value", password: "password-value" }));
  assert.doesNotMatch(escaped, /secret|tail|token-value|password-value/);
  assert.equal(compressionError(safe), safe, "redaction is stable across worker and parent");
  assert.match(compressionError("x".repeat(2100)), /错误信息已截断/);
  assert.ok(compressionError("x".repeat(2100)).length < 2050);
});
