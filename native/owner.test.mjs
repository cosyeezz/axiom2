import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const milliseconds = () => Number(process.hrtime.bigint() / 1_000_000n);
const helper = fileURLToPath(new URL(`../bin/native/linux-${process.arch}/axiom-owner`, import.meta.url));
function identity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined; throw error; }
}
function descendants(pid, result = []) {
  let children;
  try { children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim(); }
  catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  for (const child of children.split(/\s+/).filter(Boolean).map(Number)) {
    const start = identity(child);
    if (start) { result.push({ pid: child, start }); descendants(child, result); }
  }
  return result;
}

for (const scenario of ['normal', 'stop', 'deadline', 'extend', 'no-go', 'stopped-worker']) {
  test(`native ownership: ${scenario}`, { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'axiom-native-test-'));
    const entry = join(directory, 'worker.cjs');
    writeFileSync(entry, `
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const marker = path.join(__dirname, 'leaf');
if (process.argv[2] === 'leaf') {
  fs.writeFileSync(marker, 'ready'); setInterval(() => {}, 1000);
} else if (process.argv[2] === 'middle') {
  spawn(process.execPath, [__filename, 'leaf'], {detached:true, stdio:'ignore'}).unref();
} else {
  spawn(process.execPath, [__filename, 'middle'], {detached:true, stdio:'ignore'}).unref();
  const timer = setInterval(() => {
    if (!fs.existsSync(marker)) return;
    clearInterval(timer);
    process.send({pid:process.pid, uid:process.getuid(), gid:process.getgid(), data:Buffer.from([0,255,1,128])});
  }, 10);
  process.on('message', message => { if (message === 'exit') process.exit(7); });
}
`);
    const nonce = randomUUID(), initial = milliseconds() + (scenario === 'no-go' ? 500 : 5000);
    const child = fork(entry, [], { execPath: helper, execArgv: [process.execPath], serialization: 'advanced',
      env: { ...process.env, AXIOM_OWNER_PARENT: String(process.pid), AXIOM_OWNER_NONCE: nonce, AXIOM_OWNER_DEADLINE: String(initial) },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe'] });
    let stderr = '', buffer = '', receipt, ready = false, closed = false, message, error;
    const send = line => { if (!child.stdio[4].destroyed) child.stdio[4].write(line + '\n'); };
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdio[4].on('error', failure => { error ??= failure; });
    child.on('error', failure => { error ??= failure; });
    child.on('message', value => { message = value; });
    const exited = new Promise(resolve => child.on('close', (code, signal) => { closed = true; resolve({ code, signal }); }));
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const fields = line.split(' ');
        if (fields[1] !== nonce) { error = Error('Protocol nonce mismatch'); continue; }
        if (fields[0] === 'READY') { ready = true; if (scenario !== 'no-go') send('GO'); }
        if (fields[0] === 'CLEANED') receipt = { reason: Number(fields[2]), status: Number(fields[3]) };
      }
    });
    try {
      const until = Date.now() + 6000;
      while (!closed && !error && !(ready && (message || scenario === 'no-go')) && Date.now() < until) await delay(10);
      assert.ok(ready, `No READY: ${stderr}; ${error ?? ''}`);
      let owned = descendants(child.pid);
      if (scenario !== 'no-go') {
        assert.ok(message, `Worker did not start: ${stderr}`);
        assert.equal(message.pid, 2); assert.equal(message.uid, process.getuid()); assert.equal(message.gid, process.getgid());
        assert.ok(Buffer.isBuffer(message.data)); assert.deepEqual([...message.data], [0,255,1,128]);
        // PID1, the worker and a detached orphan must all belong to the launcher.
        assert.ok(owned.length >= 3, JSON.stringify(owned));
      }
      if (scenario === 'normal') child.send('exit');
      else if (scenario === 'stop') send('STOP');
      else if (scenario === 'deadline' || scenario === 'stopped-worker') {
        if (scenario === 'stopped-worker') {
          const init = owned[0].pid;
          const worker = Number(readFileSync(`/proc/${init}/task/${init}/children`, 'utf8').trim().split(/\s+/)[0]);
          assert.ok(owned.some(item => item.pid === worker)); process.kill(worker, 'SIGSTOP');
        }
        send(`DEADLINE ${milliseconds() + 150}`);
      } else if (scenario === 'extend') {
        send(`DEADLINE ${milliseconds() + 150}`);
        send(`DEADLINE ${milliseconds() + 2000}`);
        await delay(300); assert.equal(closed, false); send('STOP');
      }
      const status = await exited;
      assert.ok(receipt, `No CLEANED: ${stderr}; ${error ?? ''}`);
      assert.equal(receipt.reason, scenario === 'normal' ? 0 : ['stop', 'extend'].includes(scenario) ? 1 : 2);
      assert.equal(status.code, scenario === 'normal' ? 7 : 1);
      for (const item of owned) assert.notEqual(identity(item.pid), item.start, `Owned process still present: ${item.pid}`);
    } finally {
      if (!closed) { send('STOP'); await Promise.race([exited, delay(2000)]); }
      if (!closed) { child.kill('SIGKILL'); await exited; }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
