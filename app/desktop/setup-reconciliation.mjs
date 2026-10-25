// This never resumes npm, starts a daemon or infers tree exit from a missing PID.
// Legacy Windows installs have one supervised npm command, but no startup
// manifest. Only an install still in `installing` can therefore be reconciled.
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceAdmission } from './service-admission.mjs';

const fail = message => { throw Object.assign(Error(message), { code: 'stop-unconfirmed' }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function record(path) {
  if (realpathSync(dirname(path)) !== dirname(path)) fail('安装恢复目录身份已改变。');
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 524288n) fail('安装恢复记录类型或大小无效。');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = fstatSync(fd, { bigint: true }), bytes = readFileSync(fd, 'utf8'), after = lstatSync(path, { bigint: true });
    if (before.dev !== current.dev || before.ino !== current.ino || after.dev !== current.dev || after.ino !== current.ino || current.nlink !== 1n || after.nlink !== 1n || Buffer.byteLength(bytes) > 524288) fail('安装恢复记录读取期间已改变。');
    return { path, dev: current.dev, ino: current.ino, hash: createHash('sha256').update(bytes).digest('hex'), value: JSON.parse(bytes) };
  } finally { closeSync(fd); }
}
function unchanged(expected) {
  const current = record(expected.path);
  if (current.dev !== expected.dev || current.ino !== expected.ino || current.hash !== expected.hash) fail('安装恢复凭据已变化，已保留占用。');
}
function atomicText(path, text) {
  const temporary = `${path}.${randomUUID()}.next`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
}

export async function reconcileServiceInstall({ root, id } = {}) {
  if (process.platform !== 'win32') fail('此平台尚无可用的安装退出回执核实流程，已保留占用。');
  if (typeof id !== 'string' || !/^\d+-\d+$/.test(id)) fail('安装恢复任务编号无效。');
  const canonical = realpathSync(root), directory = join(canonical, 'setup'), taskDirectory = join(directory, id);
  const release = await serviceAdmission(canonical);
  try {
    const witnesses = [], witness = path => { const item = record(path); witnesses.push(item); return item.value; };
    const job = witness(join(directory, 'job.json'));
    const original = record(join(taskDirectory, 'task.json')), task = original.value;
    if (job.id !== id || job.action !== 'service' || task.id !== id || task.attemptId !== id || task.resource !== 'service' || task.action !== 'install') fail('安装记录与待恢复任务身份不匹配。');
    // Publication precedes the startup call. Any later phase is deliberately
    // refused: a daemon might have started outside the npm job.
    if (task.phase !== 'installing') fail('任务可能已进入后台启动阶段，不能自动解除占用；请核实后台启动与进程归属记录。');
    const gatePath = join(directory, 'service-owner.json'), gate = record(gatePath), owner = gate.value;
    if (owner.format !== 1 || !uuid(owner.id) || owner.state !== 'armed' || !Number.isSafeInteger(owner.hostPid) || owner.hostPid <= 1 || owner.identity?.platform !== 'win32' || !Number.isSafeInteger(owner.identity.workerPid) || owner.identity.workerPid <= 1) fail('安装进程归属身份不完整，已保留占用。');
    const runtimes = readdirSync(taskDirectory, { withFileTypes: true }).filter(entry => entry.name.startsWith('runtime-'));
    if (runtimes.length !== 1 || !runtimes[0].isDirectory() || runtimes[0].isSymbolicLink()) fail('安装监督器记录不唯一或类型无效，已保留占用。');
    const commandDirectory = join(taskDirectory, runtimes[0].name, 'command');
    const request = witness(join(commandDirectory, 'request.json')), ready = witness(join(commandDirectory, 'ready.json')), receipt = witness(join(commandDirectory, 'cleaned.json'));
    if (!uuid(request.nonce) || request.parentPid !== owner.hostPid || request.taskId !== id || request.attemptId !== id || typeof request.taskPath !== 'string' || realpathSync(request.taskPath) !== original.path || typeof request.cwd !== 'string' || realpathSync(request.cwd) !== canonical) fail('安装命令回执与原任务不匹配。');
    if (ready.nonce !== request.nonce || ready.pid !== owner.identity.workerPid || receipt.nonce !== request.nonce || receipt.writerStopped !== true || receipt.parentExited !== true) fail('尚未确认原协调器与安装进程树全部退出，已保留占用。');
    const command = request.command;
    if (typeof request.node !== 'string' || command?.file !== request.node || !Array.isArray(command.args) || command.args[1] !== 'install' || command.args[2] !== '--prefix' || typeof command.args[3] !== 'string' || resolve(command.args[3]).toLowerCase() !== join(canonical, 'service').toLowerCase() || !command.args.includes('--ignore-scripts')) fail('原命令并非受监督的后台依赖安装，已保留占用。');
    for (const item of [...witnesses, original, gate]) unchanged(item);
    const now = Date.now(), message = '已凭退出回执确认原安装协调器与 npm 进程树全部停止，已解除安装占用。上次安装未完成，请重新验证环境后重试。';
    const updated = { ...task, status: 'failed', message, updatedAt: now, finishedAt: now, capabilities: { cancel: false, extend: false }, error: { code: 'operation', phase: task.phase, message }, reconciliation: { processOwnerId: owner.id, writerStopped: true, parentExited: true, reconciledAt: now, previousError: task.reconciliation?.previousError ?? task.error } };
    // Commit terminal evidence before releasing admission. If interrupted before
    // unlink, retry validates the same witnesses and safely finishes this commit.
    atomicText(join(taskDirectory, 'task.json'), JSON.stringify(updated));
    atomicText(join(taskDirectory, 'result.txt'), '1');
    for (const item of [...witnesses, gate]) unchanged(item);
    rmSync(gatePath);
    return { reconciled: true, id, message };
  } finally { release(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await reconcileServiceInstall({ root: process.env.AXIOM_DATA_DIR, id: process.argv[2] }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
