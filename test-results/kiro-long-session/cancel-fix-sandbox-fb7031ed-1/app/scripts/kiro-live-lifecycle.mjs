// Opt-in AXIOM WS cancellation/reload acceptance, confined to an existing test task.
// Does not import a provider or call a model service directly.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const statePath = resolve(process.argv[2] ?? '../test-results/kiro-long-session/state.json');
const target = JSON.parse(readFileSync(statePath, 'utf8'));
const output = resolve(process.argv[3] ?? '../test-results/kiro-long-session/lifecycle.json');
const origin = 'http://127.0.0.1:4317';
const scope = { workspaceId: target.workspaceId, sessionId: target.sessionId };
const parent = { workspaceId: target.workspaceId, sessionId: target.parentSessionId };
const key = `agent:${scope.workspaceId}:${scope.sessionId}`;
const reloadKey = `reload:${scope.workspaceId}:${scope.sessionId}`;
const pending = new Map(), snapshots = new Map();
const evidence = { sessionId: scope.sessionId, taskRef: target.taskRef, startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin } });
ws.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'snapshot') snapshots.set(m.scope, m.data);
  if (m.type !== 'receipt') return;
  const p = pending.get(m.requestId); if (!p) return;
  pending.delete(m.requestId); clearTimeout(p.timer);
  m.ok ? p.resolve(m.data) : p.reject(new Error(JSON.stringify(m.error)));
});
ws.on('error', error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); });
async function call(op, params = {}, to = scope) {
  const requestId = randomUUID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${op} receipt timeout; do not replay`)); }, 120_000);
    pending.set(requestId, { resolve, reject, timer });
  });
  ws.send(JSON.stringify({ requestId, op, params, ...to })); return result;
}
async function sub(s) { await call('subscribe', { scope: s }, {}); return snapshots.get(s); }
async function until(fn, timeout = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await fn(); if (result) return result; await delay(200); }
  throw new Error('Acceptance observation timeout; inspect target before replay');
}
const terminal = r => r && !['starting', 'running', 'stopping'].includes(r.status);
async function original(runId) { return (await call('agent.original')).filter(m => m.runId === runId); }
async function ask(label, text) {
  const previous = snapshots.get(key)?.run?.id;
  await call('prompt', { text });
  const run = await until(() => { const r = snapshots.get(key)?.run; return r?.id !== previous && terminal(r) ? r : undefined; });
  const messages = await original(run.id);
  const answer = (await Promise.all(messages.filter(m => m.role === 'assistant').map(async m =>
    m.truncated || m.textLength > m.text.length ? (await call('message.part', { id: m.id, field: 'text' })).text : m.text))).join('\n');
  const record = { label, run, answer, messages: messages.map(({ id, role, status, toolName, error }) => ({ id, role, status, toolName, error })) };
  evidence.cases.push(record); save();
  assert.deepEqual(run.selection, { provider: 'kiro', id: 'claude-sonnet-4.5', thinking: 'low' });
  assert.equal(run.status, 'completed', run.error); assert.doesNotMatch(answer, /<axiom_prior_reasoning>/);
  return record;
}
try {
  await once(ws, 'open');
  const tasks = await sub(`tasks:${parent.workspaceId}:${parent.sessionId}`);
  assert.ok(tasks.tasks.some(t => t.ref === target.taskRef && t.sessionId === scope.sessionId), 'Must be the registered isolated test task');
  await sub(key); await sub(reloadKey);
  await call('agent.model', { selection: { provider: 'kiro', id: 'claude-sonnet-4.5', thinking: 'low' } });
  const previous = snapshots.get(key)?.run?.id;
  await call('prompt', { text: '受控取消验收：必须立即真实使用powershell执行 Start-Sleep -Seconds 30; Write-Output "EXPECTED_SLEEP_FINISHED"。不要读取或修改文件；完成后只回复 SLEEP_DONE。' });
  let ownRunId;
  try {
    const observed = await until(async () => {
      const r = snapshots.get(key)?.run;
      if (!r || r.id === previous) return;
      ownRunId = r.id;
      if (terminal(r)) throw new Error('Run ended before cancellation target started');
      const messages = await original(r.id);
      // agent.original is authoritative FINALIZED history, not the live UI tool row.
      // The execution phase is emitted from tool_execution_start; pair it with the
      // finalized assistant call before cancelling this exact run.
      const tool = messages.filter(m => m.role === 'assistant').flatMap(m => m.calls ?? []).find(c =>
        c.name.replace(/^functions\./, '') === 'powershell' && c.input.includes('Start-Sleep'));
      return r.phase === 'executing_tools' && tool ? { run: r, tool: { id: tool.id, name: tool.name, input: tool.input } } : undefined;
    }, 90_000);
    await call('agent.stop', { runId: observed.run.id });
    const run = await until(() => { const r = snapshots.get(key)?.run; return r?.id === observed.run.id && terminal(r) ? r : undefined; });
    const messages = await original(run.id);
    evidence.cases.push({ label: 'cancel-active-real-tool', observed, run, tools: messages.filter(m => m.role === 'toolResult').map(({ id, status, error, toolName }) => ({ id, status, error, toolName })) }); save();
    assert.equal(run.status, 'cancelled');
  } catch (error) {
    const run = snapshots.get(key)?.run;
    if (ownRunId && run?.id === ownRunId && !terminal(run)) await call('agent.stop', { runId: ownRunId }).catch(() => {});
    throw error;
  }
  const recovery = await ask('after-cancel-context', '继续先前的库存长会话。不调用工具。请只输出最初的标记、最初的中文校验词、磁盘账本总数，用空格分隔。');
  assert.match(recovery.answer, /ORBIT-K7.*青鹭.*51/s);
  const receipt = await call('agent.reload');
  const reload = await until(() => { const r = snapshots.get(reloadKey); return r?.id === receipt.id && r.status !== 'running' ? r : undefined; });
  evidence.reload = reload; save(); assert.equal(reload.status, 'completed', reload.error);
  const resumed = await ask('after-reload-context', '不调用工具。回忆原始磁盘账本red/blue/green/total，以及最初标记、中文校验词，输出JSON。');
  for (const value of ['ORBIT-K7', '青鹭', '14', '28', '9', '51']) assert.ok(resumed.answer.includes(value));
  const main = await sub(`agent:${parent.workspaceId}:${parent.sessionId}`);
  const preferences = await call('task.preferences.get', {}, parent);
  assert.deepEqual({ main: main.selection, task: preferences.selection }, target.defaults);
  evidence.defaultsUnchanged = true; evidence.passed = true; evidence.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.passed = false; evidence.error = String(error.stack ?? error); save(); throw error;
} finally { for (const p of pending.values()) clearTimeout(p.timer); ws.close(); }
