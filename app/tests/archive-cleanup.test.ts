import { archiveExecutable } from './fixtures/archive-worker.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, lstat, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { inspectArchives, removeArchive } = await import(new URL('../desktop/archive-cleanup.mjs', import.meta.url).href);
const { createUpdater } = await import(new URL('../desktop/updater.mjs', import.meta.url).href);
const { serviceAdmission } = await import(new URL('../desktop/service-admission.mjs', import.meta.url).href);
async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'axiom-archive-fixture-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'updates'));
  const bytes = Buffer.from('isolated archive fixture'), id = createHash('sha256').update(bytes).digest('hex') + '-axiom2.tgz';
  const path = join(root, 'updates', id); await writeFile(path, bytes);
  const updater = createUpdater({ root, env: { ...process.env, AXIOM_DESKTOP_EXECUTABLE: archiveExecutable }, fetcher: () => assert.fail('archive cleanup must not use network') });
  const preview = async () => { const state = await updater.runJob('archive-preview'); assert.equal(state.job.task.status, 'succeeded', state.job.message); return state.archiveCleanup; };
  const remove = (token: string, confirm = true, selected = id) => updater.runJob('archive-remove', JSON.stringify({ token, id: selected, confirm }));
  return { root, path, bytes, id, updater, preview, remove };
}
test('archive cleanup needs no backend or commands, consumes token and preserves other files', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  for (const name of ['previous-version.json', 'old-Axiom2.msi', 'runtime/keep']) {
    const path = join(f.root, 'updates', name); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'keep');
  }
  const preview = await f.preview(); assert.equal(preview.targets.length, 1); assert.ok(await lstat(f.path));
  const result = await f.remove(preview.token);
  assert.equal(result.job.task.status, 'succeeded', result.job.message); assert.equal(result.job.cleanup.complete, true);
  assert.equal(result.archiveCleanup.token, null); await assert.rejects(lstat(f.path), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.root, 'updates/previous-version.json'), 'utf8'), 'keep');
  assert.equal(await readFile(join(f.root, 'updates/runtime/keep'), 'utf8'), 'keep');
  assert.equal((await f.remove(preview.token)).job.task.status, 'failed');
});
test('archive consent is explicit and paths are selected only from preview', async t => {
  const f = await fixture(t), preview = await f.preview();
  assert.equal((await f.remove(preview.token, false)).job.task.status, 'failed');
  assert.equal((await f.remove(preview.token, true, '../keep')).job.task.status, 'failed');
  assert.deepEqual(await readFile(f.path), f.bytes);
});
test('changed archives are refused after confirmation without deleting them', async t => {
  const f = await fixture(t), preview = await f.preview(); await writeFile(f.path, 'changed');
  const result = await f.remove(preview.token); assert.equal(result.job.task.status, 'failed');
  assert.equal(await readFile(f.path, 'utf8'), 'changed'); assert.equal(result.archiveCleanup.token, null);
});
test('digest mismatch is shown unverified rather than authorized for deletion', async t => {
  const f = await fixture(t); await writeFile(f.path, 'bad digest');
  const preview = await f.preview(); assert.equal(preview.targets.length, 0);
  assert.equal(preview.items[0].state, 'unverified'); assert.match(preview.items[0].note, /摘要/);
});
test('unsupported Windows deletion is reported without an actionable target', async t => {
  const f = await fixture(t), preview = await inspectArchives(f.root, { platform: 'win32' });
  assert.equal(preview.targets.length, 0);
  assert.equal(preview.items[0].state, 'unverified'); assert.match(preview.items[0].note, /Windows.*尚不支持/);
  assert.deepEqual(await readFile(f.path), f.bytes);
});
test('restoration, install ownership and shared admission block archive cleanup', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'updates/transaction.json'), '{}');
  assert.equal((await f.updater.runJob('archive-preview')).job.task.status, 'failed');
  await rm(join(f.root, 'updates/transaction.json')); await mkdir(join(f.root, 'setup'));
  await writeFile(join(f.root, 'setup/service-owner.json'), '{}');
  assert.equal((await f.updater.runJob('archive-preview')).job.task.status, 'failed');
  await rm(join(f.root, 'setup/service-owner.json'));
  const release = await serviceAdmission(f.root);
  try { assert.equal((await f.updater.runJob('archive-preview')).job.task.status, 'failed'); } finally { release(); }
  assert.deepEqual(await readFile(f.path), f.bytes);
});
test('cleanup remains available with damaged backend registration', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'installation.json'), '{bad');
  const preview = await f.preview(); const result = await f.remove(preview.token);
  assert.equal(result.job.task.status, 'succeeded', result.job.message); assert.ok(result.installationError);
});
test('linked archive and replaced parent do not authorize deletion', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), preview = await inspectArchives(f.root), original = join(f.root, 'original');
  await rename(join(f.root, 'updates'), original); await symlink(original, join(f.root, 'updates'));
  await assert.rejects(removeArchive({ root: f.root, preview, id: f.id }), /目录/);
  assert.deepEqual(await readFile(f.path), f.bytes);
  await rm(join(f.root, 'updates')); await rename(original, join(f.root, 'updates'));
  await rename(f.path, join(f.root, 'outside')); await symlink(join(f.root, 'outside'), f.path);
  const scan = await inspectArchives(f.root); assert.equal(scan.targets.length, 0);
  assert.deepEqual(await readFile(join(f.root, 'outside')), f.bytes);
});
test('a FIFO replacing a confirmed archive is refused without blocking', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), preview = await inspectArchives(f.root);
  await rm(f.path); execFileSync('mkfifo', [f.path]);
  await assert.rejects(removeArchive({ root: f.root, preview, id: f.id }), /类型|变化/);
  assert.equal((await lstat(f.path)).isFIFO(), true);
});
test('cancelled previews never authorize a subsequent deletion', async t => {
  const f = await fixture(t), original = fs.open;
  let entered!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const patched = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === f.path) { entered(); await new Promise(resolve => setTimeout(resolve, 400)); }
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const pending = f.updater.runJob('archive-preview'); await paused;
    const active = await f.updater.status();
    await f.updater.maintenanceControl('cancel', { id: active.job.task.id });
    const cancelled = await pending;
    assert.equal(cancelled.job.task.status, 'cancelled'); assert.ok(!cancelled.archiveCleanup?.token);
    assert.deepEqual(await readFile(f.path), f.bytes);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); }
});
test('hashing obeys the budget before entering the destructive commit', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), preview = await f.preview(), original = fs.open;
  await writeFile(join(f.root, 'updates/budgets.json'), JSON.stringify({ headersMs: 1000, idleMs: 1000, installMs: 1000, totalMs: 1000 }));
  const patched = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === f.path) await new Promise(resolve => setTimeout(resolve, 1150));
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await f.remove(preview.token);
    assert.equal(result.job.task.status, 'failed'); assert.equal(result.job.task.error.code, 'total-timeout');
    assert.deepEqual(await readFile(f.path), f.bytes);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); }
});
function interrupt(root: string) {
  const db = new DatabaseSync(join(root, 'updates/jobs.sqlite'));
  try {
    const row = db.prepare('SELECT token,body FROM job WHERE id=1').get() as { token: string; body: string };
    const value = JSON.parse(row.body); value.running = true; value.task.status = 'running'; delete value.reconciliation;
    const body = JSON.stringify(value);
    db.prepare('UPDATE job SET pid=?,body=? WHERE id=1').run(2147483647, body);
    db.prepare('UPDATE maintenance_history SET pid=?,body=? WHERE token=?').run(2147483647, body, row.token);
    return value.task.id;
  } finally { db.close(); }
}
test('interrupted preview is reconciled without supervisor records or replay', async t => {
  const f = await fixture(t); await f.preview();
  const id = interrupt(f.root);
  await assert.rejects(f.updater.runJob('archive-preview'), /核实/);
  const reconciled = await f.updater.reconcile({ id });
  assert.equal(reconciled.job.task.status, 'failed'); assert.equal(reconciled.archiveCleanup.token, null);
  assert.deepEqual(await readFile(f.path), f.bytes); assert.ok((await f.preview()).token);
});
test('interrupted request before commit preparation is reconciled without a worker', async t => {
  const f = await fixture(t);
  const rejected = await f.updater.runJob('archive-remove', '{invalid');
  assert.equal(rejected.job.task.status, 'failed');
  const id = interrupt(f.root);
  const reconciled = await f.updater.reconcile({ id });
  assert.equal(reconciled.job.task.status, 'failed');
  assert.deepEqual(await readFile(f.path), f.bytes); assert.ok((await f.preview()).token);
});
test('interrupted commit can be reconciled without claiming deletion success', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t), preview = await f.preview(); await f.remove(preview.token);
  const id = interrupt(f.root);
  const reconciled = await f.updater.reconcile({ id });
  assert.equal(reconciled.job.task.status, 'failed');
  const db = new DatabaseSync(join(f.root, 'updates/jobs.sqlite'));
  try {
    const row = db.prepare('SELECT body FROM job WHERE id=1').get() as { body: string };
    assert.equal(JSON.parse(row.body).reconciliation.retainedPath, false);
  } finally { db.close(); }
  assert.match(reconciled.job.message, /无法确认/); assert.ok((await f.preview()).token);
});
