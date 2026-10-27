// Explicit foreground repair. Old uncertain journals are evidence, not a gate on
// installing into a fresh, dedicated prefix. Never recursively remove the data root.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { inspectArtifacts, inspectDownload, inspectInstallation } from './foreground-artifacts.mjs';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './atomic-json.mjs';
import { DesktopExecution, desktopTask } from './maintenance.mjs';
import { serviceAdmission } from './service-admission.mjs';

async function jsonFile(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384) throw Error('安装记录类型或大小无效。');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function below(parent, path) {
  const value = relative(parent, path);
  return !!value && value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(value);
}
export async function managedPrefix(root, prefix) {
  const base = join(root, 'service-installs');
  if (!isAbsolute(prefix) || dirname(prefix) !== base) return false;
  const info = await lstat(prefix);
  if (!info.isDirectory() || info.isSymbolicLink() || relative(prefix, await realpath(prefix))) return false;
  const marker = await jsonFile(join(prefix, '.axiom-desktop-install.json'));
  return marker?.schema === 1 && marker.root === root && marker.prefix === prefix && typeof marker.id === 'string';
}
export async function cleanManagedPrefix(root, prefix, remove = rm) {
  if (!await managedPrefix(root, prefix)) throw Error('未确认目录为 Axiom 专用安装目录，已保留原文件。');
  await remove(prefix, { recursive: true, force: true });
}

