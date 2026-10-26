// Content-minimized curator. Local files only; never contacts AXIOM/models.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const matrixModels = ['auto', 'claude-sonnet-4.5', 'claude-haiku-4.5', 'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next'];
export const recoveryModels = matrixModels.filter(id => id !== 'auto');
export const matrixLabels = [
  'seed', 'read', 'reasoning', 'error-recovery', 'off-memory', 'large-attachment', 'delayed-memory', 'two-reads', 'state-update', 'write-read',
  'INPUT_VARIANT', 'follow-up', 'TOOL_VARIANT', 'history-recall', 'second-attachment', 'grade-memory', 'shell-recovery', 'unicode', 'final-ledger', 'checksum',
].map((name, i) => `long-${String(i + 1).padStart(2, '0')}-${name}`);
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high']);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeTools = new Set(['read', 'write', 'edit', 'powershell']);
const safeResultStatuses = new Set(['completed', 'failed', 'cancelled']);
const toolName = value => safeTools.has(String(value).replace(/^functions\./, '')) ? String(value).replace(/^functions\./, '') : 'other';
const metadata = items => (items ?? []).map(item => ({ bytes: Number.isSafeInteger(item.bytes) ? item.bytes : null, sha256: isHash(item.sha256) ? item.sha256 : null }));
const isoDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ? value : null;

