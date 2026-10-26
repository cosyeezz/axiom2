import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
const { buildMatrixEvidence, buildRecoveryEvidence, recoveryModels, matrixLabels, matrixModels, summarizeMatrixState } = await import(new URL("../scripts/kiro-live-evidence.mjs", import.meta.url).href);

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

function controlledFixture(id = "claude-sonnet-4.5"): any {
  const state: any = fixture(id);
  state.taskId = `owned-${id}`;
  state.harness = { version: "v2-controlled", controlledPrompts: true, paceMs: 30000, receiptTag: "recovery-v2",
    promptCorrelation: "receipt-inputIds-and-matching-user-text",
    sourceHashes: ["kiro-live-check.mjs", "kiro-live-plan.mjs"].map(name => ({ path: `app/scripts/${name}`, sha256: "a".repeat(64) })),
    fixtures: ["inventory.csv", "ledger.json"].map(name => ({ name, bytes: 123, sha256: "b".repeat(64) })),
    workerPreparation: { strategy: "intermediate-profile-cold-reload", status: "completed", modelMessagesUnchanged: true, reloadId: "PRIVATE-RELOAD-ID" } };
  for (const [i, turn] of state.turns.entries()) {
    turn.inputCorrelated = true;
    turn.receipt = { taskId: state.taskId, inputId: `PRIVATE-INPUT-${i}`, runId: null };
    turn.messageIds.unshift({ id: `user-${i}`, role: "user", runId: turn.run.id, inputIds: [turn.receipt.inputId] });
    turn.format = { kind: i === 0 || i === 19 ? "one-line" : i === 16 ? "prefix-json" : "json-only", complied: true };
  }
  return state;
}

test("Kiro evidence separates controlled recovery conditions and format from original attempts", () => {
  const original = summarizeMatrixState("claude-sonnet-4.5", fixture());
  assert.equal(original.harness.version, "v1"); assert.equal(original.formatPassed, null);
  const states = Object.fromEntries(recoveryModels.map((id: string) => [id, controlledFixture(id)]));
  const evidence = buildRecoveryEvidence(states);
  assert.equal(evidence.phase, "controlled-recovery"); assert.equal(evidence.modelCount, 7);
  assert.equal(evidence.matrixRoundCount, 140); assert.equal(evidence.allFormatChecksPassed, true);
  assert.equal(evidence.models[0].harness.paceMs, 30000);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE-RELOAD-ID|PRIVATE-INPUT-|PRIVATE-ANSWER|PRIVATE-PROMPT/);
  assert.throws(() => buildRecoveryEvidence(Object.fromEntries(recoveryModels.map((id: string) => [id, fixture(id)]))), /requires controlled/);
});

test("Kiro evidence records fenced JSON as a format failure without inventing a semantic failure", () => {
  const state = controlledFixture(); state.turns[2].format.complied = false;
  const evidence = summarizeMatrixState("claude-sonnet-4.5", state);
  assert.equal(evidence.protocolCompleted, true); assert.equal(evidence.semanticPassed, true);
  assert.equal(evidence.formatPassed, false); assert.equal(evidence.formatFailureCount, 1);
  assert.equal(evidence.formatCheckedRoundCount, 20); assert.equal(evidence.uncheckedRoundCount, 0);
});

test("Kiro evidence classifies HTTP429 and unchecked rounds without publishing protocol error text", () => {
  const state = controlledFixture(); state.turns = state.turns.slice(0, 2); state.checks = state.checks.slice(0, 1);
  delete state.completedAt; delete state.turns[1].format;
  state.turns[1].run.status = "failed"; state.turns[1].run.error = "PRIVATE-THOUGHT HTTP 429 PRIVATE-ACCESS";
  const evidence = summarizeMatrixState("claude-sonnet-4.5", state, { allowIncomplete: true });
  assert.equal(evidence.protocolCompletedRoundCount, 1); assert.equal(evidence.protocolFailureRoundCount, 1);
  assert.equal(evidence.rateLimitedRoundCount, 1); assert.equal(evidence.checkedRoundCount, 1); assert.equal(evidence.uncheckedRoundCount, 1);
  assert.equal(evidence.semanticPassed, false); assert.equal(evidence.semanticFailureCount, 0);
  assert.equal(evidence.rounds[1].semanticCheck, null);
  assert.equal(evidence.rounds[1].protocolError.category, "upstream-rate-or-quota-429");
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE-THOUGHT|PRIVATE-ACCESS/);
});

