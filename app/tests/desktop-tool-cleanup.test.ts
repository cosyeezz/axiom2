import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { cleanupRows, cleanupProgress, acceptedCleanupJob } from '../src/client/pages/desktop-cleanup.js';
import { emptyReaState } from '../src/shared/rea.js';
import { defaultMaintenanceBudgets, type MaintenanceState, type MaintenanceTask } from '../src/shared/maintenance.js';
import { emptyModelProxyState } from '../src/shared/model-proxy.js';
const { cleanupCommand, cleanupAddress, cleanupRequest } = await import(new URL('../desktop/tool-cleanup.mjs', import.meta.url).href);
test('cleanup bridge rejects arbitrary operations, URLs and unconfirmed parameters', () => {
  for (const input of [{ op: 'files.remove', params: {} }, { op: 'rtk.uninstall', params: { confirm: true } }, { op: 'rtk.uninstall', params: { revision: 'r', confirm: false } }, { op: 'resources.remove', params: { id: 'x', revision: 'r', confirm: true, force: true } }, { op: 'rea.engine-uninstall', params: { engine: 'hopper', revision: 'r', confirm: true } }, { op: 'resources.get', params: { url: 'http://evil.test' } }]) assert.throws(() => cleanupCommand(input));
  for (const address of ['https://127.0.0.1:3000/', 'http://example.com/', 'http://127.0.0.1:3000/ws', 'http://user:pass@127.0.0.1:3000/', 'http://127.0.0.1:3000/?token=x', 'http://localhost:3000/']) assert.throws(() => cleanupAddress(address));
  assert.equal(cleanupAddress('http://127.0.0.1:3210/'), 'ws://127.0.0.1:3210/ws');
  assert.equal(cleanupCommand({ op: 'resources.remove', params: { revision: 'current', id: 'r', confirm: true, clearCredentials: false } }).params.clearCredentials, false);
});
test('native WebSocket bridge sends one whitelisted request and matches the receipt', async t => {
  const server = createServer(), sockets = new WebSocketServer({ server, path: '/ws' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { sockets.clients.forEach(socket => socket.terminate()); sockets.close(); server.close(); });
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}/`; let calls = 0;
  sockets.on('connection', (socket, req) => { assert.equal(req.headers.host, new URL(address).host); socket.on('message', bytes => {
    calls++; const request = JSON.parse(bytes.toString()); assert.equal(request.op, 'rtk.get');
    socket.send(JSON.stringify({ type: 'receipt', requestId: 'unrelated', ok: true, data: { wrong: true } }));
    socket.send(JSON.stringify({ type: 'receipt', requestId: request.requestId, ok: true, data: { revision: 'current' } }));
  }); });
  const result = await cleanupRequest(address, { op: 'rtk.get' }); assert.equal(result.data.revision, 'current'); assert.equal(calls, 1);
});
test('REA cleanup tracks exact accepted job, rejects pending files and ignores another job', () => {
  const initial = { ...emptyReaState, revision: 'r', version: '6.7.0', packageRoot: '/fixture/rea' };
  const row = cleanupRows({ rea: initial }).find(item => item.id === 'rea')!;
  const accepted = { ...initial, jobs: [{ id: 'ours', kind: 'uninstall' as const, running: true, message: 'removing' }], job: { id: 'other', kind: 'engine-check' as const, running: false, message: 'done' } };
  assert.equal(acceptedCleanupJob(row, accepted, 'request'), 'ours');
  assert.equal(cleanupProgress(row, accepted, 'ours').state, 'running');
  const terminal = { ...accepted, version: undefined, packageRoot: undefined, jobs: [{ ...accepted.jobs[0], running: false }] };
  assert.equal(cleanupProgress(row, terminal, 'ours').state, 'verified');
  assert.equal(cleanupProgress(row, { ...terminal, removalPending: true }, 'ours').state, 'failed');
  assert.equal(cleanupProgress(row, { ...terminal, jobs: [] }, 'ours').state, 'unknown');
});
test('proxy importer requires its exact successful maintenance task and checks remaining files', () => {
  const initial = { ...emptyModelProxyState, revision: 'r', importer: { supported: true, pinnedVersion: '1', filesPresent: true, removalPending: false, busy: false } };
  const row = cleanupRows({ modelProxy: initial }).find(item => item.id === 'proxy:importer')!;
  const removed = { ...initial, importer: { ...initial.importer, filesPresent: false } };
  const task: MaintenanceTask = { id: 'ours', attemptId: 'a', endpoint: 'backend', resource: 'proxy:xray-knife', label: 'fixture', action: 'uninstall', scope: '应用级', status: 'succeeded', phase: 'validating', steps: ['checking', 'removing', 'validating'], completedSteps: 3, createdAt: 1, updatedAt: 2, budgets: defaultMaintenanceBudgets, capabilities: { cancel: false, extend: false } };
  const history: MaintenanceState = { tasks: [task], budgets: defaultMaintenanceBudgets };
  assert.equal(acceptedCleanupJob(row, initial, 'ours'), 'ours');
  assert.equal(cleanupProgress(row, removed, 'ours').state, 'unknown');
  assert.equal(cleanupProgress(row, removed, 'other', history).state, 'unknown');
  assert.equal(cleanupProgress(row, removed, 'ours', { ...history, tasks: [{ ...task, action: 'install' }] }).state, 'unknown');
  for (const status of ['unknown', 'interrupted', 'running', 'failed', 'cancelled'] as const) assert.equal(cleanupProgress(row, removed, 'ours', { ...history, tasks: [{ ...task, status }] }).state, status === 'running' ? 'running' : status === 'unknown' || status === 'interrupted' ? 'unknown' : 'failed');
  assert.equal(cleanupProgress(row, removed, 'ours', history).state, 'verified');
  assert.equal(cleanupProgress(row, { ...removed, importer: { ...removed.importer, removalPending: true } }, 'ours', history).state, 'failed');
  assert.equal(cleanupProgress(row, initial, 'ours', history).state, 'failed');
  assert.equal(cleanupCommand({ op: 'maintenance.get' }).op, 'maintenance.get');
});
test('scoped bridge allows orphan cleanup only with a valid path confirmation', () => {
  const cleanupRevision = 'a'.repeat(64);
  const params = { revision: '', confirm: true, cleanupRevision };
  assert.throws(() => cleanupCommand({ op: 'opencli.uninstall', params: { revision: 'current', confirm: true } }), /范围摘要/);
  assert.equal(cleanupCommand({ op: 'opencli.uninstall', params }).params.cleanupRevision, cleanupRevision);
  for (const value of ['', 'a'.repeat(63), [cleanupRevision], true]) assert.throws(() => cleanupCommand({ op: 'opencli.uninstall', params: { ...params, cleanupRevision: value } }));
  assert.throws(() => cleanupCommand({ op: 'rea.uninstallSkill', params }));
  assert.throws(() => cleanupCommand({ op: 'resources.remove', params: { ...params, id: 'fixture' } }));
});
test('orphan paths remain actionable and prevent successful rescan verification', () => {
  const cleanup = { paths: ['/fixture/old-rea'], revision: 'b'.repeat(64) };
  const initial = { ...emptyReaState, cleanup };
  const row = cleanupRows({ rea: initial }).find(item => item.id === 'rea')!;
  assert.equal(row.available, true);
  assert.equal(row.params.cleanupRevision, cleanup.revision);
  assert.ok(row.scope.some(text => text.includes('/fixture/old-rea')));
  const done = { ...initial, jobs: [{ id: 'ours', kind: 'uninstall' as const, running: false, message: 'done' }] };
  assert.equal(cleanupProgress(row, done, 'ours').state, 'failed');
  assert.equal(cleanupProgress(row, { ...done, cleanup: { ...cleanup, paths: [] } }, 'ours').state, 'verified');
});
test('missing online scopes block desktop deletion while unregistered REA paths remain visible', () => {
  const missing = cleanupRows({ rea: { ...emptyReaState, version: '6.7.0' } }).find(item => item.id === 'rea')!;
  assert.equal(missing.available, false);
  assert.match(missing.warning!, /未能核实具体卸载路径/);
  const engine = { id: 'java' as const, path: '', configured: false, status: 'missing' as const, detail: '', installable: false, cleanup: { paths: [], revision: 'c'.repeat(64) }, cleanupUnverified: ['/fixture/unregistered-java'] };
  const state = { ...emptyReaState, engines: [engine], jobs: [{ id: 'ours', kind: 'engine-uninstall' as const, engine: 'java' as const, running: false, message: 'done' }] };
  const row = cleanupRows({ rea: state }).find(item => item.id === 'engine:java')!;
  assert.equal(row.available, false);
  assert.match(row.warning!, /未登记残留.*unregistered-java/);
  assert.equal(cleanupProgress(row, state, 'ours').state, 'failed');
});
test('resource disappearance alone cannot substitute for an accepted terminal job', () => {
  const state = { revision: 'r', scopes: [{ id: 'global', name: '应用', kind: 'global' as const }], warnings: [], items: [{ id: 'a', scopeId: 'global', name: 'fixture', kind: 'mcp' as const, description: '', source: '', managed: true, removable: true, cleanup: ['private program'] }] };
  const row = cleanupRows({ resources: state })[0];
  assert.equal(cleanupProgress(row, { ...state, items: [] }, 'ours').state, 'unknown');
  assert.equal(cleanupProgress(row, { ...state, items: [], jobs: [{ id: 'ours', running: false, message: 'done' }] }, 'ours').state, 'verified');
  assert.equal(cleanupProgress(row, { ...state, items: [], jobs: [{ id: 'ours', running: false, message: 'failed', error: 'shared files retained' }] }, 'ours').state, 'failed');
});
