import { serviceAdmission } from './service-admission.mjs';
import { serviceRemovalPending } from './service-removal.mjs';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile, rename, rm, open } from 'node:fs/promises';
import { join, dirname, delimiter, isAbsolute, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DesktopExecution, desktopTask } from './maintenance.mjs';
import { startService } from './service-start.mjs';
const report = value => console.log(`@@progress:${JSON.stringify(value)}`);
export function checksum(sums, name = 'axiom2.tgz') {
  const entries = sums.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim().match(/^([a-f\d]{64})\s+\*?(.+)$/i)).filter(match => match?.[2] === name);
  if (entries.length !== 1) throw Error(`校验清单无效：${name} 应有唯一 SHA-256 条目，实际 ${entries.length} 条。已拒绝安装，请重新获取正式发布版本。`);
  return entries[0][1].toLowerCase();
}
export async function downloadFile(url, destination, { size, digest, fetcher = fetch, onProgress = report, timeoutMs = 600000 } = {}) {
  const startedAt = Date.now(); let downloaded = 0, lastBytes = 0, lastAt = startedAt, lastByteAt = startedAt;
  let file, timer;
  const publish = () => {
    const now = Date.now();
    onProgress({ name: url.split('/').at(-1), downloaded, total: size, speed: (downloaded - lastBytes) * 1000 / Math.max(1, now - lastAt), startedAt, updatedAt: now, lastByteAt });
    lastAt = now; lastBytes = downloaded;
  };
  try {
    publish(); timer = setInterval(publish, 1000);
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw Error(`下载 ${url} 失败：HTTP ${response.status} ${response.statusText || ''}`);
    file = await open(destination, 'w', 0o600);
    const hash = createHash('sha256');
    for await (const chunk of response.body) {
      downloaded += chunk.length; lastByteAt = Date.now();
      if (downloaded > size) throw Error(`安装包大小不符：${url}；预期 ${size} 字节，已收到 ${downloaded} 字节。已拒绝安装。`);
      hash.update(chunk); await file.writeFile(chunk);
    }
    publish();
    if (downloaded !== size) throw Error(`安装包大小不符：${url}；预期 ${size} 字节，实际 ${downloaded} 字节。请检查网络后重试。`);
    const actual = hash.digest('hex');
    if (actual !== digest) throw Error(`安装包 SHA-256 不符：${url}；预期 ${digest}，实际 ${actual}。已拒绝安装，请重新下载。`);
  } catch (error) {
    // Include bytes even for fetch/stream timeouts, rather than hiding the failing stage.
    throw Object.assign(Error(`${error.message}${error.cause?.message ? `（${error.cause.message}）` : ''} [已接收 ${downloaded}/${size} 字节]`), { code: error.code });
  } finally { clearInterval(timer); await file?.close(); }
}

