// First-install coordinator. Its generated payload uses Node built-ins only.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopExecution, desktopTask, validBudgets } from '../app/desktop/maintenance.mjs';
import { createProcessOwner, canRecoverProcessOwner, recoverProcessOwner } from '../app/dist/server/process-owner-record.mjs';
import { forkLinuxOwned, monotonicMilliseconds } from '../app/dist/server/owned-process-linux.mjs';
import { bootstrapHistory, validateTask } from './records.mjs';
import { bootstrapCurrent, createBootstrapRegistry } from './registry.mjs';

const repository = 'https://github.com/cosyeezz/axiom2';
const packageURL = `${repository}/releases/latest/download/axiom2.tgz`;
const entry = fileURLToPath(import.meta.url);
const failure = (code, message) => Object.assign(Error(message), { code });
const renameRetryWait = new Int32Array(new SharedArrayBuffer(4));
export function atomicJSON(path, value) {
  const staged = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    // Windows can transiently reject replacement while another process reads
    // the old generation. Keep the same flushed temp file and retry briefly;
    // permanent permission errors still fail, and no target is removed first.
    const renameUntil = performance.now() + 250;
    for (;;) {
      try { renameSync(staged, path); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || performance.now() >= renameUntil) throw error;
        Atomics.wait(renameRetryWait, 0, 0, 2);
      }
    }
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally { rmSync(staged, { force: true }); }
}
function json(path, optional = false) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 524288) throw Error('维护记录类型或大小无效。');
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
function diagnosticTail(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) return '';
    const bytes = Buffer.alloc(Math.min(stat.size, 16384));
    const length = readSync(fd, bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
    return bytes.subarray(0, length).toString('utf8');
  } catch { return ''; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function managedDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('维护目录不能是链接。');
}
const expiration = execution => Math.min(execution.task.startedAt + execution.task.budgets.totalMs,
  execution.task.phase === 'installing' ? execution.phaseStart + execution.task.budgets.installMs : Infinity);
const remaining = execution => expiration(execution) - Date.now();
const deadlineError = execution => failure(execution.task.phase === 'installing' && execution.phaseStart + execution.task.budgets.installMs <= execution.task.startedAt + execution.task.budgets.totalMs ? 'install-timeout' : 'total-timeout', '安装达到执行期限，正在确认进程树退出。');

export { createProcessOwner, canRecoverProcessOwner, recoverProcessOwner };
export { linuxProcessStart } from '../app/dist/server/process-owner-linux-identity.mjs';

// The global installer retains npm's normal cwd, prefix and lifecycle behavior.
// Desktop installation supplies an explicit executable and fixed argument array.
async function worker(requestPath) {
  const request = json(requestPath), directory = dirname(requestPath);
  let total = 0, tail = Buffer.alloc(0), lastWrite = 0, logError;
  const publish = () => {
    if (!logError) {
      try { atomicJSON(join(directory, 'output.json'), { nonce: request.nonce, received: total, tail: tail.toString('base64'), encoding: 'base64' }); }
      catch (error) { logError = `安装日志尾部无法保存：${error.message}`; }
    }
    // Logging is optional, and must not stop npm or accumulate failed temp files.
    lastWrite = Date.now();
  };
  async function npm(args, capture = false, executable) {
    return new Promise((resolveCommand, reject) => {
      const windows = process.platform === 'win32' && !executable;
      // Only the fixed global npm commands use cmd; explicit commands never do.
      const child = spawn(executable || (windows ? (process.env.ComSpec || 'cmd.exe') : 'npm'), windows ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] : args, {
        cwd: request.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_fetch_timeout: '86400000' },
      });
      let capturedBytes = 0, captured = [], stopped;
      const output = (bytes, stdout) => {
        total += bytes.length; tail = Buffer.concat([tail, bytes]).subarray(-262144);
        if (capture && stdout && !stopped) {
          capturedBytes += bytes.length;
          if (capturedBytes > 65536) { stopped = failure('output-limit', 'npm 返回的目录信息超过 64 KiB。'); reject(stopped); }
          else captured.push(bytes);
        }
        // Console output is drained and truncated, never used to kill npm.
        if (Date.now() - lastWrite > 250) publish();
      };
      child.stdout.on('data', bytes => output(bytes, true)); child.stderr.on('data', bytes => output(bytes, false));
      child.once('error', reject);
      child.once('close', code => code === 0 && !stopped ? resolveCommand(Buffer.concat(captured).toString('utf8').trim()) : reject(stopped || Error(`npm 退出 ${code}。\n${tail.toString('utf8').slice(-4096)}`)));
    });
  }
  try {
    if (request.command) {
      validateCommand(request.command);
      const output = await npm(request.command.args, request.command.capture, request.command.file);
      publish(); atomicJSON(join(directory, 'result.json'), { nonce: request.nonce, ok: true, output, logError });
      process.exit(0);
    }
    await npm(['install', '--global', packageURL]);
    const prefix = await npm(['prefix', '--global'], true), globalRoot = await npm(['root', '--global'], true);
    if (!isAbsolute(prefix) || !isAbsolute(globalRoot) || /[\r\n]/.test(prefix + globalRoot)) throw Error('npm 全局目录无效。');
    const installed = json(join(globalRoot, '@cosyeezz', 'axiom2', 'package.json'));
    if (installed.name !== '@cosyeezz/axiom2' || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(installed.version)) throw Error('安装后的包身份或版本无效。');
    publish(); atomicJSON(join(directory, 'result.json'), { nonce: request.nonce, ok: true, prefix, version: installed.version, logError });
    process.exit(0);
  } catch (error) {
    publish(); atomicJSON(join(directory, 'result.json'), { nonce: request.nonce, ok: false, error: { code: error.code || 'operation', message: error.message } });
    process.exit(1);
  }
}

