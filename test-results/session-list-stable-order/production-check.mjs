import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const WebSocket = require('ws');
const source = readFileSync(new URL('../../app/src/server/session-list.ts', import.meta.url), 'utf8');
const oldSource = execFileSync('git', ['show', 'HEAD:app/src/server/session-list.ts'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
const sql = text => { const match = text.match(/const locators = `([\s\S]*?)`;/); assert(match); return match[1]; };
const db = new DatabaseSync('/Users/dane/Library/Application Support/Axiom2/axiom.sqlite', { readOnly: true });
db.function('axiom_list_lower', { deterministic: true }, value => String(value).toLowerCase());
db.function('axiom_list_compare', { deterministic: true }, (a, b) => String(a).localeCompare(String(b)));
db.function('axiom_list_uuid', { deterministic: true }, value => Number(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(value))));
const workspace = db.prepare('SELECT id FROM workspaces WHERE path=? AND archived=0').get('/Volumes/D_Work/axiom2');
assert(workspace, 'the current project workspace must exist');
const params = { workspaceId: workspace.id, group: 'top', queryFold: '', familyRank: 0, memberRank: 0 };
const current = db.prepare(sql(source)), legacy = db.prepare(sql(oldSource));
const socket = new WebSocket('ws://127.0.0.1:4317/ws', { origin: 'http://127.0.0.1:4317' });
const pending = new Map();
socket.on('message', raw => {
  const event = JSON.parse(raw.toString());
  if (event.type === 'receipt') pending.get(event.requestId)?.(event);
});
let report;
try {
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  for (let attempt = 0; attempt < 5; ++attempt) {
    db.exec('BEGIN');
    try {
      const revision = db.prepare('SELECT revision FROM session_list_state WHERE id=1').get().revision;
      const expected = current.all(params).slice(0, 30).map(row => row.id);
      const oldOrder = legacy.all(params).slice(0, 30).map(row => row.id);
      const requestId = randomUUID();
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(requestId); reject(Error('receipt timeout')); }, 15000);
        pending.set(requestId, result => { clearTimeout(timeout); pending.delete(requestId); resolve(result); });
        socket.send(JSON.stringify({ op: 'session-list.initial', requestId, workspaceId: workspace.id, params: { query: '' } }));
      });
      assert.equal(result.ok, true, result.error?.code);
      if (result.data.revision !== revision) continue;
      const items = result.data.top.items;
      const actual = items.map(row => row.id);
      const stableOrder = JSON.stringify(actual) === JSON.stringify(expected);
      report = { checkedAt: new Date().toISOString(), readOnly: true, revision, topRows: items.length,
        runningTopRows: items.filter(row => ['starting', 'running', 'stopping'].includes(row.runStatus) || row.activeTaskCount > 0).length,
        allHavePersistentAnchors: items.every(row => Number.isFinite(row.listOrderAt)),
        matchesStableOrder: stableOrder, differsFromOldActivitySort: JSON.stringify(actual) !== JSON.stringify(oldOrder),
        orderHash: createHash('sha256').update(JSON.stringify(actual)).digest('hex') };
      writeFileSync(new URL('./production-check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
      assert(stableOrder, 'running service is not using the fixed sidebar ordering');
      assert(report.allHavePersistentAnchors);
      break;
    } finally { db.exec('ROLLBACK'); }
  }
  assert(report, 'no same-revision snapshot obtained in five attempts');
  console.log(JSON.stringify(report));
} finally {
  socket.close(); db.close();
}
