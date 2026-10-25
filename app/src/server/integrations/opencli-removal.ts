import { basename } from "node:path";
import { builtinDirectoryRecorded } from "./builtin-operation.js";
import { managedChildren, managedDirectory } from "./managed-removal.js";
import { openCliVersionPaths, openCliVersionPattern, type OpenCliConfig } from "./opencli-runtime.js";

export function openCliRemovalPlan(root: string, config: OpenCliConfig | undefined, pending: string[]) {
  const parents = ["integrations", "opencli", "versions"];
  const children = managedChildren(root, parents.slice(0, -1), "versions", openCliVersionPattern);
  const owned = children.filter(name => builtinDirectoryRecorded(root, "opencli", openCliVersionPaths(root, name).prefix));
  const names = [...new Set([...owned, ...(config?.removalPending ?? []), ...(config?.directory ? [config.directory] : []), ...pending.map(path => basename(path))])].sort();
  const unverified = children.filter(name => !names.includes(name)).map(name => openCliVersionPaths(root, name).prefix);
  for (const name of names) managedDirectory(root, parents, name, openCliVersionPattern);
  return { names, unverified, paths: names.map(name => openCliVersionPaths(root, name).prefix) };
}
