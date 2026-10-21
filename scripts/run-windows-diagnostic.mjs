import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--import', './scripts/trace-file-operations.mjs', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...process.argv.slice(2)], { stdio: 'inherit' });
let expired = false;
const timer = setTimeout(() => {
  expired = true;
  console.error('DIAGNOSTIC_TIMEOUT: terminating this isolated test process tree', child.pid);
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit' });
  else child.kill('SIGKILL');
}, 180000);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  console.log('DIAGNOSTIC_EXIT', { code, signal, expired });
  process.exitCode = expired ? 124 : code ?? 1;
});
child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
