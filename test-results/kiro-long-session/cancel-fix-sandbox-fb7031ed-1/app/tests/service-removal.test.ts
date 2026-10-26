import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, realpath, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const { createUpdater } = await import(new URL('../desktop/updater.mjs', import.meta.url).href);
const { inspectServiceRemoval, removeManagedService } = await import(new URL('../desktop/service-removal.mjs', import.meta.url).href);
const { serviceAdmission } = await import(new URL('../desktop/service-admission.mjs', import.meta.url).href);
const unix = { skip: process.platform === 'win32' };
async function fixture(t: TestContext, mode = '') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'axiom-service-removal-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, 'service/node_modules/@cosyeezz/axiom2'), cli = join(packageRoot, 'bin/axiom2.mjs'), node = join(root, 'node/bin/node'), shim = join(root, 'service/node_modules/.bin/axiom2');
  const put = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  await put(node, 'fixture'); await put(cli, 'fixture');
  await put(join(packageRoot, 'package.json'), { name: '@cosyeezz/axiom2', version: '1.2.3' });
  await put(join(root, 'installation.json'), { node, cli });
  await mkdir(dirname(shim), { recursive: true }); await symlink(cli, shim);
  await mkdir(join(root, 'updates'));
  await put(join(root, 'sessions/keep'), 'private data'); await put(join(root, 'service/node_modules/other/keep'), 'other program');
  let stops = 0;
  const command = async (file: string, args: string[]) => {
    assert.equal(file, node); assert.equal(args[0], cli);
    if (args[1] === 'status') return JSON.stringify({ state: 'stopped' });
    assert.equal(args[1], 'stop'); stops++;
    if (mode === 'stop-fails') return JSON.stringify({ state: 'stopping' });
    if (mode === 'race') await put(join(root, 'service-control.json'), { pid: process.pid });
    return JSON.stringify({ state: 'stopped' });
  };
  const updater = createUpdater({ root, runtimeNode: node, command, fetcher: async () => { throw Error('network forbidden'); } });
  const preview = async () => { const result = await updater.runJob('service-remove-preview'); assert.equal(result.job.task.status, 'succeeded', result.job.message); return result.serviceRemoval; };
  const remove = (token: string, confirm = true) => updater.runJob('service-uninstall', JSON.stringify({ token, confirm }));
  return { root, packageRoot, node, cli, shim, put, updater, preview, remove, stops: () => stops };
}
test('backend removal consumes consent, verifies selected paths, retains user data and other packages', unix, async t => {
  const f = await fixture(t), preview = await f.preview();
  assert.equal(f.stops(), 0);
  const result = await f.remove(preview.token);
  assert.equal(result.job.task.status, 'succeeded', result.job.message); assert.equal(result.job.cleanup.complete, true);
  assert.equal(result.serviceVersion, null); assert.equal(result.serviceRemoval.token, null); assert.equal(result.serviceRemovalPending, false);
  await assert.rejects(lstat(f.packageRoot)); await assert.rejects(lstat(f.shim));
  assert.equal(await readFile(join(f.root, 'sessions/keep'), 'utf8'), 'private data');
  assert.equal(await readFile(join(f.root, 'service/node_modules/other/keep'), 'utf8'), 'other program');
  await f.remove(preview.token); assert.equal(f.stops(), 1);
});
for (const mode of ['stop-fails', 'race']) test(`backend removal refuses unconfirmed stop/start race: ${mode}`, unix, async t => {
  const f = await fixture(t, mode), preview = await f.preview(), result = await f.remove(preview.token);
  assert.equal(result.job.task.status, 'failed'); await lstat(f.packageRoot); await lstat(f.shim);
  assert.equal(result.job.cleanup.complete, false);
});
test('backend removal requires consent and refuses changed manifest', unix, async t => {
  const f = await fixture(t), preview = await f.preview();
  assert.equal((await f.remove(preview.token, false)).job.task.status, 'failed');
  const next = await f.preview();
  await f.put(join(f.packageRoot, 'package.json'), { name: '@cosyeezz/axiom2', version: '1.2.4' });
  assert.equal((await f.remove(next.token)).job.task.status, 'failed'); assert.equal(f.stops(), 0);
});
for (const directory of ['service/node_modules/.bin', 'updates']) test(`backend preview refuses linked parent: ${directory}`, unix, async t => {
  const f = await fixture(t), target = join(f.root, 'outside');
  await rename(join(f.root, directory), target); await symlink(target, join(f.root, directory));
  await assert.rejects(inspectServiceRemoval(f.root), /目录/);
  await lstat(f.packageRoot);
});
test('interrupted quarantine resumes only after new preview; unknown fields and new installs are rejected', unix, async t => {
  const f = await fixture(t), preview = await inspectServiceRemoval(f.root);
  let reserved = false;
  await assert.rejects(removeManagedService({ root: f.root, preview, stop: async () => {}, reserve: async () => { reserved = true; }, release: async () => { reserved = false; }, progress: async (phase: string) => { if (phase === 'validating') throw Error('simulated process failure after deletion'); } }), /simulated/);
  assert.equal(reserved, false);
  const journalPath = join(f.root, 'updates/service-removal-journal.json'), journal = JSON.parse(await readFile(journalPath, 'utf8'));
  await f.put(journalPath, { ...journal, commands: ['/outside'] });
  await assert.rejects(inspectServiceRemoval(f.root), /记录无效/);
  await f.put(journalPath, journal);
  const next = await f.preview(); assert.equal(next.resume, true);
  const result = await f.remove(next.token); assert.equal(result.job.task.status, 'succeeded', result.job.message);
});
test('prepared journal never authorizes executing a changed registration or package', unix, async t => {
  const f = await fixture(t), preview = await inspectServiceRemoval(f.root);
  await assert.rejects(removeManagedService({ root: f.root, preview, stop: async () => {}, reserve: async () => {}, release: async () => {}, progress: async (phase: string) => { if (phase === 'removing') throw Error('interrupt'); } }), /interrupt/);
  await f.put(f.cli, 'new installation');
  await assert.rejects(inspectServiceRemoval(f.root), /身份改变/);
  await lstat(f.packageRoot);
});
test('install/update/removal admission is exclusive and releases after close', unix, async t => {
  const f = await fixture(t), release = await serviceAdmission(f.root);
  try {
    await assert.rejects(serviceAdmission(f.root), /维护/);
    const result = await f.updater.runJob('service-remove-preview'); assert.equal(result.job.task.status, 'failed'); assert.equal(f.stops(), 0);
  } finally { release(); }
  const next = await f.preview(); assert.ok(next.token);
});
