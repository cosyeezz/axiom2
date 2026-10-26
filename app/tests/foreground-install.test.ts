import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
const { installForeground, foregroundCommand, managedPrefix, cleanManagedPrefix, withProgramReservation } = await import(new URL('../desktop/foreground-install.mjs', import.meta.url).href);
const { inspectArtifacts, inspectDownload, inspectInstallation } = await import(new URL('../desktop/foreground-artifacts.mjs', import.meta.url).href);
const { DesktopExecution, desktopTask } = await import(new URL('../desktop/maintenance.mjs', import.meta.url).href);
const bytes = Buffer.from('isolated fake archive, never passed to real npm');
const checksum = createHash('sha256').update(bytes).digest('hex');
const releaseBase = 'https://github.com/cosyeezz/axiom2/releases/download/v1.2.3/';
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fg-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskDir = join(root, 'setup', '123-456'); await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, 'task.json'), JSON.stringify({ ...desktopTask('service', 'install'), id: '123-456' }));
  const retained = join(root, 'projects', 'sessions-models-credentials.json'); await mkdir(dirname(retained), { recursive: true }); await writeFile(retained, 'private data must not change');
  const calls: string[][] = [], logs: string[] = [], prefixes: string[] = [];
  const fetcher = async (url: string) => {
    if (url.endsWith('/latest')) return new Response(JSON.stringify({ tag_name: 'v1.2.3', assets: ['axiom2.tgz', 'SHA256SUMS'].map(name => ({ name, size: bytes.length, browser_download_url: releaseBase + name })) }));
    if (url.endsWith('/SHA256SUMS')) return new Response(`${checksum}  axiom2.tgz\n`);
    assert.equal(url, releaseBase + 'axiom2.tgz'); return new Response(bytes);
  };
  const command = async (_node: string, args: string[]) => {
    calls.push(args);
    if (args[1] === 'install') {
      const prefix = args[args.indexOf('--prefix') + 1]; prefixes.push(prefix);
      const packageRoot = join(prefix, 'node_modules', '@cosyeezz', 'axiom2'); await mkdir(join(packageRoot, 'bin'), { recursive: true });
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@cosyeezz/axiom2', version: '1.2.3' }));
      await writeFile(join(packageRoot, 'bin', 'axiom2.mjs'), '// isolated fixture, not an executable service');
      return '';
    }
    assert.ok(['status', 'stop'].includes(args[1])); return JSON.stringify({ state: 'stopped' });
  };
  const options = { root, taskDir, npm: process.execPath, repair: false, command, fetcher, log: (line: string) => logs.push(line) };
  return { root, taskDir, retained, calls, logs, prefixes, options, command };
}
async function json(path: string) { return JSON.parse(await readFile(path, 'utf8')); }
async function oldInstall(f: Awaited<ReturnType<typeof fixture>>, marked = true) {
  f.options.repair = true; // These cases explicitly exercise the separate repair action.
  const prefix = marked ? join(f.root, 'service-installs', 'install-old') : join(f.root, 'service');
  const packageRoot = join(prefix, 'node_modules', '@cosyeezz', 'axiom2'); await mkdir(join(packageRoot, 'bin'), { recursive: true });
  const cli = join(packageRoot, 'bin', 'axiom2.mjs'); await writeFile(cli, '// never executed');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@cosyeezz/axiom2', version: '1.0.0' }));
  if (marked) await writeFile(join(prefix, '.axiom-desktop-install.json'), JSON.stringify({ schema: 1, id: 'private-fixture-id', root: f.root, prefix }));
  await writeFile(join(f.root, 'installation.json'), JSON.stringify({ node: process.execPath, cli }));
  await writeFile(join(f.root, 'setup', 'foreground-prefix.json'), JSON.stringify({ prefix }));
  return { prefix, cli };
}

