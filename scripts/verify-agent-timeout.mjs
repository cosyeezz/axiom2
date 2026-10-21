import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const phase = process.argv[2];
assert.ok(['start', 'stall'].includes(phase));
const path = `app/tests/agent-timeout-${phase}.probe.ts`;
let source = await readFile('app/tests/agent.test.ts', 'utf8');
source = source.replace('{ timeout: 90000 }', `{ timeout: ${phase === 'start' ? 1 : 20000} }`);
assert.ok(source.includes('const cleanup ='));
source = source.replace('rmSync(root, { recursive: true, force: true });', 'rmSync(root, { recursive: true, force: true }); console.log("[timeout-probe] cleanup complete");');
if (phase === 'stall') source = source.replace('await wait(() => count === 5, "stall did not start");', 'await wait(() => count === 5, "stall did not start"); console.log("[timeout-probe] stalled provider reached"); await new Promise<void>(() => {});');
await writeFile(path, source);
try {
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', path], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', expired = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
  const timer = setTimeout(() => {
    expired = true;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else child.kill('SIGKILL');
  }, 60000);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  clearTimeout(timer);
  assert.equal(expired, false, 'timed-out test must exit without supervisor termination');
  assert.equal(code, 1, 'intentional timeout must be reported as a failed test');
  assert.match(output, /testTimeoutFailure/);
  assert.match(output, /\[timeout-probe\] cleanup complete/);
  if (phase === 'stall') assert.match(output, /\[timeout-probe\] stalled provider reached/);
  console.log('TIMEOUT_CLEANUP_VERIFIED', phase);
} finally { await unlink(path); }
