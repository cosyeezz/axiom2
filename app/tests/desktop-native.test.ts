import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error bundled desktop module
import { stageBundledLinuxHelper, prepareLinuxHelper } from '../desktop/desktop-native.mjs';

test('workbench allows only exact srcdoc beyond its origin without relaxing preview isolation', async () => {
  const views = await readFile(new URL('../desktop/axiom_views.rs', import.meta.url), 'utf8');
  assert.match(views, /fn allow_workbench_navigation\(same_origin: bool, url: &str\) -> bool \{\s*same_origin \|\| url == "about:srcdoc"\s*\}/);
  assert.match(views, /\.on_navigation\(move \|url\| allow_workbench_navigation\(url\.origin\(\) == origin, url\.as_str\(\)\)\)/);
  const preview = await readFile(new URL('../src/client/chat/HtmlFile.tsx', import.meta.url), 'utf8');
  assert.match(preview, /const sandbox = scripts \? "allow-scripts" : ""/);
  assert.match(preview, /sandbox="\$\{sandbox\}"/);
  assert.match(preview, /sandbox=\{sandbox\}/);
  assert.match(preview, /frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'/);
});

async function fixture(t: any, arch = 'x64') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'axiom-native-fixture-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime'); await mkdir(runtime);
  const bytes = Buffer.alloc(64); bytes.set(Buffer.from('7f454c460201', 'hex')); bytes.writeUInt16LE(arch === 'x64' ? 62 : 183, 18);
  const bundle = { protocol: 1, arch, sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') };
  const bundlePath = join(root, 'native-helper.json'); await writeFile(bundlePath, JSON.stringify(bundle));
  return { root, runtime, bytes, bundle, bundlePath, arch };
}
test('offline helper is copied and verified without backend installation or fetch', async t => {
  const f = await fixture(t);
  await prepareLinuxHelper({ ...f, offline: true, download: () => assert.fail('cleanup must not download') });
  const staged = join(f.runtime, 'bin/native/linux-x64');
  assert.deepEqual(await readFile(join(staged, 'axiom-owner')), f.bytes);
  assert.deepEqual(JSON.parse(await readFile(join(staged, 'manifest.json'), 'utf8')), { protocol: 1, arch: 'x64', sha256: f.bundle.sha256 });
  await rm(f.bundlePath);
  assert.deepEqual(await readFile(join(staged, 'axiom-owner')), f.bytes, 'staged helper survives source removal');
});
for (const arch of ['x64', 'arm64']) test(`offline ${arch} helper rejects the other architecture and stages locally`, async t => {
  const f = await fixture(t, arch);
  const download = () => assert.fail('cleanup must not download');
  await assert.rejects(prepareLinuxHelper({ ...f, arch: arch === 'x64' ? 'arm64' : 'x64', offline: true, download }));
  await prepareLinuxHelper({ ...f, offline: true, download });
  assert.deepEqual(await readFile(join(f.runtime, `bin/native/linux-${arch}/axiom-owner`)), f.bytes);
});
test('missing bundle blocks offline commands and only online work may download', async t => {
  const f = await fixture(t); await rm(f.bundlePath); let downloads = 0;
  const download = async () => { downloads++; };
  await assert.rejects(prepareLinuxHelper({ ...f, offline: true, download }), /不会联网/);
  assert.equal(downloads, 0);
  await prepareLinuxHelper({ ...f, offline: false, download }); assert.equal(downloads, 1);
  await writeFile(f.bundlePath, JSON.stringify({ protocol: 1, arch: null, data: null, sha256: null }));
  await assert.rejects(prepareLinuxHelper({ ...f, offline: true, download }), /不会联网/);
  assert.equal(downloads, 1);
});
test('corrupt hash, ELF, architecture and oversized inputs never fall back to network', async t => {
  const f = await fixture(t);
  for (const change of [{ sha256: '0'.repeat(64) }, { arch: 'arm64' }, { protocol: 2 }, { data: Buffer.alloc(64).toString('base64') }, { data: f.bundle.data + '\n' }]) {
    await writeFile(f.bundlePath, JSON.stringify({ ...f.bundle, ...change }));
    await assert.rejects(prepareLinuxHelper({ ...f, offline: false, download: () => assert.fail('corruption must not download') }));
  }
  await writeFile(f.bundlePath, ' '.repeat(12 * 1024 * 1024 + 1));
  await assert.rejects(stageBundledLinuxHelper(f.runtime, f), /监督器无效/);
});
test('bundle links, parent links and destination links are rejected', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const link = join(f.root, 'linked.json'); await symlink(f.bundlePath, link);
  await assert.rejects(stageBundledLinuxHelper(f.runtime, { ...f, bundlePath: link }));
  const parent = join(f.root, 'parent'); await symlink(f.root, parent);
  await assert.rejects(stageBundledLinuxHelper(f.runtime, { ...f, bundlePath: join(parent, 'native-helper.json') }), /监督器无效/);
  await symlink(f.root, join(f.runtime, 'bin'));
  await assert.rejects(stageBundledLinuxHelper(f.runtime, f), /监督器无效/);
  await assert.rejects(readFile(join(f.root, 'native/linux-x64/axiom-owner')), { code: 'ENOENT' });
});
