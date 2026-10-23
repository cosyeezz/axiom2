import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readRtkConfig, rtkDirectory } from "./rtk-config.js";

/** Keep the active version, one previous version, and a grace period for concurrent work. */
export function cleanRtkVersions(root: string) {
  const active = readRtkConfig(root).installation?.directory;
  const dir = join(rtkDirectory(root), "versions");
  let names: string[];
  try { names = readdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const unused = names.filter(name => name !== active && /^v\d{1,5}\.\d{1,5}\.\d{1,5}-[a-f0-9-]{36}$/.test(name)).flatMap(name => {
    const path = join(dir, name);
    try { const info = lstatSync(path); return info.isDirectory() ? [{ path, at: info.mtimeMs }] : []; } catch { return []; }
  }).sort((a, b) => b.at - a.at || a.path.localeCompare(b.path));
  for (const version of unused.slice(1)) {
    if (version.at >= Date.now() - 86_400_000) continue;
    // An installer may have switched configuration since the directory scan.
    if (readRtkConfig(root).installation?.directory === version.path.slice(dir.length + 1)) continue;
    rmSync(version.path, { recursive: true, force: true });
  }
}
