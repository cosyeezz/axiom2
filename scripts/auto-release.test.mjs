import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { diagnosticSignals, packageFailureEvidence, reportPackageFailure } from './package-failure-evidence.mjs';
import { gzipSync } from 'node:zlib';
import { assertNativeArchive } from './release-native.mjs';
import { assertReleaseIdentity, assertNativeReceipts, nativeReleaseNames, assertPackageReceipt, assertReleaseAssets, assertVersions, compareVersions, existingReleaseStatus, nextVersion, syncVersions, verifyPublicRelease, verifyTag, verifyWithRetry, versionFiles } from './auto-release.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40), commit = 'b'.repeat(40);

test('every Linux isolation consumer configures the runner before execution', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobs = workflow.split(/(?=^  [a-z]+:\s*$)/m);
  for (const job of ['native', 'validate', 'package', 'publish']) {
    const block = jobs.find((entry) => entry.startsWith(`  ${job}:\n`));
    assert.ok(block, `Missing ${job} job`);
    const configure = block.indexOf('sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0');
    const execute = block.indexOf(job === 'native' ? 'node --test native/owner.test.mjs' : 'npm ci');
    assert.ok(configure >= 0 && configure < execute, `${job} must enable namespaces before building or testing`);
    assert.ok(block.includes('if test -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns; then'), `${job} must tolerate kernels without the AppArmor sysctl`);
    if (job === 'validate' || job === 'package') {
      assert.match(block, /- name: Configure Linux namespace test environment\n        if: runner\.os == 'Linux'/, `${job} must not run Linux configuration on other platforms`);
    }
  }
});

test('CI explicitly permits fetching native archive fixture dependencies before offline tests', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- run: npm test\n        env:\n          AXIOM_TEST_CARGO_FETCH: '1'/);
});

test('Windows Node 22 package validation has bounded time for installation and cleanup', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const block = workflow.split(/(?=^  [a-z]+:\s*$)/m).find((entry) => entry.startsWith('  package:\n'));
  assert.ok(block, 'Missing package job');
  assert.match(block, /timeout-minutes: \$\{\{ matrix\.os == 'windows-latest' && matrix\.node == '22\.19\.0' && 45 \|\| 30 \}\}/);
  assert.match(block, /- run: npm ci\n      - run: npm run check:package/);
});

function nativeBuildFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'axiom-release-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, bytes = 'fixture') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  put('.gitignore', readFileSync(new URL('../.gitignore', import.meta.url)));
  put('package.json', readFileSync(new URL('../package.json', import.meta.url)));
  put('native/axiom-owner.c');
  put('bin/service.mjs');
  const generated = ['x64', 'arm64'].flatMap(arch => ['axiom-owner', 'manifest.json'].map(name => `bin/native/linux-${arch}/${name}`));
  return { root, put, generated };
}

test('release clean gates ignore only generated helpers and retain tracked and unexpected changes', (t) => {
  const { root, put, generated } = nativeBuildFixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const status = () => git('status', '--porcelain');
  git('init');
  git('config', 'core.autocrlf', 'false');
  git('add', '.gitignore', 'package.json', 'native/axiom-owner.c', 'bin/service.mjs');
  git('commit', '-m', 'source');
  assert.equal(status(), '');
  for (const path of generated) put(path);
  assert.equal(status(), '', 'both architectures may be built or downloaded before publish');
  for (const path of ['native/axiom-owner.c', 'bin/service.mjs']) {
    put(path, 'changed source');
    assert.notEqual(status(), '', `${path} must remain visible`);
    git('add', path);
    assert.notEqual(status(), '', `${path} must remain visible when staged`);
    put(path);
    git('add', path);
    assert.equal(status(), '');
  }
  for (const path of ['bin/native/new-source.c', 'bin/native/linux-x64/payload', 'bin/native/linux-arm64/axiom-owner.123.tmp', 'bin/native/linux-other/axiom-owner', 'elsewhere/bin/native/linux-x64/axiom-owner', 'unexpected']) {
    put(path);
    assert.notEqual(status(), '', `${path} must not be hidden by generated-file rules`);
    rmSync(join(root, path));
    assert.equal(status(), '');
  }
  git('add', '-f', generated[0]);
  git('commit', '-m', 'track a helper to verify ignored paths cannot hide tracked changes');
  put(generated[0], 'changed tracked helper');
  assert.notEqual(status(), '', 'ignore rules must not suppress tracked helper modifications');
});

