import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore desktop-owned module
import { reconcileServiceInstall } from '../desktop/setup-reconciliation.mjs';
// @ts-ignore desktop-owned module
import { serviceAdmission } from '../desktop/service-admission.mjs';

const windows = { skip: process.platform !== 'win32' };
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'axiom-setup-reconcile-'))), id = '123-456', nonce = randomUUID();
  const directory = join(root, 'setup'), taskDirectory = join(directory, id), command = join(taskDirectory, 'runtime-fixture', 'command');
  await mkdir(command, { recursive: true });
  const files: Record<string, any> = {
    [join(directory, 'job.json')]: { id, action: 'service', running: true },
    [join(taskDirectory, 'task.json')]: { id, attemptId: id, resource: 'service', action: 'install', status: 'unknown', phase: 'installing', error: { code: 'stop-unconfirmed', message: 'old uncertainty' } },
    [join(directory, 'service-owner.json')]: { format: 1, id: randomUUID(), state: 'armed', hostPid: 12345, identity: { platform: 'win32', workerPid: 23456 } },
    [join(command, 'request.json')]: { nonce, parentPid: 12345, taskId: id, attemptId: id, taskPath: join(taskDirectory, 'task.json'), cwd: root, node: process.execPath, command: { file: process.execPath, args: ['npm-cli.js', 'install', '--prefix', join(root, 'service'), '--ignore-scripts'] } },
    [join(command, 'ready.json')]: { nonce, pid: 23456 },
    [join(command, 'cleaned.json')]: { nonce, writerStopped: true, parentExited: true, reason: 'parent-gone', code: null },
  };
  const save = async () => { for (const [path, body] of Object.entries(files)) await writeFile(path, JSON.stringify(body)); };
  await save();
  return { root, id, directory, taskDirectory, command, files, save, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('Windows interrupted npm install releases only after matching tree and parent exit receipts', windows, async () => {
  const f = await fixture();
  try {
    const result = await reconcileServiceInstall(f);
    assert.equal(result.reconciled, true);
    await assert.rejects(readFile(join(f.directory, 'service-owner.json')), { code: 'ENOENT' });
    assert.equal(await readFile(join(f.taskDirectory, 'result.txt'), 'utf8'), '1');
    const task = JSON.parse(await readFile(join(f.taskDirectory, 'task.json'), 'utf8'));
    assert.equal(task.status, 'failed'); assert.equal(task.phase, 'installing');
    assert.deepEqual(task.capabilities, { cancel: false, extend: false });
    assert.equal(task.reconciliation.writerStopped, true); assert.equal(task.reconciliation.parentExited, true);
    assert.equal(task.reconciliation.previousError.code, 'stop-unconfirmed');
    assert.match(task.message, /未完成/);
    await assert.rejects(readFile(join(f.root, 'installation.json')), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

for (const [name, change] of Object.entries<(f: Awaited<ReturnType<typeof fixture>>) => Promise<void> | void>({
  'parent still unconfirmed': f => { f.files[join(f.command, 'cleaned.json')].parentExited = false; },
  'writer still unconfirmed': f => { f.files[join(f.command, 'cleaned.json')].writerStopped = false; },
  'wrong nonce': f => { f.files[join(f.command, 'cleaned.json')].nonce = randomUUID(); },
  'wrong worker identity': f => { f.files[join(f.command, 'ready.json')].pid++; },
  'wrong parent identity': f => { f.files[join(f.command, 'request.json')].parentPid++; },
  'wrong task attempt': f => { f.files[join(f.command, 'request.json')].attemptId = '123-789'; },
  'wrong task path': f => { f.files[join(f.command, 'request.json')].taskPath = join(f.directory, 'job.json'); },
  'different current job': f => { f.files[join(f.directory, 'job.json')].id = '123-789'; },
  'startup might have happened': f => { f.files[join(f.taskDirectory, 'task.json')].phase = 'validating'; },
  'owner not armed': f => { f.files[join(f.directory, 'service-owner.json')].state = 'intent'; },
  'not the original npm install': f => { f.files[join(f.command, 'request.json')].command.args[1] = 'uninstall'; },
  'ambiguous runtime': async f => { await mkdir(join(f.taskDirectory, 'runtime-second')); },
  'missing cleanup receipt': f => { delete f.files[join(f.command, 'cleaned.json')]; },
})) {
  test(`Windows reconciliation retains all admission evidence: ${name}`, windows, async () => {
    const f = await fixture();
    try {
      await change(f); await f.save();
      if (name === 'missing cleanup receipt') await rm(join(f.command, 'cleaned.json'));
      const gate = await readFile(join(f.directory, 'service-owner.json')), task = await readFile(join(f.taskDirectory, 'task.json'));
      await assert.rejects(reconcileServiceInstall(f));
      assert.deepEqual(await readFile(join(f.directory, 'service-owner.json')), gate);
      assert.deepEqual(await readFile(join(f.taskDirectory, 'task.json')), task);
      await assert.rejects(readFile(join(f.taskDirectory, 'result.txt')), { code: 'ENOENT' });
    } finally { await f.cleanup(); }
  });
}

test('Windows reconciliation rejects hard-linked owner records', windows, async () => {
  const f = await fixture();
  try {
    await link(join(f.directory, 'service-owner.json'), join(f.directory, 'other-owner.json'));
    await assert.rejects(reconcileServiceInstall(f), /类型或大小无效/);
    assert.deepEqual(await readFile(join(f.directory, 'service-owner.json')), await readFile(join(f.directory, 'other-owner.json')));
  } finally { await f.cleanup(); }
});

test('Windows reconciliation serializes against active service maintenance', windows, async () => {
  const f = await fixture();
  let release;
  try {
    release = await serviceAdmission(f.root);
    await assert.rejects(reconcileServiceInstall(f), /正在安装、更新或卸载/);
    assert.equal(JSON.parse(await readFile(join(f.taskDirectory, 'task.json'), 'utf8')).status, 'unknown');
  } finally { release?.(); await f.cleanup(); }
});

test('Windows interrupted recovery commit retains owner and can finish on retry', windows, async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.taskDirectory, 'result.txt'));
    await assert.rejects(reconcileServiceInstall(f));
    const owner = JSON.parse(await readFile(join(f.directory, 'service-owner.json'), 'utf8'));
    assert.equal(JSON.parse(await readFile(join(f.taskDirectory, 'task.json'), 'utf8')).reconciliation.processOwnerId, owner.id);
    await rm(join(f.taskDirectory, 'result.txt'), { recursive: true });
    assert.equal((await reconcileServiceInstall(f)).reconciled, true);
    assert.equal(JSON.parse(await readFile(join(f.taskDirectory, 'task.json'), 'utf8')).reconciliation.previousError.code, 'stop-unconfirmed');
  } finally { await f.cleanup(); }
});
