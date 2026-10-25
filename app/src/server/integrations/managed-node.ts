import { createHash } from "node:crypto";
import { createWriteStream, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import semver from "semver";
import { maintainedFetch, maintenancePhase } from "../maintenance.js";
import { runBuiltinTool } from "./builtin-operation.js";
import { extractEngineArchive } from "./rea-engine-archive.js";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";

export type NodeTool = "rea" | "opencli";
export type NodeRuntimeBinding = { nodeVersion: string; npmVersion: string; engines: string; platform: string; arch: string; sha256: string };
type Stamp = { size: number; mtime: number; ctime: number; ino: string; dev: string };
type Receipt = { format: 2; binding: NodeRuntimeBinding; node: Stamp; npm: Stamp; npmTree: string };
export type NodeRuntime = { binding: NodeRuntimeBinding; node: string; npm: string; directory: string; files: string[] };
export type ManagedNodeProvider = {
  latest(name: string, signal: AbortSignal): Promise<string>;
  prepare(tool: NodeTool, prefix: string, name: string, version: string, signal: AbortSignal, notify: (text: string) => void): Promise<NodeRuntime>;
};
export const runtimeReceipt = (prefix: string) => join(prefix, "runtime.json");
export function validNodeBinding(value: unknown): value is NodeRuntimeBinding {
  const v = value as NodeRuntimeBinding | undefined;
  return !!v && typeof v === "object" && typeof v.nodeVersion === "string" && !!semver.valid(v.nodeVersion) && typeof v.npmVersion === "string" && !!semver.valid(v.npmVersion) && typeof v.engines === "string" && v.engines.length <= 1024 && !!semver.validRange(v.engines) && ["darwin", "linux", "win32"].includes(v.platform) && ["x64", "arm64"].includes(v.arch) && /^[a-f0-9]{64}$/.test(v.sha256);
}
export function nodeRuntimePaths(prefix: string, binding: NodeRuntimeBinding) {
  if (!validNodeBinding(binding)) throw Error("组件 Node 运行时记录无效。");
  const directory = join(prefix, "runtime", `node-v${binding.nodeVersion}-${binding.platform === "win32" ? "win" : binding.platform}-${binding.arch}`);
  return { directory, node: join(directory, binding.platform === "win32" ? "node.exe" : "bin/node"), npm: join(directory, binding.platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "lib/node_modules/npm/bin/npm-cli.js") };
}
function safeRuntimePath(prefix: string, file: string) {
  const boundary = resolve(prefix);
  for (let path = file; ; path = dirname(path)) {
    if (path !== boundary && !path.startsWith(boundary + sep)) throw Error("组件运行时路径逃逸。");
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw Error("组件运行时含替换链接，请重新安装。");
    if (path === boundary) break;
  }
}
function safeRuntimeFile(prefix: string, file: string) {
  safeRuntimePath(prefix, file);
  const info = lstatSync(file);
  if (!info.isFile()) throw Error("组件 Node/npm 文件不完整。");
  return { size: info.size, mtime: info.mtimeMs, ctime: info.ctimeMs, ino: String(info.ino), dev: String(info.dev) } satisfies Stamp;
}
/** npm's entry delegates to lib/ and bundled dependencies. Bind that entire
 * immutable tree, not just npm-cli.js. This is a bounded identity check, not a
 * signature or a security boundary against an attacker who can rewrite receipts. */
function npmTreeStamp(prefix: string, npm: string) {
  const root = dirname(dirname(npm)), hash = createHash("sha256");
  safeRuntimePath(prefix, root);
  let remaining = 15_000;
  function visit(path: string, name: string, depth: number) {
    if (--remaining < 0 || depth > 64) throw Error("组件 npm 文件树超出校验限制。");
    const stat = lstatSync(path, { bigint: true });
    const kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : undefined;
    if (!kind) throw Error("组件 npm 含链接或特殊文件，请重新安装。");
    hash.update(JSON.stringify([name, kind, String(stat.dev), String(stat.ino), String(stat.mode), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]));
    if (kind === "directory") for (const child of readdirSync(path).sort()) visit(join(path, child), `${name}/${child}`, depth + 1);
  }
  visit(root, "npm", 0);
  return hash.digest("hex");
}
export function recordNodeRuntime(prefix: string, binding: NodeRuntimeBinding): NodeRuntime {
  const paths = nodeRuntimePaths(prefix, binding);
  const receipt: Receipt = { format: 2, binding, node: safeRuntimeFile(prefix, paths.node), npm: safeRuntimeFile(prefix, paths.npm), npmTree: npmTreeStamp(prefix, paths.npm) };
  writeFileSync(runtimeReceipt(prefix), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return inspectNodeRuntime(prefix, binding);
}
export function inspectNodeRuntime(prefix: string, binding: NodeRuntimeBinding): NodeRuntime {
  if (!validNodeBinding(binding) || binding.platform !== process.platform || binding.arch !== process.arch || !semver.satisfies(binding.nodeVersion, binding.engines)) throw Error("组件运行时与本机平台或工具版本不兼容，请重新安装。");
  safeRuntimeFile(prefix, runtimeReceipt(prefix));
  const receipt: Receipt = JSON.parse(readFileSync(runtimeReceipt(prefix), "utf8")), paths = nodeRuntimePaths(prefix, binding);
  if (receipt.format !== 2 || JSON.stringify(receipt.binding) !== JSON.stringify(binding) || JSON.stringify(receipt.node) !== JSON.stringify(safeRuntimeFile(prefix, paths.node)) || JSON.stringify(receipt.npm) !== JSON.stringify(safeRuntimeFile(prefix, paths.npm)) || receipt.npmTree !== npmTreeStamp(prefix, paths.npm)) throw Error("组件 Node/npm 已变化或不完整，请重新安装；未回退系统运行时。");
  return { ...paths, binding, files: [runtimeReceipt(prefix), paths.npm] };
}
export function selectNodeRelease(index: unknown, engines: string, platform = process.platform as string, arch = process.arch as string) {
  if (!semver.validRange(engines) || !Array.isArray(index)) throw Error("官方 Node 兼容性元数据无效。");
  const file = platform === "darwin" ? `osx-${arch}-tar` : `${platform === "win32" ? "win" : platform}-${arch}${platform === "win32" ? "-zip" : ""}`;
  const candidates = index.filter(item => typeof item?.version === "string" && /^v\d+\.\d+\.\d+$/.test(item.version) && item.lts && typeof item.npm === "string" && !!semver.valid(item.npm) && Array.isArray(item.files) && item.files.includes(file) && semver.satisfies(item.version, engines));
  candidates.sort((a, b) => semver.rcompare(a.version, b.version));
  if (!candidates.length) throw Error(`没有满足 ${engines} 的受支持 Node LTS 发行包（${platform}/${arch}）；当前安装保持不变。`);
  return candidates[0] as { version: string; npm: string };
}
async function officialFetch(url: string, signal: AbortSignal) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !["nodejs.org", "registry.npmjs.org"].includes(u.hostname) || u.username || u.password || u.port) throw Error("运行时下载地址不属于官方发布服务。");
  const response = await maintainedFetch(url, { signal, redirect: "error" });
  if (!response.ok) { await response.body?.cancel(); throw Error(`官方运行时服务返回 HTTP ${response.status}。`); }
  return response;
}
async function metadata(url: string, signal: AbortSignal) {
  const response = await officialFetch(url, signal), chunks: Uint8Array[] = [];
  let bytes = 0;
  if (!response.body) throw Error("官方运行时元数据为空。");
  const reader = response.body.getReader();
  try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; if (bytes > 4 * 1024 * 1024) throw Error("运行时元数据过大。"); chunks.push(item.value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
const packageUrl = (name: string, version: string) => `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
export const managedNode: ManagedNodeProvider = {
  async latest(name, signal) {
    const pkg = JSON.parse(await metadata(packageUrl(name, "latest"), signal));
    if (pkg.name !== name || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw Error("npm 未返回有效的官方稳定版本。");
    return pkg.version;
  },
  async prepare(tool, prefix, name, version, signal, notify) {
    const pkg = JSON.parse(await metadata(packageUrl(name, version), signal));
    if (pkg.name !== name || pkg.version !== version || typeof pkg.engines?.node !== "string" || !semver.validRange(pkg.engines.node)) throw Error("目标工具缺少有效的 Node 兼容声明，未使用后台 Node 猜测安装。");
    const selected = selectNodeRelease(JSON.parse(await metadata("https://nodejs.org/dist/index.json", signal)), pkg.engines.node);
    const nodeVersion = selected.version.slice(1), os = process.platform === "win32" ? "win" : process.platform;
    const format = process.platform === "win32" ? "zip" : "tar.gz";
    const asset = `node-v${nodeVersion}-${os}-${process.arch}.${format}`;
    const base = `https://nodejs.org/dist/v${nodeVersion}/`;
    const sums = await metadata(`${base}SHASUMS256.txt`, signal);
    const sha256 = sums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line)).find(match => match?.[2] === asset)?.[1];
    if (!sha256) throw Error("官方 Node 校验清单未包含目标发行包。");
    const binding: NodeRuntimeBinding = { nodeVersion, npmVersion: selected.npm, engines: pkg.engines.node, platform: process.platform, arch: process.arch, sha256 };
    notify(`正在准备 ${tool === "rea" ? "REA" : "OpenCLI"} 专用 Node ${nodeVersion} / npm ${selected.npm}…`);
    maintenancePhase("downloading");
    const runtime = join(prefix, "runtime"); await mkdir(runtime, { mode: 0o700 });
    const archive = join(prefix, `node.${format}`), response = await officialFetch(`${base}${asset}`, signal);
    if (!response.body) throw Error("官方 Node 发行包为空。");
    const hash = createHash("sha256"); let size = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(size > 160 * 1024 * 1024 ? Error("Node 发行包超出大小限制。") : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(archive, { flags: "wx", mode: 0o600 }), { signal });
    maintenancePhase("verifying");
    if (!size || hash.digest("hex") !== sha256) throw Error("Node SHA-256 校验失败，当前工具保持不变。");
    await extractEngineArchive(archive, runtime, format, signal, 600 * 1024 * 1024); await rm(archive);
    const paths = nodeRuntimePaths(prefix, binding), state = join(prefix, "environment");
    prepareComponentEnvironment(state);
    const options = { cwd: resolve(prefix, "../../../.."), signal, timeout: 30_000, limit: 8192, env: componentEnvironment(state, process.env, dirname(paths.node)) };
    for (const [args, expected] of [[["--version"], `v${nodeVersion}`], [[paths.npm, "--version"], selected.npm]] as const) {
      const result = await runBuiltinTool(tool, paths.node, [...args], options);
      if (result.code !== 0 || result.stdout.toString("utf8").trim() !== expected) throw Error("私有 Node/npm 自检未通过，当前工具保持不变。");
    }
    signal.throwIfAborted(); return recordNodeRuntime(prefix, binding);
  },
};
