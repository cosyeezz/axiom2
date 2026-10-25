import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const { createUpdater } = await import(new URL('../desktop/updater.mjs', import.meta.url).href);

async function fixture(t: TestContext, options: { commandError?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'axiom-pi-empty-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = join(root, 'global');
  const modules = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules');
  const packageRoot = join(modules, '@earendil-works/pi-coding-agent');
  const node = join(root, 'node/node'), npm = join(dirname(node), 'node_modules/npm/bin/npm-cli.js');
  const put = async (path: string, body: unknown) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof body === 'string' ? body : JSON.stringify(body)); };
  await put(node, 'fixture'); await put(npm, 'fixture');
  const calls: string[][] = [];
  const updater = createUpdater({ root, runtimeNode: node, env: { PATH: '' }, command: async (file: string, args: string[]) => {
    assert.equal(file, node); assert.equal(args[0], npm); calls.push(args);
    assert.equal(args[1], 'root', 'only read-only npm inspection is authorized');
    if (options.commandError) throw Error('fixture npm inspection failed');
    return modules;
  }, fetcher: async () => { throw Error('network must not be used'); } });
  return { root, prefix, modules, packageRoot, updater, put, calls };
}
test('fresh npm prefix without Pi is a successful non-actionable removal preview', async t => {
  const f = await fixture(t);
  const result = await f.updater.runJob('pi-remove-preview');
  assert.equal(result.job.task.status, 'succeeded', result.job.message);
  assert.equal(result.job.task.error, undefined);
  assert.match(result.job.message, /未安装.*无需卸载/);
  assert.equal(result.pi.removal.installed, false);
  assert.equal(result.pi.removal.version, null);
  assert.equal(result.pi.removal.token, null);
  assert.ok(result.pi.removal.items.some((item: any) => item.path === f.packageRoot && item.state === 'absent'));
  assert.ok(result.pi.removal.items.every((item: any) => item.state !== 'remove'));
  await assert.rejects(lstat(f.prefix), { code: 'ENOENT' });
  const reload = await f.updater.status();
  assert.equal(reload.pi.removal.installed, false);
  assert.equal(reload.pi.removal.token, null);
});
test('empty preview replaces stale removal authorization and cannot authorize uninstall', async t => {
  const f = await fixture(t);
  await f.put(join(f.root, 'updates/pi-removal.json'), { token: 'stale', installed: true, version: '1.0.0', items: [] });
  await f.updater.runJob('pi-remove-preview');
  const saved = JSON.parse(await readFile(join(f.root, 'updates/pi-removal.json'), 'utf8'));
  assert.equal(saved.token, null);
  const result = await f.updater.runJob('pi-uninstall', JSON.stringify({ token: 'stale', confirm: true, sessionsClosed: true }));
  assert.equal(result.job.task.status, 'failed');
  assert.equal(result.job.cleanup, undefined, 'an empty preview must not become a claimed successful cleanup');
  assert.ok(f.calls.every(args => args[1] === 'root'));
  await assert.rejects(lstat(f.prefix), { code: 'ENOENT' });
});
test('a same-name command without the selected package is retained as unverified, never removable', async t => {
  const f = await fixture(t);
  const shim = process.platform === 'win32' ? join(f.prefix, 'pi.cmd') : join(f.prefix, 'bin/pi');
  await f.put(shim, 'another installation');
  const result = await f.updater.runJob('pi-remove-preview');
  assert.equal(result.job.task.status, 'succeeded', result.job.message);
  assert.equal(result.pi.removal.token, null);
  assert.ok(result.pi.removal.items.some((item: any) => item.path === shim && item.state === 'unverified'));
  assert.equal(await readFile(shim, 'utf8'), 'another installation');
});
test('legacy Pi is not misreported as a clean absent installation', async t => {
  const f = await fixture(t);
  await f.put(join(f.modules, '@mariozechner/pi-coding-agent/package.json'), { name: '@mariozechner/pi-coding-agent', version: '0.1.0' });
  const result = await f.updater.runJob('pi-remove-preview');
  assert.equal(result.job.task.status, 'failed');
  assert.match(result.job.message, /旧命名空间/);
  assert.equal(result.pi.removal, null);
});
for (const mode of ['missing', 'corrupt', 'invalid'] as const) test(`damaged installation is not converted to absent success: ${mode}`, async t => {
  const f = await fixture(t);
  await mkdir(f.packageRoot, { recursive: true });
  if (mode === 'corrupt') await f.put(join(f.packageRoot, 'package.json'), '{');
  if (mode === 'invalid') await f.put(join(f.packageRoot, 'package.json'), { name: '@earendil-works/pi-coding-agent' });
  const result = await f.updater.runJob('pi-remove-preview');
  assert.equal(result.job.task.status, 'failed');
  assert.equal(result.pi.removal, null);
  assert.doesNotMatch(result.job.message, /无需卸载/);
});
test('npm inspection failure remains a failure, not an absent installation', async t => {
  const f = await fixture(t, { commandError: true });
  const result = await f.updater.runJob('pi-remove-preview');
  assert.equal(result.job.task.status, 'failed');
  assert.match(result.job.message, /npm inspection failed/);
  assert.equal(result.pi.removal, null);
});
