import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { releaseDecision, requiredChecks } from './release-controller.mjs';
const source = 'a'.repeat(40);
const run = { id: 42, head_sha: source, event: 'push', head_branch: 'master', path: '.github/workflows/ci.yml', repository: { full_name: 'cosyeezz/axiom2' }, run_number: 100, run_attempt: 1, status: 'completed', conclusion: 'success' };
const jobs = requiredChecks().map(name => ({ name, status: 'completed', conclusion: 'success' }));

test('only exact current master push and every unique native/package/test shard authorize publication', () => {
  assert.equal(requiredChecks().length, 32);
  assert.equal(new Set(requiredChecks()).size, 32);
  assert.equal(releaseDecision(source, [run], jobs).action, 'publish');
  for (const change of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'other' }, { repository: { full_name: 'fork/axiom2' } }, { path: '.github/workflows/desktop.yml' }])
    assert.equal(releaseDecision(source, [{ ...run, ...change }], jobs).action, 'missing');
  for (let index = 0; index < jobs.length; index++) {
    assert.equal(releaseDecision(source, [run], jobs.filter((_, i) => i !== index)).action, 'blocked');
    for (const conclusion of ['skipped', 'failure', 'cancelled', 'neutral', null])
      assert.equal(releaseDecision(source, [run], jobs.map((job, i) => i === index ? { ...job, conclusion } : job)).action, 'blocked');
  }
  assert.equal(releaseDecision(source, [run], [...jobs, jobs[0]]).action, 'blocked');
  assert.throws(() => releaseDecision('main', [run], jobs));
});
test('recovery reruns at most once, waits for active checks, and never falls back to an older green run', () => {
  for (const conclusion of ['failure', 'timed_out', 'cancelled', 'startup_failure']) {
    assert.equal(releaseDecision(source, [{ ...run, conclusion }]).action, 'retry');
    for (const run_attempt of [2, 3, 10]) assert.equal(releaseDecision(source, [{ ...run, conclusion, run_attempt }]).action, 'blocked');
  }
  for (const status of ['queued', 'in_progress', 'waiting', 'requested', 'pending'])
    assert.equal(releaseDecision(source, [{ ...run, status }], jobs).action, 'wait');
  assert.equal(releaseDecision(source, [run, { ...run, id: 43, run_number: 101, conclusion: 'failure', run_attempt: 2 }], jobs).action, 'blocked');
  assert.equal(releaseDecision(source, [{ ...run, conclusion: 'skipped' }], jobs).action, 'blocked');
});
test('workflow separates cancellable CI from serialized publication with automatic completion and schedule recovery', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/backend-release.yml', import.meta.url), 'utf8');
  assert.match(ci, /shard: \[1, 2, 3, 4\]/);
  assert.doesNotMatch(ci, /^  publish:/m);
  assert.match(release, /workflow_run:\n    workflows: \[Validate Axiom2\]\n    types: \[completed\]/);
  assert.match(release, /schedule:\n    - cron:/);
  assert.match(release, /group: axiom-backend-release\n  cancel-in-progress: false/);
  assert.match(release, /run-id: \$\{\{ steps\.gate\.outputs\.run_id \}\}/);
  assert.match(release, /AXIOM_RELEASE_SOURCE: \$\{\{ steps\.gate\.outputs\.source \}\}/);
  assert.match(release, /node scripts\/release-controller.mjs failure/);
  assert.match(release, /node scripts\/release-controller.mjs resolved/);
  assert.match(release, /if: success\(\) && \(steps\.release\.outputs\.verified == 'true' \|\| steps\.publication\.outputs\.verified == 'true'\)/);
  assert.match(release, /^  notify:\n    needs: \[publish\]/m);
  assert.match(release, /if: always\(\) && \(needs\.publish\.result == 'failure' \|\| needs\.publish\.result == 'cancelled'\)/);
  assert.ok(release.indexOf('Preserve release candidate') < release.indexOf('Publish and verify backend release'));
  const publisher = readFileSync(new URL('./auto-release.mjs', import.meta.url), 'utf8');
  assert.match(publisher, /'PATCH', `repos\/\$\{repository\}\/releases\/\$\{release.id\}`/);
  assert.doesNotMatch(publisher, /gh\('release', 'edit'/);
});
