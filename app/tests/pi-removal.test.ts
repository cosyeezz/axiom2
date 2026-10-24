import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const { createUpdater } = await import(new URL('../desktop/updater.mjs', import.meta.url).href);
async function fixture(t: TestContext, options: { leaveShim?: boolean; fail?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'axiom-pi-removal-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = join(root, 'global'), modules = join(prefix, 'lib/node_modules');
  const pkgRoot = join(modules, '@earendil-works/pi-coding-agent'), entry = join(pkgRoot, 'dist/cli.js'), shim = join(prefix, 'bin/pi');
  const node = join(root, 'node/bin/node'), npm = join(dirname(node), 'node_modules/npm/bin/npm-cli.js');
  const put = async (path: string, value: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  await put(node, 'fixture'); await put(npm, 'fixture');
  await put(join(pkgRoot, 'package.json'), { name: '@earendil-works/pi-coding-agent', version: '1.2.3', bin: { pi: 'dist/cli.js' } });
  await put(entry, 'fixture'); await mkdir(dirname(shim), { recursive: true }); await symlink(entry, shim);
  await put(join(modules, 'other/package.json'), 'keep other package'); await put(join(root, 'pi/settings.json'), 'keep private settings'); await put(join(root, 'cache/file'), 'keep cache');
  const calls: string[][] = [];
  const command = async (_node: string, args: string[]) => {
    assert.equal(_node, node); assert.equal(args[0], npm);
    if (args[1] === 'root') return modules;
    assert.equal(args[1], 'uninstall'); calls.push(args);
    assert.equal(args[args.indexOf('--prefix') + 1], prefix);
    for (const option of ['--ignore-scripts', '--offline', '--no-audit', '--no-fund']) assert.ok(args.includes(option));
    assert.equal(args.at(-1), '@earendil-works/pi-coding-agent');
    await lstat(join(dirname(pkgRoot), '.axiom-pi-update.lock'));
    assert.equal(JSON.parse(await readFile(join(root, 'updates/pi-removal.json'), 'utf8')).token, null);
    if (options.fail) throw Error('simulated npm failure');
    await rm(pkgRoot, { recursive: true }); if (!options.leaveShim) await rm(shim);
    return '';
  };
  const updater = createUpdater({ root, runtimeNode: node, env: { PATH: '' }, command, fetcher: async () => { throw Error('network must not be used'); } });
  const preview = async () => { const value = await updater.runJob('pi-remove-preview'); assert.equal(value.job.task.status, 'succeeded', value.job.message); return value.pi.removal; };
  const remove = (token: string, extra = {}) => updater.runJob('pi-uninstall', JSON.stringify({ token, confirm: true, sessionsClosed: true, ...extra }));
  return { root, prefix, modules, pkgRoot, entry, shim, node, put, updater, preview, remove, calls };
}
const unix = { skip: process.platform === 'win32' };
test('Pi removal consumes preview, holds shared lock, verifies removal and preserves shared data', unix, async t => {
  const f = await fixture(t), preview = await f.preview();
  assert.equal(f.calls.length, 0);
  const result = await f.remove(preview.token);
  assert.equal(result.job.task.status, 'succeeded', result.job.message);
  assert.equal(result.job.cleanup.complete, true); assert.equal(result.pi.cli.version, null);
  assert.equal(result.job.cleanup.items.filter((v: any) => v.state === 'removed').length, 2);
  assert.ok(result.job.cleanup.items.some((v: any) => v.state === 'unverified'));
  assert.equal(await readFile(join(f.modules, 'other/package.json'), 'utf8'), 'keep other package');
  assert.equal(await readFile(join(f.root, 'pi/settings.json'), 'utf8'), 'keep private settings');
  assert.equal(await readFile(join(f.root, 'cache/file'), 'utf8'), 'keep cache');
  await assert.rejects(lstat(join(dirname(f.pkgRoot), '.axiom-pi-update.lock')));
  await f.remove(preview.token); assert.equal(f.calls.length, 1, 'confirmation cannot replay');
});
test('Pi removal refuses changed manifest and replaced shim before npm', unix, async t => {
  for (const change of ['manifest', 'shim']) {
    const f = await fixture(t), preview = await f.preview();
    if (change === 'manifest') await f.put(join(f.pkgRoot, 'package.json'), { name: '@earendil-works/pi-coding-agent', version: '1.2.4', bin: { pi: 'dist/cli.js' } });
    else { await rm(f.shim); await f.put(f.shim, 'another tool'); }
    const result = await f.remove(preview.token); assert.equal(result.job.task.status, 'failed'); assert.equal(f.calls.length, 0);
  }
});
test('Pi removal refuses missing consent and occupied cross-root lock', unix, async t => {
  const f = await fixture(t); let preview = await f.preview();
  assert.equal((await f.remove(preview.token, { sessionsClosed: false })).job.task.status, 'failed');
  preview = await f.preview();
  const lock = join(dirname(f.pkgRoot), '.axiom-pi-update.lock'); await f.put(lock, 'other task');
  const result = await f.remove(preview.token); assert.equal(result.job.task.status, 'failed'); assert.equal(f.calls.length, 0);
  assert.equal(await readFile(lock, 'utf8'), 'other task');
});
test('Pi removal refuses legacy namespace and package symlink in preview', unix, async t => {
  for (const mode of ['legacy', 'link']) {
    const f = await fixture(t);
    if (mode === 'legacy') await f.put(join(f.modules, '@mariozechner/pi-coding-agent/package.json'), { name: '@mariozechner/pi-coding-agent' });
    else { await rm(f.pkgRoot, { recursive: true }); await symlink(join(f.root, 'pi'), f.pkgRoot); }
    const result = await f.updater.runJob('pi-remove-preview'); assert.equal(result.job.task.status, 'failed'); assert.equal(result.pi.removal, null); assert.equal(f.calls.length, 0);
  }
});
test('Pi removal rejects a package also resolved by the registered backend', unix, async t => {
  const f = await fixture(t), cli = join(f.modules, '@cosyeezz/axiom2/bin/axiom2.mjs');
  await f.put(cli, 'fixture'); await f.put(join(dirname(dirname(cli)), 'package.json'), { name: '@cosyeezz/axiom2', version: '1.0.0' });
  await f.put(join(f.root, 'installation.json'), { node: f.node, cli });
  const result = await f.updater.runJob('pi-remove-preview'); assert.equal(result.job.task.status, 'failed'); assert.match(result.job.message, /共享依赖/); assert.equal(f.calls.length, 0);
});
for (const options of [{ leaveShim: true }, { fail: true }]) test(`Pi partial failure stays incomplete: ${Object.keys(options)[0]}`, unix, async t => {
  const f = await fixture(t, options), preview = await f.preview(), result = await f.remove(preview.token);
  assert.equal(result.job.task.status, 'failed'); assert.equal(result.job.cleanup.complete, false);
  assert.ok(result.job.cleanup.items.some((v: any) => v.state === 'remaining'));
  assert.equal(result.pi.removal.token, null); assert.equal(f.calls.length, 1);
  await assert.rejects(lstat(join(dirname(f.pkgRoot), '.axiom-pi-update.lock')));
});