test('npm pack retains both native helpers and manifests despite generated-file ignore rules', (t) => {
  const { root, put, generated } = nativeBuildFixture(t);
  // Exercise the real package inclusion rules, not build hooks absent from this fixture.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  delete pkg.scripts;
  put('package.json', JSON.stringify(pkg));
  for (const path of generated) put(path);
  // Fixed arguments only: Windows requires a shell to execute npm.cmd.
  const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32',
    env: { ...process.env, npm_config_cache: join(root, '.npm-cache') },
  });
  const [packed] = JSON.parse(output);
  const files = new Set(packed.files.map(file => file.path));
  for (const path of generated) assert.ok(files.has(path), `${path} must remain in the release package`);
});

function evidenceFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'axiom-package-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = '11111111-1111-4111-8111-111111111111';
  const commandId = '22222222-2222-4222-8222-222222222222';
  const serviceId = '33333333-3333-4333-8333-333333333333';
  const task = { id, attemptId: 'attempt-fixture', status: 'unknown', phase: 'installing', error: { code: 'stop-unconfirmed', message: 'Ownership retained' }, capabilities: { cancel: false, extend: false } };
  const job = { phase: 'interrupted', running: false, task };
  const taskPath = `tasks/${id}`;
  const put = (path, value) => {
    const target = join(root, 'updates', path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    return target;
  };
  const manifest = { taskId: id, attemptId: task.attemptId, gateId: 'DO_NOT_PRINT_OWNER', token: 'DO_NOT_PRINT_MANIFEST_TOKEN', parentWitness: { ready: true }, serviceResolved: false, commands: [{ id: commandId, state: 'registered' }], services: [{ id: serviceId, state: 'armed', requestStopped: false }] };
  put(`${taskPath}/task.json`, task);
  put(`${taskPath}/supervision.json`, manifest);
  put('process-owner.json', { id: 'DO_NOT_PRINT_OWNER' });
  put(`${taskPath}/parent-request.json`, { nonce: 'parent-nonce', parentPid: 42 });
  put(`${taskPath}/parent-ready.json`, { nonce: 'parent-nonce', parentPid: 42 });
  put(`${taskPath}/command-${commandId}/request.json`, { nonce: 'command-nonce', env: { API_KEY: 'DO_NOT_PRINT_ENV' }, args: ['DO_NOT_PRINT_ARGS'] });
  return { root, job, task, taskPath, commandId, serviceId, manifest, put };
}

