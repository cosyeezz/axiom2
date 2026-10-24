import { assertToolProcessesStopped } from "./tool-process.js";
import { lstatSync } from "node:fs";
import { readRtkConfig, rtkDirectoryPattern } from "./rtk-config.js";
import { managedChildren, managedDirectory, removeManagedDirectory } from "./managed-removal.js";

/** Keep the active version, one previous version, and a grace period for concurrent work. */
export function cleanRtkVersions(root: string, dryRun = false) {
  const active = readRtkConfig(root).installation?.directory;
  const parents = ["integrations", "rtk", "versions"];
  // Validate the whole parent chain before scanning or deleting any candidate.
  const names = managedChildren(root, parents.slice(0, -1), "versions", rtkDirectoryPattern);
  const unused = names.filter(name => name !== active).flatMap(name => {
    const path = managedDirectory(root, parents, name, rtkDirectoryPattern);
    return path ? [{ name, at: lstatSync(path).mtimeMs }] : [];
  }).sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
  for (const version of unused.slice(1)) {
    if (version.at >= Date.now() - 86_400_000) continue;
    // An installer may have switched configuration since the directory scan.
    if (readRtkConfig(root).installation?.directory === version.name) continue;
    if (dryRun) return true;
    assertToolProcessesStopped(root);
    removeManagedDirectory(root, parents, version.name, rtkDirectoryPattern);
  }
  return false;
}
