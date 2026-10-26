// Read-only terminal gate. Never prompts, selects, reloads, or stops anything.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const { WebSocket } = createRequire(new URL('../../app/package.json', import.meta.url))('ws');
const preflight = process.argv.includes('--preflight');
const summary = JSON.parse(readFileSync(new URL('./sonnet-post429-v4/summary.json', import.meta.url), 'utf8'));
if (!preflight) assert.ok(summary.finishedAt, 'Wait for the serial owner to finish naturally');
const hashChecks = summary.codeHashes.map(({ path, sha256 }) => {
  const actual = createHash('sha256').update(readFileSync(new URL('../../app/' + path, import.meta.url))).digest('hex');
  assert.equal(actual, sha256, 'Frozen file changed: ' + path); return { path, sha256, unchanged: true };
});
assert.equal(hashChecks.length, 6);
const references = ['t4014', 't4018', 't4015', 't4017', 't4019', 't4020', 't4016', 't4046'];
const seed = JSON.parse(readFileSync(new URL('./matrix/auto/state.json', import.meta.url), 'utf8'));
const origin = 'http://127.0.0.1:4317', snapshots = new Map(), pending = new Map();
const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin } });
ws.on('message', data => {
  const m = JSON.parse(data);
  if (m.type === 'snapshot') snapshots.set(m.scope, m.data);
  if (m.type === 'receipt') {
    const p = pending.get(m.requestId);
    if (p) { pending.delete(m.requestId); clearTimeout(p.timer); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error?.code ?? 'read-failed')); }
  }
});
async function call(op, params = {}, scope = {}) {
  const requestId = randomUUID();
  const result = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('read-only-timeout')); }, 15_000); pending.set(requestId, { resolve, reject, timer }); });
  ws.send(JSON.stringify({ requestId, op, params, ...scope })); return result;
}
async function subscribe(scope) { await call('subscribe', { scope }); return snapshots.get(scope); }
try {
  await once(ws, 'open');
  const list = await subscribe('tasks:' + seed.workspaceId + ':' + seed.parentSessionId), tasks = [];
  for (const ref of references) {
    const task = list.tasks.find(t => t.ref === ref);
    assert.ok(task && task.workspaceId === seed.workspaceId && task.parentSessionId === seed.parentSessionId);
    assert.ok(['completed', 'failed', 'cancelled'].includes(task.status), 'Owned task is not terminal');
    const agent = await subscribe('agent:' + seed.workspaceId + ':' + task.sessionId);
    assert.equal(agent.task?.id, task.id);
    assert.ok(!agent.run || ['completed', 'failed', 'cancelled'].includes(agent.run.status), 'Owned run is not terminal');
    assert.ok(Array.isArray(agent.queue) && agent.queue.length === 0);
    const states = {};
    for (const input of task.inputs ?? []) { assert.equal(input.state, 'delivered', 'Resolve uncertain persistent inputs'); states[input.state] = (states[input.state] ?? 0) + 1; }
    const reload = await subscribe('reload:' + seed.workspaceId + ':' + task.sessionId);
    assert.ok(!reload || ['completed', 'failed', 'cancelled'].includes(reload.status), 'Owned reload remains active');
    tasks.push({ taskRef: ref, taskStatus: task.status, runId: agent.run?.id ?? null, runStatus: agent.run?.status ?? null, selection: agent.selection,
      queueLength: 0, persistentInputStates: states, reloadStatus: reload?.status ?? null });
  }
  const main = await subscribe('agent:' + seed.workspaceId + ':' + seed.parentSessionId);
  const preferences = await call('task.preferences.get', {}, { workspaceId: seed.workspaceId, sessionId: seed.parentSessionId });
  assert.deepEqual({ main: main.selection, task: preferences.selection }, seed.defaults);
  const output = { checkedAt: new Date().toISOString(), readOnly: true, allOwnedTasksQuiescent: true, defaultsUnchanged: true,
    runnerFinishedAt: summary.finishedAt, controllerExitCode: summary.controllerExitCode, hashChecks, tasks };
  writeFileSync(new URL(preflight ? './sonnet-post429-v4/preflight-quiescence.json' : './sonnet-post429-v4/quiescence-after-final.json', import.meta.url), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ allOwnedTasksQuiescent: true, defaultsUnchanged: true, frozenHashesUnchanged: hashChecks.length, tasks: tasks.length }));
} finally { for (const p of pending.values()) clearTimeout(p.timer); ws.close(); }
