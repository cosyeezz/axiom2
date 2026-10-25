// Current thinking implementation evidence. Does not rewrite historical reports.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict'), cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const at = file => path.join(root, file), read = file => fs.readFileSync(at(file), 'utf8');
const json = file => JSON.parse(read(file).replace(/^\uFEFF/, ''));
const local = name => json('docs/evidence/kiro-thinking/' + name);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(at(file))).digest('hex');
const sources = ['app/src/server/providers/kiro-thinking.ts', 'app/src/server/providers/kiro-thinking-stream.ts', 'app/src/server/providers/kiro-chat.ts', 'app/src/server/providers/kiro-chat-protocol.ts', 'app/src/server/providers/kiro-catalog.ts', 'app/src/server/providers/kiro.ts', 'app/src/server/model-service.ts', 'app/tests/kiro-thinking.test.ts', 'app/tests/model-default.test.ts'];
const docs = ['docs/kiro-thinking.md', 'docs/kiro-auth.md', 'docs/kiro-inference-audit.md', 'docs/kiro-catalog-audit.md', 'docs/kiro-cli-parity-audit.md', 'docs/evidence/kiro-thinking/README.md'];
function counts(name, total, passed) {
  const log = read('docs/evidence/kiro-thinking/' + name);
  for (const [label, value] of Object.entries({ tests: total, pass: passed, fail: total - passed })) assert.match(log, new RegExp(`^(?:#|ℹ) ${label} ${value}\\b`, 'm'));
}
assert.equal(local('initial-kiro-tests-exit.json').exitCode, 1); counts('initial-kiro-tests.log', 80, 78);
assert.equal(local('kiro-tests-exit.json').exitCode, 0); counts('kiro-tests.log', 82, 82);
counts('initial-compatibility-tests.log', 38, 38);
const initial = local('initial-validation-exit.json');
const checks = value => Array.isArray(value) ? value : value.checks ?? value.results ?? value.commands;
assert(checks(initial)?.length === 3 && checks(initial).every(check => check.exitCode === 0));
const types = checks(local('typecheck-exit.json'));
assert(types?.length === 2 && types.every(check => check.exitCode === 0));
assert.equal(local('build-exit.json').exitCode, 0);
assert.equal(local('adapter-probe-exit.json').exitCode, 0);
const probe = local('adapter-probe.json'); assert.equal(probe.checksPassed, 8); assert(probe.checks.length === 8 && probe.checks.every(check => check.passed));
for (const source of probe.sources) assert.equal(sha(path.relative(root, path.resolve(__dirname, source.relative))), source.sha256);
assert.match(read('docs/evidence/kiro-thinking/build.log'), /building client environment|vite.*building/i);
// The image-completion protocol is unchanged; its historical probe stays historical.
assert.equal(sha('app/src/server/providers/kiro-chat-protocol.ts'), '667a5696d879f50dd5ce9ae62900465ec63561e25188f1862f80fd7d04809508');
const frozen = json('docs/evidence/kiro-inference/manifest.json');
assert.equal(frozen.files.length, 79); let bytes = 0;
for (const item of frozen.files) {
  const file = 'docs/evidence/kiro-inference/' + item.path;
  assert.equal(fs.statSync(at(file)).size, item.bytes); assert.equal(sha(file), item.sha256); bytes += item.bytes;
}
assert.equal(bytes, 3141440);
let links = 0;
for (const file of docs) {
  for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1]; if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    const [name, anchor] = href.split('#'), target = path.resolve(path.dirname(at(file)), decodeURIComponent(name));
    if (target === path.join(__dirname, 'checks.json')) { links++; continue; }
    assert(fs.existsSync(target), `missing link ${file}: ${href}`);
    if (anchor && /^L\d+$/.test(anchor)) assert(Number(anchor.slice(1)) <= fs.readFileSync(target, 'utf8').split('\n').length, `bad anchor ${href}`);
    links++;
  }
}
const compiled = ['app/dist/server/providers/kiro-thinking.js', 'app/dist/server/providers/kiro-thinking-stream.js', 'app/dist/server/providers/kiro-chat.js', 'app/dist/server/providers/kiro-catalog.js'];
assert.match(read(compiled[0]), /output_config/); assert.match(read(compiled[1]), /class KiroThinkingStream/);
assert.match(read(compiled[2]), /kiroThinkingRequest/); assert.match(read(compiled[3]), /kiroThinkingModel/);
for (const file of [...sources, ...docs]) assert(!/[ \t]+\r?$/m.test(read(file)), `trailing whitespace ${file}`);
const diff = cp.spawnSync('git', ['diff', '--check', '--', ...sources, ...docs], { cwd: root, encoding: 'utf8' });
assert.equal(diff.status, 0, diff.stdout + diff.stderr);
const evidence = fs.readdirSync(__dirname).filter(name => name !== 'checks.json' && fs.statSync(path.join(__dirname, name)).isFile()).sort().map(name => 'docs/evidence/kiro-thinking/' + name);
const result = { passed: true, command: 'node docs/evidence/kiro-thinking/check.cjs', cwd: root, node: process.version, scope: 'Offline Kiro thinking configuration/stream implementation, no protected API or CLI execution', kiroAndSelection: { tests: 82, passed: 82 }, compatibility: { tests: 38, passed: 38 }, typecheckExitCodes: [0, 0], buildExitCode: 0, protocolProbe: { checks: 8, passed: 8, fresh: true }, initialKiro: { tests: 80, passed: 78, exitCode: 1 }, frozenManifest: { files: 79, bytes, unchanged: true }, imageProtocolUnchanged: true, localLinks: links, scopedDiffExitCode: diff.status, files: [...sources, ...docs, ...compiled, ...evidence].map(file => ({ file, bytes: fs.statSync(at(file)).size, sha256: sha(file) })) };
fs.writeFileSync(path.join(__dirname, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, files: `${result.files.length} SHA256 entries; see checks.json` }, null, 2));
