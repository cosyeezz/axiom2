// Bundled with the desktop client; uses only Node.js built-ins so old backends can update.
import { inspectArchives, removeArchive, archiveWorker } from './archive-cleanup.mjs';
import { serviceAdmission } from './service-admission.mjs';
import { inspectServiceRemoval, removeManagedService, serviceRemovalPending, verifyServiceRemoval } from './service-removal.mjs';
import { inspectPiRemoval, verifyPiRemoval } from './pi-removal.mjs';
import { DesktopExecution, desktopTask, budgetsDefault, validBudgets } from './maintenance.mjs';
import { atomicJson as atomic } from './atomic-json.mjs';
import { createUpdaterReconciler } from './updater-reconciliation.mjs';
import { createUpdaterSupervisor, updaterOwnerPresent, updaterTaskSnapshot } from './updater-supervision.mjs';
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, open, access, lstat, realpath, link } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, join, resolve, delimiter, isAbsolute, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const RELEASE_API = "https://api.github.com/repos/cosyeezz/axiom2/releases/latest";
const RELEASE_BASE = "https://github.com/cosyeezz/axiom2/releases/download/";
const script = fileURLToPath(import.meta.url);
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
function basenameForModules(modules) {
  if (basename(modules) !== "node_modules" || process.platform !== "win32" && basename(dirname(modules)) !== "lib") throw Error("npm 全局目录格式不受支持。");
  return process.platform === "win32" ? dirname(modules) : dirname(dirname(modules));
}
export function newer(a, b) {
  if (!versionPattern.test(a) || !versionPattern.test(b)) return false;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const exists = async (path) => { try { await access(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const alive = (pid) => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } };
async function json(path, fallback = null) { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } }
async function logTail(path) {
  let file;
  try {
    file = await open(path, "r"); const info = await file.stat();
    const bytes = Buffer.alloc(Math.min(info.size, 8192));
    await file.read(bytes, 0, bytes.length, Math.max(0, info.size - bytes.length));
    return { lines: bytes.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-30), updatedAt: info.mtimeMs };
  } catch { return { lines: [], updatedAt: null }; }
  finally { await file?.close(); }
}
export async function execute(node, args, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "axiom-updater-command-"));
  const task = desktopTask("probe", "check");
  let supervisor, failure, output;
  const execution = new DesktopExecution(task, snapshot => supervisor?.publish(snapshot));
  const abort = () => execution.abort(options.signal.reason?.code ?? "cancelled", options.signal.reason?.message ?? "命令已取消。");
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    supervisor = createUpdaterSupervisor({ root, execution, log: options.log, fetcher: options.fetcher });
    await supervisor.prepare();
    await execution.phase("checking", "正在核实安装状态…");
    output = await supervisor.command(node, args, { timeoutMs: 60000, ...options, cwd: options.cwd ?? process.cwd() });
  } catch (error) { failure = error; }
  finally {
    options.signal?.removeEventListener("abort", abort);
    await execution.finish(failure);
    if (execution.task.status === "unknown") supervisor?.retain();
    await supervisor?.release();
    if (!supervisor?.uncertain()) await rm(root, { recursive: true, force: true });
  }
  if (failure) throw failure;
  return output;
}
export function createUpdater({ root, fetcher = fetch, command = execute, isAlive = alive, api = RELEASE_API, base = RELEASE_BASE, env = process.env, runtimeNode = process.execPath } = {}) {
  if (!root || !isAbsolute(root)) throw Error("缺少绝对数据目录");
  const directory = join(root, "updates");
  const registration = join(root, "installation.json");
  const releaseFile = join(directory, "release.json");
  const journalFile = join(directory, "transaction.json");
  const log = join(directory, "update.log");
  const piReleaseFile = join(directory, "pi-release.json");
  const piValidationFile = join(directory, "pi-validation.json");
  const piRemovalFile = join(directory, 'pi-removal.json');
  const archivePreviewFile = join(directory, 'archive-cleanup.json');
  const serviceRemovalFile = join(directory, 'service-removal.json');
  const piPackage = "@earendil-works/pi-coding-agent";
  async function piCommandsComplete(packageRoot, pkg, prefix) {
    const entry = typeof pkg?.bin?.pi === 'string' ? resolve(packageRoot, pkg.bin.pi) : '';
    if (!entry.startsWith(`${packageRoot}${sep}`)) return false;
    const shim = process.platform === 'win32' ? join(prefix, 'pi.cmd') : join(prefix, 'bin/pi');
    try {
      const entryInfo = await lstat(entry), shimInfo = await lstat(shim);
      if (!entryInfo.isFile() || !(await realpath(entry)).startsWith(`${await realpath(packageRoot)}${sep}`)) return false;
      if (process.platform === 'win32') return shimInfo.isFile();
      if (shimInfo.isSymbolicLink()) return await realpath(shim) === await realpath(entry) && (entryInfo.mode & 0o111) !== 0;
      return shimInfo.isFile() && (shimInfo.mode & 0o111) !== 0;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return false;
      throw error;
    }
  }
  async function piEnvironment() {
    const installed = await installation(true) ?? { node: runtimeNode };
    const npm = await npmCli(installed.node);
    const modules = await runCommand(installed.node, [npm, "root", "--global"], inspectionOptions());
    if (!isAbsolute(modules) || /[\r\n]/.test(modules)) throw Error("npm 全局目录无效。");
    const packageRoot = join(modules, ...piPackage.split("/"));
    const pkg = await json(join(packageRoot, "package.json"));
    const legacy = await json(join(modules, "@mariozechner/pi-coding-agent/package.json"));
    if (pkg && (pkg.name !== piPackage || !versionPattern.test(pkg.version))) throw Error("pi 安装信息无效，请修复 npm 全局安装。");
    const prefix = basenameForModules(modules);
    // Bind existing ancestors too: a fresh installation may not have node_modules yet.
    const location = async path => {
      if (await exists(path)) return realpath(path);
      const parent = dirname(path);
      if (parent === path) throw Error("无法确认 npm 安装目录。");
      return join(await location(parent), basename(path));
    };
    const identity = createHash("sha256").update(JSON.stringify([await realpath(installed.node), await realpath(npm), await location(prefix), await location(modules), await location(packageRoot), pkg])).digest("hex");
    const repairRequired = !!pkg && !await piCommandsComplete(packageRoot, pkg, prefix);
    return { installed, npm, prefix, identity, packageRoot, version: pkg?.version ?? null, legacy: !!legacy, repairRequired };
  }
  async function piStatus(refresh = false) {
    let runtimeVersion = null;
    const installed = await installation(true);
    try {
      if (!installed) throw Error("后台尚未安装");
      // Read from Node's dependency lookup directories without requiring the SDK:
      // pi exports only an ESM import condition, so require.resolve(piPackage) fails.
      for (const path of createRequire(installed.cli).resolve.paths(piPackage) ?? []) {
        const pkg = await json(join(path, piPackage, "package.json"));
        if (pkg?.name === piPackage) { runtimeVersion = pkg.version; break; }
      }
    } catch { /* Unknown stays unknown, never substitute the CLI version. */ }
    let cli;
    try { cli = await json(join(directory, "pi-installation.json")); }
    catch { cli = { error: "pi 安装缓存无法读取，请重新查询。" }; }
    if (refresh) {
      try {
        const info = await piEnvironment();
        let validation, invalidValidation = false;
        try { validation = await json(piValidationFile); } catch { invalidValidation = true; }
        // A version/package.json match is not evidence of a usable CLI. A
        // refresh or unrelated task must not erase an unsuccessful run check.
        // An interrupted npm run may have changed dependencies before rewriting
        // package.json. The previous version is not proof that nothing changed.
        const unverified = invalidValidation || validation?.packageRoot === info.packageRoot;
        const repairRequired = info.repairRequired || !!info.version && unverified;
        cli = { version: info.version, packageRoot: info.packageRoot, legacy: info.legacy, identity: info.identity, repairRequired,
          ...(repairRequired ? { repairReason: '终端 Pi 的命令入口不完整或上次运行验证未通过；请重新检查更新后重新安装。' } : {}) };
      }
      catch (error) { execution?.signal.throwIfAborted(); cli = { error: `无法读取终端 Pi：${error.message}` }; }
      execution?.signal.throwIfAborted();
      await mkdir(directory, { recursive: true });
      await atomic(join(directory, "pi-installation.json"), cli, { signal: execution?.signal });
      execution?.signal.throwIfAborted();
    }
    let release = null;
    try { release = await json(piReleaseFile); } catch { /* Explicit check replaces an unreadable optional cache. */ }
    // Keep the latest version visible, but require a new confirmation after the
    // inspected installation changes, including a partially completed install.
    if (release && cli?.identity !== release.identity) release = { ...release, token: null };
    let removal = null;
    try { removal = await json(piRemovalFile); } catch { /* A new preview replaces invalid optional data. */ }
    return { runtimeVersion, cli, release, removal };
  }
  async function piRefresh() { return runJob("pi-refresh"); }
  async function piCheck() {
    await piStatus(true);
    const response = await network(`https://registry.npmjs.org/${piPackage}/latest`);
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`pi 版本查询失败（HTTP ${response.status}）。`), { code: "http" }); }
    const pkg = JSON.parse(await bounded(response, 1024 * 1024));
    if (pkg.name !== piPackage || !versionPattern.test(pkg.version)) throw Error("npm 未返回有效的 pi 稳定版本。");
    await mkdir(directory, { recursive: true });
    const cli = await json(join(directory, "pi-installation.json"));
    if (!cli?.identity || cli.error) throw Error("请先修复终端 pi 安装环境，再检查更新。");
    await atomic(piReleaseFile, { version: pkg.version, checkedAt: Date.now(), token: randomBytes(24).toString("hex"), identity: cli.identity });
    return status();
  }
  const environment = { ...env, AXIOM_DATA_DIR: root };
  let owner, execution, supervisor, pendingPiLock;
  const runCommand = (file, args, options) => supervisor ? supervisor.command(file, args, options) : command(file, args, options);
  const network = (url, init) => execution ? execution.fetch(url, fetcher, init) : fetcher(url, { ...init, signal: AbortSignal.timeout(20000) });
  const inspectionOptions = () => {
    const active = execution, started = Date.now();
    active?.signal.throwIfAborted();
    return { env: environment, timeoutMs: 20000, signal: active?.signal,
      ...(active ? { timeoutCode: "total-timeout", getTimeout: () => active.task.budgets.totalMs - (started - active.task.startedAt) } : {}) };
  };
  const installOptions = () => ({ env: { ...environment, npm_config_fetch_retries: "2", npm_config_fetch_timeout: "86400000" }, timeoutMs: 600000, log, signal: execution?.signal, getTimeout: () => execution?.task.budgets.installMs ?? budgetsDefault.installMs });
  async function maintenanceControl(action, payload = {}) {
    if (action === "defaults") {
      if (!validBudgets(payload.budgets)) throw Error("无效的时间预算。");
      await mkdir(directory, { recursive: true }); await atomic(join(directory, "budgets.json"), payload.budgets); return status();
    }
    await database(db => {
      db.exec("BEGIN IMMEDIATE");
      const row = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get(), current = row && projectJob(row);
      if (!current?.running || current.task?.id !== payload.id) throw Error("任务已结束或身份已变化。");
      const previous = db.prepare("SELECT body FROM maintenance_control WHERE token=?").get(row.token);
      const control = previous ? JSON.parse(previous.body) : {};
      if (action === "cancel") { if (!current.task.capabilities.cancel) throw Error("此阶段无法取消，请等待安装器结果。"); control.cancel = true; }
      else if (action === "extend") {
        if (!current.task.capabilities.extend || !validBudgets(payload.budgets) || Object.keys(budgetsDefault).some(key => payload.budgets[key] < (control.budgets ?? current.task.budgets)[key])) throw Error("运行中只能延长可控制阶段的时限。");
        control.budgets = payload.budgets;
      } else throw Error("不支持的维护操作。");
      db.prepare("INSERT OR REPLACE INTO maintenance_control VALUES(?,?)").run(row.token, JSON.stringify(control)); db.exec("COMMIT");
    });
    return status();
  }
  async function writeJob(patch) {
    if (patch.task && supervisor) patch.task = supervisor.publish(patch.task);
    await database(db => {
      db.exec("BEGIN IMMEDIATE");
      const row = db.prepare("SELECT body FROM job WHERE token=? AND pid=?").get(owner.token, process.pid);
      if (!row) throw Error("更新任务归属已变化");
      const body = JSON.stringify({ ...JSON.parse(row.body), ...patch });
      db.prepare("UPDATE job SET body=? WHERE token=? AND pid=?").run(body, owner.token, process.pid);
      archiveJob(db, { token: owner.token, pid: process.pid, body });
      db.exec("COMMIT");
    });
  }
  function archiveJob(db, row) {
    db.prepare("INSERT OR REPLACE INTO maintenance_history(token,pid,body) VALUES(?,?,?)").run(row.token, row.pid, row.body);
    // Preserve every unresolved or unreadable record. Only ordinary terminal
    // records are eligible for the same recent-100 policy as other task centers.
    const completed = [];
    for (const candidate of db.prepare("SELECT token,body FROM maintenance_history WHERE CASE WHEN json_valid(body) THEN json_extract(body,'$.task.status') END IN ('succeeded','failed','cancelled')").all()) {
      try { const task = JSON.parse(candidate.body).task; if (validHistoryTask(task)) completed.push({ token: candidate.token, createdAt: task.createdAt }); } catch { /* Preserve unreadable records. */ }
    }
    completed.sort((a, b) => b.createdAt - a.createdAt || b.token.localeCompare(a.token));
    const remove = db.prepare("DELETE FROM maintenance_history WHERE token=?");
    for (const candidate of completed.slice(100)) remove.run(candidate.token);
  }
  function validHistoryTask(task) {
    return !!task && typeof task.id === "string" && typeof task.label === "string" && typeof task.resource === "string" && Number.isFinite(task.createdAt) && Array.isArray(task.steps) && validBudgets(task.budgets) && ["running", "cancelling", "unknown", "interrupted", "succeeded", "failed", "cancelled"].includes(task.status);
  }
  function projectJob(row, current = true) {
    const value = JSON.parse(row.body);
    if (value.supervised && value.task && value.running) {
      try { value.task = updaterTaskSnapshot(root, value.task); }
      catch { value.task.status = "unknown"; value.task.message = "更新监督记录无法核实，已保留安装目录与归属记录。"; }
      if (value.task.status === "unknown") {
        value.task.capabilities = { cancel: false, extend: false };
        value.task.error = { code: "stop-unconfirmed", phase: value.task.phase, message: value.task.message };
        value.phase = "interrupted"; value.message = value.task.message;
      }
    }
    if (current && value.task && (value.reconciliation?.state === "release-pending" || (!isAlive(row.pid) || !value.running) && updaterOwnerPresent(root))) {
      value.task.status = "unknown"; value.task.message = "更新进程或父提交退出尚未确认，归属记录仍保留。";
      value.task.error = { code: "stop-unconfirmed", phase: value.task.phase, message: value.task.message };
      value.task.capabilities = { cancel: false, extend: false };
      value.phase = "interrupted"; value.message = value.task.message;
    }
    if (value.running && (!current || !isAlive(row.pid))) Object.assign(value, { running: false, phase: "interrupted", message: "上次更新进程已退出，请核实当前安装状态。" });
    if (value.task && (!current || !value.running || value.phase === "interrupted")) {
      value.task.capabilities = { cancel: false, extend: false };
      if (["running", "cancelling"].includes(value.task.status)) {
        value.task.status = value.phase === "error" ? "failed" : "interrupted";
        value.task.message = value.message;
        if (value.phase === "error") value.task.error = { code: "operation", phase: value.task.phase, message: value.message || "更新未完成。" };
      }
    }
    return value;
  }
  async function history() {
    return database(db => {
      db.exec("BEGIN");
      const rows = new Map(db.prepare("SELECT token,pid,body FROM maintenance_history").all().map(row => [row.token, row]));
      const current = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get();
      if (current) rows.set(current.token, current);
      const tasks = [], warnings = [];
      for (const row of rows.values()) {
        try {
          const value = projectJob(row, row.token === current?.token), task = value.task;
          if (!validHistoryTask(task)) throw Error("维护任务详情不完整。");
          tasks.push(task);
        } catch { warnings.push("有更新记录无法读取，已保留原记录。请检查本机更新日志。"); }
      }
      tasks.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const unresolved = task => ["running", "cancelling", "unknown", "interrupted"].includes(task.status);
      const recent = new Set(tasks.filter(task => !unresolved(task)).slice(-100));
      db.exec("COMMIT");
      return { tasks: tasks.filter(task => unresolved(task) || recent.has(task)), error: warnings.length ? `${warnings[0]}（${warnings.length} 条）` : null };
    });
  }
  async function database(operation) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(directory, "jobs.sqlite"));
    try {
      db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS maintenance_control (token TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS maintenance_history (token TEXT PRIMARY KEY, pid INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS client_installer (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
      return operation(db);
    } finally { db.close(); }
  }
  const job = () => database((db) => { const row = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get(); return row ? { token: row.token, pid: row.pid, ...projectJob(row) } : null; });
  async function claim(kind, version) {
    const token = randomBytes(32).toString("hex");
    const budgets = await json(join(directory, "budgets.json"), budgetsDefault);
    if (!validBudgets(budgets)) throw Error("下载预算记录无效，请重新保存设置。");
    return database((db) => {
      db.exec("BEGIN IMMEDIATE");
      if (updaterOwnerPresent(root)) throw Error("已有更新进程、启动结果或父提交尚未确认，请先核实已有任务；归属记录已保留。");
      const old = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get();
      if (old && JSON.parse(old.body).reconciliation?.state === "release-pending") throw Error("中断核实尚未提交完成，请再次核实原任务。");
      const servicePending = !!(old && (JSON.parse(old.body).servicePending || JSON.parse(old.body).reconciliation?.servicePending));
      if (servicePending && kind !== "recover") throw Error("服务启动结果仍需核实，请先恢复旧版本。");
      if (old && (JSON.parse(old.body).task?.status === "unknown" || (JSON.parse(old.body).supervised || ['archive-preview', 'archive-remove'].includes(JSON.parse(old.body).kind)) && JSON.parse(old.body).running && !isAlive(old.pid))) throw Error("上次更新退出尚未确认，请先核实已有任务。");
      if (old && JSON.parse(old.body).running && isAlive(old.pid)) throw Error("已有更新正在进行，请等待完成。");
      if (old) {
        const previous = JSON.parse(old.body);
        // Migrate a legacy ready task before replacing the current task. The
        // artifact remains independently addressable; launch still rehashes it.
        if (previous.kind === 'client' && previous.phase === 'ready' && !previous.running) {
          const candidate = validateInstallerRecord({ version: previous.version, asset: previous.asset, taskId: previous.task?.id, readyAt: previous.updatedAt });
          if (candidate) db.prepare('INSERT OR IGNORE INTO client_installer VALUES(1,?)').run(JSON.stringify(candidate));
        }
        archiveJob(db, { ...old, body: JSON.stringify(projectJob(old, false)) });
      }
      const value = { kind, version, ...(['archive-remove'].includes(kind) ? { archiveCommit: 'not-started' } : {}), servicePending, task: desktopTask(kind, ['archive-remove', 'pi-uninstall', 'service-uninstall'].includes(kind) ? "uninstall" : ['archive-preview', 'pi-remove-preview', 'service-remove-preview'].includes(kind) ? "check" : kind === "client" ? "download" : "update", budgets), phase: "queued", running: true, message: "正在准备更新…", updatedAt: Date.now() };
      db.prepare("DELETE FROM maintenance_control").run();
      const body = JSON.stringify(value);
      db.prepare("INSERT OR REPLACE INTO job VALUES(1,?,?,?)").run(token, process.pid, body);
      archiveJob(db, { token, pid: process.pid, body });
      db.exec("COMMIT");
      return { token, pid: process.pid, ...value };
    });
  }
  async function reconcileArchive(payload) {
    const row = await database(db => {
      const current = db.prepare('SELECT token,pid,body FROM job WHERE id=1').get();
      return [current, ...db.prepare('SELECT token,pid,body FROM maintenance_history').all()].find(row => row && JSON.parse(row.body).task?.id === payload.id);
    });
    if (!row) return false;
    const value = JSON.parse(row.body);
    if (!['archive-preview', 'archive-remove'].includes(value.kind)) return false;
    if (value.reconciliation?.state === 'complete') return true;
    const release = await serviceAdmission(root);
    try {
      if (isAlive(row.pid) && value.running || updaterOwnerPresent(root)) throw Error('原任务或其他维护进程尚未退出，不能核实归档任务。');
      // No arbitrary commands are launched by archive jobs. The commit worker's
      // kernel lock proves it has exited even if its Node parent was killed.
      const receipt = value.kind === 'archive-remove' && value.archiveCommit !== 'not-started' ? archiveWorker({ root, taskId: value.task.id, op: 'inspect', directory: value.archiveDirectory, executable: env.AXIOM_DESKTOP_EXECUTABLE }) : { writerStopped: true, quarantine: false };
      if (!receipt.writerStopped) throw Error('归档执行器退出尚未确认。');
      const preview = await json(archivePreviewFile);
      if (preview) await atomic(archivePreviewFile, { ...preview, token: null });
      let retainedPath;
      if (value.kind === 'archive-remove' && value.archiveCommit !== 'not-started') {
        const id = JSON.parse(value.version || '{}').id;
        if (!/^[a-f0-9]{64}-axiom2\.tgz$/.test(id ?? '')) throw Error('原归档任务选择无效，请保留记录。');
        retainedPath = await lstat(join(directory, id)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      }
      value.running = false; value.phase = 'error';
      value.message = receipt.quarantine ? '中断任务已停止；隔离文件已保留，需单独核实，未宣称删除完成。' : retainedPath === false ? '中断任务已停止；原归档路径未发现，无法确认删除过程，请重新扫描。' : '中断任务已停止；未确认删除成功，请重新预览。';
      value.reconciliation = { state: 'complete', quarantine: receipt.quarantine, retainedPath };
      Object.assign(value.task, { status: 'failed', finishedAt: Date.now(), message: value.message, capabilities: { cancel: false, extend: false }, error: { code: 'operation', phase: value.task.phase, message: value.message } });
      await database(db => {
        db.exec('BEGIN IMMEDIATE');
        const latest = db.prepare('SELECT body FROM maintenance_history WHERE token=?').get(row.token);
        if (!latest || latest.body !== row.body) throw Error('原任务记录已变化，请重新读取。');
        const body = JSON.stringify(value);
        db.prepare('UPDATE job SET body=? WHERE id=1 AND token=?').run(body, row.token);
        archiveJob(db, { ...row, body }); db.exec('COMMIT');
      });
    } finally { release(); }
    return true;
  }
  async function reconcile(payload = {}) {
    if (await reconcileArchive(payload)) return status();
    const installed = await installation(true);
    const reconciler = await createUpdaterReconciler(root);
    const persist = (db, row, value) => {
      const body = JSON.stringify(value);
      db.prepare("UPDATE job SET body=? WHERE id=1 AND token=? AND pid=?").run(body, row.token, row.pid);
      archiveJob(db, { ...row, body });
    };
    const requested = row => {
      const value = row && JSON.parse(row.body);
      if (!value?.task || value.task.id !== payload.id) throw Error("要核实的更新任务已改变，请刷新任务记录。");
      return value;
    };
    try {
      await database(db => {
        db.exec("BEGIN IMMEDIATE");
        const row = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get(), value = requested(row);
        if (value.reconciliation?.state === "complete") { db.exec("COMMIT"); return; }
        if (value.reconciliation?.state !== "release-pending") {
          const plan = reconciler.inspect(row, transaction => { if (!installed) throw Error("后台安装记录缺失，无法核实服务事务。"); return validateTransaction(transaction, installed); });
          value.reconciliation = { state: "release-pending", plan, servicePending: plan.servicePending };
          value.servicePending = plan.servicePending;
          value.running = false; value.phase = "interrupted";
          value.message = plan.servicePending ? "原更新进程已退出，服务事务仍保留；请恢复旧版本。" : "原更新进程已退出；安装结果未确认，请重新检查。";
          Object.assign(value.task, { status: "interrupted", message: value.message, finishedAt: Date.now(), capabilities: { cancel: false, extend: false }, error: { code: "operation", phase: value.task.phase, message: value.message } });
          persist(db, row, value);
        }
        db.exec("COMMIT");
      });
      await database(db => {
        db.exec("BEGIN IMMEDIATE");
        const row = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get(), value = requested(row);
        if (value.reconciliation?.state === "complete") { db.exec("COMMIT"); return; }
        if (value.reconciliation?.state !== "release-pending") throw Error("中断核实提交状态已改变。");
        reconciler.publish(value.task);
        reconciler.release(value.reconciliation.plan, row);
        value.servicePending = value.reconciliation.servicePending;
        value.reconciliation = { state: "complete", servicePending: value.servicePending };
        persist(db, row, value);
        db.exec("COMMIT");
      });
    } finally { reconciler.dispose(); }
    return status();
  }
  async function progress(phase, message, extra = {}) {
    if (execution) {
      const mapped = ({ preparing: "installing", stopping: "installing", switching: "installing", starting: "validating", restoring: "installing", ready: "verifying", complete: "validating" })[phase] ?? phase;
      const safe = !["stopping", "switching", "starting", "restoring", "removing", "complete", "ready", "error"].includes(phase);
      if (!["complete", "ready", "error"].includes(phase)) await execution.phase(mapped, message, safe);
      execution.task.message = message;
    }
    // Hold the worker lease until the maintenance terminal snapshot is durable.
    const state = execution && extra.running === false ? { ...extra, running: true } : extra;
    await writeJob({ download: null, ...state, phase, message, updatedAt: Date.now(), ...(execution ? { task: structuredClone(execution.task) } : {}) });
  }
  async function installation(optional = false) {
    const value = await json(registration);
    if (!value && optional) return null;
    if (!value || !isAbsolute(value.node || "") || !isAbsolute(value.cli || "") || !await exists(value.node)) throw Error("请先安装 Node.js 22.19.0+ 和后台服务，再检查更新。");
    const packageRoot = dirname(dirname(value.cli));
    let managed = value.cli === join(packageRoot, "bin", "axiom2.mjs") && dirname(packageRoot).endsWith(`${process.platform === "win32" ? "\\" : "/"}@cosyeezz`) && dirname(dirname(packageRoot)).endsWith(`${process.platform === "win32" ? "\\" : "/"}node_modules`) && packageRoot.endsWith(`${process.platform === "win32" ? "\\" : "/"}axiom2`);
    if (await exists(packageRoot) && (await lstat(packageRoot)).isSymbolicLink()) managed = false;
    const pkg = await json(join(packageRoot, "package.json"));
    if (pkg && pkg.name !== "@cosyeezz/axiom2") managed = false;
    return { ...value, packageRoot, managed, version: pkg?.version || null };
  }
  function validateRelease(value) {
    if (!value || !versionPattern.test(value.version) || !Number.isFinite(value.checkedAt)) throw Error("请先检查更新。");
    for (const name of ["axiom2.tgz", "Axiom2.msi"]) {
      const asset = value.assets?.[name];
      if (asset && (asset.url !== `${base}v${value.version}/${name}` || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > 128 * 1024 * 1024)) throw Error("发布附件信息无效。");
    }
    if (!value.assets?.["axiom2.tgz"]) throw Error("此版本缺少后台服务安装包。");
    return value;
  }
  async function check() {
    const response = await network(api, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Axiom2-Desktop-Updater" } });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`检查更新失败（HTTP ${response.status}），请稍后重试。`), { code: "http" }); }
    const data = JSON.parse(await bounded(response, 1024 * 1024));
    const version = String(data.tag_name || "").replace(/^v/, "");
    if (data.tag_name !== `v${version}` || !versionPattern.test(version) || data.draft || data.prerelease || !Array.isArray(data.assets)) throw Error("发布版本信息无效。");
    const assets = {};
    for (const name of ["axiom2.tgz", "Axiom2.msi"]) {
      const matches = data.assets.filter((item) => item.name === name);
      if (matches.length > 1) throw Error("发布附件重复。");
      const item = matches[0];
      if (item) assets[name] = { url: item.browser_download_url, sha256: String(item.digest || "").replace(/^sha256:/, ""), size: item.size };
    }
    const release = validateRelease({ version, assets, checkedAt: Date.now() });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomic(releaseFile, release);
    return status();
  }
  async function bounded(response, limit) {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw Error("下载内容超过允许大小。"); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function download(release, name) {
    const asset = release.assets[name];
    if (!asset) throw Error("此版本尚未提供适用于本机的客户端安装包。");
    const destination = join(directory, `${asset.sha256}-${name}`);
    if (await exists(destination) && await validFile(destination, asset)) return destination;
    await progress("downloading", `正在下载 ${name}…`);
    const response = await (execution ? execution.fetch(asset.url, fetcher) : fetcher(asset.url, { signal: AbortSignal.timeout(120_000) }));
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`下载失败（HTTP ${response.status}），当前服务尚未更改。`), { code: "http" }); }
    const bytes = await bounded(response, asset.size);
    await progress("verifying", "正在校验安装包大小与 SHA-256…");
    if (bytes.length !== asset.size) throw Error(`${name} 大小不符：预期 ${asset.size} 字节，实际 ${bytes.length} 字节。已拒绝安装。`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.sha256) throw Error(`${name} SHA-256 不符：预期 ${asset.sha256}，实际 ${actual}。已拒绝安装，请重新下载。`);

    await writeFile(destination, bytes, { mode: 0o600 });
    return destination;
  }
  async function validFile(path, asset) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== asset.size) return false;
    const content = await readFile(path);
    return content.length === asset.size && createHash("sha256").update(content).digest("hex") === asset.sha256;
  }
  function validateInstallerRecord(value) {
    const asset = value?.asset;
    if (!value || !versionPattern.test(value.version) || !Number.isFinite(value.readyAt) || typeof value.taskId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.taskId) || asset?.url !== `${base}v${value.version}/Axiom2.msi` || !/^[a-f0-9]{64}$/.test(asset?.sha256) || !Number.isInteger(asset?.size) || asset.size < 1 || asset.size > 128 * 1024 * 1024) return null;
    return { version: value.version, asset: { url: asset.url, sha256: asset.sha256, size: asset.size }, taskId: value.taskId, readyAt: value.readyAt };
  }
  async function pendingInstaller(current) {
    const stored = await database(db => db.prepare('SELECT body FROM client_installer WHERE id=1').get());
    let candidate;
    try { candidate = stored ? validateInstallerRecord(JSON.parse(stored.body)) : current?.kind === 'client' && current.phase === 'ready' && !current.running ? validateInstallerRecord({ version: current.version, asset: current.asset, taskId: current.task?.id, readyAt: current.updatedAt }) : null; }
    catch { candidate = null; }
    return { candidate, body: stored?.body };
  }
  async function status() {
    const current = await job();
    const pending = await pendingInstaller(current);
    const clientInstaller = pending.candidate && await exists(join(directory, `${pending.candidate.asset.sha256}-Axiom2.msi`)) ? { version: pending.candidate.version, readyAt: pending.candidate.readyAt } : null;
    let installed, installationError;
    try { installed = await installation(true); }
    catch (error) {
      if (!['archive-preview', 'archive-remove'].includes(current?.kind)) throw error;
      installationError = error.message;
    }
    const release = await json(releaseFile);
    const recovery = !!await json(journalFile);
    if (current?.running && !isAlive(current.pid)) Object.assign(current, { running: false, phase: "interrupted", message: recovery ? "上次更新进程异常退出，请先恢复旧版本。" : "上次更新进程已退出，请检查当前版本后重试。" });
    if (current?.task && current.phase === "interrupted") { if (current.task.status !== "unknown") current.task.status = "interrupted"; current.task.capabilities = { cancel: false, extend: false }; }
    // Publish only the verified outcome, never the internal release plan or owner identity.
    if (current) { current.reconciled = current.reconciliation?.state === "complete" && !updaterOwnerPresent(root); delete current.pid; delete current.token; delete current.installer; delete current.reconciliation; }
    const pi = ['archive-preview', 'archive-remove'].includes(current?.kind) ? null : await piStatus();
    if (current?.kind === "pi" && ["failed", "cancelled", "unknown", "interrupted"].includes(current.task?.status) && pi.release && pi.release.token === current.version) pi.release.token = null;
    return { installationError, clientInstaller, archiveCleanup: await json(archivePreviewFile), pi, serviceRemoval: await json(serviceRemovalFile), serviceRemovalPending: await serviceRemovalPending(root), serviceVersion: installed?.version ?? null, managed: installed?.managed ?? false, release: release ? validateRelease(release) : null,
      job: current, budgets: await json(join(directory, "budgets.json"), budgetsDefault), recovery, log, execution: current?.kind === "pi" ? await logTail(log) : null };
  }
  async function npmCli(node) {
    const candidates = [join(dirname(node), "node_modules/npm/bin/npm-cli.js"), join(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js")];
    const paths = [...new Set([dirname(node), ...(environment.PATH || "").split(delimiter)])];
    for (const directory of paths) candidates.push(join(directory, "node_modules/npm/bin/npm-cli.js"));
    if (process.platform !== "win32") for (const directory of paths) {
      try { const target = await realpath(join(directory, "npm")); if (target.endsWith("npm-cli.js")) candidates.push(target); } catch {}
    }
    for (const candidate of candidates) if (await exists(candidate)) return resolve(candidate);
    throw Error("找不到 npm，请修复 Node.js 22.19.0+ 安装后重试。");
  }
  const control = async (installed, action, recovery = false) => {
    const options = { env: environment, timeoutMs: 55_000, recovery };
    const result = action === "start" && supervisor ? await supervisor.start(installed.node, [installed.cli, action, "--json"], options) : JSON.parse(await runCommand(installed.node, [installed.cli, action, "--json"], options));
    if (result.state === "error") throw Error(result.message || "服务操作失败");
    return result;
  };
  async function stopService(installed, recovery = false) {
    const before = await control(installed, "status", recovery);
    if (before.state === "unmanaged") throw Error("端口被其他服务占用，请先处理后重试。");
    const after = await control(installed, "stop", recovery);
    if (after.state !== "stopped") throw Error("尚未确认服务停止，未替换程序文件。");
    const until = Date.now() + 5000;
    while (before.pid && isAlive(before.pid)) { if (Date.now() > until) throw Error("服务进程尚未退出，未替换程序文件。"); await delay(50); }
  }
  // The existing launch protocol (including v0.2.3) recognizes this reservation.
  async function reserveService() {
    const file = join(root, "service-startup.sqlite");
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS startup (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL)");
      if (!db.prepare("INSERT OR IGNORE INTO startup VALUES(1,?,?)").run(owner.token, process.pid).changes) throw Error("另一服务正在启动，未切换版本。");
    } finally { db.close(); }
    try {
      // A concurrent daemon may have already become ready and dropped its
      // startup row. The reservation alone does not prove no service is live.
      const meta = await json(join(root, "service-control.json"));
      if (meta && (!Number.isInteger(meta.pid) || meta.pid < 1 || isAlive(meta.pid))) throw Error("服务实例已变化，尚未确认退出，未替换程序文件。");
    } catch (error) { await releaseService(); throw error; }
  }
  async function releaseService() {
    if (!await exists(join(root, "service-startup.sqlite"))) return;
    const db = new DatabaseSync(join(root, "service-startup.sqlite"));
    try { db.exec("PRAGMA busy_timeout=5000"); db.prepare("DELETE FROM startup WHERE token=? AND pid=?").run(owner.token, process.pid); }
    finally { db.close(); }
    await rm(join(root, `service-cancel-${owner.token}`), { force: true });
  }
  function validateTransaction(value, installed) {
    const parent = dirname(installed.packageRoot);
    if (!value || value.packageRoot !== installed.packageRoot || value.node !== installed.node || value.cli !== installed.cli ||
        !versionPattern.test(value.previousVersion) || typeof value.wasRunning !== "boolean" ||
        !/^[a-f0-9]{32}$/.test(value.id) || value.backup !== join(parent, `.axiom2-backup-${value.id}`) || value.stage !== join(parent, `.axiom2-update-${value.id}`)) throw Error("更新恢复记录无效，请使用安装命令修复。");
    return value;
  }
  async function verifyPreviousPackage(path, transaction) {
    const pkg = await json(join(path, "package.json"));
    if (pkg?.name !== "@cosyeezz/axiom2" || pkg.version !== transaction.previousVersion || !await exists(join(path, "bin/axiom2.mjs"))) {
      throw Error("旧程序版本与恢复记录不符，恢复未完成，请使用安装命令修复。");
    }
  }
  async function restore(installed) {
    const transaction = validateTransaction(await json(journalFile), installed);
    await progress("restoring", "正在恢复之前的服务版本…");
    if (await exists(transaction.backup)) {
      await verifyPreviousPackage(transaction.backup, transaction);
      // The candidate's version command can work even when its control module
      // cannot load. Use the verified backup to stop it before moving any files.
      const runner = { ...installed, cli: join(transaction.backup, "bin/axiom2.mjs") };
      await supervisor?.allowRecovery(runner.node, runner.cli);
      await stopService(runner, true);
      await reserveService();
      try {
        if (await exists(installed.packageRoot)) await rename(installed.packageRoot, join(transaction.stage, `failed-${randomBytes(8).toString("hex")}`));
        await rename(transaction.backup, installed.packageRoot);
      } finally { await releaseService(); }
    }
    await verifyPreviousPackage(installed.packageRoot, transaction);
    await atomic(registration, { node: installed.node, cli: installed.cli });
    if (transaction.wasRunning) {
      const result = await control(installed, "start");
      if (result.state !== "running") throw Error("旧版本已恢复，但服务尚未启动，请查看日志。");
      // Legacy backends do not report a running version. Verify it whenever the
      // protocol provides one, without making v0.2.x rollback impossible.
      if (result.version != null && result.version !== transaction.previousVersion) throw Error("运行中的服务版本与恢复记录不符，恢复尚未确认。");
    }
    supervisor?.confirmService();
    // Keep the transaction available until clearing the admission restriction
    // is durable. A failed DB commit must leave a valid recovery entry point.
    await writeJob({ servicePending: false });
    await rm(journalFile);
  }
  async function updateService(installed, release) {
    if (!installed.managed) throw Error("当前服务来自源码或非标准安装，请使用原安装方式更新。");
    if (!newer(release.version, installed.version)) throw Error("后台服务已是此版本或更新版本。");
    const archive = await download(release, "axiom2.tgz");
    const id = randomBytes(16).toString("hex");
    const stage = join(dirname(installed.packageRoot), `.axiom2-update-${id}`);
    const ready = join(stage, "ready");
    await mkdir(stage, { mode: 0o700 }); // Permission failure happens before stopping the service.
    await progress("preparing", "正在准备新版服务，当前服务仍可运行…");
    // Shallow keeps this direct package's complete dependency tree inside its
    // own node_modules, regardless of the user's default npm install strategy.
    // Move that tree intact; the staging prefix's self bin shims stay behind.
    await runCommand(installed.node, [await npmCli(installed.node), "install", "--prefix", stage, "--install-strategy=shallow", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--save=false", archive], installOptions());
    await rename(join(stage, "node_modules/@cosyeezz/axiom2"), ready);
    const pkg = await json(join(ready, "package.json"));
    if (pkg?.name !== "@cosyeezz/axiom2" || pkg.version !== release.version) throw Error("安装包版本不匹配，未更改当前服务。");
    const reported = await runCommand(installed.node, [join(ready, "bin/axiom2.mjs"), "--version"], inspectionOptions());
    if (reported !== release.version) throw Error("新版服务预检查失败，未更改当前服务。");
    const current = await control(installed, "status");
    if (!["running", "stopped"].includes(current.state)) throw Error("服务仍在启动或退出，请等待状态稳定后重试。");
    const transaction = { id, stage, backup: join(dirname(installed.packageRoot), `.axiom2-backup-${id}`), packageRoot: installed.packageRoot,
      node: installed.node, cli: installed.cli, previousVersion: installed.version, version: release.version, wasRunning: current.state === "running" };
    await atomic(journalFile, transaction);
    try {
      await progress("stopping", "正在关闭旧服务并保存任务状态…");
      await stopService(installed);
      await reserveService();
      try {
        if (await exists(join(root, `service-cancel-${owner.token}`))) throw Error("更新切换已被停止请求取消。");
        await progress("switching", "正在切换服务版本…");
        await rename(installed.packageRoot, transaction.backup);
        await rename(ready, installed.packageRoot);
      } finally { await releaseService(); }
      await progress("starting", "正在启动并验证新版服务…");
      const result = await control(installed, "start");
      if (result.state !== "running" || result.version !== release.version) throw Error("新版服务未通过启动验证。");
      await atomic(join(directory, "previous-version.json"), transaction);
      supervisor?.confirmService();
      await rm(journalFile);
      await progress("complete", `后台服务已更新至 ${release.version}，现在可以打开工作台。`, { running: false });
    } catch (error) {
      try { await restore(installed); }
      catch (recovery) { throw Error(`${error.message} 恢复尚未完成：${recovery.message}。请点击“恢复旧版本”；项目和会话数据不会被删除。`); }
      throw Error(`${error.message} 已恢复之前的服务程序。`);
    }
  }
  async function perform(kind, version) {
    if (kind === 'archive-preview') {
      await progress('checking', '正在核实后台下载归档…');
      await rm(archivePreviewFile, { force: true });
      const preview = await inspectArchives(root, { signal: execution.signal });
      await execution.tick(); execution.signal.throwIfAborted();
      await atomic(archivePreviewFile, { ...preview, taskId: execution.task.id, token: randomBytes(24).toString('hex'), checkedAt: Date.now() });
      await progress('complete', '归档清理范围已生成，请逐项确认。', { running: false }); return;
    }
    if (kind === 'archive-remove') {
      let consent;
      try { consent = JSON.parse(version); } catch { throw Error('请重新预览并确认归档清理。'); }
      const preview = await json(archivePreviewFile);
      if (!preview?.token || consent?.token !== preview.token || consent.confirm !== true || typeof consent.id !== 'string' || !preview.targets.some(item => item.id === consent.id)) throw Error('请重新预览并确认所选归档。');
      if (!(await history()).tasks.some(task => task.id === preview.taskId && task.resource === 'archive-preview' && task.status === 'succeeded')) throw Error('原归档预览未成功完成，请重新预览。');
      execution.signal.throwIfAborted();
      // Persist the directory binding before spawning any commit worker. Recovery
      // must lock and revoke in this same directory, never a replacement path.
      await writeJob({ archiveDirectory: preview.directory, archiveCommit: 'prepared' });
      await atomic(archivePreviewFile, { ...preview, token: null });
      const cleanup = await removeArchive({ root, preview, id: consent.id, taskId: execution.task.id, executable: env.AXIOM_DESKTOP_EXECUTABLE, signal: execution.signal, checkpoint: () => execution.tick(), progress });
      await writeJob({ cleanup });
      if (!cleanup.complete) throw Error('所选归档路径仍存在，请查看结果并重新核实。');
      await progress('complete', '所选下载归档已清理，其他残留见保留项。', { running: false }); return;
    }
    if (kind === 'service-remove-preview') {
      await progress('checking', '正在核实托管后台卸载范围…');
      await rm(serviceRemovalFile, { force: true });
      if (await json(journalFile)) throw Error('有未完成的后台更新，请先恢复旧版本。');
      const preview = await inspectServiceRemoval(root);
      await atomic(serviceRemovalFile, { ...preview, token: randomBytes(24).toString('hex'), checkedAt: Date.now() });
      await progress('complete', '后台卸载范围已生成，请确认后执行。', { running: false }); return;
    }
    if (kind === 'service-uninstall') {
      let consent;
      try { consent = JSON.parse(version); } catch { throw Error('请重新预览并确认后台卸载。'); }
      const preview = await json(serviceRemovalFile);
      if (!preview?.token || consent?.token !== preview.token || consent.confirm !== true) throw Error('请重新预览并确认后台卸载。');
      if (await json(journalFile)) throw Error('有未完成的后台更新，请先恢复旧版本。');
      if ((await inspectServiceRemoval(root)).identity !== preview.identity) throw Error('后台安装已变化，请重新预览。');
      await atomic(serviceRemovalFile, { ...preview, token: null });
      execution.signal.throwIfAborted();
      const cleanup = await removeManagedService({ root, preview, stop: stopService, reserve: reserveService, release: releaseService, progress });
      await writeJob({ cleanup });
      await progress('complete', '选定后台程序和入口已移除；数据及未核实残留见清理结果。', { running: false }); return;
    }
    if (kind === 'pi-remove-preview') {
      await progress('checking', '正在核实 Pi 卸载范围…');
      await rm(piRemovalFile, { force: true });
      const info = await piEnvironment();
      const preview = await inspectPiRemoval(info, await installation(true));
      await atomic(piRemovalFile, { ...preview, token: preview.installed === false ? null : randomBytes(24).toString('hex'), checkedAt: Date.now() });
      await progress('complete', preview.installed === false ? preview.message : 'Pi 卸载预览已生成；确认前不会删除程序。', { running: false });
      return;
    }
    if (["check", "pi-check", "pi-refresh"].includes(kind)) { await progress("checking", kind === "pi-refresh" ? "正在读取 Pi 安装状态…" : "正在查询发布版本…"); await (kind === "check" ? check() : kind === "pi-check" ? piCheck() : piStatus(true)); await progress("complete", kind === "pi-refresh" ? "Pi 安装状态读取完成。" : "版本检查完成。", { running: false }); return; }
    if (kind === "pi" || kind === 'pi-uninstall') {
      const removing = kind === 'pi-uninstall';
      await progress("checking", "正在核实终端 pi 安装位置和版本…");
      const info = await piEnvironment();
      let removal;
      if (removing) {
        let confirmation;
        try { confirmation = JSON.parse(version); } catch { throw Error('请重新预览并确认 Pi 卸载。'); }
        removal = await json(piRemovalFile);
        if (!removal?.token || confirmation?.token !== removal.token || confirmation.confirm !== true || confirmation.sessionsClosed !== true) throw Error('请重新预览并确认已关闭相关终端会话。');
        if ((await inspectPiRemoval(info, await installation(true))).identity !== removal.identity) throw Error('Pi 安装或命令入口已改变，请重新预览。');
      } else {
        const release = await json(piReleaseFile);
        if (!release || version !== release.token || !versionPattern.test(release.version)) throw Error("请先检查 pi 版本，再确认升级。");
        version = release.version;
        if (info.identity !== release.identity) throw Error("终端安装位置或版本已改变，请重新检查 pi 更新。");
        if (info.legacy) throw Error("检测到旧命名空间的 pi 安装，请先用原安装方式迁移，避免覆盖同名命令。");
        if (info.version && info.version !== version && !newer(version, info.version)) throw Error("当前 pi 高于已检查版本，未执行降级。");
      }
      const parent = dirname(info.packageRoot);
      await mkdir(parent, { recursive: true });
      const lock = join(await realpath(parent), ".axiom-pi-update.lock");
      const staging = join(dirname(lock), `.axiom-pi-update-${owner.token}.lock`);
      const body = JSON.stringify({ pid: process.pid, root, token: owner.token, taskId: execution.task.id, attemptId: execution.task.attemptId, ...supervisor?.identity() });
      // Publish only a complete, flushed inode. The manifest binds that inode
      // before the atomic no-replace link makes it the shared admission lock.
      const handle = await open(staging, "wx", 0o600);
      let identity;
      try { await handle.writeFile(body); await handle.sync(); identity = await handle.stat({ bigint: true }); }
      finally { await handle.close(); }
      const lockRecord = { path: lock, staging, identity: { dev: String(identity.dev), ino: String(identity.ino) }, body };
      supervisor?.bindPiLock(lockRecord);
      try { await link(staging, lock); }
      catch (error) {
        await rm(staging); supervisor?.bindPiLock(null);
        throw Error(`该 Pi 安装正在被其他更新任务使用，或目录不可写：${error.code ?? error.message}。请先核实原任务。`);
      }
      pendingPiLock = lockRecord;
      if (process.platform !== "win32") { const dir = await open(dirname(lock), "r"); try { await dir.sync(); } finally { await dir.close(); } }
      {
        if ((await piEnvironment()).identity !== info.identity) throw Error("终端 pi 在准备期间改变，请重新检查。");
        if (removing) {
          if ((await inspectPiRemoval(info, await installation(true))).identity !== removal.identity) throw Error('Pi 安装或命令入口已改变，请重新预览。');
          // Consume confirmation before npm. A lost response must never replay a deletion.
          await atomic(piRemovalFile, { ...removal, token: null });
          await rm(piReleaseFile, { force: true });
          await atomic(join(directory, 'pi-installation.json'), { error: 'Pi 卸载已开始，安装状态待核实。' });
          execution.signal.throwIfAborted();
          await progress('removing', '正在卸载已确认的终端 Pi…');
          await runCommand(info.installed.node, [info.npm, 'uninstall', '--global', '--prefix', info.prefix, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', piPackage], { ...installOptions(), cwd: info.prefix });
          await progress('validating', '正在复查程序和命令入口…');
          const cleanup = await verifyPiRemoval(removal);
          await writeJob({ cleanup });
          await piStatus(true);
          if (!cleanup.complete) throw Error('npm 已结束，但仍有程序或命令残留；请查看清理结果并重新预览。');
          await progress('complete', '所选终端 Pi 程序已卸载；设置、共享缓存及未核实项目见清理结果。', { running: false });
          return;
        }
        await atomic(piValidationFile, { packageRoot: info.packageRoot, version, startedAt: Date.now() });
        await progress("installing", `正在安装终端 pi ${version}…`);
        await runCommand(info.installed.node, [info.npm, "install", "--global", "--prefix", info.prefix, "--bin-links=true", "--ignore-scripts", "--loglevel=http", "--engine-strict", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", "--@earendil-works:registry=https://registry.npmjs.org", `${piPackage}@${version}`], installOptions());
        const actual = await piEnvironment();
        if (actual.version !== version) throw Error("安装后的 pi 版本未通过校验，请重新读取状态。");
        const pkg = await json(join(actual.packageRoot, "package.json"));
        const entry = pkg?.bin?.pi;
        const cli = typeof entry === "string" ? resolve(actual.packageRoot, entry) : "";
        if (actual.repairRequired) throw Error("pi 命令入口不完整，请重新检查并安装。");
        await progress("verifying", `正在验证终端 pi ${version}…`);
        const reported = await runCommand(info.installed.node, [cli, "--version"], inspectionOptions());
        if (reported !== version) throw Error("终端 pi 未通过运行验证，请查看安装环境后重试。");
        await rm(piValidationFile, { force: true });
        await piStatus(true);
        await progress("complete", `终端 pi 已安装至 ${version}；重新打开终端会话后生效。应用内 pi 随后台服务更新。`, { running: false });
      }
      return;
    }
    const installed = await installation();
    if (kind === "recover") {
      await restore(installed);
      await progress("complete", "之前的服务程序已恢复。", { running: false, servicePending: false });
      return;
    }
    if (await json(journalFile)) throw Error("上次更新尚未恢复，请先恢复旧版本。");
    const release = validateRelease(await json(releaseFile));
    if (version !== release.version) throw Error("更新版本已变化，请重新检查并确认。");
    if (kind === "service") await updateService(installed, release);
    else if (kind === "client") {
      const installer = await download(release, "Axiom2.msi");
      const artifact = { version: release.version, asset: release.assets['Axiom2.msi'], taskId: execution.task.id, readyAt: Date.now() };
      await database(db => db.prepare('INSERT OR REPLACE INTO client_installer VALUES(1,?)').run(JSON.stringify(artifact)));
      await progress("ready", "客户端安装包已校验，点击“运行安装器”继续。", { running: false, installer, asset: release.assets["Axiom2.msi"] });
    } else throw Error("不支持的更新任务");
  }
  async function releasePiLock() {
    if (!pendingPiLock) return;
    const { path, staging, identity, body } = pendingPiLock;
    for (const file of [path, staging]) {
      const current = await lstat(file, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 2n || String(current.dev) !== identity.dev || String(current.ino) !== identity.ino || await readFile(file, "utf8") !== body) throw Object.assign(Error("Pi 安装锁身份已改变，已保留归属记录。"), { code: "stop-unconfirmed" });
    }
    await rm(path); await rm(staging); pendingPiLock = undefined;
  }
  async function runJob(kind, version, claimed) {
    owner = claimed || await claim(kind, version);
    execution = new DesktopExecution(owner.task, task => writeJob({ task }), () => database(db => { const value = db.prepare("SELECT body FROM maintenance_control WHERE token=?").get(owner.token); return value ? JSON.parse(value.body) : null; }));
    let failure, releaseAdmission;
    try {
      if (['archive-preview', 'archive-remove', 'service', 'recover', 'service-remove-preview', 'service-uninstall'].includes(kind)) {
        releaseAdmission = await serviceAdmission(root);
        if (await exists(join(root, 'setup/service-owner.json'))) throw Error('后台安装归属尚未解除，请先核实安装任务。');
        if (!['service-remove-preview', 'service-uninstall'].includes(kind) && await serviceRemovalPending(root)) throw Error('后台卸载尚未完成，请重新预览并完成清理。');
      }
      if (['archive-preview', 'archive-remove'].includes(kind)) {
        const records = await history();
        if (records.error || records.tasks.some(task => task.id !== execution.task.id && ['running', 'cancelling', 'unknown', 'interrupted'].includes(task.status))) throw Error('仍有维护任务结果未核实，请先处理维护记录后清理归档。');
      }
      if (command === execute && !['archive-preview', 'archive-remove'].includes(kind)) { supervisor = createUpdaterSupervisor({ root, execution, token: owner.token, fetcher, log, offline: ['pi-remove-preview', 'pi-uninstall', 'service-remove-preview', 'service-uninstall'].includes(kind) }); await supervisor.prepare(); await writeJob({ supervised: true }); }
      await writeFile(log, "", { mode: 0o600 });
      await perform(kind, version);
    }
    catch (error) {
      failure = error.code === "stop-unconfirmed" ? error : execution.signal.aborted ? execution.signal.reason : error;
      if (kind === 'service-uninstall') {
        try {
          const preview = await json(serviceRemovalFile);
          if (preview) {
            await atomic(serviceRemovalFile, { ...preview, token: null });
            const journal = await json(join(directory, 'service-removal-journal.json'));
            const quarantine = /^[a-f0-9]{32}$/.test(journal?.id) ? join(root, 'service', `.axiom2-remove-${journal.id}`) : undefined;
            await writeJob({ cleanup: await verifyServiceRemoval({ root, quarantine }) });
          }
        } catch { /* Preserve primary failure; no successful cleanup claim. */ }
      }
      if (kind === 'pi-uninstall') {
        try {
          const removal = await json(piRemovalFile);
          if (removal && removal.installed !== false) {
            await atomic(piRemovalFile, { ...removal, token: null });
            if (!supervisor?.uncertain()) await writeJob({ cleanup: await verifyPiRemoval(removal) });
            if (!supervisor?.uncertain() && !execution.signal.aborted) await piStatus(true);
          }
        } catch (error) { supervisor?.retain(); failure = Object.assign(Error(`Pi 清理结果未能保存：${error.message}`), { code: 'stop-unconfirmed' }); }
      }
      if (kind === "pi") {
        try { const release = await json(piReleaseFile); if (release && release.token === owner.version) await atomic(piReleaseFile, { ...release, token: null }); }
        catch (error) { supervisor?.retain(); failure = Object.assign(Error(`Pi 更新确认状态未能保存：${error.message}`), { code: "stop-unconfirmed" }); }
        if (!supervisor?.uncertain() && !execution.signal.aborted) await piStatus(true).catch(() => {});
      }
      await progress("error", failure.message, { running: false });
    }
    finally {
      try {
        await execution.finish(failure);
        if (kind === 'archive-preview' && execution.task.status !== 'succeeded') {
          const preview = await json(archivePreviewFile);
          if (preview) await atomic(archivePreviewFile, { ...preview, token: null });
        }
        await writeJob({ running: false });
        if (!supervisor?.uncertain() && execution.task.status !== "unknown") { await releasePiLock(); await supervisor?.release(); }
      } catch (error) {
        supervisor?.retain();
        execution.task.status = "unknown"; execution.task.capabilities = { cancel: false, extend: false };
        execution.task.error = { code: "stop-unconfirmed", phase: execution.task.phase, message: "更新终态或安装锁提交尚未确认，已保留归属记录。" };
        await writeJob({ running: false, task: structuredClone(execution.task) }).catch(() => {});
        throw error;
      }
      finally { execution = undefined; supervisor = undefined; pendingPiLock = undefined; try { await releaseService(); } finally { releaseAdmission?.(); } }
    }
    return status();
  }
  async function start(kind, version) {
    if (!["archive-preview", "archive-remove", "service", "service-remove-preview", "service-uninstall", "client", "recover", "pi", "pi-uninstall", "pi-remove-preview", "check", "pi-check", "pi-refresh"].includes(kind)) throw Error("不支持的更新任务");
    if (kind === "pi") await piEnvironment();
    else if (!["archive-preview", "archive-remove", "service-remove-preview", "service-uninstall", "pi-check", "pi-refresh", "pi-uninstall", "pi-remove-preview", "check"].includes(kind)) await installation();
    const reserved = await claim(kind, version);
    let child, transferred = false;
    try {
      child = spawn(process.execPath, [script, "worker", reserved.token], { env: environment, detached: true, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      const changed = await database((db) => db.prepare("UPDATE job SET pid=? WHERE token=? AND pid=?").run(child.pid, reserved.token, process.pid));
      if (!changed.changes) throw Error("更新任务归属已变化");
      transferred = true;
      await new Promise((resolve, reject) => child.send(reserved.token, (error) => error ? reject(error) : resolve()));
      child.unref();
    } catch (error) {
      if (child?.connected) child.disconnect();
      if (child) child.kill();
      await database(db => {
        db.exec("BEGIN IMMEDIATE");
        const row = db.prepare("SELECT token,pid,body FROM job WHERE token=?").get(reserved.token);
        if (row && [process.pid, child?.pid].includes(row.pid)) {
          const value = JSON.parse(row.body);
          if (value.running) {
            value.running = false; value.phase = transferred ? "interrupted" : "error"; value.message = error.message;
            value.task.status = transferred ? "unknown" : "failed"; value.task.capabilities = { cancel: false, extend: false };
            value.task.error = { code: transferred ? "stop-unconfirmed" : "operation", phase: value.task.phase, message: error.message };
            const body = JSON.stringify(value);
            db.prepare("UPDATE job SET body=? WHERE token=? AND pid=?").run(body, row.token, row.pid);
            archiveJob(db, { ...row, body });
          }
        }
        db.exec("COMMIT");
      });
      throw error;
    }
    return status();
  }
  async function worker(token) {
    await new Promise((resolve, reject) => {
      if (!process.connected) { reject(Error("更新启动器已退出")); return; }
      const lost = () => reject(Error("更新启动器已退出"));
      process.once("disconnect", lost);
      process.once("message", (value) => { process.removeListener("disconnect", lost); if (value === token) resolve(); else reject(Error("更新握手无效")); });
    });
    process.disconnect();
    const current = await job();
    if (current?.token !== token || current.pid !== process.pid) throw Error("更新任务归属已变化");
    await runJob(current.kind, current.version, current);
  }
  async function installer() {
    const current = await job();
    const { candidate, body } = await pendingInstaller(current);
    const path = candidate ? join(directory, `${candidate.asset.sha256}-Axiom2.msi`) : null;
    if (!candidate || !await validFile(path, candidate.asset).catch(() => false)) {
      const message = "安装包已变化或不可用，请重新下载。";
      if (body !== undefined) await database(db => db.prepare('DELETE FROM client_installer WHERE id=1 AND body=?').run(body));
      if (current?.kind === "client" && current.phase === "ready" && !current.running && (!candidate || current.task?.id === candidate.taskId)) {
        const body = { ...current, phase: "error", message };
        delete body.token; delete body.pid; delete body.installer;
        if (body.task) { body.task.status = "failed"; body.task.message = message; body.task.error = { code: "operation", phase: "verifying", message }; body.task.capabilities = { cancel: false, extend: false }; }
        await database((db) => {
          db.exec("BEGIN IMMEDIATE");
          const text = JSON.stringify(body), changed = db.prepare("UPDATE job SET body=? WHERE token=? AND pid=?").run(text, current.token, current.pid);
          if (changed.changes) archiveJob(db, { token: current.token, pid: current.pid, body: text });
          db.exec("COMMIT");
        });
      }
      throw Error(message);
    }
    if (body === undefined) await database(db => db.prepare('INSERT OR IGNORE INTO client_installer VALUES(1,?)').run(JSON.stringify(candidate)));
    return { installer: path };
  }
  return { reconcile, history, maintenanceControl, check, piCheck, piRefresh, status, start, worker, runJob, installer, busy: async () => { const current = await job(); return { busy: updaterOwnerPresent(root) || current?.reconciliation?.state === "release-pending" || current?.servicePending || current?.reconciliation?.servicePending || current?.task?.status === "unknown" || !!(current?.running && current.kind !== "client" && isAlive(current.pid)) }; } };
}
if (process.argv[1] && resolve(process.argv[1]) === script) {
  try {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw Error("需要 Node.js 22.19.0+。");
    const updater = createUpdater({ root: process.env.AXIOM_DATA_DIR });
    const [action, argument] = process.argv.slice(2);
    let value;
    if (["archive-preview", "pi-refresh", "pi-remove-preview", "service-remove-preview"].includes(action)) value = await updater.start(action);
    else if (action === "reconcile") value = await updater.reconcile(JSON.parse(argument || "{}"));
    else if (["cancel", "extend", "defaults"].includes(action)) value = await updater.maintenanceControl(action, JSON.parse(argument || "{}"));
    else if (["check", "pi-check"].includes(action)) value = await updater.start(action);
    else if (["status", "history", "installer", "busy"].includes(action)) value = await updater[action]();
    else if (["archive-remove", "service", "service-uninstall", "client", "recover", "pi", "pi-uninstall"].includes(action)) value = await updater.start(action, argument);
    else if (action === "worker") { await updater.worker(argument); process.exit(0); }
    else throw Error("不支持的更新操作");
    console.log(JSON.stringify(value));
  } catch (error) { console.log(JSON.stringify({ state: "error", message: error.message })); process.exitCode = 1; }
}
