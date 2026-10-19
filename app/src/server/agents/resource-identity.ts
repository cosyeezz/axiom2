import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openCliConfigPath, openCliSkillNames, readOpenCliConfig } from "../integrations/opencli-runtime.js";

type Resource = { path: string; kind: "missing" | "directory" | "file" };
let activeReads = 0;
const waitingReads: (() => void)[] = [];
function drainReads() { while (activeReads < 8 && waitingReads.length) waitingReads.shift()!(); }
function readResource(path: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const delayed = activeReads >= 8 || waitingReads.length > 0;
    const cancel = () => { const index = waitingReads.indexOf(start); if (index >= 0) waitingReads.splice(index, 1); signal?.removeEventListener('abort', cancel); reject(signal?.reason ?? Error('Resource read cancelled')); };
    const start = () => {
      signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) { reject(signal.reason); return; }
      if (delayed) {
        try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) throw Error('Resource changed while waiting for read capacity'); }
        catch (error) { reject(error); return; }
      }
      activeReads++;
      void readFile(path, { signal }).then(resolve, reject).finally(() => { activeReads--; drainReads(); });
    };
    if (signal?.aborted) { reject(signal.reason); return; }
    waitingReads.push(start);signal?.addEventListener('abort', cancel, { once: true });drainReads();
  });
}
// Enumerate only supported resource roots. Each invocation inspects current metadata;
// neither directory entries nor file contents survive into another validation boundary.
function* resources(cwd: string, agentDir: string): Generator<Resource> {
  let remaining = 5000;
  const count = () => { if (--remaining < 0) throw Error("Resource identity exceeds inspection budget"); };
  function* visit(path: string): Generator<Resource> {
    count();
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) { yield { path, kind: "missing" }; return; }
    if (stat.isSymbolicLink()) throw Error("Linked resource requires cold binding");
    if (stat.isDirectory()) {
      yield { path, kind: "directory" };
      for (const name of readdirSync(path).sort()) {
        if (!["node_modules", ".git"].includes(name)) yield* visit(join(path, name));
      }
    } else if (stat.isFile()) {
      if (stat.size > 1024 * 1024) throw Error("Resource content exceeds inspection budget");
      yield { path, kind: "file" };
    } else throw Error("Unsupported resource type");
  }
  const names = ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md", "extensions", "skills", "prompts"];
  function* group(directory: string): Generator<Resource> {
    const stat = lstatSync(directory, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw Error("Linked resource requires cold binding");
    if (!stat) {
      // A missing parent proves all six children absent at this boundary.
      for (const name of names) { count(); yield { path: join(directory, name), kind: "missing" }; }
      return;
    }
    for (const name of names) yield* visit(join(directory, name));
  }
  const root = dirname(agentDir);
  yield* visit(openCliConfigPath(root));
  const opencli = readOpenCliConfig(root);
  if (opencli) {
    yield* visit(join(opencli.packageRoot, "package.json"));
    for (const name of openCliSkillNames) yield* visit(join(opencli.packageRoot, "skills", name, "SKILL.md"));
  }
  yield* group(agentDir);
  for (let dir = cwd; ; dir = dirname(dir)) {
    yield* visit(join(dir, "AGENTS.md"));
    yield* group(join(dir, ".pi"));
    if (dirname(dir) === dir) break;
  }
}

export function resourceIdentity(cwd: string, agentDir: string) {
  const hash = createHash("sha256");
  for (const resource of resources(cwd, agentDir)) {
    hash.update(resource.path).update(resource.kind);
    if (resource.kind === "file") hash.update(readFileSync(resource.path));
  }
  return hash.digest("hex");
}

/** Same ordered byte digest, with eight reads per batch and eight in flight across all scans. */
export async function resourceIdentityAsync(cwd: string, agentDir: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  type ReadResult = { bytes: Buffer; error?: never } | { error: unknown; bytes?: never };
  let pending: { resource: Resource; read?: Promise<ReadResult> }[] = [], reads = 0;
  const flush = async () => {
    const results = await Promise.all(pending.map(item => item.read));
    for (let index = 0; index < pending.length; index++) {
      const { resource } = pending[index], result = results[index];
      hash.update(resource.path).update(resource.kind);
      if (result) { if ("error" in result) throw result.error; hash.update(result.bytes); }
    }
    pending = []; reads = 0;
  };
  try {
    for (const resource of resources(cwd, agentDir)) {
      signal?.throwIfAborted();
      const read = resource.kind === "file" ? readResource(resource.path, signal).then(bytes => ({ bytes }), error => ({ error })) : undefined;
      pending.push({ resource, read });
      if (read && ++reads === 8) await flush();
    }
    await flush();
    return hash.digest("hex");
  } finally {
    // A traversal error must not leave unobserved I/O failures or reads running after settlement.
    await Promise.all(pending.map(item => item.read));
  }
}
