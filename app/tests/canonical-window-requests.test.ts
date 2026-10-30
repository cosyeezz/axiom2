import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalWindowRequests } from "../src/server/canonical-window-requests.js";
import type { Reply } from "../src/shared/protocol.js";

type Sent = Parameters<ConstructorParameters<typeof CanonicalWindowRequests>[0]>[0];
const success = (requestId: string): Reply => ({ type: "receipt", requestId, ok: true, data: { fixture: true } });
function failure(reply: Reply, code: string) {
  assert.equal(reply.ok, false);
  if (!reply.ok) assert.equal(reply.error.code, code);
}

test("aborted reads retain physical slots until replies and never deliver their late payloads", async () => {
  const sent: Sent[] = [], broker = new CanonicalWindowRequests(request => { sent.push(request); }, () => true);
  const one = new AbortController(), two = new AbortController();
  const first = broker.read("a", { op: "open" }, one.signal), second = broker.read("b", { op: "open" }, two.signal);
  one.abort(); two.abort();
  failure(await first, "STALE"); failure(await second, "STALE");
  failure(await broker.read("c", { op: "open" }), "UNAVAILABLE");
  assert.equal(sent.length, 2);
  assert.equal(broker.accept(sent[0].queryId, success("a")), true);
  const third = broker.read("d", { op: "open" });
  assert.equal(sent.length, 3);
  broker.accept(sent[2].queryId, success("d"));
  assert.deepEqual(await third, success("d"));
  broker.close();
});

test("owner closure and rollover cannot relabel an old reply onto a new owner", async () => {
  const old: Sent[] = [], fresh: Sent[] = [];
  const before = new CanonicalWindowRequests(request => { old.push(request); }, () => true);
  const after = new CanonicalWindowRequests(request => { fresh.push(request); }, () => true);
  const first = before.read("same-client-id", { op: "open" }); before.close();
  failure(await first, "STALE");
  const second = after.read("same-client-id", { op: "open" });
  assert.equal(after.accept(old[0].queryId, success("same-client-id")), false);
  assert.equal(before.accept(old[0].queryId, success("same-client-id")), false);
  after.accept(fresh[0].queryId, success("same-client-id"));
  assert.deepEqual(await second, success("same-client-id"));
  after.close();
});

test("timeouts retain admission slots and current-owner gates are rechecked on delivery", async () => {
  const sent: Sent[] = []; let current = true;
  const broker = new CanonicalWindowRequests(request => { sent.push(request); }, () => current, 1);
  const first = broker.read("a", {}), second = broker.read("b", {});
  failure(await first, "UNAVAILABLE"); failure(await second, "UNAVAILABLE");
  failure(await broker.read("c", {}), "UNAVAILABLE"); assert.equal(sent.length, 2);
  broker.accept(sent[0].queryId, success("a"));
  const next = broker.read("d", {});
  current = false;
  broker.accept(sent[2].queryId, success("d"));
  failure(await next, "STALE");
  failure(await broker.read("e", {}), "STALE");
  broker.close();
});

test("request and receipt budgets, correlation and error normalization fail safely", async () => {
  const sent: Sent[] = [], broker = new CanonicalWindowRequests(request => { sent.push(request); }, () => true);
  failure(await broker.read("r", { huge: "x".repeat(17000) }), "INVALID_REFERENCE");
  failure(await broker.read("\0".repeat(10000), {}), "INVALID_REQUEST_ID");
  assert.equal(sent.length, 0);
  const mismatched = broker.read("r", {});
  broker.accept(sent.at(-1)!.queryId, success("other-request"));
  failure(await mismatched, "UNAVAILABLE");
  const huge = broker.read("r", {});
  broker.accept(sent.at(-1)!.queryId, { ...success("r"), data: "x".repeat(129 * 1024) });
  failure(await huge, "UNAVAILABLE");
  const diagnostic = broker.read("r", {});
  broker.accept(sent.at(-1)!.queryId, { type: "receipt", requestId: "r", ok: false, error: { code: "arbitrary", message: "private secret" } });
  const safe = await diagnostic;
  failure(safe, "UNAVAILABLE"); assert.equal(JSON.stringify(safe).includes("private secret"), false);
  broker.close();
});