test('package failure evidence separates stored state and receipt proofs without copying secrets or output', async (t) => {
  const f = evidenceFixture(t);
  const db = new DatabaseSync(join(f.root, 'updates/jobs.sqlite'));
  try {
    db.exec('CREATE TABLE job (id INTEGER PRIMARY KEY, body TEXT, token TEXT)');
    db.prepare('INSERT INTO job VALUES (1, ?, ?)').run(JSON.stringify({ phase: 'installing', running: false, task: { ...f.task, status: 'failed' }, auth: 'DO_NOT_PRINT_AUTH' }), 'DO_NOT_PRINT_DB_TOKEN');
  } finally { db.close(); }
  f.put(`${f.taskPath}/parent-exited.json`, { nonce: 'parent-nonce', parentPid: 42, exited: true });
  f.put(`${f.taskPath}/command-${f.commandId}/ready.json`, { nonce: 'command-nonce', pid: 123 });
  f.put(`${f.taskPath}/command-${f.commandId}/cleaned.json`, { nonce: 'command-nonce', reason: 'exited', code: 1, writerStopped: true, parentExited: false });
  f.put(`${f.taskPath}/command-${f.commandId}/result.json`, { nonce: 'command-nonce', ok: false, output: 'DO_NOT_PRINT_OUTPUT', error: { code: 'operation', message: 'https://host.invalid/private Bearer PRIVATE_BEARER token=PRIVATE_TOKEN' } });
  const evidence = await packageFailureEvidence({ root: f.root, job: f.job, strategy: 'hoisted' });
  assert.equal(evidence.projected.phase, 'interrupted');
  assert.equal(evidence.stored.job.phase, 'installing');
  assert.equal(evidence.stored.job.task.status, 'failed');
  assert.equal(evidence.task.identityMatches, true);
  assert.equal(evidence.supervision.identityMatches, true);
  assert.equal(evidence.owner.state, 'ok');
  assert.equal(evidence.owner.gateMatches, true);
  assert.equal(evidence.parent.ready.nonceMatches, true);
  assert.equal(evidence.parent.ready.pidMatches, true);
  assert.equal(evidence.parent.exited.exited, true);
  assert.equal(evidence.parent.exited.pidMatches, true);
  assert.equal(evidence.commands[0].state, 'registered');
  assert.equal(evidence.commands[0].cleaned.writerStopped, true);
  assert.equal(evidence.commands[0].cleaned.code, 1);
  assert.equal(evidence.commands[0].result.ok, false);
  assert.equal(evidence.services[0].requestStopped, false);
  assert.doesNotMatch(JSON.stringify(evidence), /DO_NOT_PRINT|PRIVATE_|parent-nonce|command-nonce/);
});

test('package diagnostics distinguish parent readiness, command cleanup, service stop and final gate failures', async (t) => {
  const f = evidenceFixture(t);
  f.manifest.parentWitness.ready = false;
  f.manifest.commands = [];
  f.manifest.services = [];
  f.put(`${f.taskPath}/supervision.json`, f.manifest);
  f.put(`${f.taskPath}/parent-ready.json`, { nonce: 'wrong', parentPid: 99 });
  let evidence = await packageFailureEvidence({ root: f.root, job: f.job, strategy: 'nested' });
  assert.equal(evidence.supervision.parentReady, false);
  assert.equal(evidence.parent.ready.nonceMatches, false);
  assert.equal(evidence.parent.ready.pidMatches, false);
  assert.deepEqual(evidence.commands, []);
  f.manifest.parentWitness.ready = true;
  f.manifest.commands = [{ id: f.commandId, state: 'registered' }];
  f.manifest.services = [{ id: f.serviceId, state: 'armed', requestStopped: false }];
  f.put(`${f.taskPath}/supervision.json`, f.manifest);
  evidence = await packageFailureEvidence({ root: f.root, job: f.job, strategy: 'nested' });
  assert.equal(evidence.commands[0].cleaned.state, 'absent');
  assert.equal(evidence.services[0].requestStopped, false);
  f.manifest.commands[0].state = 'cleaned';
  f.manifest.services[0] = { id: f.serviceId, state: 'closed', requestStopped: true };
  f.manifest.serviceResolved = true;
  f.put(`${f.taskPath}/supervision.json`, f.manifest);
  evidence = await packageFailureEvidence({ root: f.root, job: f.job, strategy: 'recover' });
  assert.equal(evidence.commands[0].state, 'cleaned');
  assert.equal(evidence.services[0].requestStopped, true);
  assert.equal(evidence.supervision.serviceResolved, true);
  assert.equal(evidence.owner.state, 'ok', 'retained gate is still reported after otherwise resolved work');
});

