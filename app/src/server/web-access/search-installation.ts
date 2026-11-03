import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readOpenCliConfig, openCliPrefix, openCliSkillNames, type OpenCliConfig } from "../integrations/opencli-runtime.js";
import { nodeRuntimePaths, runtimeReceipt } from "../integrations/managed-node.js";
import { searchOpenCliInvocation, type OpenCliInvocation } from "./opencli-command.js";
import { SearchError } from "./search-errors.js";

interface WatchedPath { path: string; contents: boolean }
interface Installation { identity: string; generation: number; invocation: OpenCliInvocation; paths: WatchedPath[]; stamp: string }

// Watch lexical AND resolved ancestor chains: changing a symlink, directory or mode
// must not preserve a successful package/runtime validation. This is identity, not a signature.
function installationPaths(config: OpenCliConfig): WatchedPath[] {
  const paths = new Map<string, boolean>();
  const add = (file: string) => {
    for (const first of [resolve(file), realpathSync(file)]) {
      for (let path = first; ; path = dirname(path)) {
        if (!paths.has(path)) paths.set(path, false);
        if (dirname(path) === path) break;
      }
    }
  };
  const pkg = JSON.parse(readFileSync(join(config.packageRoot, "package.json"), "utf8"));
  add(join(config.packageRoot, "package.json"));
  add(resolve(config.packageRoot, pkg.bin.opencli));
  for (const name of openCliSkillNames) add(join(config.packageRoot, "skills", name, "SKILL.md"));
  add(join(config.binDirectory, process.platform === "win32" ? "opencli.cmd" : "opencli"));
  if (config.directory && process.platform === "win32") add(join(config.binDirectory, "opencli.ps1"));
  if (config.runtime) {
    const prefix = openCliPrefix(config), runtime = nodeRuntimePaths(prefix, config.runtime);
    add(runtimeReceipt(prefix)); add(runtime.node); add(runtime.npm);
    for (const name of process.platform === "win32" ? ["opencli.cjs", "opencli.cmd", "opencli.ps1"] : ["opencli.cjs", "opencli"])
      add(join(prefix, "commands", name));
    // Preserve inspectNodeRuntime's whole-npm-tree change detection. Cache hits
    // still stat these paths; directory stamps detect additions/removals as well.
    let remaining = 15_000;
    const visit = (path: string, depth: number) => {
      if (--remaining < 0 || depth > 64) throw Error("Runtime tree exceeds its bounds");
      const stat = lstatSync(path);
      if (!stat.isDirectory() && !stat.isFile()) throw Error("Unexpected runtime link or file");
      paths.set(path, true);
      if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), depth + 1);
    };
    visit(dirname(dirname(runtime.npm)), 0);
  } else add(process.execPath);
  return [...paths].sort(([a], [b]) => a.localeCompare(b)).map(([path, contents]) => ({ path, contents }));
}
function stamp(paths: WatchedPath[]) {
  return JSON.stringify(paths.map(({ path, contents }) => {
    const stat = lstatSync(path, { bigint: true });
    // Unrelated sibling writes do not invalidate ancestor directories. npm tree
    // directories include timestamps so added/removed descendants are detected.
    const fields = stat.isDirectory() && !contents ? [stat.dev, stat.ino, stat.mode] : [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs];
    return [path, realpathSync(path), ...fields.map(String)];
  }));
}

/** Instance-scoped successful validation cache; no global executable fallback. */
export class SearchInstallationCache {
  private cached?: Installation;
  private generation = 0;
  constructor(private root: string, private validate = searchOpenCliInvocation) {}
  clear() { this.cached = undefined; }
  get(): { generation: number; invocation: OpenCliInvocation } {
    try {
      // Small configuration read remains intentional: edits without a revision bump,
      // disable and detach must take effect at the next query, including a resume.
      const config = readOpenCliConfig(this.root);
      if (!config?.enabled || config.detached) throw Error("OpenCLI disabled");
      const identity = JSON.stringify(config);
      if (this.cached?.identity === identity && stamp(this.cached.paths) === this.cached.stamp) return this.cached;
      this.clear();
      const paths = installationPaths(config), before = stamp(paths);
      const invocation = this.validate(this.root);
      if (JSON.stringify(readOpenCliConfig(this.root)) !== identity || stamp(paths) !== before)
        throw Error("OpenCLI changed during validation");
      this.cached = { identity, generation: ++this.generation, invocation, paths, stamp: before };
      // A new generation also invalidates profiles after an in-place update.
      return this.cached;
    } catch {
      this.clear();
      throw new SearchError("OPENCLI_UNAVAILABLE", "Enable and check the configured OpenCLI component before searching. No alternate browser or executable was used.", true);
    }
  }
}
