// Content-minimized curator for the opt-in AXIOM live acceptance drivers.
// Reads only their local evidence files; never contacts AXIOM or a model endpoint.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const matrixModels = ['auto', 'claude-sonnet-4.5', 'claude-haiku-4.5', 'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'];
export const matrixLabels = [
  'seed', 'read', 'reasoning', 'error-recovery', 'off-memory', 'large-attachment', 'delayed-memory', 'two-reads', 'state-update', 'write-read',
  'INPUT_VARIANT', 'follow-up', 'TOOL_VARIANT', 'history-recall', 'second-attachment', 'grade-memory', 'shell-recovery', 'unicode', 'final-ledger', 'checksum',
].map((name, i) => `long-${String(i + 1).padStart(2, '0')}-${name}`);
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high']);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex');
const safeTools = new Set(['read', 'write', 'edit', 'powershell']);
const toolName = value => safeTools.has(String(value).replace(/^functions\./, '')) ? String(value).replace(/^functions\./, '') : 'other';
const metadata = items => (items ?? []).map(item => ({
  // No text/base64, local absolute paths, or unknown extension fields.
  bytes: Number.isSafeInteger(item.bytes) ? item.bytes : null,
  sha256: typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256) ? item.sha256 : null,
}));

function expectedLabels(modelId) {
  const vision = ['auto', 'claude-sonnet-4.5', 'claude-haiku-4.5'].includes(modelId);
  return matrixLabels.map(label => label.replace('INPUT_VARIANT', vision ? 'user-image' : 'text-table').replace('TOOL_VARIANT', vision ? 'tool-image' : 'code-review'));
}
function grade(modelId, index) {
  if (!modelId.startsWith('claude-')) return 'off';
  return index < 4 ? 'high' : index < 8 ? 'off' : index < 11 ? 'minimal' : index < 15 ? 'low' : index < 18 ? 'medium' : 'high';
}
function failureCategory(label, error) {
  // AssertionError.message may include the entire offending answer, including a
  // leaked thinking wrapper. Classify it without ever copying that message.
  if (String(error).includes('axiom_prior_reasoning')) return 'prior-reasoning-wrapper';
  if (String(error).includes('Expected actual') || String(error).includes('real tool result') || String(error).includes('Tool must actually')) return 'required-real-tool-evidence';
  if (label === 'long-18-unicode') return 'strict-json-or-literal-escaping';
  return 'semantic-assertion';
}
function curateTurn(turn, check) {
  assert.ok(turn && typeof turn.label === 'string' && turn.run && typeof turn.answer === 'string', 'Incomplete live turn record');
  const run = turn.run;
  assert.ok(typeof run.id === 'string' && run.id.length <= 128, 'Missing live run ID');
  assert.ok(run.selection?.provider === 'kiro' && matrixModels.includes(run.selection.id) && levels.has(run.selection.thinking), 'Invalid actual run selection');
  const messageIds = turn.messageIds ?? [];
  assert.ok(messageIds.length && messageIds.every(m => m.runId === run.id) && messageIds.some(m => m.role === 'assistant'), 'Messages do not correlate to the live run');
  const calls = (turn.calls ?? []).map(call => ({ name: toolName(call.name), callIdSha256: hash(call.id), argumentsSha256: hash(call.input) }));
  const results = (turn.results ?? []).map(result => ({
    name: toolName(result.toolName), callIdSha256: hash(result.callId), status: result.status,
    hasError: !!result.error, textSha256: hash(result.text), returnedImageCount: result.images?.length ?? 0,
  }));
  const resultIds = new Set(results.map(result => result.callIdSha256));
  return {
    label: turn.label, runId: run.id, selection: { provider: 'kiro', id: run.selection.id, thinking: run.selection.thinking }, status: run.status,
    answerSha256: hash(turn.answer), answerHasPriorReasoningWrapper: turn.answer.includes('<axiom_prior_reasoning>'),
    thinkingLength: turn.thinkingLength ?? 0, observedMs: turn.observedMs ?? null,
    promptImages: metadata(turn.promptImages), attachments: metadata(turn.attachments), calls, results,
    unmatchedCallCount: calls.filter(call => !resultIds.has(call.callIdSha256)).length,
    semanticCheck: check ? { passed: check.passed, ...(!check.passed ? { category: failureCategory(turn.label, check.error), errorSha256: hash(check.error) } : {}) } : null,
  };
}

