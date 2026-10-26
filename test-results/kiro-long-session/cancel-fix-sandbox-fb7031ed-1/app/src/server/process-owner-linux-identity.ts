import { lstatSync, readFileSync, readlinkSync, statfsSync, statSync } from "node:fs";

export type LinuxProcessView = { bootId: string; namespaceDevice: string; namespaceInode: string };
export function linuxProcessStart(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error("Invalid process identity");
  const value = readFileSync(`/proc/${pid}/stat`, "utf8"), end = value.lastIndexOf(")");
  if (!value.startsWith(`${pid} (`) || end < 0) throw Error("Invalid process stat");
  const fields = value.slice(end + 2).trim().split(/\s+/), start = fields[19];
  if (!/^[1-9]\d*$/.test(start ?? "")) throw Error("Invalid process creation time");
  return start;
}

/** A matching namespace plus an unhidden proc view is required to interpret
 * ENOENT. Namespace inode reuse is safe only after the old namespace is gone. */
export function linuxProcessView(): LinuxProcessView {
  if (process.platform !== "linux" || statfsSync("/proc", { bigint: true }).type !== 0x9fa0n) throw Error("Untrusted proc view");
  const mounts = readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map(line => {
    const [left, right] = line.split(" - "), fields = left.split(" "), details = right?.split(" ");
    if (!details || fields.length < 6) throw Error("Invalid mount information");
    const decode = (value: string) => value.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
    return { root: decode(fields[3]), path: decode(fields[4]), type: details[0], options: `${fields[5]},${details[2]}`.split(",") };
  });
  const proc = mounts.filter(mount => mount.path === "/proc");
  if (proc.length !== 1 || proc[0].root !== "/" || proc[0].type !== "proc" || proc[0].options.some(option => option.startsWith("hidepid=") && option !== "hidepid=0")) throw Error("Hidden or ambiguous proc view");
  const bootPath = "/proc/sys/kernel/random/boot_id";
  if (mounts.some(mount => mount.path.startsWith("/proc/") && (/^\/proc\/(?:self|thread-self|\d+)(?:\/|$)/.test(mount.path) || bootPath === mount.path || bootPath.startsWith(mount.path + "/")))) throw Error("Overlaid proc identity paths");
  if (readlinkSync("/proc/self") !== String(process.pid)) throw Error("Mismatched proc PID namespace");
  const status = readFileSync("/proc/self/status", "utf8").match(/^NSpid:\s+([^\n]+)$/m)?.[1].trim().split(/\s+/);
  if (status?.length !== 1 || status[0] !== String(process.pid)) throw Error("Mismatched proc PID mapping");
  const ns = statSync("/proc/self/ns/pid", { bigint: true });
  const bootId = readFileSync(bootPath, "utf8").trim();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId)) throw Error("Invalid boot identity");
  return { bootId, namespaceDevice: String(ns.dev), namespaceInode: String(ns.ino) };
}
export function sameLinuxView(a: LinuxProcessView, b: LinuxProcessView) {
  return a.bootId === b.bootId && a.namespaceDevice === b.namespaceDevice && a.namespaceInode === b.namespaceInode;
}
export function linuxProcessGone(pid: number, startTime: string) {
  try { return linuxProcessStart(pid) !== startTime; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    // A vanished stat file is only accepted if the process directory is gone too.
    try { lstatSync(`/proc/${pid}`); return false; }
    catch (missing) { return (missing as NodeJS.ErrnoException).code === "ENOENT"; }
  }
}
