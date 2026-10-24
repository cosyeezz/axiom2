import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, constants, type BigIntStats } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openCliConfigPath, openCliSkillNames, readOpenCliConfig } from "../integrations/opencli-runtime.js";
import { reaConfigPath, reaPackageRoot, reaSkillName, readReaConfig } from "../integrations/rea-runtime.js";

type Resource = { path: string; kind: "missing" | "directory" | "file"; revision?: string };
const revision = (stat?: BigIntStats) => stat
  ? `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : "missing";
const inspect = (path: string) => lstatSync(path, { bigint: true, throwIfNoEntry: false });
type Witness = { value: string; group: boolean };
const witnessValue = (stat: BigIntStats | undefined, group: boolean) => group && stat?.isDirectory()
  ? `${stat.dev}:${stat.ino}:${stat.mode}:${stat.birthtimeNs}` : revision(stat);
async function readVerified(resource: Resource, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const handle = await open(resource.path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 1024 * 1024 || revision(before) !== resource.revision)
      throw Error("Resource changed before opening");
    // One extra byte detects growth without permitting an unbounded readFile allocation.
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    signal?.throwIfAborted();
    if (offset !== Number(before.size) || revision(await handle.stat({ bigint: true })) !== resource.revision)
      throw Error("Resource changed during reading");
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
let activeReads = 0;
const waitingReads: (() => void)[] = [];
function drainReads() { while (activeReads < 8 && waitingReads.length) waitingReads.shift()!(); }
function readResource(resource: Resource, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cancel = () => { const index = waitingReads.indexOf(start); if (index >= 0) waitingReads.splice(index, 1); signal?.removeEventListener('abort', cancel); reject(signal?.reason ?? Error('Resource read cancelled')); };
    const start = () => {
      signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) { reject(signal.reason); return; }
      activeReads++;
      void readVerified(resource, signal).then(resolve, reject).finally(() => { activeReads--; drainReads(); });
    };
    if (signal?.aborted) { reject(signal.reason); return; }
    waitingReads.push(start);signal?.addEventListener('abort', cancel, { once: true });drainReads();
  });
}
// Enumerate only supported resource roots. Each invocation inspects current metadata;
// neither directory entries nor file contents survive into another validation boundary.
function* resources(cwd: string, agentDir: string, witnesses?: Map<string, Witness>): Generator<Resource> {
  const observe = (path: string, group = false) => {
    const stat = inspect(path), previous = witnesses?.get(path);
    if (previous && previous.value !== witnessValue(stat, previous.group)) throw Error("Resource changed during traversal");
    const identityOnly = group && previous?.group !== false;
    witnesses?.set(path, { value: witnessValue(stat, identityOnly), group: identityOnly });
    return stat;
  };
  let remaining = 5000;
  const count = () => { if (--remaining < 0) throw Error("Resource identity exceeds inspection budget"); };
  function* visit(path: string): Generator<Resource> {
    count();
    const stat = observe(path);
    if (!stat) { yield { path, kind: "missing" }; return; }
    if (stat.isSymbolicLink()) throw Error("Linked resource requires cold binding");
    if (stat.isDirectory()) {
      yield { path, kind: "directory" };
      for (const name of readdirSync(path).sort()) {
        if (!["node_modules", ".git"].includes(name)) yield* visit(join(path, name));
      }
    } else if (stat.isFile()) {
      if (stat.size > 1024 * 1024) throw Error("Resource content exceeds inspection budget");
      yield { path, kind: "file", revision: revision(stat) };
    } else throw Error("Unsupported resource type");
  }
  const names = ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md", "extensions", "skills", "prompts"];
  function* group(directory: string): Generator<Resource> {
    // Only these six children are resources. Unrelated entries (for example SDK
    // settings lock files) may change the parent timestamp without invalidating them.
    const stat = observe(directory, true);
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
  if (opencli && !opencli.detached) {
    yield* visit(join(opencli.packageRoot, "package.json"));
    for (const name of openCliSkillNames) yield* visit(join(opencli.packageRoot, "skills", name, "SKILL.md"));
  }
  yield* visit(reaConfigPath(root));
  const rea = readReaConfig(root), packageRoot = reaPackageRoot(root, rea);
  if (packageRoot) {
    yield* visit(join(packageRoot, "package.json"));
    if (rea.mcpInstalled !== false) {
      yield* visit(join(packageRoot, "scripts", "rea.mjs"));
      yield* visit(join(packageRoot, "dist", "mcp", "main.js"));
    }
    if (rea.skillInstalled !== false) yield* visit(join(packageRoot, "skills", reaSkillName));
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
  const hash = createHash("sha256"), witnesses = new Map<string, Witness>();
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
    for (const resource of resources(cwd, agentDir, witnesses)) {
      signal?.throwIfAborted();
      const read = resource.kind === "file" ? readResource(resource, signal).then(bytes => ({ bytes }), error => ({ error })) : undefined;
      pending.push({ resource, read });
      if (read && ++reads === 8) await flush();
    }
    await flush();
    signal?.throwIfAborted();
    // No await in this final sweep: same-process callbacks cannot change earlier
    // resources while later evidence is checked. This is not an atomic FS snapshot.
    for (const [path, expected] of witnesses) {
      if (witnessValue(inspect(path), expected.group) !== expected.value) throw Error("Resource changed during asynchronous inspection");
    }
    return hash.digest("hex");
  } finally {
    // A traversal error must not leave unobserved I/O failures or reads running after settlement.
    if (pending.some(item => item.read)) await Promise.all(pending.map(item => item.read));
  }
}
