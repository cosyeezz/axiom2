import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type ReaDependency = { variable: string; path: string; source: "environment" | "discovered" };
/** Automatic discovery accepts local, fully qualified paths only; explicit REA
 * variables remain operator choices and are not probed or silently replaced. */
export function reaLocalExecutablePath(path: string, platform = process.platform) {
  return !/[\x00-\x1f\x7f]/.test(path) && (platform === "win32" ? /^[a-z]:[\\/]/i.test(path) : posix.isAbsolute(path));
}
/** Discover installed executables only. Never run a shell or install packages. */
export function discoverReaDependencies(source: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()) {
  const { delimiter, isAbsolute, join } = platform === "win32" ? win32 : posix;
  const executable = (path: string) => {
    try {
      if (!reaLocalExecutablePath(path, platform) || !statSync(path).isFile()) return undefined;
      accessSync(path, platform === "win32" ? constants.F_OK : constants.X_OK);
      return realpathSync(path);
    } catch { return undefined; }
  };
  const path = Object.entries(source).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const directories = [...new Set([...path.split(delimiter).filter(path => reaLocalExecutablePath(path, platform)), ...(platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : platform === "linux" ? ["/usr/local/bin", "/usr/bin"] : [])])];
  const candidates: Record<string, string[]> = {
    REA_RIZIN_COMMAND: ["rizin"], REA_ADB_PATH: ["adb"], REA_APKTOOL_COMMAND: ["apktool"],
    REA_TSHARK_COMMAND: ["tshark"], REA_CAPINFOS_COMMAND: ["capinfos"],
    ...(platform === "linux" ? { REA_MITMDUMP_COMMAND: ["mitmdump"], REA_TSHARK_PRLIMIT_COMMAND: ["prlimit"] } : {}),
    REA_BROWSER_EXECUTABLE: platform === "darwin" ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
      join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ] : platform === "win32" ? [
      ...[source.PROGRAMFILES, source["PROGRAMFILES(X86)"], source.LOCALAPPDATA].filter((value): value is string => !!value && reaLocalExecutablePath(value, platform)).map(base => join(base, "Google/Chrome/Application/chrome.exe")),
    ] : ["chromium", "chromium-browser", "google-chrome"],
  };
  const dependencies: ReaDependency[] = [];
  for (const [variable, commands] of Object.entries(candidates)) {
    // An explicit operator choice is never silently replaced, even if invalid.
    if (source[variable] !== undefined) {
      dependencies.push({ variable, path: source[variable]!, source: "environment" }); continue;
    }
    const paths = commands.flatMap(command => isAbsolute(command) ? [command] : directories.map(directory => join(directory, platform === "win32" ? `${command}.exe` : command)));
    const found = paths.map(executable).find(Boolean);
    if (found) dependencies.push({ variable, path: found, source: "discovered" });
  }
  return dependencies;
}
export const reaDependencyEnvironment = (dependencies = discoverReaDependencies()) => Object.fromEntries(dependencies.map(item => [item.variable, item.path]));