test("Kiro evidence requires the owned input receipt and exactly one unmerged matching user", () => {
  const mutate = [
    (s: any) => { s.turns[0].receipt.taskId = "other-task"; },
    (s: any) => { s.turns[0].receipt.inputId = "other-input"; },
    (s: any) => { s.turns[0].receipt.runId = "other-run"; },
    (s: any) => { s.turns[0].inputCorrelated = false; },
    (s: any) => { s.turns[0].messageIds[0].inputIds.push("merged-input"); },
    (s: any) => { s.turns[0].messageIds.push(structuredClone(s.turns[0].messageIds[0])); },
  ];
  for (const change of mutate) { const state = controlledFixture(); change(state); assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", state), /task input|correlate/); }
});

test("Kiro evidence rejects unknown harness, private source paths, invalid pace and unverified worker preparation", () => {
  const mutate = [
    (s: any) => { s.harness.version = "unknown"; },
    (s: any) => { s.harness.sourceHashes[0].path = "C:/Users/PRIVATE/source.mjs"; },
    (s: any) => { s.harness.paceMs = 120001; },
    (s: any) => { s.harness.fixtures = []; },
    (s: any) => { s.harness.workerPreparation.status = "running"; },
    (s: any) => { s.harness.receiptTag = "PRIVATE/path"; },
  ];
  for (const change of mutate) { const state = controlledFixture(); change(state); assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", state)); }
});

test("Kiro evidence drops arbitrary private fields from allowlisted recovery metadata", () => {
  const state = controlledFixture(), secret = "PRIVATE-METADATA";
  state.harness.secret = secret; state.harness.sourceHashes[0].secret = secret; state.harness.fixtures[0].secret = secret;
  state.harness.workerPreparation.secret = secret; state.turns[0].format.secret = secret;
  state.turns[0].receipt.secret = secret; state.turns[0].messageIds[0].secret = secret;
  state.driverFailure = { category: "PRIVATE-CATEGORY", label: secret, error: secret, receipt: { secret } };
  const before = structuredClone(state), evidence = summarizeMatrixState("claude-sonnet-4.5", state);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE-METADATA|PRIVATE-CATEGORY|PRIVATE-INPUT-|PRIVATE-RELOAD-ID/);
  assert.deepEqual(evidence.observerFailure, { category: "other-harness-failure", label: null });
  assert.deepEqual(state, before);
});

test("Kiro evidence rejects a checked failed run, unordered schedule, and duplicate supplemental runs", () => {
  const failed = fixture(); failed.turns[0].run.status = "failed";
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", failed), /semantic check/);
  const unordered = fixture(); [unordered.turns[0], unordered.turns[1]] = [unordered.turns[1], unordered.turns[0]];
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", unordered), /ordered/);
  const states = Object.fromEntries(matrixModels.map((id: string) => [id, fixture(id)]));
  const duplicate = structuredClone(states.auto.turns[0]); duplicate.label = "supplemental-duplicate"; states.auto.turns.push(duplicate);
  assert.throws(() => buildMatrixEvidence(states), /counted twice/);
});

test("Kiro evidence rejects missing or mislabeled controlled format observations", () => {
  const missing = controlledFixture(); delete missing.turns[0].format;
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", missing), /format observation/);
  const wrong = controlledFixture(); wrong.turns[0].format.kind = "json-only";
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", wrong), /format observation/);
});

test("Kiro evidence rejects a completed run carrying an error instead of publishing a protocol pass", () => {
  const state: any = fixture();
  state.turns[0].run.error = "PRIVATE-ERROR HTTP 429";
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", state), /Completed live run carries an error/);
});

test("Kiro evidence accepts only numeric thinking lengths and finite nonnegative durations", () => {
  for (const [field, values] of [
    ["thinkingLength", ["PRIVATE-THOUGHT", {}, -1, 0.5, Infinity]],
    ["observedMs", ["PRIVATE-DURATION", {}, -1, Infinity, NaN]],
  ] as const) {
    for (const value of values) {
      const state: any = fixture(); state.turns[0][field] = value;
      assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", state), /Invalid thinking length|Invalid observed duration/);
    }
  }
  const state: any = fixture(); state.turns[0].thinkingLength = 0; state.turns[0].observedMs = null;
  const evidence = summarizeMatrixState("claude-sonnet-4.5", state);
  assert.equal(evidence.rounds[0].thinkingLength, 0); assert.equal(evidence.rounds[0].observedMs, null);
});

test("Kiro evidence allowlists tool-result statuses and counts only actual image arrays", () => {
  for (const status of ["PRIVATE-STATUS", { secret: "PRIVATE-STATUS" }]) {
    const state: any = fixture(); state.turns[0].results = [{ callId: "tool", toolName: "read", status }];
    assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", state), /Invalid tool result status/);
  }
  const invalid: any = fixture(); invalid.turns[0].results = [{ callId: "tool", toolName: "read", status: "completed", images: "PRIVATE-IMAGE" }];
  assert.throws(() => summarizeMatrixState("claude-sonnet-4.5", invalid), /Invalid tool result image/);
  for (const status of ["completed", "failed", "cancelled", null]) {
    const state: any = fixture(); state.turns[0].results = [{ callId: "tool", toolName: "read", status, images: [{}] }];
    const result = summarizeMatrixState("claude-sonnet-4.5", state).rounds[0].results[0];
    assert.equal(result.status, status); assert.equal(result.returnedImageCount, 1);
  }
});
