import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
const root = process.env.AXIOM_DATA_DIR;
const phase = text => console.log(`@@phase:${text}`);
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH || ''}` } });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`安装命令退出 ${code}`)));
  });
}
try {
  try { await stat(join(root, 'installation.json')); throw Error('已有服务安装记录，请使用更新或手动修复入口。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const get = async url => { const response = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!response.ok) throw Error(`下载失败 (${response.status})`); return response; };
  phase('正在读取正式发布版本…');
  const release = await (await get('https://api.github.com/repos/cosyeezz/axiom2/releases/latest')).json();
  if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) throw Error('发布版本无效');
  const base = `https://github.com/cosyeezz/axiom2/releases/download/${release.tag_name}/`;
  for (const name of ['axiom2.tgz', 'SHA256SUMS']) {
    const matches = release.assets.filter(asset => asset.name === name);
    if (matches.length !== 1 || matches[0].browser_download_url !== base + name) throw Error('发布附件不完整或地址不可信');
  }
  phase('正在下载服务安装包…');
  const bytes = Buffer.from(await (await get(base + 'axiom2.tgz')).arrayBuffer());
  const sums = await (await get(base + 'SHA256SUMS')).text();
  phase('正在校验安装包…');
  const digest = sums.match(/^([a-f\d]{64})\s+\*?axiom2\.tgz\s*$/im)?.[1];
  if (bytes.length !== release.assets.find(asset => asset.name === 'axiom2.tgz').size || createHash('sha256').update(bytes).digest('hex') !== digest?.toLowerCase()) throw Error('服务安装包校验失败');
  await mkdir(join(root, 'setup'), { recursive: true });
  const archive = join(root, 'setup/axiom2.tgz'); await writeFile(archive, bytes);
  const prefix = join(root, 'service');
  phase('正在安装后台及运行依赖…');
  await run([process.env.AXIOM_SETUP_NPM, 'install', '--prefix', prefix, '--install-strategy=shallow', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--save=false', '--registry=https://registry.npmjs.org', archive]);
  phase('正在启动并验证后台服务…');
  await run([join(prefix, 'node_modules/@cosyeezz/axiom2/bin/axiom2.mjs'), 'start', '--json']);
  phase('安装完成，正在重新读取服务状态。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
