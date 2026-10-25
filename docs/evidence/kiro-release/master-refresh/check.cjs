// Revalidate the newer master merge without rewriting either earlier report.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), cp = require('node:child_process');
const root = path.resolve(__dirname, '../../../..'), here = 'docs/evidence/kiro-release/master-refresh/';
const at = file => path.join(root, file), read = file => fs.readFileSync(at(file), 'utf8').replace(/^\uFEFF/, '');
const json = file => JSON.parse(read(file)), sha = file => crypto.createHash('sha256').update(fs.readFileSync(at(file))).digest('hex');
const git = args => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const latestMaster = 'c27cf947ff0debbb59ac74de5d694c894f45a81e', implementation = '6b929cc27f8264f09383afd8fdbfe518fa3bb4c6';
for (const commit of [latestMaster, implementation]) assert.equal(cp.spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root }).status, 0);
const unchanged = ['app/src/server/providers', 'app/src/server/model-service.ts', 'app/src/server/model-runtime.ts', 'app/src/server/integrations/model-proxy-env.ts', 'app/src/server/agent-worker.ts', 'app/src/server/agents.ts', 'app/tests/kiro*.test.ts', 'app/tests/fixtures/kiro*', 'app/tests/model-default.test.ts', ...['images', 'model-input', 'model-catalog', 'model-runtime', 'model-config-validation', 'model-overrides', 'model-copy-runtime', 'model-auth-preparation', 'model-switch', 'model-network', 'model-oauth-config', 'model-oauth', 'qoder-runtime', 'codebuddy-runtime'].map(name => 'app/tests/' + name + '.test.ts')];
assert.equal(git(['diff', '--name-only', implementation, 'HEAD', '--', ...unchanged]), '', 'covered model source/test inputs changed');
function run(file, command) {
  const record = json(here + file); assert.equal(record.command, command); assert.equal(record.exitCode, 0);
  const start = Date.parse(record.startUtc ?? record.startedUtc), end = Date.parse(record.endUtc ?? record.endedUtc ?? record.finishedUtc);
  assert(Number.isFinite(start) && end >= start);
  return record;
}
const build = [run('01-tsc.metadata.json', 'node node_modules/typescript/bin/tsc --noEmit'), run('02-tsc-server.metadata.json', 'node node_modules/typescript/bin/tsc --noEmit -p tsconfig.server.json'), run('03-npm-build.metadata.json', 'npm.cmd run build')];
const buildLog = read(here + '03-npm-build.log'); assert.match(buildLog, /vite.*building|building client environment/i); assert.match(buildLog, /\d+ modules transformed/);
const opencli = run('opencli-run.json', 'node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/opencli.test.ts tests/opencli-private.test.ts tests/opencli-browser.test.ts');
const counts = {};
for (const label of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
  const match = read(here + 'opencli-stdout.log').match(new RegExp('^(?:# |ℹ |鈩\\?)' + label + ' (\\d+)\\b', 'm'));
  assert(match, 'missing OpenCLI count ' + label); counts[label] = Number(match[1]);
}
assert(counts.tests > 0 && counts.pass > 0 && counts.tests === counts.pass + counts.skipped);
for (const label of ['fail', 'cancelled', 'todo']) assert.equal(counts[label], 0);
const earlier = 'docs/evidence/kiro-release/checks.json', earlierSHA = sha(earlier);
const originalWrite = fs.writeFileSync, originalLog = console.log; let publication;
try {
  fs.writeFileSync = function (destination, data) { assert.equal(path.resolve(destination), at(earlier), 'unexpected earlier report write'); publication = JSON.parse(String(data)); };
  console.log = () => {};
  require('../check.cjs');
} finally { fs.writeFileSync = originalWrite; console.log = originalLog; }
assert(publication?.passed); assert.equal(sha(earlier), earlierSHA, 'initial publication report changed');
const ownReport = here + 'checks.json';
const files = publication.files.filter(file => file.file !== ownReport);
const result = { passed: true, command: 'node docs/evidence/kiro-release/master-refresh/check.cjs', generatedUtc: new Date().toISOString(), latestMaster, implementation, validatedHead: git(['rev-parse', 'HEAD']), coveredModelInputsUnchanged: unchanged, reusedTests: { focused: publication.focused.counts, compatibility: publication.compatibility.counts }, build, opencli: { ...opencli, counts }, initialPublicationReport: { preserved: true, sha256: earlierSHA }, historicalIntegrity: publication.historicalIntegrity, frozenIndex: publication.frozenIndex, localLinks: publication.localLinks, stagedDiffCheckExitCode: publication.stagedDiffCheckExitCode, files };
fs.writeFileSync(at(ownReport), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, coveredModelInputsUnchanged: unchanged.length + ' paths/pathspecs', build: build.map(record => ({ command: record.command, exitCode: record.exitCode })), opencli: counts, files: files.length + ' indexed SHA256 entries; see checks.json' }, null, 2));