function expectedLabels(modelId) {
  const vision = ['auto', 'claude-sonnet-4.5', 'claude-haiku-4.5'].includes(modelId);
  return matrixLabels.map(label => label.replace('INPUT_VARIANT', vision ? 'user-image' : 'text-table').replace('TOOL_VARIANT', vision ? 'tool-image' : 'code-review'));
}
function grade(modelId, index) {
  if (!modelId.startsWith('claude-')) return 'off';
  return index < 4 ? 'high' : index < 8 ? 'off' : index < 11 ? 'minimal' : index < 15 ? 'low' : index < 18 ? 'medium' : 'high';
}
function failureCategory(label, error) {
  // Assertion messages can contain leaked thinking. Never publish their text.
  if (String(error).includes('axiom_prior_reasoning')) return 'prior-reasoning-wrapper';
  if (/Expected actual|real tool result|Tool must actually|paired result|call IDs|result IDs|prohibits tools|tool results|read must follow|Unexpected tool/.test(String(error))) return 'required-real-tool-evidence';
  if (label === 'long-18-unicode') return 'strict-json-or-literal-escaping';
  return 'semantic-assertion';
}
function protocolError(run) {
  if (run.status === 'completed' && !run.error) return null;
  const error = typeof run.error === 'string' ? run.error : JSON.stringify(run.error ?? '');
  const category = /HTTP\s*429/i.test(error) ? 'upstream-rate-or-quota-429'
    : run.status === 'cancelled' ? 'cancelled'
    : /未完成的工具结果|unpaired|orphan.*tool/i.test(error) ? 'unpaired-tool-history'
    : /超时|timeout|timed out/i.test(error) ? 'timeout'
    : /格式|Schema|JSON|协议|截断|stream/i.test(error) ? 'protocol-or-stream-validation'
    : 'other-run-failure';
  return { category, errorSha256: hash(run.error) };
}
function curateHarness(state) {
  const h = state.harness;
  if (!h) return { version: 'v1', inferredLegacy: true, controlledPrompts: false, promptCorrelation: 'new-terminal-run', paceMs: null };
  assert.ok(['v1', 'v2-controlled'].includes(h.version), 'Unknown harness version');
  const controlled = h.version === 'v2-controlled';
  assert.equal(h.controlledPrompts, controlled, 'Harness conditions disagree');
  assert.ok(Number.isSafeInteger(h.paceMs) && h.paceMs >= 0 && h.paceMs <= 120000, 'Invalid harness pacing');
  assert.ok(typeof h.receiptTag === 'string' && (!h.receiptTag || /^[a-z0-9][a-z0-9-]{0,39}$/.test(h.receiptTag)), 'Invalid receipt tag');
  assert.equal(h.promptCorrelation, controlled ? 'receipt-inputIds-and-matching-user-text' : 'new-terminal-run', 'Unknown input correlation policy');
  if (controlled) assert.ok(h.receiptTag, 'Controlled recovery needs an independent receipt tag');
  const sources = ['app/scripts/kiro-live-check.mjs', 'app/scripts/kiro-live-plan.mjs'];
  assert.ok(Array.isArray(h.sourceHashes) && h.sourceHashes.length === 2 && new Set(h.sourceHashes.map(x => x.path)).size === 2 && h.sourceHashes.every(x => sources.includes(x.path) && isHash(x.sha256)), 'Invalid harness source identities');
  const fixtures = h.fixtures ?? [];
  const fixtureNames = ['inventory.csv', 'ledger.json', 'visual-a.png', 'visual-b.png'];
  assert.ok(fixtures.every(x => fixtureNames.includes(x.name) && Number.isSafeInteger(x.bytes) && x.bytes > 0 && isHash(x.sha256)), 'Invalid fixture metadata');
  if (controlled) assert.ok(['inventory.csv', 'ledger.json'].every(name => fixtures.some(x => x.name === name)), 'Missing controlled fixture identities');
  let workerPreparation = null;
  if (h.workerPreparation) {
    const w = h.workerPreparation;
    assert.ok(w.strategy === 'intermediate-profile-cold-reload' && w.status === 'completed' && w.modelMessagesUnchanged === true && typeof w.reloadId === 'string', 'Unverified worker preparation');
    workerPreparation = { strategy: w.strategy, status: 'completed', modelMessagesUnchanged: true, reloadIdSha256: hash(w.reloadId) };
  }
  return { version: h.version, inferredLegacy: false, controlledPrompts: controlled, paceMs: h.paceMs, receiptTag: h.receiptTag,
    promptCorrelation: h.promptCorrelation, sourceHashes: h.sourceHashes.map(x => ({ path: x.path, sha256: x.sha256 })),
    fixtures: fixtures.map(x => ({ name: x.name, bytes: x.bytes, sha256: x.sha256 })), workerPreparation };
}
function curateTurn(turn, check, { controlled = false, taskId } = {}) {
  assert.ok(turn && typeof turn.label === 'string' && turn.run && typeof turn.answer === 'string', 'Incomplete live turn record');
  const run = turn.run;
  assert.ok(typeof run.id === 'string' && run.id.length <= 128, 'Missing live run ID');
  assert.ok(['completed', 'failed', 'cancelled'].includes(run.status), 'Live turn is not terminal');
  assert.ok(run.status !== 'completed' || run.error == null || run.error === '', 'Completed live run carries an error');
  const thinkingLength = turn.thinkingLength ?? 0, observedMs = turn.observedMs ?? null;
  assert.ok(Number.isSafeInteger(thinkingLength) && thinkingLength >= 0, 'Invalid thinking length metadata');
  assert.ok(observedMs === null || (typeof observedMs === 'number' && Number.isFinite(observedMs) && observedMs >= 0), 'Invalid observed duration metadata');
  assert.ok(run.selection?.provider === 'kiro' && matrixModels.includes(run.selection.id) && levels.has(run.selection.thinking), 'Invalid actual run selection');
  const messageIds = turn.messageIds ?? [];
  assert.ok(messageIds.length && messageIds.every(m => m.runId === run.id) && messageIds.some(m => m.role === 'assistant'), 'Messages do not correlate to the live run');
  let promptCorrelation = null;
  if (controlled) {
    const receipt = turn.receipt, users = messageIds.filter(m => m.role === 'user' && m.inputIds?.includes(receipt?.inputId));
    assert.ok(typeof taskId === 'string' && taskId && receipt?.taskId === taskId && typeof receipt.inputId === 'string' && receipt.inputId, 'Missing owned task input receipt');
    assert.ok(turn.inputCorrelated === true && users.length === 1 && users[0].inputIds.length === 1 && (!receipt.runId || receipt.runId === run.id), 'Input receipt does not correlate to one unmerged user/run');
    promptCorrelation = { inputIdSha256: hash(receipt.inputId), inputIdentityMatchedInEvidence: true, fullUserTextVerifiedByDriver: true };
  }
  let format = null;
  if (turn.format) {
    const kind = ['long-01-seed', 'long-20-checksum'].includes(turn.label) ? 'one-line' : turn.label === 'long-17-shell-recovery' ? 'prefix-json' : 'json-only';
    assert.ok(turn.format.kind === kind && typeof turn.format.complied === 'boolean', 'Invalid format observation');
    format = { kind, complied: turn.format.complied };
  }
  if (controlled && run.status === 'completed') assert.ok(format, 'Missing controlled format observation');
  const calls = (turn.calls ?? []).map(call => ({ name: toolName(call.name), callIdSha256: hash(call.id), argumentsSha256: hash(call.input) }));
  const results = (turn.results ?? []).map(result => {
    assert.ok(result.status == null || safeResultStatuses.has(result.status), 'Invalid tool result status metadata');
    assert.ok(result.images == null || Array.isArray(result.images), 'Invalid tool result image metadata');
    return { name: toolName(result.toolName), callIdSha256: hash(result.callId), status: result.status ?? null,
      hasError: !!result.error, textSha256: hash(result.text), returnedImageCount: result.images?.length ?? 0 };
  });
  const resultIds = new Set(results.map(result => result.callIdSha256));
  return { label: turn.label, runId: run.id, selection: { provider: 'kiro', id: run.selection.id, thinking: run.selection.thinking }, status: run.status,
    protocolError: protocolError(run), answerSha256: hash(turn.answer), answerHasPriorReasoningWrapper: turn.answer.includes('<axiom_prior_reasoning>'),
    thinkingLength, observedMs, promptCorrelation, format,
    promptImages: metadata(turn.promptImages), attachments: metadata(turn.attachments), calls, results,
    unmatchedCallCount: calls.filter(call => !resultIds.has(call.callIdSha256)).length,
    semanticCheck: check ? { passed: check.passed, ...(!check.passed ? { category: failureCategory(turn.label, check.error), errorSha256: hash(check.error) } : {}) } : null };
}

