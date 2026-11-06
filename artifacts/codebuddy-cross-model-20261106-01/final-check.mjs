// Read-only deployment/evidence reconciliation. Never invokes a model or session.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const out = resolve('artifacts/codebuddy-cross-model-20261106-01');
const json = name => JSON.parse(readFileSync(join(out, name), 'utf8'));
const report = { passed: false, modelInvocations: 0 };
try {
  const proof = json('runtime-proof.json');
  assert.equal(proof.modules.length, 6);
  for (const m of proof.modules) {
    assert.equal(createHash('sha256').update(readFileSync(m.path)).digest('hex'), m.sha256);
    assert.equal(statSync(m.path).mtimeMs, m.mtimeMs);
  }
  report.frozenModulesUnchanged = true;
  const listeners = [...new Set(execFileSync('lsof', ['-nP', '-iTCP:4317', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/).map(Number))];
  assert.deepEqual(listeners, [proof.restart.newPid]);
  report.serverPid = listeners[0];
  const response = await fetch('http://127.0.0.1:4317/', { signal: AbortSignal.timeout(5000) });
  report.httpStatus = response.status; await response.body?.cancel(); assert.equal(report.httpStatus, 200);
  assert.equal(proof.verification.allFresh, true);
  assert.ok(proof.verification.serverStartedAt > Math.max(...proof.modules.map(m => m.mtimeMs)));
  assert.ok(proof.verification.workers.every(w => w.parent === report.serverPid && w.startedAt > Math.max(...proof.modules.map(m => m.mtimeMs))));
  report.restartFreshnessVerified = true;
  const offline = json('offline-history-report.json');
  assert.equal(offline.passed, true); assert.equal(offline.upstreamRequests, 0);
  assert.equal(offline.messages, 116); assert.equal(offline.signedThinking, 25); assert.equal(offline.compositeToolIds, 61);
  assert.equal(offline.opaqueSignaturesAbsent, true); assert.equal(offline.originalCompositePairsPreserved, true);
  const live = json('native-live-03-report.json');
  assert.equal(live.case, '03-native-foreign-history'); assert.equal(live.passed, true);
  assert.equal(live.payloadCallbacks, 1); assert.equal(live.responseCount, 1); assert.equal(live.httpStatus, 200);
  assert.equal(live.stopReason, 'stop'); assert.equal(live.toolsExecuted, 0); assert.equal(live.emittedToolCalls, 0);
  for (const key of ['readableHistoryPreserved', 'opaqueSignatureAbsent', 'compositePairPreserved', 'correctRecallAndArithmetic', 'sourceUnchanged', 'temporaryProfileRemoved']) assert.equal(live[key], true);
  assert.equal(live.settingsMutated, false); assert.equal(live.formalUi, false);
  for (const name of ['native-live-report.json', 'native-live-02-report.json']) {
    const pre = json(name); assert.equal(pre.payloadCallbacks, 0); assert.equal(pre.responseCount, 0);
  }
  const claims = readdirSync(out).filter(n => n.endsWith('.claim'));
  assert.deepEqual(claims, ['03-native-foreign-history.claim']);
  report.exhaustedClaims = claims.length; report.oneShotNativePassed = true;
  assert.ok(readFileSync(join(out, 'live-cross-model.mjs'), 'utf8').includes("throw new Error('unadmitted-ui-plan-do-not-execute')"));
  report.unadmittedUiDisabled = true;
  const processes = execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' });
  assert.ok(!processes.split('\n').some(line => /\bnode\s+\S*live-(?:cross-model|native-history)\.mjs(?:\s|$)/.test(line)));
  report.noLiveRunnerActive = true;
  report.passed = true;
} catch { report.failureClass = 'final-evidence-reconciliation-failed'; process.exitCode = 1; }
writeFileSync(join(out, 'final-check-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
