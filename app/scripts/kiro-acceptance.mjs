// Explicit opt-in real acceptance through Axiom WS; no credential access or direct model transport.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
const [command, stateArg, ...args] = process.argv.slice(2);
assert.ok(['prepare', 'send', 'inspect'].includes(command));
assert.ok(stateArg, 'Explicit fresh evidence state path required');
const file = resolve(stateArg), origin = 'http://127.0.0.1:4317';
mkdirSync(dirname(file), { recursive: true });
let state;
if (command === 'prepare') {
  assert.equal(existsSync(file), false, 'Never replay existing prepare');
  assert.equal(args.length, 3, 'prepare STATE WORKSPACE MODEL THINKING');
  state = { createdAt: new Date().toISOString(), workspaceId: args[0], selection: { provider: 'kiro', id: args[1], thinking: args[2] }, turns: [] };
  writeFileSync(file, JSON.stringify(state, null, 2), { flag: 'wx' });
} else state = JSON.parse(readFileSync(file, 'utf8'));
const save = () => writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
const snapshots = new Map(), pending = new Map();
const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin } });
ws.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'snapshot') snapshots.set(m.scope, m.data);
  if (m.type === 'receipt') { const p = pending.get(m.requestId); if (!p) return; pending.delete(m.requestId); clearTimeout(p.timer); m.ok ? p.resolve(m.data) : p.reject(Error(JSON.stringify(m.error))); }
});
async function call(op, params = {}, scope = { workspaceId: state.workspaceId, sessionId: state.sessionId }) {
  const requestId = randomUUID();
  const result = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Receipt timeout; inspect before retry')); }, 120000); pending.set(requestId, { resolve, reject, timer }); });
  ws.send(JSON.stringify({ requestId, op, params, ...scope })); return result;
}
async function sub(key) { await call('subscribe', { scope: key }, {}); return snapshots.get(key); }
const key = () => `agent:${state.workspaceId}:${state.sessionId}`;
try {
  await once(ws, 'open');
  if (command === 'prepare') {
    const created = await call('session.create', { reuseEmpty: false }, { workspaceId: state.workspaceId });
    state.sessionId = created.id; save();
    await call('session.rename', { title: 'Kiro受控能力验收 ' + state.createdAt });
    const info = await sub(key()); state.initialSelection = info.selection; save();
    await call('agent.model', { selection: state.selection });
    const selected = await sub(key()); assert.deepEqual(selected.selection, state.selection); state.prepared = true; save();
    console.log(JSON.stringify({ sessionId: state.sessionId, selection: selected.selection }));
  } else if (command === 'send') {
    assert.ok(state.prepared); assert.equal(args.length, 2, 'send STATE LABEL PROMPT_FILE');
    assert.ok(!state.turns.some(t => t.label === args[0]), 'Never repeat a label');
    const info = await sub(key()); assert.deepEqual(info.selection, state.selection);
    assert.ok(!info.run || !['running','starting','stopping'].includes(info.run.status));
    const text = readFileSync(resolve(args[1]), 'utf8');
    const turn = { label: args[0], text, startedAt: new Date().toISOString() }; state.turns.push(turn); save();
    turn.receipt = await call('prompt', { text }); save();
    const started = Date.now();
    while (Date.now() - started < 660000) {
      const run = snapshots.get(key())?.run;
      if (run && run.id !== info.run?.id && !['running','starting','stopping'].includes(run.status)) {
        if (turn.receipt.runId) assert.equal(run.id, turn.receipt.runId, 'Receipt must own the observed run');
        const messages = await call('agent.original');
        const own = messages.filter(m => m.runId === run.id);
        assert.ok(own.some(m => m.role === 'user' && m.text === text.trim() && (!turn.receipt.inputId || m.inputIds?.includes(turn.receipt.inputId))), 'Exact prompt/input/run correlation required');
        turn.run = run;
        turn.messages = await Promise.all(own.map(async m => {
          const full = await call('message.get', { id: m.id });
          return { id: m.id, role: m.role, runId: m.runId, inputIds: m.inputIds, text: m.text, thinkingLength: m.thinkingLength, calls: m.calls, toolName: m.toolName, toolCallId: m.toolCallId, status: m.status, error: m.error, kiroFailure: full.kiroFailure };
        }));
        turn.observedMs = Date.now() - started; save(); console.log(JSON.stringify(turn, null, 2));
        assert.equal(run.status, 'completed', run.error); break;
      }
      await delay(150);
    }
    assert.ok(turn.run, 'Run timeout; inspect, never replay blindly');
  } else {
    const info = await sub(key());
    console.log(JSON.stringify({ sessionId: state.sessionId, selection: info.selection, run: info.run }, null, 2));
  }
} finally { for (const p of pending.values()) clearTimeout(p.timer); ws.close(); }