export function summarizeMatrixState(modelId, state, { allowIncomplete = false, requireControlled = false } = {}) {
  assert.ok(matrixModels.includes(modelId), 'Unknown matrix model');
  assert.ok(typeof state.sessionId === 'string' && state.sessionId && typeof state.taskRef === 'string' && state.taskRef, 'Missing dedicated task identity');
  const harness = curateHarness(state);
  assert.ok(!requireControlled || harness.version === 'v2-controlled', 'Recovery evidence requires controlled v2 harness records');
  const labels = expectedLabels(modelId), expected = new Set(labels), allTurns = state.turns ?? [];
  const turns = allTurns.filter(turn => expected.has(turn.label));
  assert.ok(new Set(turns.map(turn => turn.label)).size === turns.length, 'Repeated matrix labels; do not silently merge reruns');
  assert.ok(turns.every((turn, i) => turn.label === labels[i]), 'Matrix rounds must be an ordered schedule prefix');
  const checks = state.checks ?? [];
  assert.ok(new Set(checks.map(check => check.label)).size === checks.length && checks.every(check => turns.some(turn => turn.label === check.label && turn.run?.status === 'completed') && typeof check.passed === 'boolean'), 'Invalid semantic check records');
  const complete = !!state.completedAt && turns.length === 20 && checks.length === 20;
  assert.ok(allowIncomplete || complete, 'Matrix is unfinished; do not publish a final matrix yet');
  const rounds = turns.map(turn => {
    const index = labels.indexOf(turn.label);
    assert.ok(turn.run?.selection?.id === modelId && turn.run?.selection?.thinking === grade(modelId, index), 'Actual selection differs from the matrix schedule');
    return curateTurn(turn, checks.find(check => check.label === turn.label), { controlled: harness.controlledPrompts, taskId: state.taskId });
  });
  const failedChecks = checks.filter(check => !check.passed).length;
  if (complete) {
    assert.ok(state.longSessionPassed === (failedChecks === 0), 'Stored matrix result disagrees with its semantic checks');
    assert.ok(Array.isArray(state.checkFailures) && state.checkFailures.length === failedChecks && new Set(state.checkFailures.map(f => f.label)).size === failedChecks && state.checkFailures.every(failure => checks.some(check => check.label === failure.label && !check.passed)), 'Stored failures disagree with semantic checks');
  }
  const formats = rounds.filter(round => round.format);
  return { model: modelId, taskRef: state.taskRef, sessionIdSha256: hash(state.sessionId), harness, complete, matrixRoundCount: rounds.length,
    protocolCompleted: complete && rounds.every(round => round.status === 'completed'),
    protocolCompletedRoundCount: rounds.filter(round => round.status === 'completed').length,
    protocolFailureRoundCount: rounds.filter(round => round.status !== 'completed').length,
    rateLimitedRoundCount: rounds.filter(round => round.protocolError?.category === 'upstream-rate-or-quota-429').length,
    semanticPassed: complete && failedChecks === 0, semanticFailureCount: failedChecks,
    checkedRoundCount: checks.length, uncheckedRoundCount: rounds.filter(round => !round.semanticCheck).length,
    formatCheckedRoundCount: formats.length, formatFailureCount: formats.filter(round => !round.format.complied).length,
    formatPassed: formats.length ? complete && formats.length === 20 && formats.every(round => round.format.complied) : null,
    defaultsUnchangedVerifiedByDriver: complete, completedAt: complete ? isoDate(state.completedAt) : null,
    observerFailure: state.driverFailure ? { category: state.driverFailure.category === 'run-observation-timeout' ? 'run-observation-timeout' : 'other-harness-failure', label: expected.has(state.driverFailure.label) ? state.driverFailure.label : null } : null,
    rounds, supplementalTurns: allTurns.filter(turn => !expected.has(turn.label)).map(turn => curateTurn(turn)) };
}
function buildEvidence(states, ids, phase, options) {
  assert.ok(states && typeof states === 'object', 'Supply the dedicated model states');
  const identities = ids.map(id => states[id]?.sessionId);
  assert.ok(identities.every(Boolean) && new Set(identities).size === ids.length, 'Each model needs its own registered task session');
  const models = ids.map(id => summarizeMatrixState(id, states[id], options));
  const runIds = models.flatMap(model => [...model.rounds, ...model.supplementalTurns].map(round => round.runId));
  assert.ok(new Set(runIds).size === runIds.length, 'Live runs must not be counted twice');
  return { schemaVersion: 2, phase, generatedAt: new Date().toISOString(), transport: 'AXIOM /ws -> registered task -> worker -> kiro-chat',
    contentPolicy: 'No prompts, answers, hidden thinking, signatures, tool arguments/results, credentials, or local transcript paths. Only allowlisted metadata, assertions, and SHA-256 digests.',
    complete: models.every(model => model.complete), allProtocolsCompleted: models.every(model => model.protocolCompleted),
    allSemanticChecksPassed: models.every(model => model.semanticPassed),
    allFormatChecksPassed: models.every(model => model.formatPassed === null) ? null : models.every(model => model.formatPassed === true),
    modelCount: models.length, matrixRoundCount: models.reduce((sum, model) => sum + model.matrixRoundCount, 0), models };
}
export function buildMatrixEvidence(states, options = {}) { return buildEvidence(states, matrixModels, 'original-matrix', options); }
export function buildRecoveryEvidence(states, options = {}) { return buildEvidence(states, recoveryModels, 'controlled-recovery', { ...options, requireControlled: true }); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const values = new Set(['--input-root', '--output']), booleans = new Set(['--recovery', '--allow-incomplete']), options = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    assert.ok(values.has(flag) || booleans.has(flag), `Unknown option: ${flag}`);
    assert.ok(!options.has(flag), `Duplicate option: ${flag}`);
    if (booleans.has(flag)) { options.set(flag, true); continue; }
    const value = args[++i];
    assert.ok(typeof value === 'string' && value.trim() && !value.startsWith('--'), `Pass a value for ${flag}`);
    options.set(flag, value);
  }
  const option = (name, fallback) => options.has(name) ? options.get(name) : fallback;
  const recovery = options.has('--recovery');
  const root = resolve(option('--input-root', `../test-results/kiro-long-session/${recovery ? 'recovery' : 'matrix'}`));
  const output = resolve(option('--output', `../docs/evidence/kiro-long-session/${recovery ? 'recovery' : 'matrix'}.json`));
  const states = Object.fromEntries((recovery ? recoveryModels : matrixModels).map(id => [id, JSON.parse(readFileSync(resolve(root, id, 'state.json'), 'utf8'))]));
  const evidence = (recovery ? buildRecoveryEvidence : buildMatrixEvidence)(states, { allowIncomplete: options.has('--allow-incomplete') });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  // Exit 0 validates the export, never implies semantic/format acceptance.
  console.log(JSON.stringify({ output, complete: evidence.complete, allProtocolsCompleted: evidence.allProtocolsCompleted,
    allSemanticChecksPassed: evidence.allSemanticChecksPassed, allFormatChecksPassed: evidence.allFormatChecksPassed, models: evidence.modelCount, rounds: evidence.matrixRoundCount }, null, 2));
}
