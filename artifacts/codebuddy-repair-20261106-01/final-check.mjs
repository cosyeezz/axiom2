// No inference, configuration mutation or conversation content logging.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const out = resolve('artifacts/codebuddy-repair-20261106-01');
const load = p => JSON.parse(readFileSync(join(out, p)));
const proof = load('runtime-proof.json');
const result = { modulesUnchanged: proof.modules.every(m => createHash('sha256').update(readFileSync(m.path)).digest('hex') === m.sha256 && statSync(m.path).mtimeMs === m.mtimeMs), cases: 0, claimCount: readdirSync(out).filter(n => /^(glm|deepseek)-.*\.claim$/.test(n)).length, defaultRestored: true, refreshedUiReadbacksPassed: true, runs: [] };
for (const key of ['glm', 'deepseek']) {
  const r = load(`${key}-report.json`), c = load(`${key}-control.json`), v = load(`${key}-refresh-readback.json`);
  assert.equal(r.cases.length, 8); assert.ok(r.cases.every(t => t.passed));
  result.cases += r.cases.length;
  result.defaultRestored &&= r.observations.defaultRestored && c.restored;
  result.refreshedUiReadbacksPassed &&= v.passed && v.noModelRequests;
  assert.equal(readFileSync(join(out, key, 'owned.txt'), 'utf8').trim(), 'alpha=23');
}
const require = createRequire(resolve('app/package.json')), WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:4317/ws', { origin: 'http://127.0.0.1:4317' });
const workspaceId = 'b64c057e-96ee-435a-a078-a501e8f0d128';
try {
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  for (const key of ['glm', 'deepseek']) {
    const sessionId = load(`${key}-control.json`).sessionId, scope = `agent:${workspaceId}:${sessionId}`;
    const snapshot = await new Promise((res, rej) => {
      const timer = setTimeout(() => { ws.off('message', receive); rej(Error('snapshot-timeout')); }, 15000);
      function receive(raw) { const v = JSON.parse(raw.toString()); if (v.type === 'snapshot' && v.scope === scope) { clearTimeout(timer); ws.off('message', receive); res(v.data); } }
      ws.on('message', receive); ws.send(JSON.stringify({ requestId: randomUUID(), op: 'subscribe', workspaceId, sessionId, params: { scope } }));
    });
    const status = snapshot.run?.status ?? 'none';
    assert.ok(['none', 'completed', 'cancelled', 'failed', 'interrupted'].includes(status));
    result.runs.push({ model: key === 'glm' ? 'glm-5.3' : 'deepseek-v4.1-flash', status, active: false });
  }
  assert.ok(result.modulesUnchanged && result.defaultRestored && result.refreshedUiReadbacksPassed);
  assert.equal(result.claimCount, 16); result.passed = true;
} finally { ws.close(); }
writeFileSync(join(out, 'final-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
