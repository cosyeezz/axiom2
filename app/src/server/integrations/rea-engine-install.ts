import { maintainedFetch, maintenancePhase } from "../maintenance.js";
import { MaintenanceError } from "../../shared/maintenance.js";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, lstatSync, realpathSync } from "node:fs";
import { trackBuiltinDirectory, assertBuiltinFilesSafe, forgetBuiltinDirectory } from "./builtin-operation.js";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReaEngineId } from "../../shared/rea-engines.js";
import { extractEngineArchive } from "./rea-engine-archive.js";
import { engineHost, engineInstallable, type EngineHost } from "./rea-engines.js";
import { reaDirectory } from "./rea-runtime.js";

export type EngineRelease = { url: string; sha256: string; version: string; format: "jar" | "tar.gz" | "zip" };
export type EngineFetch = (url: string, signal: AbortSignal) => Promise<Response>;
export function officialEngineUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["api.adoptium.net", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) throw Error("组件下载地址不属于受信任的官方发布服务。");
}
export const fetchEngine: EngineFetch = async (initial, signal) => {
  const timed = signal;
  let url = initial;
  for (let hop = 0; hop < 6; hop++) {
    officialEngineUrl(url);
    const response = await maintainedFetch(url, { signal: timed, redirect: "manual", headers: { "User-Agent": "Axiom-REA" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { await response.body?.cancel(); url = new URL(response.headers.get("location")!, url).href; continue; }
    if (!response.ok) { await response.body?.cancel(); throw new MaintenanceError("http", `组件官方发布服务返回 HTTP ${response.status}。`); }
    return response;
  }
  throw Error("组件下载重定向过多。");
};
async function smallText(url: string, signal: AbortSignal, fetcher: EngineFetch) {
  const response = await fetcher(url, signal), reader = response.body?.getReader();
  if (!reader) throw Error("官方服务未返回内容。");
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length; if (length > 2 * 1024 * 1024) throw Error("官方元数据超出大小限制。"); chunks.push(item.value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function engineRelease(id: ReaEngineId, signal: AbortSignal, host = engineHost(), fetcher: EngineFetch = fetchEngine): Promise<EngineRelease> {
  if (!engineInstallable(id, host)) throw Error("当前后台系统/架构没有受支持的托管发行包，请配置已有安装。");
  if (id === "ghidra") return { url: "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip", sha256: "ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db", version: "12.1.4", format: "zip" };
  if (id === "jadx") return { url: "https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar", sha256: "6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75", version: "0.7.1", format: "jar" };
  if (id === "wabt") {
    const os = ({ darwin: "macos", win32: "windows", linux: "linux" } as Record<string, string>)[host.platform];
    const asset = `wabt-1.0.42-${os}-${host.arch}.tar.gz`, url = `https://github.com/WebAssembly/wabt/releases/download/1.0.42/${asset}`;
    const checksum = await smallText(`${url}.sha256`, signal, fetcher);
    const match = /^([a-f0-9]{64})(?:\s+\*?([^\s]+))?\s*$/i.exec(checksum);
    if (!match || match[2] && match[2] !== asset) throw Error("WABT 校验清单无效。");
    return { url, sha256: match[1].toLowerCase(), version: "1.0.42", format: "tar.gz" };
  }
  const os = ({ darwin: "mac", win32: "windows", linux: "linux" } as Record<string, string>)[host.platform], architecture = host.arch === "arm64" ? "aarch64" : "x64";
  const metadata = JSON.parse(await smallText(`https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${architecture}&image_type=jdk&os=${os}&vendor=eclipse`, signal, fetcher));
  const item = Array.isArray(metadata) && metadata.find(item => item.binary?.os === os && item.binary?.architecture === architecture && item.binary?.image_type === "jdk" && item.binary?.jvm_impl === "hotspot" && item.version?.major === 21);
  const pkg = item?.binary?.package, format = host.platform === "win32" ? "zip" : "tar.gz";
  if (!pkg || typeof pkg.link !== "string" || !pkg.link.startsWith("https://github.com/adoptium/temurin21-binaries/releases/download/") || !pkg.link.endsWith(`.${format}`) || !/^[a-f0-9]{64}$/i.test(pkg.checksum) || typeof item.version.semver !== "string") throw Error("Adoptium 未返回当前平台的有效 JDK 21 包与校验值。");
  officialEngineUrl(pkg.link);
  return { url: pkg.link, sha256: pkg.checksum.toLowerCase(), version: item.version.semver, format };
}
export async function downloadEngineFile(release: EngineRelease, output: string, signal: AbortSignal, fetcher: EngineFetch = fetchEngine) {
  officialEngineUrl(release.url);
  const response = await fetcher(release.url, signal), limit = 800 * 1024 * 1024;
  if (!response.body || Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw Error("组件下载为空或超过限制。"); }
  const hash = createHash("sha256"); let size = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(size > limit ? Error("组件下载超过大小限制。") : null, chunk); } });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(output, { flags: "wx", mode: 0o600 }), { signal });
  maintenancePhase("verifying");
  if (!size || hash.digest("hex") !== release.sha256) throw Error("组件 SHA-256 校验失败；未切换当前安装。");
}
export async function findEnginePath(root: string, id: ReaEngineId, host: EngineHost): Promise<string> {
  const matches: string[] = [], suffix = host.platform === "win32" ? ".exe" : "";
  async function visit(directory: string, depth: number) {
    if (depth > 5) return;
    const entries = await readdir(directory, { withFileTypes: true });
    if (id === "java" && entries.some(item => item.name === "release" && item.isFile()) && entries.some(item => item.name === "bin" && item.isDirectory())) matches.push(directory);
    if (id === "ghidra" && ["Ghidra", "support"].every(name => entries.some(item => item.name === name && item.isDirectory()))) matches.push(directory);
    if (id === "wabt" && ["wasm-validate", "wasm-objdump", "wasm2wat"].every(name => entries.some(item => item.name === name + suffix && item.isFile()))) matches.push(directory);
    for (const item of entries) if (item.isDirectory()) await visit(join(directory, item.name), depth + 1);
  }
  await visit(root, 0);
  if (matches.length !== 1) throw Error("组件压缩包布局不符合预期。");
  return matches[0];
}
export async function prepareEngine(root: string, id: ReaEngineId, signal: AbortSignal, notify: (message: string) => void, fetcher: EngineFetch = fetchEngine) {
  const host = engineHost();
  const release = await engineRelease(id, signal, host, fetcher);
  const directory = join(reaDirectory(root), "engines", `${id}-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const original = lstatSync(directory, { bigint: true });
  const assertIdentity = () => {
    const current = lstatSync(directory, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || realpathSync(directory) !== directory || current.dev !== original.dev || current.ino !== original.ino)
      throw new MaintenanceError("stop-unconfirmed", "组件候选目录身份已变化，已保留文件与记录。");
    assertBuiltinFilesSafe();
  };
  trackBuiltinDirectory(directory);
  try {
    notify(`正在下载 ${id} ${release.version}（${host.platform}/${host.arch}）…`);
    const archive = join(directory, release.format === "jar" ? "jadx-headless-mcp.jar" : `download.${release.format}`);
    await downloadEngineFile(release, archive, signal, fetcher);
    maintenancePhase("installing");
    notify("SHA-256 校验通过，正在准备组件…");
    const unpacked = join(directory, "files");
    if (release.format !== "jar") { await mkdir(unpacked); await extractEngineArchive(archive, unpacked, release.format, signal); await rm(archive); }
    const path = release.format === "jar" ? archive : await findEnginePath(unpacked, id, host);
    await writeFile(join(directory, "source.json"), JSON.stringify({ ...release, ...host, installedAt: Date.now() }, null, 2), { flag: "wx", mode: 0o600 });
    signal.throwIfAborted(); assertIdentity(); return { directory, path };
  } catch (error) { assertIdentity(); await rm(directory, { recursive: true, force: true }); forgetBuiltinDirectory(directory); throw error; }
}
