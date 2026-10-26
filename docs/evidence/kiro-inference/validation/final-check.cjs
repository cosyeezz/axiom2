// Run from the repository root. Read-only checks except this directory's result JSON.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.cwd();
assert.ok(fs.existsSync(path.join(root, 'app/package.json')), 'Run from repository root');
const evidence = 'docs/evidence/kiro-inference';
const validation = `${evidence}/validation`;
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const manifest = JSON.parse(read(`${evidence}/manifest.json`));
assert.equal(manifest.files.length, 79);
assert.equal(new Set(manifest.files.map((entry) => entry.path)).size, 79);
let staticBytes = 0;
let dumpbinRuns = 0;
function checkRuns(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.exe === 'string' && /dumpbin\.exe$/i.test(value.exe)) {
    assert.equal(value.status ?? value.exit ?? value.exitCode, 0, 'dumpbin status');
    assert.equal(value.stderr ?? '', '', 'dumpbin stderr');
    dumpbinRuns++;
  }
  for (const child of Object.values(value)) checkRuns(child);
}
for (const entry of manifest.files) {
  assert.ok(!path.isAbsolute(entry.path) && !entry.path.split('/').includes('..'));
  const bytes = fs.readFileSync(path.join(root, evidence, entry.path));
  assert.equal(bytes.length, entry.bytes, `${entry.path}: bytes`);
  assert.equal(hash(bytes), entry.sha256, `${entry.path}: SHA-256`);
  staticBytes += bytes.length;
  if (entry.path.endsWith('.run.json') || entry.path.endsWith('/dumpbin-runs.json')) {
    checkRuns(JSON.parse(bytes.toString('utf8')));
  }
}
assert.ok(dumpbinRuns >= 6, 'No dumpbin run records checked');
const documents = [
  'docs/kiro-auth.md', 'docs/kiro-catalog-audit.md', 'docs/kiro-protocol-audit.md',
  'docs/kiro-inference-audit.md', `${evidence}/README.md`, `${validation}/README.md`,
];
let localLinks = 0;
for (const document of documents) {
  for (const match of read(document).matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const withoutAnchor = decodeURIComponent(target.split('#')[0]);
    const resolved = path.resolve(root, path.dirname(document), withoutAnchor);
    assert.ok(fs.existsSync(resolved), `${document}: missing ${target}`);
    localLinks++;
  }
}
const authored = [
  'app/src/server/providers/kiro-auth.ts', 'app/src/server/providers/kiro-catalog.ts',
  'app/src/server/providers/kiro.ts', 'app/src/server/providers/kiro-chat.ts',
  'app/src/server/providers/kiro-chat-protocol.ts', 'app/src/server/providers/kiro-eventstream.ts',
  'app/src/server/model-runtime.ts', 'app/src/server/model-service.ts',
  'app/src/client/models/ProviderConnection.tsx', 'app/src/client/models/ModelCatalogPicker.tsx',
  'app/tests/kiro-auth.test.ts', 'app/tests/kiro-catalog.test.ts', 'app/tests/kiro-chat.test.ts',
  'app/tests/kiro-runtime.test.ts', 'app/tests/fixtures/kiro-eventstream.ts', 'app/tests/fixtures/kiro-network.cjs',
  'docs/design.md', 'docs/ui-sync.md', ...documents,
  `${validation}/final-check.cjs`,
];
for (const file of authored) {
  const content = read(file);
  assert.ok(!content.split(/\r?\n/).some((line) => /[\t ]+$/.test(line)), `${file}: trailing whitespace`);
  assert.ok(!/^(?:<{7}|={7}|>{7})(?:\s|$)/m.test(content), `${file}: conflict marker`);
}
const diff = spawnSync('git', ['diff', '--check', '--', ...authored], { cwd: root, encoding: 'utf8' });
assert.equal(diff.status, 0, diff.stderr + diff.stdout);
const testCounts = {};
for (const [name, expected] of [['kiro-tests.log', 42], ['compatibility-tests.log', 25]]) {
  const text = read(`${validation}/${name}`).replace(/\u001b\[[0-9;]*m/g, '');
  assert.match(text, new RegExp(`\\btests ${expected}\\b`));
  assert.match(text, new RegExp(`\\bpass ${expected}\\b`));
  assert.match(text, /\bfail 0\b/);
  for (const status of ['cancelled', 'skipped', 'todo']) assert.match(text, new RegExp(`\\b${status} 0\\b`));
  testCounts[name] = expected;
}
assert.match(read(`${validation}/build.log`), /built in/);
assert.equal(fs.statSync(path.join(root, validation, 'server-tsc.log')).size, 0);
const artifacts = {};
for (const name of ['kiro-chat', 'kiro-chat-protocol', 'kiro-eventstream']) {
  const relative = `app/dist/server/providers/${name}.js`;
  const bytes = fs.readFileSync(path.join(root, relative));
  assert.ok(bytes.length > 0);
  artifacts[relative] = { bytes: bytes.length, sha256: hash(bytes) };
}
const result = {
  status: 'passed', checkedAt: new Date().toISOString(),
  staticFiles: manifest.files.length, staticBytes, dumpbinRuns, localLinks,
  authoredWhitespaceFiles: authored.length, scopedGitDiffCheckExit: diff.status,
  testCounts, artifacts,
  limitations: 'Static/mock only. No live credentials/API, UI end-to-end, deployment, restart or commit. Build artifacts are untracked outputs; hashes identify this local build only.',
};
fs.writeFileSync(path.join(root, validation, 'final-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
