import { randomUUID } from "node:crypto";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

export const ffmpegDirectory = (root: string) => join(root, "integrations", "ffmpeg");
export const ffmpegConfigPath = (root: string) => join(ffmpegDirectory(root), "config.json");
// Keep legacy bindings readable until an explicit install migrates them.
export const ffmpegVersionPattern = /^(?:b\d{1,5}\.\d{1,5}\.\d{1,5}|n\d{1,5}\.\d{1,5}\.\d{1,5}-\d{1,5})$/;
export const ffmpegDirectoryPattern = /^(?:b\d{1,5}\.\d{1,5}\.\d{1,5}|n\d{1,5}\.\d{1,5}\.\d{1,5}-\d{1,5})-[a-f0-9-]{36}$/;
export const ffmpegGuardDirectory = (root: string) => join(root, "cache", "ffmpeg-unavailable");
export const ffmpegContainerPaths = (root: string) => [root, join(root, "integrations"), ffmpegDirectory(root), join(ffmpegDirectory(root), "versions"), join(ffmpegDirectory(root), "environment"), ...["config", "cache", "data", "state", "tmp"].map(name => join(ffmpegDirectory(root), "environment", name))];
/** Snapshot directory identities across asynchronous work; never clean a replacement path. */
export function captureFfmpegPaths(paths: string[]) {
  const entries = paths.map(path => ({ path, info: lstatSync(path) }));
  const check = () => {
    for (const { path, info } of entries) {
      const current = lstatSync(path);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino) throw Error("FFmpeg 托管目录身份已变化，停止写入及清理替换路径。");
    }
  };
  check(); return check;
}
export type FfmpegInstallation = { directory: string; version: string; platform: string; arch: string };
export type FfmpegConfig = { format: 1; revision: string; installation?: FfmpegInstallation };
export function assertFfmpegContainer(root: string) {
  for (const path of ffmpegContainerPaths(root)) {
    try { const info = lstatSync(path); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("FFmpeg 托管目录无效或已被符号链接替换。"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
export function readFfmpegConfig(root: string): FfmpegConfig {
  assertFfmpegContainer(root);
  let value: FfmpegConfig;
  try { value = JSON.parse(readFileSync(ffmpegConfigPath(root), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { format: 1, revision: "" };
    throw Error("FFmpeg 配置无法读取，未覆盖原配置。");
  }
  const item = value?.installation;
  if (value?.format !== 1 || typeof value.revision !== "string" || item &&
    (!ffmpegVersionPattern.test(item.version) || !ffmpegDirectoryPattern.test(item.directory) || !item.directory.startsWith(item.version + "-") ||
      typeof item.platform !== "string" || typeof item.arch !== "string")) throw Error("FFmpeg 配置无效，未覆盖原配置。");
  return value;
}
export function saveFfmpegConfig(root: string, installation?: FfmpegInstallation) {
  assertFfmpegContainer(root);
  const path = ffmpegConfigPath(root), temp = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(temp, JSON.stringify({ format: 1, revision: randomUUID(), ...(installation ? { installation } : {}) }, null, 2) + "\n", { flag: "wx", mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
export function ffmpegBinDirectory(root: string, installation: FfmpegInstallation) {
  if (!ffmpegDirectoryPattern.test(installation.directory)) throw Error("FFmpeg 安装目录无效。");
  return join(ffmpegDirectory(root), "versions", installation.directory);
}
export function ffmpegBinary(directory: string, program: "ffmpeg" | "ffprobe") {
  return join(directory, program + (process.platform === "win32" ? ".exe" : ""));
}
/** Resolve only explicitly installed managed files. Never silently fall back when a binding is broken. */
export function inspectFfmpeg(root: string, installation: FfmpegInstallation) {
  if (installation.platform !== process.platform || installation.arch !== process.arch) throw Error("FFmpeg 安装与当前平台不匹配，请重新安装。");
  const directory = ffmpegBinDirectory(root, installation);
  let current = realpathSync(root);
  for (const part of ["integrations", "ffmpeg", "versions", installation.directory]) {
    current = join(current, part);
    if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) throw Error("FFmpeg 安装目录不能是符号链接。");
  }
  if (resolve(realpathSync(directory)) !== resolve(current)) throw Error("FFmpeg 安装路径已变化。");
  for (const program of ["ffmpeg", "ffprobe"] as const) {
    const path = ffmpegBinary(directory, program), info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error("FFmpeg 程序文件无效。");
    accessSync(path, process.platform === "win32" ? constants.R_OK : constants.X_OK);
  }
  return directory;
}
function unavailableFfmpegCommands(root: string) {
  const directory = ffmpegGuardDirectory(root);
  for (const path of [root, join(root, "cache"), directory]) {
    try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error("FFmpeg 诊断命令目录无效。");
  }
  const check = captureFfmpegPaths([root, join(root, "cache"), directory]);
  const message = "Axiom FFmpeg installation is unavailable. Repair it in Builtin Tools.";
  for (const program of ["ffmpeg", "ffprobe"]) {
    const path = join(directory, program + (process.platform === "win32" ? ".cmd" : ""));
    const content = process.platform === "win32" ? `@echo off\r\necho ${message} 1>&2\r\nexit /b 1\r\n` : `#!/bin/sh\nprintf '%s\\n' '${message}' >&2\nexit 1\n`;
    check();
    try { writeFileSync(path, content, { flag: "wx", mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || readFileSync(path, "utf8") !== content) throw Error("FFmpeg 诊断命令文件无效。");
  }
  check(); return directory;
}
/** Per-command PATH only. A broken optional media binding must not block ordinary commands. */
export function ffmpegEnvironment(root: string, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source }; let directory: string;
  delete env.AXIOM_FFMPEG_ERROR;
  try {
    const installation = readFfmpegConfig(root).installation;
    if (!installation) return env;
    directory = inspectFfmpeg(root, installation);
  } catch {
    env.AXIOM_FFMPEG_ERROR = "Axiom FFmpeg installation is unavailable. Repair it in Builtin Tools.";
    // Only these two commands fail, not echo/git/python/etc. Cache is dedicated and removable.
    try { directory = unavailableFfmpegCommands(root); }
    catch { return env; } // Even unwritable diagnostic storage cannot disable the shell.
  }
  const previous = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = [directory, previous].filter(Boolean).join(delimiter);
  return env;
}