export async function installService({ root = process.env.AXIOM_DATA_DIR, fetcher = fetch, runner } = {}) {
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || major === 22 && minor < 19) throw Error("请先安装 Node.js 22.19.0+ 和 npm。");
const taskDir = process.env.AXIOM_SETUP_TASK_DIR;
const task = taskDir ? JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8')) : desktopTask('service', 'install');
let failure, owner, runtime, owned, releaseAdmission, serviceRequested = false;
const ownership = { confirmed: true };
const execution = new DesktopExecution(task, async value => {
  if (!taskDir) return;
  if (failure?.code === 'stop-unconfirmed') { value.status = 'unknown'; value.message = failure.message; value.error = { code: failure.code, message: failure.message, phase: value.phase }; }
  // Loaded before the first publication, and shared with the bootstrap so Windows
  // readers cannot turn a transient rename sharing violation into a failed task.
  if (owned) owned.atomicJSON(join(taskDir, 'task.json'), value);
  else {
    // Runtime extraction can itself fail; still publish the terminal task.
    await writeFile(join(taskDir, 'task.next'), JSON.stringify(value));
    await rename(join(taskDir, 'task.next'), join(taskDir, 'task.json'));
  }
}, async () => {
  if (!taskDir) return null;
  try { return JSON.parse(await readFile(join(taskDir, 'control.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
});
async function phase(name, text, controllable = true) { console.log(`@@phase:${text}`); await execution.phase(name, text, controllable); }
async function loadRuntime() {
  const files = JSON.parse(await readFile(new URL('./setup-runtime.json', import.meta.url), 'utf8'));
  const parent = taskDir || join(root, 'setup');
  await mkdir(parent, { recursive: true });
  runtime = await mkdtemp(join(parent, 'runtime-'));
  for (const [name, content] of Object.entries(files)) {
    if (isAbsolute(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || typeof content !== 'string') throw Error('安装监督器资源路径无效。');
    const target = join(runtime, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  }
  return import(pathToFileURL(join(runtime, 'bootstrap/main.mjs')).href);
}
async function get(url, limit) {
  const response = await execution.fetch(url, fetcher);
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`下载失败 (${response.status})`), { code: 'http' }); }
  const reader = response.body.getReader(); let count = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > limit) throw Error('发布元数据超出大小限制'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
try {
  releaseAdmission = await serviceAdmission(root);
  if (await serviceRemovalPending(root)) throw Error('后台卸载尚未完成，请先在环境清理中重新预览并完成清理。');
  if (!runner) owned = await loadRuntime();
  await execution.update();
  if (!runner && !['win32', 'linux'].includes(process.platform)) throw Error('此平台尚无可靠的后台安装进程监督器，尚未执行 npm。');
  try { if (owned) owner = owned.createProcessOwner(join(root, 'setup', 'service-owner.json')); }
  catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(Error('已有后台安装或启动结果尚未确认，已保留归属记录，请先核实已有任务。'), { code: 'stop-unconfirmed' });
    throw error;
  }
  if (owned && process.platform === 'linux') await owned.downloadLinuxHelper(execution, runtime);
  try { await stat(join(root, 'installation.json')); throw Error('已有服务安装记录，请使用更新或手动修复入口。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await phase('checking', '正在读取正式发布版本…');
  const release = JSON.parse(await get('https://api.github.com/repos/cosyeezz/axiom2/releases/latest', 2_000_000));
  if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) throw Error('发布版本无效');
  const base = `https://github.com/cosyeezz/axiom2/releases/download/${release.tag_name}/`;
  for (const name of ['axiom2.tgz', 'SHA256SUMS']) {
    const matches = release.assets.filter(asset => asset.name === name);
    if (matches.length !== 1 || matches[0].browser_download_url !== base + name) throw Error('发布附件不完整或地址不可信');
  }
  const size = release.assets.find(asset => asset.name === 'axiom2.tgz').size;
  if (!Number.isSafeInteger(size) || size < 1 || size > 128 * 1024 * 1024) throw Error('服务安装包大小无效');
  const digest = checksum(await get(base + 'SHA256SUMS', 1_000_000));
  await mkdir(join(root, 'setup'), { recursive: true });
  const archive = join(taskDir || join(root, 'setup'), 'axiom2.tgz');
  await phase('downloading', '正在下载服务安装包…');
  try { await downloadFile(base + 'axiom2.tgz', archive, { size, digest, fetcher: url => execution.fetch(url, fetcher) }); }
  catch (error) { await rm(archive, { force: true }); throw error; }
  await phase('verifying', '安装包大小与 SHA-256 已通过。');
  const prefix = join(root, 'service');
  await phase('installing', '正在安装后台及运行依赖…');
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`, npm_config_fetch_retries: '2', npm_config_fetch_timeout: '86400000' };
  const args = [process.env.AXIOM_SETUP_NPM, 'install', '--prefix', prefix, '--install-strategy=shallow', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--save=false', '--loglevel=http', '--registry=https://registry.npmjs.org', archive];
  const result = runner ? await runner(args) : await owned.runOwnedCommand({ directory: join(runtime, 'command'), execution, owner, ownership, taskPath: taskDir ? join(taskDir, 'task.json') : undefined, file: process.execPath, cwd: root, env, args });
  const packageRoot = join(prefix, 'node_modules/@cosyeezz/axiom2');
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (installed.name !== '@cosyeezz/axiom2' || installed.version !== release.tag_name.replace(/^v/, '')) throw Error('安装后的后台包身份或版本与已校验发布不一致。');
  await phase('validating', `正在启动并验证后台服务…${result.logError ? ` ${result.logError}` : ''}`);
  serviceRequested = true;
  const startArgs = [join(packageRoot, 'bin/axiom2.mjs'), 'start', '--json'];
  if (runner) {
    const service = JSON.parse(await runner(startArgs));
    if (service.state !== 'running') throw Error(`后台尚未就绪：${service.message || service.state}`);
  } else await startService({ args: startArgs, cwd: root, env, signal: execution.signal });
  execution.signal.throwIfAborted();
  await phase('validating', '安装完成，后台服务已就绪。');
} catch (error) {
  failure = serviceRequested && error.code !== 'stop-unconfirmed' ? Object.assign(Error(`后台启动后未能确认最终结果，请重新读取服务状态。${error.message}`), { code: 'stop-unconfirmed' }) : error;

}
finally {
  if (owner && !ownership.confirmed) failure = Object.assign(Error(`尚未确认安装进程树退出，归属记录已保留。${failure ? ` ${failure.message}` : ''}`), { code: 'stop-unconfirmed' });
  // A publication failure retains the journal: release only after this write.
  try {
    await execution.finish(failure);
    if (ownership.confirmed && failure?.code !== 'stop-unconfirmed') owner?.confirmed();
  } finally { releaseAdmission?.(); }
}

if (failure) throw failure;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await installService(); } catch (error) { console.log(`@@error:${error.message}`); process.exitCode = 1; }
}
