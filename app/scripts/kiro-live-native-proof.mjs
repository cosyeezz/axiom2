// Read-only, content-minimized confirmation that a live AXIOM worker loaded the fix.
// No credentials, provider payloads, or thinking text are read out or published.
// The local output still includes session/transcript metadata; curate it before publication.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, basename, sep } from 'node:path';

const cli = process.argv.slice(2), args = [], options = new Map();
for (let i = 0; i < cli.length; i++) {
  const value = cli[i];
  if (value === '--expect-interrupted-tools') continue;
  if (['--run-id', '--message-id', '--answer-sha256'].includes(value)) {
    assert.ok(cli[i + 1] && !cli[i + 1].startsWith('--'), `Pass a value for ${value}`);
    assert.equal(options.has(value), false, `Do not repeat ${value}`); options.set(value, cli[++i]);
  } else { assert.equal(value.startsWith('--'), false, 'Unknown proof option'); args.push(value); }
}
assert.ok(args.length <= 2, 'Pass only state and output positional paths');
const runId = options.get('--run-id'), messageId = options.get('--message-id'), answerHash = options.get('--answer-sha256');
assert.ok(!messageId || runId, 'Bind an AXIOM message to its run, not only an answer hash');
assert.ok(!answerHash || runId, 'Bind the expected answer hash to a specific AXIOM run');
assert.ok(!answerHash || /^[a-f0-9]{64}$/.test(answerHash), 'Invalid expected SHA-256');
const state = JSON.parse(readFileSync(resolve(args[0] ?? '../test-results/kiro-long-session/state.json'), 'utf8'));
const out = resolve(args[1] ?? '../test-results/kiro-long-session/native-history-proof.json');
const root = join(process.env.APPDATA, 'Axiom2');
const db = new DatabaseSync(join(root, 'axiom.sqlite'), { readOnly: true });
let file;
try { file = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get(state.sessionId)?.file; } finally { db.close(); }
assert.equal(typeof file, 'string');
assert.ok(resolve(file).startsWith(resolve(root, 'sessions', state.workspaceId) + sep), 'Read only the chosen task transcript');
const entries = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const records = entries.filter(e => e.type === 'message' && e.message?.role === 'assistant' && e.message.provider === 'kiro').map(e => {
  const m = e.message, blocks = m.content ?? [], text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
  return {
    id: e.id, axiomRunId: m.axiomRunId ?? null, axiomId: m.axiomId ?? null,
    timestamp: m.timestamp, model: m.model, stopReason: m.stopReason,
    thinkingLevel: m.thinkingLevel, providerThinkingLevel: m.providerThinkingLevel,
    localThinkingBlocks: blocks.filter(b => b.type === 'thinking').length,
    answerHasPriorReasoningWrapper: text.includes('<axiom_prior_reasoning>'),
    answerSha256: createHash('sha256').update(text).digest('hex'),
    diagnostics: (m.diagnostics ?? []).filter(d => ['kiro-reasoning-history-omitted', 'kiro-reasoning-history', 'kiro-interrupted-tools-omitted'].includes(d.type)).map(d => ({
      type: d.type, timestamp: d.timestamp, omittedReasoningTextBlocks: d.details?.omittedReasoningTextBlocks,
      opaqueReasoningBlocks: d.details?.opaqueReasoningBlocks, omittedSignatures: d.details?.omittedSignatures,
      ...(d.type === 'kiro-interrupted-tools-omitted' ? { omittedToolCalls: d.details?.omittedToolCalls } : {}),
    })),
  };
});
const selected = records.filter(r => (!runId || r.axiomRunId === runId) && (!messageId || r.axiomId === messageId));
assert.ok(selected.length, 'No native assistant matches the selected AXIOM identity');
if (messageId || answerHash) assert.equal(selected.length, 1, 'The selected native assistant identity must be unique');
if (answerHash) assert.equal(selected[0].answerSha256, answerHash, 'The selected run/message must contain the expected answer');
assert.ok(selected.some(r => r.diagnostics.some(d => d.type === 'kiro-reasoning-history-omitted' && d.omittedReasoningTextBlocks > 0)), 'Selected native responses must contain the NEW omission diagnostic');
if (cli.includes('--expect-interrupted-tools')) assert.ok(selected.some(r => r.diagnostics.some(d => d.type === 'kiro-interrupted-tools-omitted' && d.omittedToolCalls > 0)), 'Selected native responses must prove interrupted-tool cleanup was loaded');
const files = ['dist/server/providers/kiro-chat.js', 'dist/server/providers/kiro-chat-protocol.js', 'scripts/kiro-live-check.mjs', 'scripts/kiro-live-plan.mjs', 'scripts/kiro-live-lifecycle.mjs', 'scripts/kiro-live-native-proof.mjs'].map(path => ({
  path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), builtAt: statSync(path).mtime.toISOString(),
}));
const proof = { sessionId: state.sessionId, taskRef: state.taskRef, transcript: basename(file), extractedAt: new Date().toISOString(), files,
  scope: { axiomRunId: runId ?? null, axiomId: messageId ?? null, expectedAnswerSha256: answerHash ?? null }, selectedRecordIds: selected.map(r => r.id), records };
writeFileSync(out, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: out, responses: records.length, selectedResponses: selected.length,
  fixedResponses: selected.filter(r => r.diagnostics.some(d => d.type === 'kiro-reasoning-history-omitted')).length, final: selected.at(-1) }, null, 2));