test('diagnostic signals never return free text, command arguments or arbitrary credentials', () => {
  const raw = '\x1b[31mParserError\x1b[0m OpenProcess access denied timeout https://host.invalid/private Bearer PRIVATE_BEARER API_KEY=PRIVATE_ASSIGNMENT {"password":"PRIVATE_PASSWORD","authorization":"PRIVATE_AUTH"} ghp_PRIVATE_GITHUB sk-PRIVATE_PROVIDER eyJprivate.payload.signature --password hunter2 --token abcDEF123 Authorization: Basic PRIVATE_BASIC\x00';
  assert.deepEqual(diagnosticSignals(raw), ['timeout', 'accessDenied', 'powershellParser', 'processHandle']);
  assert.deepEqual(diagnosticSignals('DO_NOT_PRINT'.repeat(10000)), []);
  assert.equal(diagnosticSignals(null), undefined);
});

test('package diagnostics handle absent, corrupt, oversized and linked evidence without following it', async (t) => {
  const f = evidenceFixture(t);
  f.put(`${f.taskPath}/task.json`, 'invalid JSON');
  f.put(`${f.taskPath}/command-${f.commandId}/ready.json`, Buffer.alloc(524289, 120));
  const outside = join(f.root, 'outside.json');
  writeFileSync(outside, '{"nonce":"DO_NOT_PRINT_LINK"}');
  linkSync(outside, join(f.root, 'updates', f.taskPath, `command-${f.commandId}`, 'result.json'));
  const evidence = await packageFailureEvidence({ root: f.root, job: f.job, strategy: 'hoisted' });
  assert.equal(evidence.task.state, 'invalid');
  assert.equal(evidence.stored.state, 'unavailable');
  assert.equal(evidence.commands[0].ready.state, 'oversized');
  assert.equal(evidence.commands[0].cleaned.state, 'absent');
  assert.equal(evidence.commands[0].result.state, 'unsafe');
  const invalid = await packageFailureEvidence({ root: f.root, job: { task: { id: '../../outside' } }, strategy: 'DO_NOT_PRINT_STRATEGY' });
  assert.equal(invalid.task.state, 'invalid-id');
  assert.equal(invalid.strategy, undefined);
  assert.doesNotMatch(JSON.stringify(invalid), /DO_NOT_PRINT/);
});

test('package diagnostics reject evidence reached through an external directory link', async (t) => {
  const f = evidenceFixture(t);
  const directory = join(f.root, 'outside');
  mkdirSync(directory);
  writeFileSync(join(directory, 'result.json'), '{"nonce":"DO_NOT_PRINT_EXTERNAL"}');
  const command = join(f.root, 'updates', f.taskPath, `command-${f.commandId}`);
  rmSync(command, { recursive: true });
  // Directory junctions do not need Windows Developer Mode or symlink rights.
  symlinkSync(directory, command, process.platform === 'win32' ? 'junction' : 'dir');
  const evidence = await packageFailureEvidence({ root: f.root, job: f.job });
  assert.equal(evidence.commands[0].result.state, 'unsafe');
  assert.doesNotMatch(JSON.stringify(evidence), /DO_NOT_PRINT/);
});

test('package diagnostics reject an updates directory replaced by a link', async (t) => {
  const f = evidenceFixture(t);
  const external = join(f.root, 'external');
  mkdirSync(external);
  rmSync(join(f.root, 'updates'), { recursive: true });
  symlinkSync(external, join(f.root, 'updates'), process.platform === 'win32' ? 'junction' : 'dir');
  const evidence = await packageFailureEvidence({ root: f.root, job: f.job });
  assert.equal(evidence.state, 'unsafe-root');
});

