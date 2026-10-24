// Conservative npm removal preview. Discovery alone never authorizes deletion.
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

export async function pathIdentity(path) {
  try {
    const stat = await lstat(path, { bigint: true });
    return { path, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), size: String(stat.size), modified: String(stat.mtimeNs), link: stat.isSymbolicLink() };
  } catch (error) { if (error.code === 'ENOENT') return { path, missing: true }; throw error; }
}
export async function inspectPiRemoval(info, registration) {
  if (!info.version) throw Error('所选 npm 中未发现终端 Pi；请检查其他命令来源。');
  if (info.legacy) throw Error('检测到旧命名空间的 Pi，请通过原安装方式处理同名命令后重新预览。');
  const prefix = await realpath(info.prefix), packageRoot = await realpath(info.packageRoot);
  // Prefix aliases are bound by piEnvironment; descendants must be ordinary directories.
  if (packageRoot !== join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', '@earendil-works/pi-coding-agent')) throw Error('Pi 目录存在链接或非标准布局，请通过原安装方式卸载。');
  const identities = [];
  for (let path = info.packageRoot; ; path = dirname(path)) {
    const identity = await pathIdentity(path);
    if (identity.link || identity.missing) throw Error('Pi 安装目录身份无法确认，请重新预览。');
    // Directory timestamps change when the shared admission lock is created.
    delete identity.modified; delete identity.size;
    identities.push(identity);
    if (path === info.prefix) break;
    if (dirname(path) === path) throw Error('Pi 安装不在所选 npm 前缀内。');
  }
  if (registration) {
    const actualCli = await realpath(registration.cli);
    identities.push(await pathIdentity(actualCli), { backendCli: actualCli });
    for (const cli of new Set([registration.cli, actualCli])) {
      for (const directory of createRequire(cli).resolve.paths('@earendil-works/pi-coding-agent') ?? []) {
        const candidate = join(directory, '@earendil-works/pi-coding-agent');
        try {
          if (await realpath(candidate) === packageRoot) throw Error('后台正在引用这份 Pi，请先处理后台安装，不能单独移除共享依赖。');
          if (!(await pathIdentity(join(candidate, 'package.json'))).missing) break;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  const manifest = join(info.packageRoot, 'package.json');
  const manifestIdentity = await pathIdentity(manifest);
  if (manifestIdentity.link || manifestIdentity.missing) throw Error('Pi 包清单身份无法确认。');
  const pkg = JSON.parse(await readFile(manifest, 'utf8'));
  if (!pkg.bin || typeof pkg.bin !== 'object' || Object.keys(pkg.bin).length !== 1 || typeof pkg.bin.pi !== 'string') throw Error('Pi 命令声明不受支持，请通过原安装方式卸载。');
  const cli = resolve(info.packageRoot, pkg.bin.pi);
  if (!cli.startsWith(`${info.packageRoot}${sep}`) || await realpath(cli) !== join(packageRoot, pkg.bin.pi)) throw Error('Pi 命令入口位于包目录之外或存在链接。');
  const commands = process.platform === 'win32' ? ['pi', 'pi.cmd', 'pi.ps1'].map(name => join(info.prefix, name)) : [join(info.prefix, 'bin/pi')];
  for (const path of commands) {
    const identity = await pathIdentity(path);
    if (!identity.missing) {
      if (process.platform === 'win32') throw Error('Windows npm 命令包装器归属尚未核实，请使用原 npm 卸载方式。');
      if (!identity.link || await realpath(path) !== await realpath(cli)) throw Error('pi 命令属于另一份安装，请先处理命令冲突。');
    }
    identities.push(identity);
  }
  identities.push(manifestIdentity, await pathIdentity(cli), await pathIdentity(await realpath(info.installed.node)), await pathIdentity(await realpath(info.npm)));
  const identity = createHash('sha256').update(JSON.stringify([info.identity, identities, registration])).digest('hex');
  return { identity, version: info.version, packageRoot: info.packageRoot, prefix: info.prefix, commands,
    items: [
      { label: '程序与包内依赖', path: info.packageRoot, state: 'remove' },
      ...commands.map(path => ({ label: 'npm 命令入口', path, state: 'remove' })),
      { label: '共享 npm 前缀与缓存', path: info.prefix, state: 'retain', note: '其他全局包和公共缓存保留。' },
      { label: 'Pi 设置、会话及独立资源', state: 'retain', note: '保留用户设置、认证、会话和资源目录。' },
      { label: '其他安装、旧版本与下载残留', state: 'unverified', note: '需要结合环境扫描逐项核实。' },
      { label: '外部终端会话', state: 'unverified', note: '请先关闭使用此 Pi 的终端任务；不会自动结束外部进程。' },
    ] };
}
export async function verifyPiRemoval(preview) {
  const items = [];
  for (const item of preview.items) {
    if (item.state !== 'remove') { items.push(item); continue; }
    const missing = (await pathIdentity(item.path)).missing === true;
    items.push({ ...item, state: missing ? 'removed' : 'remaining' });
  }
  return { items, complete: !items.some(item => item.state === 'remaining') };
}
