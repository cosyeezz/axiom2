import fs from 'node:fs';
import { Socket } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';

const dir = dirname(fileURLToPath(import.meta.url)), root = resolve(dir, '../../..');
const harness = join(dir, 'HARNESS.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(fs.readFileSync(join(dir, name), 'utf8'));
const save = (name, result) => fs.writeFileSync(join(dir, name), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
async function importSafety() {
  const oldFetch = globalThis.fetch, oldConnect = Socket.prototype.connect;
  const names = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'unlinkSync', 'renameSync'];
  const originals = Object.fromEntries(names.map(name => [name, fs[name]]));
  const childNames = ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'];
  const oldChild = Object.fromEntries(childNames.map(name => [name, childProcess[name]]));
  let network = 0, writes = 0, children = 0;
  for (const name of childNames) childProcess[name] = () => { children++; throw Error('Blocked import child'); };
  globalThis.fetch = () => { network++; throw Error('Blocked import network'); };
  Socket.prototype.connect = function () { network++; throw Error('Blocked import socket'); };
  for (const name of names) fs[name] = () => { writes++; throw Error('Blocked import file mutation'); };
  syncBuiltinESMExports();
  const env = JSON.stringify(process.env);
  try {
    await import(pathToFileURL(harness).href);
    assert.equal(network, 0); assert.equal(writes, 0); assert.equal(children, 0); assert.equal(JSON.stringify(process.env), env);
    return { passed: true, network, writes, children, environmentUnchanged: true, harnessSHA256: sha(fs.readFileSync(harness)) };
  } finally {
    globalThis.fetch = oldFetch; Socket.prototype.connect = oldConnect; Object.assign(fs, originals); Object.assign(childProcess, oldChild); syncBuiltinESMExports();
  }
}
function verifyLive() {
  const result = json('PROJECTION.json'), claim = json('live.claim'), baseline = json('baseline.json');
  const selftest = json('selftest-final-01.json'), imported = json('import-final-01.json');
  assert.equal(claim.case, 'codebuddy-native-component-live-02'); assert.equal(claim.maxModelRequests, 3); assert.equal(claim.maxRefresh, 1); assert.equal(claim.maxCatalog, 0);
  assert.equal(json('preflight.json').passed, true); assert.equal(selftest.passed, true); assert.equal(imported.passed, true);
  const hash = sha(fs.readFileSync(harness)); assert.equal(selftest.harnessSHA256, hash); assert.equal(imported.harnessSHA256, hash);
  const frozen = json('FROZEN-RUNTIME.json');
  assert.equal(baseline.runtimeRoot, frozen.snapshotRoot);
  assert.equal(baseline.snapshotManifestSHA256, sha(fs.readFileSync(join(dir, 'FROZEN-RUNTIME.json'))));
  for (const artifact of [...frozen.files, ...baseline.artifacts]) assert.equal(sha(fs.readFileSync(join(baseline.runtimeRoot, artifact.path))), artifact.sha256);
  for (const data of [selftest, json('preflight.json').binding]) for (const key of ['runtimeRoot', 'snapshotManifestSHA256', 'artifacts', 'harnessSHA256', 'fixtureSHA256', 'verifierSHA256', 'projectionSHA256', 'contractSHA256']) assert.deepEqual(data[key], baseline[key]);
  assert.equal(baseline.fixtureSHA256, sha(fs.readFileSync(join(dir, 'FIXTURE.txt')))); assert.equal(baseline.verifierSHA256, sha(fs.readFileSync(fileURLToPath(import.meta.url))));
  assert.equal(baseline.projectionSHA256, sha(fs.readFileSync(join(dir, 'STREAM-PROJECTION.cjs'))));
  assert.equal(baseline.contractSHA256, sha(fs.readFileSync(join(dir, 'CONTRACT.md'))));
  assert.equal(result.responses.length, 3); assert.equal(result.activeCancels, 0); assert.equal(result.diagnostics.length, 0);
  for (const [index, response] of result.responses.entries()) {
    assert.equal(response.exit, 'eof'); assert.equal(response.done, true); assert.equal(response.doneCount, 1);
    assert.equal(response.projectionError, undefined); assert.equal(response.frameLimit, undefined);
    assert.ok(response.frames.every(frame => !frame.invalidJson && !frame.errorPresent && (!frame.modelDeclared || frame.modelMatches)));
    assert.ok(response.frames.some(frame => frame.choices?.some(choice => choice.finish === (index === 0 ? 'tool_calls' : 'stop'))));
    if (index === 1) assert.equal(response.markerExact, true); if (index === 2) assert.equal(response.nextMarkerExact, true);
  }
  assert.equal(result.passed, true); assert.equal(result.failure, undefined); assert.equal(result.phase, 'validated');
  assert.equal(result.semantic, 2); assert.equal(result.requests, 3); assert.equal(result.modelSends, 3); assert.equal(result.logicalCalls, 3);
  assert.equal(fs.existsSync(join(dir, 'HARD_TIMEOUT.json')), false);
  assert.deepEqual(result.statuses, [200, 200, 200]); assert.deepEqual(result.terminals, ['stop', 'stop']);
  assert.ok(result.authRequests === 0 || result.authRequests === 1); assert.equal(result.auxStatuses.length, result.authRequests);
  assert.ok(result.auxStatuses.every(status => status === 200));
  for (const name of ['catalogRequests', 'profileRequests', 'auxiliaryRequests', 'activeBodies', 'activeAux', 'forbiddenAux']) assert.equal(result[name], 0);
  for (const name of ['executions', 'approvals']) assert.equal(result[name], 1);
  assert.equal(result.observerStarts, 3); assert.equal(result.observerEnds, 3);
  for (const name of ['settled', 'providerDisposed', 'configUnchanged', 'dispatcherClosed', 'tcpResourcesClosed', 'refreshSettled']) assert.equal(result[name], true);
  assert.ok(result.events > 0 && result.events <= 10000); assert.equal(result.checks.length, 3);
  result.checks.forEach((check, index) => {
    for (const name of ['callerContext', 'toolSchema', 'modelAndOff', 'authAndUA', 'continuation', 'uniqueInvocation']) assert.equal(check[name], true);
    assert.equal(check.toolRoundtrip, index > 0); assert.equal(check.textHistory, index === 2);
  });
  assert.equal(new Set(result.runIds).size, 2); assert.ok(result.sessionId);
  assert.ok(result.responseBytes.filter(value => value !== null).every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1048576));
  const files = ['STREAM-PROJECTION.cjs', 'CONTRACT.md', 'HARNESS.mjs', 'FIXTURE.txt', 'VERIFY.mjs', 'baseline.json', 'preflight.json', 'selftest-final-01.json', 'import-final-01.json', 'FROZEN-RUNTIME.json', 'live.claim', 'PROJECTION.json'];
  return { passed: true, criteria: 'SDK functional tool and next-turn closed loop; not independent wire or deployment verification',
    modelSends: 3, authRequests: result.authRequests, artifactsChecked: baseline.artifacts.length,
    evidence: files.map(path => ({ path, sha256: sha(fs.readFileSync(join(dir, path))) })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (async () => {
    const mode = process.argv[2]; assert.ok(mode === '--import' || mode === '--live');
    const result = mode === '--import' ? await importSafety() : verifyLive();
    save(process.argv[3] ?? (mode === '--import' ? 'import-proof.json' : 'verification.json'), result);
    console.log(JSON.stringify(result));
  })().catch(() => { console.log('{"passed":false,"failure":"VERIFICATION_FAILED"}'); process.exitCode = 1; });
}
