// Read-only verification of saved, allowlisted evidence. Never sends model/network requests.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const docs = resolve(evidence, '../..');
const json = file => JSON.parse(readFileSync(resolve(evidence, file), 'utf8'));
let checkedLinks = 0;
const legacyMissingLinks = [];
for (const file of ['qoder.md', 'qoder-client-parity.md', 'qoder-repair-1181.md']) {
  const source = resolve(docs, file);
  for (const match of readFileSync(source, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const found = existsSync(resolve(dirname(source), decodeURIComponent(target.split('#')[0])));
    if (file === 'qoder-repair-1181.md' || target.includes('qoder-repair-1181')) {
      assert.ok(found, `${file}: missing current local link ${target}`);
      checkedLinks++;
    } else if (!found) legacyMissingLinks.push({ file, target });
  }
}

const forbidden = new Set(['authorization', 'access_token', 'refresh_token', 'token', 'messages', 'arguments', 'errorMessage']);
function visit(value, path) {
  if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${path}[${index}]`));
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    assert.ok(!forbidden.has(key), `forbidden evidence key ${path}.${key}`);
    visit(item, `${path}.${key}`);
  }
}
let jsonFiles = 0;
for (const file of readdirSync(evidence).filter(file => file.endsWith('.json') && file !== 'verification.json')) {
  visit(json(file), file);
  jsonFiles++;
}
for (const [file, total] of [['tool-regression-after.log', 50], ['retry-regression-after.log', 19], ['runtime-tool-retry.log', 2]]) {
  const text = readFileSync(resolve(evidence, file), 'utf8');
  for (const [key, value] of Object.entries({ tests: total, pass: total, fail: 0, cancelled: 0, skipped: 0 })) {
    assert.match(text, new RegExp(`^# ${key} ${value}$`, 'm'));
  }
}
const sdk = json('sdk.json');
assert.equal(sdk.pass, true);
assert.equal(sdk.requests.length, 4);
assert.ok(sdk.requests.every(request => request.status === 200));
assert.equal(sdk.streams[0].timing, 1);
assert.equal(sdk.stop.marker, true);
const first = json('multiturn-service-02.json'), next = json('multiturn-service-03.json');
assert.equal(first.accepted, false);
assert.equal(next.accepted, false);
assert.equal(first.scope.sessionId, next.scope.sessionId);
assert.equal(first.rounds.length, 3);
assert.equal(first.defaultRestored, true);
assert.equal(first.testSessionModelPreserved, true);
assert.ok(first.rounds.slice(0, 2).every(round => round.answerExact && round.providerModelExact && round.finalStop));
assert.equal(first.rounds[2].status, 'failed');
assert.equal(next.rounds.length, 1);
assert.equal(next.rounds[0].status, 'failed');
assert.equal(next.sameSessionConfirmed, true);
assert.equal(next.transcriptUnchanged, true);
assert.equal(next.commandCounts.prompt, 1);
const failure = json('multiturn-service-03-failure.json');
assert.deepEqual(failure.errorClasses, ['10605']);
assert.equal(failure.toolCalls, 0);
assert.equal(failure.toolResults, 0);
assert.equal(failure.assistantCount, 4);
const queue = json('queue-observe-02.json');
assert.equal(queue.modelInvocations, 0);
assert.equal(queue.readyObserved, true);
assert.ok(queue.queries.every(request => request.status === 200));
assert.equal(json('restart.json').newPid, 96136);
assert.equal(json('ui-and-current-health.json').ui.markerExact, true);
assert.equal(json('ui-and-current-health.json').activeTestRuns, 0);
const contract = json('multiturn-case.json');
assert.equal(contract.budget.maxModelInvocations, 8);
assert.equal(contract.budget.automaticRetries, 0);
const used = 1 + first.rounds.reduce((total, round) => total + (round.assistantMessages ?? 1), 0) + next.rounds.length;
assert.equal(used, 5);
console.log(JSON.stringify({
  verification: 'saved evidence and current document links only; not a new product or live test',
  currentLocalLinks: checkedLinks, jsonEvidenceFiles: jsonFiles, legacyMissingLinks,
  regressionTotals: [50, 19, 2], sameSession: true,
  modelCallsUsed: used, modelCallsRemaining: 8 - used, liveAccepted: false, status: 'passed',
}, null, 2));
