// Read-only, content-minimized confirmation that a live AXIOM worker loaded the fix.
// No credentials, provider payloads, or thinking text are read out or published.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, basename } from 'node:path';

const state = JSON.parse(readFileSync(resolve(process.argv[2] ?? '../test-results/kiro-long-session/state.json'), 'utf8'));
const out = resolve(process.argv[3] ?? '../test-results/kiro-long-session/native-history-proof.json');
const root = join(process.env.APPDATA, 'Axiom2');
const db = new DatabaseSync(join(root, 'axiom.sqlite'), { readOnly: true });
let file;
try { file = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get(state.sessionId)?.file; } finally { db.close(); }
assert.equal(typeof file, 'string');
assert.ok(resolve(file).startsWith(resolve(root, 'sessions', state.workspaceId) + '\\'), 'Read only the chosen task transcript');
const entries = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const records = entries.filter(e => e.type === 'message' && e.message?.role === 'assistant' && e.message.provider === 'kiro').map(e => {
  const m = e.message, blocks = m.content ?? [], text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
  return {
    id: e.id, timestamp: m.timestamp, model: m.model, stopReason: m.stopReason,
    thinkingLevel: m.thinkingLevel, providerThinkingLevel: m.providerThinkingLevel,
    localThinkingBlocks: blocks.filter(b => b.type === 'thinking').length,
    answerHasPriorReasoningWrapper: text.includes('<axiom_prior_reasoning>'),
    answerSha256: createHash('sha256').update(text).digest('hex'),
    diagnostics: (m.diagnostics ?? []).filter(d => d.type === 'kiro-reasoning-history-omitted' || d.type === 'kiro-reasoning-history').map(d => ({
      type: d.type, timestamp: d.timestamp, omittedReasoningTextBlocks: d.details?.omittedReasoningTextBlocks,
      opaqueReasoningBlocks: d.details?.opaqueReasoningBlocks, omittedSignatures: d.details?.omittedSignatures,
    })),
  };
});
const files = ['dist/server/providers/kiro-chat.js', 'dist/server/providers/kiro-chat-protocol.js', 'scripts/kiro-live-check.mjs'].map(path => ({
  path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), builtAt: statSync(path).mtime.toISOString(),
}));
const proof = { sessionId: state.sessionId, taskRef: state.taskRef, transcript: basename(file), extractedAt: new Date().toISOString(), files, records };
writeFileSync(out, JSON.stringify(proof, null, 2) + '\n');
assert.ok(records.some(r => r.diagnostics.some(d => d.type === 'kiro-reasoning-history-omitted' && d.omittedReasoningTextBlocks > 0)), 'Live native transcript must contain the NEW omission diagnostic');
console.log(JSON.stringify({ output: out, responses: records.length, fixedResponses: records.filter(r => r.diagnostics.some(d => d.type === 'kiro-reasoning-history-omitted')).length, final: records.at(-1) }, null, 2));
