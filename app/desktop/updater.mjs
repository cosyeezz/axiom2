// Bundled with the desktop client; uses only Node.js built-ins so old backends can update.
import { readFile, writeFile, mkdir, rename, rm, open, access, lstat, realpath } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
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
// Atomic visibility for process recovery; not a power-loss durability guarantee.
async function atomic(path, value) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
export async function execute(node, args, { env = process.env, timeoutMs = 60_000, log } = {}) {
  const output = log ? await open(log, "a", 0o600) : null;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(node, args, { env, windowsHide: true, stdio: ["ignore", output?.fd ?? "pipe", output?.fd ?? "pipe"] });
      let text = "", errorText = "", oversized = false;
      child.stdout?.on("data", (data) => { text += data; if (text.length > 65536) { oversized = true; child.kill(); } });
      child.stderr?.on("data", (data) => { if (errorText.length < 4096) errorText += data; });
      const timer = setTimeout(() => { child.kill(); }, timeoutMs);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (code !== 0 || oversized || signal) reject(Error(log ? `安装未完成，请查看更新日志：${log}` : text.trim() || errorText.trim() || "服务操作失败或超时"));
        else resolve(text.trim());
      });
    });
  } finally { await output?.close(); }
}
export function createUpdater({ root, fetcher = fetch, command = execute, isAlive = alive, api = RELEASE_API, base = RELEASE_BASE, env = process.env } = {}) {
  if (!root || !isAbsolute(root)) throw Error("缺少绝对数据目录");
  const directory = join(root, "updates");
  const registration = join(root, "installation.json");
  const releaseFile = join(directory, "release.json");
  const journalFile = join(directory, "transaction.json");
  const log = join(directory, "update.log");
  const piReleaseFile = join(directory, "pi-release.json");
  const piPackage = "@earendil-works/pi-coding-agent";
  async function piEnvironment() {
    const installed = await installation();
    const npm = await npmCli(installed.node);
    const modules = await command(installed.node, [npm, "root", "--global"], { env: environment, timeoutMs: 20000 });
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
    return { installed, npm, prefix, identity, packageRoot, version: pkg?.version ?? null, legacy: !!legacy };
  }
  async function piStatus(refresh = false) {
    let runtimeVersion = null;
    const installed = await installation();
    try {
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
      try { const info = await piEnvironment(); cli = { version: info.version, packageRoot: info.packageRoot, legacy: info.legacy, identity: info.identity }; }
      catch { cli = { error: "无法读取此 Node.js 对应的 npm 全局 pi，请检查运行环境。" }; }
      await mkdir(directory, { recursive: true });
      await atomic(join(directory, "pi-installation.json"), cli);
    }
    let release = null;
    try { release = await json(piReleaseFile); } catch { /* Explicit check replaces an unreadable optional cache. */ }
    // Keep the latest version visible, but require a new confirmation after the
    // inspected installation changes, including a partially completed install.
    if (release && cli?.identity !== release.identity) release = { ...release, token: null };
    return { runtimeVersion, cli, release };
  }
  async function piRefresh() { await piStatus(true); return status(); }
  async function piCheck() {
    await piStatus(true);
    const response = await fetcher(`https://registry.npmjs.org/${piPackage}/latest`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`pi 版本查询失败（HTTP ${response.status}）。`);
    const pkg = JSON.parse(await bounded(response, 1024 * 1024));
    if (pkg.name !== piPackage || !versionPattern.test(pkg.version)) throw Error("npm 未返回有效的 pi 稳定版本。");
    await mkdir(directory, { recursive: true });
    const cli = await json(join(directory, "pi-installation.json"));
    if (!cli?.identity || cli.error) throw Error("请先修复终端 pi 安装环境，再检查更新。");
    await atomic(piReleaseFile, { version: pkg.version, checkedAt: Date.now(), token: randomBytes(24).toString("hex"), identity: cli.identity });
    return status();
  }
  const environment = { ...env, AXIOM_DATA_DIR: root };
  let owner;
  async function database(operation) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(directory, "jobs.sqlite"));
    try {
      db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL, body TEXT NOT NULL)");
      return operation(db);
    } finally { db.close(); }
  }
  const job = () => database((db) => { const row = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get(); return row ? { token: row.token, pid: row.pid, ...JSON.parse(row.body) } : null; });
  async function claim(kind, version) {
    const token = randomBytes(32).toString("hex");
    return database((db) => {
      db.exec("BEGIN IMMEDIATE");
      const old = db.prepare("SELECT pid,body FROM job WHERE id=1").get();
      if (old && JSON.parse(old.body).running && isAlive(old.pid)) throw Error("已有更新正在进行，请等待完成。");
      const value = { kind, version, phase: "queued", running: true, message: "正在准备更新…", updatedAt: Date.now() };
      db.prepare("INSERT OR REPLACE INTO job VALUES(1,?,?,?)").run(token, process.pid, JSON.stringify(value));
      db.exec("COMMIT");
      return { token, pid: process.pid, ...value };
    });
  }
  async function progress(phase, message, extra = {}) {
    const current = await job();
    if (current?.token !== owner?.token || current.pid !== process.pid) throw Error("更新任务归属已变化");
    const value = { ...current, ...extra, phase, message, updatedAt: Date.now() };
    delete value.token; delete value.pid;
    await database((db) => db.prepare("UPDATE job SET body=? WHERE token=? AND pid=?").run(JSON.stringify(value), owner.token, process.pid));
  }
  async function installation() {
    const value = await json(registration);
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
    const response = await fetcher(api, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Axiom2-Desktop-Updater" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw Error(`检查更新失败（HTTP ${response.status}），请稍后重试。`);
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
    const response = await fetcher(asset.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw Error(`下载失败（HTTP ${response.status}），当前服务尚未更改。`);
    const bytes = await bounded(response, asset.size);
    if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw Error("安装包校验失败，已拒绝安装。请重新检查更新。");
    await writeFile(destination, bytes, { mode: 0o600 });
    return destination;
  }
  async function validFile(path, asset) {
    const content = await readFile(path);
    return content.length === asset.size && createHash("sha256").update(content).digest("hex") === asset.sha256;
  }
  async function status() {
    const installed = await installation();
    const release = await json(releaseFile);
    const current = await job();
    const recovery = !!await json(journalFile);
    if (current?.running && !isAlive(current.pid)) Object.assign(current, { running: false, phase: "interrupted", message: recovery ? "上次更新进程异常退出，请先恢复旧版本。" : "上次更新进程已退出，请检查当前版本后重试。" });
    if (current) { delete current.pid; delete current.token; delete current.installer; }
    return { pi: await piStatus(), serviceVersion: installed.version, managed: installed.managed, release: release ? validateRelease(release) : null,
      job: current, recovery, log };
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
  const control = async (installed, action) => {
    const result = JSON.parse(await command(installed.node, [installed.cli, action, "--json"], { env: environment, timeoutMs: 55_000 }));
    if (result.state === "error") throw Error(result.message || "服务操作失败");
    return result;
  };
  async function stopService(installed) {
    const before = await control(installed, "status");
    if (before.state === "unmanaged") throw Error("端口被其他服务占用，请先处理后重试。");
    const after = await control(installed, "stop");
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
      await stopService(runner);
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
    await command(installed.node, [await npmCli(installed.node), "install", "--prefix", stage, "--install-strategy=shallow", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--save=false", archive], { env: environment, timeoutMs: 600_000, log });
    await rename(join(stage, "node_modules/@cosyeezz/axiom2"), ready);
    const pkg = await json(join(ready, "package.json"));
    if (pkg?.name !== "@cosyeezz/axiom2" || pkg.version !== release.version) throw Error("安装包版本不匹配，未更改当前服务。");
    const reported = await command(installed.node, [join(ready, "bin/axiom2.mjs"), "--version"], { env: environment });
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
      await rm(journalFile);
      await progress("complete", `后台服务已更新至 ${release.version}，现在可以打开工作台。`, { running: false });
    } catch (error) {
      try { await restore(installed); }
      catch (recovery) { throw Error(`${error.message} 恢复尚未完成：${recovery.message}。请点击“恢复旧版本”；项目和会话数据不会被删除。`); }
      throw Error(`${error.message} 已恢复之前的服务程序。`);
    }
  }
  async function perform(kind, version) {
    const installed = await installation();
    if (kind === "pi") {
      const release = await json(piReleaseFile);
      if (!release || version !== release.token || !versionPattern.test(release.version)) throw Error("请先检查 pi 版本，再确认升级。");
      version = release.version;
      const info = await piEnvironment();
      if (info.identity !== release.identity) throw Error("终端安装位置或版本已改变，请重新检查 pi 更新。");
      if (info.legacy) throw Error("检测到旧命名空间的 pi 安装，请先用原安装方式迁移，避免覆盖同名命令。");
      if (info.version && info.version !== version && !newer(version, info.version)) throw Error("当前 pi 高于已检查版本，未执行降级。");
      const lock = join(dirname(info.packageRoot), ".axiom-pi-update.lock");
      await mkdir(dirname(lock), { recursive: true });
      let handle;
      try { handle = await open(lock, "wx", 0o600); }
      catch { throw Error("该 pi 安装正在被其他更新任务使用，或目录不可写。若更新进程已异常退出，请检查并移除安装目录旁的 .axiom-pi-update.lock 后重试。"); }
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, root }));
        if ((await piEnvironment()).identity !== info.identity) throw Error("终端 pi 在准备期间改变，请重新检查。");
        await progress("installing", `正在安装终端 pi ${version}…`);
        await command(installed.node, [info.npm, "install", "--global", "--prefix", info.prefix, "--bin-links=true", "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", "--@earendil-works:registry=https://registry.npmjs.org", `${piPackage}@${version}`], { env: environment, timeoutMs: 600000, log });
        const actual = await piEnvironment();
        if (actual.version !== version) throw Error("安装后的 pi 版本未通过校验，请重新读取状态。");
        const pkg = await json(join(actual.packageRoot, "package.json"));
        const entry = pkg?.bin?.pi;
        const cli = typeof entry === "string" ? resolve(actual.packageRoot, entry) : "";
        const shim = process.platform === "win32" ? join(actual.prefix, "pi.cmd") : join(actual.prefix, "bin/pi");
        if (!cli.startsWith(`${actual.packageRoot}${sep}`) || !await exists(cli) || !await exists(shim)) throw Error("pi 命令入口不完整，请重新检查并安装。");
        await progress("verifying", `正在验证终端 pi ${version}…`);
        const reported = await command(installed.node, [cli, "--version"], { env: environment, timeoutMs: 20000 });
        if (reported !== version) throw Error("终端 pi 未通过运行验证，请查看安装环境后重试。");
        await piStatus(true);
        await progress("complete", `终端 pi 已安装至 ${version}；重新打开终端会话后生效。应用内 pi 随后台服务更新。`, { running: false });
      } finally { await handle.close(); await rm(lock, { force: true }); }
      return;
    }
    if (kind === "recover") {
      await restore(installed);
      await progress("complete", "之前的服务程序已恢复。", { running: false });
      return;
    }
    if (await json(journalFile)) throw Error("上次更新尚未恢复，请先恢复旧版本。");
    const release = validateRelease(await json(releaseFile));
    if (version !== release.version) throw Error("更新版本已变化，请重新检查并确认。");
    if (kind === "service") await updateService(installed, release);
    else if (kind === "client") {
      const installer = await download(release, "Axiom2.msi");
      await progress("ready", "客户端安装包已校验，点击“运行安装器”继续。", { running: false, installer, asset: release.assets["Axiom2.msi"] });
    } else throw Error("不支持的更新任务");
  }
  async function runJob(kind, version, claimed) {
    owner = claimed || await claim(kind, version);
    try { await perform(kind, version); }
    catch (error) { if (kind === "pi") await piStatus(true).catch(() => {}); await progress("error", error.message, { running: false }); }
    finally { await releaseService(); }
    return status();
  }
  async function start(kind, version) {
    if (!["service", "client", "recover", "pi"].includes(kind)) throw Error("不支持的更新任务");
    await installation();
    const reserved = await claim(kind, version);
    const output = await open(log, "a", 0o600);
    let child;
    try {
      child = spawn(process.execPath, [script, "worker", reserved.token], { env: environment, detached: true, windowsHide: true, stdio: ["ignore", output.fd, output.fd, "ipc"] });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      const changed = await database((db) => db.prepare("UPDATE job SET pid=? WHERE token=? AND pid=?").run(child.pid, reserved.token, process.pid));
      if (!changed.changes) throw Error("更新任务归属已变化");
      await new Promise((resolve, reject) => child.send(reserved.token, (error) => error ? reject(error) : resolve()));
      child.unref();
    } catch (error) {
      if (child?.connected) child.disconnect();
      if (child) child.kill();
      owner = reserved;
      await progress("error", error.message, { running: false }).catch(() => {});
      throw error;
    } finally { await output.close(); }
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
    if (current?.kind !== "client" || current.phase !== "ready" || current.running || current.installer !== join(directory, `${current.asset?.sha256}-Axiom2.msi`) || !/^[a-f0-9]{64}$/.test(current.asset?.sha256) || !await validFile(current.installer, current.asset).catch(() => false)) {
      const message = "安装包已变化或不可用，请重新下载。";
      if (current?.kind === "client" && current.phase === "ready" && !current.running) {
        const body = { ...current, phase: "error", message };
        delete body.token; delete body.pid; delete body.installer;
        await database((db) => db.prepare("UPDATE job SET body=? WHERE token=? AND pid=?").run(JSON.stringify(body), current.token, current.pid));
      }
      throw Error(message);
    }
    return { installer: current.installer };
  }
  return { check, piCheck, piRefresh, status, start, worker, runJob, installer, busy: async () => { const current = await job(); return { busy: !!(current?.running && current.kind !== "client" && isAlive(current.pid)) }; } };
}
if (process.argv[1] && resolve(process.argv[1]) === script) {
  try {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw Error("需要 Node.js 22.19.0+。");
    const updater = createUpdater({ root: process.env.AXIOM_DATA_DIR });
    const [action, argument] = process.argv.slice(2);
    let value;
    if (action === "pi-refresh") value = await updater.piRefresh();
    else if (action === "pi-check") value = await updater.piCheck();
    else if (["status", "check", "installer", "busy"].includes(action)) value = await updater[action]();
    else if (["service", "client", "recover", "pi"].includes(action)) value = await updater.start(action, argument);
    else if (action === "worker") { await updater.worker(argument); process.exit(0); }
    else throw Error("不支持的更新操作");
    console.log(JSON.stringify(value));
  } catch (error) { console.log(JSON.stringify({ state: "error", message: error.message })); process.exitCode = 1; }
}
