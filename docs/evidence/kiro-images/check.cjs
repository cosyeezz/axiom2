// Offline image implementation evidence checks. Run from any cwd after tests/build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const here = __dirname, root = path.resolve(here, '../../..');
const at = relative => path.resolve(root, relative);
const read = relative => fs.readFileSync(at(relative), 'utf8');
const json = name => JSON.parse(read(`docs/evidence/kiro-images/${name}`).replace(/^\uFEFF/, ''));
const sha = relative => crypto.createHash('sha256').update(fs.readFileSync(at(relative))).digest('hex');
const sources = [
  'app/src/server/providers/kiro-chat-protocol.ts', 'app/src/server/providers/kiro-catalog.ts',
  'app/src/server/providers/kiro.ts', 'app/src/server/model-service.ts',
  'app/tests/kiro-images.test.ts', 'app/tests/kiro-chat.test.ts', 'app/tests/kiro-catalog.test.ts',
  'app/tests/kiro-runtime.test.ts', 'app/tests/fixtures/kiro-network.cjs',
];
const docs = [
  'docs/kiro-images.md', 'docs/kiro-auth.md', 'docs/kiro-catalog-audit.md',
  'docs/kiro-inference-audit.md', 'docs/kiro-cli-parity-audit.md',
  'docs/evidence/kiro-images/README.md', 'docs/evidence/kiro-cli-parity/README.md',
];
function tap(log, count, passed) {
  const content = read(`docs/evidence/kiro-images/${log}`);
  // Node selects spec or TAP reporter depending on the captured terminal.
  assert.match(content, new RegExp(`^(?:#|ℹ) tests ${count}\\b`, 'm'));
  assert.match(content, new RegExp(`^(?:#|ℹ) pass ${passed}\\b`, 'm'));
  assert.match(content, new RegExp(`^(?:#|ℹ) fail ${count - passed}\\b`, 'm'));
}
assert.equal(json('kiro-tests-exit.json').exitCode, 0); tap('kiro-tests.log', 56, 56);
assert.equal(json('compatibility-tests-exit.json').exitCode, 0); tap('compatibility-tests.log', 35, 35);
assert.equal(json('initial-kiro-tests-exit.json').exitCode, 1); tap('initial-kiro-tests.log', 56, 54);
const typecheckRecord = json('typecheck-exit.json');
const typecheck = Array.isArray(typecheckRecord) ? {checks: typecheckRecord} : typecheckRecord;
assert.equal(typecheck.checks.length, 2);
assert(typecheck.checks.every(check => check.exitCode === 0));
assert.equal(json('initial-typecheck-exit.json').checks[0].exitCode, 2);
assert.equal(json('build-exit.json').exitCode, 0);
assert.match(read('docs/evidence/kiro-images/build.log'), /vite.*building|building client environment/i);
assert.equal(json('probe-run.json').exitCode, 0);
const probe = JSON.parse(read('docs/evidence/kiro-cli-parity/adapter-probe.json'));
assert.equal(probe.checksPassed, 8);
assert.equal(probe.sources[0].sha256, sha(sources[0]));
assert(probe.checks.some(check => check.name === 'user-image-native-serialization' && check.passed));
assert(probe.checks.some(check => check.name === 'multiple-tool-text-blocks-preserved' && check.passed));
const baseline = json('baseline-adapter-probe.json');
assert(baseline.checks.some(check => check.name === 'user-image-rejected' && check.passed));
assert.notEqual(baseline.sources[0].sha256, probe.sources[0].sha256);
// Reuse original PE/dumpbin/probe and 79-file frozen-manifest verification.
const parity = cp.spawnSync(process.execPath, ['docs/evidence/kiro-cli-parity/check.cjs'], {cwd: root, encoding: 'utf8'});
fs.writeFileSync(path.join(here, 'parity-check.log'), parity.stdout + parity.stderr);
assert.equal(parity.status, 0, parity.stdout + parity.stderr);
let links = 0;
for (const file of docs) {
  const content = read(file);
  assert(!/[ \t]+$/m.test(content), `trailing whitespace: ${file}`);
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    const [name, anchor] = target.split('#');
    const resolved = path.resolve(path.dirname(at(file)), decodeURIComponent(name));
    // This check's own result is written only after every assertion passes below.
    if (resolved === path.join(here, 'checks.json')) { links++; continue; }
    assert(fs.existsSync(resolved), `missing link ${file}: ${target}`);
    if (anchor && /^L\d+$/.test(anchor)) {
      assert(Number(anchor.slice(1)) <= fs.readFileSync(resolved, 'utf8').split('\n').length, `line anchor ${target}`);
    }
    links++;
  }
}
for (const file of sources) assert(!/[ \t]+$/m.test(read(file)), `trailing whitespace: ${file}`);
const compiled = [
  'app/dist/server/providers/kiro-chat-protocol.js',
  'app/dist/server/providers/kiro-catalog.js', 'app/dist/server/providers/kiro.js',
];
assert.match(read(compiled[0]), /See images data supplied/);
assert.match(read(compiled[1]), /kiroSupportedInputTypes/);
assert.match(read(compiled[2]), /cacheVersion:\s*2/);
const diff = cp.spawnSync('git', ['diff', '--check', '--', ...sources, ...docs], {cwd: root, encoding: 'utf8'});
assert.equal(diff.status, 0, diff.stdout + diff.stderr);
const evidence = fs.readdirSync(here).filter(file => file !== 'checks.json' && fs.statSync(path.join(here, file)).isFile())
  .sort().map(file => `docs/evidence/kiro-images/${file}`);
const result = {
  scope: 'Offline implementation, fixtures and production build; no protected API or official executable invocation',
  kiro: {tests: 56, passed: 56}, compatibility: {tests: 35, passed: 35}, typecheckExitCodes: [0, 0],
  buildExitCode: 0, probeChecks: 8, initialKiro: {tests: 56, passed: 54, exitCode: 1},
  localLinks: links, parityCheckExitCode: parity.status,
  files: [...sources, ...docs, ...compiled, ...evidence].map(file => ({file, bytes: fs.statSync(at(file)).size, sha256: sha(file)})),
};
fs.writeFileSync(path.join(here, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({...result, files: `${result.files.length} SHA256 entries; see checks.json`}, null, 2));
