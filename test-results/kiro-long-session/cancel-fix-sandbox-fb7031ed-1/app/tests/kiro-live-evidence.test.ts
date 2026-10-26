import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
const { buildMatrixEvidence, matrixLabels, matrixModels, summarizeMatrixState } = await import(new URL("../scripts/kiro-live-evidence.mjs", import.meta.url).href);

function fixture(id = "claude-sonnet-4.5") {
  const vision = ["auto", "claude-sonnet-4.5", "claude-haiku-4.5"].includes(id);
  const labels = matrixLabels.map((label: string) => label.replace("INPUT_VARIANT", vision ? "user-image" : "text-table").replace("TOOL_VARIANT", vision ? "tool-image" : "code-review"));
  const turns = labels.map((label: string, index: number) => {
    const runId = `live-${id}-${index}`;
    const thinking = !id.startsWith("claude-") ? "off" : index < 4 ? "high" : index < 8 ? "off" : index < 11 ? "minimal" : index < 15 ? "low" : index < 18 ? "medium" : "high";
    return {
      label, run: { id: runId, selection: { provider: "kiro", id, thinking }, status: "completed" },
      answer: "PRIVATE-ANSWER", prompt: "PRIVATE-PROMPT", thinkingLength: 123, observedMs: 45,
      calls: [] as any[], results: [] as any[], promptImages: [] as any[], attachments: [] as any[],
      messageIds: [{ id: `message-${index}`, role: "assistant", runId }],
    };
  });
  return { sessionId: `child-${id}`, taskRef: `task-${id}`, turns, checks: labels.map((label: string) => ({ label, passed: true, error: undefined as string | undefined })),
    checkFailures: [] as any[], longSessionPassed: true, completedAt: "2026-10-25T18:00:00.000Z" };
}

test("Kiro evidence curates all eight actual 20-round schedules without publishing answer text", () => {
  const states = Object.fromEntries(matrixModels.map((id: string) => [id, fixture(id)]));
  const evidence = buildMatrixEvidence(states);
  assert.equal(evidence.modelCount, 8); assert.equal(evidence.matrixRoundCount, 160);
  assert.equal(evidence.complete, true); assert.equal(evidence.allProtocolsCompleted, true); assert.equal(evidence.allSemanticChecksPassed, true);
  assert.equal(evidence.models[1].rounds[8].selection.thinking, "minimal");
  assert.equal(evidence.models[1].rounds[11].selection.thinking, "low");
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE-ANSWER|PRIVATE-PROMPT/);
});

test("Kiro evidence retains failed semantic acceptance instead of treating completed runs as a pass", () => {
  const state = fixture("minimax-m2.1");
  state.checks[1] = { ...state.checks[1], passed: false, error: "Expected actual read" };
  state.checkFailures = [state.checks[1]]; state.longSessionPassed = false;
  const evidence = summarizeMatrixState("minimax-m2.1", state);
  assert.equal(evidence.protocolCompleted, true); assert.equal(evidence.semanticPassed, false); assert.equal(evidence.semanticFailureCount, 1);
  assert.equal(evidence.rounds[1].semanticCheck.category, "required-real-tool-evidence");
});

test("Kiro evidence refuses unfinished final publication but supports explicitly marked drafts", () => {
  const state = fixture(); state.turns = state.turns.slice(0, 3); state.checks = state.checks.slice(0, 3);
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", state), /unfinished/);
  const evidence = summarizeMatrixState("claude-sonnet-4.5", state, { allowIncomplete: true });
  assert.equal(evidence.complete, false); assert.equal(evidence.protocolCompleted, false); assert.equal(evidence.semanticPassed, false);
  assert.equal(evidence.defaultsUnchangedVerifiedByDriver, false); assert.equal(evidence.completedAt, null);
});

test("Kiro evidence refuses mismatched selections, repeated rounds, and inconsistent failure summaries", () => {
  const selection = fixture(); selection.turns[8].run.selection.thinking = "high";
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", selection), /selection/);
  const repeated = fixture(); repeated.turns.push(structuredClone(repeated.turns[0]));
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", repeated), /Repeated/);
  const disagreement = fixture(); disagreement.longSessionPassed = false;
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", disagreement), /disagrees/);
  const lostFailure = fixture(); lostFailure.checks[1].passed = false; lostFailure.longSessionPassed = false;
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", lostFailure), /failures disagree/);
});

test("Kiro evidence never copies leaked thinking, assertions, credential-like text, or unknown fields", () => {
  const state = fixture(), turn = state.turns[0];
  const privateText = "PRIVATE-ACCESS PRIVATE-REFRESH PRIVATE-THOUGHT C:\\Users\\PRIVATE-LOCAL";
  turn.answer = `<axiom_prior_reasoning>${privateText}</axiom_prior_reasoning>`;
  state.checks[0] = { ...state.checks[0], passed: false, error: `Assertion did not match ${turn.answer}` };
  state.checkFailures = [state.checks[0]]; state.longSessionPassed = false;
  turn.calls = [{ id: "actual-tool-id", name: "functions.powershell", input: { command: privateText } }];
  turn.results = [{ callId: "actual-tool-id", toolName: "powershell", text: privateText, status: "failed", error: privateText, images: [{ data: privateText }] }];
  turn.promptImages = [{ bytes: 20, sha256: "a".repeat(64), data: privateText, name: privateText }];
  turn.attachments = [{ bytes: 50, sha256: "b".repeat(64), text: privateText, name: privateText }];
  (state as any).credentials = privateText;
  const before = structuredClone(state), evidence = summarizeMatrixState("claude-sonnet-4.5", state);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /PRIVATE-ACCESS|PRIVATE-REFRESH|PRIVATE-THOUGHT|PRIVATE-LOCAL|actual-tool-id/);
  assert.equal(evidence.rounds[0].answerHasPriorReasoningWrapper, true);
  assert.equal(evidence.rounds[0].semanticCheck.category, "prior-reasoning-wrapper");
  assert.equal(evidence.rounds[0].calls[0].callIdSha256, evidence.rounds[0].results[0].callIdSha256);
  assert.equal(evidence.rounds[0].unmatchedCallCount, 0); assert.equal(evidence.rounds[0].results[0].returnedImageCount, 1);
  assert.equal(evidence.rounds[0].answerSha256, createHash("sha256").update(turn.answer).digest("hex"));
  assert.deepEqual(state, before, "curation must not edit local native evidence");
});

test("Kiro evidence rejects wrong-run or missing assistant evidence and duplicate dedicated task sessions", () => {
  const wrong = fixture(); wrong.turns[0].messageIds[0].runId = "wrong-run";
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", wrong), /correlate/);
  const missing = fixture(); missing.turns[0].messageIds = [];
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", missing), /correlate/);
  const states = Object.fromEntries(matrixModels.map((id: string) => [id, fixture(id)]));
  states.auto.sessionId = states["claude-haiku-4.5"].sessionId;
  assert.throws(() => buildMatrixEvidence(states), /own registered task/);
});

test("Kiro evidence keeps supplemental follow-ups separate from the original matrix result", () => {
  const state = fixture(), extra = structuredClone(state.turns[19]);
  extra.label = "supplemental-explicit-tool-scope"; extra.run.id = "supplemental-run"; extra.messageIds[0].runId = extra.run.id;
  state.turns.push(extra);
  const evidence = summarizeMatrixState("claude-sonnet-4.5", state);
  assert.equal(evidence.matrixRoundCount, 20); assert.equal(evidence.supplementalTurns.length, 1);
  assert.equal(evidence.supplementalTurns[0].semanticCheck, null); assert.equal(evidence.semanticPassed, true);
});
