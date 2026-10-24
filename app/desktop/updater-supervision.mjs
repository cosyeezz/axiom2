// Private desktop adapter for the release-owned bootstrap supervision runtime.
import { prepareLinuxHelper } from './desktop-native.mjs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, toNamespacedPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startService } from './service-start.mjs';
import { validBudgets } from './maintenance.mjs';

const uncertain = message => Object.assign(Error(message), { code: 'stop-unconfirmed' });
export const updaterOwnerPath = root => join(root, 'updates', 'process-owner.json');
export function updaterOwnerPresent(root) {
  try { lstatSync(updaterOwnerPath(root)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function updaterTaskSnapshot(root, task) {
  if (!task || !/^[a-f0-9-]{36}$/.test(task.id)) throw Error('更新任务身份无效。');
  const path = join(root, 'updates', 'tasks', task.id, 'task.json');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 524288) throw Error('更新监督记录无效。');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value?.id !== task.id || value.attemptId !== task.attemptId) throw Error('更新监督记录身份不匹配。');
  if (value.label !== task.label || value.resource !== task.resource || typeof value.phase !== 'string' || !Number.isFinite(value.createdAt) || !Array.isArray(value.steps) || value.steps.some(step => typeof step !== 'string') || !validBudgets(value.budgets) || !['running', 'cancelling', 'unknown', 'interrupted', 'succeeded', 'failed', 'cancelled'].includes(value.status) || typeof value.capabilities?.cancel !== 'boolean' || typeof value.capabilities?.extend !== 'boolean') throw Error('更新监督记录内容不完整。');
  return value;
}
export async function loadUpdaterRuntime(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const nativeRuntime = await mkdtemp(toNamespacedPath(join(directory, 'runtime-')));
  // Node mkdtemp needs the native prefix for deep paths. PowerShell providers
  // require a regular drive/UNC path when locating and dot-sourcing scripts.
  const runtime = process.platform !== 'win32' ? nativeRuntime : nativeRuntime.startsWith('\\\\?\\UNC\\') ? '\\\\' + nativeRuntime.slice(8) : nativeRuntime.startsWith('\\\\?\\') ? nativeRuntime.slice(4) : nativeRuntime;
  const files = JSON.parse(await readFile(new URL('./setup-runtime.json', import.meta.url), 'utf8'));
  for (const [name, content] of Object.entries(files)) {
    if (isAbsolute(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || typeof content !== 'string') throw Error('更新监督器资源路径无效。');
    const target = join(runtime, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  }
  const owned = await import(pathToFileURL(join(runtime, 'bootstrap/main.mjs')).href);
  return { runtime, owned };
}
export function createUpdaterSupervisor({ root, execution, token = execution.task.id, fetcher = fetch, log, gate = true, offline = false }) {
  const directory = join(root, 'updates', 'tasks', execution.task.id), taskPath = join(directory, 'task.json');
  let manifest;
  const recoveryRunners = new Set();
  const saveManifest = () => owned.atomicJSON(join(directory, "supervision.json"), manifest);
  let owned, runtime, owner, helperReady = false, commandUncertain = false, serviceUncertain = false, serviceRequestStopped = false, parentUncertain = false;
  const isUncertain = () => commandUncertain || serviceUncertain || parentUncertain;
  let prepared = false, parentDone;
  async function prepare() {
    try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    ({ runtime, owned } = await loadUpdaterRuntime(directory));
    if (offline && process.platform === 'linux') {
      await prepareLinuxHelper({ runtime, offline: true });
      helperReady = true;
    }
    if (gate) {
      try { owner = owned.createProcessOwner(updaterOwnerPath(root)); }
      catch (error) { if (error.code === 'EEXIST') throw uncertain('已有更新进程或父提交尚未确认，已保留归属记录，请先核实原任务。'); throw error; }
    }
    manifest = { format: 1, gateId: gate ? JSON.parse(await readFile(updaterOwnerPath(root), 'utf8')).id : null, token, taskId: execution.task.id, attemptId: execution.task.attemptId, root: await realpath(root), hostPid: process.pid, commands: [], services: [] };
    saveManifest(); publish(execution.task);
    if (gate && process.platform === 'win32') {
      const nonce = randomUUID();
      manifest.parentWitness = { nonce, ready: false }; saveManifest();
      const request = join(directory, 'parent-request.json');
      owned.atomicJSON(request, { nonce, parentPid: process.pid });
      let exited = false, spawnError;
      const watcher = spawn('powershell.exe', owned.windowsBootstrapArguments(join(runtime, 'bootstrap'), request, 'parent'), { windowsHide: true, stdio: 'ignore' });
      watcher.once('error', error => { spawnError = error; });
      parentDone = new Promise(resolve => { watcher.once('exit', resolve); watcher.once('error', resolve); });
      watcher.once('exit', () => { exited = true; }); watcher.unref();
      const until = Date.now() + 15000;
      try {
        for (;;) {
          execution.signal.throwIfAborted();
          if (spawnError || exited || Date.now() >= until) throw spawnError ?? Error('父进程退出凭据尚未就绪。');
          let ready;
          try { ready = JSON.parse(await readFile(join(directory, 'parent-ready.json'), 'utf8')); } catch { /* A newly created receipt may still be flushing. */ }
          if (ready?.nonce === nonce && ready.parentPid === process.pid) break;
          await delay(50);
        }
        manifest.parentWitness.ready = true; saveManifest();
      } catch (error) { parentUncertain = true; throw uncertain(error.message); }
    }
    prepared = true;
    } catch (error) {
      if (!parentUncertain && owner) { try { owner.confirmed(); } catch { parentUncertain = true; } }
      throw error;
    }
  }
  function publish(task) {
    if (isUncertain()) {
      task.status = 'unknown'; task.message = '更新进程清理或后台启动结果尚未确认，已保留安装目录与归属记录。';
      task.error = { code: 'stop-unconfirmed', phase: task.phase, message: task.message };
      task.capabilities = { cancel: false, extend: false };
    }
    if (owned) owned.atomicJSON(taskPath, task);
    return task;
  }
  async function command(file, args, options = {}) {
    execution.signal.throwIfAborted();
    if (!prepared) throw uncertain('更新监督器尚未就绪，未启动命令。');
    if (commandUncertain || parentUncertain || serviceUncertain && !(options.recovery && serviceRequestStopped)) throw uncertain('先前命令退出尚未确认，未启动新的更新命令。');
    if (!helperReady && process.platform === 'linux') {
      const previous = { phase: execution.task.phase, message: execution.task.message, capabilities: { ...execution.task.capabilities }, phaseStart: execution.phaseStart };
      await prepareLinuxHelper({ runtime, offline, download: () => owned.downloadLinuxHelper(execution, runtime, fetcher) });
      Object.assign(execution.task, { phase: previous.phase, message: previous.message, capabilities: previous.capabilities });
      execution.phaseStart = previous.phaseStart; delete execution.task.transfer; await execution.update();
    }
    helperReady = true;
    const started = Date.now();
    const commandDeadline = () => started + (options.getTimeout?.() ?? options.timeoutMs ?? Infinity);
    const commandTimeoutCode = () => options.timeoutCode && commandDeadline() <= execution.task.startedAt + execution.task.budgets.totalMs ? options.timeoutCode : 'total-timeout';
    // Apply the shorter command limit while retaining the task's live budgets.
    // The shared supervisor enforces this deadline even if this host freezes.
    const commandExecution = Object.create(execution);
    Object.defineProperty(commandExecution, 'task', { get() {
      const task = execution.task, limit = options.getTimeout?.() ?? options.timeoutMs ?? Infinity;
      return { ...task, budgets: { ...task.budgets, totalMs: Math.min(task.budgets.totalMs, started - task.startedAt + limit) } };
    } });
    commandExecution.abort = (code, message) => execution.abort(code === 'total-timeout' ? commandTimeoutCode() : code, message);
    if (options.recovery && !(args.length === 3 && isAbsolute(args[0]) && ['status', 'stop'].includes(args[1]) && args[2] === '--json' && recoveryRunners.has(JSON.stringify([await realpath(file), await realpath(args[0])])))) throw uncertain('恢复核实只允许已核实程序的服务状态与停止请求。');
    const commandId = randomUUID(), commandDir = join(directory, `command-${commandId}`);
    await mkdir(commandDir, { mode: 0o700 });
    const lease = owned.createProcessOwner(join(commandDir, 'owner.json')), ownership = { confirmed: true };
    const record = { id: commandId, ownerId: JSON.parse(await readFile(join(commandDir, 'owner.json'), 'utf8')).id, state: 'registered' };
    try { manifest.commands.push(record); saveManifest(); }
    catch (error) {
      parentUncertain = true;
      try { lease.confirmed(); record.state = 'cleaned'; } catch {}
      throw uncertain(error.message);
    }
    let mirrored = -1, mirroring;
    const mirrorLog = () => {
      if (!log || !options.log) return Promise.resolve();
      if (mirroring) return mirroring;
      mirroring = (async () => {
        try {
          const output = JSON.parse(await readFile(join(commandDir, 'output.json'), 'utf8'));
          if (output.received === mirrored) return;
          const tail = Buffer.from(output.tail, output.encoding === 'base64' ? 'base64' : 'utf8').subarray(-262144);
          await writeFile(log, tail, { mode: 0o600 }); mirrored = output.received;
        } catch { /* Optional diagnostics never interrupt the owned command. */ }
      })().finally(() => { mirroring = undefined; });
      return mirroring;
    };
    const logTimer = log && options.log ? setInterval(() => void mirrorLog(), 500) : undefined;
    try {
      const result = await owned.runOwnedCommand({ directory: commandDir, execution: commandExecution, owner: lease, ownership, taskPath, file, args, cwd: options.cwd ?? root, env: options.env, capture: !options.log });
      return result.output ?? '';
    } catch (error) {
      if (!ownership.confirmed || error.code === 'stop-unconfirmed') { commandUncertain = true; throw uncertain(error.message); }
      if (error.code === 'total-timeout') error.code = commandTimeoutCode();
      throw error;
    } finally {
      clearInterval(logTimer);
      await mirroring;
      await mirrorLog();
      if (ownership.confirmed && !commandUncertain) {
        record.state = 'cleaned';
        try { saveManifest(); lease.confirmed(); }
        catch (error) { parentUncertain = true; throw uncertain(error.message); }
      }
    }
  }
  async function start(file, args, options = {}) {
    execution.signal.throwIfAborted();
    if (!prepared) throw uncertain('更新监督器尚未就绪，未发起启动请求。');
    if (commandUncertain || parentUncertain || serviceUncertain && !serviceRequestStopped) throw uncertain('先前启动请求退出尚未确认，未发起新的启动。');
    if (!['linux', 'win32', 'darwin'].includes(process.platform) || args.length !== 3 || !isAbsolute(args[0]) || args[1] !== 'start' || args[2] !== '--json') throw uncertain('后台启动请求不支持可靠身份登记。');
    const request = { id: randomUUID(), protocol: 1, nonce: randomUUID(), state: 'prepared', requestStopped: false };
    const requestDirectory = join(directory, `service-${request.id}`);
    await mkdir(requestDirectory, { mode: 0o700 });
    const lease = owned.createProcessOwner(join(requestDirectory, 'owner.json'));
    request.ownerId = JSON.parse(await readFile(join(requestDirectory, 'owner.json'), 'utf8')).id;
    manifest.services.push(request); manifest.serviceResolved = false;
    try { saveManifest(); } catch (error) { parentUncertain = true; throw uncertain(error.message); }
    const controller = new AbortController(), started = Date.now();
    const signal = AbortSignal.any([execution.signal, controller.signal]);
    const timer = setInterval(() => {
      if (Date.now() - started >= (options.getTimeout?.() ?? options.timeoutMs ?? 60000)) controller.abort(uncertain('后台启动请求超时，请核实服务状态。'));
    }, 100);
    serviceUncertain = true; serviceRequestStopped = false;
    try {
      const result = await startService({ file, args, cwd: root, env: options.env, signal, barrier: {
        wrapper: join(runtime, 'bootstrap/service-request.mjs'), nonce: request.nonce,
        arm: async (pid, preparationSignal) => {
          preparationSignal.throwIfAborted();
          if (!Number.isSafeInteger(pid) || pid <= 1) throw uncertain('后台启动请求身份无效。');
          request.pid = pid;
          if (process.platform === 'darwin') {
            const row = owned.pidSnapshot().find(row => row.pid === pid);
            if (!row || row.zombie || row.parent !== process.pid || !row.started) throw uncertain('后台启动请求的 PID 身份尚未确认。');
            lease.arm({ platform: 'darwin', workerPid: pid, started: row.started, members: [{ pid, started: row.started }] });
          } else {
            lease.arm(process.platform === 'linux'
              ? { platform: 'linux', initPid: pid, startTime: owned.linuxProcessStart(pid) }
              : { platform: 'win32', workerPid: pid });
          }
          if (process.platform === 'win32') {
            const witnessPath = join(requestDirectory, 'parent-request.json');
            owned.atomicJSON(witnessPath, { nonce: request.nonce, parentPid: pid });
            let exited = false, spawnError;
            const watcher = spawn('powershell.exe', owned.windowsBootstrapArguments(join(runtime, 'bootstrap'), witnessPath, 'parent'), { windowsHide: true, stdio: 'ignore' });
            watcher.once('error', error => { spawnError = error; });
            watcher.once('exit', () => { exited = true; }); watcher.unref();
            const until = Date.now() + 15000;
            for (;;) {
              preparationSignal.throwIfAborted();
              if (spawnError || exited || Date.now() >= until) throw spawnError ?? uncertain('后台请求退出凭据尚未就绪。');
              let ready;
              try { ready = JSON.parse(await readFile(join(requestDirectory, 'parent-ready.json'), 'utf8')); } catch {}
              if (ready?.nonce === request.nonce && ready.parentPid === pid) break;
              await delay(50);
            }
          }
          preparationSignal.throwIfAborted();
          request.state = 'armed'; saveManifest();
          // startService sends GO only after this durable identity returns.
        },
      } });
      request.state = 'closed'; request.requestStopped = true; saveManifest(); lease.confirmed();
      serviceUncertain = false; serviceRequestStopped = true; return result;
    } catch (error) {
      serviceRequestStopped = error.requestStopped === true;
      if (serviceRequestStopped) { request.state = 'closed'; request.requestStopped = true; try { saveManifest(); lease.confirmed(); } catch { parentUncertain = true; } }
      throw uncertain(error.message);
    }
    finally { clearInterval(timer); }
  }
  return { prepare, publish, command, start, uncertain: isUncertain,
    retain: () => { parentUncertain = true; },
    identity: () => ({ gateId: manifest.gateId, attemptId: manifest.attemptId, root: manifest.root }),
    bindPiLock: value => { manifest.piLock = value; saveManifest(); },
    allowRecovery: async (file, cli) => { recoveryRunners.add(JSON.stringify([await realpath(file), await realpath(cli)])); },
    confirmService: () => {
      manifest.serviceResolved = true;
      try { saveManifest(); serviceUncertain = false; }
      catch (error) { parentUncertain = true; throw uncertain(error.message); }
    },
    release: async () => {
      if (isUncertain()) return;
      owner?.confirmed();
      // Wait for the observer to close its handles before callers can remove
      // this task directory. A failed stop remains harmless until host exit.
      if (manifest?.parentWitness) try {
        owned.atomicJSON(join(directory, 'parent-stop.json'), { nonce: manifest.parentWitness.nonce });
        if (parentDone) await new Promise(resolve => {
          const timer = setTimeout(resolve, 3000);
          parentDone.then(() => { clearTimeout(timer); resolve(); });
        });
      } catch {}
    },
  };
}