test('package failure reporting keeps valid bounded JSON and cannot mask the original assertion', async (t) => {
  const f = evidenceFixture(t);
  f.manifest.commands = Array.from({ length: 20 }, (_, index) => ({ id: f.commandId, state: index === 19 ? 'cleaned' : 'registered' }));
  f.put(`${f.taskPath}/supervision.json`, f.manifest);
  f.put(`${f.taskPath}/command-${f.commandId}/request.json.stderr`, '界'.repeat(10000));
  const lines = [];
  await reportPackageFailure({ root: f.root, job: f.job }, line => lines.push(line));
  assert.equal(lines.length, 1);
  const serialized = lines[0].slice('PACKAGE_FAILURE_EVIDENCE '.length);
  assert.ok(Buffer.byteLength(serialized) <= 32768);
  const evidence = JSON.parse(serialized);
  assert.equal(evidence.truncated, true);
  assert.equal(evidence.commandCount, 20);
  assert.equal(evidence.commands.length, 12);
  assert.equal(evidence.commands.at(-1).state, 'cleaned');
  assert.doesNotMatch(serialized, /界/);
  await reportPackageFailure({ root: f.root, job: f.job }, () => { throw Error('DO_NOT_PRINT_EMITTER'); });
  const original = Error('original assertion');
  await assert.rejects(async () => {
    await reportPackageFailure({ root: join(f.root, 'missing'), job: f.job }, () => { throw Error('diagnostic failed'); });
    throw original;
  }, error => error === original);
  const fallback = [];
  await reportPackageFailure({ root: join(f.root, 'missing') }, line => fallback.push(line));
  assert.deepEqual(fallback, ['PACKAGE_FAILURE_EVIDENCE {"state":"unavailable"}']);
});

