import { chmodSync, constants, copyFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nodeRuntimePaths, recordNodeRuntime, type ManagedNodeProvider, type NodeRuntimeBinding } from "../../src/server/integrations/managed-node.js";
import { prepareComponentEnvironment } from "../../src/server/integrations/component-environment.js";

/** Offline executable fixture, not evidence about real upstream engines. */
export function managedNodeFixture(latest: () => string): ManagedNodeProvider {
  return {
    async latest(_name, signal) { signal.throwIfAborted(); return latest(); },
    async prepare(_tool, prefix, _name, _version, signal) {
      signal.throwIfAborted();
      const binding: NodeRuntimeBinding = { nodeVersion: process.versions.node, npmVersion: "11.0.0", engines: ">=22.19.0", platform: process.platform, arch: process.arch, sha256: "a".repeat(64) };
      const { node, npm } = nodeRuntimePaths(prefix, binding);
      mkdirSync(dirname(node), { recursive: true }); mkdirSync(dirname(npm), { recursive: true });
      copyFileSync(realpathSync(process.execPath), node, constants.COPYFILE_FICLONE); chmodSync(node, 0o700);
      writeFileSync(npm, "console.log('11.0.0');\n");
      prepareComponentEnvironment(join(prefix, "environment"));
      return recordNodeRuntime(prefix, binding);
    },
  };
}
