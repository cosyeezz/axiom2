// Reconciliation never replays an installation. It releases admission only
// after proving that every writer of the old parent transaction has exited.
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { loadUpdaterRuntime, updaterOwnerPath, updaterTaskSnapshot } from './updater-supervision.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = message => { throw Object.assign(Error(message), { code: 'stop-unconfirmed' }); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function file(path, optional = false, maximum = 524288, maxLinks = 1) {
  let fd;
  try {
    if (!isAbsolute(path) || realpathSync(dirname(path)) !== dirname(path)) fail('恢复记录目录身份已改变。');
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1n || before.nlink > BigInt(maxLinks) || before.size > BigInt(maximum)) fail('恢复记录类型或大小无效。');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd, { bigint: true }), bytes = readFileSync(fd, 'utf8'), after = lstatSync(path, { bigint: true });
    if (stat.dev !== before.dev || stat.ino !== before.ino || after.dev !== stat.dev || after.ino !== stat.ino || after.nlink !== stat.nlink || stat.nlink > BigInt(maxLinks) || Buffer.byteLength(bytes) > maximum) fail('恢复记录读取期间已改变。');
    return { path, dev: String(stat.dev), ino: String(stat.ino), nlink: Number(stat.nlink), hash: digest(bytes), bytes, value: JSON.parse(bytes) };
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
const stamp = record => ({ path: record.path, dev: record.dev, ino: record.ino, hash: record.hash });
function sharedOriginal(path, identity, maxLinks) {
  // A replacement can be non-JSON, a link or a directory. Inspect only its
  // physical identity before deciding whether it is still ours to validate.
  if (!isAbsolute(path) || realpathSync(dirname(path)) !== dirname(path)) fail('恢复记录目录身份已改变。');
  let stat;
  try { stat = lstatSync(path, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (String(stat.dev) !== String(identity.dev) || String(stat.ino) !== String(identity.ino)) return null;
  return file(path, true, 524288, maxLinks);
}
function unchanged(expected, optional = false) {
  const current = expected.role === 'pi-shared'
    ? sharedOriginal(expected.path, expected, expected.maxLinks ?? 1)
    : file(expected.path, optional, 524288, expected.maxLinks ?? 1);
  if (current && expected.role === 'pi-shared' && (current.dev !== String(expected.dev) || current.ino !== String(expected.ino))) return null;
  if (current && (current.dev !== String(expected.dev) || current.ino !== String(expected.ino) || current.hash !== expected.hash)) fail('恢复凭据或安装锁已变化，已保留文件。');
  return current;
}
function remove(expected) {
  if (!unchanged(expected, true)) return;
  rmSync(expected.path);
  if (process.platform !== 'win32') {
    const fd = openSync(dirname(expected.path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
}
function owner(record, id, hostPid) {
  const value = record?.value;
  if (value?.format !== 1 || value.id !== id || value.hostPid !== hostPid || !['intent', 'armed'].includes(value.state)) fail('进程归属记录与任务不匹配。');
  return value;
}

export async function createUpdaterReconciler(root) {
  const canonical = realpathSync(root), directory = join(canonical, 'updates');
  const { runtime, owned } = await loadUpdaterRuntime(join(directory, 'reconciliation-runtime'));
  const witnesses = [];
  const witness = path => { const record = file(path); witnesses.push(stamp(record)); return record.value; };
  function inspect(row, validateTransaction) {
    witnesses.length = 0;
    const value = JSON.parse(row.body), task = value.task;
    if (!uuid(task?.id) || !uuid(task?.attemptId) || typeof row.token !== 'string' || !Number.isSafeInteger(row.pid) || row.pid <= 0) fail('原任务身份不完整，无法自动核实。');
    const taskDirectory = join(directory, 'tasks', task.id), gatePath = updaterOwnerPath(canonical);
    updaterTaskSnapshot(canonical, task);
    const manifest = witness(join(taskDirectory, 'supervision.json'));
    if (manifest.format !== 1 || !uuid(manifest.gateId) || manifest.token !== row.token || manifest.taskId !== task.id || manifest.attemptId !== task.attemptId || manifest.root !== canonical || manifest.hostPid !== row.pid || !Array.isArray(manifest.commands) || manifest.commands.length > 256 || !Array.isArray(manifest.services) || manifest.services.length > 256) fail('恢复清单与原任务身份不匹配。');
    const gate = file(gatePath); owner(gate, manifest.gateId, row.pid);
    const removals = [], ids = new Set();
    let parentExited = false;
    if (process.platform === 'linux') parentExited = owned.canRecoverProcessOwner(gatePath);
    if (process.platform === 'win32' && manifest.parentWitness !== undefined) {
      if (manifest.parentWitness?.ready !== true || !uuid(manifest.parentWitness.nonce)) fail('父进程观察凭据不完整，已保留归属记录。');
      const ready = witness(join(taskDirectory, 'parent-ready.json')), exited = witness(join(taskDirectory, 'parent-exited.json'));
      parentExited = ready.nonce === manifest.parentWitness.nonce && exited.nonce === ready.nonce && ready.parentPid === row.pid && exited.parentPid === row.pid && exited.exited === true;
      if (!parentExited) fail('已登记父进程退出凭据不匹配，已保留归属记录。');
    }
    for (const command of manifest.commands) {
      if (!uuid(command.id) || !uuid(command.ownerId) || ids.has(command.id) || !['registered', 'cleaned'].includes(command.state)) fail('命令清单不完整或包含重复身份。');
      ids.add(command.id);
      const commandDirectory = join(taskDirectory, `command-${command.id}`), path = join(commandDirectory, 'owner.json');
      const record = file(path, command.state === 'cleaned');
      const identity = record ? owner(record, command.ownerId, row.pid) : null;
      let cleaned = command.state === 'cleaned';
      if (process.platform === 'linux' && record && !cleaned) cleaned = owned.canRecoverProcessOwner(path);
      if (process.platform === 'win32' && !cleaned) {
        const request = witness(join(commandDirectory, 'request.json')), ready = witness(join(commandDirectory, 'ready.json')), receipt = witness(join(commandDirectory, 'cleaned.json'));
        if (!uuid(request.nonce) || request.taskId !== task.id || request.attemptId !== task.attemptId || request.parentPid !== row.pid || resolve(request.taskPath ?? '') !== join(taskDirectory, 'task.json') || ready.nonce !== request.nonce || !Number.isSafeInteger(ready.pid) || ready.pid <= 0 || receipt.nonce !== request.nonce || receipt.writerStopped !== true || typeof receipt.parentExited !== 'boolean') fail('命令清理回执不匹配。');
        if (identity.state !== 'armed' || identity.identity?.platform !== 'win32' || identity.identity.workerPid !== ready.pid) fail('命令启动身份尚未核实。');
        cleaned = true;
        if (receipt.parentExited === true) parentExited = true;
      }
      if (!cleaned) fail('仍有命令退出未得到确认，保留任务与安装锁。');
      if (record) removals.push(stamp(record));
    }
    if (!parentExited) fail('原更新进程退出尚无可靠凭据，保留任务与安装锁。');
    for (const service of manifest.services) {
      if (!uuid(service.id) || ids.has(service.id)) fail('后台启动请求身份不完整。');
      ids.add(service.id);
      if (service.protocol !== 1) {
        if (service.protocol !== undefined || service.state !== 'closed' || service.requestStopped !== true) fail('后台启动请求退出尚未确认，保留服务事务与归属记录。');
        continue;
      }
      if (!uuid(service.ownerId) || !uuid(service.nonce) || !['prepared', 'armed', 'closed'].includes(service.state)) fail('后台启动许可记录不完整。');
      const requestDirectory = join(taskDirectory, `service-${service.id}`), path = join(requestDirectory, 'owner.json');
      const record = file(path, service.state === 'closed');
      const identity = record ? owner(record, service.ownerId, row.pid) : null;
      let stopped = service.state === 'closed' && service.requestStopped === true;
      // The audited wrapper cannot import the CLI without GO. A dead parent
      // whose manifest is still prepared never persisted permission to send it.
      if (service.state === 'prepared' && service.pid === undefined && service.requestStopped === false) stopped = true;
      if (service.state === 'armed') {
        if (!Number.isSafeInteger(service.pid) || service.pid <= 1 || identity?.state !== 'armed' || service.requestStopped !== false) fail('后台请求启动身份无效。');
        if (process.platform === 'linux' && identity.identity?.platform === 'linux' && identity.identity.initPid === service.pid) stopped = owned.canRecoverProcessOwner(path);
        if (process.platform === 'win32' && identity.identity?.platform === 'win32' && identity.identity.workerPid === service.pid) {
          const request = witness(join(requestDirectory, 'parent-request.json'));
          const ready = witness(join(requestDirectory, 'parent-ready.json')), exited = witness(join(requestDirectory, 'parent-exited.json'));
          stopped = [request, ready, exited].every(item => item.nonce === service.nonce && item.parentPid === service.pid) && exited.exited === true;
        }
      }
      if (!stopped) fail('后台启动请求退出尚未确认，保留服务事务与归属记录。');
      if (record) removals.push(stamp(record));
    }
    // Closing a request does not stop its daemon. Keep transaction.json intact;
    // only the existing status/stop/reservation protocol may restore service.
    const servicePending = manifest.serviceResolved !== true && (manifest.services.length > 0 || value.servicePending === true || value.reconciliation?.servicePending === true);
    if (servicePending) {
      const transaction = witness(join(directory, 'transaction.json'));
      if (typeof validateTransaction !== 'function') fail('尚未核实服务恢复事务。');
      validateTransaction(transaction);
    }
    if (manifest.piLock) {
      const lock = manifest.piLock;
      const validIdentity = part => typeof part === 'string' ? /^(0|[1-9]\d*)$/.test(part) : Number.isSafeInteger(part) && part >= 0;
      if (!isAbsolute(lock.path ?? '') || typeof lock.body !== 'string' || !validIdentity(lock.identity?.dev) || !validIdentity(lock.identity?.ino)) fail('Pi 安装锁身份不完整。');
      const body = JSON.parse(lock.body);
      if (body.token !== row.token || body.taskId !== task.id || body.attemptId !== task.attemptId || body.gateId !== manifest.gateId || body.root !== canonical || body.pid !== row.pid) fail('Pi 安装锁与原任务不匹配。');
      if (lock.staging !== undefined && lock.staging !== join(dirname(lock.path), `.axiom-pi-update-${row.token}.lock`)) fail('Pi 安装锁暂存身份无效。');
      const candidates = [sharedOriginal(lock.path, lock.identity, lock.staging ? 2 : 1)];
      if (lock.staging) candidates.push(file(lock.staging, true, 524288, 2));
      const originals = candidates.filter(current => current && current.dev === String(lock.identity.dev) && current.ino === String(lock.identity.ino));
      if (candidates[1] && !originals.includes(candidates[1])) fail('Pi 安装锁暂存文件已被替换。');
      for (const current of originals) {
        if (current.bytes !== lock.body || current.nlink !== originals.length) fail('Pi 安装锁内容或链接身份已改变。');
        removals.push({ ...stamp(current), maxLinks: lock.staging ? 2 : 1, role: current.path === lock.path ? 'pi-shared' : 'pi-staging' });
      }
      // A different inode at the shared path belongs to another transaction.
      // Never delete it; the original writers have already been proven gone.
    }
    return { format: 1, token: row.token, taskId: task.id, attemptId: task.attemptId, root: canonical, servicePending, witnesses: [...witnesses], removals, gate: stamp(gate) };
  }
  function release(plan, row) {
    const task = JSON.parse(row.body).task;
    if (plan?.format !== 1 || plan.token !== row.token || plan.root !== canonical || plan.taskId !== task.id || plan.attemptId !== task.attemptId || plan.gate?.path !== updaterOwnerPath(canonical) || !Array.isArray(plan.witnesses) || !Array.isArray(plan.removals)) fail('核实提交身份已改变。');
    // Both passes run under BEGIN IMMEDIATE. All witnesses remain untouched;
    // missing removals are permitted only after release-pending was committed.
    for (const record of plan.witnesses) unchanged(record);
    for (const record of [...plan.removals, plan.gate]) unchanged(record, true);
    const startup = join(canonical, 'service-startup.sqlite');
    let stat;
    try { stat = lstatSync(startup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('服务启动预约记录身份无效。');
      const db = new DatabaseSync(startup);
      try { db.exec('PRAGMA busy_timeout=5000'); db.prepare('DELETE FROM startup WHERE token=? AND pid=?').run(row.token, row.pid); }
      finally { db.close(); }
    }
    for (const record of plan.removals) remove(record);
    remove(plan.gate);
  }
  return { inspect, release,
    publish: task => owned.atomicJSON(join(directory, 'tasks', task.id, 'task.json'), task),
    dispose: () => rmSync(runtime, { recursive: true, force: true }),
  };
}
