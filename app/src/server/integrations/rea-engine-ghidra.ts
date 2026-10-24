import { accessSync, constants, lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { delimiter, join, relative, isAbsolute, sep } from "node:path";
import { extractEngineArchive } from "./rea-engine-archive.js";
import { downloadEngineFile, smallText, type EngineFetch } from "./rea-engine-install.js";
import { discoverEnginePaths, engineEnvironment, engineHost, type EngineHost } from "./rea-engines.js";
import { maintenancePhase } from "../maintenance.js";
import { runEngine, type EngineRun } from "./rea-engine-process.js";
import { readReaConfig } from "./rea-runtime.js";

export async function ghidraBuildEnvironment(root: string, signal: AbortSignal, run: EngineRun = runEngine, host = engineHost()) {
  const paths = discoverEnginePaths(readReaConfig(root).engines);
  if (!paths.java) throw Error("安装 Ghidra 需要 JDK 21，请先安装上方的 JDK 21。");
  const env: NodeJS.ProcessEnv = { ...engineEnvironment(paths), PATH: [join(paths.java, "bin"), process.env.PATH].filter(Boolean).join(delimiter) };
  const java = join(paths.java, "bin", "java");
  const version = await run(java, ["-XshowSettings:properties", "-version"], { cwd: root, env, signal });
  const properties = version.stdout + version.stderr;
  const modules = await run(java, ["--list-modules"], { cwd: root, env, signal });
  if (version.code || modules.code || Number(/java\.version\s*=\s*(\d+)/.exec(properties)?.[1] ?? 0) < 21 || !/sun\.arch\.data\.model\s*=\s*64\b/.test(properties) || !/^jdk.compiler@/m.test(modules.stdout))
    throw Error("安装 Ghidra 需要完整的 64 位 JDK 21+，请先检查或安装上方的 JDK 21。");
  const architecture = /os\.arch\s*=\s*(\S+)/.exec(properties)?.[1];
  if (!(host.arch === "arm64" ? ["aarch64", "arm64"] : ["amd64", "x86_64"]).includes(architecture ?? "")) throw Error("JDK 的 CPU 架构与后台 Mac 不匹配，请安装与后台架构一致的 JDK 21。");
  for (const args of [["--find", "clang"], ["--find", "clang++"], ["--show-sdk-path"]]) {
    const result = await run("/usr/bin/xcrun", args, { cwd: root, signal });
    if (result.code || !result.stdout.trim()) throw Error("安装 Ghidra 需要 Xcode Command Line Tools；请在后台 Mac 的终端运行 xcode-select --install，完成后重试安装。已有安装包会保留。");
  }
  return env;
}

/** Use the verified release's Gradle version, with an independently verified distribution. */
export async function buildGhidraNatives(root: string, home: string, directory: string, host: EngineHost, env: NodeJS.ProcessEnv, signal: AbortSignal, notify: (text: string) => void, fetcher: EngineFetch, run: EngineRun = runEngine) {
  const project = join(home, "support", "gradle");
  const properties = readFileSync(join(project, "gradle-wrapper.properties"), "utf8");
  const url = /^distributionUrl\s*=\s*(.+)\s*$/m.exec(properties)?.[1].trim().replaceAll("\\:", ":");
  const match = url && /^https:\/\/services\.gradle\.org\/distributions\/gradle-(\d+\.\d+(?:\.\d+)?)-bin\.zip$/.exec(url);
  if (!match) throw Error("Ghidra 随包 Gradle 发行地址无效，未运行构建。");
  const version = match[1], bundled = /^distributionSha256Sum\s*=\s*([a-f0-9]{64})\s*$/m.exec(properties)?.[1];
  const checksum = bundled ?? (await smallText(`${url}.sha256`, signal, fetcher)).trim();
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw Error("Gradle 官方 SHA-256 校验值无效，未运行构建。");
  const tools = join(directory, "build-tools"), archive = join(directory, "gradle.zip");
  await mkdir(tools);
  notify(`正在准备 Ghidra 构建工具 Gradle ${version}…`);
  await downloadEngineFile({ url: url!, version, sha256: checksum, format: "zip" }, archive, signal, fetcher);
  await extractEngineArchive(archive, tools, "zip", signal);
  await rm(archive);
  const entries = await readdir(tools, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== `gradle-${version}` || !entries[0].isDirectory()) throw Error("Gradle 压缩包布局无效。");
  const gradle = join(tools, entries[0].name, "bin", "gradle");
  if (!lstatSync(gradle).isFile()) throw Error("Gradle 启动文件无效。");
  maintenancePhase("installing");
  notify("正在构建 Ghidra 本机组件，可能需要几分钟…");
  const result = await run("/bin/sh", [gradle, "--project-dir", project, "--no-daemon", "--offline", "--console=plain", "buildNatives"], {
    cwd: root, signal, timeout: 600_000,
    env: { ...env, GRADLE_USER_HOME: join(directory, "gradle-home"), GRADLE_OPTS: "", JAVA_OPTS: "", JAVA_TOOL_OPTIONS: "", _JAVA_OPTIONS: "", JDK_JAVA_OPTIONS: "" },
  });
  if (result.code) throw Error(`Ghidra 原生组件构建失败：${(result.stderr || result.stdout).slice(-3000)}`);
  const platform = host.arch === "arm64" ? "mac_arm_64" : "mac_x86_64";
  for (const [module, executable] of [["Ghidra/Features/Decompiler", "decompile"], ["Ghidra/Features/Decompiler", "sleigh"], ["Ghidra/Features/FileFormats", "lzfse"], ["GPL/DemanglerGnu", "demangler_gnu_v2_24"], ["GPL/DemanglerGnu", "demangler_gnu_v2_41"]]) {
    const binary = [join(home, module, "build", "os", platform, executable), join(home, module, "os", platform, executable)].find(path => {
      try { const file = lstatSync(path); return file.isFile() && file.size > 0; } catch { return false; }
    });
    if (!binary) throw Error(`Ghidra 构建未生成本机组件 ${executable}。`);
    const suffix = relative(home, realpathSync(binary));
    if (isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) throw Error("Ghidra 构建产物超出安装目录。");
    accessSync(binary, constants.X_OK);
    const architecture = await run("/usr/bin/lipo", ["-verify_arch", host.arch === "arm64" ? "arm64" : "x86_64", binary], { cwd: root, signal });
    if (architecture.code) throw Error(`Ghidra 本机组件 ${executable} 不匹配后台 Mac 的 CPU 架构。`);
  }
}
