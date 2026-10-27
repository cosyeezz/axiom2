import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'cosyeezz/axiom2';
export const incidentTitle = 'Automatic backend release needs attention';
export function requiredChecks() {
  return [
    ...['ubuntu-22.04', 'ubuntu-24.04-arm'].map(os => `native (${os})`),
    ...['windows-latest', 'ubuntu-latest', 'macos-latest'].flatMap(os => ['22.19.0', '24'].flatMap(node => [
      `package (${os}, ${node})`,
      ...[1, 2, 3, 4].map(shard => `validate (${os}, ${node}, ${shard})`),
    ])),
  ];
}

// Only push/master runs from this repository can authorize a release. Never use
// PR artifacts, an arbitrary supplied SHA, or a green run from an older source.
export function releaseDecision(source, runs, jobs = []) {
  assert.match(source, /^[a-f0-9]{40}$/);
  const candidates = runs.filter(run => run.head_sha === source && run.event === 'push' && run.head_branch === 'master' && run.path === '.github/workflows/ci.yml' && run.repository?.full_name === repository);
  candidates.sort((a, b) => b.run_number - a.run_number);
  const run = candidates[0];
  if (!run) return { action: 'missing', source };
  const result = { source, runId: run.id, url: run.html_url };
  if (run.status !== 'completed') return { ...result, action: 'wait' };
  if (['failure', 'timed_out', 'cancelled', 'startup_failure'].includes(run.conclusion))
    return { ...result, action: run.run_attempt === 1 ? 'retry' : 'blocked' };
  if (run.conclusion !== 'success') return { ...result, action: 'blocked' };
  for (const name of requiredChecks()) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success')
      return { ...result, action: 'blocked', check: name };
  }
  return { ...result, action: 'publish' };
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const api = endpoint => JSON.parse(gh('api', `repos/${repository}/${endpoint}`));
const pages = endpoint => JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repository}/${endpoint}`));
export function reportIncident(source, message) {
  assert.match(source, /^[a-f0-9]{40}$/);
  const issues = pages('issues?state=open&creator=github-actions%5Bbot%5D&per_page=100').flat();
  const body = `Backend release for master \`${source}\` has not been delivered.\n\n${message}\n\nThe previous verified release remains available. No validation gate has been bypassed. Push a fix to master; validation and publication will resume automatically.\n\n<!-- axiom-backend-release-incident -->`;
  const existing = issues.find(issue => !issue.pull_request && issue.title === incidentTitle && issue.body?.includes('<!-- axiom-backend-release-incident -->'));
  gh('api', '--method', existing ? 'PATCH' : 'POST', `repos/${repository}/issues${existing ? `/${existing.number}` : ''}`, '-f', `title=${incidentTitle}`, '-f', `body=${body}`);
}
export function closeIncidents() {
  for (const issue of pages('issues?state=open&creator=github-actions%5Bbot%5D&per_page=100').flat()) {
    if (!issue.pull_request && issue.title === incidentTitle && issue.body?.includes('<!-- axiom-backend-release-incident -->'))
      gh('api', '--method', 'PATCH', `repos/${repository}/issues/${issue.number}`, '-f', 'state=closed');
  }
}
export function control() {
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  const source = api('branches/master').commit.sha;
  const runs = pages(`actions/workflows/ci.yml/runs?branch=master&event=push&head_sha=${source}&per_page=100`).flatMap(page => page.workflow_runs);
  const candidate = releaseDecision(source, runs);
  const jobs = candidate.action === 'blocked' || candidate.action === 'publish'
    ? pages(`actions/runs/${candidate.runId}/jobs?filter=latest&per_page=100`).flatMap(page => page.jobs) : [];
  const decision = releaseDecision(source, runs, jobs);
  console.log(JSON.stringify(decision));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Backend release controller: **${decision.action}** for \`${source}\`. ${decision.url ?? ''}\n`);
  if (decision.action === 'retry') {
    // At most one automatic rerun. Persistent failures remain failures and alert;
    // never loop until flaky assertions happen to turn green.
    gh('api', '--method', 'POST', `repos/${repository}/actions/runs/${decision.runId}/rerun-failed-jobs`);
  } else if (decision.action === 'missing') {
    reportIncident(source, 'No push/master CI run exists for this exact source. Check repository Actions settings and push credentials.');
    throw Error('Missing master validation run');
  } else if (decision.action === 'blocked') {
    reportIncident(source, `Validation is blocked after the bounded recovery attempt. See ${decision.url}. ${decision.check ? `Missing/failed required check: ${decision.check}.` : ''}`);
    throw Error('Master validation is blocked; release refused');
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${decision.action === 'publish'}\nsource=${source}\nrun_id=${decision.runId ?? ''}\n`);
  return decision;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'failure') reportIncident(process.env.AXIOM_SOURCE || api('branches/master').commit.sha, `Automatic validation recovery, publication, or public download verification failed (possibly timed out). See https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}. Inspect the gate and failed job diagnostics. The scheduled controller will reconcile the current master without bypassing checks or changing an existing source tag.`);
  else if (process.argv[2] === 'resolved') closeIncidents();
  else control();
}
