// One-shot synthetic live06 controller. All received messages/transcripts stay in RAM.
// Only allowlisted assertions and owned IDs are printed. No automatic model retry.
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFile, open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../app/package.json', import.meta.url));
const WebSocket = require('ws');
const dir = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(homedir(), 'Library/Application Support/Axiom2/axiom.sqlite'), { readOnly: true });
const marker1 = 'AXIOM_KIRO_CONTINUATION_06_91e7a2c4', marker2 = 'AXIOM_KIRO_NEXT_RUN_06_6b4d29a1';
const fixture = '/tmp/axiom-kiro-responses-live-06.txt';
const scope = { workspaceId: 'b64c057e-96ee-435a-a078-a501e8f0d128' };
const result = { case: 'live06', outcome: 'not-sent', scope, runs: [], claims: [] };
const pending = new Map();
const ws = new WebSocket('ws://127.0.0.1:4317/ws', { origin: 'http://127.0.0.1:4317' });
let deadline = 0;
ws.on('message', raw => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type !== 'receipt') return;
  const p = pending.get(m.requestId); if (!p) return;
  clearTimeout(p.timer); pending.delete(m.requestId);
  m.ok ? p.resolve(m.data) : p.reject(Error('receipt-rejected'));
});
ws.on('error', () => {});
function command(op, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error('receipt-unknown')); }, 12000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ requestId, op, params, ...scope }), error => {
      if (error) { clearTimeout(timer); pending.delete(requestId); reject(Error('send-unknown')); }
    });
  });
}
async function claim(name) {
  const file = await open(join(dir, name), 'wx', 0o600);
  await file.writeFile('Consumed single-prompt gate. Never replay.\n'); await file.close();
  result.claims.push(name);
}
async function settled(runId) {
  while (Date.now() < deadline) {
    const row = db.prepare('SELECT status FROM runs WHERE id=? AND sessionId=?').get(runId, scope.sessionId);
    if (row && !['starting', 'running', 'stopping'].includes(row.status)) return row.status;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('observation-timeout');
}
async function transcript(expectedMarker, expectedAssistantStops) {
  const row = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get(scope.sessionId);
  if (!row?.file || (await stat(row.file)).size > 10 * 1024 * 1024) throw Error('transcript-unavailable');
  const entries = (await readFile(row.file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const messages = entries.filter(e => e.type === 'message' && e.message).map(e => e.message);
  const assistants = messages.filter(m => m.role === 'assistant');
  const calls = assistants.flatMap(m => m.content ?? []).filter(b => b.type === 'toolCall');
  const results = messages.filter(m => m.role === 'toolResult');
  const texts = assistants.map(m => (m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''));
  const last = assistants.at(-1);
  return {
    assistantCount: assistants.length,
    assistantStops: assistants.map(m => m.stopReason),
    modelMatches: assistants.every(m => m.provider === 'kiro' && m.model === 'deepseek-3.2'),
    callCount: calls.length, resultCount: results.length,
    readFixtureOnce: calls.length === 1 && calls[0].name === 'read' && calls[0].arguments?.path === fixture,
    matchingToolResult: calls.length === 1 && results.length === 1 && results[0].toolCallId === calls[0].id && results[0].isError === false,
    toolMarker: results.length === 1 && (results[0].content ?? []).some(b => b.type === 'text' && b.text.includes(marker1)),
    finalMarkerExact: texts.at(-1) === expectedMarker,
    firstMarkerPresent: texts.includes(marker1),
    completeDiagnostics: assistants.every(m => (m.diagnostics ?? []).some(d => d.type === 'kiro-responses-completed')),
    stopsMatch: JSON.stringify(assistants.map(m => m.stopReason)) === JSON.stringify(expectedAssistantStops),
    finalStop: last?.stopReason,
  };
}
function passed(p) {
  return p.modelMatches && p.readFixtureOnce && p.matchingToolResult && p.toolMarker && p.finalMarkerExact && p.firstMarkerPresent && p.completeDiagnostics && p.stopsMatch;
}
try {
  await Promise.race([
    new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', () => reject(Error('socket-unavailable'))); }),
    new Promise((_, reject) => { const t = setTimeout(() => reject(Error('socket-timeout')), 10000); t.unref(); }),
  ]);
  if ((await readFile(fixture, 'utf8')).trim() !== marker1) throw Error('fixture-invalid');
  const session = await command('session.create', { reuseEmpty: false });
  if (typeof session?.id !== 'string') throw Error('session-unavailable');
  scope.sessionId = session.id;
  await command('agent.model', { selection: { provider: 'kiro', id: 'deepseek-3.2', thinking: 'off' } });
  const selected = JSON.parse(db.prepare('SELECT selection FROM agent_sessions WHERE sessionId=?').get(scope.sessionId).selection);
  if (selected.provider !== 'kiro' || selected.id !== 'deepseek-3.2' || selected.thinking !== 'off') throw Error('model-mismatch');
  await claim('tool.claim'); deadline = Date.now() + 150000;
  result.outcome = 'first-sent';
  const first = await command('prompt', { text: `请只调用一次 read 工具读取 ${fixture}，不要调用其他工具。读取成功后只输出文件中的标记，不加解释。` });
  if (typeof first?.runId !== 'string') throw Error('run-unavailable');
  const run1 = { id: first.runId, status: await settled(first.runId) }; result.runs.push(run1);
  if (run1.status !== 'completed') throw Error('first-run-failed');
  result.first = await transcript(marker1, ['toolUse', 'stop']);
  if (!passed(result.first)) throw Error('first-assertions-failed');
  if (Date.now() >= deadline) throw Error('observation-timeout');
  await claim('next-turn.claim');
  result.outcome = 'second-sent';
  const second = await command('prompt', { text: `不要调用任何工具，只回复这个标记：${marker2}` });
  if (typeof second?.runId !== 'string') throw Error('run-unavailable');
  const run2 = { id: second.runId, status: await settled(second.runId) }; result.runs.push(run2);
  if (run2.status !== 'completed') throw Error('second-run-failed');
  result.second = await transcript(marker2, ['toolUse', 'stop', 'stop']);
  if (!passed(result.second)) throw Error('second-assertions-failed');
  result.outcome = 'transcript-passed';
} catch (error) {
  const known = new Set(['receipt-rejected','receipt-unknown','send-unknown','observation-timeout','transcript-unavailable','socket-unavailable','socket-timeout','fixture-invalid','session-unavailable','model-mismatch','run-unavailable','first-run-failed','first-assertions-failed','second-run-failed','second-assertions-failed']);
  result.failureCode = known.has(error?.message) ? error.message : 'local-harness-error';
  result.outcome = 'stopped';
  if (scope.sessionId && deadline && ws.readyState === WebSocket.OPEN) {
    try { await command('agent.stop'); result.stopRequested = true; } catch { result.stopRequestUnknown = true; }
  }
} finally {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear(); ws.close(); db.close();
  console.log(JSON.stringify(result));
}
