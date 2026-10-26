// Local orchestration only. Not a model adapter or a publishable evidence file.
// Each child uses the registered-task AXIOM WS driver; never calls model APIs.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const app = 'F:/Axiom/axiom2/app';
const root = 'F:/Axiom/axiom2/test-results/kiro-long-session/recovery';
const plan = [
  ['minimax-m2.1', 't4018', false],
  ['claude-haiku-4.5', 't4015', true],
  ['minimax-m2.5', 't4017', false],
  ['glm-5', 't4019', false],
  ['qwen3-coder-next', 't4020', false],
  ['deepseek-3.2', 't4016', false],
  ['claude-sonnet-4.5', 't4046', true],
];
const files = ['src/server/providers/kiro-chat-protocol.ts', 'src/server/providers/kiro-chat.ts', 'scripts/kiro-live-check.mjs', 'scripts/kiro-live-plan.mjs', 'dist/server/providers/kiro-chat-protocol.js', 'dist/server/providers/kiro-chat.js'];
const hashes = () => files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(app + '/' + path)).digest('hex') }));
mkdirSync(root, { recursive: true });
const summary = { pid: process.pid, startedAt: new Date().toISOString(), pacingMs: 30000, betweenModelsMs: 90000, maxAttemptsPerModel: 1, codeHashes: hashes(), models: [] };
const save = () => writeFileSync(root + '/summary.json', JSON.stringify(summary, null, 2) + '\n');
save();
for (const [model, task, vision] of plan) {
  if (JSON.stringify(hashes()) !== JSON.stringify(summary.codeHashes)) { summary.halted = 'Frozen source or dist changed'; break; }
  const directory = root + '/' + model;
  mkdirSync(directory, { recursive: true });
  const statePath = directory + '/state.json';
  const args = ['scripts/kiro-live-check.mjs', 'matrix-long', '--model', model, '--task', task, '--state', statePath,
    '--controlled-prompts', '--fresh-worker', '--pace-ms', '30000', '--receipt-tag', 'recovery-v2', ...(vision ? ['--vision'] : [])];
  const fd = openSync(directory + '/run.log', 'w');
  const child = spawn(process.execPath, args, { cwd: app, stdio: ['ignore', fd, fd], windowsHide: true });
  const record = { model, task, vision, pid: child.pid, startedAt: new Date().toISOString() };
  summary.models.push(record); save();
  writeFileSync(root + '/active-model.json', JSON.stringify(record, null, 2) + '\n');
  const code = await new Promise(resolve => { child.once('error', () => resolve(125)); child.once('close', value => resolve(value ?? 125)); });
  closeSync(fd);
  record.exitCode = code; record.endedAt = new Date().toISOString();
  writeFileSync(directory + '/exit-code.txt', String(code) + '\n');
  let state;
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* Failure remains explicit. */ }
  const last = state?.turns?.at(-1);
  record.recordedTurns = state?.turns?.length ?? 0;
  record.completedAt = state?.completedAt ?? null;
  record.semanticFailureCount = state?.checkFailures?.length ?? null;
  record.stoppedByHttp429 = last?.run?.status === 'failed' && /HTTP\s*429/.test(last.run.error ?? '');
  if (code !== 0 && !record.stoppedByHttp429 && !state?.completedAt) {
    summary.halted = 'Unexpected harness/provider interruption; inspect the owned task before any new prompt'; save(); break;
  }
  save();
  if (model !== plan.at(-1)[0]) await delay(90000);
}
summary.finishedAt = new Date().toISOString();
summary.hashesUnchanged = JSON.stringify(hashes()) === JSON.stringify(summary.codeHashes);
save();
console.log(JSON.stringify(summary, null, 2));
