import test from 'node:test';
import assert from 'node:assert/strict';
import { CERT, sha256, parseSums, verifyBinary, verifyAndroid, verifyRun, verifySourceLogs, verifySourceJobLog, sourceJobLogArgs, selectArtifact } from '../../scripts/publish-clients.mjs';

test('release artifacts are selected only inside their required run', () => {
  const name = 'Axiom2-macOS-publish-evidence';
  const desktop = [{ name, id: 11 }], mac = [{ name, id: 22 }];
  assert.equal(selectArtifact(mac, name).id, 22);
  assert.equal(selectArtifact(desktop, name).id, 11);
  assert.throws(() => selectArtifact([], name), 'foreign same-name evidence cannot replace missing mac evidence');
  assert.throws(() => selectArtifact([...mac, ...mac], name));
});

const source = 'a'.repeat(40);
const zip = () => { const bytes = Buffer.alloc(80); bytes.write('PK\x03\x04', 'binary'); return bytes; };
function androidFixture() {
  const files = new Map([['Axiom2-Android.apk', zip()], ['axiom2-android-sdk.aar', zip()]]);
  const proof = { source, version: '0.4.18', versionCode: 4018, packageName: 'com.axiom2.android', minSdk: 26, targetSdk: 35, debuggable: false, certificateSha256: CERT, files: Object.fromEntries([...files].map(([name, data]) => [name, { size: data.length, sha256: sha256(data) }])) };
  return { files, proof };
}
test('release sums accept exact hashes and CRLF without losing backend entries', () => {
  const sums = parseSums(`${'1'.repeat(64)}  axiom2.tgz\r\n${'2'.repeat(64)}  Axiom2.dmg\r\n`);
  assert.deepEqual([...sums.keys()], ['axiom2.tgz', 'Axiom2.dmg']);
});
test('release sums reject duplicates, traversal, malformed hashes and empty manifests', () => {
  for (const text of ['', `${'a'.repeat(64)}  ../x`, `${'a'.repeat(64)}  .`, `${'A'.repeat(64)}  bad`, `${'a'.repeat(64)}  x\n${'b'.repeat(64)}  x\n`]) assert.throws(() => parseSums(text));
});
test('release Windows binary must be PE x64 and MSI must be compound storage', () => {
  const exe = Buffer.alloc(128); exe.write('MZ'); exe.writeUInt32LE(64, 0x3c); exe.writeUInt32LE(0x4550, 64); exe.writeUInt16LE(0x8664, 68);
  verifyBinary(exe, 'exe'); exe.writeUInt16LE(0x14c, 68); assert.throws(() => verifyBinary(exe, 'exe'));
  exe.writeUInt32LE(0xffffffff, 0x3c); assert.throws(() => verifyBinary(exe, 'exe'));
  const msi = Buffer.alloc(80); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(msi); verifyBinary(msi, 'msi');
  assert.throws(() => verifyBinary(zip(), 'msi'));
});
test('release Linux binaries preserve architecture and DEB archive format', () => {
  for (const [arch, machine] of [['x64', 62], ['arm64', 183]] as const) {
    const elf = Buffer.alloc(80); Buffer.from('7f454c460201', 'hex').copy(elf); elf.writeUInt16LE(machine, 18);
    verifyBinary(elf, arch); assert.throws(() => verifyBinary(elf, arch === 'x64' ? 'arm64' : 'x64'));
    elf[4] = 1; assert.throws(() => verifyBinary(elf, arch));
  }
  const deb = Buffer.alloc(80); deb.write('!<arch>\n'); verifyBinary(deb, 'deb'); assert.throws(() => verifyBinary(zip(), 'deb'));
});
test('release Android proof binds original certificate, tag, source and actual hashes', () => {
  const { files, proof } = androidFixture(); verifyAndroid(proof, files, 'v0.4.18', source);
  assert.equal(CERT.length, 64);
  for (const changes of [{ source: 'b'.repeat(40) }, { version: '0.4.17' }, { versionCode: 4017 }, { debuggable: true }, { certificateSha256: 'c'.repeat(64) }, { packageName: 'example.test' }, { minSdk: 25 }, { targetSdk: 34 }]) assert.throws(() => verifyAndroid({ ...proof, ...changes }, files, 'v0.4.18', source));
});
test('release Android refuses old version, changed bytes, absent APK and extra proof files', () => {
  const { files, proof } = androidFixture(); assert.throws(() => verifyAndroid(proof, files, 'v0.4.12', source));
  assert.throws(() => verifyAndroid({ ...proof, files: { ...proof.files, 'other.apk': {} } }, files, 'v0.4.18', source));
  files.get('Axiom2-Android.apk')![20] = 1; assert.throws(() => verifyAndroid(proof, files, 'v0.4.18', source));
  const fresh = androidFixture(); fresh.files.delete('Axiom2-Android.apk'); assert.throws(() => verifyAndroid(fresh.proof, fresh.files, 'v0.4.18', source));
});
test('release run must be successful manual run of the exact repository workflow', () => {
  const run = { path: '.github/workflows/desktop.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', repository: { full_name: 'cosyeezz/axiom2' } };
  verifyRun(run, 'desktop');
  for (const changes of [{ event: 'pull_request' }, { conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/ci.yml' }, { repository: { full_name: 'other/axiom2' } }]) assert.throws(() => verifyRun({ ...run, ...changes }, 'desktop'));
});
test('source log API enables raw escape bytes only when supported and preserves job identity', () => {
  assert.deepEqual(sourceJobLogArgs(123, 'FLAGS\n  --allow-escape-sequences  Allow terminal escape sequences\n'), ['api', 'repos/cosyeezz/axiom2/actions/jobs/123/logs', '--allow-escape-sequences']);
  assert.deepEqual(sourceJobLogArgs(123, 'FLAGS\n  --include  Include headers\n'), ['api', 'repos/cosyeezz/axiom2/actions/jobs/123/logs']);
  assert.deepEqual(sourceJobLogArgs(123, '--allow-escape-sequences-other'), ['api', 'repos/cosyeezz/axiom2/actions/jobs/123/logs']);
  for (const id of [0, -1, 1.5, NaN, '123/logs']) assert.throws(() => sourceJobLogArgs(id, ''));
});

test('raw source proof requires the successful job step and the sole exact command output', () => {
  const job = { conclusion: 'success', steps: [{ name: 'Record source revision', conclusion: 'success' }] };
  const raw = (body: string[]) => body.map(line => `2026-10-26T08:31:51.9530618Z ${line}`).join('\r\n');
  const lines = [source, '##[group]Run git rev-parse HEAD', '\u001b[36;1mgit rev-parse HEAD\u001b[0m', 'shell: bash -e {0}', '##[endgroup]', source, '##[group]Run next step', '##[endgroup]'];
  verifySourceJobLog(raw(lines), source, job);
  verifySourceJobLog('\uFEFF' + raw(lines) + '\nunprefixed multiline input from another step', source, job);
  for (const bad of [
    [],
    [source],
    lines.map((line, index) => index === 5 ? 'b'.repeat(40) : line),
    lines.filter((_, index) => index !== 4),
    lines.flatMap((line, index) => index === 5 ? [line, source] : [line]),
    lines.map(line => line === '##[group]Run git rev-parse HEAD' ? '##[group]Run echo git rev-parse HEAD' : line),
    [...lines, ...lines],
  ]) assert.throws(() => verifySourceJobLog(raw(bad), source, job));
  assert.throws(() => verifySourceJobLog(raw(lines), source, { ...job, conclusion: 'failure' }));
  assert.throws(() => verifySourceJobLog(raw(lines), source, { ...job, steps: [] }));
  assert.throws(() => verifySourceJobLog(raw(lines), source, { ...job, steps: [...job.steps, ...job.steps] }));
  assert.throws(() => verifySourceJobLog(raw(lines), source, { ...job, steps: [{ name: 'Record source revision', conclusion: 'skipped' }] }));
  assert.throws(() => verifySourceJobLog('not timestamped', source, job));
});

test('release checks every checkout source, not just workflow head SHA or one matching job', () => {
  const line = (job: string, sha = source) => `${job}\tRecord source revision\t2026-10-25T12:00:00Z ${sha}\n`;
  const desktop = ['win', 'mac', 'x64', 'arm64'].map(name => line(name)).join('');
  verifySourceLogs(desktop, source, 4);
  verifySourceLogs(desktop, source, ['win', 'mac', 'x64', 'arm64']);
  assert.throws(() => verifySourceLogs(line('win').repeat(4), source, 4));
  assert.throws(() => verifySourceLogs(desktop, source, ['win', 'mac', 'x64', 'other']));
  assert.throws(() => verifySourceLogs(desktop, source, 1));
  assert.throws(() => verifySourceLogs(line('win') + line('mac', 'b'.repeat(40)) + line('x64') + line('arm64'), source, 4));
  assert.throws(() => verifySourceLogs('', source, 4));
});
