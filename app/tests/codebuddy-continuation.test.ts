import assert from "node:assert/strict";
import { test } from "node:test";
import { CODEBUDDY_CONTINUATION_METADATA as key, freshCodeBuddyRunIdentity, withCodeBuddyRunIdentity } from "../src/server/codebuddy-run-identity.js";
const model = { provider: "codebuddy-cn", api: "openai-completions" }, sessionId = "fixture-session";
test("CodeBuddy host identity preserves one logical run across calls and changes on next run", () => {
  const first = freshCodeBuddyRunIdentity({ runId: "first-run" }, sessionId)!, next = freshCodeBuddyRunIdentity({ runId: "next-run" }, sessionId)!;
  for (let i = 0; i < 3; i++) assert.equal(withCodeBuddyRunIdentity(model, { sessionId, metadata: {} as Record<string, unknown> }, first).metadata[key], "first-run");
  assert.equal(withCodeBuddyRunIdentity(model, { sessionId, metadata: {} as Record<string, unknown> }, next).metadata[key], "next-run");
});
test("CodeBuddy identity leaves other providers, auxiliary sessions and unknown recovery modes unchanged", () => {
  const first = freshCodeBuddyRunIdentity({ runId: "first-run" }, sessionId)!;
  for (const mode of [{ resume: true }, { memoryContinuation: true }, { notification: {} }, { reloadId: "r" }, { compressionPreparation: "p" }])
    assert.equal(freshCodeBuddyRunIdentity({ runId: "run", ...mode }, sessionId), undefined);
  const options = { sessionId, metadata: { caller: "retained" } };
  assert.equal(withCodeBuddyRunIdentity({ ...model, provider: "other" }, options, first), options);
  assert.equal(withCodeBuddyRunIdentity({ ...model, api: "other" }, options, first), options);
  const auxiliary = { ...options, sessionId: "auxiliary" };
  assert.equal(withCodeBuddyRunIdentity(model, auxiliary, first), auxiliary);
  assert.equal(withCodeBuddyRunIdentity(model, undefined, first), undefined);
  assert.equal(withCodeBuddyRunIdentity(model, options), options);
  const result = withCodeBuddyRunIdentity(model, options, first);
  assert.deepEqual(result.metadata, { caller: "retained", [key]: "first-run" });
  assert.deepEqual(options.metadata, { caller: "retained" });
});