test('foreground install verifies package but reports only installed / ready-to-start, never running', async t => {
  const f = await fixture(t); await installForeground(f.options);
  const result = await json(join(f.taskDir, 'foreground-result.json'));
  assert.equal(result.readyToStart, true); assert.equal(result.version, '1.2.3'); assert.equal(result.state, undefined);
  assert.equal((await json(join(f.root, 'installation.json'))).cli, result.cli);
  assert.equal((await json(join(f.taskDir, 'task.json'))).status, 'succeeded');
  assert.ok(!f.calls.some(args => args.includes('start'))); assert.equal(await readFile(f.retained, 'utf8'), 'private data must not change');
});
test('explicit reinstall clears only a marked stopped program directory', async t => {
  const f = await fixture(t), old = await oldInstall(f); await installForeground(f.options);
  await assert.rejects(readFile(old.cli), { code: 'ENOENT' });
  assert.notEqual(f.prefixes[0], old.prefix); assert.equal(await readFile(f.retained, 'utf8'), 'private data must not change');
});
test('legacy repair force-cleans only the verified Axiom package, retaining adjacent tools and data', async t => {
  const f = await fixture(t), old = await oldInstall(f, false), adjacent = join(old.prefix, 'independent-tool.txt');
  await writeFile(adjacent, 'do not remove'); await installForeground(f.options);
  await assert.rejects(readFile(old.cli), { code: 'ENOENT' }); assert.notEqual(f.prefixes[0], old.prefix);
  assert.equal(await readFile(adjacent, 'utf8'), 'do not remove'); assert.equal(await readFile(f.retained, 'utf8'), 'private data must not change');
  assert.match(f.logs.join('\n'), /验证归属的旧 Axiom 程序包/);
});
test('busy cleanup preserves the old directory and still installs into a new directory', async t => {
  const f = await fixture(t), old = await oldInstall(f);
  await installForeground({ ...f.options, remove: async () => { throw Object.assign(Error('fixture sharing violation'), { code: 'EBUSY' }); } });
  assert.equal(await readFile(old.cli, 'utf8'), '// never executed'); assert.notEqual(f.prefixes[0], old.prefix);
  assert.match(f.logs.join('\n'), /换新目录/);
});
test('real nonzero npm result causes one forced cleanup and fresh-prefix retry, not an unknown spinner', async t => {
  const f = await fixture(t); let attempts = 0, first = '';
  await installForeground({ ...f.options, command: async (node: string, args: string[]) => {
    if (args[1] === 'install' && ++attempts === 1) { first = args[args.indexOf('--prefix') + 1]; throw Object.assign(Error('fixture exit 1'), { code: 'child-exit', exitCode: 1 }); }
    return f.command(node, args);
  } });
  assert.equal(attempts, 2); assert.notEqual(first, f.prefixes[0]); await assert.rejects(readFile(join(first, '.axiom-desktop-install.json')), { code: 'ENOENT' });
});
test('two npm failures are a terminal failed task with the actual error, no third replay', async t => {
  const f = await fixture(t); let attempts = 0;
  await assert.rejects(installForeground({ ...f.options, command: async () => { attempts++; throw Object.assign(Error('actual npm fixture error'), { code: 'child-exit' }); } }), /actual npm fixture error/);
  assert.equal(attempts, 2); const task = await json(join(f.taskDir, 'task.json')); assert.equal(task.status, 'failed'); assert.match(task.error.message, /actual npm fixture error/);
});
test('a live old service whose stop fails is neither deleted nor re-registered', async t => {
  const f = await fixture(t), old = await oldInstall(f); const registration = await readFile(join(f.root, 'installation.json'), 'utf8');
  await installForeground({ ...f.options, command: async (node: string, args: string[]) => {
    if (args[1] === 'status') return JSON.stringify({ state: 'running' });
    if (args[1] === 'stop') throw Object.assign(Error('authenticated stop refused'), { code: 'child-exit' });
    return f.command(node, args);
  } });
  assert.equal(await readFile(join(f.root, 'installation.json'), 'utf8'), registration);
  assert.equal(await readFile(old.cli, 'utf8'), '// never executed'); assert.equal((await json(join(f.taskDir, 'foreground-result.json'))).readyToStart, false);
});
test('malformed old prefix pointer cannot permanently block explicit repair', async t => {
  const f = await fixture(t); await oldInstall(f); await writeFile(join(f.root, 'setup', 'foreground-prefix.json'), '{bad');
  await installForeground(f.options); assert.equal(f.prefixes.length, 1); assert.match(f.logs.join('\n'), /换新目录/);
});
test('old unknown task and ownership evidence are not rewritten or claimed exited', async t => {
  const f = await fixture(t); const old = join(f.root, 'setup', '999-1000'); await mkdir(old);
  const evidence = JSON.stringify({ status: 'unknown', phase: 'validating', pid: 999999, note: 'must retain evidence' });
  await writeFile(join(old, 'task.json'), evidence); await writeFile(join(f.root, 'setup', 'service-owner.json'), evidence);
  await installForeground(f.options);
  assert.equal(await readFile(join(old, 'task.json'), 'utf8'), evidence);
  await assert.rejects(readFile(join(f.root, 'setup', 'service-owner.json')), { code: 'ENOENT' });
  const audit = await json(join(f.taskDir, 'legacy-owner-archive.json'));
  assert.equal(audit.archived, true); assert.equal(audit.processExitConfirmed, false); assert.equal(audit.source, join(f.root, 'setup', 'service-owner.json'));
  assert.equal(await readFile(audit.target, 'utf8'), evidence); assert.equal(audit.sha256, createHash('sha256').update(evidence).digest('hex'));
});
test('legacy cleanup sharing violation retains its program and switches directory', async t => {
  const f = await fixture(t), old = await oldInstall(f, false);
  await installForeground({ ...f.options, remove: async () => { throw Object.assign(Error('legacy fixture sharing violation'), { code: 'EBUSY' }); } });
  assert.equal(await readFile(old.cli, 'utf8'), '// never executed'); assert.notEqual(f.prefixes[0], old.prefix); assert.match(f.logs.join('\n'), /旧程序无法清理，保留现场并换新目录/);
});
test('a concurrent launch row prevents program mutation and remains owned by its original token', async t => {
  const f = await fixture(t); let ran = false;
  const db = new DatabaseSync(join(f.root, 'service-startup.sqlite'));
  try {
    db.exec('CREATE TABLE startup (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL)'); db.prepare('INSERT INTO startup VALUES(1,?,?)').run('a'.repeat(64), process.pid);
    await assert.rejects(withProgramReservation(f.root, async () => { ran = true; }), /另一服务正在启动/);
    assert.equal(ran, false); assert.equal(db.prepare('SELECT token FROM startup').get()?.token, 'a'.repeat(64));
  } finally { db.close(); }
});
test('program mutation owns the same atomic startup slot that public CLI launches need', async t => {
  const f = await fixture(t);
  await withProgramReservation(f.root, async () => {
    const db = new DatabaseSync(join(f.root, 'service-startup.sqlite'));
    try { assert.equal(db.prepare('INSERT OR IGNORE INTO startup VALUES(1,?,?)').run('b'.repeat(64), process.pid).changes, 0); }
    finally { db.close(); }
  });
  await withProgramReservation(f.root, async () => {});
});
test('authenticated-stop cancellation of a program reservation is honored and its own row is released', async t => {
  const f = await fixture(t);
  await assert.rejects(withProgramReservation(f.root, async () => {
    const db = new DatabaseSync(join(f.root, 'service-startup.sqlite')); let token;
    try { token = db.prepare('SELECT token FROM startup').get()?.token; } finally { db.close(); }
    await writeFile(join(f.root, `service-cancel-${token}`), '');
  }), { code: 'cancelled' });
  await withProgramReservation(f.root, async () => {});
});
test('a service becoming live after the stopped probe cannot have its old files or registration replaced', async t => {
  const f = await fixture(t), old = await oldInstall(f), registration = await readFile(join(f.root, 'installation.json'), 'utf8');
  await assert.rejects(installForeground({ ...f.options, command: async (node: string, args: string[]) => {
    if (args[0] === old.cli && args[1] === 'status') await writeFile(join(f.root, 'service-control.json'), JSON.stringify({ pid: process.pid }));
    return f.command(node, args);
  } }), /旧服务进程尚未退出/);
  assert.equal(await readFile(old.cli, 'utf8'), '// never executed'); assert.equal(await readFile(join(f.root, 'installation.json'), 'utf8'), registration);
  assert.equal((await json(join(f.taskDir, 'task.json'))).status, 'failed');
});
test('active or unmanaged service preserves unknown ownership at its original path', async t => {
  const f = await fixture(t), evidence = '{"status":"unknown","note":"do not claim exited"}';
  await writeFile(join(f.root, 'setup', 'service-owner.json'), evidence);
  await installForeground({ ...f.options, command: (node: string, args: string[]) => args[1] === 'status' ? Promise.resolve(JSON.stringify({ state: 'unmanaged' })) : f.command(node, args) });
  assert.equal(await readFile(join(f.root, 'setup', 'service-owner.json'), 'utf8'), evidence);
  assert.equal((await json(join(f.taskDir, 'foreground-result.json'))).readyToStart, false); await assert.rejects(readFile(join(f.root, 'installation.json')), { code: 'ENOENT' });
});
test('unsafe ownership evidence is not removed and repair reports a real failure', async t => {
  const f = await fixture(t), target = join(f.root, 'retain-owner.txt'); await writeFile(target, '{"state":"unknown"}');
  // Directory junctions need no Windows developer-mode permission. Both this
  // and a Unix file symlink must be rejected without reading/removing the target.
  await symlink(process.platform === 'win32' ? f.root : target, join(f.root, 'setup', 'service-owner.json'), process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(installForeground(f.options), /旧安装归属记录类型异常/);
  assert.equal(await readFile(target, 'utf8'), '{"state":"unknown"}'); assert.equal((await json(join(f.taskDir, 'task.json'))).status, 'failed');
});
for (const code of ['cancelled', 'total-timeout']) test(`late ${code} after result publication cannot resolve as successful installation`, async t => {
  const f = await fixture(t); let injected = 0; const original = DesktopExecution.prototype.phase;
  t.mock.method(DesktopExecution.prototype, 'phase', async function (this: any, ...args: any[]) {
    await original.apply(this, args);
    if (args[0] === 'validating' && args[2] === false) { injected++; this.abort(code, `fixture late ${code}`); }
  });
  await assert.rejects(installForeground(f.options), { code }); assert.equal(injected, 1);
  assert.equal((await json(join(f.taskDir, 'task.json'))).status, code === 'cancelled' ? 'cancelled' : 'failed');
  assert.equal((await json(join(f.taskDir, 'foreground-result.json'))).readyToStart, true, 'even a published start result cannot override the failed task and real nonzero helper result');
});
test('symlink/junction program directory is never recursively cleaned', async t => {
  const f = await fixture(t), outside = await realpath(await mkdtemp(join(tmpdir(), 'fo-'))); t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(f.root, 'service-installs')); const link = join(f.root, 'service-installs', 'install-link');
  await writeFile(join(outside, 'retain.txt'), 'outside'); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await managedPrefix(f.root, link), false); await assert.rejects(cleanManagedPrefix(f.root, link)); assert.equal(await readFile(join(outside, 'retain.txt'), 'utf8'), 'outside');
});
test('checksum failure happens before any npm install or activation', async t => {
  const f = await fixture(t);
  await assert.rejects(installForeground({ ...f.options, fetcher: async (url: string) => url.endsWith('/axiom2.tgz') ? new Response(Buffer.alloc(bytes.length, 0x61)) : f.options.fetcher(url) }), /SHA-256/);
  assert.equal(f.prefixes.length, 0); assert.equal((await json(join(f.taskDir, 'task.json'))).status, 'failed');
});
test('malformed service status cannot masquerade as installation-and-service success', async t => {
  const f = await fixture(t);
  await assert.rejects(installForeground({ ...f.options, command: (node: string, args: string[]) => args[1] === 'status' ? Promise.resolve('{}') : f.command(node, args) }), /服务控制状态无效/);
  assert.equal((await json(join(f.taskDir, 'task.json'))).status, 'failed'); await assert.rejects(readFile(join(f.root, 'installation.json')), { code: 'ENOENT' });
});
test('foreground command retains UTF-8 stdout JSON error on its actual nonzero close', async () => {
  await assert.rejects(foregroundCommand(process.execPath, ['-e', 'const b=Buffer.from(JSON.stringify({message:"真实启动失败"}));process.stdout.write(b.subarray(0,15));process.stdout.write(b.subarray(15));process.exitCode=1;'], { capture: true }), (error: { message: string; exitCode: number }) => { assert.match(error.message, /真实启动失败/); assert.equal(error.exitCode, 1); return true; });
});
async function nextAttempt(f: Awaited<ReturnType<typeof fixture>>) {
  const taskDir = join(f.root, 'setup', '123-457'); await mkdir(taskDir);
  await writeFile(join(taskDir, 'task.json'), JSON.stringify({ ...desktopTask('service', 'install'), id: '123-457' }));
  await writeFile(join(f.root, 'setup', 'job.json'), JSON.stringify({ id: '123-457' }));
  return { ...f.options, taskDir };
}
test('installed but unmanaged and unregistered is discovered and never downloaded or installed again', async t => {
  const f = await fixture(t);
  await installForeground({ ...f.options, command: (node: string, args: string[]) => args[1] === 'status' ? Promise.resolve('{"state":"unmanaged"}') : f.command(node, args) });
  await assert.rejects(readFile(join(f.root, 'installation.json')), { code: 'ENOENT' });
  assert.equal((await inspectArtifacts(f.root)).installation.state, 'verified');
  await installForeground({ ...await nextAttempt(f), fetcher: async () => { throw Error('must not redownload'); }, command: async () => { throw Error('must not reinstall or control a service'); } });
  assert.equal(f.prefixes.length, 1);
  assert.equal((await json(join(f.root, 'setup', '123-457', 'task.json'))).status, 'succeeded');
});
test('npm success remains installed after a later status failure', async t => {
  const f = await fixture(t);
  await assert.rejects(installForeground({ ...f.options, command: (node: string, args: string[]) => args[1] === 'status' ? Promise.reject(Error('fixture control failure')) : f.command(node, args) }), /fixture control failure/);
  assert.equal((await json(join(f.taskDir, 'task.json'))).status, 'failed');
  assert.equal((await inspectInstallation(f.root)).state, 'verified');
  await installForeground({ ...await nextAttempt(f), fetcher: async () => { throw Error('must not redownload'); }, command: async () => { throw Error('must not repeat npm'); } });
  assert.equal(f.prefixes.length, 1);
});
test('verified archive survives failed npm and is reused across tasks without network', async t => {
  const f = await fixture(t);
  await assert.rejects(installForeground({ ...f.options, command: async () => { throw Object.assign(Error('npm failure'), { code: 'child-exit' }); } }), /npm failure/);
  const before = await inspectArtifacts(f.root);
  assert.equal(before.download.state, 'verified'); assert.equal(before.installation.state, 'absent');
  await installForeground({ ...await nextAttempt(f), fetcher: async () => { throw Error('verified cache must not use network'); } });
  assert.equal(f.prefixes.length, 1); assert.equal((await inspectInstallation(f.root)).state, 'verified');
});
test('archive bytes, release binding and installed CLI are revalidated rather than trusting existence', async t => {
  const f = await fixture(t); await installForeground(f.options);
  const proofPath = join(f.root, 'setup', 'foreground-download.json'), proof = await json(proofPath);
  await writeFile(proofPath, JSON.stringify({ ...proof, version: '9.9.9' }));
  await assert.rejects(inspectDownload(f.root), /正式发布/);
  await writeFile(proofPath, JSON.stringify(proof)); await writeFile(join(f.taskDir, 'axiom2.tgz'), Buffer.alloc(bytes.length));
  await assert.rejects(inspectDownload(f.root), /校验失败/);
  const installed = await inspectInstallation(f.root); await writeFile(installed.cli, '// changed');
  await assert.rejects(inspectInstallation(f.root), /入口校验失败/);
});
test('first foreground client receipt remains discoverable after a new job replaces the current pointer', async t => {
  const f = await fixture(t); await installForeground(f.options);
  await rm(join(f.root, 'setup', 'foreground-installation.json'));
  await writeFile(join(f.taskDir, 'foreground-exit.json'), JSON.stringify({ code: 0, success: true }));
  await nextAttempt(f);
  assert.equal((await inspectInstallation(f.root)).state, 'verified');
  await writeFile(join(f.taskDir, 'foreground-exit.json'), JSON.stringify({ code: 1, success: false }));
  await assert.rejects(inspectInstallation(f.root), /完成凭据待核实/);
});
test('normal native stderr is not an installation failure when actual close is zero', async () => {
  const output = await foregroundCommand(process.execPath, ['-e', 'process.stderr.write("npm WARN isolated fixture\\n");process.stdout.write("ok");'], { capture: true }); assert.equal(output, 'ok');
});
