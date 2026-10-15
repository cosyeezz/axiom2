import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { assertPackageReceipt, assertReleaseAssets, assertVersions, compareVersions, existingReleaseStatus, nextVersion, syncVersions, verifyPublicRelease, verifyTag, verifyWithRetry, versionFiles } from './auto-release.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40), commit = 'b'.repeat(40);

test('release versions advance numerically beyond source, public releases and reserved draft tags', () => {
  assert.equal(nextVersion('0.4.1', []), '0.4.2');
  assert.equal(nextVersion('0.4.1', ['v0.4.9', 'v0.4.10', 'v0.4.11']), '0.4.12');
  assert.equal(nextVersion('0.5.0', ['v0.4.99']), '0.5.1');
  assert.equal(nextVersion('0.4.1', ['v1.0.0', 'v2.0.0-beta.1', 'v01.0.0', 'other']), '1.0.1');
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.throws(() => nextVersion('0.4.1-beta', []));
  assert.throws(() => nextVersion('0.4.1', ['v0.4.999999999']));
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'axiom-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of versionFiles) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    const value = file.endsWith('pake.json') ? { appVersion: '0.4.1', name: 'Axiom2' } : { name: '@cosyeezz/axiom2', version: '0.4.1', dependencies: { fixture: '0.4.1' } };
    if (file.endsWith('lock.json') || file.endsWith('shrinkwrap.json')) value.packages = { '': { version: '0.4.1', dependencies: { fixture: '0.4.1' } }, 'node_modules/fixture': { version: '0.4.1', integrity: 'unchanged' } };
    writeFileSync(join(root, file), JSON.stringify(value));
  }
  return root;
}

test('all version fields are synchronized while dependency versions and lock evidence stay unchanged', (t) => {
  const root = fixture(t);
  syncVersions(root, '0.4.2');
  assertVersions(root, '0.4.2');
  for (const file of versionFiles.filter((name) => !name.endsWith('pake.json'))) {
    const value = JSON.parse(readFileSync(join(root, file)));
    assert.equal(value.dependencies.fixture, '0.4.1');
    if (value.packages) assert.deepEqual(value.packages['node_modules/fixture'], { version: '0.4.1', integrity: 'unchanged' });
  }
  const lock = JSON.parse(readFileSync(join(root, 'app/package-lock.json')));
  lock.packages[''].version = '0.4.1';
  writeFileSync(join(root, 'app/package-lock.json'), JSON.stringify(lock));
  assert.throws(() => assertVersions(root, '0.4.2'));
});

test('tag recovery requires the validated parent and only version field changes, even with a matching commit trailer', (t) => {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'core.autocrlf', 'false');
  git('add', '.');
  git('commit', '-m', 'source');
  const parent = git('rev-parse', 'HEAD');
  syncVersions(root, '0.4.2');
  git('add', '.');
  git('commit', '-m', `release\n\nAxiom-Source-Commit: ${parent}`);
  git('tag', 'v0.4.2');
  verifyTag('v0.4.2', parent, root);
  assert.throws(() => verifyTag('v0.4.2', source, root));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  pkg.dependencies.fixture = 'evil';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  git('add', '.');
  git('commit', '--amend', '--no-edit');
  git('tag', '-f', 'v0.4.2');
  assert.throws(() => verifyTag('v0.4.2', parent, root), /fields other than versions/);
});

test('reruns resume absent or draft releases and leave published releases with added desktop assets untouched', () => {
  assert.equal(existingReleaseStatus(undefined, source, commit), 'missing');
  const release = { body: `notes\n\nAxiom-Source-Commit: ${source}\n`, target_commitish: commit, draft: true, prerelease: false, assets: [] };
  assert.equal(existingReleaseStatus(release, source, commit), 'draft');
  release.draft = false;
  release.assets.push({ name: 'Axiom2.dmg' }, { name: 'SHA256SUMS', digest: 'includes desktop' });
  const before = structuredClone(release);
  assert.equal(existingReleaseStatus(release, source, commit), 'published');
  assert.deepEqual(release, before);
  assert.throws(() => existingReleaseStatus({ ...release, body: `prefix Axiom-Source-Commit: ${source}` }, source, commit));
  assert.throws(() => existingReleaseStatus({ ...release, target_commitish: source }, source, commit));
  assert.throws(() => existingReleaseStatus({ ...release, prerelease: true }, source, commit));
});

test('upload requires the exact tarball and commit exercised by package validation', () => {
  const bytes = Buffer.from('validated release archive');
  const state = { version: '0.4.2', commit };
  const receipt = { ...state, size: bytes.length, sha256: digest(bytes) };
  assertPackageReceipt(receipt, state, bytes);
  assert.throws(() => assertPackageReceipt(receipt, state, Buffer.from('modified release archive')));
  assert.throws(() => assertPackageReceipt({ ...receipt, commit: source }, state, bytes));
  assert.throws(() => assertPackageReceipt({ ...receipt, version: '0.4.1' }, state, bytes));
  assert.throws(() => assertPackageReceipt({ ...receipt, size: 0, sha256: digest(Buffer.alloc(0)) }, state, Buffer.alloc(0)));
});

