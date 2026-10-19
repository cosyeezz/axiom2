import assert from "node:assert/strict";
import { test } from "node:test";
import { connect } from "../src/client/transport.js";
import { optimisticStart, optimisticState, pendingMessages, pendingMessageStatus } from "../src/client/chat/optimistic.js";
import { beginRecall, finishRecall, pendingRecall, reconcileInputs, beginResume, pendingResume } from "../src/client/chat/reconcile-inputs.js";
import { getDraft, updateDraft } from "../src/client/drafts.js";
import { submissionError } from "../src/client/chat/submission-feedback.js";

test("uncertain inputs and lost recall receipts resolve by read-only queries exactly once", async (t) => {
  const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, location: Object.getOwnPropertyDescriptor(globalThis, "location") };
  const requests: any[] = [];
  let consumed = false;
  let receiptStatus = "committed";
  let resumeStatus = "uncertain";
  let failRecall = false;
  let failInputs = false;
  let active: boolean | undefined;
  class Socket {
    static OPEN = 1; readyState = 1;
    onopen?: () => void; onmessage?: (event: { data: string }) => void;
    constructor() { setTimeout(() => this.onopen?.(), 0); }
    send(raw: string) {
      const request = JSON.parse(raw); requests.push(request);
      if (request.op === "request.get" && failRecall || request.op === "agent.inputs" && failInputs) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "receipt", requestId: request.requestId, ok: false, error: { code: "READ_FAILED", message: "fixture query failed" } }) }));
        return;
      }
      const data = request.op === "request.get"
        ? request.params.requestId.startsWith("resume-")
          ? { status: resumeStatus, data: { message: "resume rejected" } }
          : { status: "committed", data: { ids: ["recalled"], drafts: [{ text: "recovered", attachment: null }] } }
        : request.params.ids.map((id: string) => ({ id, consumed, active, queued: false, receipt: { status: receiptStatus, data: { inputId: id, message: "fixture rejected input" } } }));
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "receipt", requestId: request.requestId, ok: true, data }) }));
    }
  }
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://localhost" } });
  globalThis.WebSocket = Socket as any;
  globalThis.fetch = (async () => ({ ok: true })) as any;
  t.after(() => {
    globalThis.fetch = original.fetch; globalThis.WebSocket = original.WebSocket;
    if (original.location) Object.defineProperty(globalThis, "location", original.location);
    else Reflect.deleteProperty(globalThis, "location");
  });
  await connect(); await new Promise((resolve) => setTimeout(resolve, 5));
  const scope = { workspaceId: "w", sessionId: "s" };
  optimisticStart(scope, "sent", { text: "sent", attachment: null });
  optimisticState(scope, "sent", "uncertain");
  await reconcileInputs(scope);
  assert.equal(pendingMessages(scope)[0].state, "accepted", "receipt alone keeps bubble until consumed evidence");
  consumed = true;
  await reconcileInputs(scope);
  assert.equal(pendingMessages(scope).length, 0, "compacted input can be resolved by identity");
  optimisticStart(scope, "recalled", { text: "recovered", attachment: null });
  updateDraft(scope, { text: "new typing" });
  beginRecall(scope, "recall-request");
  assert.equal(pendingRecall(scope), true);
  await reconcileInputs(scope);
  assert.equal(pendingRecall(scope), false);
  assert.equal(pendingMessages(scope).length, 0);
  const draft = getDraft(scope).text;
  assert.match(draft, /new typing/); assert.match(draft, /recovered/);
  finishRecall(scope, "recall-request", { drafts: [{ text: "recovered", attachment: null }] });
  assert.equal(getDraft(scope).text, draft, "late original receipt cannot restore twice");
  consumed = false;
  receiptStatus = "uncertain";
  const rejectedScope = { workspaceId: "w", sessionId: "rejected" };
  optimisticStart(rejectedScope, "rejected", { text: "rejected input", attachment: null }, true);
  optimisticState(rejectedScope, "rejected", "accepted");
  updateDraft(rejectedScope, { text: "continued typing" });
  await reconcileInputs(rejectedScope);
  assert.equal(getDraft(rejectedScope).text, "continued typing", "unknown outcomes cannot restore potentially consumed input");
  assert.equal(pendingMessages(rejectedScope).length, 1);
  assert.equal(pendingMessages(rejectedScope)[0].state, "uncertain", "a later unknown delivery overrides the optimistic admission state");
  assert.match(pendingMessageStatus(pendingMessages(rejectedScope)[0]), /发送结果未确认/);
  failRecall = true;
  beginRecall(rejectedScope, "broken-recall");
  failInputs = true;
  await reconcileInputs(rejectedScope);
  assert.match(pendingMessageStatus(pendingMessages(rejectedScope)[0]), /核实失败.*fixture query failed/);
  failInputs = false;
  receiptStatus = "committed";
  active = false;
  await reconcileInputs(rejectedScope);
  await reconcileInputs(rejectedScope);
  assert.match(pendingMessageStatus(pendingMessages(rejectedScope)[0]), /发送结果未确认/);
  assert.equal(getDraft(rejectedScope).text, "continued typing", "terminal session alone does not prove rejection");
  receiptStatus = "failed";
  await reconcileInputs(rejectedScope);
  assert.equal(pendingMessages(rejectedScope).length, 1);
  assert.equal(pendingMessages(rejectedScope)[0].state, "failed");
  assert.equal(getDraft(rejectedScope).text, "continued typing");
  assert.match(pendingMessageStatus(pendingMessages(rejectedScope)[0]), /fixture rejected input/);
  await reconcileInputs(rejectedScope);
  assert.equal(getDraft(rejectedScope).text, "continued typing", "reconciliation never restores a failed submission");
  finishRecall(rejectedScope, "broken-recall");
  failRecall = false;
  const resumeScope = { workspaceId: "w", sessionId: "resume" };
  updateDraft(resumeScope, { text: "keep my draft" });
  beginResume(resumeScope, "resume-request");
  await reconcileInputs(resumeScope);
  assert.equal(pendingResume(resumeScope), true, "unknown resume remains guarded");
  resumeStatus = "committed";
  await reconcileInputs(resumeScope);
  assert.equal(pendingResume(resumeScope), false);
  assert.equal(getDraft(resumeScope).text, "keep my draft");
  assert.equal(pendingMessages(resumeScope).length, 0, "resume never creates a user bubble");
  beginResume(resumeScope, "resume-rejected");
  resumeStatus = "failed";
  await reconcileInputs(resumeScope);
  assert.equal(pendingResume(resumeScope), false);
  assert.equal(submissionError(resumeScope), "resume rejected");
  assert.equal(getDraft(resumeScope).text, "keep my draft");
  assert.ok(requests.every((request) => ["request.get", "agent.inputs"].includes(request.op)), "no mutating command replay");
});
