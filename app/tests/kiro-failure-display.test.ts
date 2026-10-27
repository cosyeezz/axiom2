import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { projectKiroFailure } from "../src/server/kiro-failure-display.js";
import { chatMessage, boundedMessage } from "../src/server/transcript.js";
import { kiroFailureCategories, kiroFailureStages, kiroServiceFailureCodes } from "../src/shared/kiro-failure.js";
import { classifyKiroFailure } from "../src/server/providers/kiro-failure.js";

const requestId = "0b6c0988-3349-4b4d-97d2-c65849594133";
const safe = { stage: "http", category: "validation", partial: false, status: 400, code: "ValidationException", requestId };
const diagnostic = <T extends Record<string, unknown>>(details: T, type = "kiro-failure") => ({ type, timestamp: 1, details });
function message(): AssistantMessage {
  return { role: "assistant", content: [], api: "kiro-chat", provider: "kiro", model: "owned-fixture", timestamp: 1,
    stopReason: "error", errorMessage: "Kiro 请求验证失败，请检查消息、所选模型及 profile。",
    diagnostics: [diagnostic({ ...safe, body: "PRIVATE-BODY", headers: { authorization: "PRIVATE-HEADER" }, note: "PRIVATE-NOTE", localCode: "PRIVATE-CODE" })],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

test("failure display copies only six allowlisted terminal Kiro fields", () => {
  const original = message(), before = JSON.stringify(original), projected = projectKiroFailure(original);
  assert.deepEqual(projected, safe); assert.equal(JSON.stringify(original), before);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|body|headers|note|localCode|timestamp/);
  original.diagnostics![0].details!.status = 422; assert.equal(projected?.status, 400);
});

for (const [key, value] of [["role", "user"], ["provider", "openai"], ["api", "openai-responses"], ["stopReason", "stop"], ["stopReason", "toolUse"]] as const)
  test("failure display rejects foreign or successful message " + key + "=" + value, () => {
    assert.equal(projectKiroFailure({ ...message(), [key]: value }), undefined);
  });

test("failure display accepts aborted/local/timeout without inventing HTTP status", () => {
  for (const category of ["timeout-or-cancel", "local-or-transport"]) {
    const info = { stage: "transport", category, partial: true };
    assert.deepEqual(projectKiroFailure({ ...message(), stopReason: "aborted", diagnostics: [diagnostic(info)] }), info);
  }
  assert.deepEqual(projectKiroFailure({ ...message(), diagnostics: [diagnostic({ ...safe, stage: "stream", status: 200, partial: true })] }), { ...safe, stage: "stream", status: 200, partial: true });
});

for (const [key, value] of [["stage", "PRIVATE-STAGE"], ["category", "PRIVATE-CATEGORY"], ["partial", "false"], ["partial", undefined]] as const)
  test("failure display fails closed on malformed required field " + key + "=" + value, () => {
    assert.equal(projectKiroFailure({ ...message(), diagnostics: [diagnostic({ ...safe, [key]: value })] }), undefined);
  });

test("failure display drops every malformed optional scalar rather than echoing it", () => {
  for (const status of [0, 99, 600, 400.5, "400", NaN, Infinity, { token: "PRIVATE" }]) {
    const projected = projectKiroFailure({ ...message(), diagnostics: [diagnostic({ ...safe, status, code: "PRIVATE-FUTURE-CODE", requestId: "PRIVATE-ID" })] });
    assert.deepEqual(projected, { stage: "http", category: "validation", partial: false });
  }
});

test("failure display rejects duplicate/missing/unbounded or foreign diagnostic records", () => {
  for (const diagnostics of [[], [diagnostic(safe, "kiro-future")], [diagnostic(safe), diagnostic(safe)], new Array(129).fill(diagnostic(safe)), { type: "kiro-failure", details: safe }]) {
    assert.equal(projectKiroFailure({ ...message(), diagnostics }), undefined);
  }
});

test("failure display never invokes getters, iterators, or unknown string conversion", () => {
  let touched = 0;
  const details = { ...safe };
  Object.defineProperty(details, "body", { get() { touched++; throw Error("PRIVATE"); } });
  assert.deepEqual(projectKiroFailure({ ...message(), diagnostics: [diagnostic(details)] }), safe);
  const object = { ...message() };
  Object.defineProperty(object, "provider", { get() { touched++; return "kiro"; } });
  assert.equal(projectKiroFailure(object), undefined);
  const native = { ...message(), stopReason: { toString() { touched++; return "error"; } } };
  assert.equal(projectKiroFailure(native), undefined);
  assert.equal(touched, 0);
});

test("runtime allowlists cannot be accidentally widened", () => {
  for (const values of [kiroFailureStages, kiroFailureCategories, kiroServiceFailureCodes]) {
    assert.equal(Object.isFrozen(values), true);
    assert.equal(Reflect.set(values, "0", "PRIVATE-WIDENED"), false);
    assert.throws(() => Reflect.apply(Array.prototype.push, values, ["PRIVATE-WIDENED"]), TypeError);
  }
  assert.deepEqual(projectKiroFailure(message()), safe);
});

test("UUID projection rejects terminal newlines and all nonexact lengths", () => {
  for (const invalid of [requestId + "\n", requestId + "\r", requestId + "\r\n", requestId + "\u2028", requestId + "\u2029", " " + requestId, requestId.slice(1)]) {
    const projected = projectKiroFailure({ ...message(), diagnostics: [diagnostic({ ...safe, requestId: invalid })] });
    assert.ok(projected); assert.equal(projected.requestId, undefined);
  }
});

test("target fields, diagnostic elements and details accessors are never invoked", () => {
  let touched = 0;
  const getter = () => { touched++; throw Error("PRIVATE-GETTER"); };
  for (const key of ["stage", "category", "partial", "status", "code", "requestId"]) {
    const details = { ...safe }; Object.defineProperty(details, key, { get: getter });
    const projected = projectKiroFailure({ ...message(), diagnostics: [diagnostic(details)] });
    if (["stage", "category", "partial"].includes(key)) assert.equal(projected, undefined);
    else { assert.ok(projected); assert.equal(Object.hasOwn(projected, key), false); }
  }
  const diagnostics = [diagnostic(safe)]; Object.defineProperty(diagnostics, "0", { get: getter });
  assert.equal(projectKiroFailure({ ...message(), diagnostics }), undefined);
  const item = diagnostic(safe); Object.defineProperty(item, "details", { get: getter });
  assert.equal(projectKiroFailure({ ...message(), diagnostics: [item] }), undefined);
  assert.equal(projectKiroFailure({ ...message(), diagnostics: [diagnostic(Object.create(safe))] }), undefined);
  assert.equal(touched, 0);
});

test("unknown records cannot hide duplicates and projected values do not alias native details", () => {
  const valid = diagnostic({ ...safe });
  assert.equal(projectKiroFailure({ ...message(), diagnostics: [diagnostic({}), valid] }), undefined);
  const projected = projectKiroFailure({ ...message(), diagnostics: [diagnostic({ body: "PRIVATE" }, "future"), valid] });
  assert.deepEqual(projected, safe); projected!.status = 422; assert.equal(valid.details.status, 400);
});

test("service code allowlist stays aligned with the provider classifier", () => {
  for (const code of kiroServiceFailureCodes) assert.equal(classifyKiroFailure({ stage: "stream", status: 200, codes: [code] }).code, code);
  for (const stage of kiroFailureStages) for (const category of kiroFailureCategories) {
    assert.deepEqual(projectKiroFailure({ ...message(), diagnostics: [diagnostic({ stage, category, partial: false })] }), { stage, category, partial: false });
  }
});

test("chatMessage and bounded history share the same safe projection, streaming stays unprojected", () => {
  const native = message(), full = chatMessage(native, "owned-failed")!;
  assert.deepEqual(full.kiroFailure, safe); assert.equal(full.status, "failed");
  assert.deepEqual(boundedMessage(full).kiroFailure, safe);
  assert.equal(chatMessage(native, "owned-live", true)?.kiroFailure, undefined);
  assert.equal(chatMessage({ ...native, provider: "other" }, "foreign")?.kiroFailure, undefined);
  assert.doesNotMatch(JSON.stringify(full), /PRIVATE|diagnostics|authorization/);
});

test("owned temporary native session preserves failure diagnostics across reopening", t => {
  const root = mkdtempSync(join(tmpdir(), "kiro-failure-display-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, root);
  manager.appendMessage({ role: "user", content: "OWNED_SYNTHETIC_INPUT", timestamp: 1 });
  const id = manager.appendMessage(message()), file = manager.getSessionFile(); assert.ok(file);
  const reopened = SessionManager.open(file);
  const entry = reopened.getEntry(id); assert.ok(entry?.type === "message");
  assert.deepEqual(projectKiroFailure(entry.message), safe);
  const full = chatMessage(entry.message, id)!;
  assert.deepEqual(full.kiroFailure, boundedMessage(full).kiroFailure);
  assert.doesNotMatch(JSON.stringify(full), /PRIVATE|diagnostics|authorization/);
});
