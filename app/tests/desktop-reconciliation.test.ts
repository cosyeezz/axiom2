import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const { createUpdater } = await import(new URL('../desktop/updater.mjs', import.meta.url).href);
const { desktopTask } = await import(new URL('../desktop/maintenance.mjs', import.meta.url).href);

// These tests model persisted Windows receipts, not native process cleanup.
// Real HANDLE/Job and Linux /proc proofs are exercised by the platform suites.
test('reconciliation keeps admission blocked after files are released but SQLite commit fails', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'axiom-reconcile-commit-'));
  let db: DatabaseSync | undefined;
  t.after(async () => { db?.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const updater = createUpdater({ root, command: async () => { throw Error('No command may run'); }, fetcher: async () => { throw Error('No network may run'); } });
  await writeFile(join(root, 'installation.json'), JSON.stringify({ node: process.execPath, cli: join(root, 'node_modules/@cosyeezz/axiom2/bin/axiom2.mjs') }));
  await updater.history();
  const task = desktopTask('pi', 'update'), token = 'a'.repeat(64), gateId = randomUUID(), nonce = randomUUID(), hostPid = 123456789;
  const directory = join(root, 'updates/tasks', task.id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'task.json'), JSON.stringify(task));
  await writeFile(join(root, 'updates/process-owner.json'), JSON.stringify({ format: 1, id: gateId, state: 'intent', hostPid }));
  await writeFile(join(directory, 'supervision.json'), JSON.stringify({ format: 1, gateId, token, taskId: task.id, attemptId: task.attemptId, root, hostPid, commands: [], services: [], parentWitness: { nonce, ready: true } }));
  await writeFile(join(directory, 'parent-ready.json'), JSON.stringify({ nonce, parentPid: hostPid }));
  await writeFile(join(directory, 'parent-exited.json'), JSON.stringify({ nonce, parentPid: hostPid, exited: true }));
  db = new DatabaseSync(join(root, 'updates/jobs.sqlite'));
  const stored = () => {
    const row = db!.prepare('SELECT body FROM job').get();
    assert.ok(row); assert.equal(typeof row.body, 'string');
    return JSON.parse(row.body as string);
  };
  db.prepare('INSERT INTO job VALUES(1,?,?,?)').run(token, hostPid, JSON.stringify({ task, kind: 'pi', supervised: true, running: true, phase: 'installing' }));
  db.exec(`CREATE TRIGGER fail_completion BEFORE UPDATE ON job WHEN json_extract(NEW.body, '$.reconciliation.state') = 'complete' BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END`);
  await assert.rejects(updater.reconcile({ id: task.id }), /injected completion failure/);
  assert.equal(stored().reconciliation.state, 'release-pending');
  await assert.rejects(readFile(join(root, 'updates/process-owner.json')), { code: 'ENOENT' });
  assert.equal((await updater.busy()).busy, true);
  assert.equal((await updater.status()).job.reconciled, false, 'release-pending is not verified completion');
  assert.equal((await updater.history()).tasks[0].status, 'unknown');
  await assert.rejects(updater.runJob('check'), /核实尚未提交完成/);
  db.exec('DROP TRIGGER fail_completion');
  const result = await updater.reconcile({ id: task.id });
  assert.equal(result.job.task.status, 'interrupted');
  assert.equal(result.job.running, false);
  assert.equal(result.job.reconciled, true, 'only committed release publishes the safe completion flag');
  assert.equal((await updater.busy()).busy, false);
  assert.equal(stored().reconciliation.state, 'complete');
  assert.equal(result.job.reconciliation, undefined, 'private evidence does not cross the status bridge');
  await assert.rejects(updater.reconcile({ id: randomUUID() }), /任务已改变/);
  await writeFile(join(root, 'updates/process-owner.json'), JSON.stringify({ format: 1, id: randomUUID(), state: 'intent', hostPid }));
  const occupied = await updater.status();
  assert.equal(occupied.job.reconciled, false, 'even a stored complete record cannot bypass a currently present owner');
  assert.equal(occupied.job.reconciliation, undefined);
});
