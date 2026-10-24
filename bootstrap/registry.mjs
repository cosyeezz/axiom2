// A short SQLite admission lock serializes first-install claim and release.
// File cleanup is deliberately a second transaction after release-pending.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readRecord, taskId, validateTask } from './records.mjs';
import { linuxProcessGone, linuxProcessView, sameLinuxView } from '../app/dist/server/process-owner-linux-identity.mjs';

const fail = message => { throw Object.assign(Error(message), { code: 'stop-unconfirmed' }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = (path, record) => ({ path, dev: record.dev, ino: record.ino, hash: hash(record.bytes) });
function regular(path, optional = false) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('首次安装准入记录身份无效。');
    return true;
  } catch (error) { if (optional && error.code === 'ENOENT') return false; throw error; }
}
function same(proof, optional = false) {
  const current = readRecord(proof.path, optional);
  if (current && (current.dev !== proof.dev || current.ino !== proof.ino || hash(current.bytes) !== proof.hash)) fail('首次安装恢复凭据已改变，已保留占用。');
  return current;
}
function linuxGone(record) {
  try {
    const view = linuxProcessView();
    if (!record.host?.view || !sameLinuxView(view, record.host.view) || !/^[1-9]\d*$/.test(record.host.startTime) || !linuxProcessGone(record.hostPid, record.host.startTime)) return false;
    if (record.state === 'armed') {
      const identity = record.identity;
      if (identity?.platform !== 'linux' || !Number.isSafeInteger(identity.initPid) || identity.initPid <= 1 || !/^[1-9]\d*$/.test(identity.startTime) || !identity.view || !sameLinuxView(view, identity.view) || !linuxProcessGone(identity.initPid, identity.startTime)) return false;
    } else if (record.state !== 'intent' || record.identity !== undefined) return false;
    return sameLinuxView(view, linuxProcessView());
  } catch { return false; }
}
export function bootstrapCurrent(root) {
  const path = join(root, 'bootstrap/jobs.sqlite');
  if (!regular(path, true)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try { const row = db.prepare('SELECT body FROM current WHERE slot=1').get(); return row ? JSON.parse(row.body) : null; }
  finally { db.close(); }
}
export function createBootstrapRegistry(root, atomicJSON) {
  const canonical = realpathSync(root), store = join(canonical, 'bootstrap');
  mkdirSync(store, { recursive: true, mode: 0o700 });
  if (realpathSync(store) !== store || lstatSync(store).isSymbolicLink()) fail('首次安装准入目录身份无效。');
  const database = join(store, 'jobs.sqlite'), ownerPath = join(store, 'global-owner.json');
  const directory = task => join(store, task.id);
  const manifestPath = task => join(directory(task), 'binding.json');
  function locked(body) {
    regular(database, true);
    const db = new DatabaseSync(database);
    try {
      db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS current(slot INTEGER PRIMARY KEY CHECK(slot=1), body TEXT NOT NULL); BEGIN IMMEDIATE');
      const read = () => { const row = db.prepare('SELECT body FROM current WHERE slot=1').get(); return row ? JSON.parse(row.body) : null; };
      const write = value => db.prepare('INSERT INTO current VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));
      const result = body(read, write); db.exec('COMMIT'); return result;
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  }
  function identity(record, id, attempt) {
    if (!record || record.format !== 1 || record.root !== canonical || record.task?.id !== id || record.task?.attemptId !== attempt || !taskId(record.ownerId) || !Number.isSafeInteger(record.hostPid) || record.hostPid < 1) fail('首次安装任务已改变或缺少恢复身份。');
    validateTask(record.task, id);
  }
  function evidence(record, recovery) {
    const proofs = [], witness = path => { const found = readRecord(path); proofs.push(stamp(path, found)); return found.value; };
    const manifest = witness(manifestPath(record.task));
    if (manifest.format !== 1 || manifest.taskId !== record.task.id || manifest.attemptId !== record.task.attemptId || manifest.root !== canonical || manifest.ownerId !== record.ownerId || manifest.hostPid !== record.hostPid || !['none', 'registered', 'cleaned'].includes(manifest.commandState)) fail('首次安装清单与任务不匹配。');
    const disk = readRecord(ownerPath, !!record.plan);
    const owner = disk?.value ?? record.plan?.owner;
    if (disk && record.plan) same(record.plan.gate);
    if (owner?.format !== 1 || owner.id !== record.ownerId || owner.hostPid !== record.hostPid || !['intent', 'armed'].includes(owner.state)) fail('首次安装归属记录与任务不匹配。');
    if (recovery) {
      if (process.platform === 'linux') {
        if (!linuxGone(owner)) fail('原安装进程或命令树退出尚未确认。');
      } else if (process.platform === 'win32') {
        const parent = manifest.parentWitness;
        if (parent?.ready !== true || !taskId(parent.nonce)) fail('首次安装父进程退出凭据不完整。');
        const ready = witness(join(directory(record.task), 'parent-ready.json')), exited = witness(join(directory(record.task), 'parent-exited.json'));
        if (ready.nonce !== parent.nonce || ready.parentPid !== record.hostPid || exited.nonce !== parent.nonce || exited.parentPid !== record.hostPid || exited.exited !== true) fail('首次安装父进程退出凭据不匹配。');
        if (manifest.commandState === 'registered') {
          const request = witness(join(directory(record.task), 'request.json')), commandReady = witness(join(directory(record.task), 'ready.json')), cleaned = witness(join(directory(record.task), 'cleaned.json'));
          if (!taskId(request.nonce) || request.taskId !== record.task.id || request.attemptId !== record.task.attemptId || request.parentPid !== record.hostPid || request.taskPath !== join(directory(record.task), 'task.json') || commandReady.nonce !== request.nonce || !Number.isSafeInteger(commandReady.pid) || commandReady.pid <= 0 || owner.state !== 'armed' || owner.identity?.platform !== 'win32' || owner.identity.workerPid !== commandReady.pid || cleaned.nonce !== request.nonce || cleaned.writerStopped !== true) fail('首次安装命令清理凭据不完整。');
        } else if (manifest.commandState === 'none' && owner.state !== 'intent') fail('首次安装命令清单与归属状态冲突。');
      } else fail('此平台尚无可靠的首次安装恢复证明。');
    } else if (record.hostPid !== process.pid || manifest.commandState === 'registered') fail('首次安装父提交尚未完成。');
    return { owner, gate: disk ? stamp(ownerPath, disk) : record.plan.gate, witnesses: proofs };
  }
  function complete(id, attempt) {
    return locked((read, write) => {
      const record = read(); identity(record, id, attempt);
      if (record.state === 'complete') return record.task;
      if (record.state !== 'release-pending' || record.plan?.gate?.path !== ownerPath) fail('首次安装核实尚未提交。');
      for (const proof of record.plan.witnesses) same(proof);
      same(record.plan.gate, true);
      atomicJSON(join(directory(record.task), 'task.json'), record.task);
      if (same(record.plan.gate, true)) {
        rmSync(ownerPath);
        if (process.platform !== 'win32') {
          const fd = openSync(store, constants.O_RDONLY | constants.O_DIRECTORY);
          try { fsyncSync(fd); } finally { closeSync(fd); }
        }
      }
      write({ ...record, state: 'complete', plan: undefined });
      return record.task;
    });
  }
  return {
    claim(task, createOwner) {
      return locked((read, write) => {
        const old = read();
        if (old && old.state !== 'complete') fail('已有首次安装或中断核实尚未完成，请先核实原任务。');
        if (regular(ownerPath, true)) fail('已有正在运行或退出未确认的全局安装，请先核实原任务。');
        const owner = createOwner(ownerPath), value = readRecord(ownerPath).value;
        const manifest = { format: 1, taskId: task.id, attemptId: task.attemptId, root: canonical, ownerId: value.id, hostPid: process.pid, commandState: 'none' };
        if (process.platform === 'win32') manifest.parentWitness = { nonce: randomUUID(), ready: false };
        atomicJSON(manifestPath(task), manifest);
        write({ format: 1, root: canonical, task, ownerId: value.id, hostPid: process.pid, state: 'active' });
        return { owner, manifest };
      });
    },
    saveManifest(task, manifest) { atomicJSON(manifestPath(task), manifest); },
    finish(task) {
      locked((read, write) => {
        const record = read(); identity(record, task.id, task.attemptId);
        if (record.state !== 'active') fail('首次安装父提交状态已改变。');
        const plan = evidence(record, false);
        write({ ...record, task, state: 'release-pending', plan });
      });
      return complete(task.id, task.attemptId);
    },
    reconcile(id, attempt) {
      if (!taskId(id) || !taskId(attempt)) fail('必须提供原任务编号及执行编号。');
      const current = locked((read, write) => {
        const record = read(); identity(record, id, attempt);
        if (record.state === 'complete') return record;
        if (!['active', 'release-pending'].includes(record.state)) fail('首次安装核实状态无效。');
        if (record.state === 'release-pending') {
          if (!record.plan || record.plan.gate?.path !== ownerPath || !Array.isArray(record.plan.witnesses)) fail('首次安装核实计划不完整。');
          for (const proof of record.plan.witnesses) same(proof);
          same(record.plan.gate, true);
        }
        const plan = evidence(record, true), now = Date.now();
        const task = { ...record.task, status: 'interrupted', phase: 'interrupted', updatedAt: now, finishedAt: now, capabilities: { cancel: false, extend: false }, message: '已核实原安装写入者退出；安装已中断，请重新检查实际安装状态。', error: { code: 'operation', phase: record.task.phase, message: '安装协调进程已退出，未自动重试安装或启动服务。' } };
        const next = { ...record, task, state: 'release-pending', plan }; write(next); return next;
      });
      return current.state === 'complete' ? current.task : complete(id, attempt);
    },
  };
}
