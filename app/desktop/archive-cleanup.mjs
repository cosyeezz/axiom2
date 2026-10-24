// Only digest-addressed backend download archives; never recursive deletion.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { lstat, open, opendir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
const pattern = /^[a-f0-9]{64}-axiom2\.tgz$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = stat => [String(stat.dev), String(stat.ino), stat.size, stat.mtimeMs, stat.ctimeMs];
const note = '只删除已核实摘要的后台下载包；旧版本、临时运行目录、安装任务归档、公共缓存及维护凭据保留。';
async function stat(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function parents(path) {
  const rows = []; let current = resolve(path);
  for (;;) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('归档父目录不是普通目录，请核实路径。');
    rows.push([current, String(info.dev), String(info.ino)]);
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return hash(rows);
}
async function boundary(root) {
  if (!isAbsolute(root)) throw Error('清理需要绝对数据目录。');
  const binding = await parents(join(root, 'updates'));
  for (const relative of ['updates/transaction.json', 'setup/service-owner.json']) {
    if (await stat(join(root, relative))) throw Error('安装或恢复尚未核实，不能清理下载归档。');
  }
  return binding;
}
async function archive(path, budget, signal) {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 128 * 1024 * 1024 || info.size > budget.remaining) throw Error('归档类型或大小超出核实范围。');
    budget.remaining -= info.size;
    const digest = createHash('sha256'), bytes = Buffer.alloc(256 * 1024); let total = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, 0, bytes.length, null);
      if (!bytesRead) break;
      total += bytesRead; if (total > info.size) throw Error('归档读取期间变化。');
      digest.update(bytes.subarray(0, bytesRead));
    }
    if (total !== info.size || JSON.stringify(identity(info)) !== JSON.stringify(identity(await file.stat()))) throw Error('归档读取期间变化。');
    return { file: identity(info), sha256: digest.digest('hex'), size: info.size };
  } finally { await file.close(); }
}
export async function inspectArchives(root, { signal, platform = process.platform } = {}) {
  const parentsHash = await boundary(root), directory = join(root, 'updates'), items = [], targets = [];
  const budget = { remaining: 512 * 1024 * 1024 };
  let count = 0;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    signal?.throwIfAborted();
    if (++count > 1000) { items.push({ label: '其他归档', state: 'unverified', note: '目录项超过本次核实上限，仍有内容未检查。' }); break; }
    if (/^archive-quarantine-[a-f0-9-]{36}$/.test(entry.name)) {
      items.push({ label: '中断清理的隔离文件', path: join(directory, entry.name), state: 'unverified', note: '文件已保留；身份变化或中断后需要单独核实，不能自动删除。' });
      continue;
    }
    if (!pattern.test(entry.name)) continue;
    const path = join(directory, entry.name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('路径不是普通文件。');
      const snapshot = await archive(path, budget, signal);
      if (!entry.name.startsWith(snapshot.sha256 + '-')) throw Error('内容摘要与下载文件名不一致。');
      if (platform === 'win32') {
        items.push({ id: entry.name, label: '后台下载归档', path, state: 'unverified', size: snapshot.size, note: '当前 Windows 客户端尚不支持此归档的安全删除；已保留文件。' });
        continue;
      }
      targets.push({ id: entry.name, ...snapshot });
      items.push({ id: entry.name, label: '后台下载归档', path, state: 'remove', size: snapshot.size, note: '删除后再次更新可能需要重新下载。' });
    } catch (error) { items.push({ label: '待核实下载归档', path, state: 'unverified', note: error.message }); }
  }
  if (await boundary(root) !== parentsHash) throw Error('归档目录身份已变化。');
  targets.sort((a, b) => a.id.localeCompare(b.id));
  items.push({ label: '其他安装空间与缓存', state: 'retain', note });
  signal?.throwIfAborted();
  const info = await lstat(directory, { bigint: true });
  return { root: resolve(root), parentsHash, directory: [String(info.dev), String(info.ino)], identity: hash([resolve(root), parentsHash, targets]), targets, items };
}
export function archiveWorker({ root, taskId, op, target, directory, executable = process.env.AXIOM_DESKTOP_EXECUTABLE }) {
  if (!executable || !isAbsolute(executable)) throw Error('客户端缺少归档安全执行器，请更新客户端后重试。');
  const result = spawnSync(executable, ['--axiom-archive-worker', JSON.stringify({ root, taskId, op, target, directory })], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 32768, windowsHide: true });
  if (result.error || result.signal) throw Object.assign(Error('归档提交退出状态需要核实；请读取任务后核实，不要重复删除。'), { code: 'stop-unconfirmed' });
  let value; try { value = JSON.parse(result.stdout); } catch { throw Error('归档执行器未返回有效结果。'); }
  if (result.status !== 0 || value.error) throw Error(value.error || '归档执行器失败。');
  return value;
}
export async function removeArchive({ root, preview, id, taskId, executable, signal, checkpoint = async () => {}, progress = async () => {} }) {
  if (!pattern.test(id ?? '') || preview?.root !== resolve(root) || !Array.isArray(preview.targets)) throw Error('归档确认无效，请重新预览。');
  const target = preview.targets.find(row => row.id === id);
  if (!target) throw Error('归档不在本次预览范围。');
  const path = join(root, 'updates', id);
  await progress('checking', '正在复核所选下载归档…');
  signal?.throwIfAborted();
  if (await boundary(root) !== preview.parentsHash) throw Error('归档父目录已变化，请重新预览。');
  const actual = await archive(path, { remaining: 128 * 1024 * 1024 }, signal);
  if (hash(actual) !== hash({ file: target.file, sha256: target.sha256, size: target.size }) || !id.startsWith(actual.sha256 + '-')) throw Error('下载归档已变化，请重新预览。');
  if (await boundary(root) !== preview.parentsHash || JSON.stringify(identity(await lstat(path))) !== JSON.stringify(target.file)) throw Error('删除前归档身份已变化。');
  await checkpoint(); signal?.throwIfAborted();
  await progress('removing', '正在隔离并清理所选下载归档…');
  const committed = archiveWorker({ root, taskId, op: 'remove', target, directory: preview.directory, executable });
  if (!committed.removed) throw Error('归档删除结果未确认。');
  await progress('validating', '正在复查所选归档路径…');
  const remaining = !!await stat(path);
  return { complete: !remaining, items: [{ label: '所选后台下载归档', path, state: remaining ? 'remaining' : 'removed' }, { label: '其他安装空间与缓存', state: 'retain', note }] };
}
