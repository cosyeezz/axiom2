// Shared Windows/macOS bootstrap. Only Node built-ins; no installed backend required.
import { createHash } from 'node:crypto';
import { mkdir, stat, open, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const phase = text => console.log(`@@phase:${text}`);
const report = value => console.log(`@@progress:${JSON.stringify(value)}`);
// Use stdout for the structured result: PowerShell 5.1 can turn native stderr
// into a terminating NativeCommandError before the exit code is collected.
const failure = error => console.log(`@@error:${error.message}`);

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
    throw Error(`${error.message}${error.cause?.message ? `（${error.cause.message}）` : ''} [已接收 ${downloaded}/${size} 字节]`);
  } finally { clearInterval(timer); await file?.close(); }
}
async function run(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}` } });
    let tail = '', stdout = '', timedOut = false;
    const output = data => { process.stdout.write(data); tail = (tail + data).slice(-4000); };
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); output(data); }); child.stderr.on('data', output);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const detail = tail.trim().split(/\r?\n/).filter(Boolean).slice(-6).join(' · ');
      if (code === 0 && !timedOut) resolve(stdout.trim());
      else reject(Error(`安装命令${timedOut ? '超时（10 分钟）' : `退出 ${code ?? signal}`}：${detail || '没有命令输出，请检查 Node.js/npm 和网络。'}`));
    });
  });
}
export async function installService({ root = process.env.AXIOM_DATA_DIR, fetcher = fetch, runner = run } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 19) throw Error('请先安装 Node.js 22.19.0+ 和 npm。');
  try { await stat(join(root, 'installation.json')); throw Error('已有服务安装记录，请使用更新或手动修复入口。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const get = async url => {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`HTTP ${response.status} ${response.statusText || ''}`);
      // Metadata also has a bound; attachment MIME does not determine text decoding.
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Error('响应超过 2 MiB'); chunks.push(chunk); }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) { throw Error(`读取 ${url} 失败：${error.message}${error.cause?.message ? `（${error.cause.message}）` : ''}`); }
  };
  phase('正在读取正式发布版本…');
  const release = JSON.parse(await get('https://api.github.com/repos/cosyeezz/axiom2/releases/latest'));
  if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) throw Error('发布版本无效');
  const base = `https://github.com/cosyeezz/axiom2/releases/download/${release.tag_name}/`;
  for (const name of ['axiom2.tgz', 'SHA256SUMS']) {
    const matches = release.assets.filter(asset => asset.name === name);
    if (matches.length !== 1 || matches[0].browser_download_url !== base + name) throw Error(`发布附件 ${name} 不完整或地址不可信`);
  }
  const size = release.assets.find(asset => asset.name === 'axiom2.tgz').size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > 128 * 1024 * 1024) throw Error(`发布安装包大小无效：${size}`);
  phase(`正在读取 ${release.tag_name} 的 SHA-256 校验清单…`);
  const digest = checksum(await get(base + 'SHA256SUMS'));
  await mkdir(join(root, 'setup'), { recursive: true });
  const archive = join(root, 'setup/axiom2.tgz');
  phase(`正在下载并校验服务安装包 ${release.tag_name}…`);
  try { await downloadFile(base + 'axiom2.tgz', archive, { size, digest, fetcher }); }
  catch (error) { await rm(archive, { force: true }); throw error; }
  const prefix = join(root, 'service');
  phase('安装包大小与 SHA-256 已通过；正在安装后台及运行依赖（npm 不提供总下载进度，请查看实时日志）…');
  await runner([process.env.AXIOM_SETUP_NPM, 'install', '--prefix', prefix, '--install-strategy=shallow', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--save=false', '--loglevel=http', '--registry=https://registry.npmjs.org', archive]);
  phase('正在启动并验证后台服务…');
  const result = await runner([join(prefix, 'node_modules/@cosyeezz/axiom2/bin/axiom2.mjs'), 'start', '--json']);
  let service;
  try { service = JSON.parse(result); } catch { throw Error(`后台启动未返回有效状态：${result || '没有输出'}`); }
  if (service.state !== 'running') throw Error(`后台尚未就绪：${service.message || service.state || result}`);
  phase('安装完成，正在重新读取服务状态。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await installService(); } catch (error) { failure(error); process.exitCode = 1; }
}
