// Explicit opt-in real acceptance through Axiom WS; no credential access or direct model transport.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
const [command, stateArg, ...args] = process.argv.slice(2);
assert.ok(['prepare', 'select', 'send', 'collect', 'inspect'].includes(command));
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
async function part(message, field, toolCall, audit) {
  const preview = toolCall ? toolCall.input : message.text;
  const length = toolCall ? toolCall.inputLength : message.textLength;
  const revision = toolCall ? toolCall.inputRevision : message.textRevision;
  if ((length ?? preview.length) <= preview.length) return preview;
  const result = (await call('message.part', { id: message.id, field, ...(toolCall ? { callId: toolCall.id } : {}) })).text;
  assert.equal(result.length, length); assert.ok(result.startsWith(preview));
  const sha256 = createHash('sha256').update(result).digest('hex');
  if (revision) assert.equal(sha256, revision);
  audit?.push({ messageId: message.id, field, ...(toolCall ? { callId: toolCall.id } : {}), length, sha256, prefixMatched: true, revisionMatched: revision ? true : null });
  return result;
}
async function collect(turn, run) {
  assert.ok(turn.receipt.runId || turn.receipt.inputId, 'A receipt ownership key is required');
  if (turn.receipt.runId) assert.equal(run.id, turn.receipt.runId, 'Receipt must own the observed run');
  const messages = await call('agent.original'), hydration = [];
  const own = await Promise.all(messages.filter(m => m.runId === run.id).map(async m => ({ ...m, text: await part(m, 'text', undefined, hydration) })));
  assert.ok(own.some(m => m.role === 'user' && m.text.includes(turn.text.trim()) && (!turn.receipt.inputId || m.inputIds?.includes(turn.receipt.inputId))), 'Exact prompt/input/run correlation required');
  turn.run = run;
  turn.messages = await Promise.all(own.map(async m => {
    const full = await call('message.get', { id: m.id });
    const calls = await Promise.all((m.calls ?? []).map(async c => ({ ...c, input: await part(m, 'input', c, hydration) })));
    return { id: m.id, role: m.role, runId: m.runId, inputIds: m.inputIds, text: m.text, thinkingLength: m.thinkingLength, calls,
      images: m.images?.map(({ id, name, mimeType }) => ({ id, name, mimeType })), toolName: m.toolName, toolCallId: m.toolCallId,
      status: m.status, error: m.error, kiroFailure: full.kiroFailure };
  }));
  turn.hydrationChecks = hydration;
  save();
}
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
  } else if (command === 'select') {
    assert.ok(state.prepared); assert.equal(args.length, 2, 'select STATE MODEL THINKING');
    const selection = { provider: 'kiro', id: args[0], thinking: args[1] };
    await call('agent.model', { selection });
    const info = await sub(key()); assert.deepEqual(info.selection, selection);
    state.selection = selection; save(); console.log(JSON.stringify({ selection }));
  } else if (command === 'collect') {
    assert.equal(args.length, 1, 'collect STATE EXISTING_LABEL');
    const turn = state.turns.find(t => t.label === args[0]); assert.ok(turn);
    const info = await sub(key());
    const run = turn.run ?? info.run;
    assert.ok(run && !['running', 'starting', 'stopping'].includes(run.status));
    await collect(turn, run); console.log(JSON.stringify({ label: turn.label, run: turn.run }));
  } else if (command === 'send') {
    assert.ok(state.prepared); assert.ok(args.length === 2 || args.length === 3, 'send STATE LABEL PROMPT_FILE [OPTIONS_JSON]');
    const extra = args[2] ? JSON.parse(readFileSync(resolve(args[2]), 'utf8')) : {};
    assert.ok(Object.keys(extra).every(k => ['image', 'attachment', 'cancelAfterMs', 'cancelOnText'].includes(k)), 'Unknown send option');
    if (extra.cancelAfterMs !== undefined) assert.ok(Number.isSafeInteger(extra.cancelAfterMs) && extra.cancelAfterMs >= 100 && extra.cancelAfterMs <= 60000);
    if (extra.cancelOnText !== undefined) assert.equal(typeof extra.cancelOnText, 'boolean');
    if (extra.cancelOnText) { assert.ok(extra.cancelAfterMs); await sub(`messages:${state.workspaceId}:${state.sessionId}`); }
    const images = extra.image ? [{ id: 'img1', name: basename(extra.image), mimeType: extra.image.endsWith('.jpg') ? 'image/jpeg' : 'image/png', data: readFileSync(resolve(extra.image)).toString('base64') }] : [];
    const attachments = extra.attachment ? [{ name: basename(extra.attachment), text: readFileSync(resolve(extra.attachment), 'utf8') }] : [];
    assert.ok(!state.turns.some(t => t.label === args[0]), 'Never repeat a label');
    const info = await sub(key()); assert.deepEqual(info.selection, state.selection);
    assert.ok(!info.run || !['running','starting','stopping'].includes(info.run.status));
    const text = readFileSync(resolve(args[1]), 'utf8');
    const sha = value => createHash('sha256').update(value).digest('hex');
    const turn = { label: args[0], text, startedAt: new Date().toISOString(), selection: state.selection,
      images: images.map(({ data, ...meta }) => ({ ...meta, bytes: Buffer.from(data, 'base64').length, sha256: sha(Buffer.from(data, 'base64')) })),
      attachments: attachments.map(({ name, text }) => ({ name, bytes: Buffer.byteLength(text), sha256: sha(text) })) };
    state.turns.push(turn); save();
    turn.receipt = await call('prompt', { text, ...(images.length ? { images } : {}), ...(attachments.length ? { attachments } : {}) }); save();
    const started = Date.now();
    while (Date.now() - started < 660000) {
      const run = snapshots.get(key())?.run;
      if (extra.cancelAfterMs && !turn.cancelRequestedAt && run?.id !== info.run?.id && run?.status === 'running' && Date.now() - started >= extra.cancelAfterMs) {
        const live = extra.cancelOnText ? (await call('agent.original')).find(m => m.runId === run.id && m.role === 'assistant' && m.text.length > 0) : undefined;
        if (extra.cancelOnText && !live) { await delay(250); continue; }
        if (live) turn.cancelObservedText = { messageId: live.id, length: live.textLength ?? live.text.length, prefix: live.text.slice(0, 120) };
        turn.cancelRequestedAt = new Date().toISOString(); save();
        const stopped = await call('agent.stop', { runId: run.id });
        turn.cancelReceipt = { run: stopped.run }; save();
      }
      if (run && run.id !== info.run?.id && !['running','starting','stopping'].includes(run.status)) {
        await collect(turn, run);
        turn.observedMs = Date.now() - started; save();
        console.log(JSON.stringify({ label: turn.label, run, observedMs: turn.observedMs,
          messages: turn.messages.map(({ text, ...m }) => ({ ...m, text: text.length > 2000 ? text.slice(0, 2000) + ' [driver display truncated; full text saved in state]' : text })) }, null, 2));
        assert.equal(run.status, extra.cancelAfterMs ? 'cancelled' : 'completed', run.error); break;
      }
      await delay(150);
    }
    assert.ok(turn.run, 'Run timeout; inspect, never replay blindly');
  } else {
    const info = await sub(key());
    console.log(JSON.stringify({ sessionId: state.sessionId, selection: info.selection, run: info.run }, null, 2));
  }
} finally { for (const p of pending.values()) clearTimeout(p.timer); ws.close(); }
