import { AsyncLocalStorage } from "node:async_hooks";
import { isReaEngineId, reaEngineIds, type ReaEngineId } from "../../shared/rea-engines.js";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { lockResourcePaths } from "../resource-file-lock.js";
import { processOwnerFingerprint, stopRecordedProcessOwner } from "../process-owner-record.js";
import { currentMaintenance } from "../maintenance.js";
import { MaintenanceError, type MaintenanceTask } from "../../shared/maintenance.js";
import { runTool, type ToolRunOptions } from "./tool-process.js";

type Tool = "opencli" | "rea";
type Entry = { path: string; ownerId: string; fingerprint?: string; state: "registered" | "cleaned" };
type Identity = { dev: string; ino: string };
type Record = { format: 1; id: string; tool: Tool; scope?: ReaEngineId; root: string; rootIdentity: Identity; controlIdentity: Identity; state: "active" | "complete" | "interrupted"; commands: Entry[]; task?: MaintenanceTask; directories: { path: string; dev: string; ino: string }[]; removals?: string[] };
const contexts = new AsyncLocalStorage<ReturnType<typeof beginBuiltinOperation>>();
const reaWriters = new Map<string, { users: number; release: () => void }>();
// Tasks share one maintenance journal in the backend. Components may overlap
// within that writer; a second backend must not overwrite its task history.
function acquireReaWriter(root: string, tool: Tool) {
  if (tool !== "rea") return () => {};
  let writer = reaWriters.get(root);
  if (!writer) {
    writer = { users: 0, release: lockResourcePaths([join(controlDirectory(root, tool), "writer")]) };
    reaWriters.set(root, writer);
  }
  writer.users++;
  return () => { if (--writer.users === 0) { reaWriters.delete(root); writer.release(); } };
}
const unknown = () => new MaintenanceError("stop-unconfirmed", "安装进程退出尚未确认或父提交尚未完成，已保留文件与记录。请核实内置工具任务后重试。");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function identity(path: string): Identity {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink()) throw unknown();
  return { dev: String(stat.dev), ino: String(stat.ino) };
}
const matches = (a: Identity, b: Identity) => a?.dev === b?.dev && a?.ino === b?.ino;
function read(path: string, maximum = 1024 * 1024) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw unknown();
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
    if (!stat.isFile() || named.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(maximum) || stat.dev !== named.dev || stat.ino !== named.ino) throw unknown();
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function durable(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
    if (process.platform !== "win32") {
      const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally { rmSync(temp, { force: true }); }
}
function sameOwner(entry: Entry, optional = false) {
  try { if (read(entry.path).id !== entry.ownerId) throw unknown(); return true; }
  catch (error) { if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
// The OS lock is held throughout validation, configuration publication and both
// terminal records. An available lock never proves a registered child is gone.
function controlDirectory(root: string, tool: Tool, scope?: ReaEngineId) {
  if (scope !== undefined && (tool !== "rea" || !isReaEngineId(scope))) throw unknown();
  return join(root, "integrations", ".maintenance", tool, ...(scope ? ["engines", scope] : []));
}
export function builtinPendingOperation(_root: string, _tool: Tool, _scope?: ReaEngineId): string | undefined {
  // Component standard: interrupted operations are not reported or blocking.
  return undefined;
}
function managedPath(root: string, tool: Tool, path: unknown, scope?: ReaEngineId): path is string {
  if (typeof path !== "string") return false;
  const parent = dirname(path), name = basename(path);
  if (scope && !name.startsWith(`${scope}-`)) return false;
  return parent === join(root, "integrations", tool, "versions") && /^v\d+\.\d+\.\d+-[a-f0-9-]{36}$/.test(name)
    || tool === "rea" && (parent === join(root, "integrations", "rea", "engines") && /^(java|ghidra|jadx|wabt)-[a-f0-9-]{36}$/.test(name)
      || parent === join(root, "integrations", "rea", "downloads") && /^(ghidra|hopper)-[a-f0-9-]{36}$/.test(name));
}
// This read only exposes a cleanup affordance; deletion still requires the
// locked operation's original identities, including originally absent paths.
export function builtinPendingRemovals(root: string, tool: Tool, scope?: ReaEngineId): string[] {
  root = realpathSync(root);
  let record: Record;
  try { record = read(join(controlDirectory(root, tool, scope), "current.json")); }
  catch { return []; }
  if (record.format !== 1 || record.root !== root || record.tool !== tool || record.scope !== scope || !Array.isArray(record.removals)) return [];
  return record.removals.filter(path => managedPath(root, tool, path, scope));
}
/** Planning only: absence of an inode proof must preserve an orphan, not turn
 * the entire uninstall into a permanently unknown operation. Deletion still
 * rechecks ownership under the operation's locks. */
export function builtinDirectoryRecorded(root: string, tool: Tool, path: string): boolean {
  try {
    root = realpathSync(root);
    const directory = controlDirectory(root, tool), record: Record = read(join(directory, "current.json"));
    if (record.format !== 1 || !uuid(record.id) || record.root !== root || record.tool !== tool || record.scope !== undefined ||
        !["active", "complete", "interrupted"].includes(record.state) || !Array.isArray(record.directories) ||
        realpathSync(directory) !== directory || !matches(record.rootIdentity, identity(root)) || !matches(record.controlIdentity, identity(directory)) || !managedPath(root, tool, path)) return false;
    const proof = record.directories.find(item => item?.path === path), stat = lstatSync(path);
    return !!proof && stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(path) === path && matches(proof, identity(path));
  } catch { return false; }
}
/** Read-only affordance check. Never imports or creates directory ownership. */
export function inspectBuiltinDirectoryOwnership(root: string, tool: Tool, path: string) {
  const unavailable = () => Error("下载目录缺少有效的原始维护归属证明或任务尚未结束，已保留文件；请先核实维护记录，不会自动重新登记目录。");
  root = realpathSync(root);
  if (!managedPath(root, tool, path)) throw unavailable();
  const named = lstatSync(path, { bigint: true });
  if (!named.isDirectory() || named.isSymbolicLink() || realpathSync(path) !== path) throw unavailable();
  const engine = tool === "rea" && dirname(path) === join(root, "integrations", "rea", "downloads") ? basename(path).split("-")[0] : undefined;
  let owned = false;
  for (const scope of [undefined, ...(isReaEngineId(engine) ? [engine] : [])]) {
    const directory = controlDirectory(root, tool, scope);
    let record: Record;
    try { record = read(join(directory, "current.json")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw unavailable(); }
    if (record.format !== 1 || !uuid(record.id) || record.root !== root || record.tool !== tool || record.scope !== scope || record.state !== "complete" ||
        !Array.isArray(record.directories) || realpathSync(directory) !== directory || !matches(record.rootIdentity, identity(root)) || !matches(record.controlIdentity, identity(directory))) throw unavailable();
    const proof = record.directories.find(item => item?.path === path);
    if (proof) {
      if (!matches(proof, { dev: String(named.dev), ino: String(named.ino) })) throw unavailable();
      owned = true;
    }
  }
  if (!owned) throw unavailable();
}
export function reconcileBuiltinOperation(root: string, tool: Tool, operationId: unknown, scope?: ReaEngineId) {
  if (!uuid(operationId)) throw unknown();
  const operation = beginBuiltinOperation(root, tool, operationId, scope);
  try { operation.finish(); } finally { operation.close(); }
}
export async function reconcileBuiltinOperationStopping(root: string, tool: Tool, operationId: unknown, scope?: ReaEngineId) {
  try { reconcileBuiltinOperation(root, tool, operationId, scope); return; }
  catch (error) { if (!(error instanceof MaintenanceError) || error.code !== "stop-unconfirmed") throw error; }
  if (!uuid(operationId)) throw unknown();
  root = realpathSync(root);
  const directory = controlDirectory(root, tool, scope), path = join(directory, "current.json");
  const admit = lockResourcePaths([join(controlDirectory(root, tool), "admission")]);
  let release = () => {}, writer = () => {};
  try {
    writer = acquireReaWriter(root, tool);
    // Do not force a tree while any related parent can still commit.
    release = lockResourcePaths([undefined, ...(tool === "rea" ? reaEngineIds : [])].map(item => join(controlDirectory(root, tool, item), "parent")));
    const record: Record = read(path), original = JSON.stringify(record), named = identity(path);
    const validate = () => {
      if (!matches(identity(path), named) || JSON.stringify(read(path)) !== original || realpathSync(directory) !== directory ||
          record.format !== 1 || record.id !== operationId || record.root !== root || record.tool !== tool || record.scope !== scope ||
          !["active", "interrupted"].includes(record.state) || !matches(record.rootIdentity, identity(root)) || !matches(record.controlIdentity, identity(directory)) ||
          !Array.isArray(record.commands) || !Array.isArray(record.directories)) throw unknown();
      for (const item of record.directories) {
        if (!managedPath(root, tool, item?.path, scope)) throw unknown();
        try { if (realpathSync(item.path) !== item.path || !matches(item, identity(item.path))) throw unknown(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      for (const entry of record.commands) {
        if (dirname(entry.path) !== directory || !/^\.axiom-command-[a-f0-9-]{36}\.json$/.test(basename(entry.path)) || !uuid(entry.ownerId) || !["registered", "cleaned"].includes(entry.state)) throw unknown();
        sameOwner(entry, entry.state === "cleaned");
      }
      for (const name of readdirSync(directory)) if (/^\.axiom-command-.*\.json$/.test(name) && !record.commands.some(entry => entry.path === join(directory, name))) throw unknown();
    };
    validate();
    // No directory/configuration changes here. Receipts are written only after
    // TERM -> KILL -> full tree verification, bound to the saved owner digest.
    for (const entry of record.commands) if (entry.state !== "cleaned") {
      validate(); await stopRecordedProcessOwner(entry.path, entry.ownerId, entry.fingerprint);
    }
    validate();
  } finally { release(); writer(); admit(); }
  reconcileBuiltinOperation(root, tool, operationId, scope);
}
export async function recoverBuiltinOperations(root: string, tool: Tool, scope?: ReaEngineId) {
  // A fresh user request verifies interrupted work; it never replays it. The
  // primitive begin() stays strict so non-service callers cannot bypass this.
  for (const pendingScope of tool === "rea" ? [undefined, ...reaEngineIds] : [undefined]) {
    if (scope && pendingScope !== undefined && pendingScope !== scope) continue;
    const pending = builtinPendingOperation(root, tool, pendingScope);
    if (pending) reconcileBuiltinOperation(root, tool, pending, pendingScope);
  }
}
export function beginBuiltinOperation(root: string, tool: Tool, reconcileId?: string, scope?: ReaEngineId) {
  const maintenanceRoot = root;
  root = realpathSync(root);
  const directory = controlDirectory(root, tool, scope);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw unknown();
  const rootIdentity = identity(root), controlIdentity = identity(directory);
  const assertRoots = () => {
    if (realpathSync(maintenanceRoot) !== root || realpathSync(directory) !== directory || !matches(identity(root), rootIdentity) || !matches(identity(directory), controlIdentity)) throw unknown();
  };
  const directoryOwned = (item: Record["directories"][number]) => {
    if (!item || typeof item.path !== "string" || typeof item.dev !== "string" || typeof item.ino !== "string" || !/^\d+$/.test(item.dev) || !/^\d+$/.test(item.ino)) throw unknown();
    if (!managedPath(root, tool, item.path, scope)) throw unknown();
    try {
      const stat = lstatSync(item.path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(item.path) !== item.path || !matches(identity(item.path), item)) throw unknown();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  };
  const assertRemovals = (directories: Record["directories"], removals?: string[]) => {
    if (removals === undefined) return;
    if (!Array.isArray(removals) || new Set(removals).size !== removals.length) throw unknown();
    for (const path of removals) {
      if (!managedPath(root, tool, path, scope)) throw unknown();
      if (directories.some(item => item.path === path)) continue;
      // A path absent when removal was recorded must remain absent. Its old
      // configuration must never authorize adoption of a newly created inode.
      try { lstatSync(path); throw unknown(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  };
  const inventory = (commands: Entry[], registering?: string) => {
    for (const name of readdirSync(directory)) if (/^\.axiom-command-.*\.json$/.test(name)) {
      const path = join(directory, name);
      if (path !== registering && !commands.some(entry => entry.path === path)) throw unknown();
    }
  };
  // Admission is short and shared by the program and its components. The
  // operation itself holds only its own lock, including across process exit.
  const admit = lockResourcePaths([join(controlDirectory(root, tool), "admission")]);
  let release = () => {}, releaseWriter = () => {};
  const path = join(directory, "current.json");
  let record: Record, task: MaintenanceTask | undefined, closed = false;
  try {
    releaseWriter = acquireReaWriter(root, tool);
    release = lockResourcePaths([join(directory, "parent")]);
    // Component standard: a stale, interrupted or unreadable journal never
    // blocks the next button press. Its leftovers are discarded; directory
    // proofs that still match are carried forward so uninstall can clean them.
    let previous: Record | undefined;
    try { previous = read(path); } catch { previous = undefined; }
    if (previous && (previous.format !== 1 || previous.root !== root || previous.tool !== tool || previous.scope !== scope || !Array.isArray(previous.directories))) previous = undefined;
    for (const name of readdirSync(directory)) if (/^\.axiom-command-.*\.json$/.test(name)) rmSync(join(directory, name), { force: true });
    const carried = (previous?.directories ?? []).filter(item => { try { directoryOwned(item); return true; } catch { return false; } });
    const removals = Array.isArray(previous?.removals) ? previous!.removals.filter(item => managedPath(root, tool, item, scope) && (carried.some(entry => entry.path === item) || (() => { try { lstatSync(item); return false; } catch { return true; } })())) : [];
    record = { format: 1, id: randomUUID(), tool, ...(scope ? { scope } : {}), root, rootIdentity, controlIdentity, state: "active", commands: [], directories: carried, ...(removals.length ? { removals } : {}) };
    durable(path, record);
  } catch (error) { release(); releaseWriter(); throw error; }
  finally { admit(); }
  let parentIdentity = identity(path);
  const assertRecord = () => {
    assertRoots();
    if (closed || !matches(identity(path), parentIdentity) || JSON.stringify(read(path)) !== JSON.stringify(record)) throw unknown();
  };
  const save = (next: Record) => { assertRecord(); durable(path, next); parentIdentity = identity(path); record = next; };
  const safe = () => {
    assertRecord(); inventory(record.commands);
    if (record.commands.some(item => item.state !== "cleaned")) throw unknown();
    record.directories.forEach(directoryOwned); assertRemovals(record.directories, record.removals);
  };
  const handle = {
    root, tool, directory,
    bindTask() {
      task = currentMaintenance()?.task;
      if (task) {
        if (scope && task.resource !== `rea:${scope}`) throw unknown();
        save({ ...record, task: structuredClone(task) });
      }
    },
    trackDirectory(path: string) {
      safe(); const stat = lstatSync(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw unknown();
      if (record.directories.some(item => item.path === path)) return;
      const item = { path, dev: String(stat.dev), ino: String(stat.ino) }; directoryOwned(item);
      save({ ...record, directories: [...record.directories, item] });
    },
    assertDirectory(path: string, declared = false) {
      safe();
      // Component installs keep their inode proofs in a scoped journal. Global
      // removal must verify that proof before adopting a declared installation.
      const engine = tool === "rea" && !scope && ["engines", "downloads"].some(container => dirname(path) === join(root, "integrations", "rea", container)) ? basename(path).split("-")[0] : undefined;
      if (isReaEngineId(engine)) {
        const scopedDirectory = controlDirectory(root, tool, engine);
        let previous: Record | undefined;
        try { previous = read(join(scopedDirectory, "current.json")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw unknown(); }
        if (previous) {
          if (previous.format !== 1 || !uuid(previous.id) || previous.root !== root || previous.tool !== tool || previous.scope !== engine || previous.state !== "complete" || !Array.isArray(previous.directories) || realpathSync(scopedDirectory) !== scopedDirectory || !matches(previous.rootIdentity, rootIdentity) || !matches(previous.controlIdentity, identity(scopedDirectory))) throw unknown();
          const proof = previous.directories.find(item => item.path === path);
          if (proof) {
            directoryOwned(proof);
            if (!record.directories.some(item => item.path === path)) save({ ...record, directories: [...record.directories, { ...proof }] });
          }
        }
      }
      if (!record.directories.some(item => item.path === path)) {
        if (!declared) throw unknown();
        handle.trackDirectory(path);
      }
    },
    removalDirectories() { safe(); return [...record.removals ?? []]; },
    markRemovals(paths: string[]) {
      safe();
      const removals = [...new Set([...record.removals ?? [], ...paths])];
      assertRemovals(record.directories, removals);
      if (removals.length !== (record.removals?.length ?? 0)) save({ ...record, removals });
    },
    forgetDirectory(path: string) {
      safe();
      const removals = record.removals?.filter(item => item !== path);
      save({ ...record, directories: record.directories.filter(item => item.path !== path), removals: removals?.length ? removals : undefined });
    },
    assertSafe: safe,
    register(path: string) {
      assertRecord(); inventory(record.commands, path);
      if (dirname(path) !== directory) throw unknown();
      const ownerId = read(path).id;
      if (!uuid(ownerId)) throw unknown();
      save({ ...record, commands: [...record.commands, { path, ownerId, state: "registered" }] });
    },
    armed(path: string) {
      assertRecord();
      const entry = record.commands.find(item => item.path === path);
      if (!entry || !sameOwner(entry)) throw unknown();
      save({ ...record, commands: record.commands.map(item => item.path === path ? { ...item, fingerprint: processOwnerFingerprint(path) } : item) });
    },
    cleaned(path: string) {
      if (closed) throw unknown();
      const entry = record.commands.find(item => item.path === path);
      if (!entry || !sameOwner(entry)) throw unknown();
      save({ ...record, commands: record.commands.map(item => item.path === path ? { ...item, state: "cleaned" } : item) });
    },
    finish() {
      safe();
      save({ ...record, state: "complete", task: task ? structuredClone(task) : undefined });
    },
    /** No unresolved history is kept; the next operation starts clean. */
    retain() {},
    close() { if (!closed) { closed = true; try { release(); } finally { releaseWriter(); } } },
    run<T>(work: () => T): T { return contexts.run(handle, work); },
  };
  return handle;
}
export function bindBuiltinTask() { contexts.getStore()?.bindTask(); }
export function trackBuiltinDirectory(path: string) { contexts.getStore()?.trackDirectory(path); }
export function assertBuiltinDirectoryOwned(path: string, declared = false) { contexts.getStore()?.assertDirectory(path, declared); }
export function assertBuiltinFilesSafe() { contexts.getStore()?.assertSafe(); }
export function builtinRemovalDirectories() { return contexts.getStore()?.removalDirectories() ?? []; }
export function markBuiltinRemovals(paths: string[]) { contexts.getStore()?.markRemovals(paths); }
export function forgetBuiltinDirectory(path: string) { contexts.getStore()?.forgetDirectory(path); }
export function withBuiltinConfiguration<T>(root: string, tool: Tool, work: () => T, scope?: ReaEngineId): T {
  const operation = beginBuiltinOperation(root, tool, undefined, scope);
  try { return operation.run(work); }
  finally { try { operation.finish(); } finally { operation.close(); } }
}
export async function runBuiltinTool(tool: Tool, file: string, args: string[], options: Omit<ToolRunOptions, "root" | "beforeStart" | "onArmed" | "onStopped"> & { cwd: string }) {
  const inherited = contexts.getStore(), operation = inherited ?? beginBuiltinOperation(options.cwd, tool);
  let owner: string | undefined;
  try {
    if (operation.tool !== tool || operation.root !== realpathSync(options.cwd)) throw unknown();
    return await runTool(file, args, { ...options, root: operation.directory,
      beforeStart: path => { operation.register(path); owner = path; },
      onArmed: path => operation.armed(path),
      onStopped: () => { if (owner) operation.cleaned(owner); },
    });
  } finally { if (!inherited) { try { operation.finish(); } finally { operation.close(); } } }
}
