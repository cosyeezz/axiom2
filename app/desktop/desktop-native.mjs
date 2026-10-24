// Release-owned Linux supervisor, staged locally before any cleanup command.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const invalid = () => Error('桌面内置 Linux 监督器无效，请重新安装客户端；尚未执行清理命令。');
async function directories(path) {
  const absolute = resolve(path), parent = dirname(absolute);
  if (parent !== absolute) await directories(parent);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
}
export function validateLinuxHelper(bundle, arch) {
  if (!['x64', 'arm64'].includes(arch) || bundle?.protocol !== 1 || bundle.arch !== arch || typeof bundle.data !== 'string' || !/^[a-f0-9]{64}$/.test(bundle.sha256 ?? '') || bundle.data.length > 12 * 1024 * 1024) throw invalid();
  const bytes = Buffer.from(bundle.data, 'base64');
  if (bytes.length < 64 || bytes.length > 8 * 1024 * 1024 || bytes.toString('base64') !== bundle.data || bytes.subarray(0, 6).toString('hex') !== '7f454c460201' || bytes.readUInt16LE(18) !== (arch === 'x64' ? 62 : 183) || createHash('sha256').update(bytes).digest('hex') !== bundle.sha256) throw invalid();
  return bytes;
}
export async function stageBundledLinuxHelper(runtime, { bundlePath = fileURLToPath(new URL('./native-helper.json', import.meta.url)), arch = process.arch } = {}) {
  await directories(dirname(bundlePath));
  let file, bundle;
  try {
    file = await open(bundlePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 12 * 1024 * 1024) throw invalid();
    bundle = JSON.parse(await file.readFile('utf8'));
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  finally { await file?.close(); }
  // Non-Linux build templates intentionally contain no Linux executable.
  if (bundle?.protocol === 1 && bundle.arch === null && bundle.data === null && bundle.sha256 === null && Object.keys(bundle).length === 4) return false;
  const bytes = validateLinuxHelper(bundle, arch);
  await directories(runtime);
  let directory = runtime;
  for (const name of ['bin', 'native', `linux-${arch}`]) {
    directory = join(directory, name);
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await directories(directory);
  }
  const output = await open(join(directory, 'axiom-owner'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o700);
  try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
  const manifest = await open(join(directory, 'manifest.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await manifest.writeFile(JSON.stringify({ protocol: 1, arch, sha256: bundle.sha256 })); await manifest.sync(); } finally { await manifest.close(); }
  return true;
}
export async function prepareLinuxHelper({ runtime, offline, download, ...options }) {
  if (await stageBundledLinuxHelper(runtime, options)) return;
  if (offline) throw Error('当前客户端缺少本机 Linux 离线监督器，请安装包含该组件的客户端后重试；清理不会联网下载或执行命令。');
  await download();
}
