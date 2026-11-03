import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MaintenanceError } from "../../shared/maintenance.js";
import { maintainedFetch, maintenancePhase } from "../maintenance.js";
import { assertFfmpegContainer, captureFfmpegPaths, ffmpegBinary, ffmpegContainerPaths, ffmpegDirectory, ffmpegVersionPattern, type FfmpegInstallation } from "./ffmpeg-config.js";
import { prepareComponentEnvironment } from "./component-environment.js";
import { runNative } from "./native-process.js";

export type FfmpegRun = typeof runNative;
export type FfmpegDownload = (url: string, signal: AbortSignal, limit: number) => Promise<Buffer>;
export type FfmpegAsset = { name: string; url: string; sha256: string; size: number };
export type FfmpegRelease = { version: string; assets: FfmpegAsset[] };
export const ffmpegTarget = (platform: string = process.platform, arch: string = process.arch) =>
  ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"].includes(`${platform}-${arch}`) ? `${platform === "darwin" ? "osx" : platform === "win32" ? "win" : platform}-${arch}` : undefined;
const repository = "https://github.com/shaka-project/static-ffmpeg-binaries";
const license: FfmpegAsset = { name: "LICENSE", url: "https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.2/COPYING.GPLv3", sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903", size: 35147 };
export function validateFfmpegUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "raw.githubusercontent.com"].includes(url.hostname)) throw Error("FFmpeg 下载地址不属于已允许的发布服务。");
}
export const downloadFfmpeg: FfmpegDownload = async (initial, signal, limit) => {
  let url = initial;
  for (let hop = 0; hop < 6; hop++) {
    signal.throwIfAborted(); validateFfmpegUrl(url);
    const response = await maintainedFetch(url, { signal, redirect: "manual", headers: { "User-Agent": "Axiom-FFmpeg", Accept: new URL(url).hostname === "api.github.com" ? "application/vnd.github+json" : "application/octet-stream" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel(); url = new URL(response.headers.get("location")!, url).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new MaintenanceError("http", `FFmpeg 发布服务返回 HTTP ${response.status}。`); }
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw Error("FFmpeg 下载文件超过限制。"); }
    const reader = response.body?.getReader(); if (!reader) throw Error("FFmpeg 下载未返回内容。");
    const chunks: Buffer[] = []; let size = 0;
    try {
      for (;;) { const item = await reader.read(); if (item.done) break; signal.throwIfAborted(); size += item.value.byteLength; if (size > limit) throw Error("FFmpeg 下载文件超过限制。"); chunks.push(Buffer.from(item.value)); }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
  throw Error("FFmpeg 下载重定向次数过多。");
};
export async function latestFfmpeg(signal: AbortSignal, download: FfmpegDownload = downloadFfmpeg): Promise<FfmpegRelease> {
  const target = ffmpegTarget(); if (!target) throw Error("当前平台没有已适配的 FFmpeg 静态程序包。");
  const data = JSON.parse((await download("https://api.github.com/repos/shaka-project/static-ffmpeg-binaries/releases/latest", signal, 2 * 1024 * 1024)).toString("utf8"));
  if (!ffmpegVersionPattern.test(data.tag_name) || !data.tag_name.startsWith("n") || data.draft || data.prerelease || !Array.isArray(data.assets)) throw Error("FFmpeg 发布服务未返回有效的稳定程序包。");
  const version: string = data.tag_name, base = `${repository}/releases/download/${version}/`;
  const assets = ["ffmpeg", "ffprobe"].map(program => {
    const name = `${program}-${target}${process.platform === "win32" ? ".exe" : ""}`;
    const matches = data.assets.filter((item: { name?: string }) => item.name === name), item = matches[0];
    if (matches.length !== 1 || item.browser_download_url !== base + name || !/^sha256:[a-f0-9]{64}$/.test(item.digest) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 160 * 1024 * 1024) throw Error("FFmpeg 发布缺少双程序或可信 SHA-256 校验。");
    return { name, url: item.browser_download_url as string, sha256: (item.digest as string).slice(7), size: item.size as number };
  });
  return { version, assets: [...assets, { ...license }] };
}
export function verifyFfmpegAsset(bytes: Buffer, asset: FfmpegAsset) {
  if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw Error(`FFmpeg ${asset.name} SHA-256 或长度校验失败。`);
}
export async function diagnoseFfmpeg(root: string, directory: string, signal: AbortSignal, run: FfmpegRun = runNative) {
  assertFfmpegContainer(root);
  const environmentDirectory = join(ffmpegDirectory(root), "environment");
  prepareComponentEnvironment(environmentDirectory);
  assertFfmpegContainer(root);
  const check = captureFfmpegPaths([...ffmpegContainerPaths(root), directory]);
  const options = { root, environmentDirectory, signal, timeout: 20_000, limit: 512 * 1024, admissionCheck: check };
  const execute = async (name: "ffmpeg" | "ffprobe", args: string[]) => {
    check(); signal.throwIfAborted();
    const output = await run(ffmpegBinary(directory, name), args, options);
    check(); signal.throwIfAborted(); return output;
  };
  const banners: string[] = [];
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const banner = (await execute(name, ["-version"])).toString("utf8").split(/\r?\n/)[0];
    if (!banner?.startsWith(`${name} version `)) throw Error(`${name} 版本自检失败。`);
    banners.push(banner);
  }
  const sample = join(environmentDirectory, "tmp", `doctor-${randomUUID()}.png`);
  try {
    await execute("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=0.1", "-frames:v", "1", "-update", "1", "-n", sample]);
    const info = lstatSync(sample);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw Error("FFmpeg 自检输出无效。");
    const magic = readFileSync(sample).subarray(0, 8);
    if (!magic.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error("FFmpeg 图片生成自检失败。");
    const probe = JSON.parse((await execute("ffprobe", ["-v", "error", "-show_streams", "-of", "json", sample])).toString("utf8"));
    if (!probe.streams?.some((stream: { codec_name?: string; width?: number; height?: number }) => stream.codec_name === "png" && stream.width === 32 && stream.height === 32)) throw Error("FFprobe 图片探测自检失败。");
  } finally { try { check(); rmSync(sample, { force: true }); } catch { /* Never clean through a replaced parent. */ } }
  return `${banners.join("\n")}\n双程序执行、PNG 生成与尺寸探测通过。程序包标签不等于上游最新 FFmpeg 版本。`;
}
export async function installFfmpeg(root: string, release: FfmpegRelease, signal: AbortSignal, notify: (text: string) => void, download: FfmpegDownload = downloadFfmpeg, run: FfmpegRun = runNative): Promise<FfmpegInstallation> {
  assertFfmpegContainer(root);
  const target = ffmpegTarget(), extension = process.platform === "win32" ? ".exe" : "";
  const names = [`ffmpeg-${target}${extension}`, `ffprobe-${target}${extension}`, "LICENSE"];
  if (!target || !/^n\d{1,5}\.\d{1,5}\.\d{1,5}-\d{1,5}$/.test(release.version) || release.assets.length !== 3 || names.some(name => release.assets.filter(asset => asset.name === name).length !== 1)) throw Error("FFmpeg 候选程序包无效。");
  for (const asset of release.assets) {
    const expectedUrl = asset.name === "LICENSE" ? license.url : `${repository}/releases/download/${release.version}/${asset.name}`;
    if (asset.url !== expectedUrl || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > (asset.name === "LICENSE" ? 256 * 1024 : 160 * 1024 * 1024) || asset.name === "LICENSE" && (asset.sha256 !== license.sha256 || asset.size !== license.size)) throw Error("FFmpeg 候选来源或摘要无效。");
  }
  const directory = `${release.version}-${randomUUID()}`, dest = join(ffmpegDirectory(root), "versions", directory);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const check = captureFfmpegPaths([root, join(root, "integrations"), ffmpegDirectory(root), join(ffmpegDirectory(root), "versions"), dest]);
  try {
    for (const asset of release.assets) {
      check(); signal.throwIfAborted(); maintenancePhase("downloading"); notify(`正在下载 ${asset.name}…`);
      const bytes = await download(asset.url, signal, asset.size);
      check(); maintenancePhase("verifying"); signal.throwIfAborted(); verifyFfmpegAsset(bytes, asset);
      maintenancePhase("installing");
      const program = asset.name === names[0] ? "ffmpeg" : asset.name === names[1] ? "ffprobe" : undefined;
      writeFileSync(program ? ffmpegBinary(dest, program) : join(dest, "LICENSE"), bytes, { flag: "wx", mode: program ? 0o700 : 0o600 });
    }
    const upstreamVersion = release.version.slice(1).replace(/-\d+$/, "");
    check();
    writeFileSync(join(dest, "source.json"), JSON.stringify({ repository, ...release }, null, 2), { flag: "wx", mode: 0o600 });
    writeFileSync(join(dest, "README"), `Third-party static FFmpeg/FFprobe binaries, GPLv3 (see LICENSE).\nBuild scripts: ${repository}/tree/${release.version} (Apache-2.0; NOT the binary license).\nRelease/build configuration: ${repository}/releases/tag/${release.version}\nFFmpeg upstream source: https://github.com/FFmpeg/FFmpeg/tree/n${upstreamVersion}\nNo binaries are bundled with Axiom. Downloaded on explicit install; each GitHub asset SHA256 verified.\nPackage tag is not a guarantee of the binary banner or newest upstream version; run diagnostics.\n`, { flag: "wx", mode: 0o600 });
    maintenancePhase("validating"); notify("校验通过，正在验证 FFmpeg 与 FFprobe…");
    await diagnoseFfmpeg(root, dest, signal, run); check(); signal.throwIfAborted();
    return { directory, version: release.version, platform: process.platform, arch: process.arch };
  } catch (error) {
    if (!(error instanceof MaintenanceError && error.code === "stop-unconfirmed")) {
      try { check(); rmSync(dest, { recursive: true, force: true }); } catch { /* A replacement belongs to someone else. */ }
    }
    throw error;
  }
}
