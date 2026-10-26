import { execFileSync, fork, type ForkOptions } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { MaintenanceError } from "../shared/maintenance.js";

export type PidIdentity = { pid: number; started: string };
export type PidProcessIdentity = { platform: "darwin"; workerPid: number; started: string; members: PidIdentity[] };
type Row = PidIdentity & { parent: number; group: number; zombie: boolean };
const uncertain = () => new MaintenanceError("stop-unconfirmed", "维护进程尚未确认退出，已保留记录与文件，请重试清理。");

/** Only an owned PID/group is signalled. Never kill processes by name. */
export function pidIsAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export function pidSnapshot(): Row[] {
  const text = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], { encoding: "utf8", timeout: 2000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } });
  return text.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), zombie: match[4].startsWith("Z"), started: match[5] }] : [];
  });
}
export function pidIdentityGone(identity: PidIdentity, rows = pidSnapshot()) {
  return !rows.some(row => row.pid === identity.pid && row.started === identity.started && !row.zombie);
}
export function pidGroupGone(identity: PidProcessIdentity, rows = pidSnapshot()) {
  return !rows.some(row => row.group === identity.workerPid && !row.zombie) && identity.members.every(member => pidIdentityGone(member, rows));
}

/** Simple PID ownership, not a sandbox. Normal descendants share the worker's
 * group; observed setsid children are also tracked. A daemon that detaches and
 * reparents entirely between snapshots is outside this best-effort contract. */
export function forkPidProcess(entry: string, options: Pick<ForkOptions, "cwd" | "env" | "execArgv" | "serialization">, save: (identity: PidProcessIdentity) => void) {
  const child = fork(entry, [], { ...options, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  let identity: PidProcessIdentity | undefined, error: Error | undefined, closed = false;
  const members = new Map<number, PidIdentity>();
  const capture = () => {
    if (!identity) return;
    const rows = pidSnapshot();
    const leader = rows.find(row => row.pid === identity!.workerPid);
    const groupOwned = !leader || leader.started === identity.started;
    const owned = new Set(rows.filter(row => (groupOwned && row.group === identity!.workerPid) || members.get(row.pid)?.started === row.started).map(row => row.pid));
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (row.pid !== identity.workerPid && !owned.has(row.pid) && owned.has(row.parent)) { owned.add(row.pid); changed = true; }
    }
    let added = false;
    for (const row of rows) if (owned.has(row.pid) && row.pid !== process.pid && members.get(row.pid)?.started !== row.started) {
      members.set(row.pid, { pid: row.pid, started: row.started }); added = true;
    }
    if (added) { identity = { ...identity, members: [...members.values()] }; save(identity); }
  };
  const ready = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      try {
        const row = pidSnapshot().find(row => row.pid === child.pid && row.group === child.pid);
        if (!row) throw uncertain();
        identity = { platform: "darwin", workerPid: row.pid, started: row.started, members: [{ pid: row.pid, started: row.started }] };
        members.set(row.pid, identity.members[0]); save(identity); resolve();
      } catch (failure) { reject(failure); }
    });
  });
  void ready.catch(() => {});
  const timer = setInterval(() => { try { capture(); } catch { error ??= uncertain(); void close().catch(() => {}); } }, 200);
  timer.unref();
  child.once("close", () => { closed = true; });
  const signal = (name: NodeJS.Signals) => {
    if (!child.pid) return;
    const rows = pidSnapshot();
    // A reused group leader must not grant ownership of a new process group.
    const leader = rows.find(row => row.pid === child.pid);
    if ((!leader || !identity || leader.started === identity.started) && rows.some(row => row.group === child.pid && !row.zombie)) {
      try { process.kill(-child.pid, name); } catch (failure) {
        // Darwin can report EPERM for a group that vanished during the signal.
        if ((failure as NodeJS.ErrnoException).code !== "ESRCH" && pidSnapshot().some(row => row.group === child.pid && !row.zombie)) throw failure;
      }
    }
    for (const member of members.values()) if (!pidIdentityGone(member, rows)) {
      try { process.kill(member.pid, name); } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ESRCH" && !pidIdentityGone(member)) throw failure; }
    }
  };
  let stopping: Promise<void> | undefined;
  function close() {
    return stopping ??= (async () => {
      clearInterval(timer);
      try { await ready; } catch { /* No request was admitted, but a worker may exist. */ }
      try { capture(); } catch { error ??= uncertain(); }
      signal("SIGTERM");
      const until = Date.now() + 500;
      while (!closed && Date.now() < until) await delay(25);
      // Even when the worker exited, descendants can remain in its group.
      try { capture(); } catch { error ??= uncertain(); }
      signal("SIGKILL");
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (closed && (!identity || pidGroupGone(identity))) return;
        await delay(50);
      }
      throw uncertain();
    })();
  }
  return { child, ready, close, failure: () => error, setDeadline(_value: number) {} };
}
