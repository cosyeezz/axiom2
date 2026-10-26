import { basename } from "node:path";
import { managedChildren, managedDirectory } from "./managed-removal.js";
import { openCliVersionPaths, openCliVersionPattern, type OpenCliConfig } from "./opencli-runtime.js";

export function openCliRemovalPlan(root: string, config: OpenCliConfig | undefined, pending: string[]) {
  const parents = ["integrations", "opencli", "versions"];
  const names = [...new Set([...managedChildren(root, parents.slice(0, -1), "versions", openCliVersionPattern), ...(config?.removalPending ?? []), ...(config?.directory ? [config.directory] : []), ...pending.map(path => basename(path))])].sort();
  for (const name of names) managedDirectory(root, parents, name, openCliVersionPattern);
  return { names, paths: names.map(name => openCliVersionPaths(root, name).prefix) };
}