test('release propagation retries reread metadata, preserve the creation identity and stop on persistent failure', async () => {
  const created = { id: 42 };
  let reads = 0, pauses = 0;
  const seen = [];
  const final = await verifyWithRetry(async () => {
    reads++;
    if (reads === 1) throw Error('API propagation');
    return { ...created, digest: reads === 2 ? 'old' : 'current' };
  }, (release) => {
    seen.push(release);
    assert.equal(release.id, created.id);
    assert.equal(release.digest, 'current');
  }, async () => { pauses++; });
  assert.equal(reads, 3);
  assert.equal(pauses, 2);
  assert.equal(final.id, 42);
  assert.deepEqual(seen.map((release) => release.digest), ['old', 'current']);
  let failedReads = 0;
  await assert.rejects(verifyWithRetry(() => { failedReads++; return {}; }, () => { throw Error('still invalid'); }, async () => {}), /still invalid/);
  assert.equal(failedReads, 6);
});

test('published-release retries repeat public verification and accept added desktop checksum entries', async () => {
  const files = { 'axiom2.tgz': Buffer.from('validated backend') };
  files.SHA256SUMS = Buffer.from(`${digest(files['axiom2.tgz'])}  axiom2.tgz\n${'c'.repeat(64)}  Axiom2.dmg\n`);
  const release = { tag_name: 'v0.4.2', draft: false, prerelease: false, assets: Object.entries(files).map(([name, bytes]) => ({ name, state: 'uploaded', size: bytes.length, digest: `sha256:${digest(bytes)}`, browser_download_url: `https://github.com/cosyeezz/axiom2/releases/download/v0.4.2/${name}` })) };
  await assert.rejects(verifyPublicRelease(release, async () => new Response('temporarily unavailable', { status: 503 })), /public download failed/);
  const fetched = [];
  await verifyPublicRelease(release, async (url) => {
    const name = url.split('/').at(-1);
    fetched.push(name);
    return new Response(files[name]);
  });
  assert.deepEqual(fetched, ['axiom2.tgz', 'SHA256SUMS']);
  await assert.rejects(verifyPublicRelease({ ...release, assets: [] }, async () => { throw Error('must validate metadata first'); }), /Expected exactly one/);
  await assert.rejects(verifyPublicRelease(release, async () => new Response('corrupted')), /download exceeds|strictly equal/);
});

test('draft temporary GitHub URLs are accepted only before publication and remain repository-bound', async () => {
  const bytes = Buffer.from('tarball');
  const files = { 'axiom2.tgz': bytes };
  const temporary = 'https://github.com/cosyeezz/axiom2/releases/download/untagged-87c963e0ae172f1789a1/axiom2.tgz';
  const release = { tag_name: 'v0.4.3', draft: true, prerelease: false, assets: [{ name: 'axiom2.tgz', state: 'uploaded', size: bytes.length, digest: `sha256:${digest(bytes)}`, browser_download_url: temporary }] };
  assertReleaseAssets(release, '0.4.3', files);
  assert.throws(() => assertReleaseAssets({ ...release, draft: false }, '0.4.3', files));
  await assert.rejects(verifyPublicRelease({ ...release, draft: false }, async () => { throw Error('must not fetch temporary URL'); }), /strictly equal/);
  for (const url of [temporary.replace('cosyeezz', 'other'), temporary.replace('github.com', 'example.com'), temporary.replace('untagged-', 'v'), temporary + '?download=1', temporary + '/extra', temporary.replace('/axiom2.tgz', '/wrong.tgz'), temporary.replace('https://', 'https://user@')]) {
    const broken = structuredClone(release);
    broken.assets[0].browser_download_url = url;
    assert.throws(() => assertReleaseAssets(broken, '0.4.3', files));
  }
});

test('draft cannot publish with partial, duplicate, incorrectly addressed or corrupted assets', () => {
  const files = { 'axiom2.tgz': Buffer.from('tarball'), SHA256SUMS: Buffer.from('checksum') };
  const release = { tag_name: 'v0.4.2', prerelease: false, assets: Object.entries(files).map(([name, bytes]) => ({ name, state: 'uploaded', size: bytes.length, digest: `sha256:${digest(bytes)}`, browser_download_url: `https://github.com/cosyeezz/axiom2/releases/download/v0.4.2/${name}` })) };
  assertReleaseAssets(release, '0.4.2', files);
  assert.throws(() => assertReleaseAssets({ ...release, assets: release.assets.slice(0, 1) }, '0.4.2', files));
  assert.throws(() => assertReleaseAssets({ ...release, assets: [...release.assets, release.assets[0]] }, '0.4.2', files));
  for (const change of [{ state: 'new' }, { digest: 'sha256:wrong' }, { size: 0 }, { browser_download_url: 'https://example.com/axiom2.tgz' }]) {
    const broken = structuredClone(release);
    Object.assign(broken.assets[0], change);
    assert.throws(() => assertReleaseAssets(broken, '0.4.2', files));
  }
});
