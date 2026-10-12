import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Store } from '../src/server/storage.js';
import { configuration } from '../src/server/models.js';
import { startServer } from '../src/server/index.js';
import type { Command, Session, Workspace } from '../src/shared/protocol.js';

const temporary = () => mkdtempSync(join(tmpdir(), 'axiom-check-'));
test('SQLite: authorization, ownership, idempotency, draft revisions and restart', () => {
  const root = temporary(); let store = new Store(root);
  try {
    const run = (op: string, params = {}, workspaceId?: string, sessionId?: string) => store.execute({ requestId: randomUUID(), op, params, workspaceId, sessionId });
    assert.throws(() => run('workspace.open', { path: root }), { code: 'AUTHORIZATION_REQUIRED' });
    assert.throws(() => run('workspace.open', { path: './', authorized: true }), { code: 'INVALID_PATH' });
    const a = run('workspace.open', { path: root, authorized: true }) as Workspace;
    assert.equal((run('workspace.open', { path: root, authorized: true }) as Workspace).id, a.id);
    const path = join(root, '另一个项目'); mkdirSync(path);
    const b = run('workspace.open', { path, authorized: true }) as Workspace;
    const creation: Command = { requestId: randomUUID(), op: 'session.create', workspaceId: a.id };
    const s = store.execute(creation) as Session;
    assert.deepEqual(store.execute(creation), s);
    assert.equal(store.sessions(a.id).length, 1);
    assert.throws(() => store.execute({ ...creation, workspaceId: b.id }), { code: 'REQUEST_CONFLICT' });
    for (const op of ['session.rename', 'session.pin', 'session.delete', 'draft.save', 'prompt']) {
      assert.throws(() => run(op, { title: 'foreign', pinned: true, confirmed: true, text: 'foreign' }, b.id, s.id), { code: 'SCOPE_MISMATCH' });
    }
    assert.throws(() => run('prompt', { text: 'do not run' }, a.id, s.id), { code: 'AGENT_NOT_READY' });
    assert.throws(() => run('session.delete', {}, a.id, s.id), { code: 'CONFIRMATION_REQUIRED' });
    run('session.rename', { title: '中文会话' }, a.id, s.id);
    run('session.pin', { pinned: true }, a.id, s.id);
    const draft = { viewId: 'tab-a', revision: 0, text: '草稿 A', attachment: { name: '代码.ts', text: 'const a = 1;' } };
    run('draft.save', draft, a.id, s.id);
    assert.throws(() => run('draft.save', draft, a.id, s.id), { code: 'REVISION_CONFLICT' });
    assert.throws(() => run('draft.save', { ...draft, revision: 1, attachment: { name: 'secret.exe', text: 'invalid' } }, a.id, s.id), { code: 'INVALID_ATTACHMENT' });
    assert.throws(() => run('draft.save', { ...draft, revision: 1, attachment: { name: 'large.txt', text: '中'.repeat(40000) } }, a.id, s.id), { code: 'INVALID_ATTACHMENT' });
    run('draft.save', { ...draft, viewId: 'tab-b', text: '草稿 B' }, a.id, s.id);
    assert.equal(store.draft(a.id, s.id, 'tab-a').text, '草稿 A');
    assert.equal(store.draft(a.id, s.id, 'tab-b').text, '草稿 B');
    store.close(); store = new Store(root);
    assert.equal(store.session(a.id, s.id).title, '中文会话');
    assert.equal(store.session(a.id, s.id).pinned, true);
    assert.equal(store.draft(a.id, s.id, 'tab-a').revision, 1);
    assert.deepEqual(store.receipt(creation.requestId), { status: 'committed', data: s });
    store.db.exec("CREATE TEMP TRIGGER fail_write BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'disk failure check'); END");
    assert.throws(() => run('session.rename', { title: 'must not commit' }, a.id, s.id));
    assert.equal(store.session(a.id, s.id).title, '中文会话');
    store.db.exec('DROP TRIGGER fail_write');
    run('session.delete', { confirmed: true }, a.id, s.id);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM drafts').get()!.n, 0);
    assert.equal(readFileSync(join(root, 'axiom.sqlite')).length > 0, true);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('Model summaries: only explicitly configured + authenticated models, no secrets', async () => {
  const root = temporary(), dir = join(root, 'pi'); mkdirSync(dir);
  try {
    assert.deepEqual((await configuration(root)).available, []);
    const config = { providers: { 'axiom-local-check': { api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', models: [{ id: 'only-configured', name: 'Explicit' }] } } };
    writeFileSync(join(dir, 'models.json'), JSON.stringify(config));
    const unauthed = await configuration(root);
    assert.equal(unauthed.error, undefined); assert.equal(unauthed.modelCount, 1); assert.deepEqual(unauthed.available, []);
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ 'axiom-local-check': { type: 'api_key', key: 'TEST-ONLY-NOT-A-REAL-SECRET' } }));
    const available = await configuration(root);
    assert.equal(available.error, undefined);
    assert.deepEqual(available.available, [{ provider: 'axiom-local-check', id: 'only-configured', name: 'Explicit' }]);
    assert.ok(!JSON.stringify(available).includes('TEST-ONLY'));
    writeFileSync(join(dir, 'models.json'), '{invalid-secret-config');
    assert.ok((await configuration(root)).error);
    assert.equal(readFileSync(join(dir, 'models.json'), 'utf8'), '{invalid-secret-config');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('HTTP/WS: local access, scoped snapshots, recoverable receipts, no mutation replay', async () => {
  const root = temporary(), app = await startServer({ root, port: 0 });
  const clients: WebSocket[] = [];
  try {
    assert.equal((await fetch(app.origin + '/api/status')).status, 401);
    assert.equal((await fetch(app.origin + '/api/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const access = new URLSearchParams(new URL(app.accessUrl).hash.slice(1)).get('access')!;
    assert.equal((await fetch(app.origin + '/api/access', { method: 'POST', headers: { Origin: app.origin, 'X-Axiom-Access': 'bad' } })).status, 403);
    const login = await fetch(app.origin + '/api/access', { method: 'POST', headers: { Origin: app.origin, 'X-Axiom-Access': access } });
    assert.equal(login.status, 204);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(app.origin + '/api/status', { headers: { Cookie: cookie } })).status, 200);
    async function connect() {
      const ws = new WebSocket(app.origin.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie, Origin: app.origin } }); clients.push(ws);
      const messages: any[] = []; ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
      await once(ws, 'open');
      return { ws, messages, call: (c: Partial<Command> & { op: string }) => new Promise<any>((resolve, reject) => {
        const requestId = c.requestId ?? randomUUID();
        const timer = setTimeout(() => { ws.off('message', receive); reject(Error('receipt timeout')); }, 3000);
        function receive(raw: Buffer) { const value = JSON.parse(raw.toString()); if (value.type === 'receipt' && value.requestId === requestId) { clearTimeout(timer); ws.off('message', receive); resolve(value); } }
        ws.on('message', receive); ws.send(JSON.stringify({ ...c, requestId }));
      }) };
    }
    const first = await connect();
    await first.call({ op: 'subscribe', params: { scope: 'workspaces' } });
    const opened = await first.call({ op: 'workspace.open', params: { path: root, authorized: true } });
    const w = opened.data as Workspace;
    const requestId = randomUUID();
    const created = await first.call({ op: 'session.create', workspaceId: w.id, requestId });
    assert.equal(created.ok, true);
    const s = created.data as Session;
    const snap = await first.call({ op: 'subscribe', params: { scope: `session:${w.id}:${s.id}` } }); assert.equal(snap.ok, true);
    const denied = await first.call({ op: 'subscribe', params: { scope: `session:other:${s.id}` } }); assert.equal(denied.ok, false);
    const before = first.messages.filter(m => m.type === 'snapshot');
    assert.ok(before.some(m => m.scope === `session:${w.id}:${s.id}` && m.data.id === s.id));
    first.ws.close(); await once(first.ws, 'close');
    const second = await connect();
    const receipt = await second.call({ op: 'request.get', params: { requestId } });
    assert.equal(receipt.data.status, 'committed'); assert.equal(receipt.data.data.id, s.id);
    const duplicate = await second.call({ op: 'session.create', workspaceId: w.id, requestId });
    assert.equal(duplicate.data.id, s.id); assert.equal(app.store.sessions(w.id).length, 1);
    assert.equal((await second.call({ op: 'prompt', workspaceId: w.id, sessionId: s.id, params: { text: 'never send' } })).error.code, 'AGENT_NOT_READY');
    const alien = new WebSocket(app.origin.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie, Origin: 'https://evil.example' } });
    await new Promise<void>(resolve => { alien.once('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 403); res.resume(); alien.terminate(); resolve(); }); alien.on('error', () => {}); });
  } finally { for (const ws of clients) ws.terminate(); await app.close(); rmSync(root, { recursive: true, force: true }); }
});
