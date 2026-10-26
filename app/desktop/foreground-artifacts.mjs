// Local installation facts are separate from the active service's registration.
// Inspection is read-only: it never reclaims locks, launches a CLI or changes ownership.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export async function record(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384) throw Error('安装凭据类型或大小无效。');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function plainFile(path, maximum) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > maximum || relative(path, await realpath(path))) throw Error('安装文件类型、大小或路径无效。');
  return info;
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const taskId = id => typeof id === 'string' && /^\d+-\d+$/.test(id);
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
export async function inspectDownload(root) {
  const proof = await record(join(root, 'setup', 'foreground-download.json'));
  if (!proof) return { state: 'absent' };
  if (proof.schema !== 1 || proof.root !== root || !taskId(proof.taskId) || !version(proof.version)
    || !['v' + proof.version, proof.version].includes(proof.tag)
    || proof.url !== `https://github.com/cosyeezz/axiom2/releases/download/${proof.tag}/axiom2.tgz`
    || !Number.isSafeInteger(proof.size) || proof.size < 1 || proof.size > 128 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(proof.sha256)) throw Error('下载凭据与正式发布不匹配。');
  const file = join(root, 'setup', proof.taskId, 'axiom2.tgz');
  const info = await plainFile(file, 128 * 1024 * 1024);
  if (info.size !== proof.size || digest(await readFile(file)) !== proof.sha256) throw Error('已下载的安装包校验失败。');
  return { state: 'verified', ...proof, file };
}
export async function inspectInstallation(root) {
  let proof = await record(join(root, 'setup', 'foreground-installation.json'));
  if (!proof) {
    // Compatibility with the first foreground client: require its exact successful
    // task AND real process-exit receipt, not just an existing prefix directory.
    const pointer = await record(join(root, 'setup', 'foreground-prefix.json'));
    if (!pointer) return { state: 'absent' };
    const job = await record(join(root, 'setup', 'job.json'));
    const ids = [...new Set([job?.id, ...(await readdir(join(root, 'setup'))).filter(taskId)])].filter(taskId);
    if (ids.length > 1000) throw Error('安装历史过多，请从明确的程序安装记录恢复。');
    for (const id of ids) {
      const dir = join(root, 'setup', id);
      if (relative(dir, await realpath(dir))) continue;
      const task = await record(join(dir, 'task.json')), exit = await record(join(dir, 'foreground-exit.json'));
      const result = await record(join(dir, 'foreground-result.json'));
      if (task?.id === id && task.status === 'succeeded' && exit?.code === 0 && exit.success === true
        && result?.root === root && result.prefix === pointer.prefix) { proof = { ...result, schema: 1, taskId: id, legacy: true }; break; }
    }
    if (!proof) throw Error('已安装程序的完成凭据待核实。');
  }
  if (proof.schema !== 1 || proof.root !== root || !taskId(proof.taskId) || !version(proof.version)
    || typeof proof.prefix !== 'string' || !isAbsolute(proof.prefix) || dirname(proof.prefix) !== join(root, 'service-installs')) throw Error('已安装程序范围无效。');
  const prefix = proof.prefix, info = await lstat(prefix);
  if (!info.isDirectory() || info.isSymbolicLink() || relative(prefix, await realpath(prefix))) throw Error('已安装程序目录不能是链接。');
  const marker = await record(join(prefix, '.axiom-desktop-install.json'));
  if (marker?.schema !== 1 || marker.root !== root || marker.prefix !== prefix || typeof marker.id !== 'string') throw Error('已安装程序目录身份不匹配。');
  const packageRoot = join(prefix, 'node_modules', '@cosyeezz', 'axiom2');
  const pkg = await record(join(packageRoot, 'package.json'));
  if (relative(packageRoot, await realpath(packageRoot)) || pkg?.name !== '@cosyeezz/axiom2' || pkg.version !== proof.version) throw Error('已安装程序包名或版本不匹配。');
  const cli = join(packageRoot, 'bin', 'axiom2.mjs');
  if (proof.cli !== cli) throw Error('已安装程序入口不匹配。');
  await plainFile(cli, 1024 * 1024);
  if (!proof.legacy && (!/^[a-f0-9]{64}$/.test(proof.cliSha256) || digest(await readFile(cli)) !== proof.cliSha256)) throw Error('已安装程序入口校验失败。');
  return { state: 'verified', version: proof.version, prefix, cli, taskId: proof.taskId };
}
export async function inspectLaunchTarget(root, cli) {
  const candidate = await inspectInstallation(root);
  if (candidate.state === 'verified' && candidate.cli === cli) return candidate;
  // Older managed installations have a registration instead of a foreground
  // receipt. Keep that compatibility limited to the dedicated legacy package.
  const registration = await record(join(root, 'installation.json'));
  if (registration?.cli !== cli || cli !== join(root, 'service', 'node_modules', '@cosyeezz', 'axiom2', 'bin', 'axiom2.mjs')) throw Error('启动目标不属于已校验的 Axiom 安装。');
  await plainFile(cli, 1024 * 1024);
  const packageRoot = dirname(dirname(cli));
  const pkg = await record(join(packageRoot, 'package.json'));
  if (pkg?.name !== '@cosyeezz/axiom2' || !version(pkg.version) || relative(packageRoot, await realpath(packageRoot))) throw Error('旧安装包身份或版本无效。');
  return { state: 'verified', cli, version: pkg.version };
}
export async function inspectArtifacts(root) {
  const inspect = async fn => { try { return await fn(root); } catch (error) { return { state: 'unknown', message: error.message }; } };
  return { download: await inspect(inspectDownload), installation: await inspect(inspectInstallation) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await inspectArtifacts(await realpath(process.env.AXIOM_DATA_DIR)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
