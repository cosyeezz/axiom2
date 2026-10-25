// Publication integrity; never regenerate historical evidence reports.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const at = file => path.join(root, file);
const read = file => fs.readFileSync(at(file), 'utf8').replace(/^\uFEFF/, '');
const json = file => JSON.parse(read(file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => cp.execFileSync('git', args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const release = name => 'docs/evidence/kiro-release/' + name;
function run(meta, log, expected) {
  const record = json(release(meta));
  assert.equal(record.exitCode, 0, meta);
  assert.equal(record.command, expected, meta + ' command');
  const start = Date.parse(record.startedUtc ?? record.startUtc), end = Date.parse(record.endedUtc ?? record.finishedUtc ?? record.endUtc);
  assert(Number.isFinite(start) && end >= start, meta + ' timestamps');
  const counts = {};
  for (const label of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const match = read(release(log)).match(new RegExp('^(?:# |ℹ |鈩\\?)' + label + ' (\\d+)\\b', 'm'));
    if (match) counts[label] = Number(match[1]);
  }
  return { ...record, archivedLog: log, counts };
}
const prefix = 'node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 ';
const focused = run('focused-run.json', 'focused-tests.log', prefix + ['kiro-auth', 'kiro-callback', 'kiro-catalog', 'kiro-chat', 'kiro-images', 'kiro-runtime', 'kiro-pooling', 'kiro-thinking', 'model-default'].map(n => 'tests/' + n + '.test.ts').join(' '));
const compatibility = run('compatibility-run.json', 'compatibility-tests.log', prefix + ['images', 'model-input', 'model-catalog', 'model-runtime', 'model-config-validation', 'model-overrides', 'model-copy-runtime', 'model-auth-preparation', 'model-switch', 'model-network', 'model-oauth-config', 'model-oauth', 'qoder-runtime', 'codebuddy-runtime'].map(n => 'tests/' + n + '.test.ts').join(' '));
assert.equal(focused.counts.tests, 82);
for (const result of [focused, compatibility]) {
  assert(result.counts.tests > 0 && result.counts.tests === result.counts.pass);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(result.counts[key], 0, key);
}
const build = [
  run('01-tsc.metadata.json', '01-tsc.log', 'node node_modules/typescript/bin/tsc --noEmit'),
  run('02-tsc-server.metadata.json', '02-tsc-server.log', 'node node_modules/typescript/bin/tsc --noEmit -p tsconfig.server.json'),
  run('03-npm-build.metadata.json', '03-npm-build.log', 'npm.cmd run build'),
];
assert.match(read(release('03-npm-build.log')), /2573 modules transformed/);
const historicalReport = at('docs/evidence/kiro-thinking/checks.json');
const historicalSHA = hash(fs.readFileSync(historicalReport));
const originalWrite = fs.writeFileSync, originalLog = console.log;
let historical;
try {
  fs.writeFileSync = function (destination, data) {
    assert.equal(path.resolve(destination), historicalReport, 'unexpected historical checker write');
    historical = JSON.parse(String(data)); // Retain the generated report only in memory.
  };
  console.log = () => {};
  require('../kiro-thinking/check.cjs');
} finally { fs.writeFileSync = originalWrite; console.log = originalLog; }
assert(historical?.passed);
assert.equal(hash(fs.readFileSync(historicalReport)), historicalSHA, 'historical report changed');
const shared = new Set(['.gitattributes', 'app/src/client/models/ModelCatalogPicker.tsx', 'app/src/client/models/ProviderConnection.tsx', 'app/src/server/model-runtime.ts', 'app/src/server/model-service.ts', 'app/src/server/integrations/model-proxy-env.ts', 'app/tests/model-default.test.ts', 'docs/design.md', 'docs/ui-sync.md']);
const scoped = git(['ls-files', '-z']).toString('utf8').split('\0').filter(file => file && (shared.has(file) || /^app\/src\/server\/providers\/kiro(?:[-.]|$)/.test(file) || /^app\/tests\/(?:fixtures\/)?kiro/.test(file) || /^docs\/kiro[^/]*\.md$/.test(file) || /^docs\/evidence\/kiro-[^/]+\//.test(file)));
const report = release('checks.json');
const files = scoped.filter(file => file !== report).map(file => {
  const bytes = fs.readFileSync(at(file)), indexed = git(['show', ':' + file]);
  assert(bytes.equals(indexed), 'indexed bytes differ from tested working tree: ' + file);
  return { file, bytes: bytes.length, sha256: hash(indexed) };
});
assert(files.some(file => file.file === release('check.cjs')), 'stage publication files before checking');
const frozen = json('docs/evidence/kiro-inference/manifest.json');
assert.equal(frozen.files.length, 79); let frozenBytes = 0;
for (const entry of frozen.files) {
  const bytes = git(['show', ':docs/evidence/kiro-inference/' + entry.path]);
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); frozenBytes += bytes.length;
}
assert.equal(frozenBytes, 3141440);
let localLinks = 0;
for (const file of scoped.filter(file => /^docs\/(?:kiro[^/]*\.md|evidence\/kiro-[^/]+\/.*\.md)$/.test(file))) {
  for (const match of read(file).matchAll(/\]\(([^\s)]+)\)/g)) {
    const href = match[1]; if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    const [name, anchor] = href.split('#');
    const target = path.resolve(path.dirname(at(file)), decodeURIComponent(name));
    assert(fs.existsSync(target) || target === at(report), 'missing link ' + file + ': ' + href);
    if (anchor && /^L\d+$/.test(anchor)) assert(Number(anchor.slice(1)) <= fs.readFileSync(target, 'utf8').split('\n').length, 'bad line anchor: ' + href);
    localLinks++;
  }
}
const diff = cp.spawnSync('git', ['diff', '--cached', '--check'], { cwd: root, encoding: 'utf8' });
assert.equal(diff.status, 0, diff.stdout + diff.stderr);
const result = { passed: true, command: 'node docs/evidence/kiro-release/check.cjs', generatedUtc: new Date().toISOString(), baseCommit: '7aee7a9', node: process.version, scope: 'Merged publication: fresh offline test/build logs and staged-byte integrity, no new model requests', focused, compatibility, build, historicalIntegrity: { passed: true, originalReportPreserved: true, originalReportSHA256: historicalSHA, linksChecked: historical.localLinks, SHA256Entries: historical.files.length, protocolProbeSourceBindings: 8 }, frozenIndex: { files: 79, bytes: frozenBytes, unchanged: true }, localLinks, stagedDiffCheckExitCode: diff.status, files };
fs.writeFileSync(at(report), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, focused: focused.counts, compatibility: compatibility.counts, build: build.map(record => ({ command: record.command, exitCode: record.exitCode })), files: files.length + ' indexed SHA256 entries; see checks.json' }, null, 2));
