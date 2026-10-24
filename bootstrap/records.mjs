// First-install history is local and read-only: it never acknowledges an owner
// or replays an installation. Corrupt entries stay on disk for inspection.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { validBudgets } from '../app/desktop/maintenance.mjs';

export const taskId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function readRecord(path, optional = false) {
  let fd;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 524288n) throw Error('维护记录类型或大小无效。');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd, { bigint: true });
    if (stat.dev !== before.dev || stat.ino !== before.ino || !stat.isFile() || stat.nlink !== 1n || stat.size > 524288n) throw Error('维护记录读取期间已改变。');
    const buffer = Buffer.alloc(524289); let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length).toString('utf8'), after = lstatSync(path, { bigint: true });
    if (length > 524288 || after.dev !== stat.dev || after.ino !== stat.ino || after.nlink !== 1n) throw Error('维护记录读取期间已改变。');
    return { value: JSON.parse(bytes), bytes, dev: String(stat.dev), ino: String(stat.ino) };
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function validateTask(value, id = value?.id) {
  if (!taskId(id) || value?.id !== id || !taskId(value.attemptId) || value.resource !== 'bootstrap-global' || value.action !== 'install' || typeof value.label !== 'string' || typeof value.phase !== 'string' || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !Array.isArray(value.steps) || value.steps.some(step => typeof step !== 'string') || !validBudgets(value.budgets) || !['running', 'cancelling', 'unknown', 'interrupted', 'succeeded', 'failed', 'cancelled'].includes(value.status) || typeof value.capabilities?.cancel !== 'boolean' || typeof value.capabilities?.extend !== 'boolean') throw Error('首次安装维护记录身份或内容不完整。');
  if (['succeeded', 'failed', 'cancelled'].includes(value.status) && !Number.isFinite(value.finishedAt)) throw Error('首次安装终态记录缺少完成时间。');
  return value;
}
export function bootstrapHistory(root) {
  const store = join(root, 'bootstrap'), tasks = [], errors = [];
  let entries;
  try {
    const stat = lstatSync(store);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(store) !== store) throw Error('首次安装记录目录身份无效。');
    entries = readdirSync(store, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { tasks, errors, partial: false };
    return { tasks, errors: [{ path: store, message: error.message }], partial: true };
  }
  for (const entry of entries) {
    if (!taskId(entry.name)) continue;
    const directory = join(store, entry.name), path = join(directory, 'task.json');
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(directory) !== directory) throw Error('首次安装任务目录身份无效。');
      const value = validateTask(readRecord(path).value, entry.name);
      // History does not establish a live lease. Controls use the original
      // task/attempt identity through the explicit cancel and extend commands.
      tasks.push({ ...value, capabilities: { cancel: false, extend: false } });
    } catch (error) { errors.push({ path, message: error.message }); }
  }
  tasks.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  let completed = 0;
  return { tasks: tasks.filter(task => !['succeeded', 'failed', 'cancelled'].includes(task.status) || ++completed <= 100), errors, partial: errors.length > 0 };
}
