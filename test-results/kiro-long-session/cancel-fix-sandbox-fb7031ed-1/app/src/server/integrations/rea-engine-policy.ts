import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compareEngineVersions, reaEngineContractVersion, type ReaEngineId, type ReaEngineState } from "../../shared/rea-engines.js";

export const engineContractVersion = reaEngineContractVersion;
// Exact npm package contracts reviewed, not a promise about future REA releases.
// See docs/builtin-component-environments.md for upstream files and hashes.
export const reaEngineProfiles = {
  "6.7.0": { node: "^22.19.0 || ^24.11.0 || >=26.0.0", ghidra: "12.1.4", jadx: "0.7.1", wabt: "1.0.42", javaMajor: 21 },
  "6.8.0": { node: "^22.23.4 || ^24.22.1 || >=26.12.1", ghidra: "12.1.4", jadx: "0.7.1", wabt: "1.0.42", javaMajor: 21 },
} as const;
export const engineContractSupported = (version: string | undefined): version is keyof typeof reaEngineProfiles => !!version && Object.hasOwn(reaEngineProfiles, version);
export const ghidraVersion = "12.1.4";
export const jadxVersion = "0.7.1";
export const jadxSha256 = "6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75";
export const wabtVersion = "1.0.42";
// Mirror GhidraReleasePolicy's accepted spelling, including 12.1 and suffixes.
function parseGhidraRelease(value: string) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?([-+].*)?$/.exec(value);
  return match && [match[1], match[2], match[3] ?? "0"].every(n => Number.isSafeInteger(Number(n))) ? match : undefined;
}

/** Read metadata only. Refreshing a card never executes an engine. */
export function installedEngineVersion(id: ReaEngineId, path: string): string | undefined {
  if (!path) return;
  try {
    if (id === "java") {
      const release = readFileSync(join(path, "release"), "utf8");
      return /^(?:JAVA_RUNTIME_VERSION)="([^"\r\n]+)"/m.exec(release)?.[1] ?? /^JAVA_VERSION="([^"\r\n]+)"/m.exec(release)?.[1];
    }
    if (id === "ghidra") {
      const version = /^application\.version\s*=\s*([^\r\n]+)$/m.exec(readFileSync(join(path, "Ghidra", "application.properties"), "utf8"))?.[1].trim();
      return version && parseGhidraRelease(version) ? version : undefined;
    }
    if (id === "hopper") return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]{1,100})<\/string>/.exec(readFileSync(join(dirname(dirname(path)), "Info.plist"), "utf8"))?.[1];
  } catch { /* Missing metadata remains unknown until explicit detection. */ }
}
// Older managed installations already record their version in source.json.
export function managedEngineVersion(record: { directory: string; path: string; version?: string } | undefined) {
  if (!record) return;
  if (record.version) return record.version;
  let directory = record.path;
  for (let depth = 0; depth < 9; depth++, directory = dirname(directory)) {
    if (directory === dirname(directory)) break;
    if (basename(directory) !== record.directory) continue;
    try {
      const source = JSON.parse(readFileSync(join(directory, "source.json"), "utf8"));
      if (typeof source.version === "string" && source.version.length <= 80 && compareEngineVersions(source.version, source.version) === 0) return source.version as string;
    } catch { /* Legacy metadata is optional; explicit checks still verify the engine. */ }
    break;
  }
}
// REA doctor validates bridge classes, not the JAR's release version.
export async function verifiedJadxVersion(path: string, signal: AbortSignal) {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(path, { signal })) {
    size += chunk.length;
    if (size > 800 * 1024 * 1024) return;
    hash.update(chunk);
  }
  return hash.digest("hex") === jadxSha256 ? jadxVersion : undefined;
}
export function engineVersionPolicy(id: ReaEngineId, version: string | undefined, reaVersion: string | undefined): Pick<ReaEngineState, "requirement" | "compatibility" | "recommendedVersion"> {
  if (!engineContractSupported(reaVersion)) return { requirement: `配套版本策略验证于 REA ${engineContractVersion}；当前 ${reaVersion ?? "未安装"} 尚未适配。`, compatibility: "unknown", recommendedVersion: undefined };
  const requirement = ({ java: "推荐 JDK 21 最新修订；JADX 需 17+，Ghidra 12.1.4 需 21+。", ghidra: `接受 12.1.x，推荐 ${ghidraVersion}；需 JDK 21+ 和本机架构 native。`, jadx: `固定兼容版本 ${jadxVersion}（Headless MCP JAR）。`, wabt: `固定兼容版本 ${wabtVersion}。`, hopper: "REA 未限定 Hopper 版本范围；官方版本、许可与实际桥接分别核实。" })[id];
  const recommendedVersion = ({ ghidra: ghidraVersion, jadx: jadxVersion, wabt: wabtVersion } as Partial<Record<ReaEngineId, string>>)[id];
  if (!version || id === "hopper") return { requirement, recommendedVersion, compatibility: "unknown" };
  const ghidra = id === "ghidra" ? parseGhidraRelease(version) : undefined;
  const compatible = id === "java" ? Number(version.split(".")[0]) >= 17 : id === "ghidra" ? !!ghidra && Number(ghidra[1]) === 12 && Number(ghidra[2]) === 1 : version === (id === "jadx" ? jadxVersion : wabtVersion);
  return { requirement, recommendedVersion, compatibility: compatible ? "compatible" : "incompatible" };
}