// Reuse the public CLI's existing startup reservation (also supported by old
// releases). serviceAdmission alone cannot exclude a launch from another shell.
export async function withProgramReservation(root, operation) {
  const file = join(root, 'service-startup.sqlite');
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('服务启动锁类型异常。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(file), token = randomBytes(32).toString('hex'); let acquired = false;
  try {
    db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS startup (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL)');
    if (!db.prepare('INSERT OR IGNORE INTO startup VALUES(1,?,?)').run(token, process.pid).changes) throw Error('另一服务正在启动，已保留旧程序及登记，请稍后重试。');
    acquired = true;
    // A ready service has already removed its startup row. A live descriptor
    // therefore also vetoes mutation; persisted PIDs are only queried, never killed.
    const meta = await jsonFile(join(root, 'service-control.json'));
    if (meta) {
      if (!Number.isInteger(meta.pid) || meta.pid < 1) throw Error('旧服务身份尚未核实，未更改程序文件。');
      try { process.kill(meta.pid, 0); throw Error('旧服务进程尚未退出，未更改程序文件或登记。'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const check = async () => {
      try { await lstat(join(root, `service-cancel-${token}`)); throw Object.assign(Error('服务切换已被关闭请求取消。'), { code: 'cancelled' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
    await check(); const result = await operation(check); await check(); return result;
  } finally {
    try { if (acquired) db.prepare('DELETE FROM startup WHERE token=? AND pid=?').run(token, process.pid); }
    finally { db.close(); if (acquired) await rm(join(root, `service-cancel-${token}`), { force: true }); }
  }
}
async function archiveLegacyOwner(root, taskDir) {
  const source = join(root, 'setup', 'service-owner.json'); let info;
  try { info = await lstat(source); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 524288) throw Error('旧安装归属记录类型异常，已保留现场。');
  const bytes = await readFile(source), target = join(taskDir, `legacy-service-owner-${randomUUID()}.json`);
  const audit = { source, target, sha256: createHash('sha256').update(bytes).digest('hex'), disposition: 'historical-unknown-for-new-prefix', processExitConfirmed: false };
  await atomicJson(join(taskDir, 'legacy-owner-archive.json'), { ...audit, archived: false });
  await rename(source, target);
  await atomicJson(join(taskDir, 'legacy-owner-archive.json'), { ...audit, archived: true });
}

// A command is complete only after its own real close. stderr is ordinary
// console output, not a PowerShell ErrorRecord and not an implicit failure.
export function foregroundCommand(file, args, { cwd, env, capture = false, signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolveCommand, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: false, detached: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    const output = [], errors = []; let received = 0, errorBytes = 0, spawnError, overflow = false;
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    if (capture) {
      child.stdout.on('data', bytes => { received += bytes.length; if (received > 65536) { overflow = true; stop(); } else output.push(bytes); });
      child.stderr.on('data', bytes => { errors.push(bytes); errorBytes += bytes.length; while (errorBytes > 32768 && errors.length > 1) errorBytes -= errors.shift().length; });
    }
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, exitSignal) => {
      signal?.removeEventListener('abort', stop);
      if (spawnError) return reject(spawnError);
      if (signal?.aborted) return reject(signal.reason);
      if (overflow) return reject(Error('服务控制响应超过 64 KiB。'));
      if (code !== 0) {
        let detail = Buffer.concat(errors).subarray(-32768).toString('utf8').trim();
        const text = Buffer.concat(output).toString('utf8');
        try { detail = JSON.parse(text).message || detail; } catch { detail ||= text.trim(); }
        return reject(Object.assign(Error(`前台命令退出 ${code ?? exitSignal}。${detail}`), { code: 'child-exit', exitCode: code, signal: exitSignal }));
      }
      resolveCommand(Buffer.concat(output).toString('utf8'));
    });
  });
}
async function boundedText(execution, url, limit, fetcher) {
  const response = await execution.fetch(url, fetcher);
  if (!response.ok) { await response.body?.cancel(); throw Error(`下载失败：HTTP ${response.status}`); }
  const chunks = []; let size = 0;
  try { for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw Error('发布元数据超过大小限制。'); chunks.push(chunk); } }
  finally { await response.body?.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
async function archive(execution, asset, digest, file, fetcher) {
  const response = await execution.fetch(asset.browser_download_url, fetcher);
  if (!response.ok) { await response.body?.cancel(); throw Error(`安装包下载失败：HTTP ${response.status}`); }
  const output = await open(file, 'wx', 0o600), hash = createHash('sha256'); let received = 0;
  try {
    for await (const bytes of response.body) {
      received += bytes.length;
      if (received > asset.size) throw Error('安装包超过发布声明的大小，已拒绝安装。');
      hash.update(bytes); await output.writeFile(bytes);
    }
    if (received !== asset.size || hash.digest('hex') !== digest) throw Error('安装包大小或 SHA-256 不匹配，已拒绝安装。');
  } finally { await output.close(); await response.body?.cancel().catch(() => {}); }
}
async function registeredCli(root) {
  const registration = await jsonFile(join(root, 'installation.json'));
  if (!registration) return null;
  if (typeof registration.cli !== 'string' || !isAbsolute(registration.cli)) throw Error('旧安装登记不可用，保留旧文件并使用新目录。');
  const cli = resolve(registration.cli), packageRoot = resolve(dirname(cli), '..');
  if (!below(root, cli) || !cli.endsWith(join('node_modules', '@cosyeezz', 'axiom2', 'bin', 'axiom2.mjs')) || relative(cli, await realpath(cli))) throw Error('旧安装不属于本机专用目录，未执行旧程序。');
  if ((await jsonFile(join(packageRoot, 'package.json')))?.name !== '@cosyeezz/axiom2') throw Error('旧安装包身份无法确认。');
  return cli;
}

export async function installForeground({ root = process.env.AXIOM_DATA_DIR, taskDir = process.env.AXIOM_SETUP_TASK_DIR, npm = process.env.AXIOM_SETUP_NPM, repair = process.env.AXIOM_SETUP_REPAIR === '1', targetVersion = process.env.AXIOM_SETUP_VERSION || undefined, requireLatest = process.env.AXIOM_SETUP_REQUIRE_LATEST === '1', fetcher = fetch, command = foregroundCommand, remove = rm, log = console.log } = {}) {
  if (!root || !isAbsolute(root) || !taskDir || !isAbsolute(taskDir) || !npm || !isAbsolute(npm)) throw Error('前台安装参数不完整。');
  if (targetVersion && !/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(targetVersion)) throw Error('安装版本无效。');
  if (requireLatest && !targetVersion) throw Error('更新需要明确的确认版本。');
  root = await realpath(root);
  if (!below(root, taskDir)) throw Error('安装任务目录不属于当前数据目录。');
  const task = await jsonFile(join(taskDir, 'task.json')) || desktopTask('service', 'install');
  const execution = new DesktopExecution(task, value => atomicJson(join(taskDir, 'task.json'), value), async () => jsonFile(join(taskDir, 'control.json')));
  let release, failure, prefix;
  const phase = async (name, message, controllable = true) => { log(`@@phase:${message}`); await execution.phase(name, message, controllable); };
  const env = { ...process.env, AXIOM_DATA_DIR: root };
  const run = (args, capture = false) => command(process.execPath, args, { cwd: root, env, capture, signal: execution.signal });
  try {
    release = await serviceAdmission(root);
    await phase('checking', '正在校验已有安装包和程序…');
    const existing = repair || targetVersion ? { state: 'absent' } : await inspectInstallation(root);
    if (existing.state === 'verified') {
      await atomicJson(join(taskDir, 'foreground-result.json'), { root, ...existing, readyToStart: false, message: '程序已安装，请点击启动。' });
      await phase('validating', '程序已安装，请点击启动。', false);
    } else {
    let latestRelease;
    if (requireLatest) {
      // Updates revalidate latest BEFORE executing any old program or stopping it.
      // Explicit reinstall keeps its separately confirmed historical version.
      await phase('checking', '正在重新核实最新后台版本…');
      latestRelease = JSON.parse(await boundedText(execution, 'https://api.github.com/repos/cosyeezz/axiom2/releases/latest', 2000000, fetcher));
      if (latestRelease.tag_name !== `v${targetVersion}` || latestRelease.draft || latestRelease.prerelease || !Array.isArray(latestRelease.assets)) throw Error('最新版本已变化或不可用，请重新检查并确认；未停止旧服务。');
      for (const name of ['axiom2.tgz', 'SHA256SUMS']) {
        const assets = latestRelease.assets.filter(asset => asset?.name === name), asset = assets[0];
        if (assets.length !== 1 || asset.browser_download_url !== `https://github.com/cosyeezz/axiom2/releases/download/v${targetVersion}/${name}` || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 128 * 1024 * 1024 || name === 'axiom2.tgz' && !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw Error('最新发布附件信息无效；未停止旧服务。');
      }
    }
    let stopped = false, oldCli;
    try {
      const old = await registeredCli(root); oldCli = old;
      if (old) {
        let current = JSON.parse(await run([old, 'status', '--json'], true));
        if (['running', 'starting', 'stopping'].includes(current.state)) {
          await phase('checking', '正在通过已验证的控制通道关闭旧服务，以便重新安装…');
          current = JSON.parse(await run([old, 'stop', '--json'], true));
        }
        stopped = current.state === 'stopped';
        if (!stopped) log('旧服务未确认停止：不删除旧程序，改用新安装目录。');
      }
    } catch (error) { log(`旧安装未能安全清理，改用新目录：${error.message}`); }
    const base = join(root, 'service-installs');
    await mkdir(base, { recursive: true, mode: 0o700 });
    if ((await lstat(base)).isSymbolicLink() || relative(base, await realpath(base))) throw Error('专用安装目录不能是链接。');
    if (stopped) {
      try {
        const previous = await jsonFile(join(root, 'setup', 'foreground-prefix.json'));
        if (previous?.prefix && oldCli !== join(root, 'service', 'node_modules', '@cosyeezz', 'axiom2', 'bin', 'axiom2.mjs')) { await withProgramReservation(root, () => cleanManagedPrefix(root, previous.prefix, remove)); log('已强制清理上次自管安装文件；用户数据保留。'); }
      } catch (error) { log(`旧目录无法清理，已保留并换新目录：${error.message}`); }
      if (oldCli === join(root, 'service', 'node_modules', '@cosyeezz', 'axiom2', 'bin', 'axiom2.mjs')) {
        try {
          await withProgramReservation(root, async () => {
            const packageRoot = dirname(dirname(oldCli)), info = await lstat(packageRoot);
            if (!info.isDirectory() || info.isSymbolicLink() || relative(packageRoot, await realpath(packageRoot)) || (await jsonFile(join(packageRoot, 'package.json')))?.name !== '@cosyeezz/axiom2') throw Error('旧程序目录身份已变化。');
            await remove(packageRoot, { recursive: true, force: true, maxRetries: 0 });
          });
          log('已强制清理验证归属的旧 Axiom 程序包；旧目录中的其他工具及用户数据保留。');
        } catch (error) { log(`旧程序无法清理，保留现场并换新目录：${error.message}`); }
      }
    }
    let cached;
    try { cached = await inspectDownload(root); }
    catch (error) { log(`已有下载未通过校验，将重新下载：${error.message}`); }
    let download, version;
    if (!requireLatest && cached?.state === 'verified' && (targetVersion ? cached.version === targetVersion : !repair)) {
      download = cached.file; version = cached.version;
      await phase('verifying', '已有安装包通过大小与 SHA-256 校验，直接安装。');
    } else {
    await phase('checking', '正在读取正式发布版本…');
    const releaseUrl = targetVersion ? `https://api.github.com/repos/cosyeezz/axiom2/releases/tags/v${targetVersion}` : 'https://api.github.com/repos/cosyeezz/axiom2/releases/latest';
    const releaseInfo = latestRelease || JSON.parse(await boundedText(execution, releaseUrl, 2000000, fetcher));
    if (releaseInfo.draft || releaseInfo.prerelease || !/^v?\d+\.\d+\.\d+$/.test(releaseInfo.tag_name) || !Array.isArray(releaseInfo.assets)) throw Error('正式发布版本无效。');
    if (targetVersion && releaseInfo.tag_name !== `v${targetVersion}`) throw Error('发布版本与已确认的安装版本不匹配。');
    const baseUrl = `https://github.com/cosyeezz/axiom2/releases/download/${releaseInfo.tag_name}/`;
    const asset = name => {
      const found = releaseInfo.assets.filter(value => value.name === name);
      if (found.length !== 1 || found[0].browser_download_url !== baseUrl + name) throw Error('正式发布附件缺失、重复或地址不可信。');
      return found[0];
    };
    const bundle = asset('axiom2.tgz'); asset('SHA256SUMS');
    if (!Number.isSafeInteger(bundle.size) || bundle.size < 1 || bundle.size > 128 * 1024 * 1024) throw Error('安装包声明大小无效。');
    const sums = await boundedText(execution, baseUrl + 'SHA256SUMS', 1000000, fetcher);
    const matches = sums.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim().match(/^([a-f\d]{64})\s+\*?axiom2\.tgz$/i)).filter(Boolean);
    if (matches.length !== 1) throw Error('安装包必须有唯一 SHA-256 校验条目。');
    if (requireLatest && bundle.digest !== `sha256:${matches[0][1].toLowerCase()}`) throw Error('最新发布摘要与校验文件不一致，已拒绝安装。');
    download = join(taskDir, 'axiom2.tgz');
    await phase('downloading', '正在前台下载并校验安装包…');
    await archive(execution, bundle, matches[0][1].toLowerCase(), download, fetcher);
    await phase('verifying', '安装包大小与 SHA-256 已通过。');
    version = releaseInfo.tag_name.replace(/^v/, '');
    await atomicJson(join(root, 'setup', 'foreground-download.json'), { schema: 1, root, taskId: task.id, version, tag: releaseInfo.tag_name, url: bundle.browser_download_url, size: bundle.size, sha256: matches[0][1].toLowerCase() });
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      prefix = await mkdtemp(join(base, 'install-'));
      await atomicJson(join(prefix, '.axiom-desktop-install.json'), { schema: 1, id: randomUUID(), root, prefix });
      await phase('installing', `前台安装到 ${prefix}${attempt ? '（换目录重试）' : ''}…`);
      try {
        await run([npm, 'install', '--prefix', prefix, '--install-strategy=shallow', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--save=false', '--loglevel=http', '--registry=https://registry.npmjs.org', download]);
        const installed = await jsonFile(join(prefix, 'node_modules', '@cosyeezz', 'axiom2', 'package.json'));
        if (installed?.name !== '@cosyeezz/axiom2' || installed.version !== version) throw Error('安装后的包身份或版本不匹配。');
        break;
      } catch (error) {
        if (attempt || error.code !== 'child-exit' || execution.signal.aborted) throw error;
        log(`安装失败：${error.message} 正在清理本次安装，再换新目录重试。`);
        try { await withProgramReservation(root, () => cleanManagedPrefix(root, prefix, remove)); } catch (cleanup) { log(`本次目录仍被占用，保留现场并换目录：${cleanup.message}`); }
      }
    }
    execution.signal.throwIfAborted();
    const cli = join(prefix, 'node_modules', '@cosyeezz', 'axiom2', 'bin', 'axiom2.mjs');
    // Record the verified npm result before querying runtime state. A later
    // status/control failure must not turn a completed installation into missing.
    const cliInfo = await lstat(cli);
    if (!cliInfo.isFile() || cliInfo.isSymbolicLink() || cliInfo.nlink !== 1 || cliInfo.size > 1024 * 1024 || relative(cli, await realpath(cli))) throw Error('安装后的程序入口无效。');
    await atomicJson(join(root, 'setup', 'foreground-installation.json'), { schema: 1, root, prefix, cli, version, taskId: task.id, cliSha256: createHash('sha256').update(await readFile(cli)).digest('hex') });
    await phase('validating', '程序已安装，正在检查服务状态…');
    const current = JSON.parse(await run([cli, 'status', '--json'], true));
    if (!['stopped', 'running', 'starting', 'stopping', 'unmanaged'].includes(current.state)) throw Error('程序已安装，但服务控制状态无效；请查看前台终端。');
    execution.signal.throwIfAborted();
    const readyToStart = current.state === 'stopped';
    // A live old service keeps its registration. Installing another directory
    // is not permission to change the identity of an active service.
    if (readyToStart) await withProgramReservation(root, async check => {
      execution.signal.throwIfAborted(); await check();
      await atomicJson(join(root, 'installation.json'), { node: process.execPath, cli });
      execution.signal.throwIfAborted(); await check();
      // This is archival for a new program scope, never an exit receipt for the
      // unknown old task. Native history keeps that task unresolved verbatim.
      await archiveLegacyOwner(root, taskDir);
    });
    execution.signal.throwIfAborted();
    await atomicJson(join(root, 'setup', 'foreground-prefix.json'), { root, prefix });
    execution.signal.throwIfAborted();
    const message = readyToStart ? '程序安装完成，请点击启动。' : '程序安装完成；现有服务状态不允许启动，请查看状态提示。';
    await atomicJson(join(taskDir, 'foreground-result.json'), { root, prefix, cli, version, readyToStart, message });
    execution.signal.throwIfAborted();
    await phase('validating', message, false);
    }
  } catch (error) { failure = error; log(`@@error:${error.message}`); }
  finally { try { await execution.finish(failure); } finally { release?.(); } }
  // finish() can observe a cancellation that raced the final asynchronous
  // publication. A cancelled/failed task must never produce process exit zero.
  if (failure) throw failure;
  execution.signal.throwIfAborted();
  if (task.status !== 'succeeded') throw Error(task.error?.message || '前台安装尚未成功结算。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--inspect') console.log(JSON.stringify(await inspectArtifacts(await realpath(process.env.AXIOM_DATA_DIR))));
    else await installForeground();
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
