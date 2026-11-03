// Read-only verification of a consumed case; never imports or executes HARNESS.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../..');
const json = file => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
async function main() {
const p = json('PROJECTION.json'), baseline = json('baseline.json'), before = json('environment-before.json');
assert.equal(p.passed, true); assert.equal(p.phase, 'validated');
assert.equal(p.semantic, 2); assert.equal(p.requests, 3); assert.equal(p.executions, 1);
assert.equal(p.authRequests, 1); assert.equal(p.profileRequests, 0);
assert.deepEqual(p.statuses, [200, 200, 200]); assert.deepEqual(p.terminals, ['stop', 'stop']);
assert.equal(p.activeBodies, 0); assert.equal(p.observerStarts, 3); assert.equal(p.observerEnds, 3);
assert.ok(p.settled && p.configUnchanged && p.dispatcherClosed);
assert.equal(p.checks.length, 3);
for (const item of p.checks) assert.ok(item.callerContext && item.toolSchema && item.continuation && item.conversationRoot && item.protectedHeaders);
assert.ok(p.checks[1].toolRoundtrip && p.checks[2].toolRoundtrip && p.checks[2].textHistory);
assert.equal(new Set(p.runIds).size, 2);
assert.equal(hash(join(dir, 'HARNESS.mjs')), json('selftest-02.json').harnessSHA256);
assert.ok(json('selftest-02.json').passed && json('selftest-02.json').aborted.passed && json('import-check.json').passed && json('preflight.json').passed);
for (const f of baseline.artifacts) assert.equal(hash(join(root, f.path)), f.sha256);
const source = JSON.parse(readFileSync(join(root, 'docs/evidence/kiro-native-component-01/verification.json'), 'utf8'));
for (const f of source.sourceFingerprints) assert.equal(hash(join(root, f.path)), f.sha256);
const db = new DatabaseSync('/Users/dane/Library/Application Support/Axiom2/axiom.sqlite', { readOnly: true });
const selection = JSON.parse(db.prepare('SELECT selection FROM agent_preferences WHERE id=1').get().selection); db.close();
const pid = port => Number(execFileSync('/usr/sbin/lsof', ['-t', '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim());
const config = JSON.parse(readFileSync('/Users/dane/.pi/agent/models.json', 'utf8'));
const after = { at: new Date().toISOString(), defaultSelection: { provider: selection.provider, id: selection.id, thinking: selection.thinking },
  proxyMode: config.providers.kiro.axiomProxy.mode, services: { port4317: pid(4317), port4319: pid(4319) } };
assert.deepEqual(after.defaultSelection, before.defaultSelection); assert.equal(after.proxyMode, before.proxyMode); assert.deepEqual(after.services, before.services);
let ownerExited = false;
try { process.kill(json('live.claim').pid, 0); } catch (error) { ownerExited = error.code === 'ESRCH'; }
assert.equal(ownerExited, true);
for (const key of ['AXIOM_EXECUTION_PROFILE', 'AXIOM_MODEL_ACCOUNT_BINDINGS']) delete process.env[key];
const { readModelCredential } = await import('../../../app/dist/server/model-account-storage.js');
const credential = readModelCredential('kiro', '/Users/dane/.pi/agent/auth.json');
const oauthStoredValid = credential?.type === 'oauth' && credential.expires > Date.now() && !!credential.access && !!credential.refresh;
assert.ok(oauthStoredValid); assert.equal(!!credential.profileArn, baseline.profilePresent);
const result = { passed: true, ownerExited, defaultsUnchanged: true, proxyUnchanged: true, servicesNotRestarted: true,
  oauthStoredValid, profilePresenceUnchanged: true, artifactsMatched: baseline.artifacts.length, sourcesMatched: source.sourceFingerprints.length,
  harnessMatchedFinalSelftest: true, actualCommands: [{ command: 'node app/node_modules/typescript/bin/tsc -p app/tsconfig.server.json', exitCode: 0 },
    { command: 'node --check docs/evidence/kiro-native-component-live-01/HARNESS.mjs', exitCode: 0 },
    { command: 'node --max-old-space-size=256 docs/evidence/kiro-native-component-live-01/HARNESS.mjs --selftest', exitCode: 0, result: 'selftest-02.json' },
    { command: 'node --max-old-space-size=256 docs/evidence/kiro-native-component-live-01/HARNESS.mjs --preflight', exitCode: 0 },
    { command: 'node --max-old-space-size=256 docs/evidence/kiro-native-component-live-01/HARNESS.mjs --live', exitCode: 0 }],
  fingerprints: ['CONTRACT.md', 'FIXTURE.txt', 'HARNESS.mjs', 'baseline.json', 'source-readback.json', 'preflight.json', 'selftest.json', 'selftest-02.json', 'import-check.json', 'environment-before.json', 'live.claim', 'PROJECTION.json', 'build.log'].map(path => ({ path, sha256: hash(join(dir, path)) })) };
writeFileSync(join(dir, 'environment-after.json'), JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
writeFileSync(join(dir, 'verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, ownerExited, oauthStoredValid, defaultsUnchanged: true, servicesNotRestarted: true, artifactsMatched: result.artifactsMatched, sourcesMatched: result.sourcesMatched }));
}
main().catch(() => { console.log('{"passed":false,"failure":"VERIFICATION_FAILED"}'); process.exitCode = 1; });
