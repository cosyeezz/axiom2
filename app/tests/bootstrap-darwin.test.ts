import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const { execute } = await import(new URL('../desktop/updater.mjs', import.meta.url).href);
const { loadUpdaterRuntime } = await import(new URL('../desktop/updater-supervision.mjs', import.meta.url).href);
const { desktopTask, DesktopExecution } = await import(new URL('../desktop/maintenance.mjs', import.meta.url).href);
const darwin = { skip: process.platform !== 'darwin', timeout: 20000 };
async function temporary(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'axiom-darwin-supervision-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
test('embedded runtime imports with complete local dependencies', async t => {
  const root = await temporary(t), loaded = await loadUpdaterRuntime(root);
  assert.equal(typeof loaded.owned.runOwnedCommand, 'function');
});
test('Darwin supervised harmless command runs without network', darwin, async () => {
  assert.equal(await execute(process.execPath, ['-e', 'process.stdout.write("owned-command-ok")']), 'owned-command-ok');
});
test('Darwin admission failure never starts the business command', darwin, async t => {
  const root = await temporary(t), { owned } = await loadUpdaterRuntime(root);
  const directory = join(root, 'command'), marker = join(root, 'must-not-exist'); await mkdir(directory);
  const execution = new DesktopExecution(desktopTask('probe', 'check'), () => {});
  const ownership = { confirmed: true }; let armed = false;
  const rejection = Error('deliberate ownership rejection');
  try {
    await assert.rejects(owned.runOwnedCommand({ directory, execution, owner: { arm() { armed = true; throw rejection; } }, ownership,
      file: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`], cwd: root, capture: true }), /deliberate ownership rejection/);
    assert.equal(armed, true); assert.equal(ownership.confirmed, true);
    await assert.rejects(access(marker));
  } finally { await execution.finish(rejection); }
});
test('Darwin command deadline stops the owned worker', darwin, async t => {
  const root = await temporary(t), marker = join(root, 'pid');
  await assert.rejects(execute(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(()=>{},1000)`], { timeoutMs: 1500 }), { code: 'total-timeout' });
  const pid = Number(await readFile(marker, 'utf8'));
  assert.ok(Number.isSafeInteger(pid));
  assert.equal(live(pid), false);
});
function live(pid: number) {
  try { return !execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().startsWith('Z'); }
  catch { return false; }
}
test('Darwin worker stops its group if the coordinating host dies', darwin, async t => {
  const root = await temporary(t), marker = join(root, 'business-pid'), hostFile = join(root, 'host.mjs');
  const updater = new URL('../desktop/updater.mjs', import.meta.url).href;
  const command = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));setInterval(()=>{},1000)`;
  await writeFile(hostFile, `import { execute } from ${JSON.stringify(updater)}; await execute(process.execPath, ['-e', ${JSON.stringify(command)}]);`);
  const host = spawn(process.execPath, [hostFile], { env: { ...process.env, TMPDIR: root }, stdio: 'ignore' });
  const exited = new Promise<void>(resolve => host.once('exit', () => resolve()));
  let pid = 0;
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { try { pid = Number(await readFile(marker, 'utf8')); if (pid) break; } catch {} await delay(25); }
    assert.ok(pid > 1, 'business command started after admission');
    host.kill('SIGKILL'); await exited;
    const until = Date.now() + 5000;
    while (live(pid) && Date.now() < until) await delay(25);
    assert.equal(live(pid), false, 'IPC loss stops the known child group');
  } finally { if (host.exitCode === null && host.signalCode === null) { host.kill('SIGKILL'); await exited; } }
});
test('Darwin short worker deadline preserves the timeout code', darwin, async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), { code: 'total-timeout' });
});
test('Darwin host loss stops an observed detached descendant', darwin, async t => {
  const root = await temporary(t), marker = join(root, 'detached-pid'), hostFile = join(root, 'host.mjs');
  const descendant = 'setTimeout(()=>process.exit(0),12000)';
  const command = `const cp=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(cp.pid));setInterval(()=>{},1000)`;
  await writeFile(hostFile, `import { execute } from ${JSON.stringify(new URL('../desktop/updater.mjs', import.meta.url).href)};await execute(process.execPath,['-e',${JSON.stringify(command)}]);`);
  const host = spawn(process.execPath, [hostFile], { env: { ...process.env, TMPDIR: root }, stdio: 'ignore' });
  const exited = new Promise<void>(resolve => host.once('exit', () => resolve()));
  let pid = 0, observed = false;
  async function registered(path: string): Promise<boolean> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && await registered(join(path, entry.name))) return true;
      if (entry.name === 'pid-members.json') { const record = JSON.parse(await readFile(join(path, entry.name), 'utf8')); if (record.identity?.members?.some((item: { pid: number }) => item.pid === pid)) return true; }
    }
    return false;
  }
  try {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      try { pid = Number(await readFile(marker, 'utf8')); observed = await registered(root); } catch {}
      if (pid > 1 && observed) break; await delay(25);
    }
    assert.ok(observed, 'detached descendant was durably registered');
    host.kill('SIGKILL'); await exited;
    const deadline = Date.now() + 3000;
    while (live(pid) && Date.now() < deadline) await delay(25);
    assert.equal(live(pid), false);
  } finally {
    if (host.exitCode === null && host.signalCode === null) { host.kill('SIGKILL'); await exited; }
    // The test descendant also has a bounded lifetime if an assertion fails.
  }
});
