// Read-only posthoc observation. No prompt, selection change, or raw state rewrite.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { assertControlledTools } from '../../app/scripts/kiro-live-plan.mjs';
const { WebSocket } = createRequire(new URL('../../app/package.json', import.meta.url))('ws');
const file = new URL('./matrix/minimax-m2.1/state.json', import.meta.url);
const before = readFileSync(file), state = JSON.parse(before);
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(state.taskRef, 't4018'); assert.equal(state.turns.length, 7);
const runId = 'a27dd2b7-769a-422d-961c-221eca8f80c6';
const db = new DatabaseSync(join(process.env.APPDATA, 'Axiom2', 'axiom.sqlite'), { readOnly: true });
let run, receipt;
try {
  const owner = db.prepare('SELECT workspaceId,parentSessionId FROM tasks WHERE id=? AND sessionId=?').get(state.taskId, state.sessionId);
  assert.equal(owner.workspaceId, state.workspaceId); assert.equal(owner.parentSessionId, state.parentSessionId);
  run = db.prepare('SELECT id,sessionId,status,selection,startedAt,endedAt FROM runs WHERE id=? AND sessionId=?').get(runId, state.sessionId);
  assert.ok(run); assert.equal(run.status, 'completed'); run.selection = JSON.parse(run.selection);
  assert.deepEqual(run.selection, { provider: 'kiro', id: 'minimax-m2.1', thinking: 'off' });
  const rows = db.prepare('SELECT inputId,taskId,runId,state FROM task_input_receipts WHERE taskId=? AND runId=?').all(state.taskId, runId);
  assert.equal(rows.length, 1); receipt = rows[0]; assert.equal(receipt.state, 'delivered');
} finally { db.close(); }
const origin = 'http://127.0.0.1:4317', scope = { workspaceId: state.workspaceId, sessionId: state.sessionId }, pending = new Map();
const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin } });
ws.on('message', data => {
  const m = JSON.parse(data);
  if (m.type === 'receipt') {
    const p = pending.get(m.requestId);
    if (p) { pending.delete(m.requestId); clearTimeout(p.timer); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error?.code ?? 'read-failed')); }
  }
});
async function call(op, params = {}) {
  const requestId = randomUUID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('read-only-timeout')); }, 15_000);
    pending.set(requestId, { resolve, reject, timer });
  });
  ws.send(JSON.stringify({ requestId, op, params, ...scope })); return result;
}
async function text(m) { return m.truncated || m.textLength > m.text.length ? (await call('message.part', { id: m.id, field: 'text' })).text : m.text; }
try {
  await once(ws, 'open');
  const messages = (await call('agent.original')).filter(m => m.runId === runId);
  const users = messages.filter(m => m.role === 'user'), assistants = messages.filter(m => m.role === 'assistant');
  assert.equal(users.length, 1); assert.deepEqual(users[0].inputIds, [receipt.inputId]);
  const root = 'F:/Axiom/axiom2/test-results/kiro-long-session/workspace';
  const expected = '必须实际用两个read分别读取 ' + root + '/inventory.csv 和 ' + root + '/ledger.json。检查两者导出的red/blue/green/total是否一致，用一行JSON回答。';
  assert.ok((await text(users[0])).includes(expected));
  const calls = assistants.flatMap(m => (m.calls ?? []).map(c => ({ ...c, messageId: m.id })));
  const results = await Promise.all(messages.filter(m => m.role === 'toolResult').map(async m => ({
    id: m.id, callId: m.toolCallId, toolName: m.toolName, status: m.status, error: m.error ?? null, text: await text(m), images: m.images ?? [],
  })));
  const answer = (await Promise.all(assistants.map(text))).filter(Boolean).join('\n');
  const record = { label: 'long-08-two-reads', calls, results, messageIds: messages.map(m => ({ id: m.id, role: m.role, runId: m.runId })) };
  assertControlledTools(record.label, record, { root, modelId: 'minimax-m2.1', receiptPath: root + '/matrix/minimax-m2.1/receipt.json' });
  assert.equal(calls.length, 2); assert.equal(results.length, 2);
  for (const number of [14, 28, 9, 51]) assert.ok(answer.includes(String(number)));
  assert.ok(!answer.includes('<axiom_prior_reasoning>'));
  assert.equal(hash(readFileSync(file)), hash(before));
  const output = {
    schemaVersion: 1, phase: 'posthoc-original-turn-observation', model: 'minimax-m2.1', taskRef: state.taskRef,
    label: record.label, runId, status: run.status, selection: run.selection,
    startedAt: new Date(run.startedAt).toISOString(), endedAt: new Date(run.endedAt).toISOString(), observedAt: new Date().toISOString(),
    promptCorrelation: { inputIdSha256: hash(receipt.inputId), singleUserInputMatched: true, actualCompletePromptMatchedAtPosthocObservation: true, durableReceiptDelivered: true },
    calls: calls.map(c => ({ name: c.name.replace(/^functions\./, ''), callIdSha256: hash(c.id), argumentsSha256: hash(c.input) })),
    results: results.map(r => ({ name: r.toolName.replace(/^functions\./, ''), callIdSha256: hash(r.callId), status: r.status, textSha256: hash(r.text), hasError: !!r.error })),
    answerSha256: hash(answer), checks: { originalLegacyRulePassed: true, actualTwoReadResultsPairedAndOrdered: true, actualCsvAndLedgerContentsMatched: true, originalRequiredInventoryNumbersPresent: true, noPriorReasoningWrapper: true },
    originalState: { sha256: hash(before), recordedRounds: 7, unchanged: true, runnerNormalExitCode: null },
    counting: { includedInInitial58Rounds: false, includedInControlledRecoveryRounds: false, retroactivelyWrittenIntoOriginalState: false, strictV2AnswerSchemaApplied: false },
    contentPolicy: 'No original prompt/answer, thinking, full tool input/output, local transcript path, session UUID or credentials.',
  };
  writeFileSync(new URL('../../docs/evidence/kiro-long-session/initial-minimax-m2.1-turn08-supplement.json', import.meta.url), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ supplementWritten: true, runId, readCalls: calls.length, pairedResults: results.length, originalStateUnchanged: true }));
} finally { for (const p of pending.values()) clearTimeout(p.timer); ws.close(); }
