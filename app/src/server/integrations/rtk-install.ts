import { MaintenanceError } from "../../shared/maintenance.js";
import { maintainedFetch, maintenancePhase } from "../maintenance.js";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rtkDirectory, rtkVersionPattern } from "./rtk-config.js";
import { runRtk, type RtkRun } from "./rtk-process.js";

export type RtkRelease = { version: string; asset: string; url: string; checksums: string };
export type RtkDownload = (url: string, signal: AbortSignal, limit: number) => Promise<Buffer>;
export function rtkTarget(platform: string = process.platform, arch: string = process.arch) {
  return ({ "darwin-arm64": "aarch64-apple-darwin.tar.gz", "darwin-x64": "x86_64-apple-darwin.tar.gz", "linux-arm64": "aarch64-unknown-linux-gnu.tar.gz", "linux-x64": "x86_64-unknown-linux-musl.tar.gz", "win32-x64": "x86_64-pc-windows-msvc.zip" } as Record<string, string>)[`${platform}-${arch}`];
}
function officialUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) throw Error("RTK 下载地址不属于官方发布服务。");
}
export const downloadRtk: RtkDownload = async (initial, signal, limit) => {
  let url = initial;
  const timed = signal;
  for (let hop = 0; hop < 6; hop++) {
    officialUrl(url);
    const response = await maintainedFetch(url, { signal: timed, redirect: "manual", headers: { "User-Agent": "Axiom-RTK", Accept: new URL(url).hostname === "api.github.com" ? "application/vnd.github+json" : "application/octet-stream" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel(); url = new URL(response.headers.get("location")!, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new MaintenanceError("http", `RTK 官方下载服务返回 HTTP ${response.status}，请稍后重试。`); }
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw Error("RTK 下载文件超过限制。"); }
    const reader = response.body?.getReader(); if (!reader) throw Error("RTK 下载未返回内容。");
    const chunks: Buffer[] = []; let size = 0;
    try {
      while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > limit) throw Error("RTK 下载文件超过限制。"); chunks.push(Buffer.from(item.value)); }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
  throw Error("RTK 下载重定向次数过多。");
};
export async function latestRtk(signal: AbortSignal, download: RtkDownload = downloadRtk): Promise<RtkRelease> {
  const target = rtkTarget(); if (!target) throw Error("当前平台尚无官方 RTK OSS 发布包。");
  const value = JSON.parse((await download("https://api.github.com/repos/rtk-ai/rtk/releases/latest", signal, 2 * 1024 * 1024)).toString("utf8"));
  const version = typeof value.tag_name === "string" ? value.tag_name.replace(/^v/, "") : "";
  if (!rtkVersionPattern.test(version) || value.draft || value.prerelease || !Array.isArray(value.assets)) throw Error("官方未返回有效的稳定版本。");
  const asset = `rtk-oss-${target}`, base = `https://github.com/rtk-ai/rtk/releases/download/v${version}/`;
  for (const name of [asset, "checksums.txt"]) if (!value.assets.some((item: { name?: string; browser_download_url?: string }) => item.name === name && item.browser_download_url === base + name)) throw Error("官方发布缺少当前平台 OSS 程序或校验文件。");
  return { version, asset, url: base + asset, checksums: base + "checksums.txt" };
}
export function verifyRtkArchive(archive: Buffer, checksums: string, asset: string) {
  const entries = checksums.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})  (\S+)$/.exec(line)).filter(match => match?.[2] === asset);
  if (entries.length !== 1 || entries[0]![1].toLowerCase() !== createHash("sha256").update(archive).digest("hex")) throw Error("RTK 发布包 SHA-256 校验失败；未切换当前版本。");
}
export async function diagnoseRtk(root: string, file: string, version: string, signal: AbortSignal, run: RtkRun = runRtk) {
  const actual = (await run(file, ["--version"], { root, signal, timeout: 10_000 })).toString("utf8").trim();
  if (actual !== `rtk ${version}`) throw Error("RTK 安装版本与发布信息不一致。");
  const input = "Axiom RTK pipe 自检\n";
  const output = await run(file, ["pipe", "--passthrough"], { root, input, signal, timeout: 10_000 });
  if (!output.equals(Buffer.from(input))) throw Error("RTK stdin 接口自检失败。");
  const paths = Array.from({ length: 80 }, (_, i) => `src/components/example-long-directory/file-${i}.ts`).join("\n");
  const filtered = await run(file, ["pipe", "--filter", "find"], { root, input: paths, signal, timeout: 10_000 });
  if (!filtered.length || filtered.length >= Buffer.byteLength(paths) || !filtered.toString("utf8").includes("file-0.ts")) throw Error("RTK 过滤能力自检失败。");
  return "版本、UTF-8 stdin 透传和文件列表缩减自检通过。此样本不代表实际任务或账单节省。";
}
export async function installRtk(root: string, release: RtkRelease, signal: AbortSignal, notify: (text: string) => void, download: RtkDownload = downloadRtk, run: RtkRun = runRtk) {
  const directory = `v${release.version}-${randomUUID()}`, dest = join(rtkDirectory(root), "versions", directory);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  try {
    notify(`正在下载 RTK OSS ${release.version}…`);
    const archive = await download(release.url, signal, 40 * 1024 * 1024);
    const checksums = (await download(release.checksums, signal, 256 * 1024)).toString("utf8");
    maintenancePhase("verifying");
    signal.throwIfAborted(); verifyRtkArchive(archive, checksums, release.asset);
    maintenancePhase("installing");
    notify("校验通过，正在解包和自检…");
    const packed = join(dest, release.asset); writeFileSync(packed, archive, { flag: "wx", mode: 0o600 });
    const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
    const binary = process.platform === "win32" ? "rtk.exe" : "rtk";
    const entries = (await run(tar, ["-tf", packed], { root, signal, timeout: 30_000, limit: 16 * 1024 })).toString("utf8").trim().split(/\r?\n/);
    if (entries.length !== 2 || new Set(entries).size !== 2 || !entries.includes(binary) || !entries.includes("LICENSE")) throw Error("RTK 压缩包目录不符合预期。");
    // Extract only named members to stdout; archive paths/links can never write into the host filesystem.
    for (const member of [binary, "LICENSE"]) {
      const data = await run(tar, ["-xOf", packed, member], { root, signal, timeout: 30_000, limit: member === binary ? 80 * 1024 * 1024 : 128 * 1024 });
      if (!data.length) throw Error("RTK 发布包包含空文件或不支持的链接。");
      writeFileSync(join(dest, member), data, { flag: "wx", mode: member === binary ? 0o700 : 0o600 });
    }
    chmodSync(join(dest, binary), 0o700); rmSync(packed);
    maintenancePhase("validating");
    await diagnoseRtk(root, join(dest, binary), release.version, signal, run);
    signal.throwIfAborted();
    return { directory, version: release.version };
  } catch (error) {
    if (!(error instanceof MaintenanceError && error.code === "stop-unconfirmed")) rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}
