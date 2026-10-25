// Best-effort evidence from the package check's own temporary data only.
// Never print free text, requests, arguments, output, environment or journals.
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const choice = (value, values) => values.includes(value) ? value : undefined;
const phases = ['queued', 'checking', 'downloading', 'verifying', 'installing', 'validating', 'removing', 'complete', 'ready', 'error', 'interrupted'];
const statuses = ['running', 'cancelling', 'unknown', 'interrupted', 'succeeded', 'failed', 'cancelled'];
const codes = ['stop-unconfirmed', 'operation', 'cancelled', 'total-timeout', 'install-timeout', 'headers-timeout', 'idle-timeout', 'network', 'http', 'ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'EEXIST', 'ENOSPC', 'EIO'];
const MAX_FILE = 524288, MAX_OUTPUT = 32768;
// Command failures can embed arbitrary child output in error.message. Classify
// recognizable signatures, but never return any part of the original text.
export function diagnosticSignals(value) {
  if (typeof value !== 'string') return undefined;
  const tail = value.slice(-8192);
  return Object.entries({
    timeout: /timeout|timed out|超时|时限|期限/i,
    accessDenied: /access.?denied|unauthorizedaccess|permission.?denied|拒绝访问/i,
    pathMissing: /ENOENT|cannot find|could not find|找不到|不存在/i,
    powershellParser: /ParserError|ParseException|UnexpectedToken/i,
    powershellCompiler: /Add-Type|CompilerError|CS\d{4}/i,
    processHandle: /OpenProcess|WaitForSingleObject|进程句柄/i,
    jobObject: /JobObject|AssignProcessToJob|TerminateJob/i,
    parentWitness: /父进程退出凭据|后台请求退出凭据/i,
    supervisorNotReady: /安装监督器未就绪|更新监督器尚未就绪/i,
    cleanupUnconfirmed: /退出尚未确认|清理.*尚未确认|归属记录/i,
  }).filter(([, pattern]) => pattern.test(tail)).map(([name]) => name);
}
const errorSummary = error => error && typeof error === 'object' ? { code: choice(error.code, codes), signals: diagnosticSignals(error.message) } : undefined;
const taskSummary = task => task && typeof task === 'object' ? {
  status: choice(task.status, statuses), phase: choice(task.phase, phases), error: errorSummary(task.error),
  capabilities: task.capabilities ? { cancel: task.capabilities.cancel === true, extend: task.capabilities.extend === true } : undefined,
} : undefined;
const jobSummary = job => job && typeof job === 'object' ? { phase: choice(job.phase, phases), running: job.running === true, task: taskSummary(job.task) } : undefined;
const sameFile = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino && b?.isFile() && b.nlink === 1;

export async function packageFailureEvidence({ root, job, strategy }) {
  const canonicalRoot = await realpath(root), directory = join(canonicalRoot, 'updates');
  const evidence = { strategy: choice(strategy, ['hoisted', 'nested', 'recover']), projected: jobSummary(job), commands: [], services: [] };
  const directoryStat = await lstat(directory), boundary = await realpath(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || relative(directory, boundary) !== '') return { ...evidence, state: 'unsafe-root' };
  async function inspect(path, limit = MAX_FILE) {
    try {
      const stat = await lstat(path), inside = relative(boundary, await realpath(path));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) return { state: 'unsafe' };
      return stat.size > limit ? { state: 'oversized' } : { state: 'ok', stat };
    } catch (error) { return { state: error.code === 'ENOENT' ? 'absent' : 'unreadable' }; }
  }
  async function file(path, text = false) {
    let handle;
    try {
      const entry = await inspect(path);
      if (entry.state !== 'ok') return { state: entry.state };
      handle = await open(path, 'r');
      const identity = await handle.stat();
      if (!sameFile(entry.stat, identity) || identity.size !== entry.stat.size) return { state: 'changed' };
      const bytes = Buffer.alloc(text ? Math.min(identity.size, 8192) : identity.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, text ? Math.max(0, identity.size - bytes.length) : 0);
      const content = bytes.subarray(0, bytesRead).toString('utf8');
      if (text) return { state: 'ok', signals: diagnosticSignals(content) };
      try { return { state: 'ok', value: JSON.parse(content) }; }
      catch { return { state: 'invalid' }; }
    } catch (error) { return { state: error.code === 'ENOENT' ? 'absent' : 'unreadable' }; }
    finally { await handle?.close().catch(() => {}); }
  }
  const receipt = (entry, nonce) => ({ state: entry.state, ...(entry.state === 'ok' ? {
    nonceMatches: typeof nonce === 'string' && entry.value?.nonce === nonce,
    ok: typeof entry.value?.ok === 'boolean' ? entry.value.ok : undefined,
    writerStopped: typeof entry.value?.writerStopped === 'boolean' ? entry.value.writerStopped : undefined,
    parentExited: typeof entry.value?.parentExited === 'boolean' ? entry.value.parentExited : undefined,
    exited: typeof entry.value?.exited === 'boolean' ? entry.value.exited : undefined,
    reason: choice(entry.value?.reason, ['exited', 'parent-gone', 'deadline', 'stopped']),
    code: Number.isSafeInteger(entry.value?.code) ? entry.value.code : choice(entry.value?.code, codes),
    error: errorSummary(entry.value?.error),
  } : {}) });
  async function parent(path) {
    const request = await file(join(path, 'parent-request.json')), nonce = request.value?.nonce;
    const result = { request: { state: request.state } };
    for (const name of ['ready', 'exited', 'stop']) {
      const entry = await file(join(path, `parent-${name}.json`));
      result[name] = { ...receipt(entry, nonce), ...(name !== 'stop' ? { pidMatches: entry.state === 'ok' && Number.isSafeInteger(request.value?.parentPid) && entry.value?.parentPid === request.value.parentPid } : {}) };
    }
    return result;
  }
  let db;
  try {
    // SQLite is read-only, with sidecars checked as well. Accept only the
    // bounded current job row; never select database tokens or history.
    const paths = ['jobs.sqlite', 'jobs.sqlite-wal', 'jobs.sqlite-shm'].map(name => join(directory, name));
    const before = await Promise.all(paths.map(path => inspect(path, 16777216)));
    if (before[0].state !== 'ok' || before.slice(1).some(entry => !['ok', 'absent'].includes(entry.state))) throw Error('Unsafe database');
    db = new DatabaseSync(paths[0], { readOnly: true });
    const row = db.prepare('SELECT body FROM job WHERE id=1 AND length(body)<=524288').get();
    db.close(); db = undefined;
    const after = await Promise.all(paths.map(path => inspect(path, 16777216)));
    if (after.some((entry, index) => entry.state !== before[index].state || entry.state === 'ok' && !sameFile(before[index].stat, entry.stat))) throw Error('Database identity changed');
    evidence.stored = { state: row ? 'ok' : 'absent', job: row ? jobSummary(JSON.parse(row.body)) : undefined };
  } catch { evidence.stored = { state: 'unavailable' }; }
  finally { try { db?.close(); } catch {} }
  if (!uuid(job?.task?.id)) return { ...evidence, task: { state: 'invalid-id' } };
  const taskDirectory = join(directory, 'tasks', job.task.id);
  const task = await file(join(taskDirectory, 'task.json'));
  evidence.task = { state: task.state, identityMatches: task.state === 'ok' && task.value?.id === job.task.id && task.value?.attemptId === job.task.attemptId, value: taskSummary(task.value) };
  const supervision = await file(join(taskDirectory, 'supervision.json')), manifest = supervision.value;
  evidence.supervision = { state: supervision.state, identityMatches: supervision.state === 'ok' && manifest?.taskId === job.task.id && manifest?.attemptId === job.task.attemptId, parentReady: manifest?.parentWitness?.ready === true, serviceResolved: manifest?.serviceResolved === true };
  const owner = await file(join(directory, 'process-owner.json'));
  evidence.owner = { state: owner.state, gateMatches: owner.state === 'ok' && typeof manifest?.gateId === 'string' && owner.value?.id === manifest.gateId };
  evidence.parent = await parent(taskDirectory);
  const commands = Array.isArray(manifest?.commands) ? manifest.commands : [], services = Array.isArray(manifest?.services) ? manifest.services : [];
  evidence.commandCount = commands.length; evidence.serviceCount = services.length;
  if (commands.length > 12 || services.length > 6) evidence.truncated = true;
  // Retain the most recent work, where the failure is most likely to be.
  for (const record of commands.slice(-12)) {
    if (!uuid(record?.id)) { evidence.commands.push({ state: 'invalid-id' }); continue; }
    const path = join(taskDirectory, `command-${record.id}`), request = await file(join(path, 'request.json')), nonce = request.value?.nonce;
    const entry = { state: choice(record.state, ['registered', 'cleaned']), request: { state: request.state } };
    for (const name of ['ready', 'cleaned', 'result']) entry[name] = receipt(await file(join(path, `${name}.json`)), nonce);
    entry.stderr = await file(join(path, 'request.json.stderr'), true);
    evidence.commands.push(entry);
  }
  for (const record of services.slice(-6)) {
    if (!uuid(record?.id)) { evidence.services.push({ state: 'invalid-id' }); continue; }
    evidence.services.push({ state: choice(record.state, ['prepared', 'armed', 'closed']), requestStopped: record.requestStopped === true, parent: await parent(join(taskDirectory, `service-${record.id}`)) });
  }
  // Keep valid JSON, retaining the newest rather than oldest entries if needed.
  while (Buffer.byteLength(JSON.stringify(evidence)) > MAX_OUTPUT && evidence.commands.length) { evidence.commands.shift(); evidence.truncated = true; }
  while (Buffer.byteLength(JSON.stringify(evidence)) > MAX_OUTPUT && evidence.services.length) { evidence.services.shift(); evidence.truncated = true; }
  return evidence;
}

export async function reportPackageFailure(options, emit = message => console.error(message)) {
  try { emit(`PACKAGE_FAILURE_EVIDENCE ${JSON.stringify(await packageFailureEvidence(options))}`); }
  catch { try { emit('PACKAGE_FAILURE_EVIDENCE {"state":"unavailable"}'); } catch {} }
}
