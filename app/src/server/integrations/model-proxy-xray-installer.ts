import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proxyDirectory } from "./model-proxy-config.js";
import { downloadProxyAsset, proxyAsset, proxyZipMember } from "./model-proxy-install.js";
import { runRtk } from "./rtk-process.js";

// Standalone upstream executable, not linked into or redistributed with Axiom.
// The project's MIT license does not cover all binary dependencies (including GPL sing-box).
const version = "11.4.1";
const hashes: Record<string, string> = {
  "darwin-arm64": "e154daecfaa13992d227296dd34daf6ee382d1866e7696858cc1862d20139b09",
  "darwin-x64": "9b99c8c0ee8cfc131ed4e8bd811f660031153d11ae84b74ec6e59d42dc75c509",
  "linux-arm64": "268022f8e0e60506c5df260e57c86d44f397d3584bf9d4833c305ccc7471f26a",
  "linux-x64": "e3e0ad1e2ee28a7d394feaf9a15947bf3cb175fa09f656245a3ddfa4d545f7d8",
  "win32-arm64": "d85956ab1bf322a3b6f1dd96f8d3a0c730589182e357143491d178c8a6239f14",
  "win32-x64": "25249051018c7de960058e9a2e692b0ed63e0df39fcb2090515749239f5a73fd",
};
export function xrayImporterRelease(platform = process.platform as string, arch = process.arch as string) {
  const sha256 = hashes[`${platform}-${arch}`], asset = proxyAsset("xray", version, platform, arch)?.replace(/^Xray-/, "Xray-knife-");
  if (!sha256 || !asset) throw Error("当前平台没有可用的 Xray 分享导入组件。");
  return { version, asset, sha256, url: `https://github.com/lilendian0x00/xray-knife/releases/download/v${version}/${asset}` };
}
export const xrayImporterDirectory = (root: string) => join(proxyDirectory(root), "importer", `xray-knife-${version}-${process.platform}-${process.arch}`);
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function replaceFile(file: string, data: Buffer, mode: number) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, data, { flag: "wx", mode }); renameSync(temp, file); }
  finally { rmSync(temp, { force: true }); }
}
export async function prepareXrayImporter(root: string, signal: AbortSignal, progress: (message: string) => void): Promise<string> {
  signal.throwIfAborted();
  const release = xrayImporterRelease(), directory = xrayImporterDirectory(root);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const archivePath = join(directory, release.asset);
  try {
    // Verify the pinned archive even on cache hits. The executable is checked against its verified member.
    let archive: Buffer | undefined = existsSync(archivePath) && statSync(archivePath).size <= 40 * 1024 * 1024 ? readFileSync(archivePath) : undefined;
    if (!archive || digest(archive) !== release.sha256) {
      progress("正在连接官方服务，准备 Xray 分享导入组件（首次使用需下载，可取消）…");
      archive = await downloadProxyAsset(release.url, signal, 40 * 1024 * 1024, (received, total) => {
        const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
        progress(`正在下载 Xray 分享导入组件：${mb(received)} MB${total ? ` / ${mb(total)} MB` : ""}…`);
      });
      progress("下载完成，正在校验 Xray 分享导入组件…");
      if (digest(archive) !== release.sha256) throw Error("checksum");
      signal.throwIfAborted(); replaceFile(archivePath, archive, 0o600);
    }
    signal.throwIfAborted();
    const binary = "xray-knife" + (process.platform === "win32" ? ".exe" : "");
    const data = proxyZipMember(archive, binary), executable = join(directory, binary);
    if (!existsSync(executable) || statSync(executable).size !== data.length || digest(readFileSync(executable)) !== digest(data)) replaceFile(executable, data, 0o700);
    if (process.platform !== "win32") chmodSync(executable, 0o700);
    const found = (await runRtk(executable, ["--version"], { root: directory, signal, timeout: 10_000 })).toString().trim();
    if (found !== `xray-knife ${version}`) throw Error("version");
    signal.throwIfAborted(); progress("正在本机转换 Xray 分享链接…"); return executable;
  } catch {
    throw Error(signal.aborted ? "节点识别已取消。" : "Xray 分享导入组件下载、校验或启动失败，请检查官方 GitHub 连接后重试。");
  }
}