// PowerShell 5.1's -File and dot-source providers reject deep paths even when
// CreateFileW can read them. Load the release scripts through that native reader
// in an encoded entry command; keep all files inside the owned task directory.
export function windowsBootstrapArguments(directory, request, kind = 'owner') {
  if (!isAbsolute(directory) || !isAbsolute(request) || !['owner', 'parent'].includes(kind)) throw Error('安装监督器入口无效。');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const prelude = `$ErrorActionPreference = 'Stop'\n$BootstrapDirectory = ${quote(directory)}\n${readFileSync(join(directory, 'windows-files.ps1'), 'utf8').replace(/^\uFEFF/, '')}\nfunction Invoke-AxiomBootstrap([string]$Path, [hashtable]$Parameters) {\n  $stream = [AxiomBootstrapFiles]::Read($Path)\n  $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)\n  try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }\n  . ([ScriptBlock]::Create($text)) @Parameters\n}\n`;
  const script = `$BootstrapPrelude = ${quote(prelude)}\n. ([ScriptBlock]::Create($BootstrapPrelude))\nInvoke-AxiomBootstrap ${quote(join(directory, 'windows-launcher.ps1'))} @{ Request = ${quote(request)}; Kind = ${quote(kind)} }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  if (encoded.length > 30000) throw Error('安装监督器路径超过命令入口限制。');
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
}
export async function downloadLinuxHelper(execution, runtime, fetcher = fetch) {
  if (!['x64', 'arm64'].includes(process.arch)) throw Error('此 Linux 架构没有受支持的安装监督器。');
  async function get(url, maximum) {
    const response = await execution.fetch(url, fetcher);
    if (!response.ok) { await response.body?.cancel(); throw failure('http', `下载失败：HTTP ${response.status}`); }
    const chunks = []; let length = 0;
    try {
      for await (const chunk of response.body) {
        length += chunk.length; if (length > maximum) throw Error('下载内容超过声明的大小限制。'); chunks.push(chunk);
      }
    } finally { if (!response.body.locked) await response.body.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
  }
  await execution.phase('checking', '正在检查安装监督器的正式发布版本…');
  const release = JSON.parse(await get('https://api.github.com/repos/cosyeezz/axiom2/releases/latest', 2000000));
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw Error('正式发布信息无效。');
  const name = `axiom-owner-linux-${process.arch}`, assets = release.assets?.filter(asset => asset.name === name);
  if (assets?.length !== 1) throw Error('该发布缺少当前架构的安装监督器，尚未运行 npm。');
  const asset = assets[0], url = `${repository}/releases/download/${release.tag_name}/${name}`;
  if (asset.state !== 'uploaded' || asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.size) || asset.size < 64 || asset.size > 8 * 1024 * 1024) throw Error('安装监督器的地址、大小或校验信息无效。');
  await execution.phase('downloading', '正在下载安装监督器…');
  const bytes = await get(url, asset.size);
  await execution.phase('verifying', '正在校验安装监督器…');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== asset.size || asset.digest !== `sha256:${digest}` || bytes.subarray(0, 6).toString('hex') !== '7f454c460201' || bytes.readUInt16LE(18) !== (process.arch === 'x64' ? 62 : 183)) throw Error('安装监督器校验失败，尚未运行 npm。');
  const directory = join(runtime, 'bin', 'native', `linux-${process.arch}`); managedDirectory(directory);
  writeFileSync(join(directory, 'axiom-owner'), bytes, { flag: 'wx', mode: 0o755 });
  atomicJSON(join(directory, 'manifest.json'), { protocol: 1, arch: process.arch, sha256: digest });
}

function validateCommand(command) {
  if (!command || typeof command.file !== 'string' || !isAbsolute(command.file) || command.file.includes('\0') || !Array.isArray(command.args) || command.args.some(value => typeof value !== 'string' || value.includes('\0')) || typeof command.capture !== 'boolean') throw Error('安装命令参数无效。');
}

// The caller owns the existing task and journal. Keep the journal until its
// parent commit and terminal task have both been persisted, even after cleanup.
export async function runOwnedCommand({ directory, execution, owner, ownership, taskPath, file, args, cwd = process.cwd(), env = {}, capture = false }) {
  if (!['win32', 'linux'].includes(process.platform)) throw Error('此平台尚无可靠的安装进程监督器。');
  const command = { file, args, capture };
  validateCommand(command);
  if (!isAbsolute(cwd)) throw Error('安装命令工作目录必须为绝对路径。');
  if (taskPath !== undefined) {
    if (typeof taskPath !== 'string' || !isAbsolute(taskPath) || taskPath.includes('\0')) throw Error('维护记录路径必须为绝对路径。');
    // Windows root-relative paths depend on the current drive. Resolve once
    // here so validation and the supervisor always refer to the same file.
    taskPath = resolve(taskPath);
    const recorded = json(taskPath);
    if (recorded.id !== execution.task.id || recorded.attemptId !== execution.task.attemptId) throw Error('维护记录与本次安装身份不匹配。');
  }
  managedDirectory(directory);
  return supervise(directory, execution, owner, ownership, { ...command, cwd, env, taskPath });
}

async function supervise(directory, execution, owner, ownership, command) {
  const nonce = randomUUID(), requestPath = join(directory, 'request.json');
  const cwd = command?.cwd || process.cwd(), env = { ...process.env, ...command?.env };
  atomicJSON(requestPath, { node: process.execPath, entry, parentPid: process.pid, taskId: execution.task.id, attemptId: execution.task.attemptId, taskPath: command?.taskPath ?? resolve(directory, 'task.json'), cwd, nonce, deadline: expiration(execution), command: command ? { file: command.file, args: command.args, capture: command.capture } : undefined });
  let child, native, closed = false, spawnError, receipt, sent = false, uncertain, launcherFailed = false;
  let lastControl, revoked = false;
  const writeControl = value => {
    if (value.stop) revoked = true;
    else if (revoked) return;
    const bytes = JSON.stringify(value);
    if (bytes === lastControl) return;
    atomicJSON(join(directory, 'owner-control.json'), value); lastControl = bytes;
  };
  const stop = () => {
    try {
      if (native) void native.close().catch(error => { uncertain ||= error; });
      else if (child) writeControl({ nonce, stop: true });
    } catch (error) { uncertain ||= error; }
  };
  try {
    execution.signal.throwIfAborted();
    ownership.confirmed = false;
    if (process.platform === 'win32') {
      child = spawn('powershell.exe', windowsBootstrapArguments(dirname(entry), requestPath), { cwd, env, windowsHide: true, detached: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let diagnostic = '';
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-16384); });
      child.on('error', error => { spawnError = error; });
      // A surviving supervisor can retain inherited pipe handles. Process exit
      // must stop admission immediately, without waiting for stream EOF/close.
      child.once('exit', (code, signal) => {
        closed = true;
        if (code !== 0 || signal) {
          launcherFailed = true;
          uncertain = failure('stop-unconfirmed', '安装监督器的等待进程意外退出，已请求停止安装并保留归属记录。');
          stop();
        }
      });
      child.once('close', () => { closed = true; });
      while (!closed && !spawnError) {
        execution.signal.throwIfAborted();
        const ready = json(join(directory, 'ready.json'), true);
        if (ready) {
          if (ready.nonce !== nonce || !Number.isSafeInteger(ready.pid) || ready.pid < 1) throw Error('安装监督器就绪回执无效。');
          owner.arm({ platform: 'win32', workerPid: ready.pid });
          execution.signal.throwIfAborted();
          writeControl({ nonce, go: true, deadline: expiration(execution) }); sent = true; break;
        }
        await delay(50);
      }
      if (!sent) throw spawnError || Error(`安装监督器未就绪。${diagnostic}${diagnosticTail(`${requestPath}.stderr`)}`);
    } else {
      native = forkLinuxOwned(entry, { cwd, env: { ...env, AXIOM_BOOTSTRAP_REQUEST: requestPath }, execArgv: [] }, monotonicMilliseconds() + remaining(execution), () => deadlineError(execution), identity => { execution.signal.throwIfAborted(); owner.arm(identity); execution.signal.throwIfAborted(); });
      child = native.child; child.on('close', () => { closed = true; });
      execution.signal.addEventListener('abort', stop, { once: true });
      if (execution.signal.aborted) stop();
      await native.ready; sent = true;
    }
    execution.signal.addEventListener('abort', stop, { once: true });
    let displayed = 0;
    while (!closed) {
      if (execution.signal.aborted) { stop(); break; }
      const left = remaining(execution);
      if (left <= 0) { const error = deadlineError(execution); execution.abort(error.code, error.message); stop(); break; }
      if (native) native.setDeadline(monotonicMilliseconds() + left);
      else writeControl({ nonce, go: true, deadline: expiration(execution) });
      // Ordinary diagnostics are optional. A corrupt, inaccessible or missing
      // tail must not stop the command; result and cleanup receipts stay strict.
      try {
        const output = json(join(directory, 'output.json'), true);
        if (output?.nonce === nonce && output.received > displayed) {
          const bytes = Buffer.from(output.tail, output.encoding === 'base64' ? 'base64' : 'utf8'), count = Math.min(bytes.length, output.received - displayed);
          if (process.stderr.writableLength < 262144) {
            if (output.received - displayed > bytes.length) process.stderr.write('\n[较早的安装输出已截去，维护目录保留最新日志尾部]\n');
            process.stderr.write(bytes.subarray(bytes.length - count)); displayed = output.received;
          }
        }
      } catch { /* Continue draining in the worker even when logs cannot be read. */ }
      await delay(250);
    }
  } catch (error) { uncertain = error; stop(); }
  finally {
    execution.signal.removeEventListener('abort', stop);
    if (native) {
      try { await native.close(); } catch (error) { throw failure('stop-unconfirmed', error.message); }
      if (native.failure()?.code === 'stop-unconfirmed') throw native.failure();
      ownership.confirmed = true;
      uncertain ||= native.failure();
    } else if (child) {
      try {
        if (!closed) stop();
        const end = Date.now() + 8000;
        do {
          try { receipt = json(join(directory, 'cleaned.json'), true); }
          catch { throw failure('stop-unconfirmed', '安装清理回执无法核验，归属记录已保留。'); }
          if (receipt || spawnError) break;
          await delay(50);
        } while (Date.now() < end);
        if (launcherFailed) throw uncertain;
        if (receipt?.nonce === nonce && receipt.reason === 'deadline') uncertain ||= deadlineError(execution);
        if (receipt?.nonce === nonce || spawnError) ownership.confirmed = true;
        else throw failure('stop-unconfirmed', '尚未确认安装进程树退出，归属记录已保留。');
      } finally { child.stderr?.destroy(); child.unref(); }
    }
  }
  if (uncertain) throw uncertain;
  execution.signal.throwIfAborted();
  const result = json(join(directory, 'result.json'), true);
  if (!result || result.nonce !== nonce) throw Error('安装进程已退出，但没有可验证的安装结果。');
  if (!result.ok) throw failure(result.error?.code || 'operation', result.error?.message || '安装失败。');
  return result;
}

async function prepareParentWitness(directory, manifest, save, execution) {
  if (process.platform !== 'win32') return;
  const nonce = manifest.parentWitness.nonce, request = join(directory, 'parent-request.json');
  atomicJSON(request, { nonce, parentPid: process.pid });
  let exited = false, spawnError;
  const watcher = spawn('powershell.exe', windowsBootstrapArguments(dirname(entry), request, 'parent'), { windowsHide: true, stdio: 'ignore' });
  watcher.once('error', error => { spawnError = error; });
  watcher.once('exit', () => { exited = true; }); watcher.unref();
  const until = Date.now() + 15000;
  try {
    for (;;) {
      execution.signal.throwIfAborted();
      if (spawnError || exited || Date.now() >= until) throw spawnError ?? Error('首次安装父进程退出凭据尚未就绪。');
      let ready;
      try { ready = json(join(directory, 'parent-ready.json'), true); } catch { /* Observer may still be flushing. */ }
      if (ready?.nonce === nonce && ready.parentPid === process.pid) break;
      await delay(50);
    }
    manifest.parentWitness.ready = true; save();
  } catch (error) { throw failure('stop-unconfirmed', error.message); }
}
const defaultRoot = () => resolve(process.env.AXIOM_DATA_DIR || join(homedir(), '.axiom2'));
export function history(root = defaultRoot()) {
  root = resolve(root);
  const result = bootstrapHistory(root);
  try {
    const current = bootstrapCurrent(root);
    if (current?.state === 'release-pending') {
      const task = validateTask(current.task);
      const projected = { ...task, status: 'unknown', capabilities: { cancel: false, extend: false }, message: '首次安装收尾尚未提交，请再次核实原任务。' };
      const index = result.tasks.findIndex(value => value.id === task.id);
      if (index === -1) result.tasks.unshift(projected); else result.tasks[index] = projected;
    }
  } catch (error) { result.errors.push({ path: join(root, 'bootstrap/jobs.sqlite'), message: error.message }); result.partial = true; }
  return result;
}
export function reconcile(id, attemptId, root = defaultRoot()) {
  return createBootstrapRegistry(resolve(root), atomicJSON).reconcile(id, attemptId);
}
export async function install({ root = defaultRoot(), runtime = resolve(dirname(entry), '..'), fetcher = fetch } = {}) {
  if (!['win32', 'linux'].includes(process.platform)) throw Error('此平台尚无可靠的首次安装进程监督器。');
  managedDirectory(root); root = realpathSync(root);
  const store = join(root, 'bootstrap'); managedDirectory(store);
  const registry = createBootstrapRegistry(root, atomicJSON);
  const saved = json(join(store, 'budgets.json'), true);
  if (saved && !validBudgets(saved)) throw Error('首次安装预算无效。');
  const task = desktopTask('bootstrap-global', 'install', saved || undefined);
  task.label = 'Axiom2 全局 npm 安装'; task.scope = '当前终端 · npm 全局目录';
  const directory = join(store, task.id); managedDirectory(directory);
  let owner, manifest, error, result;
  const ownership = { confirmed: true };
  const controls = join(directory, 'controls'); managedDirectory(controls);
  const consumed = new Set(), requested = { id: task.id, attemptId: task.attemptId, budgets: { ...task.budgets } };
  const mergeControl = value => {
    if (!value) return;
    if (value.id !== task.id || value.attemptId !== task.attemptId) throw Error('维护控制身份不匹配。');
    if (value.cancel === true) requested.cancel = true;
    if (value.budgets) {
      if (!validBudgets(value.budgets)) throw Error('首次安装控制预算无效。');
      for (const key of Object.keys(requested.budgets)) requested.budgets[key] = Math.max(requested.budgets[key], value.budgets[key]);
    }
  };
  const execution = new DesktopExecution(task, value => {
    if (error?.code === 'stop-unconfirmed') { value.status = 'unknown'; value.error = { code: error.code, message: error.message, phase: value.phase }; }
    atomicJSON(join(directory, 'task.json'), value);
  }, () => {
    mergeControl(json(join(directory, 'control.json'), true));
    for (const name of readdirSync(controls)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name) || consumed.has(name)) continue;
      mergeControl(json(join(controls, name))); consumed.add(name);
    }
    return requested;
  });
  const cancel = () => execution.abort('cancelled', '已请求取消，正在确认安装进程树退出。');
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  try {
    await execution.phase('checking', '正在检查首次安装占用状态…');
    console.error(`维护记录：${join(directory, 'task.json')}\n历史：node "${entry}" history\n核实：node "${entry}" reconcile ${task.id} ${task.attemptId}\n取消：node "${entry}" cancel "${directory}"\n延长：node "${entry}" extend "${directory}" totalMs=1800000 installMs=900000`);
    ({ owner, manifest } = registry.claim(task, createProcessOwner));
    await prepareParentWitness(directory, manifest, () => registry.saveManifest(task, manifest), execution);
    if (process.platform === 'linux') await downloadLinuxHelper(execution, runtime, fetcher);
    await execution.phase('installing', '正在执行 npm 全局安装；依赖下载与安装由 npm 管理，等待真实输出…');
    manifest.commandState = 'registered'; registry.saveManifest(task, manifest);
    try { result = await supervise(directory, execution, owner, ownership); }
    finally {
      if (ownership.confirmed) { manifest.commandState = 'cleaned'; registry.saveManifest(task, manifest); }
    }
    await execution.phase('validating', `已核对安装版本 ${result.version}，安装进程树已退出。${result.logError ? ` ${result.logError}` : ''}`);
    // The outer shell starts only after this process exits successfully. Save
    // handoff before releasing admission, so recovery covers this final write.
    atomicJSON(join(runtime, 'handoff.json'), { prefix: result.prefix, version: result.version });
  } catch (cause) { error = cause; }
  finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    if (owner && !ownership.confirmed) error = failure('stop-unconfirmed', `尚未确认安装进程树退出，归属记录已保留。${error ? ` ${error.message}` : ''}`);
    await execution.finish(error);
    if (error?.code === 'stop-unconfirmed') {
      task.status = 'unknown'; task.error = { code: error.code, message: error.message, phase: task.phase }; await execution.update();
    } else if (owner && ownership.confirmed) {
      try {
        registry.finish(task);
        if (manifest.parentWitness) {
          try { atomicJSON(join(directory, 'parent-stop.json'), { nonce: manifest.parentWitness.nonce }); } catch { /* Idle observer exits with the original parent. */ }
        }
      } catch (cause) {
        error = failure('stop-unconfirmed', `首次安装收尾尚未提交，已保留核实入口。${cause.message}`);
        task.status = 'unknown'; task.capabilities = { cancel: false, extend: false };
        task.error = { code: error.code, message: error.message, phase: task.phase }; await execution.update();
      }
    }
  }
  if (error) throw error;
  return result;
}

export function control(action, directory, changes = []) {
  const task = json(join(directory, 'task.json'));
  if (action === 'status') { console.log(JSON.stringify(task, null, 2)); return; }
  if (!['running', 'cancelling'].includes(task.status)) throw Error('该维护任务已经结束。');
  const value = { id: task.id, attemptId: task.attemptId };
  if (action === 'cancel') value.cancel = true;
  else if (action === 'extend') {
    const budgets = { ...task.budgets };
    for (const change of changes) {
      const match = /^(headersMs|idleMs|installMs|totalMs)=(\d+)$/.exec(change);
      if (!match) throw Error('预算格式应为 totalMs=1800000 等整数毫秒。');
      budgets[match[1]] = Math.max(budgets[match[1]], Number(match[2]));
    }
    if (!validBudgets(budgets)) throw Error('预算必须是 1 秒至 24 小时的整数毫秒。'); value.budgets = budgets;
  } else throw Error('未知维护命令。');
  const controls = join(directory, 'controls'); managedDirectory(controls);
  atomicJSON(join(controls, `${randomUUID()}.json`), value);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--worker' || process.env.AXIOM_BOOTSTRAP_REQUEST) await worker(process.env.AXIOM_BOOTSTRAP_REQUEST || process.argv[3]);
    else if (process.argv[2] === 'install') await install();
    else if (process.argv[2] === 'history') console.log(JSON.stringify(history(), null, 2));
    else if (process.argv[2] === 'reconcile') console.log(JSON.stringify(reconcile(process.argv[3], process.argv[4]), null, 2));
    else control(process.argv[2], resolve(process.argv[3]), process.argv.slice(4));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