test('release versions advance numerically beyond source, public releases and reserved draft tags', () => {
  assert.equal(nextVersion('0.4.1', []), '0.4.2');
  assert.equal(nextVersion('0.4.1', ['v0.4.9', 'v0.4.10', 'v0.4.11']), '0.4.12');
  assert.equal(nextVersion('0.4.1', ['v0.4.17', 'android-v0.4.18']), '0.4.19');
  assert.equal(nextVersion('0.4.1', ['android-v0.4.9', 'android-v0.4.18', 'v0.4.20']), '0.4.21');
  assert.equal(nextVersion('0.4.1', ['v0.4.17', 'android-v2.0.0-beta.1', 'android-v01.0.0', '0.9.0']), '0.4.18');
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

test('release rereads retain tag, provenance, commit and expected visibility', () => {
  const release = { id: 42, tag_name: 'v0.4.2', body: `Axiom-Source-Commit: ${source}`, target_commitish: commit, draft: true, prerelease: false };
  assertReleaseIdentity(structuredClone(release), release, source, commit, 'draft');
  for (const change of [{ id: 43 }, { tag_name: 'v0.4.3' }, { body: '' }, { target_commitish: source }, { draft: false }, { prerelease: true }])
    assert.throws(() => assertReleaseIdentity({ ...release, ...change }, release, source, commit, 'draft'));
  assertReleaseIdentity({ ...release, draft: false }, release, source, commit, 'published');
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

test('standalone native assets must match both validated tarball receipts and ELF architecture', () => {
  const files = Object.fromEntries(nativeReleaseNames.map((name, index) => {
    const bytes = Buffer.alloc(64); Buffer.from('7f454c460201', 'hex').copy(bytes); bytes.writeUInt16LE(index === 0 ? 62 : 183, 18); return [name, bytes];
  }));
  const receipt = { native: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { size: bytes.length, sha256: digest(bytes) }])) };
  assertNativeReceipts(receipt, files);
  assert.throws(() => assertNativeReceipts({}, files), /unvalidated/);
  assert.throws(() => assertNativeReceipts(receipt, { ...files, [nativeReleaseNames[1]]: files[nativeReleaseNames[0]] }), /architecture/);
  const changed = Buffer.from(files[nativeReleaseNames[0]]); changed[63] = 1;
  assert.throws(() => assertNativeReceipts(receipt, { ...files, [nativeReleaseNames[0]]: changed }), /differs/);
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

function tarArchive(entries) {
  const blocks = [];
  for (const { name, bytes, type = '0', mode = 0o644, magic = 'ustar\0', version = '00' } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.fill(32, 148, 156); header.write(type, 156, 1); header.write(magic, 257, 6); header.write(version, 263, 2);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function releaseFixture() {
  const entries = [{ name: 'package/package.json', bytes: Buffer.from(JSON.stringify({ name: '@cosyeezz/axiom2', version: '0.4.2' })) }];
  const files = {};
  for (const [index, arch] of ['x64', 'arm64'].entries()) {
    const bytes = Buffer.alloc(64); Buffer.from('7f454c460201', 'hex').copy(bytes); bytes.writeUInt16LE(index === 0 ? 62 : 183, 18);
    const path = `package/bin/native/linux-${arch}`;
    files[`axiom-owner-linux-${arch}`] = bytes;
    entries.push({ name: `${path}/axiom-owner`, bytes, mode: 0o755 }, { name: `${path}/manifest.json`, bytes: Buffer.from(JSON.stringify({ protocol: 1, arch, sha256: digest(bytes) })) });
  }
  files['axiom2.tgz'] = tarArchive(entries);
  return { files, entries };
}

test('published native assets are bound to regular executable tarball entries and manifests', () => {
  const { files, entries } = releaseFixture();
  assertNativeArchive(files['axiom2.tgz'], files, '0.4.2');
  const changed = Buffer.from(files[nativeReleaseNames[0]]); changed[63] = 1;
  assert.throws(() => assertNativeArchive(files['axiom2.tgz'], { ...files, [nativeReleaseNames[0]]: changed }, '0.4.2'), /differs from tarball/);
  assert.throws(() => assertNativeArchive(files['axiom2.tgz'], files, '0.4.3'));
  assert.throws(() => assertNativeArchive(tarArchive(entries.slice(0, -1)), files, '0.4.2'), /Missing tar entry/);
  const helper = entries[1];
  assert.throws(() => assertNativeArchive(tarArchive([...entries, { ...helper, name: helper.name.replace('/bin/', '//bin/./') }]), files, '0.4.2'), /duplicate/);
  assert.throws(() => assertNativeArchive(tarArchive(entries.map(item => item === helper ? { ...item, type: '2' } : item)), files, '0.4.2'), /Unsupported tar entry type|regular file/);
  assert.throws(() => assertNativeArchive(tarArchive(entries.map(item => item === helper ? { ...item, mode: 0o644 } : item)), files, '0.4.2'), /executable mode/);
  assert.throws(() => assertNativeArchive(tarArchive([...entries, { name: 'package/bin', type: '2', bytes: Buffer.alloc(0) }]), files, '0.4.2'), /Unsupported tar entry type|directory ancestor/);
  const manifest = entries[2];
  assert.throws(() => assertNativeArchive(tarArchive(entries.map(item => item === manifest ? { ...item, bytes: Buffer.from('{"protocol":1,"arch":"x64","sha256":"wrong"}') } : item)), files, '0.4.2'));
  // npm tarballs may carry a PAX path override: verify the effective path.
  const field = `path=${helper.name}\n`;
  let length = Buffer.byteLength(field) + 2;
  while (length !== Buffer.byteLength(`${length} ${field}`)) length = Buffer.byteLength(`${length} ${field}`);
  const pax = { name: 'PaxHeader', type: 'x', bytes: Buffer.from(`${length} ${field}`) };
  assertNativeArchive(tarArchive([entries[0], pax, { ...helper, name: 'placeholder' }, ...entries.slice(2)]), files, '0.4.2');
  assert.throws(() => assertNativeArchive(tarArchive([...entries, { ...pax, type: 'X' }, { name: 'placeholder', bytes: Buffer.from('BAD') }]), files, '0.4.2'), /Unsupported tar entry type/);
  const long = { name: 'LongLink', type: 'L', bytes: Buffer.from('package/elsewhere\0') };
  for (const metadata of [[pax, long], [long, pax]])
    assert.throws(() => assertNativeArchive(tarArchive([entries[0], ...metadata, { ...helper, name: 'placeholder' }, ...entries.slice(2)]), files, '0.4.2'), /Conflicting tar path/);
  assert.throws(() => assertNativeArchive(tarArchive(entries.map(item => item === helper ? { ...item, name: item.name + '/' } : item)), files, '0.4.2'), /directory path/);
  assert.throws(() => assertNativeArchive(tarArchive([...entries, { name: 'package/extra/', type: '5', bytes: Buffer.alloc(512) }]), files, '0.4.2'), /directory must have no data/);
  assert.throws(() => assertNativeArchive(tarArchive(entries.map(item => item === helper ? { ...item, magic: '', version: '' } : item)), files, '0.4.2'), /header format/);
  const nulField = `path=${helper.name}\0suffix\n`;
  let nulLength = Buffer.byteLength(nulField) + 2;
  while (nulLength !== Buffer.byteLength(`${nulLength} ${nulField}`)) nulLength = Buffer.byteLength(`${nulLength} ${nulField}`);
  assert.throws(() => assertNativeArchive(tarArchive([...entries, { ...pax, bytes: Buffer.from(`${nulLength} ${nulField}`) }, { name: 'placeholder', bytes: Buffer.from('BAD') }]), files, '0.4.2'), /Unsafe PAX control character/);
  for (const [key, value] of [['path', ''], ['path', 'package/elsewhere\n'], ['uname', `ignored\n120 path=${helper.name}\n`]]) {
    const field = `${key}=${value}\n`;
    let length = Buffer.byteLength(field) + 2;
    while (length !== Buffer.byteLength(`${length} ${field}`)) length = Buffer.byteLength(`${length} ${field}`);
    assert.throws(() => assertNativeArchive(tarArchive([...entries, { ...pax, bytes: Buffer.from(`${length} ${field}`) }, { ...helper, bytes: Buffer.from('BAD') }]), files, '0.4.2'), /Unsafe PAX|Empty PAX/);
  }
});

test('published-release retries repeat public verification and accept added desktop checksum entries', async () => {
  const { files } = releaseFixture();
  files.SHA256SUMS = Buffer.from(Object.entries(files).map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join('') + `${'c'.repeat(64)}  Axiom2.dmg\n`);
  const release = { tag_name: 'v0.4.2', draft: false, prerelease: false, assets: Object.entries(files).map(([name, bytes]) => ({ name, state: 'uploaded', size: bytes.length, digest: `sha256:${digest(bytes)}`, browser_download_url: `https://github.com/cosyeezz/axiom2/releases/download/v0.4.2/${name}` })) };
  await assert.rejects(verifyPublicRelease(release, async () => new Response('temporarily unavailable', { status: 503 })), /public download failed/);
  const fetched = [];
  await verifyPublicRelease(release, async (url) => {
    const name = url.split('/').at(-1);
    fetched.push(name);
    return new Response(files[name]);
  });
  assert.deepEqual(fetched, ['axiom2.tgz', 'SHA256SUMS', ...nativeReleaseNames]);
  const substituted = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes)]));
  substituted[nativeReleaseNames[0]][63] = 1;
  substituted.SHA256SUMS = Buffer.from(['axiom2.tgz', ...nativeReleaseNames].map(name => `${digest(substituted[name])}  ${name}\n`).join(''));
  const altered = structuredClone(release);
  for (const asset of altered.assets) { asset.size = substituted[asset.name].length; asset.digest = `sha256:${digest(substituted[asset.name])}`; }
  await assert.rejects(verifyPublicRelease(altered, async url => new Response(substituted[url.split('/').at(-1)])), /differs from tarball/);
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
