// A one-request desktop host. No service constructor, worker pool, timer or network.
import { lockCommandAdmission } from "../src/server/command-admission.js";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readRtkConfig, rtkConfigPath, rtkDirectory, rtkExecutable } from "../src/server/integrations/rtk-config.js";
import { rtkRemovalDirectories } from "../src/server/integrations/rtk-removal.js";
import type { RtkJob, RtkState } from "../src/shared/rtk.js";

const offlineRemovalReason = "缺少历史工作进程退出证明，RTK 离线卸载暂不可用；仅列出范围，未修改工具或配置。";
type Input = { op: "rtk.get"; requestId: string; params: Record<string, never> };
function command(input: unknown): Input {
  const value = input as Input;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["op", "requestId", "params"].includes(key)) || typeof value.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(value.requestId)) throw Error("清理请求无效。");
  if ((value as { op: string }).op === "rtk.uninstall") throw Error(offlineRemovalReason);
  if (value.op !== "rtk.get") throw Error("后台未运行；目前仅支持读取 RTK 离线范围，其他工具与资源需要后台运行。");
  const params = value.params ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length > 0) throw Error("清理参数无效。");
  return { ...value, params };
}
function record(path: string): unknown {
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 131072) throw Error("维护记录类型或大小无效；已保留文件。");
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > 131072) throw Error("维护记录身份已变化。");
    const bytes = Buffer.alloc(131073);
    let length = 0, count: number;
    while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null))) length += count;
    if (length >= bytes.length) throw Error("维护记录过大。");
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function present(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function ordinaryDirectory(path: string): boolean {
  if (!present(path)) return false;
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(path) !== path) throw Error("维护目录存在链接或身份无效；已保留文件。");
  return true;
}
function names(path: string, limit = 4096): string[] {
  if (!ordinaryDirectory(path)) return [];
  const dir = opendirSync(path), result: string[] = [];
  try { let item; while ((item = dir.readSync())) { if (result.length >= limit) throw Error("目录条目超过离线核实上限；未执行清理。"); result.push(item.name); } }
  finally { dir.closeSync(); }
  return result;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
function sqlite(path: string) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    if (!present(path + suffix)) continue;
    const info = lstatSync(path + suffix);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error("维护锁路径无效。");
  }
  return new DatabaseSync(path);
}
/** The existing launch protocol recognizes a live PID with a 64-character token. */
function reserve(root: string): () => void {
  const db = sqlite(join(root, "service-startup.sqlite")), token = randomBytes(32).toString("hex");
  try {
    db.exec("PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS startup (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL); BEGIN IMMEDIATE");
    const previous = db.prepare("SELECT token,pid FROM startup WHERE id=1").get();
    if (previous) {
      if (typeof previous.token !== "string" || !/^[a-f0-9]{64}$/.test(previous.token) || typeof previous.pid !== "number" || !Number.isSafeInteger(previous.pid) || previous.pid < 1 || alive(previous.pid)) throw Error("后台启动或维护尚未退出，请稍后重新读取。");
      db.prepare("DELETE FROM startup WHERE token=? AND pid=?").run(previous.token, previous.pid);
    }
    db.prepare("INSERT INTO startup VALUES(1,?,?)").run(token, process.pid);
    db.exec("COMMIT");
  } catch (error) { db.close(); throw error; }
  return () => { try { db.prepare("DELETE FROM startup WHERE token=? AND pid=?").run(token, process.pid); } finally { db.close(); } };
}
function barrier(root: string) {
  const control = record(join(root, "service-control.json")) as { pid?: number } | undefined;
  if (control !== undefined && (!control || !Number.isSafeInteger(control.pid) || control.pid! < 1 || alive(control.pid!))) throw Error("尚未确认本机后台退出；已保留工具程序。");
  const entries = names(root);
  if (entries.some(name => name.startsWith(".axiom-command-") && name.endsWith(".json"))) throw Error("仍有工具进程退出待核实记录；请启动后台核实，未删除任何程序。");
  for (const folder of ["setup", "updates"]) ordinaryDirectory(join(root, folder));
  if (present(join(root, "setup/service-owner.json")) || present(join(root, "updates/transaction.json"))) throw Error("安装或恢复事务尚未解除，暂不能离线清理工具。");
  for (const folder of ["integrations", "integrations/rtk", "integrations/rtk/versions"]) ordinaryDirectory(join(root, folder));
  names(join(root, "integrations/rtk/versions"), 1024);
  record(rtkConfigPath(root)); record(join(rtkDirectory(root), "job.json"));
}
function snapshot(root: string): RtkState {
  const config = readRtkConfig(root), directories = rtkRemovalDirectories(root, config);
  const paths = directories.map(name => join(rtkDirectory(root), "versions", name));
  const identities = paths.map(path => { if (!present(path)) return [path, "missing"]; const info = lstatSync(path, { bigint: true }); return [path, String(info.dev), String(info.ino), String(info.mtimeNs)]; });
  const revision = createHash("sha256").update(JSON.stringify([config, identities])).digest("hex");
  const state: RtkState = { revision, settings: { enabled: config.enabled, level: config.level, subagents: config.subagents }, platform: `${process.platform}/${process.arch}`, supported: true, version: config.installation?.version, executable: rtkExecutable(root, config), removalPending: !!config.removalPending?.length, cleanupPaths: paths, offline: true, offlineUninstall: { allowed: false, reason: offlineRemovalReason } };
  const job = record(join(rtkDirectory(root), "job.json")) as RtkJob | undefined;
  if (job !== undefined) {
    if (!job || typeof job.id !== "string" || !["check", "install", "doctor", "uninstall", "cleanupStats", "cleanupOriginals"].includes(job.kind) || typeof job.running !== "boolean" || typeof job.message !== "string") throw Error("RTK 操作记录无效，无法确认上次结果。");
    state.job = job.running ? { ...job, running: false, error: "上次操作被退出中断，请重新核实范围；不会自动重试。" } : job;
  }
  return state;
}
export function offlineToolRequest(root: string, input: unknown) {
  const request = command(input);
  if (!isAbsolute(root) || !ordinaryDirectory(root)) throw Error("本机数据目录不存在或未通过身份核实。");
  const admission = sqlite(join(root, "service-maintenance.sqlite"));
  let release: (() => void) | undefined, releaseCommands: (() => void) | undefined;
  try {
    try { admission.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE"); } catch { throw Error("后台正在安装、更新或卸载，请等待当前维护完成。"); }
    release = reserve(root);
    releaseCommands = lockCommandAdmission(root);
    barrier(root);
    return { requestId: request.requestId, data: snapshot(root) };
  } finally { try { releaseCommands?.(); } finally { try { release?.(); } finally { admission.close(); } } }
}
