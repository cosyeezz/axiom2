// Only the current desktop-owned package is removable. Never delete a shared prefix.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile, readlink, realpath, rename, rm, open } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathIdentity } from './pi-removal.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const journalPath = root => join(root, 'updates/service-removal-journal.json');
async function read(path) {
  const identity = await pathIdentity(path);
  if (identity.missing) return null;
  if (identity.link || !(await lstat(path)).isFile() || Number(identity.size) > 131072) throw Error('后台维护记录类型或大小无效。');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function save(path, value) {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    if (process.platform !== 'win32') { const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
  } finally { await rm(temporary, { force: true }); }
}
async function directoryIdentity(path, optional = false) {
  const identity = await pathIdentity(path);
  if (optional && identity.missing) return identity;
  if (identity.link || !(await lstat(path)).isDirectory() || await realpath(path) !== path) throw Error('托管后台父目录存在链接或不是普通目录。');
  delete identity.modified; delete identity.size; return identity;
}
async function roots(root) {
  const actual = await realpath(root), prefix = join(actual, 'service'), packageRoot = join(prefix, 'node_modules/@cosyeezz/axiom2');
  const parents = [];
  for (const path of [actual, prefix, join(prefix, 'node_modules'), join(prefix, 'node_modules/@cosyeezz'), join(actual, 'updates')]) parents.push(await directoryIdentity(path));
  parents.push(await directoryIdentity(join(prefix, 'node_modules/.bin'), true));
  return { actual, prefix, packageRoot, parentsHash: digest(parents), commands: [join(prefix, 'node_modules/.bin/axiom2')] };
}
function itemsFor(paths) {
  return [{ label: '后台程序、应用内 Pi 与包内依赖', path: paths.packageRoot, state: 'remove' }, ...paths.commands.map(path => ({ label: '后台命令入口', path, state: 'remove' })), { label: '本机安装登记', path: join(paths.actual, 'installation.json'), state: 'remove' }, { label: '会话、项目、模型设置、凭据与独立工具', path: paths.actual, state: 'retain', note: '卸载后台前可先单独卸载所需工具；用户数据保留。' }, { label: '安装归档、历史更新备份与共享前缀', path: paths.prefix, state: 'unverified', note: '不删除整个 service 前缀；残留需按记录另行核实。' }];
}
async function inspectCommands(paths) {
  const identities = [];
  for (const path of paths.commands) {
    const identity = await pathIdentity(path);
    if (!identity.missing && (!identity.link || resolve(dirname(path), await readlink(path)) !== join(paths.packageRoot, 'bin/axiom2.mjs'))) throw Error('后台命令入口归属已改变。');
    identities.push(identity);
  }
  return identities;
}
async function livePackage(paths) {
  const registered = await read(join(paths.actual, 'installation.json'));
  if (!registered || registered.cli !== join(paths.packageRoot, 'bin/axiom2.mjs') || typeof registered.node !== 'string' || !isAbsolute(registered.node)) throw Error('只支持当前数据目录内有完整登记的托管后台。');
  const node = await realpath(registered.node), inside = relative(paths.packageRoot, node);
  if (!inside || !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside)) throw Error('Node 位于待删除的后台目录内。');
  const packageIdentity = await directoryIdentity(paths.packageRoot);
  await directoryIdentity(join(paths.packageRoot, 'bin'));
  if ((await pathIdentity(registered.cli)).link || await realpath(registered.cli) !== registered.cli) throw Error('后台程序入口存在链接。');
  const pkg = await read(join(paths.packageRoot, 'package.json'));
  if (pkg?.name !== '@cosyeezz/axiom2' || typeof pkg.version !== 'string') throw Error('后台包身份无效。');
  const originalHash = digest([packageIdentity, await pathIdentity(registered.cli), await pathIdentity(join(paths.packageRoot, 'package.json')), await pathIdentity(node), registered]);
  return { registered, packageIdentity, originalHash, registrationHash: digest(registered), version: pkg.version };
}
export async function serviceRemovalPending(root) {
  const journal = await read(journalPath(root));
  return !!journal && journal.phase !== 'complete';
}
export async function inspectServiceRemoval(root) {
  if (process.platform === 'win32') throw Error('此平台的后台命令包装器尚未支持安全卸载，请使用原安装方式。');
  const paths = await roots(root), journal = await read(journalPath(paths.actual));
  const commandsIdentity = await inspectCommands(paths), items = itemsFor(paths);
  if (journal && journal.phase !== 'complete') {
    const keys = ['format', 'root', 'id', 'phase', 'parentsHash', 'packageIdentity', 'originalHash', 'registrationHash', 'version'];
    if (Object.keys(journal).some(key => !keys.includes(key)) || journal.format !== 1 || journal.root !== paths.actual || !['prepared', 'quarantined'].includes(journal.phase) || !/^[a-f0-9]{32}$/.test(journal.id) || journal.parentsHash !== paths.parentsHash || !['originalHash', 'registrationHash'].every(key => /^[a-f0-9]{64}$/.test(journal[key])) || journal.packageIdentity?.path !== paths.packageRoot || journal.packageIdentity.link || typeof journal.packageIdentity.dev !== 'string' || typeof journal.packageIdentity.ino !== 'string' || typeof journal.version !== 'string') throw Error('后台卸载恢复记录无效，未删除任何文件。');
    const quarantine = join(paths.prefix, `.axiom2-remove-${journal.id}`);
    const original = await pathIdentity(paths.packageRoot), isolated = await pathIdentity(quarantine), registered = await read(join(paths.actual, 'installation.json'));
    if (!original.missing && (journal.phase !== 'prepared' || !isolated.missing || (await livePackage(paths)).originalHash !== journal.originalHash)) throw Error('后台已重新安装或身份改变，请核实原卸载任务。');
    if (!isolated.missing && (isolated.link || isolated.dev !== journal.packageIdentity.dev || isolated.ino !== journal.packageIdentity.ino || !(await lstat(quarantine)).isDirectory())) throw Error('隔离目录身份已变化。');
    if (registered && digest(registered) !== journal.registrationHash) throw Error('安装登记已改变，未继续清理。');
    return { ...paths, root: paths.actual, items, journal, quarantine, version: journal.version, registered: original.missing ? undefined : registered, resume: true, identity: digest([journal, original, isolated, registered, commandsIdentity]) };
  }
  const live = await livePackage(paths);
  return { ...paths, root: paths.actual, ...live, items, identity: digest([paths.parentsHash, live, commandsIdentity]) };
}
export async function removeManagedService({ root, preview, stop, reserve, release, progress }) {
  let current = await inspectServiceRemoval(root);
  if (current.identity !== preview.identity) throw Error('后台安装或恢复记录已变化，请重新预览。');
  await progress('stopping', '正在停止后台并确认进程退出…');
  if (current.registered) await stop(current.registered);
  // Callers must hold the shared install/update admission lease and verify the
  // startup reservation against service-control PID liveness before returning.
  await reserve();
  try {
    current = await inspectServiceRemoval(root);
    if (current.identity !== preview.identity) throw Error('停服期间后台安装已改变。');
    const journal = current.journal ?? { format: 1, root: current.root, id: randomBytes(16).toString('hex'), phase: 'prepared', parentsHash: current.parentsHash, packageIdentity: current.packageIdentity, originalHash: current.originalHash, registrationHash: current.registrationHash, version: current.version };
    const quarantine = join(current.prefix, `.axiom2-remove-${journal.id}`);
    const boundary = async () => { if ((await roots(root)).parentsHash !== journal.parentsHash) throw Error('后台父目录身份已变化，已停止删除。'); };
    await boundary(); await save(journalPath(current.root), journal);
    await progress('removing', '正在移除已确认的后台程序和入口…');
    await boundary();
    if (!(await pathIdentity(current.packageRoot)).missing) {
      if ((await livePackage(current)).originalHash !== journal.originalHash) throw Error('后台文件已改变，未隔离程序。');
      await rename(current.packageRoot, quarantine);
    }
    journal.phase = 'quarantined'; await boundary(); await save(journalPath(current.root), journal);
    for (const path of current.commands) {
      await boundary(); await inspectCommands(current);
      if (!(await pathIdentity(path)).missing) await rm(path);
    }
    await boundary();
    const registration = join(current.root, 'installation.json'), registered = await read(registration);
    if (registered) { if (digest(registered) !== journal.registrationHash) throw Error('后台登记已改变，保留登记。'); await rm(registration); }
    await boundary();
    const isolated = await pathIdentity(quarantine);
    if (!isolated.missing) {
      if (isolated.link || isolated.dev !== journal.packageIdentity.dev || isolated.ino !== journal.packageIdentity.ino) throw Error('隔离目录身份改变，未继续删除。');
      await rm(quarantine, { recursive: true });
    }
    await progress('validating', '正在复查后台程序、命令和安装登记…');
    const cleanup = await verifyServiceRemoval({ root: current.root, quarantine });
    if (!cleanup.complete) throw Error('后台清理仍有残留，请重新预览继续处理。');
    journal.phase = 'complete'; await boundary(); await save(journalPath(current.root), journal);
    return cleanup;
  } finally { await release(); }
}
export async function verifyServiceRemoval({ root, quarantine }) {
  const paths = await roots(root);
  if (quarantine && (dirname(quarantine) !== paths.prefix || !/^\.axiom2-remove-[a-f0-9]{32}$/.test(quarantine.slice(paths.prefix.length + 1)))) throw Error('隔离路径无效。');
  const items = await Promise.all(itemsFor(paths).map(async item => item.state !== 'remove' ? item : { ...item, state: (await pathIdentity(item.path)).missing ? 'removed' : 'remaining' }));
  if (quarantine) items.push({ label: '卸载隔离目录', path: quarantine, state: (await pathIdentity(quarantine)).missing ? 'removed' : 'remaining' });
  return { items, complete: !items.some(item => item.state === 'remaining') };
}