export function summarizeMatrixState(modelId, state, { allowIncomplete = false } = {}) {
  assert.ok(matrixModels.includes(modelId), 'Unknown matrix model');
  assert.ok(typeof state.sessionId === 'string' && state.sessionId && typeof state.taskRef === 'string' && state.taskRef, 'Missing dedicated task identity');
  const labels = expectedLabels(modelId), expected = new Set(labels), allTurns = state.turns ?? [];
  const turns = allTurns.filter(turn => expected.has(turn.label));
  assert.ok(new Set(turns.map(turn => turn.label)).size === turns.length, 'Repeated matrix labels; do not silently merge reruns');
  const checks = state.checks ?? [];
  assert.ok(new Set(checks.map(check => check.label)).size === checks.length && checks.every(check => expected.has(check.label) && typeof check.passed === 'boolean'), 'Invalid semantic check records');
  const complete = !!state.completedAt && turns.length === 20 && checks.length === 20;
  assert.ok(allowIncomplete || complete, 'Matrix is unfinished; do not publish a final matrix yet');
  const rounds = turns.map(turn => {
    const index = labels.indexOf(turn.label);
    assert.ok(turn.run?.selection?.id === modelId && turn.run?.selection?.thinking === grade(modelId, index), 'Actual selection differs from the matrix schedule');
    return curateTurn(turn, checks.find(check => check.label === turn.label));
  });
  const failedChecks = checks.filter(check => !check.passed).length;
  if (complete) {
    assert.ok(state.longSessionPassed === (failedChecks === 0), 'Stored matrix result disagrees with its semantic checks');
    assert.ok(Array.isArray(state.checkFailures) && state.checkFailures.length === failedChecks && state.checkFailures.every(failure => checks.some(check => check.label === failure.label && !check.passed)), 'Stored failures disagree with semantic checks');
  }
  return {
    model: modelId, taskRef: state.taskRef, sessionIdSha256: hash(state.sessionId), complete, matrixRoundCount: rounds.length, protocolCompleted: complete && rounds.every(round => round.status === 'completed'),
    semanticPassed: complete && failedChecks === 0, semanticFailureCount: failedChecks,
    defaultsUnchangedVerifiedByDriver: complete, completedAt: complete ? state.completedAt : null,
    rounds, supplementalTurns: allTurns.filter(turn => !expected.has(turn.label)).map(turn => curateTurn(turn)),
  };
}

export function buildMatrixEvidence(states, options = {}) {
  assert.ok(states && typeof states === 'object', 'Supply the eight dedicated model states');
  const identities = matrixModels.map(id => states[id]?.sessionId);
  assert.ok(new Set(identities).size === matrixModels.length, 'Each model needs its own registered task session');
  const models = matrixModels.map(id => {
    assert.ok(states[id], 'A required dedicated model state is missing');
    return summarizeMatrixState(id, states[id], options);
  });
  const runIds = models.flatMap(model => model.rounds.map(round => round.runId));
  assert.ok(new Set(runIds).size === runIds.length, 'Live runs must not be counted twice');
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), transport: 'AXIOM /ws -> registered task -> worker -> kiro-chat',
    contentPolicy: 'No prompts, answers, hidden thinking, signatures, tool arguments/results, credentials, or local transcript paths. Only metadata, assertions, and SHA-256 digests.',
    complete: models.every(model => model.complete), allProtocolsCompleted: models.every(model => model.protocolCompleted),
    allSemanticChecksPassed: models.every(model => model.semanticPassed),
    modelCount: models.length, matrixRoundCount: models.reduce((sum, model) => sum + model.matrixRoundCount, 0), models,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const root = resolve(option('--input-root', '../test-results/kiro-long-session/matrix'));
  const output = resolve(option('--output', '../docs/evidence/kiro-long-session/matrix.json'));
  const states = Object.fromEntries(matrixModels.map(id => [id, JSON.parse(readFileSync(resolve(root, id, 'state.json'), 'utf8'))]));
  const evidence = buildMatrixEvidence(states, { allowIncomplete: args.includes('--allow-incomplete') });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  // Exit 0 means a valid evidence export, not that semantic acceptance passed.
  console.log(JSON.stringify({ output, complete: evidence.complete, allProtocolsCompleted: evidence.allProtocolsCompleted,
    allSemanticChecksPassed: evidence.allSemanticChecksPassed, models: evidence.modelCount, rounds: evidence.matrixRoundCount }, null, 2));
}
