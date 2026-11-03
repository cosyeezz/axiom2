import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const result = read('PROJECTION.json'), claim = read('live.claim'), frozen = read('FROZEN-RUNTIME.json');
assert.equal(result.passed, false); assert.equal(result.failure, 'STREAM_TERMINAL');
assert.equal(claim.case, 'codebuddy-native-component-live-01');
assert.equal(result.modelSends, 1); assert.equal(result.logicalCalls, 1);
assert.equal(result.authRequests, 0); assert.deepEqual(result.statuses, [200]);
for (const key of ['executions','approvals','catalogRequests','profileRequests','auxiliaryRequests','activeBodies','activeAux','forbiddenAux']) assert.equal(result[key], 0);
for (const key of ['settled','providerDisposed','configUnchanged','dispatcherClosed','tcpResourcesClosed','refreshSettled']) assert.equal(result[key], true);
assert.equal(result.observerStarts, 1); assert.equal(result.observerEnds, 1);
assert.equal(existsSync(join(dir, 'HARD_TIMEOUT.json')), false);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const artifact of [...frozen.files, ...frozen.artifacts]) assert.equal(sha(readFileSync(join(frozen.snapshotRoot, artifact.path))), artifact.sha256);
const output = { verifiedFailureAndCleanup: true, sdkClosedLoopPassed: false, failure: result.failure, modelSends: 1, authRequests: 0, responseBytes: result.responseBytes, claimConsumed: true, naturalExitCode: 1,
  limitation: 'Upstream SSE raw data and assistant diagnostics were not saved; exact parser/provider cause is unknown.',
  evidence: ['HARNESS.mjs','VERIFY.mjs','FROZEN-RUNTIME.json','selftest-final-03.json','import-final-03.json','preflight.json','baseline.json','live.claim','PROJECTION.json'].map(path => ({path,sha256:sha(readFileSync(join(dir,path)))})) };
writeFileSync(join(dir, 'failure-verification.json'), JSON.stringify(output, null, 2)+'\n', {flag:'wx',mode:0o600});
console.log(JSON.stringify(output));
