import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { linuxProcessGone, linuxProcessStart, linuxProcessView, sameLinuxView, type LinuxProcessView } from "./process-owner-linux-identity.js";

import { pidGroupGone, pidIdentityGone, pidSnapshot, type PidProcessIdentity } from "./maintenance-process-pid.js";

export type ProcessOwnerIdentity = { platform: "linux"; initPid: number; startTime: string; view?: LinuxProcessView } | { platform: "win32"; workerPid: number } | PidProcessIdentity;
const activePidOwners = new Map<string, string>();

/** Persist the gate state before permitting any business IPC. Unknown records are
 * deliberately retained across restarts: PID liveness alone is not tree proof. */
export type CommandLeaseIdentity = string | { fd: number; path: string; dev: string; ino: string; digest: string };

export function createProcessOwner(path: string, commandLease?: CommandLeaseIdentity) {
  let host: { view: LinuxProcessView; startTime: string } | undefined;
  try { host = { view: linuxProcessView(), startTime: linuxProcessStart(process.pid) }; } catch { /* Explicitly unrecoverable; still require the durable gate. */ }
  const hostStarted = process.platform === "darwin" ? pidSnapshot().find(row => row.pid === process.pid)?.started : undefined;
  const record = { format: 1, id: randomUUID(), state: "intent" as "intent" | "armed", hostPid: process.pid, host, hostStarted, commandLease, createdAt: Date.now(), identity: undefined as ProcessOwnerIdentity | undefined };
  let removed = false;
  function syncDirectory() {
    // Windows does not support fsync on directory descriptors. File contents are
    // flushed; restart recovery must never infer safety from an intent record.
    if (process.platform === "win32") return;
    const fd = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  function persist(initial: boolean) {
    const staged = initial ? path : `${path}.${record.id}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      writeFileSync(fd, JSON.stringify(record) + "\n");
      fsyncSync(fd); closeSync(fd); fd = undefined;
      if (!initial) renameSync(staged, path);
      syncDirectory();
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (!initial) rmSync(staged, { force: true });
    }
  }
  function assertSameRecord() {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || JSON.parse(readFileSync(path, "utf8")).id !== record.id) throw Error("进程归属记录已改变，未执行程序或清除记录。");
  }
  persist(true);
  if (process.platform === "darwin") activePidOwners.set(path, record.id);
  return {
    revoke() { activePidOwners.delete(path); },
    arm(identity: ProcessOwnerIdentity) {
      // macOS refreshes its observed descendants under the same worker identity.
      const update = identity.platform === "darwin" && record.identity?.platform === "darwin" && identity.workerPid === record.identity.workerPid && identity.started === record.identity.started;
      if (removed || record.state !== "intent" && !update) throw Error("进程启动许可已失效。");
      assertSameRecord();
      if (identity.platform === "linux") {
        if (!Number.isSafeInteger(identity.initPid) || identity.initPid <= 1 || !/^[1-9]\d*$/.test(identity.startTime)) throw Error("Linux 进程归属身份无效。");
        let view: LinuxProcessView | undefined;
        try {
          const current = linuxProcessView();
          if (host && sameLinuxView(host.view, current) && linuxProcessStart(identity.initPid) === identity.startTime) view = current;
        } catch { /* Do not infer later cleanup when visibility cannot be verified. */ }
        identity = { ...identity, view };
      } else if (identity.platform === "darwin") {
        if (!validPidIdentity(identity)) throw Error("维护进程 PID 身份无效。");
      } else if (!Number.isSafeInteger(identity.workerPid) || identity.workerPid < 1) throw Error("Windows 进程归属身份无效。");
      record.state = "armed"; record.identity = identity;
      persist(false);
    },
    confirmed() {
      if (removed) return;
      assertSameRecord();
      rmSync(path); syncDirectory(); removed = true; activePidOwners.delete(path);
    },
  };
}
export type ProcessOwner = ReturnType<typeof createProcessOwner>;
function matchesCommandDescriptor(path: string, lease: Exclude<CommandLeaseIdentity, string>) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd, { bigint: true }), bytes = Buffer.alloc(33);
    return stat.isFile() && stat.size === 32n && String(stat.dev) === lease.dev && String(stat.ino) === lease.ino && readSync(fd, bytes, 0, bytes.length, 0) === 32 && createHash("sha256").update(bytes.subarray(0, 32)).digest("hex") === lease.digest;
  } finally { closeSync(fd); }
}


/** Live admission is distinct from proof of tree cleanup. Windows callers supply
 * a non-blocking named-mutex probe; old records cannot gain a lease from a PID. */
export function processOwnerIsLive(path: string, windowsLeaseLive?: (id: string, hostPid: number, path: string) => boolean): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16384) return false;
    const bytes = readFileSync(path, "utf8"), record = JSON.parse(bytes);
    if (record?.format !== 1 || !/^[a-f0-9-]{36}$/.test(record.id) || !["intent", "armed"].includes(record.state) || !Number.isSafeInteger(record.hostPid) || record.hostPid < 1) return false;
    let live = false;
    if (process.platform === "darwin") {
      live = record.hostPid === process.pid && activePidOwners.get(path) === record.id;
    } else if (process.platform === "win32") {
      live = typeof record.commandLease === "string" && /^[a-f0-9-]{36}$/.test(record.commandLease) && windowsLeaseLive?.(record.commandLease, record.hostPid, path) === true;
    } else if (process.platform === "linux" && /^[1-9]\d*$/.test(record.host?.startTime ?? "") && record.host?.view) {
      const view = linuxProcessView(), lease = record.commandLease;
      if (lease && typeof lease === "object" && Number.isSafeInteger(lease.fd) && lease.fd >= 0 && typeof lease.path === "string" && /\.axiom-command-[a-f0-9-]{36}\.live \(deleted\)$/.test(lease.path) && sameLinuxView(view, record.host.view) && linuxProcessStart(record.hostPid) === record.host.startTime) {
        const descriptor = `/proc/${record.hostPid}/fd/${lease.fd}`, identity = statSync(descriptor, { bigint: true });
        live = identity.isFile() && identity.size === 32n && /^[a-f0-9]{64}$/.test(lease.digest) && String(identity.dev) === lease.dev && String(identity.ino) === lease.ino && readlinkSync(descriptor) === lease.path && matchesCommandDescriptor(descriptor, lease) && linuxProcessStart(record.hostPid) === record.host.startTime && sameLinuxView(view, linuxProcessView());
      }
    }
    const current = lstatSync(path);
    return live && current.isFile() && !current.isSymbolicLink() && current.nlink === 1 && current.dev === stat.dev && current.ino === stat.ino && readFileSync(path, "utf8") === bytes;
  } catch { return false; }
}


/** Caller holds its resource lock, or uses a never-reused UUID record path.
 * Require the host to be gone too: an alive host may still commit configuration. */
function validPidIdentity(value: PidProcessIdentity) {
  return value?.platform === "darwin" && Number.isSafeInteger(value.workerPid) && value.workerPid > 1 && typeof value.started === "string" && value.started.length > 0 && Array.isArray(value.members) && value.members.length > 0 && value.members.every(member => Number.isSafeInteger(member.pid) && member.pid > 1 && typeof member.started === "string" && member.started.length > 0);
}
function canRecoverPidOwner(path: string) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) return false;
    const bytes = readFileSync(path, "utf8"), record = JSON.parse(bytes);
    if (record.format !== 1 || !/^[a-f0-9-]{36}$/.test(record.id) || record.state !== "armed" || !Number.isSafeInteger(record.hostPid) || record.hostPid <= 1 || typeof record.hostStarted !== "string" || !record.hostStarted || !validPidIdentity(record.identity)) return false;
    const rows = pidSnapshot();
    if (!pidIdentityGone({ pid: record.hostPid, started: record.hostStarted }, rows) || !pidGroupGone(record.identity, rows)) return false;
    const current = lstatSync(path);
    return current.isFile() && !current.isSymbolicLink() && current.nlink === 1 && current.dev === stat.dev && current.ino === stat.ino && readFileSync(path, "utf8") === bytes;
  } catch { return false; }
}
export function canRecoverProcessOwner(path: string): boolean {
  if (process.platform === "darwin") return canRecoverPidOwner(path);
  if (process.platform !== "linux") return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16384) return false;
    const bytes = readFileSync(path, "utf8"), record = JSON.parse(bytes);
    if (record?.format !== 1 || !/^[a-f0-9-]{36}$/.test(record.id) || !["intent", "armed"].includes(record.state) || !Number.isSafeInteger(record.hostPid) || record.hostPid < 1 || !/^[1-9]\d*$/.test(record.host?.startTime ?? "")) return false;
    const view = linuxProcessView();
    if (!record.host?.view || !sameLinuxView(view, record.host.view) || !linuxProcessGone(record.hostPid, record.host.startTime)) return false;
    if (record.state === "armed") {
      const identity = record.identity;
      if (identity?.platform !== "linux" || !Number.isSafeInteger(identity.initPid) || identity.initPid <= 1 || !/^[1-9]\d*$/.test(identity.startTime ?? "") || !identity.view || !sameLinuxView(view, identity.view) || !linuxProcessGone(identity.initPid, identity.startTime)) return false;
    } else if (record.identity !== undefined) return false;
    if (!sameLinuxView(view, linuxProcessView()) || readFileSync(path, "utf8") !== bytes) return false;
    const current = lstatSync(path);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== stat.dev || current.ino !== stat.ino) return false;
    return true;
  } catch { return false; }
}

/** Revalidate under the caller's resource lock after its interrupted state has
 * been committed. The read-only preflight never removes an ownership record. */
export function recoverProcessOwner(path: string): boolean {
  if (!canRecoverProcessOwner(path)) return false;
  try {
    rmSync(path);
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return true;
  } catch { return false; }
}
