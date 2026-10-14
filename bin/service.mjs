import { createServer } from "node:http";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm, open, stat } from "node:fs/promises";
import { existsSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const root = resolve(process.env.AXIOM_DATA_DIR || (process.platform === "win32"
  ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Axiom2")
  : process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Axiom2")
  : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Axiom2")));
const descriptor = join(root, "service-control.json");
const startupFile = join(root, "service-startup.sqlite");
const cli = fileURLToPath(new URL("./axiom2.mjs", import.meta.url));
const port = Number(process.env.AXIOM_PORT ?? 4317);
const log = join(root, "service.log");
const stopped = () => ({ state: "stopped", active: [], log });
const cancellation = (token) => join(root, `service-cancel-${token}`);

async function atomicJson(path, value) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export async function registerInstallation() {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await atomicJson(join(root, "installation.json"), { node: process.execPath, cli });
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function metadata() {
  try {
    const value = await readJson(descriptor);
    if (!value || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token)) return null;
    return value;
  } catch { return null; }
}
function startupDatabase(operation, create = false) {
  if (!create && !existsSync(startupFile)) return null;
  const db = new DatabaseSync(startupFile);
  try {
    chmodSync(startupFile, 0o600);
    db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS startup (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL)");
    return operation(db);
  } finally { db.close(); }
}
async function startup() {
  const value = startupDatabase((db) => db.prepare("SELECT token,pid FROM startup WHERE id=1").get()) || null;
  if (value && (!/^[a-f0-9]{64}$/.test(value.token) || !Number.isInteger(value.pid) || value.pid < 1)) throw Error("服务启动记录无效，请检查数据目录和服务日志");
  return value;
}
async function clearStartup(token) {
  // Token-conditional SQL avoids a stale cleaner removing a replacement launch.
  startupDatabase((db) => db.prepare("DELETE FROM startup WHERE token=?").run(token));
}
function alive(pid) {
  // Liveness only: never terminate a process identified by a persisted PID.
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
async function request(meta, action) {
  const response = await fetch(`http://127.0.0.1:${meta.port}/${action}`, {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${meta.token}` },
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw Error("后台服务控制通道不可用");
  const result = await response.json();
  if (result.instance !== meta.token || !["starting", "running", "stopping"].includes(result.state)) throw Error("后台服务身份不匹配");
  delete result.instance;
  return result;
}
async function occupied() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("AXIOM_PORT 无效");
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}
async function inspect() {
  // Read the reservation first so its handoff to the control descriptor has no gap.
  const pending = await startup();
  const meta = await metadata();
  if (meta) {
    try { return { value: await request(meta, "status"), token: meta.token }; } catch {}
  }
  if (pending) {
    if (alive(pending.pid)) return { value: { state: "starting", active: [], log, message: "服务正在启动，可等待就绪或关闭服务。" }, token: pending.token };
    await clearStartup(pending.token);
    await rm(cancellation(pending.token), { force: true });
  }
  return { value: await occupied()
    ? { state: "unmanaged", active: [], log, message: `端口 ${port} 已被占用，但不是可管理的 Axiom2 服务。若运行着旧版服务，请先在原终端退出，再启动后台服务。` }
    : stopped() };
}
export async function status() { return (await inspect()).value; }
async function reserve() {
  const record = { token: randomBytes(32).toString("hex"), pid: process.pid };
  const inserted = startupDatabase((db) => db.prepare("INSERT OR IGNORE INTO startup(id,token,pid) VALUES(1,?,?)").run(record.token, record.pid), true);
  if (!inserted.changes) throw Object.assign(Error("服务已经在启动"), { code: "EEXIST" });
  try {
    const meta = await metadata();
    let existing;
    if (meta) { try { existing = await request(meta, "status"); } catch {} }
    if (existing) throw Object.assign(Error("服务已经运行或正在退出"), { code: "EEXIST" });
    if (await occupied()) throw Error(`端口 ${port} 已被占用，未启动新的服务`);
  } catch (error) { await clearStartup(record.token); throw error; }
  return record;
}
async function waitForStart(token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await inspect();
    if (current.token !== token || !["starting", "running"].includes(current.value.state)) throw Error(`服务启动已取消或失败，请查看日志：${log}`);
    if (current.value.state === "running") return current.value;
    await delay(200);
  }
  throw Error(`服务仍在启动，尚未确认就绪。可刷新状态或运行 axiom2 stop；日志：${log}`);
}
export async function start({ timeoutMs = 40_000 } = {}) {
  const current = await inspect();
  if (current.value.state === "running") return current.value;
  if (current.value.state === "starting") return waitForStart(current.token, timeoutMs);
  if (current.value.state !== "stopped") throw Error(current.value.message || "服务正在退出，请稍后再启动");
  await registerInstallation();
  let record;
  try { record = await reserve(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const concurrent = await inspect();
    if (concurrent.value.state === "running") return concurrent.value;
    if (concurrent.value.state === "starting") return waitForStart(concurrent.token, timeoutMs);
    throw Error("服务状态已变化，请刷新后重试");
  }
  let child, handedOff = false;
  try {
    try { if ((await stat(log)).size > 5 * 1024 * 1024) await rename(log, log + ".previous"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const output = await open(log, "a", 0o600);
    try {
      child = spawn(process.execPath, [cli, "--daemon"], {
        cwd: root, env: { ...process.env, AXIOM_DATA_DIR: root, AXIOM_START_TOKEN: record.token,
          ...(process.env.AXIOM_PI_DIR ? { AXIOM_PI_DIR: resolve(process.env.AXIOM_PI_DIR) } : {}),
          ...(process.env.PI_CODING_AGENT_DIR ? { PI_CODING_AGENT_DIR: resolve(process.env.PI_CODING_AGENT_DIR) } : {}),
        }, detached: true, windowsHide: true, stdio: ["ignore", output.fd, output.fd, "ipc"],
      });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      // The child cannot initialize until its own PID has been durably recorded.
      // If this launcher dies earlier, IPC disconnect makes the waiting child exit.
      const updated = startupDatabase((db) => db.prepare("UPDATE startup SET pid=? WHERE token=?").run(child.pid, record.token));
      if (!updated?.changes) throw Error("服务启动已取消");
      handedOff = true;
      await new Promise((resolve, reject) => child.send(record.token, (error) => error ? reject(error) : resolve()));
      child.unref();
    } finally { await output.close(); }
  } catch (error) {
    if (child?.connected) child.disconnect();
    if (!handedOff) await clearStartup(record.token);
    throw error;
  }
  return waitForStart(record.token, timeoutMs);
}
export async function stop({ timeoutMs = 40_000 } = {}) {
  const initial = await inspect();
  if (initial.value.state === "stopped") return initial.value;
  if (!initial.token || initial.value.state === "unmanaged") throw Error(initial.value.message || "没有可管理的后台服务");
  const token = initial.token;
  // Persist cancellation even before the daemon has opened its control listener.
  await writeFile(cancellation(token), "", { mode: 0o600 });
  const deadline = Date.now() + timeoutMs;
  let accepted = false;
  while (Date.now() < deadline) {
    const meta = await metadata();
    if (!accepted && meta?.token === token) {
      try { await request(meta, "stop"); accepted = true; } catch {}
    }
    const current = await inspect();
    const latest = current.value.state === "stopped" ? await metadata() : null;
    const confirmed = current.value.state === "stopped" && (latest?.token !== token || (latest.pid && !alive(latest.pid)));
    if (confirmed || (current.token && current.token !== token)) {
      await rm(cancellation(token), { force: true });
      return current.value;
    }
    await delay(200);
  }
  throw Error(`服务仍在退出，尚未确认停止。请稍后刷新状态；日志：${log}`);
}
async function initialize(options) {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  process.env.AXIOM_PI_DIR ||= getAgentDir();
  const { startServer } = await import("../app/dist/server/index.js");
  return startServer(options);
}
export async function serve(background = false, { initialize: bootService = initialize } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("AXIOM_PORT 无效");
  let record;
  if (background && process.env.AXIOM_START_TOKEN) {
    const token = process.env.AXIOM_START_TOKEN;
    await new Promise((resolve, reject) => {
      if (!process.connected) { reject(Error("服务启动器已退出")); return; }
      const disconnected = () => reject(Error("服务启动器已退出"));
      process.once("disconnect", disconnected);
      process.once("message", (message) => {
        process.removeListener("disconnect", disconnected);
        if (message === token) resolve(); else reject(Error("服务启动握手无效"));
      });
    });
    process.disconnect();
    record = await startup();
    if (record?.token !== token || record.pid !== process.pid) throw Error("服务启动已取消");
  } else {
    await registerInstallation();
    if ((await status()).state !== "stopped") throw Error("服务已经运行或正在启动，请先检查 axiom2 status");
    record = await reserve();
  }
  const { token } = record;
  let app, closing = false, controlPort = 0, finishing;
  let resolveBoot, rejectBoot;
  const boot = new Promise((resolve, reject) => { resolveBoot = resolve; rejectBoot = reject; });
  void boot.catch(() => {});
  const active = () => app.store.db.prepare(`SELECT s.title FROM sessions s WHERE
    EXISTS(SELECT 1 FROM runs r WHERE r.sessionId=s.id AND r.status IN ('starting','running','stopping'))
    OR EXISTS(SELECT 1 FROM tasks t WHERE t.parentSessionId=s.id AND t.status IN ('queued','starting','running','wrapping','stopping','summarizing'))
    OR EXISTS(SELECT 1 FROM compressions c WHERE c.sessionId=s.id AND json_extract(c.body,'$.state')='running') LIMIT 20`).all().map((row) => String(row.title || "未命名会话").slice(0, 160));
  const snapshot = () => ({ state: closing ? "stopping" : app ? "running" : "starting", instance: token, pid: process.pid,
    url: app?.accessUrl, background, active: app && !closing ? active() : [], log });
  const finish = () => finishing ||= (async () => {
    const service = await boot.catch(() => undefined);
    await service?.close();
    if ((await metadata())?.token === token) await rm(descriptor, { force: true });
    await clearStartup(token);
    await rm(cancellation(token), { force: true });
    control.closeAllConnections();
    await new Promise((resolve) => control.close(resolve));
  })();
  const shutdown = async () => {
    closing = true;
    try { await finish(); process.exit(0); }
    catch (error) { console.error(error); process.exit(1); }
  };
  const control = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.host !== `127.0.0.1:${controlPort}` || req.headers.origin || req.headers["sec-fetch-site"] === "cross-site" ||
        req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); res.end(); return; }
    if (!((req.url === "/status" && req.method === "GET") || (req.url === "/stop" && req.method === "POST"))) {
      res.writeHead(405); res.end(); return;
    }
    try {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(snapshot()));
      if (req.url === "/stop") void shutdown();
    } catch { res.writeHead(500); res.end(); }
  });
  control.requestTimeout = 5000;
  control.headersTimeout = 5000;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void shutdown(); });
  try {
    await new Promise((resolve, reject) => { control.once("error", reject); control.listen(0, "127.0.0.1", resolve); });
    controlPort = control.address().port;
    await registerInstallation();
    await atomicJson(descriptor, { port: controlPort, token, pid: process.pid });
    let cancelled = false;
    try { await stat(cancellation(token)); cancelled = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (closing || cancelled) {
      resolveBoot(undefined);
      await shutdown();
      return;
    }
    resolveBoot(bootService({ root, port }));
    app = await boot;
    if (closing) { await shutdown(); return; }
    await clearStartup(token);
    console.log(`Axiom2 已启动：${app.accessUrl}\n数据目录：${root}\n${background ? "后台服务运行中，可在客户端关闭，或运行 axiom2 stop。" : "保留此终端，Ctrl+C 退出服务；也可在客户端关闭服务。"}`);
  } catch (error) {
    rejectBoot(error);
    await finish();
    throw error;
  }
}
