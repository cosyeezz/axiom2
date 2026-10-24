import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { isResumeControl, resumeSession } from "../src/server/resume-session.js";

// Real Pi history projection/edits, with only the model-turn boundary stubbed.
function fixture() {
  const manager = SessionManager.inMemory();
  const requests: any[][] = [];
  const messages = () => manager.buildSessionProjection().entries.flatMap(entry => entry.messages);
  const session = {
    sessionManager: manager, isIdle: true,
    get messages() { return messages(); },
    refreshContext() {},
    async sendCustomMessage(message: any, options: any) {
      manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
      if (options.triggerTurn) requests.push(messages());
    },
  } as unknown as AgentSession;
  manager.appendMessage({ role: "user", content: "original request", timestamp: 1 });
  return { manager, messages, session, requests };
}
for (const stopReason of ["aborted", "error", "length"] as const) test(`resume repairs ${stopReason} history before bootstrapping additions`, async () => {
  const f = fixture();
  f.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "failed tail" }], stopReason, timestamp: 2 } as any);
  await resumeSession(f.session, "resume-id", async () => {
    assert.deepEqual(f.messages().map(message => message.role), ["user"]);
    for (const [id, text] of [["first", "first addition"], ["second", "second addition"]])
      await f.session.sendCustomMessage({ customType: "axiom-append", content: text, display: true, details: { axiomInput: id } }, { triggerTurn: false });
  });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].filter(message => message.customType === "axiom-append").map(message => message.details.axiomInput), ["first", "second"]);
  assert.equal(f.requests[0].at(-1).customType, "axiom-resume");
  assert.equal(f.requests[0].at(-1).details.axiomInput, "resume-id");
  assert.equal(f.messages().some(isResumeControl), false, "control cleanup must not erase additions");
  assert.equal(f.messages().filter(message => message.role === "custom").length, 2);
});
test("resume pairs unknown tool results before bootstrap without repeating a tool", async () => {
  const f = fixture();
  f.manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "side-effect", name: "bash", arguments: { command: "must not rerun" } }], stopReason: "toolUse", timestamp: 2 } as any);
  await resumeSession(f.session, "resume", async () => {
    const result = f.messages().at(-1);
    assert.equal(result?.role, "toolResult");
    if (result?.role === "toolResult") {
      assert.equal(result.toolCallId, "side-effect");
      assert.equal(result.isError, true);
      assert.deepEqual(result.details, { axiomInterrupted: true });
    }
    await f.session.sendCustomMessage({ customType: "axiom-append", content: "verify effects first", display: true }, { triggerTurn: false });
  });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].map(message => message.role), ["user", "assistant", "toolResult", "custom", "custom"]);
});
test("bootstrap failure or a completed history cannot trigger a model turn", async () => {
  const f = fixture();
  await assert.rejects(resumeSession(f.session, "resume", async () => { throw Error("attachment preparation failed"); }), /attachment preparation failed/);
  assert.equal(f.requests.length, 0);
  f.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "complete" }], stopReason: "stop", timestamp: 2 } as any);
  let called = false;
  await assert.rejects(resumeSession(f.session, "resume", async () => { called = true; }), { code: "NO_CONTINUATION" });
  assert.equal(called, false);
  assert.equal(f.requests.length, 0);
});
test("a bootstrap phase transition retains additions but defers the obsolete work continuation", async () => {
  const f = fixture();
  await resumeSession(f.session, "resume", async () => {
    await f.session.sendCustomMessage({ customType: "axiom-append", content: "include this in summary", display: true }, { triggerTurn: false });
    return false;
  });
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages().at(-1)?.role, "custom");
  assert.equal(f.messages().some(isResumeControl), false);
});
